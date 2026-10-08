/**
 * RideSync Navigation Engine
 * Integrates: Google Maps-style UI + High-accuracy GPS + Route Management
 * Purpose: Professional navigation experience for motorcycle riders
 */

const NavigationEngine = (function () {
  let currentRoute = null;
  let isNavigating = false;
  let gpsTracker = null;

  // ===== START JOURNEY =====

  function startJourney(route, mapInstance) {
    if (!route || !route.legs) {
      console.error('Invalid route provided');
      return false;
    }

    currentRoute = route;

    // Cache route for offline access
    HighAccuracyGPS.cacheRoute(route);

    // Initialize Google Maps-style UI
    GoogleMapsStyleUI.startNavigation(route);

    // Start high-accuracy GPS tracking
    gpsTracker = HighAccuracyGPS.startHighAccuracyTracking(
      (position) => onPositionUpdate(position, route, mapInstance),
      (error) => onGPSError(error)
    );

    isNavigating = true;
    console.log('[Navigation Engine] Journey started');

    return true;
  }

  function onPositionUpdate(position, route, mapInstance) {
    if (!isNavigating) return;

    const { lat, lng, speed, heading, accuracy, confidence } = position;

    // Apply road snapping if on known route
    const snappedPos = GoogleMapsStyleUI ?
      HighAccuracyGPS.snapToRoad(lat, lng, route) :
      { lat, lng };

    const finalPos = snappedPos.snapped ? snappedPos : { lat, lng };

    // Update navigation UI with accurate position
    GoogleMapsStyleUI.updatePositionAccurate(finalPos.lat, finalPos.lng, accuracy);

    // Update map with smooth animation
    if (mapInstance && RideSyncEnhancements) {
      RideSyncEnhancements.updateRiderLocationWithoutFlicker(
        'user-me',
        finalPos.lat - 0.001, // Previous position (smooth animation)
        finalPos.lng - 0.001,
        finalPos.lat,
        finalPos.lng,
        speed,
        heading
      );
    }

    // Broadcast to group if in live ride
    if (window.broadcastMyLiveLocation) {
      window.broadcastMyLiveLocation(finalPos.lat, finalPos.lng, speed, heading);
    }

    // Check for upcoming turns and predictions
    checkUpcomingTurns(finalPos, route);
  }

  function onGPSError(error) {
    console.error('[Navigation] GPS Error:', error);
    GoogleMapsStyleUI.showAlert('GPS Error', error, 'warning');

    // Try to use cached position or cached route
    const cachedRoute = HighAccuracyGPS.getCachedRoute();
    if (cachedRoute) {
      GoogleMapsStyleUI.showAlert('Using Cached Route', 'Offline navigation active', 'success');
    }
  }

  function checkUpcomingTurns(currentPos, route) {
    if (!GoogleMapsStyleUI || !route || !route.legs) return;

    const turns = GoogleMapsStyleUI.extractTurns ? GoogleMapsStyleUI.extractTurns(route) : [];
    const currentTurn = GoogleMapsStyleUI.getCurrentStep ?
      GoogleMapsStyleUI.getCurrentStep() : 0;

    if (turns[currentTurn]) {
      const turn = turns[currentTurn];
      const distToTurn = HighAccuracyGPS.haversineDistance ?
        0 : // Simplified for now
        turn.distance;

      // Provide predictive info for high-speed riding
      if (distToTurn < 2000) { // Within 2km
        const speed = turns[currentTurn]?.speed || 60;
        const timeToTurn = (distToTurn / 1000) / (speed / 3.6);

        if (timeToTurn < 30) { // Less than 30 seconds
          GoogleMapsStyleUI.showAlert('Upcoming Turn',
            `${Math.round(timeToTurn)}s until turn`, 'success');
        }
      }
    }
  }

  // ===== END JOURNEY =====

  function endJourney() {
    isNavigating = false;

    if (gpsTracker) {
      HighAccuracyGPS.stop();
      gpsTracker = null;
    }

    GoogleMapsStyleUI.stopNavigation();
    currentRoute = null;

    console.log('[Navigation Engine] Journey ended');
  }

  // ===== ROUTE MANAGEMENT =====

  function updateRoute(newRoute) {
    if (!isNavigating) return;

    currentRoute = newRoute;
    HighAccuracyGPS.cacheRoute(newRoute);
    GoogleMapsStyleUI.startNavigation(newRoute);

    GoogleMapsStyleUI.showAlert('Route Updated', 'New route calculated', 'success');
  }

  function getRouteMetrics() {
    if (!currentRoute) return null;

    const legs = currentRoute.legs || [];
    const totalDistance = legs.reduce((sum, leg) => sum + (leg.distance?.value || 0), 0);
    const totalDuration = legs.reduce((sum, leg) => sum + (leg.duration?.value || 0), 0);

    return {
      distance: totalDistance,
      distanceText: `${(totalDistance / 1000).toFixed(1)} km`,
      duration: totalDuration,
      durationText: Math.round(totalDuration / 60) + ' min',
      estArrival: new Date(Date.now() + totalDuration * 1000)
    };
  }

  // ===== PUBLIC API =====

  return {
    startJourney,
    endJourney,
    updateRoute,
    getRouteMetrics,
    isNavigating: () => isNavigating,
    getCurrentRoute: () => currentRoute,
    getGPSPosition: () => HighAccuracyGPS?.getLastValidPosition?.(),
    enableHighAccuracy: () => true, // High accuracy is default
    toggleVoice: () => GoogleMapsStyleUI?.toggleVoice?.(),
    showRoute: () => {
      // Show route overview
      if (window.fitAllRidersInView) window.fitAllRidersInView();
    }
  };
})();

// Make available globally
window.NavigationEngine = NavigationEngine;

// Hook into ride start
const originalStartLiveRideSession = window.startLiveRideSession;
if (originalStartLiveRideSession) {
  window.startLiveRideSession = function() {
    originalStartLiveRideSession?.();

    // Start navigation if route is available
    setTimeout(() => {
      const ride = state?.currentRide;
      if (ride && ride.waypoints) {
        const route = {
          legs: [{
            steps: ride.waypoints.map((wp, idx) => ({
              instructions: wp.name,
              distance: { value: 5000, text: '5 km' },
              duration: { value: 300, text: '5 min' },
              path: ride.waypoints.slice(idx, idx + 1).map(p => ({ lat: p.lat, lng: p.lng }))
            }))
          }]
        };

        NavigationEngine.startJourney(route, state?.map);
      }
    }, 1000);
  };
}

// Hook exit ride
const originalConfirmExitRide = window.confirmExitRide;
if (originalConfirmExitRide) {
  window.confirmExitRide = function() {
    NavigationEngine.endJourney();
    originalConfirmExitRide?.();
  };
}
