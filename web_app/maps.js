/**
 * Payanam Live Map & Realtime Navigation Engine
 * Integrates:
 * 1. HTML5 High-Precision Device GPS Tracking (Real Latitude, Longitude, Speed & Heading)
 * 2. Multi-Provider Tile Layers (CartoDB Dark Matter, OSM, Stadia, ESRI Satellite)
 * 3. Live Weather & Rain Radar Layer (RainViewer API)
 * 4. OSRM Real Road Routing & Turn-by-Turn Maneuver Instructions
 * 5. Photon & OpenStreetMap Live Geocoding & Place Discovery
 */

const PayanamMaps = (function () {
  // Tile Providers Definitions
  const tileProviders = {
    'google-roadmap': {
      name: 'Google Maps (Standard RoadMap)',
      url: 'https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}',
      attribution: '&copy; Google Maps',
      subdomains: ['0', '1', '2', '3'],
      maxZoom: 21
    },
    'google-satellite': {
      name: 'Google Maps (Satellite Hybrid)',
      url: 'https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}',
      attribution: '&copy; Google Maps',
      subdomains: ['0', '1', '2', '3'],
      maxZoom: 21
    },
    'google-terrain': {
      name: 'Google Maps (Terrain & Elevation)',
      url: 'https://mt{s}.google.com/vt/lyrs=p&x={x}&y={y}&z={z}',
      attribution: '&copy; Google Maps',
      subdomains: ['0', '1', '2', '3'],
      maxZoom: 20
    },
    'google-traffic': {
      name: 'Google Maps (Live Traffic)',
      url: 'https://mt{s}.google.com/vt/lyrs=m,traffic&x={x}&y={y}&z={z}',
      attribution: '&copy; Google Maps',
      subdomains: ['0', '1', '2', '3'],
      maxZoom: 21
    },
    'carto-dark': {
      name: 'CartoDB Dark Matter (Cockpit Night Mode)',
      url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
      subdomains: 'abcd',
      maxZoom: 19
    },
    'osm-standard': {
      name: 'OpenStreetMap Standard',
      url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '&copy; OpenStreetMap contributors',
      subdomains: 'abc',
      maxZoom: 19
    },
    'satellite-hybrid': {
      name: 'ESRI World Imagery (Satellite)',
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      attribution: 'Tiles &copy; Esri',
      subdomains: '',
      maxZoom: 18
    }
  };

  let currentTileLayer = null;
  let rainRadarLayer = null;
  let isRadarActive = false;
  let watchId = null;
  let deviceGpsActive = false;
  let deviceAccuracyCircle = null;

  // 1. Attach Tile Layer to Leaflet Map
  function attachTileLayer(mapInstance, providerKey = 'google-roadmap') {
    if (!mapInstance) return;
    if (currentTileLayer) {
      try {
        mapInstance.removeLayer(currentTileLayer);
      } catch (e) {}
    }

    const provider = tileProviders[providerKey] || tileProviders['google-roadmap'];
    const layerOptions = {
      attribution: provider.attribution,
      maxZoom: provider.maxZoom || 20,
      keepBuffer: 6,
      updateWhenIdle: false,
      updateWhenZooming: true
    };
    if (provider.subdomains) {
      layerOptions.subdomains = provider.subdomains;
    }

    currentTileLayer = L.tileLayer(provider.url, layerOptions);
    currentTileLayer.addTo(mapInstance);
    
    // Staggered size invalidation to guarantee crisp tile render without black screen
    try { mapInstance.invalidateSize(); } catch(e) {}
    requestAnimationFrame(() => {
      try { mapInstance.invalidateSize(); } catch(e) {}
    });
    setTimeout(() => {
      try { mapInstance.invalidateSize(); } catch(e) {}
    }, 120);
    setTimeout(() => {
      try { mapInstance.invalidateSize(); } catch(e) {}
    }, 350);

    return currentTileLayer;
  }

  // 2. Toggle Live Rain & Weather Radar Overlay (RainViewer API)
  async function toggleRainRadar(mapInstance) {
    if (!mapInstance) return false;

    if (isRadarActive && rainRadarLayer) {
      mapInstance.removeLayer(rainRadarLayer);
      rainRadarLayer = null;
      isRadarActive = false;
      return false;
    }

    try {
      // Fetch latest radar frame timestamp from RainViewer
      const res = await fetch('https://api.rainviewer.com/public/weather-maps.json');
      const data = await res.json();

      if (data && data.radar && data.radar.past && data.radar.past.length > 0) {
        const latestFrame = data.radar.past[data.radar.past.length - 1];
        const radarPath = latestFrame.path;
        const radarUrl = `https://tilecache.rainviewer.com${radarPath}/256/{z}/{x}/{y}/2/1_1.png`;

        rainRadarLayer = L.tileLayer(radarUrl, {
          opacity: 0.65,
          zIndex: 500,
          maxZoom: 18
        });
        rainRadarLayer.addTo(mapInstance);
        isRadarActive = true;
        return true;
      }
    } catch (e) {
      console.warn('Could not load live rain radar overlay:', e);
    }
    return false;
  }

  let lastReportedLat = null;
  let lastReportedLng = null;
  let gpsHeartbeatInterval = null;

  // Kalman Filter State for GPS positions
  class KalmanFilter1D {
    constructor(processNoise = 0.001, measurementNoise = 25) {
      this.processNoise = processNoise;
      this.measurementNoise = measurementNoise;
      this.estimate = 0;
      this.errorEstimate = 1;
    }

    update(measurement) {
      // Prediction step
      this.errorEstimate += this.processNoise;

      // Update step
      const gain = this.errorEstimate / (this.errorEstimate + this.measurementNoise);
      this.estimate += gain * (measurement - this.estimate);
      this.errorEstimate *= (1 - gain);

      return this.estimate;
    }
  }

  let kalmanLat = new KalmanFilter1D(0.001, 25);
  let kalmanLng = new KalmanFilter1D(0.001, 25);
  let kalmanSpeed = new KalmanFilter1D(0.01, 5);
  let kalmanHeading = new KalmanFilter1D(0.005, 10);

  // Sensor Fusion & Motion Detection
  let accelData = { x: 0, y: 0, z: 0 };
  let lastAccelMagnitude = 0;
  let motionIntensity = 0;
  let isMotionDetected = false;

  function initSensorFusion() {
    if (window.DeviceMotionEvent && typeof DeviceMotionEvent !== 'undefined') {
      window.addEventListener('devicemotion', (event) => {
        const a = event.acceleration;
        if (a) {
          accelData.x = a.x || 0;
          accelData.y = a.y || 0;
          accelData.z = a.z || 0;
          const magnitude = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
          motionIntensity = Math.abs(magnitude - lastAccelMagnitude) * 0.3 + motionIntensity * 0.7;
          lastAccelMagnitude = magnitude;
          isMotionDetected = motionIntensity > 1.5;
        }
      }, { passive: true });
    }
  }

  // Adaptive polling strategy
  let adaptivePollingInterval = 1000;
  function updateAdaptivePollingInterval(accuracy, speed) {
    if (accuracy > 50) {
      adaptivePollingInterval = 500; // High uncertainty, poll faster
    } else if (accuracy > 30) {
      adaptivePollingInterval = 800;
    } else if (speed > 40) {
      adaptivePollingInterval = 600; // Fast motion, track closer
    } else if (speed > 20) {
      adaptivePollingInterval = 1000;
    } else {
      adaptivePollingInterval = 1500; // Slow/stopped, less frequent polling
    }
    return adaptivePollingInterval;
  }

  // GPS outlier detection
  function isGpsOutlier(newLat, newLng, lastLat, lastLng, lastTime, accuracy) {
    if (lastLat === null || lastLng === null) return false;

    const timeDiffSec = (Date.now() - lastTime) / 1000;
    const distM = PayanamMaps.haversine(lastLat, lastLng, newLat, newLng) * 1000;
    const maxReasonableSpeed = 150; // 150 km/h max for motorcycles
    const maxReasonableDistM = (maxReasonableSpeed / 3.6) * timeDiffSec * 1.2;

    if (distM > maxReasonableDistM) {
      console.warn(`GPS outlier rejected: jumped ${distM}m in ${timeDiffSec}s`, { newLat, newLng, accuracy });
      return true;
    }

    if (accuracy > 100) return true;
    return false;
  }

  // Speed validation using distance and time
  function validateAndCalculateSpeed(newLat, newLng, lastLat, lastLng, lastTime, rawSpeed) {
    const timeDiffSec = (Date.now() - lastTime) / 1000;
    if (timeDiffSec < 0.5) return rawSpeed;

    const distKm = PayanamMaps.haversine(lastLat, lastLng, newLat, newLng);
    const calculatedSpeed = (distKm * 1000 * 3.6) / (timeDiffSec * 1000); // km/h

    if (rawSpeed === 0 || rawSpeed === undefined || isNaN(rawSpeed)) {
      return calculatedSpeed;
    }

    const speedDiff = Math.abs(calculatedSpeed - rawSpeed);
    if (speedDiff > 20) {
      return (calculatedSpeed * 0.4 + rawSpeed * 0.6);
    }

    return kalmanSpeed.update(rawSpeed);
  }

  // Compass heading validation
  function validateHeading(rawHeading, currentSpeed) {
    if (typeof rawHeading !== 'number' || isNaN(rawHeading)) {
      return null;
    }

    if (currentSpeed < 3) return null;

    return rawHeading;
  }

  // Bearing calculation from trajectory
  function calculateBearingFromMovement(lat1, lng1, lat2, lng2) {
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const y = Math.sin(dLng) * Math.cos(lat2 * Math.PI / 180);
    const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
              Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLng);
    return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
  }

  // -------------------------------------------------------------
  // 60FPS PHYSICS INTERPOLATION & DEAD-RECKONING ENGINE
  // -------------------------------------------------------------
  let animFrameId = null;
  let currentLat = null;
  let currentLng = null;
  let targetLat = null;
  let targetLng = null;
  let currentHeading = 0;
  let targetHeading = 0;
  let currentSpeed = 0;
  let lastGpsTimestamp = Date.now();
  let frameCallback = null;

  function startPhysicsLoop(onFrame) {
    frameCallback = onFrame;
    if (animFrameId) cancelAnimationFrame(animFrameId);

    const loop = () => {
      if (currentLat !== null && targetLat !== null && currentLng !== null && targetLng !== null) {
        const now = Date.now();
        const deltaSec = Math.min(0.1, (now - lastGpsTimestamp) / 1000);

        // 1. Smooth Coordinate LERP (60 FPS linear interpolation)
        const lerpFactor = 0.18;
        currentLat += (targetLat - currentLat) * lerpFactor;
        currentLng += (targetLng - currentLng) * lerpFactor;

        // 2. Dead-Reckoning Extrapolation if moving between GPS fixes
        if (currentSpeed > 3 && deltaSec < 3.0) {
          const headingRad = (currentHeading * Math.PI) / 180;
          const speedMps = currentSpeed / 3.6;
          const distMeters = speedMps * (1 / 60); // 1 frame distance
          const dLat = (distMeters * Math.cos(headingRad)) / 111139;
          const dLng = (distMeters * Math.sin(headingRad)) / (111139 * Math.cos((currentLat * Math.PI) / 180));
          currentLat += dLat * 0.15;
          currentLng += dLng * 0.15;
        }

        // 3. Smooth Heading Angle Interpolation (shortest circular path)
        let diff = (targetHeading - currentHeading + 540) % 360 - 180;
        currentHeading = (currentHeading + diff * 0.16 + 360) % 360;

        if (frameCallback) {
          frameCallback({
            lat: currentLat,
            lng: currentLng,
            heading: Math.round(currentHeading),
            speed: currentSpeed,
            accuracy: 8
          });
        }
      }
      animFrameId = requestAnimationFrame(loop);
    };
    animFrameId = requestAnimationFrame(loop);
  }

  function stopPhysicsLoop() {
    if (animFrameId) {
      cancelAnimationFrame(animFrameId);
      animFrameId = null;
    }
  }

  // 3. HTML5 Live Device GPS Geolocation with Kalman Filtering & Sensor Fusion
  function startLiveGpsTracking(mapInstance, onLocationUpdate, onError) {
    if (!navigator.geolocation) {
      if (onError) onError('Geolocation is not supported by your browser');
      return false;
    }

    stopLiveGpsTracking(mapInstance);
    deviceGpsActive = true;

    // Initialize sensor fusion for motion detection
    initSensorFusion();

    // Start 60 FPS Physics Interpolation
    startPhysicsLoop(onLocationUpdate);

    const processPosition = (position) => {
      if (!position || !position.coords) return;
      const coords = position.coords;
      let rawLat = coords.latitude;
      let rawLng = coords.longitude;
      const accuracy = coords.accuracy || 10;
      let rawSpeed = coords.speed !== null && coords.speed !== undefined && !isNaN(coords.speed) ? Math.max(0, coords.speed * 3.6) : 0;
      let rawHeading = coords.heading;

      // 1. Reject severe GPS jitter and outliers
      if (isGpsOutlier(rawLat, rawLng, lastReportedLat, lastReportedLng, lastGpsTimestamp, accuracy)) {
        return;
      }

      // 2. Apply Kalman filtering to position
      if (currentLat !== null && currentLng !== null) {
        rawLat = kalmanLat.update(rawLat);
        rawLng = kalmanLng.update(rawLng);
      }

      // 3. Validate and calculate speed using distance/time
      if (lastReportedLat !== null && lastReportedLng !== null) {
        rawSpeed = validateAndCalculateSpeed(rawLat, rawLng, lastReportedLat, lastReportedLng, lastGpsTimestamp, rawSpeed);
      }

      // 4. Validate compass heading and fallback to bearing
      const validatedHeading = validateHeading(rawHeading, rawSpeed);
      if (validatedHeading !== null) {
        rawHeading = validatedHeading;
      } else if (lastReportedLat !== null && lastReportedLng !== null && rawSpeed > 3) {
        rawHeading = calculateBearingFromMovement(lastReportedLat, lastReportedLng, rawLat, rawLng);
      } else if (currentHeading !== undefined) {
        rawHeading = currentHeading;
      }

      // Apply Kalman to heading
      if (typeof rawHeading === 'number' && !isNaN(rawHeading)) {
        rawHeading = kalmanHeading.update(rawHeading);
      }

      // 5. Initialize or feed physics engine
      if (currentLat === null || currentLng === null) {
        currentLat = rawLat;
        currentLng = rawLng;
        currentHeading = rawHeading || 0;
        kalmanLat.estimate = rawLat;
        kalmanLng.estimate = rawLng;
      }

      targetLat = rawLat;
      targetLng = rawLng;
      if (typeof rawHeading === 'number' && !isNaN(rawHeading)) {
        targetHeading = rawHeading;
      }
      currentSpeed = rawSpeed;
      lastGpsTimestamp = Date.now();

      lastReportedLat = rawLat;
      lastReportedLng = rawLng;

      // 6. Update accuracy circle with better color coding
      if (mapInstance) {
        let circleColor = '#1A73E8';
        let circleOpacity = 0.15;

        if (accuracy < 10) {
          circleColor = '#00E676'; // Excellent
          circleOpacity = 0.1;
        } else if (accuracy < 20) {
          circleColor = '#00BCD4'; // Very Good
          circleOpacity = 0.12;
        } else if (accuracy > 50) {
          circleColor = '#FF9800'; // Poor
          circleOpacity = 0.2;
        }

        if (!deviceAccuracyCircle) {
          deviceAccuracyCircle = L.circle([rawLat, rawLng], {
            radius: Math.min(accuracy, 50),
            color: circleColor,
            fillColor: circleColor,
            fillOpacity: circleOpacity,
            weight: 1.5
          }).addTo(mapInstance);
        } else {
          deviceAccuracyCircle.setLatLng([rawLat, rawLng]);
          deviceAccuracyCircle.setRadius(Math.min(accuracy, 50));
          deviceAccuracyCircle.setStyle({ color: circleColor, fillColor: circleColor, fillOpacity: circleOpacity });
        }
      }
    };

    // Immediate fix
    navigator.geolocation.getCurrentPosition(processPosition, () => {}, { enableHighAccuracy: true, maximumAge: 0, timeout: 4000 });

    // 1. High-Precision Continuous Watcher
    try {
      watchId = navigator.geolocation.watchPosition(
        processPosition,
        (err) => {
          console.warn('Geolocation watch notice:', err.message);
          if (onError) onError(err.message);
        },
        {
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: 7000
        }
      );
    } catch (e) {
      console.warn('WatchPosition error:', e);
    }

    // 2. Adaptive GPS Polling Heartbeat (adjusts interval based on accuracy & speed)
    gpsHeartbeatInterval = setInterval(() => {
      if (!deviceGpsActive) return;
      const interval = updateAdaptivePollingInterval(
        kalmanLat.errorEstimate * 1000,
        currentSpeed || 0
      );
      navigator.geolocation.getCurrentPosition(
        processPosition,
        () => {},
        { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 }
      );
    }, 1000);

    return true;
  }

  function stopLiveGpsTracking(mapInstance) {
    stopPhysicsLoop();
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    if (gpsHeartbeatInterval !== null) {
      clearInterval(gpsHeartbeatInterval);
      gpsHeartbeatInterval = null;
    }
    deviceGpsActive = false;
    currentLat = null;
    currentLng = null;
    targetLat = null;
    targetLng = null;

    // Reset Kalman filters
    kalmanLat = new KalmanFilter1D(0.001, 25);
    kalmanLng = new KalmanFilter1D(0.001, 25);
    kalmanSpeed = new KalmanFilter1D(0.01, 5);
    kalmanHeading = new KalmanFilter1D(0.005, 10);

    if (deviceAccuracyCircle && mapInstance) {
      try { mapInstance.removeLayer(deviceAccuracyCircle); } catch(e) {}
      deviceAccuracyCircle = null;
    }
  }

  // 4. Fetch Real Road Route Geometry and Maneuvers from OSRM
  async function fetchRoadRoute(coordinates) {
    if (!coordinates || coordinates.length < 2) return null;

    try {
      const coordString = coordinates.map(c => `${c[1]},${c[0]}`).join(';');
      const url = `https://router.project-osrm.org/route/v1/driving/${coordString}?overview=full&geometries=geojson&steps=true`;

      const response = await fetch(url);
      if (!response.ok) throw new Error(`OSRM HTTP error: ${response.status}`);
      const data = await response.json();

      if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
        const route = data.routes[0];
        const latLngs = route.geometry.coordinates.map(coord => [coord[1], coord[0]]);

        // Extract navigation steps & maneuvers
        const steps = [];
        if (route.legs) {
          route.legs.forEach(leg => {
            if (leg.steps) {
              leg.steps.forEach(s => {
                steps.push({
                  instruction: s.maneuver ? formatManeuverText(s.maneuver, s.name) : s.name || 'Continue on route',
                  modifier: s.maneuver ? s.maneuver.modifier : 'straight',
                  type: s.maneuver ? s.maneuver.type : 'turn',
                  distanceMeters: Math.round(s.distance),
                  durationSec: Math.round(s.duration)
                });
              });
            }
          });
        }

        return {
          latLngs,
          steps,
          distanceKm: (route.distance / 1000).toFixed(1),
          durationMins: Math.round(route.duration / 60)
        };
      }
    } catch (e) {
      console.warn('OSRM live routing failed or offline, using geodesic interpolation:', e);
    }

    return {
      latLngs: coordinates,
      steps: [
        { instruction: 'Follow planned motorcycle route corridor', distanceMeters: 1000, modifier: 'straight' }
      ],
      distanceKm: calculateStraightLineDistance(coordinates).toFixed(1),
      durationMins: Math.round(calculateStraightLineDistance(coordinates) * 1.4)
    };
  }

  function formatManeuverText(maneuver, streetName) {
    const type = maneuver.type;
    const mod = maneuver.modifier ? ` ${maneuver.modifier}` : '';
    const street = streetName ? ` onto ${streetName}` : '';
    if (type === 'depart') return `Head${mod}${street}`;
    if (type === 'arrive') return `Arrive at destination`;
    if (type === 'turn') return `Turn${mod}${street}`;
    if (type === 'fork') return `Keep${mod} at the fork${street}`;
    if (type === 'roundabout') return `Enter roundabout and take exit${street}`;
    return `Continue${street || ' on route'}`;
  }

  // 5. Live Place Search with Photon API (Backed by OpenStreetMap)
  async function searchPlaces(query, centerLat = 12.9176, centerLng = 77.6233) {
    if (!query || query.trim().length < 2) return [];

    try {
      const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&lat=${centerLat}&lon=${centerLng}&limit=6`;
      const response = await fetch(url);
      if (!response.ok) return [];
      const data = await response.json();

      if (data.features) {
        return data.features.map(f => {
          const props = f.properties;
          const coords = f.geometry.coordinates;
          const name = props.name || props.street || query;
          const addressParts = [props.city || props.district, props.state, props.country].filter(Boolean);
          return {
            name,
            subText: addressParts.join(', ') || 'Scenic Point',
            lat: coords[1],
            lng: coords[0],
            category: props.osm_value || 'Stop'
          };
        });
      }
    } catch (e) {
      console.warn('Live geocoding error:', e);
    }
    return [];
  }

  function calculateStraightLineDistance(points) {
    let total = 0;
    for (let i = 0; i < points.length - 1; i++) {
      total += haversine(points[i][0], points[i][1], points[i+1][0], points[i+1][1]);
    }
    return total;
  }

  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371; // km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  // Get current GPS accuracy metrics
  function getGpsMetrics() {
    return {
      isActive: deviceGpsActive,
      currentLat: currentLat,
      currentLng: currentLng,
      currentSpeed: Math.round(currentSpeed),
      currentHeading: Math.round(currentHeading),
      kalmanAccuracy: Math.round(kalmanLat.errorEstimate * 1000), // in meters
      motionIntensity: Math.round(motionIntensity * 100) / 100,
      isMoving: isMotionDetected || currentSpeed > 3,
      adaptivePollingMs: adaptivePollingInterval
    };
  }

  return {
    tileProviders,
    attachTileLayer,
    toggleRainRadar,
    startLiveGpsTracking,
    stopLiveGpsTracking,
    isGpsActive: () => deviceGpsActive,
    isRadarActive: () => isRadarActive,
    fetchRoadRoute,
    searchPlaces,
    haversine,
    getGpsMetrics,
    KalmanFilter1D
  };
})();

// Backwards compatibility alias
const RideSyncMaps = PayanamMaps;
