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

  // 3. HTML5 Live Device GPS Geolocation
  function startLiveGpsTracking(mapInstance, onLocationUpdate, onError) {
    if (!navigator.geolocation) {
      if (onError) onError('Geolocation is not supported by your browser');
      return false;
    }

    stopLiveGpsTracking(mapInstance);
    deviceGpsActive = true;

    const processPosition = (position) => {
      if (!position || !position.coords) return;
      const coords = position.coords;
      const lat = coords.latitude;
      const lng = coords.longitude;
      const accuracy = coords.accuracy || 8;
      let speed = coords.speed !== null && coords.speed !== undefined && !isNaN(coords.speed) ? Math.max(0, coords.speed * 3.6) : 0;
      let heading = coords.heading;

      // Calculate trajectory bearing if device compass heading is null or unavailable
      if (typeof heading !== 'number' || isNaN(heading) || heading === 0) {
        if (lastReportedLat !== null && lastReportedLng !== null && (lat !== lastReportedLat || lng !== lastReportedLng)) {
          const dLat = (lat - lastReportedLat) * Math.PI / 180;
          const dLng = (lng - lastReportedLng) * Math.PI / 180;
          const y = Math.sin(dLng) * Math.cos(lat * Math.PI / 180);
          const x = Math.cos(lastReportedLat * Math.PI / 180) * Math.sin(lat * Math.PI / 180) - Math.sin(lastReportedLat * Math.PI / 180) * Math.cos(lat * Math.PI / 180) * Math.cos(dLng);
          heading = ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
        }
      }

      lastReportedLat = lat;
      lastReportedLng = lng;

      // Render or update accuracy circle on map
      if (mapInstance) {
        if (!deviceAccuracyCircle) {
          deviceAccuracyCircle = L.circle([lat, lng], {
            radius: Math.min(accuracy, 30),
            color: '#00E5FF',
            fillColor: '#00E5FF',
            fillOpacity: 0.12,
            weight: 1.5
          }).addTo(mapInstance);
        } else {
          deviceAccuracyCircle.setLatLng([lat, lng]);
          deviceAccuracyCircle.setRadius(Math.min(accuracy, 30));
        }
      }

      if (onLocationUpdate) {
        onLocationUpdate({
          lat,
          lng,
          accuracy,
          speed,
          heading: heading || 0,
          timestamp: position.timestamp || Date.now()
        });
      }
    };

    // Immediate fix
    navigator.geolocation.getCurrentPosition(processPosition, () => {}, { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 });

    // 1. High-Precision Continuous Watcher (maximumAge: 0 for zero lag)
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
          timeout: 8000
        }
      );
    } catch (e) {
      console.warn('WatchPosition error:', e);
    }

    // 2. Continuous 1.2s GPS Polling Heartbeat (guarantees continuous tracking without mobile browser sleep)
    gpsHeartbeatInterval = setInterval(() => {
      if (!deviceGpsActive) return;
      navigator.geolocation.getCurrentPosition(
        processPosition,
        () => {},
        { enableHighAccuracy: true, maximumAge: 0, timeout: 3500 }
      );
    }, 1200);

    return true;
  }

  function stopLiveGpsTracking(mapInstance) {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    if (gpsHeartbeatInterval !== null) {
      clearInterval(gpsHeartbeatInterval);
      gpsHeartbeatInterval = null;
    }
    deviceGpsActive = false;
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
    haversine
  };
})();

// Backwards compatibility alias
const RideSyncMaps = PayanamMaps;
