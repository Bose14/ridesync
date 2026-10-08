/**
 * RideSync - High-Accuracy GPS Module
 * Optimized for motorcycle riders at 60-80 km/h in unfamiliar cities
 * Features: Road snapping, speed validation, predictive correction, offline cache
 */

const HighAccuracyGPS = (function () {
  let isHighAccuracyMode = false;
  let positionHistory = [];
  let routeCache = null;
  let lastValidPosition = null;
  let speedHistory = [];
  let headingHistory = [];
  let lastBatteryLevel = 100;
  const MAX_HISTORY = 20;
  const POSITION_TIMEOUT = 5000; // 5 seconds

  // ===== DEVICE BATTERY (Real device battery percentage) =====

  async function getDeviceBattery() {
    try {
      if (navigator.getBattery) {
        const battery = await navigator.getBattery();
        lastBatteryLevel = Math.round(battery.level * 100);
        return lastBatteryLevel;
      }
    } catch (e) {}
    return lastBatteryLevel;
  }

  // Monitor battery changes in real-time
  function initBatteryMonitoring() {
    try {
      if (navigator.getBattery) {
        navigator.getBattery().then(battery => {
          battery.addEventListener('levelchange', () => {
            lastBatteryLevel = Math.round(battery.level * 100);
          });
        });
      }
    } catch (e) {}
  }

  // ===== ROAD SNAPPING (Improve accuracy on known routes) =====

  function snapToRoad(lat, lng, route) {
    if (!route || !route.legs) return { lat, lng, snapped: false };

    let closestPoint = { lat, lng, distance: Infinity, snapped: false };

    // Check all steps in route
    route.legs.forEach(leg => {
      if (!leg.steps) return;

      leg.steps.forEach(step => {
        if (!step.path) return;

        // Find closest point on this step
        step.path.forEach((point, idx) => {
          const dist = haversineDistance(lat, lng, point.lat, point.lng);

          if (dist < closestPoint.distance && dist < 100) { // Within 100m
            closestPoint = {
              lat: point.lat,
              lng: point.lng,
              distance: dist,
              snapped: true,
              step: idx
            };
          }
        });
      });
    });

    // If closest point is on route and within 100m, snap to it
    if (closestPoint.snapped && closestPoint.distance < 100) {
      return {
        lat: closestPoint.lat,
        lng: closestPoint.lng,
        snapped: true,
        confidence: Math.max(0, 1 - (closestPoint.distance / 100))
      };
    }

    return { lat, lng, snapped: false, confidence: 0 };
  }

  // ===== KALMAN FILTER (Already in maps.js, enhanced version) =====

  const KalmanFilterHighAccuracy = {
    posX: { estimate: 0, errorEstimate: 1, processNoise: 0.0005, measurementNoise: 10 },
    posY: { estimate: 0, errorEstimate: 1, processNoise: 0.0005, measurementNoise: 10 },
    speedX: { estimate: 0, errorEstimate: 1, processNoise: 0.01, measurementNoise: 3 },
    speedY: { estimate: 0, errorEstimate: 1, processNoise: 0.01, measurementNoise: 3 },

    update: function(measurement) {
      // Prediction step
      this.errorEstimate += this.processNoise;

      // Update step
      const gain = this.errorEstimate / (this.errorEstimate + this.measurementNoise);
      this.estimate += gain * (measurement - this.estimate);
      this.errorEstimate *= (1 - gain);

      return this.estimate;
    },

    reset: function() {
      this.estimate = 0;
      this.errorEstimate = 1;
    }
  };

  // ===== SPEED VALIDATION & PREDICTION =====

  function validateSpeed(gpsSpeed, calculatedSpeed, timeDelta) {
    // At 60-80 km/h, max acceleration is ~3 m/s²
    const maxAcceleration = 3;
    const maxSpeedChange = maxAcceleration * timeDelta;

    const speedDiff = Math.abs(gpsSpeed - calculatedSpeed);

    // If speeds differ significantly, blend them
    if (speedDiff > maxSpeedChange) {
      // One is unreliable, trust the other more
      if (gpsSpeed > 120 || gpsSpeed < 0) return calculatedSpeed;
      if (calculatedSpeed > 120 || calculatedSpeed < 0) return gpsSpeed;

      // Blend: 60% calculated, 40% GPS (safer blend for prediction)
      return calculatedSpeed * 0.6 + gpsSpeed * 0.4;
    }

    // Both are valid, average them
    return (gpsSpeed + calculatedSpeed) / 2;
  }

  function predictNextPosition(lat, lng, speed, heading, timeDelta) {
    // Dead reckoning: predict where rider will be
    const speedMs = speed / 3.6; // Convert km/h to m/s
    const distanceM = speedMs * timeDelta;

    const headingRad = (heading * Math.PI) / 180;
    const dLat = (distanceM * Math.cos(headingRad)) / 111139;
    const dLng = (distanceM * Math.sin(headingRad)) / (111139 * Math.cos((lat * Math.PI) / 180));

    return {
      lat: lat + dLat,
      lng: lng + dLng,
      confidence: 1 - (timeDelta / 5) // Confidence decreases over time
    };
  }

  // ===== POSITION TRACKING (HIGH ACCURACY) =====

  function startHighAccuracyTracking(onUpdate, onError) {
    isHighAccuracyMode = true;
    let lastUpdateTime = Date.now();

    // Initialize battery monitoring
    initBatteryMonitoring();
    getDeviceBattery();

    if (!navigator.geolocation) {
      onError('Geolocation not supported');
      return false;
    }

    // Immediate position + continuous watch
    navigator.geolocation.getCurrentPosition(
      (pos) => processPosition(pos, onUpdate),
      (err) => onError(err.message),
      {
        enableHighAccuracy: true,
        timeout: POSITION_TIMEOUT,
        maximumAge: 0
      }
    );

    // Continuous watch at higher frequency
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const now = Date.now();
        const timeSinceLastUpdate = (now - lastUpdateTime) / 1000;

        if (timeSinceLastUpdate > 0.5) { // Update at least every 0.5 seconds
          lastUpdateTime = now;
          processPosition(pos, onUpdate);
        }
      },
      (err) => console.warn('Watch error:', err.message),
      {
        enableHighAccuracy: true,
        timeout: POSITION_TIMEOUT,
        maximumAge: 0
      }
    );

    // Aggressive polling for high-speed scenarios
    const pollInterval = setInterval(() => {
      if (!isHighAccuracyMode) {
        clearInterval(pollInterval);
        navigator.geolocation.clearWatch(watchId);
        return;
      }

      navigator.geolocation.getCurrentPosition(
        (pos) => processPosition(pos, onUpdate),
        () => {}, // Silent fail
        {
          enableHighAccuracy: true,
          timeout: POSITION_TIMEOUT,
          maximumAge: 0
        }
      );
    }, 1000); // Poll every second for guaranteed updates

    return { watchId, pollInterval };
  }

  function processPosition(position, callback) {
    const coords = position.coords;
    let lat = coords.latitude;
    let lng = coords.longitude;
    const accuracy = coords.accuracy || 15;
    const rawSpeed = coords.speed ? coords.speed * 3.6 : 0; // m/s to km/h
    const rawHeading = coords.heading || 0;

    // Add to history for analysis
    positionHistory.push({ lat, lng, accuracy, timestamp: Date.now() });
    speedHistory.push(rawSpeed);
    headingHistory.push(rawHeading);

    if (positionHistory.length > MAX_HISTORY) {
      positionHistory.shift();
      speedHistory.shift();
      headingHistory.shift();
    }

    // Reject severe outliers
    if (accuracy > 100) {
      console.warn('Position rejected: accuracy too poor:', accuracy);
      return;
    }

    // Apply Kalman filtering
    const lastPos = lastValidPosition || { lat, lng };
    const timeDelta = (Date.now() - (lastValidPosition?.timestamp || Date.now())) / 1000;

    // Calculate speed from position delta
    const calculatedSpeed = timeDelta > 0.1 ?
      (haversineDistance(lastPos.lat, lastPos.lng, lat, lng) / timeDelta) * 3.6 :
      rawSpeed;

    // Validate and blend speeds
    const validatedSpeed = validateSpeed(rawSpeed, calculatedSpeed, timeDelta);

    // Apply Kalman to position
    lat = KalmanFilterHighAccuracy.posX.update(lat);
    lng = KalmanFilterHighAccuracy.posY.update(lng);

    // Validate heading
    const bearing = calculateBearing(lastPos.lat, lastPos.lng, lat, lng);
    const validatedHeading = validatedSpeed > 5 ? bearing : rawHeading;

    lastValidPosition = {
      lat,
      lng,
      speed: validatedSpeed,
      heading: validatedHeading,
      accuracy,
      battery: lastBatteryLevel,
      confidence: 1 - (accuracy / 100),
      timestamp: Date.now()
    };

    // Callback with high-accuracy position + device battery
    if (callback) {
      callback({
        lat,
        lng,
        speed: Math.round(validatedSpeed),
        heading: Math.round(validatedHeading),
        accuracy: Math.round(accuracy),
        battery: lastBatteryLevel,
        confidence: Math.round(lastValidPosition.confidence * 100) / 100,
        source: 'high-accuracy-gps'
      });
    }
  }

  // ===== ROUTE CACHING (Offline support) =====

  function cacheRoute(route) {
    try {
      routeCache = {
        route,
        cached: Date.now(),
        bounds: calculateRouteBounds(route)
      };

      // Store in localStorage for offline use
      localStorage.setItem('ridesync_cached_route', JSON.stringify({
        legs: route.legs.map(leg => ({
          steps: leg.steps.map(step => ({
            instructions: step.instructions,
            distance: step.distance,
            duration: step.duration,
            path: step.path.map(p => ({ lat: p.lat, lng: p.lng }))
          }))
        })),
        timestamp: Date.now()
      }));
    } catch (e) {
      console.warn('Cache error:', e);
    }
  }

  function getCachedRoute() {
    if (routeCache) return routeCache.route;

    try {
      const cached = localStorage.getItem('ridesync_cached_route');
      if (cached) {
        const data = JSON.parse(cached);
        if (Date.now() - data.timestamp < 3600000) { // 1 hour TTL
          return data;
        }
      }
    } catch (e) {
      console.warn('Cache read error:', e);
    }

    return null;
  }

  function calculateRouteBounds(route) {
    let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;

    if (route.legs) {
      route.legs.forEach(leg => {
        if (leg.steps) {
          leg.steps.forEach(step => {
            if (step.path) {
              step.path.forEach(point => {
                minLat = Math.min(minLat, point.lat);
                maxLat = Math.max(maxLat, point.lat);
                minLng = Math.min(minLng, point.lng);
                maxLng = Math.max(maxLng, point.lng);
              });
            }
          });
        }
      });
    }

    return { minLat, maxLat, minLng, maxLng };
  }

  // ===== UTILITY FUNCTIONS =====

  function haversineDistance(lat1, lng1, lat2, lng2) {
    const R = 6371000; // meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  function calculateBearing(lat1, lng1, lat2, lng2) {
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const y = Math.sin(dLng) * Math.cos(lat2 * Math.PI / 180);
    const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
              Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLng);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  // ===== PUBLIC API =====

  return {
    startHighAccuracyTracking,
    snapToRoad,
    predictNextPosition,
    validateSpeed,
    cacheRoute,
    getCachedRoute,
    getPositionHistory: () => positionHistory,
    getLastValidPosition: () => lastValidPosition,
    getSpeedHistory: () => speedHistory,
    getHeadingHistory: () => headingHistory,
    isActive: () => isHighAccuracyMode,
    stop: () => {
      isHighAccuracyMode = false;
      positionHistory = [];
      speedHistory = [];
      headingHistory = [];
    }
  };
})();

// Make available globally
window.HighAccuracyGPS = HighAccuracyGPS;
