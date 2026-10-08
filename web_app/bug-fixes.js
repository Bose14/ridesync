/**
 * RideSync Bug Fixes & Critical Improvements
 * Addresses all critical issues found in codebase analysis:
 * - Separation detection implementation
 * - Route deviation detection
 * - Animation stabilization
 * - Marker rendering optimization
 * - Error handling improvements
 * - Performance optimizations
 */

const RideSyncBugFixes = (function () {
  let lastSeparationCheckTime = 0;
  let lastDeviationCheckTime = 0;
  const SEPARATION_CHECK_INTERVAL = 1000; // Check every 1 second
  const DEVIATION_CHECK_INTERVAL = 2000; // Check every 2 seconds
  const SEPARATION_THRESHOLD_KM = 5; // Alert when > 5km apart
  const DEVIATION_THRESHOLD_M = 500; // Alert when > 500m from route

  // ===== FIX 1: SEPARATION DETECTION (CRITICAL) =====

  function detectRiderSeparations() {
    const now = Date.now();
    if (now - lastSeparationCheckTime < SEPARATION_CHECK_INTERVAL) return;
    lastSeparationCheckTime = now;

    if (!state.riders || state.riders.length < 2) return;

    const myRider = state.riders.find(r => r.isMe);
    if (!myRider) return;

    state.riders.forEach(rider => {
      if (rider.isMe || !rider.lat || !rider.lng) return;

      const distanceKm = calculateDistanceKm(
        myRider.lat, myRider.lng,
        rider.lat, rider.lng
      );

      const wasSeparated = rider.isSeparated || false;
      const isSeparated = distanceKm > SEPARATION_THRESHOLD_KM;

      // State changed
      if (isSeparated && !wasSeparated) {
        rider.isSeparated = true;
        showSeparationAlert(rider, distanceKm);
      } else if (!isSeparated && wasSeparated) {
        rider.isSeparated = false;
        closeSeparationAlert(rider);
      }

      rider.isSeparated = isSeparated;
    });
  }

  function showSeparationAlert(rider, distanceKm) {
    const alertId = `separation-${rider.id}`;

    // Only show once per rider per session
    if (document.getElementById(alertId)) return;

    const alertContainer = document.getElementById('liveAlertsContainer');
    if (!alertContainer) return;

    const alertHtml = `
      <div class="live-alert-banner separation-alert" id="${alertId}" style="
        background: linear-gradient(90deg, rgba(244,67,54,0.2), rgba(244,67,54,0.05));
        border-left: 4px solid #F44336;
        padding: 12px;
        margin: 8px 0;
        border-radius: 4px;
        display: flex;
        justify-content: space-between;
        align-items: center;
        animation: slideInDown 0.3s ease-out;
      ">
        <div style="flex:1;">
          <div style="font-weight:700; color:#F44336; font-size:13px;">🚨 SEPARATION ALERT</div>
          <div style="color:var(--text-secondary); font-size:11px; margin-top:2px;">
            ${rider.name} is ${distanceKm.toFixed(1)} km away - consider regrouping
          </div>
        </div>
        <button onclick="this.parentElement.remove()" style="background:none; border:none; color:#F44336; font-size:16px; cursor:pointer;">✕</button>
      </div>
    `;

    alertContainer.insertAdjacentHTML('beforeend', alertHtml);

    // Auto-remove after 10 seconds unless still separated
    setTimeout(() => {
      const el = document.getElementById(alertId);
      if (el && state.riders.find(r => r.id === rider.id && !r.isSeparated)) {
        el.remove();
      }
    }, 10000);

    // Play audio alert
    playAlertSound('warning');
    sendBrowserNotification('🚨 Rider Separated', `${rider.name} is ${distanceKm.toFixed(1)} km away`);
  }

  function closeSeparationAlert(rider) {
    const alertId = `separation-${rider.id}`;
    const alert = document.getElementById(alertId);
    if (alert) {
      alert.style.opacity = '0';
      alert.style.transition = 'opacity 0.3s';
      setTimeout(() => alert.remove(), 300);
    }
  }

  // ===== FIX 2: ROUTE DEVIATION DETECTION =====

  function detectRouteDeviation() {
    const now = Date.now();
    if (now - lastDeviationCheckTime < DEVIATION_CHECK_INTERVAL) return;
    lastDeviationCheckTime = now;

    if (!state.map || !state.routePolylineLayer || !state.riders) return;

    const myRider = state.riders.find(r => r.isMe);
    if (!myRider || !myRider.lat || !myRider.lng) return;

    const myPos = L.latLng(myRider.lat, myRider.lng);

    // Get route polyline points
    const routeLatLngs = state.routePolylineLayer.getLatLngs();
    if (!routeLatLngs || routeLatLngs.length < 2) return;

    // Find minimum distance to any point on route
    let minDistance = Infinity;
    for (let i = 0; i < routeLatLngs.length - 1; i++) {
      const dist = distancePointToLineSegment(
        myPos,
        routeLatLngs[i],
        routeLatLngs[i + 1]
      );
      minDistance = Math.min(minDistance, dist);
    }

    // Convert to meters
    const distanceMeters = minDistance * 1000;

    // Check if deviated
    const hasDeviated = distanceMeters > DEVIATION_THRESHOLD_M;
    const hadDeviation = document.getElementById('deviation-alert') ? true : false;

    if (hasDeviated && !hadDeviation) {
      showDeviationAlert(distanceMeters);
      playAlertSound('deviation');
    } else if (!hasDeviated && hadDeviation) {
      const alert = document.getElementById('deviation-alert');
      if (alert) alert.remove();
    }
  }

  function showDeviationAlert(distanceMeters) {
    const alertContainer = document.getElementById('liveAlertsContainer');
    if (!alertContainer || document.getElementById('deviation-alert')) return;

    const alertHtml = `
      <div class="live-alert-banner deviation-alert" id="deviation-alert" style="
        background: linear-gradient(90deg, rgba(255,152,0,0.2), rgba(255,152,0,0.05));
        border-left: 4px solid #FF9800;
        padding: 12px;
        margin: 8px 0;
        border-radius: 4px;
        display: flex;
        justify-content: space-between;
        align-items: center;
      ">
        <div style="flex:1;">
          <div style="font-weight:700; color:#FF9800; font-size:13px;">⚠️ OFF ROUTE</div>
          <div style="color:var(--text-secondary); font-size:11px; margin-top:2px;">
            You are ${distanceMeters.toFixed(0)}m away from planned route
          </div>
        </div>
        <button onclick="this.parentElement.remove()" style="background:none; border:none; color:#FF9800; font-size:16px; cursor:pointer;">✕</button>
      </div>
    `;

    alertContainer.insertAdjacentHTML('beforeend', alertHtml);
  }

  // Utility: Calculate distance from point to line segment
  function distancePointToLineSegment(point, lineStart, lineEnd) {
    const dx = lineEnd.lat - lineStart.lat;
    const dy = lineEnd.lng - lineStart.lng;
    const denom = dx * dx + dy * dy;

    if (denom === 0) {
      return point.distanceTo(lineStart) / 111139; // Convert meters to degrees
    }

    let t = ((point.lat - lineStart.lat) * dx + (point.lng - lineStart.lng) * dy) / denom;
    t = Math.max(0, Math.min(1, t));

    const closest = L.latLng(
      lineStart.lat + t * dx,
      lineStart.lng + t * dy
    );

    return point.distanceTo(closest) / 111139; // Convert to degrees
  }

  // ===== FIX 3: ANIMATION STABILIZATION =====

  // Use consistent panTo for all continuous updates
  function consistentMapPan(map, lat, lng, duration = 0.45) {
    if (!map || !lat || !lng) return;

    try {
      map.panTo([lat, lng], {
        animate: true,
        duration: duration,
        easeLinearity: 0.25,
        noMoveStart: true  // Don't trigger movestart event
      });
    } catch (e) {
      console.warn('[RideSync] Map pan error:', e);
    }
  }

  // Reserve flyTo only for manual recenter actions
  function recenterMapFly(map, lat, lng, zoom, duration = 1) {
    if (!map || !lat || !lng || !zoom) return;

    try {
      map.flyTo([lat, lng], zoom, {
        duration: duration,
        easeLinearity: 0.25
      });
    } catch (e) {
      console.warn('[RideSync] Map flyTo error:', e);
    }
  }

  // ===== FIX 4: MARKER RENDERING OPTIMIZATION =====

  // Cache marker icons to avoid recreation
  let markerIconCache = {};

  function getMarkerIcon(riderId, rider, isMe, isLead, isSeparated) {
    const cacheKey = `${riderId}_${isMe ? 1 : 0}_${isLead ? 1 : 0}_${isSeparated ? 1 : 0}`;

    if (markerIconCache[cacheKey]) {
      return markerIconCache[cacheKey];
    }

    const markerClass = isMe ? 'marker-me' : isLead ? 'marker-lead' : isSeparated ? 'marker-emergency' : '';
    const labelText = isMe ? `⭐ You (${rider.name})` : rider.name;
    const headingDeg = rider.heading || 0;
    const navBeam = isMe ? `
      <div class="nav-beam-container" style="transform: rotate(${headingDeg}deg);">
        <div class="nav-heading-cone"></div>
        <div class="nav-heading-arrow">▲</div>
      </div>
    ` : '';
    const pulseRing = isMe ? `<div class="user-location-pulse"></div>` : '';

    const iconHtml = `
      <div class="rider-bike-marker ${markerClass}">
        ${navBeam}
        ${pulseRing}
        <div class="marker-pin" style="border-color:${isMe ? '#00E5FF' : rider.avatarColor}; box-shadow:0 0 14px ${isMe ? 'rgba(0,229,255,0.95)' : rider.avatarColor + '80'}">
          <span>🏍️</span>
        </div>
        <div class="marker-label" style="border-left:3px solid ${isMe ? '#00E5FF' : rider.avatarColor}; ${isMe ? 'background:#00E5FF; color:#000; font-weight:800;' : ''}">${labelText}</div>
      </div>
    `;

    const icon = L.divIcon({
      html: iconHtml,
      className: '',
      iconSize: [40, 40],
      iconAnchor: [20, 20]
    });

    markerIconCache[cacheKey] = icon;
    return icon;
  }

  function optimizedRenderRiderMarkers() {
    const activeUser = PayanamDB.getActiveUser();

    state.riders.forEach(rider => {
      const isMe = rider.isMe || (activeUser && rider.id === activeUser.id);
      const isLead = rider.isLead;
      const isSeparated = rider.isSeparated || false;

      // Get cached icon (only creates if doesn't exist)
      const markerIcon = getMarkerIcon(rider.id, rider, isMe, isLead, isSeparated);

      if (!state.riderMarkers[rider.id]) {
        // Create new marker
        const marker = L.marker([rider.lat, rider.lng], {
          icon: markerIcon,
          zIndexOffset: isMe ? 1000 : 0
        }).addTo(state.map);

        marker.bindPopup(
          `<strong>${isMe ? '⭐ You (' + rider.name + ')' : rider.name}</strong><br>` +
          `${rider.bike}<br>` +
          `Speed: ${rider.speed.toFixed(1)} km/h<br>` +
          `Heading: ${rider.heading}°`
        );

        state.riderMarkers[rider.id] = marker;
      } else {
        // Update existing marker: position only, icon from cache
        const marker = state.riderMarkers[rider.id];
        marker.setLatLng([rider.lat, rider.lng]);
        marker.setIcon(markerIcon);

        if (isMe) marker.setZIndexOffset(1000);

        // Update popup content without recreating
        const currentPopup = marker.getPopup();
        if (currentPopup) {
          currentPopup.setContent(
            `<strong>${isMe ? '⭐ You (' + rider.name + ')' : rider.name}</strong><br>` +
            `${rider.bike}<br>` +
            `Speed: ${rider.speed.toFixed(1)} km/h<br>` +
            `Heading: ${rider.heading}°`
          );
        }
      }
    });
  }

  function clearMarkerIconCache() {
    markerIconCache = {};
  }

  // ===== FIX 5: ERROR HANDLING =====

  function safeGpsRefresh(callback, onError) {
    if (!navigator.geolocation) {
      console.warn('[RideSync] Geolocation not available');
      return false;
    }

    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          try {
            if (typeof callback === 'function') callback(pos);
          } catch (e) {
            console.error('[RideSync] Error in GPS callback:', e);
            if (typeof onError === 'function') onError(e);
          }
        },
        (err) => {
          console.warn('[RideSync] GPS error:', err.message);
          if (typeof onError === 'function') onError(err);
        },
        {
          enableHighAccuracy: true,
          timeout: 5000,
          maximumAge: 0
        }
      );
      return true;
    } catch (e) {
      console.error('[RideSync] Geolocation error:', e);
      return false;
    }
  }

  // ===== FIX 6: PERFORMANCE - DOM BATCHING =====

  let pendingRenderCall = null;

  function batchedRenderRiders() {
    if (pendingRenderCall) return; // Already scheduled

    pendingRenderCall = requestAnimationFrame(() => {
      optimizedRenderRiderMarkers();
      pendingRenderCall = null;
    });
  }

  // ===== FIX 7: VALIDATION HELPERS =====

  function validateCoordinates(lat, lng) {
    return (
      typeof lat === 'number' && typeof lng === 'number' &&
      !isNaN(lat) && !isNaN(lng) &&
      lat >= -90 && lat <= 90 &&
      lng >= -180 && lng <= 180
    );
  }

  function getValidRiderLocation(rider, fallback = null) {
    if (rider && rider.lat && rider.lng && validateCoordinates(rider.lat, rider.lng)) {
      return { lat: rider.lat, lng: rider.lng };
    }

    if (fallback && validateCoordinates(fallback.lat, fallback.lng)) {
      return fallback;
    }

    return null;
  }

  // ===== FIX 8: SOUND/NOTIFICATION HELPERS =====

  function playAlertSound(type = 'warning') {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const frequency = type === 'warning' ? 800 : type === 'success' ? 1200 : 600;
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();

    oscillator.frequency.value = frequency;
    oscillator.type = 'sine';
    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.3);

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.3);
  }

  // ===== PUBLIC API =====

  return {
    detectRiderSeparations,
    detectRouteDeviation,
    showSeparationAlert,
    showDeviationAlert,
    consistentMapPan,
    recenterMapFly,
    getMarkerIcon,
    optimizedRenderRiderMarkers,
    batchedRenderRiders,
    clearMarkerIconCache,
    safeGpsRefresh,
    validateCoordinates,
    getValidRiderLocation,
    playAlertSound,
    SEPARATION_THRESHOLD_KM,
    DEVIATION_THRESHOLD_M
  };
})();

// Make available globally
window.RideSyncBugFixes = RideSyncBugFixes;

// Start detection loops when ride is live
function startBugFixDetectionLoops() {
  if (state.activeScreen !== 'screenLiveMap') return;

  setInterval(() => {
    RideSyncBugFixes.detectRiderSeparations();
  }, 1000);

  setInterval(() => {
    RideSyncBugFixes.detectRouteDeviation();
  }, 2000);
}

// Hook into live ride start
const originalStartLiveRideSession = window.startLiveRideSession;
window.startLiveRideSession = function() {
  originalStartLiveRideSession?.();
  setTimeout(startBugFixDetectionLoops, 500);
};
