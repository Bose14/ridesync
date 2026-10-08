/**
 * RideSync Enhanced Features
 * - Smooth Location Animations
 * - Intelligent Re-center with Auto-zoom
 * - Google Maps Journey Mode
 * - Location Follow with Smart Pan
 * - Performance Optimizations
 * - Bug Fixes
 */

const RideSyncEnhancements = (function () {
  let markerAnimations = {}; // Track ongoing animations
  let journeyModeActive = false;
  let lastFollowUpdateTime = 0;
  const FOLLOW_UPDATE_INTERVAL = 100; // ms between follow updates
  let autoPanEnabled = true;
  let isJourneyModeSetup = false;

  // ===== SMOOTH MARKER ANIMATIONS =====

  function smoothAnimateMarker(marker, fromLat, fromLng, toLat, toLng, duration = 500) {
    if (!marker || !state.map) return Promise.resolve();

    return new Promise((resolve) => {
      const startTime = Date.now();
      const startLat = fromLat;
      const startLng = fromLng;
      const deltaLat = toLat - startLat;
      const deltaLng = toLng - startLng;

      const animateStep = () => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);

        // Easing function (easeInOutQuad for smooth deceleration)
        const easeProgress = progress < 0.5
          ? 2 * progress * progress
          : -1 + (4 - 2 * progress) * progress;

        const currentLat = startLat + deltaLat * easeProgress;
        const currentLng = startLng + deltaLng * easeProgress;

        if (marker && marker.setLatLng) {
          marker.setLatLng([currentLat, currentLng]);
        }

        if (progress < 1) {
          requestAnimationFrame(animateStep);
        } else {
          // Ensure final position is exact
          if (marker && marker.setLatLng) {
            marker.setLatLng([toLat, toLng]);
          }
          resolve();
        }
      };

      animateStep();
    });
  }

  function updateRiderMarkerSmooth(riderId, oldLat, oldLng, newLat, newLng) {
    if (!state.riderMarkers[riderId]) return;

    const marker = state.riderMarkers[riderId];
    if (!marker) return;

    // Calculate distance to determine animation duration
    const distance = PayanamMaps.haversine(oldLat, oldLng, newLat, newLng);
    const speed = Math.max(10, distance * 3600); // Estimate speed
    const duration = Math.max(200, Math.min(1000, (distance / (speed / 3.6)) * 1000));

    smoothAnimateMarker(marker, oldLat, oldLng, newLat, newLng, duration);
  }

  // ===== ENHANCED RE-CENTER FUNCTIONALITY =====

  function smartRecenter(riderLocation = null, options = {}) {
    if (!state.map) return;

    const defaults = {
      duration: 1000,
      zoom: null,
      enableFollow: true,
      showFeedback: true,
      smooth: true
    };

    const config = { ...defaults, ...options };

    try { state.map.invalidateSize(); } catch (e) {}

    const activeUser = PayanamDB.getActiveUser();
    const targetRider = riderLocation ||
      (state.riders || []).find(r => r.isMe || (activeUser && r.id === activeUser.id)) ||
      (state.riders || [])[0];

    if (!targetRider || !targetRider.lat || !targetRider.lng) {
      console.warn('[RideSync] No valid rider location for re-center');
      return;
    }

    let targetZoom = config.zoom;
    if (!targetZoom) {
      // Intelligent zoom based on context
      if (state.riders.length > 2) {
        targetZoom = 16; // Group view
      } else {
        targetZoom = 18.5; // Close-up street level
      }
    }

    // Use flyTo for smooth camera movement
    state.map.flyTo(
      [targetRider.lat, targetRider.lng],
      targetZoom,
      {
        duration: config.duration / 1000,
        easeLinearity: 0.25
      }
    );

    if (config.enableFollow) {
      state.isNavFollowMode = true;
      autoPanEnabled = true;
    }

    updateRecenterButtonUI();

    if (config.showFeedback) {
      showToast(`🎯 Following ${targetRider.name}`, 'success');
    }

    return targetRider;
  }

  function updateRecenterButtonSmartly() {
    const btn = document.getElementById('btnRecenterHud');
    if (!btn) return;

    if (state.isNavFollowMode && autoPanEnabled) {
      btn.classList.add('active-follow');
      btn.classList.remove('needs-recenter');
      btn.innerHTML = '🎯 Ride View';
      btn.style.opacity = '1';
    } else {
      btn.classList.remove('active-follow');
      btn.classList.add('needs-recenter');
      btn.innerHTML = '🎯 Recenter';
      btn.style.opacity = '0.7';
    }
  }

  // ===== GOOGLE MAPS JOURNEY MODE =====

  function initializeJourneyMode() {
    if (isJourneyModeSetup) return;

    const ride = state.currentRide;
    if (!ride || !ride.waypoints || ride.waypoints.length < 2) {
      console.warn('[Journey Mode] No valid waypoints for journey mode');
      return;
    }

    // Setup journey-specific UI
    setupJourneyHeader(ride);
    setupJourneyControls();
    setupJourneyRoutePreview(ride);

    isJourneyModeSetup = true;
    journeyModeActive = true;

    return ride;
  }

  function setupJourneyHeader(ride) {
    const header = document.getElementById('liveNavBanner');
    if (!header) return;

    const startPoint = ride.waypoints[0]?.name || 'Start';
    const endPoint = ride.waypoints[ride.waypoints.length - 1]?.name || 'Destination';
    const distance = ride.distanceKm || 0;
    const duration = ride.durationHours || 0;

    header.innerHTML = `
      <div class="journey-mode-header" style="display:flex; justify-content:space-between; align-items:center; padding:8px 12px; background:rgba(255,107,0,0.1); border-bottom:2px solid var(--primary-orange);">
        <div style="flex:1;">
          <div style="font-size:11px; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.5px;">🏍️ JOURNEY MODE</div>
          <div style="font-size:12px; font-weight:700; color:var(--text-primary); margin-top:2px;">
            ${startPoint} → ${endPoint}
          </div>
        </div>
        <div style="text-align:right; font-size:11px; color:var(--text-secondary);">
          <div>📍 ${distance.toFixed(1)} km</div>
          <div>⏱️ ~${Math.round(duration)}h</div>
        </div>
      </div>
    `;
  }

  function setupJourneyControls() {
    const controlsContainer = document.querySelector('.gmaps-hud-buttons');
    if (!controlsContainer) return;

    // Add journey mode button if not present
    if (!document.getElementById('btnJourneyMode')) {
      const btn = document.createElement('button');
      btn.id = 'btnJourneyMode';
      btn.className = 'gmaps-hud-btn';
      btn.innerHTML = '🗺️ Route';
      btn.title = 'Show Journey Route Overview';
      btn.onclick = () => toggleJourneyRouteOverview();
      controlsContainer.appendChild(btn);
    }

    // Add next waypoint button if not present
    if (!document.getElementById('btnNextWaypoint')) {
      const btn = document.createElement('button');
      btn.id = 'btnNextWaypoint';
      btn.className = 'gmaps-hud-btn';
      btn.innerHTML = '⛳ Next';
      btn.title = 'Navigate to Next Waypoint';
      btn.onclick = () => goToNextWaypoint();
      controlsContainer.appendChild(btn);
    }
  }

  function setupJourneyRoutePreview(ride) {
    const routePoints = ride.waypoints.map(w => [w.lat, w.lng]);
    if (routePoints.length < 2) return;

    // Draw journey route with different styling
    if (state.journeyRouteLayer) {
      try { state.map.removeLayer(state.journeyRouteLayer); } catch (e) {}
    }

    state.journeyRouteLayer = L.polyline(routePoints, {
      color: '#FF6B00',
      weight: 5,
      opacity: 0.8,
      lineCap: 'round',
      lineJoin: 'round',
      dashArray: '5, 10'  // Dashed for journey mode
    }).addTo(state.map);

    // Fit bounds to show entire route
    try {
      state.map.fitBounds(state.journeyRouteLayer.getBounds(), {
        padding: [50, 50],
        maxZoom: 15
      });
    } catch (e) {}
  }

  function toggleJourneyRouteOverview() {
    if (!state.map) return;

    const ride = state.currentRide;
    if (!ride || !ride.waypoints) return;

    // Zoom out to see full route
    const bounds = L.latLngBounds(
      ride.waypoints.map(w => [w.lat, w.lng])
    );

    state.map.fitBounds(bounds, {
      padding: [80, 80],
      maxZoom: 14,
      duration: 1
    });

    autoPanEnabled = false;
    updateRecenterButtonSmartly();
    showToast('📍 Route Overview - Tap Recenter to follow', 'info');
  }

  let currentWaypointIndex = 0;

  function goToNextWaypoint() {
    const ride = state.currentRide;
    if (!ride || !ride.waypoints) return;

    currentWaypointIndex = (currentWaypointIndex + 1) % ride.waypoints.length;
    const nextWaypoint = ride.waypoints[currentWaypointIndex];

    if (state.map) {
      state.map.flyTo([nextWaypoint.lat, nextWaypoint.lng], 17, {
        duration: 1.5,
        easeLinearity: 0.25
      });
    }

    showToast(`📍 Navigating to: ${nextWaypoint.name}`, 'success');
  }

  // ===== INTELLIGENT LOCATION FOLLOWING =====

  function startIntelligentLocationFollow() {
    autoPanEnabled = true;
    state.isNavFollowMode = true;

    const followLoop = setInterval(() => {
      if (!autoPanEnabled || !state.isNavFollowMode || !state.map) {
        clearInterval(followLoop);
        return;
      }

      const now = Date.now();
      if (now - lastFollowUpdateTime < FOLLOW_UPDATE_INTERVAL) return;
      lastFollowUpdateTime = now;

      const activeUser = PayanamDB.getActiveUser();
      const myRider = (state.riders || []).find(r => r.isMe || (activeUser && r.id === activeUser.id));

      if (myRider && myRider.lat && myRider.lng) {
        // Smooth pan to rider (not instant)
        state.map.panTo([myRider.lat, myRider.lng], {
          animate: true,
          duration: 0.5,
          easeLinearity: 0.1
        });
      }
    }, FOLLOW_UPDATE_INTERVAL);
  }

  function stopLocationFollow() {
    autoPanEnabled = false;
    updateRecenterButtonSmartly();
  }

  // ===== BUG FIXES =====

  // Fix: Prevent multiple GPS fix requests
  let lastGpsRequestTime = 0;
  function throttledGetCurrentPosition(callback, errorCallback, options = {}) {
    const now = Date.now();
    if (now - lastGpsRequestTime < 2000) {
      return; // Don't request more than every 2 seconds
    }
    lastGpsRequestTime = now;

    navigator.geolocation.getCurrentPosition(callback, errorCallback, {
      enableHighAccuracy: true,
      timeout: 5000,
      maximumAge: 0,
      ...options
    });
  }

  // Fix: Better location marker update without flickering
  function updateRiderLocationWithoutFlicker(riderId, newLat, newLng, speed, heading) {
    if (!state.riderMarkers[riderId]) return;

    const marker = state.riderMarkers[riderId];
    const currentLatLng = marker.getLatLng();

    // Only update if position changed significantly
    const distance = PayanamMaps.haversine(
      currentLatLng.lat,
      currentLatLng.lng,
      newLat,
      newLng
    );

    if (distance > 0.0001) { // ~10 meters
      updateRiderMarkerSmooth(riderId, currentLatLng.lat, currentLatLng.lng, newLat, newLng);
    }

    // Update heading/speed in popup without recreating
    const popupContent = `<strong>${state.riders.find(r => r.id === riderId)?.name}</strong><br>Speed: ${speed.toFixed(1)} km/h<br>Heading: ${heading}°`;
    if (marker.getPopup()) {
      marker.setPopupContent(popupContent);
    }
  }

  // Fix: Prevent map from scrolling when user didn't request it
  function disableAutoScroll() {
    if (state.map) {
      state.map.dragging.disable();
      setTimeout(() => {
        state.map.dragging.enable();
      }, 100);
    }
  }

  // ===== PERFORMANCE OPTIMIZATIONS =====

  // Debounce expensive re-renders
  let renderDebounceTimer = null;
  function debouncedRenderRiders() {
    clearTimeout(renderDebounceTimer);
    renderDebounceTimer = setTimeout(() => {
      renderRiderMarkers();
      renderRiderTelemetryCards();
    }, 50);
  }

  // Batch location updates
  let pendingLocationUpdates = [];
  function batchLocationUpdate(update) {
    pendingLocationUpdates.push(update);

    if (pendingLocationUpdates.length >= 3) {
      processBatchLocationUpdates();
    }
  }

  function processBatchLocationUpdates() {
    pendingLocationUpdates.forEach(update => {
      updateRiderLocationWithoutFlicker(
        update.riderId,
        update.lat,
        update.lng,
        update.speed,
        update.heading
      );
    });
    pendingLocationUpdates = [];
    debouncedRenderRiders();
  }

  // ===== PUBLIC API =====

  return {
    initializeJourneyMode,
    smartRecenter,
    updateRecenterButtonSmartly,
    startIntelligentLocationFollow,
    stopLocationFollow,
    updateRiderMarkerSmooth,
    updateRiderLocationWithoutFlicker,
    smoothAnimateMarker,
    throttledGetCurrentPosition,
    batchLocationUpdate,
    processBatchLocationUpdates,
    goToNextWaypoint,
    toggleJourneyRouteOverview,
    isJourneyModeActive: () => journeyModeActive,
    isFollowingEnabled: () => autoPanEnabled
  };
})();

// Make available globally
window.RideSyncEnhancements = RideSyncEnhancements;
