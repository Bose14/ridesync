/* ====================================================================
   RideSync Application Coordinator & Realtime Telemetry Engine
   Integrates Database, Map Layers & OSRM Routing, Phone OTP Auth,
   Live Multi-Rider Telemetry, Separation Detection & Glove Controls
   ==================================================================== */

// Active Runtime State
const state = {
  activeScreen: 'screenHome',
  currentRideId: 'ride-kodai-2026',
  currentRide: null,
  riders: [],
  map: null,
  routePolylineLayer: null,
  riderMarkers: {},
  waypointMarkers: [],
  pinMarkers: [],
  customPins: [],
  alerts: [],
  isSimRunning: true,
  simInterval: null,
  isSheetExpanded: false,
  unreadMessagesCount: 0,
  themeMode: 'night'
};

// Simulation Rider Dynamics Data
let simStep = 0;
const simLeaderBase = { lat: 10.2380, lng: 77.4890, speed: 68.4, heading: 145 };

// App Initialization
document.addEventListener('DOMContentLoaded', () => {
  initAppClock();
  initThemeEngine();
  RideSyncAuth.init();
  loadCurrentRideFromDb();
  renderHomeScreen();
  renderHistoryScreen();
  renderSidePanelAccounts();

  // Always request Location & Notification permissions on launch
  requestPermissionsOnLaunch();
});

// -------------------------------------------------------------
// PERMISSION & REALTIME LOCATION ENGINE
// -------------------------------------------------------------
async function requestPermissionsOnLaunch() {
  // 1. Request Notification Permission
  if ('Notification' in window && Notification.permission !== 'granted' && Notification.permission !== 'denied') {
    try {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        showToast('🔔 Notifications enabled for group safety & SOS alerts!', 'success');
        sendBrowserNotification('Payanam Ready 🏍️', 'Location tracking and emergency alerts are active.');
      }
    } catch (e) {
      console.warn('Notification permission error:', e);
    }
  }

  // 2. Request Geolocation Access & Pinpoint User
  if ('geolocation' in navigator) {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        const accuracy = Math.round(position.coords.accuracy || 10);
        const speed = position.coords.speed !== null && position.coords.speed !== undefined ? Math.round(position.coords.speed * 3.6) : 0;

        console.log(`[Payanam GPS] Live Location Acquired: ${lat}, ${lng} (±${accuracy}m)`);
        state.userGps = { lat, lng, accuracy, speed };

        // Update active user's location in state
        const activeUser = PayanamDB.getActiveUser();
        const myRider = (state.riders || []).find(r => r.isMe || (activeUser && r.id === activeUser.id)) || (state.riders || [])[0];
        if (myRider) {
          myRider.lat = lat;
          myRider.lng = lng;
          myRider.speed = speed;
          myRider.lastSeen = 'Live GPS';
        }

        // Pinpoint map directly on user's GPS
        if (state.map) {
          state.map.setView([lat, lng], 16);
          renderRiderMarkers();
          renderRiderTelemetryCards();
        }

        // Update GPS Status Pill
        const gpsLabel = document.getElementById('gpsStatusLabel');
        if (gpsLabel) gpsLabel.innerText = `GPS ±${accuracy}m 🟢`;

        const headerSignal = document.querySelector('.signal-icon');
        if (headerSignal) headerSignal.innerHTML = `📍 GPS Live (±${accuracy}m)`;

        showToast(`📍 Live GPS Located: ${lat.toFixed(4)}, ${lng.toFixed(4)}`, 'success');
      },
      (err) => {
        console.warn('Geolocation initial prompt error/denied:', err.message);
        showToast('📍 Please allow location access to pinpoint your live motorcycle position', 'info');
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0
      }
    );
  }
}

// Send Real OS / Browser Notification
function sendBrowserNotification(title, body, icon = '🏍️') {
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(title, {
        body,
        icon: 'https://cdn-icons-png.flaticon.com/512/3721/3721619.png',
        badge: 'https://cdn-icons-png.flaticon.com/512/3721/3721619.png',
        vibrate: [200, 100, 200]
      });
    } catch (e) {
      console.warn('Could not dispatch OS notification:', e);
    }
  }
}

// -------------------------------------------------------------
// COCKPIT THEME ENGINE (Sunlight Day / OLED Night)
// -------------------------------------------------------------
function initThemeEngine() {
  const saved = localStorage.getItem('ridesync_theme_mode') || 'night';
  applyTheme(saved);
}

function toggleCockpitTheme() {
  const nextMode = state.themeMode === 'sunlight' ? 'night' : 'sunlight';
  applyTheme(nextMode);
  showToast(nextMode === 'sunlight' ? '☀️ Switched to High-Contrast Sunlight Day Mode' : '🌙 Switched to OLED Tactical Night Mode', 'info');
}

function applyTheme(mode) {
  state.themeMode = mode;
  localStorage.setItem('ridesync_theme_mode', mode);

  document.documentElement.setAttribute('data-theme', mode);
  document.body.classList.remove('dark-theme', 'sunlight-theme', 'night-theme');
  document.body.classList.add(mode + '-theme');

  const mapIconEl = document.getElementById('mapThemeIcon');
  if (mapIconEl) {
    mapIconEl.innerText = mode === 'sunlight' ? '☀️' : '🌙';
  }
}

function initAppClock() {
  const updateTime = () => {
    const clockEl = document.getElementById('statusClock');
    if (clockEl) {
      const now = new Date();
      clockEl.innerText = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    }
  };
  updateTime();
  setInterval(updateTime, 10000);
}

// Reload dynamic data across app after auth change or DB update
function reloadDynamicAppData() {
  loadCurrentRideFromDb();
  renderHomeScreen();
  renderHistoryScreen();
  renderSidePanelAccounts();
}

function loadCurrentRideFromDb(rideId) {
  const targetId = rideId || state.currentRideId;
  const ride = RideSyncDB.getRide(targetId) || RideSyncDB.getRides()[0];
  if (ride) {
    state.currentRideId = ride.id;
    state.currentRide = ride;
    syncRidersFromDb(ride);
  }
}

// Synchronize rider members from DB profiles
function syncRidersFromDb(ride) {
  const activeUser = RideSyncDB.getActiveUser();
  const dbProfiles = RideSyncDB.getProfiles();

  state.riders = (ride.members || []).map((m, idx) => {
    const profile = dbProfiles.find(p => p.id === m.userId) || {
      id: m.userId,
      name: 'Rider ' + (idx + 1),
      bikeModel: 'Motorcycle',
      avatar: 'R',
      avatarColor: '#FF6B00'
    };

    const isMe = profile.id === activeUser.id;
    const isLead = m.isLead || m.role === 'creator';

    // Position offsets along Kodaikanal ghat route
    const offsets = [
      { latOff: 0.0000, lngOff: 0.0000, speed: 68.4, heading: 145, dist: '0.0 km', status: 'riding', battery: 92 },
      { latOff: 0.0060, lngOff: 0.0040, speed: 65.0, heading: 142, dist: '0.8 km behind', status: 'riding', battery: 88 },
      { latOff: 0.0240, lngOff: 0.0230, speed: 0.0, heading: 140, dist: '2.4 km behind', status: 'stopped', battery: 74, isSeparated: true },
      { latOff: 0.0015, lngOff: 0.0015, speed: 66.2, heading: 144, dist: '0.3 km behind', status: 'riding', battery: 95 }
    ];
    const off = offsets[idx % offsets.length];

    return {
      id: profile.id,
      name: profile.name,
      phone: profile.phone,
      bike: profile.bikeModel,
      avatar: profile.avatar || profile.name[0],
      avatarColor: profile.avatarColor || '#FF6B00',
      isMe,
      isLead,
      role: m.role || 'rider',
      lat: (ride.startLat || 10.2380) + off.latOff,
      lng: (ride.startLng || 77.4890) + off.lngOff,
      speed: off.speed,
      heading: off.heading,
      status: off.status,
      distFromMe: isMe ? '0.0 km' : off.dist,
      battery: off.battery,
      lastSeen: 'Just now',
      isSeparated: !!off.isSeparated
    };
  });
}

// -------------------------------------------------------------
// NAVIGATION ENGINE
// -------------------------------------------------------------
function navigateTo(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const target = document.getElementById(screenId);
  if (target) target.classList.add('active');
  state.activeScreen = screenId;

  // Update bottom nav active state
  document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
  if (screenId === 'screenHome') document.getElementById('navHome')?.classList.add('active');
  else if (screenId === 'screenCreateRide') document.getElementById('navPlan')?.classList.add('active');
  else if (screenId === 'screenLiveMap') document.getElementById('navLive')?.classList.add('active');
  else if (screenId === 'screenHistory') document.getElementById('navHistory')?.classList.add('active');

  if (screenId === 'screenLiveMap') {
    initOrUpdateLiveMap();
    requestAnimationFrame(() => {
      if (state.map) state.map.invalidateSize();
    });
    setTimeout(() => {
      if (state.map) state.map.invalidateSize();
    }, 100);
    setTimeout(() => {
      if (state.map) state.map.invalidateSize();
    }, 300);
    setTimeout(() => {
      if (state.map) state.map.invalidateSize();
    }, 600);
  } else if (screenId === 'screenCreateRide') {
    renderRoutePlannerWaypoints();
  } else if (screenId === 'screenRideLobby') {
    renderRideLobby();
  }
}

// -------------------------------------------------------------
// HOME SCREEN RENDERING (Dynamic from DB)
// -------------------------------------------------------------
function renderHomeScreen() {
  const activeUser = RideSyncDB.getActiveUser();
  if (!activeUser) return;

  // User Greeting & Stats
  const greeting = document.querySelector('.user-greeting');
  if (greeting) greeting.innerHTML = `${activeUser.name} 👋`;

  const avatarInitial = document.querySelector('.avatar-initial');
  if (avatarInitial) avatarInitial.innerText = activeUser.avatar || activeUser.name[0];

  const statBike = document.getElementById('statCurrentBike');
  if (statBike) statBike.innerText = activeUser.bikeModel.split(' ')[0] + ' ' + (activeUser.bikeModel.split(' ')[1] || '');

  const statKm = document.getElementById('statTotalKm');
  if (statKm) statKm.innerText = (activeUser.totalKm || 0).toLocaleString();

  const statRides = document.getElementById('statGroupRides');
  if (statRides) statRides.innerText = activeUser.ridesCount || 0;

  // Active Rides from DB
  const rides = RideSyncDB.getRides();
  const activeRides = rides.filter(r => r.status === 'active' || r.status === 'planned');
  const pastRides = rides.filter(r => r.status === 'completed');

  const activeCountBadge = document.getElementById('badgeActiveCount');
  if (activeCountBadge) activeCountBadge.innerText = `${activeRides.length} active`;

  const activeContainer = document.getElementById('homeActiveRidesContainer');
  if (activeContainer) {
    if (activeRides.length === 0) {
      activeContainer.innerHTML = `
        <div class="empty-state-card" style="padding:24px; text-align:center; background:var(--bg-card); border-radius:var(--radius-md); border:1px dashed var(--border-subtle);">
          <p style="color:var(--text-secondary); margin-bottom:12px;">No active group rides right now.</p>
          <button class="btn btn-primary" onclick="navigateTo('screenCreateRide')">+ Create a New Ride</button>
        </div>`;
    } else {
      activeContainer.innerHTML = activeRides.map(ride => `
        <div class="ride-card active-ride-card" onclick="selectAndOpenRide('${ride.id}')">
          <div class="ride-card-header">
            <div>
              <span class="ride-tag upcoming">Starts Soon · ${ride.date || 'Today'}</span>
              <h3 class="ride-name">${ride.name}</h3>
            </div>
            <span class="ride-code-badge">${ride.code}</span>
          </div>
          
          <div class="ride-route-summary">
            <div class="route-point">
              <span class="dot start"></span>
              <span>${ride.startAddress || 'Start Point'}</span>
            </div>
            <div class="route-line-connector"></div>
            <div class="route-point">
              <span class="dot end"></span>
              <span>${ride.destAddress || 'Destination'}</span>
            </div>
          </div>

          <div class="ride-card-footer">
            <div class="rider-avatar-stack">
              ${(ride.members || []).map(m => {
                const p = RideSyncDB.getProfile(m.userId);
                return `<div class="avatar-sm" style="background:${p?.avatarColor || '#FF6B00'}" title="${p?.name || 'Rider'}">${p?.avatar || p?.name?.[0] || 'R'}</div>`;
              }).join('')}
              <span class="rider-count-text">${ride.members?.length || 1} Riders Joined</span>
            </div>
            <div class="ride-meta">
              <span>📍 ${ride.distanceKm || 320} km</span>
              <span>⏱️ ~${ride.durationHours || 8} hrs</span>
            </div>
          </div>

          <button class="btn-enter-lobby" onclick="event.stopPropagation(); selectAndOpenRide('${ride.id}'); startLiveRideSession();">
            ENTER LIVE RIDE ⚡
          </button>
        </div>
      `).join('');
    }
  }

  // Recent Rides from DB
  const recentContainer = document.getElementById('homeRecentRidesContainer');
  if (recentContainer) {
    recentContainer.innerHTML = pastRides.slice(0, 2).map(ride => `
      <div class="ride-card past-ride" onclick="selectAndOpenSummary('${ride.id}')">
        <div class="ride-card-header">
          <div>
            <span class="ride-tag completed">Completed · ${ride.date}</span>
            <h3 class="ride-name">${ride.name}</h3>
          </div>
          <span class="ride-metric">${ride.distanceKm} km</span>
        </div>
        <p class="past-ride-sub">${ride.members?.length || 3} Riders · ${ride.waypoints?.length || 3} Stops · ${ride.durationHours} hrs</p>
      </div>
    `).join('');
  }
}

function selectAndOpenRide(rideId) {
  loadCurrentRideFromDb(rideId);
  navigateTo('screenRideLobby');
}

function selectAndOpenSummary(rideId) {
  loadCurrentRideFromDb(rideId);
  renderRideSummary();
  navigateTo('screenRideSummary');
}

// -------------------------------------------------------------
// ROUTE & STOP PLANNER (With Real OSRM Road Geometry Calculation)
// -------------------------------------------------------------
function renderRoutePlannerWaypoints() {
  const ride = state.currentRide;
  const container = document.getElementById('waypointList');
  if (!container || !ride) return;

  const waypoints = ride.waypoints || [];
  container.innerHTML = waypoints.map((wp, idx) => `
    <div class="waypoint-item" data-id="${wp.id}" data-index="${idx}" draggable="true">
      <span class="drag-handle" title="Hold & drag to reorder stop">☰</span>
      <span class="wp-icon">${wp.icon || '📍'}</span>
      <div class="wp-details">
        <span class="wp-name">${wp.name}</span>
        <span class="wp-type-badge ${wp.type || 'stop'}">${wp.type ? wp.type.toUpperCase() : 'STOP'}</span>
      </div>
      <div class="wp-actions">
        ${idx > 0 && idx < waypoints.length - 1 ? `
          <button class="wp-order-btn" onclick="moveStop(${idx}, -1)" title="Move Up">▲</button>
          <button class="wp-order-btn" onclick="moveStop(${idx}, 1)" title="Move Down">▼</button>
        ` : ''}
        ${waypoints.length > 2 ? `<button class="btn-remove-stop" onclick="removeStop(${wp.id})" title="Remove Stop">✕</button>` : ''}
      </div>
    </div>
  `).join('');

  attachWaypointDragAndDrop(container);
  calculateAndDisplayRouteStats(waypoints);
}

function attachWaypointDragAndDrop(container) {
  let draggedIndex = null;
  const items = container.querySelectorAll('.waypoint-item');

  items.forEach(item => {
    item.addEventListener('dragstart', (e) => {
      draggedIndex = parseInt(item.getAttribute('data-index'));
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', draggedIndex);
      item.classList.add('is-dragging');
    });

    item.addEventListener('dragend', () => {
      item.classList.remove('is-dragging');
      items.forEach(el => el.classList.remove('drag-over-above', 'drag-over-below'));
    });

    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const targetIndex = parseInt(item.getAttribute('data-index'));
      if (draggedIndex === null || draggedIndex === targetIndex) return;

      items.forEach(el => el.classList.remove('drag-over-above', 'drag-over-below'));
      if (targetIndex < draggedIndex) {
        item.classList.add('drag-over-above');
      } else {
        item.classList.add('drag-over-below');
      }
    });

    item.addEventListener('dragleave', () => {
      item.classList.remove('drag-over-above', 'drag-over-below');
    });

    item.addEventListener('drop', (e) => {
      e.preventDefault();
      const targetIndex = parseInt(item.getAttribute('data-index'));
      if (draggedIndex !== null && draggedIndex !== targetIndex) {
        reorderWaypoints(draggedIndex, targetIndex);
      }
    });
  });
}

function reorderWaypoints(fromIdx, toIdx) {
  if (!state.currentRide || !state.currentRide.waypoints) return;
  const waypoints = state.currentRide.waypoints;
  if (fromIdx < 0 || fromIdx >= waypoints.length || toIdx < 0 || toIdx >= waypoints.length) return;

  const [movedItem] = waypoints.splice(fromIdx, 1);
  waypoints.splice(toIdx, 0, movedItem);

  RideSyncDB.saveWaypoints(state.currentRide.id, waypoints);
  renderRoutePlannerWaypoints();
  showToast(`🔄 Reordered: "${movedItem.name}" to stop #${toIdx + 1}`, 'success');
}

function moveStop(index, direction) {
  const newIndex = index + direction;
  if (!state.currentRide || !state.currentRide.waypoints) return;
  const waypoints = state.currentRide.waypoints;
  if (newIndex < 0 || newIndex >= waypoints.length) return;

  reorderWaypoints(index, newIndex);
}

async function calculateAndDisplayRouteStats(waypoints) {
  const distanceEl = document.getElementById('routeTotalDistance');
  const durationEl = document.getElementById('routeTotalTime');

  if (!waypoints || waypoints.length < 2) return;

  const coords = waypoints.map(w => [w.lat, w.lng]);
  const roadData = await RideSyncMaps.fetchRoadRoute(coords);

  if (roadData) {
    if (distanceEl) distanceEl.innerText = `${roadData.distanceKm} km`;
    if (durationEl) {
      const hrs = Math.floor(roadData.durationMins / 60);
      const mins = roadData.durationMins % 60;
      durationEl.innerText = `${hrs} hrs ${mins} mins`;
    }
  }
}

function removeStop(wpId) {
  if (!state.currentRide) return;
  state.currentRide.waypoints = state.currentRide.waypoints.filter(w => w.id !== wpId);
  RideSyncDB.saveWaypoints(state.currentRide.id, state.currentRide.waypoints);
  renderRoutePlannerWaypoints();
  showToast('🗑️ Stop removed from route', 'info');
}

function promptAddCustomStop() {
  const name = prompt('Enter stop / place name (e.g., Highway Petrol Pump or Chai Halt):');
  if (name && name.trim()) {
    const newWp = {
      id: Date.now(),
      name: name.trim(),
      type: 'custom',
      icon: '📍',
      lat: 10.2185 + (Math.random() * 0.05),
      lng: 77.4682 + (Math.random() * 0.05),
      plannedDuration: 15
    };
    state.currentRide.waypoints.splice(state.currentRide.waypoints.length - 1, 0, newWp);
    RideSyncDB.saveWaypoints(state.currentRide.id, state.currentRide.waypoints);
    renderRoutePlannerWaypoints();
    showToast(`✅ Added "${name}" to route!`, 'success');
  }
}

function saveAndProceedToLobby() {
  const name = document.getElementById('inputRideName')?.value.trim() || 'Motorcycle Group Ride';
  const date = document.getElementById('inputRideDate')?.value || '2026-10-10';
  const time = document.getElementById('inputRideTime')?.value || '05:00';

  RideSyncDB.updateRide(state.currentRide.id, {
    name,
    date,
    time
  });

  loadCurrentRideFromDb(state.currentRide.id);
  showToast('💾 Ride plan saved!', 'success');
  navigateTo('screenRideLobby');
}

// -------------------------------------------------------------
// RIDE LOBBY SCREEN (Dynamic from DB)
// -------------------------------------------------------------
function renderRideLobby() {
  const ride = state.currentRide;
  if (!ride) return;

  const titleEl = document.getElementById('lobbyRideTitle');
  if (titleEl) titleEl.innerText = ride.name;

  const codeEl = document.getElementById('lobbyRideCode');
  if (codeEl) codeEl.innerText = ride.code;

  const inviteEl = document.getElementById('lobbyInviteLink');
  if (inviteEl) inviteEl.innerText = `ridesync.app/join/${ride.code}`;

  const dateTimeEl = document.getElementById('lobbyRideDateTime');
  if (dateTimeEl) dateTimeEl.innerText = `${ride.date || 'Today'} · ${ride.time || '05:00'} Departure`;

  const ridersListContainer = document.getElementById('lobbyRiderListContainer');
  const countHeader = document.getElementById('lobbyRidersCountHeader');
  const readyBadge = document.getElementById('lobbyReadyBadge');

  if (ridersListContainer) {
    const dbProfiles = RideSyncDB.getProfiles();
    const members = ride.members || [];
    const readyCount = members.filter(m => m.status === 'ready').length;

    if (countHeader) countHeader.innerText = `Riders Joined (${members.length})`;
    if (readyBadge) readyBadge.innerText = `${readyCount} Ready`;

    ridersListContainer.innerHTML = members.map(m => {
      const p = dbProfiles.find(prof => prof.id === m.userId) || {
        name: 'Rider',
        bikeModel: 'Motorcycle',
        avatar: 'R',
        avatarColor: '#FF6B00'
      };
      const isReady = m.status === 'ready';

      return `
        <div class="lobby-rider-card">
          <div class="avatar-ring ${isReady ? 'is-ready' : 'is-not-ready'}" style="border-color:${p.avatarColor || '#FF6B00'}">
            <span>${p.avatar || p.name[0]}</span>
          </div>
          <div class="rider-info">
            <span class="rider-name">${p.name} ${m.isLead || m.role === 'creator' ? '(Lead / Creator)' : ''}</span>
            <span class="rider-bike">${p.bikeModel}</span>
          </div>
          <span class="status-pill ${isReady ? 'ready' : 'not-ready'}">${isReady ? 'Ready' : 'Joined'}</span>
        </div>
      `;
    }).join('');
  }
}

function startLiveRideSession() {
  navigateTo('screenLiveMap');
  showToast('🚀 Ride Started! GPS Telemetry Broadcasting Live', 'success');
}

function shareRideCode() {
  const code = state.currentRide?.code || 'KODAI26';
  if (navigator.clipboard) {
    navigator.clipboard.writeText(`Join my motorcycle ride on RideSync! Invite Code: ${code}`);
  }
  showToast(`📋 Copied Ride Code "${code}" to clipboard!`, 'success');
}

function copyInviteLink() {
  shareRideCode();
}

// -------------------------------------------------------------
// LIVE MAP ENGINE (Leaflet & Telemetry Simulation)
// -------------------------------------------------------------
async function initOrUpdateLiveMap() {
  const mapContainer = document.getElementById('liveRideMap');
  if (!mapContainer) return;

  const ride = state.currentRide || PayanamDB.getRides()[0];
  const centerLat = ride.waypoints?.[0]?.lat || 10.2380;
  const centerLng = ride.waypoints?.[0]?.lng || 77.4890;

  if (!state.map) {
    state.map = L.map('liveRideMap', {
      zoomControl: false,
      attributionControl: false,
      fadeAnimation: true,
      zoomAnimation: true
    }).setView([centerLat, centerLng], 13);

    // Attach active Tile Layer (Google Maps RoadMap by default)
    const cfg = PayanamDB.getMapConfig();
    PayanamMaps.attachTileLayer(state.map, cfg.provider || 'google-roadmap');

    // Click on map to drop custom pin at clicked location
    state.map.on('click', (e) => {
      const lat = e.latlng.lat;
      const lng = e.latlng.lng;
      promptAddPinAtLocation(lat, lng);
    });
  } else {
    // Invalidate size on re-render
    try { state.map.invalidateSize(); } catch(e) {}
  }

  // Draw immediate fallback straight line so polyline is immediately visible
  if (ride.waypoints && ride.waypoints.length >= 2) {
    const coords = ride.waypoints.map(w => [w.lat, w.lng]);
    if (!state.routePolylineLayer) {
      state.routePolylineLayer = L.polyline(coords, {
        color: '#FF6B00',
        weight: 6,
        opacity: 0.9,
        lineCap: 'round',
        lineJoin: 'round'
      }).addTo(state.map);
    }
  }

  // Render Waypoint Markers & Live Dropped Pins
  renderMapWaypoints(ride.waypoints || []);
  renderMapPins(ride.pins || []);

  // Render Live Riders & Start Telemetry
  renderRiderMarkers();
  renderRiderTelemetryCards();
  if (!PayanamMaps.isGpsActive()) {
    startTelemetrySimulation();
  }

  // Ensure leaflet recalculates dimensions immediately
  setTimeout(() => {
    try { state.map.invalidateSize(); } catch(e) {}
  }, 100);

  // Fetch precision OSRM Road Geometry in the background (non-blocking)
  if (ride.waypoints && ride.waypoints.length >= 2) {
    const coords = ride.waypoints.map(w => [w.lat, w.lng]);
    PayanamMaps.fetchRoadRoute(coords).then(roadRoute => {
      if (roadRoute && roadRoute.latLngs && state.map) {
        // 1. Draw 200m Buffer Corridor (Translucent Orange)
        if (state.corridorLayer) state.map.removeLayer(state.corridorLayer);
        state.corridorLayer = L.polyline(roadRoute.latLngs, {
          color: '#FF6B00',
          weight: 18,
          opacity: 0.18,
          lineCap: 'round',
          lineJoin: 'round'
        }).addTo(state.map);

        // 2. Draw Sharp Center Polyline
        if (state.routePolylineLayer) state.map.removeLayer(state.routePolylineLayer);
        state.routePolylineLayer = L.polyline(roadRoute.latLngs, {
          color: '#FF6B00',
          weight: 6,
          opacity: 0.9,
          lineCap: 'round',
          lineJoin: 'round'
        }).addTo(state.map);

        // Update Navigation Banner with first maneuver
        if (roadRoute.steps && roadRoute.steps.length > 0) {
          state.navSteps = roadRoute.steps;
          updateNavBanner(roadRoute.steps[0], roadRoute.distanceKm);
        }
      }
    }).catch(err => console.warn('Background OSRM route fetch notice:', err));
  }
}

function updateNavBanner(step, totalDistance) {
  const instructionEl = document.getElementById('navInstructionText');
  const iconEl = document.getElementById('navManeuverIcon');
  const nextStopEl = document.getElementById('navNextStopCountdown');
  const speedEl = document.getElementById('navCurrentSpeed');

  if (instructionEl && step) {
    instructionEl.innerText = step.instruction || 'Follow planned motorcycle route corridor';
  }

  if (iconEl && step) {
    const mod = step.modifier || '';
    if (mod.includes('right')) iconEl.innerText = '↱';
    else if (mod.includes('left')) iconEl.innerText = '↰';
    else if (mod.includes('slight right')) iconEl.innerText = '↗';
    else if (mod.includes('slight left')) iconEl.innerText = '↖';
    else if (mod.includes('u-turn')) iconEl.innerText = '↩';
    else iconEl.innerText = '↑';
  }

  if (nextStopEl) {
    const nextWp = state.currentRide?.waypoints?.[1];
    nextStopEl.innerText = nextWp ? `${nextWp.icon || '📍'} Next: ${nextWp.name} (~${Math.round(totalDistance * 0.3)} km)` : `🏁 Destination in ${totalDistance} km`;
  }

  if (speedEl && state.riders[0]) {
    speedEl.innerText = `${Math.round(state.riders[0].speed)} km/h`;
  }
}

// -------------------------------------------------------------
// LIVE DEVICE GPS TRACKING & TOGGLE
// -------------------------------------------------------------
function toggleDeviceGps() {
  const label = document.getElementById('gpsStatusLabel');
  const icon = document.getElementById('gpsBtnIcon');

  if (!PayanamMaps.isGpsActive()) {
    const success = PayanamMaps.startLiveGpsTracking(state.map, (pos) => {
      // Update my rider coordinates in real-time
      if (state.riders[0]) {
        state.riders[0].lat = pos.lat;
        state.riders[0].lng = pos.lng;
        state.riders[0].speed = pos.speed || 0;
        state.riders[0].heading = pos.heading || 0;
        renderRiderMarkers();
        renderRiderTelemetryCards();
      }

      const speedEl = document.getElementById('navCurrentSpeed');
      if (speedEl) speedEl.innerText = `${Math.round(pos.speed)} km/h`;

      // Recenter on device GPS
      if (state.map) {
        state.map.panTo([pos.lat, pos.lng]);
      }
    }, (errMsg) => {
      showToast(`⚠️ GPS Error: ${errMsg}`, 'error');
    });

    if (success) {
      clearInterval(state.simInterval);
      if (label) label.innerText = 'LIVE GPS 🛰️';
      if (icon) icon.innerText = '🟢';
      showToast('🛰️ Connected to Live Device GPS Hardware!', 'success');
    }
  } else {
    PayanamMaps.stopLiveGpsTracking(state.map);
    if (label) label.innerText = 'LIVE SIM';
    if (icon) icon.innerText = '📡';
    startTelemetrySimulation();
    showToast('🔄 Switched back to Multi-Rider GPS Simulation', 'info');
  }
}

// -------------------------------------------------------------
// LIVE WEATHER / RAIN RADAR OVERLAY
// -------------------------------------------------------------
async function toggleRainRadarOverlay() {
  const active = await PayanamMaps.toggleRainRadar(state.map);
  const btn = document.getElementById('btnToggleRadar');
  if (btn) btn.style.background = active ? 'rgba(0, 229, 255, 0.3)' : '';
  showToast(active ? '🌧️ Live Weather Radar Tile Layer Active' : '⛅ Live Radar Disabled', active ? 'success' : 'info');
}

// -------------------------------------------------------------
// CYCLE MAP TILE LAYERS
// -------------------------------------------------------------
const mapProvidersList = ['google-roadmap', 'google-satellite', 'google-terrain', 'google-traffic', 'carto-dark', 'osm-standard', 'satellite-hybrid'];
let currentProviderIndex = 0;

function cycleMapLayer() {
  currentProviderIndex = (currentProviderIndex + 1) % mapProvidersList.length;
  const newProvider = mapProvidersList[currentProviderIndex];

  PayanamMaps.attachTileLayer(state.map, newProvider);
  const cfg = PayanamDB.getMapConfig();
  cfg.provider = newProvider;
  PayanamDB.setMapConfig(cfg);

  const readableNames = {
    'google-roadmap': 'Google Maps (RoadMap)',
    'google-satellite': 'Google Maps (Satellite Hybrid)',
    'google-terrain': 'Google Maps (Terrain)',
    'google-traffic': 'Google Maps (Live Traffic)',
    'carto-dark': 'Carto Dark Matter',
    'osm-standard': 'OpenStreetMap',
    'satellite-hybrid': 'ESRI Satellite'
  };

  showToast(`🗺️ Map Layer: ${readableNames[newProvider] || newProvider}`, 'info');
}

function promptAddPinAtLocation(lat, lng) {
  const title = prompt('Drop pin at clicked location (e.g. ☕ Tea Stall, ⛽ Petrol Bunk, ⚠️ Road Hazard):');
  if (title && title.trim()) {
    const activeUser = PayanamDB.getActiveUser();
    const pin = PayanamDB.addPin(state.currentRide.id, {
      userId: activeUser.id,
      type: 'custom',
      title: title.trim(),
      lat,
      lng
    });
    renderMapPins(state.currentRide.pins || []);
    showToast(`📍 Dropped pin "${title}" on map!`, 'success');
  }
}

function renderMapPins(pins) {
  if (!state.map) return;
  state.pinMarkers.forEach(m => state.map.removeLayer(m));
  state.pinMarkers = [];

  (pins || []).forEach(pin => {
    const iconHtml = `<div style="background:#00E5FF; color:#000; border-radius:50%; width:24px; height:24px; display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:800; box-shadow:0 0 10px rgba(0,229,255,0.8);">📍</div>`;
    const markerIcon = L.divIcon({ html: iconHtml, className: '', iconSize: [24, 24] });
    const marker = L.marker([pin.lat, pin.lng], { icon: markerIcon }).addTo(state.map);
    marker.bindPopup(`<strong>${pin.title}</strong><br><span style="font-size:11px; color:#94A3B8;">Dropped at ${pin.time || 'Live'}</span>`);
    state.pinMarkers.push(marker);
  });
}

function renderMapWaypoints(waypoints) {
  state.waypointMarkers.forEach(m => state.map.removeLayer(m));
  state.waypointMarkers = [];

  waypoints.forEach(wp => {
    const iconHtml = `<div class="wp-map-marker" style="background:#1E293B; border:2px solid #FF6B00; border-radius:50%; width:28px; height:28px; display:flex; align-items:center; justify-content:center; font-size:14px; box-shadow:0 0 10px rgba(0,0,0,0.8);">${wp.icon || '📍'}</div>`;
    const markerIcon = L.divIcon({ html: iconHtml, className: '', iconSize: [28, 28] });
    const marker = L.marker([wp.lat, wp.lng], { icon: markerIcon }).addTo(state.map);
    marker.bindPopup(`<strong>${wp.name}</strong><br><span style="color:#FF6B00">${wp.type.toUpperCase()} STOP</span>`);
    state.waypointMarkers.push(marker);
  });
}

function renderRiderMarkers() {
  const activeUser = PayanamDB.getActiveUser();
  state.riders.forEach(rider => {
    const isMe = rider.isMe || (activeUser && rider.id === activeUser.id);
    const isLead = rider.isLead;
    const isSeparated = rider.isSeparated;
    const markerClass = isMe ? 'marker-me' : isLead ? 'marker-lead' : isSeparated ? 'marker-emergency' : '';

    const labelText = isMe ? `⭐ You (${rider.name})` : rider.name;
    const pulseRing = isMe ? `<div class="user-location-pulse"></div>` : '';

    const iconHtml = `
      <div class="rider-bike-marker ${markerClass}">
        ${pulseRing}
        <div class="marker-pin" style="border-color:${isMe ? '#00E5FF' : rider.avatarColor}; box-shadow:0 0 14px ${isMe ? 'rgba(0,229,255,0.95)' : rider.avatarColor + '80'}">
          <span>${isMe ? '🏍️' : '🏍️'}</span>
        </div>
        <div class="marker-label" style="border-left:3px solid ${isMe ? '#00E5FF' : rider.avatarColor}; ${isMe ? 'background:#00E5FF; color:#000; font-weight:800;' : ''}">${labelText}</div>
      </div>
    `;

    const markerIcon = L.divIcon({ html: iconHtml, className: '', iconSize: [40, 40], iconAnchor: [20, 20] });

    if (!state.riderMarkers[rider.id]) {
      const marker = L.marker([rider.lat, rider.lng], { icon: markerIcon, zIndexOffset: isMe ? 1000 : 0 }).addTo(state.map);
      marker.bindPopup(`<strong>${isMe ? '⭐ You (' + rider.name + ')' : rider.name}</strong><br>${rider.bike}<br>Speed: ${rider.speed.toFixed(1)} km/h`);
      state.riderMarkers[rider.id] = marker;
    } else {
      state.riderMarkers[rider.id].setLatLng([rider.lat, rider.lng]);
      state.riderMarkers[rider.id].setIcon(markerIcon);
      if (isMe) state.riderMarkers[rider.id].setZIndexOffset(1000);
    }
  });
}

function renderRiderTelemetryCards() {
  const container = document.getElementById('riderCardsContainer');
  const titleEl = document.getElementById('bottomSheetTitle');
  
  const hasSeparation = state.riders.some(r => r.isSeparated);
  const activeCount = state.riders.filter(r => r.status === 'riding').length;

  if (titleEl) {
    titleEl.innerText = `Group Telemetry (${state.riders.length} Riders • ${activeCount} Riding)`;
  }

  if (!container) return;

  const dbProfiles = RideSyncDB.getProfiles();

  container.innerHTML = state.riders.map(rider => {
    const profile = dbProfiles.find(p => p.id === rider.id || p.name === rider.name) || {};
    const roleBadge = rider.isLead ? '👑 Lead' : (rider.role === 'admin' || rider.role === 'Sweeper') ? '🛡️ Sweeper' : '🏍️ Rider';
    const isStopped = rider.status === 'stopped';
    const isEmergency = rider.isSeparated || rider.status === 'emergency';

    return `
      <div class="telemetry-rider-card ${isEmergency ? 'is-emergency' : isStopped ? 'is-stopped' : ''}" onclick="centerMapOnRider('${rider.id}', ${rider.lat}, ${rider.lng})">
        <div class="telemetry-card-top">
          <div class="rider-avatar-block">
            <div class="avatar-ring ${isEmergency ? 'is-not-ready' : 'is-ready'}" style="border-color:${rider.avatarColor}; width:38px; height:38px; font-size:14px; font-weight:800;">
              <span>${rider.avatar}</span>
            </div>
            <div class="rider-name-block">
              <div class="rider-title-line">
                <span class="t-rider-name">${rider.name} ${rider.isMe ? '<strong style="color:var(--primary-orange);">(You)</strong>' : ''}</span>
                <span class="role-tag-pill ${rider.isLead ? 'lead' : ''}">${roleBadge}</span>
              </div>
              <span class="t-rider-bike">${rider.bike} • <span style="color:var(--text-muted);">${profile.bloodGroup || 'O+ve'}</span></span>
            </div>
          </div>

          <div class="telemetry-top-right">
            <span class="t-battery-badge">🔋 ${rider.battery}%</span>
            <span class="t-status-badge ${isEmergency ? 'danger' : isStopped ? 'warning' : 'success'}">
              <span class="status-pulse-dot"></span> ${isEmergency ? 'SOS ALERT' : isStopped ? 'STOPPED' : 'RIDING'}
            </span>
          </div>
        </div>

        <div class="telemetry-card-metrics">
          <div class="metric-box">
            <span class="m-val" style="color:var(--primary-orange);">${rider.speed.toFixed(1)}</span>
            <span class="m-unit">km/h</span>
            <span class="m-lbl">Speed</span>
          </div>

          <div class="metric-box">
            <span class="m-val ${isEmergency ? 'warn-txt' : ''}">${rider.distFromMe}</span>
            <span class="m-unit">formation</span>
            <span class="m-lbl">Gap</span>
          </div>

          <div class="metric-box">
            <span class="m-val" style="color:var(--accent-cyan);">${rider.heading.toFixed(0)}°</span>
            <span class="m-unit">bearing</span>
            <span class="m-lbl">Heading</span>
          </div>
        </div>

        ${profile.emergencyContactPhone ? `
          <div class="telemetry-card-footer">
            <span class="emergency-contact-text">Emergency Contact: <strong>${profile.emergencyContactName || 'Contact'}</strong></span>
            <a href="tel:${profile.emergencyContactPhone.replace(/[\s-]/g, '')}" class="btn-quick-call" onclick="event.stopPropagation()">
              📞 ${profile.emergencyContactPhone}
            </a>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
}

function centerMapOnRider(riderId, lat, lng) {
  if (state.map && lat && lng) {
    state.map.setView([lat, lng], 15);
    showToast(`🎯 Centered map on ${state.riders.find(r => r.id === riderId)?.name || 'rider'}`, 'info');
  }
}

// Live GPS Simulation Loop
function startTelemetrySimulation() {
  clearInterval(state.simInterval);
  state.simInterval = setInterval(() => {
    if (!state.isSimRunning) return;
    simStep += 0.0002;

    // Move leader and members along path
    state.riders.forEach((rider, idx) => {
      if (rider.status === 'riding') {
        rider.lat += Math.cos(simStep + idx) * 0.00015;
        rider.lng += Math.sin(simStep + idx) * 0.00015;
        rider.speed = Math.max(45, Math.min(85, rider.speed + (Math.random() * 4 - 2)));
      }
    });

    renderRiderMarkers();
    renderRiderTelemetryCards();
  }, 2500);
}

function toggleTelemetrySim() {
  state.isSimRunning = !state.isSimRunning;
  const icon = document.getElementById('simBtnIcon');
  if (icon) icon.innerText = state.isSimRunning ? '⏸️' : '▶️';
  showToast(state.isSimRunning ? '▶️ Telemetry Stream Active' : '⏸️ Telemetry Stream Paused', 'info');
}

let lastRecenterClickTime = 0;

// Recenter Map directly on User's Location
function recenterOnGroup() {
  if (!state.map) return;
  try { state.map.invalidateSize(); } catch(e) {}

  const now = Date.now();
  const isDoubleTap = (now - lastRecenterClickTime) < 2500;
  lastRecenterClickTime = now;

  const activeUser = PayanamDB.getActiveUser();
  const myRider = (state.riders || []).find(r => r.isMe || (activeUser && r.id === activeUser.id)) || (state.riders || [])[0];

  // If clicked consecutively, toggle to full group formation view
  if (isDoubleTap && state.riders && state.riders.length > 1) {
    const latLngs = state.riders.map(r => [r.lat, r.lng]);
    const bounds = L.latLngBounds(latLngs);
    state.map.fitBounds(bounds, { padding: [60, 60], maxZoom: 16, animate: true });
    showToast(`👥 Formation View (${state.riders.length} Riders)`, 'info');
    return;
  }

  // 1. Prioritize User's Exact GPS / Bike Location
  let targetLat = state.userGps?.lat;
  let targetLng = state.userGps?.lng;

  if (targetLat === undefined || targetLng === undefined) {
    if (myRider && typeof myRider.lat === 'number' && typeof myRider.lng === 'number') {
      targetLat = myRider.lat;
      targetLng = myRider.lng;
    }
  }

  if (typeof targetLat === 'number' && typeof targetLng === 'number') {
    state.map.flyTo([targetLat, targetLng], 16, {
      duration: 1.0,
      easeLinearity: 0.25
    });

    const userName = myRider?.name || activeUser?.name || 'You';
    const bikeModel = myRider?.bike || activeUser?.bikeModel || 'Motorcycle';
    showToast(`🎯 Centered on ${userName} (${bikeModel})`, 'success');

    // Query browser geolocation for fresh high-accuracy position
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition((pos) => {
        const liveLat = pos.coords.latitude;
        const liveLng = pos.coords.longitude;
        state.userGps = { lat: liveLat, lng: liveLng, accuracy: pos.coords.accuracy };
        if (myRider) {
          myRider.lat = liveLat;
          myRider.lng = liveLng;
        }
        renderRiderMarkers();
        renderRiderTelemetryCards();
      }, () => {}, { enableHighAccuracy: true, timeout: 4000 });
    }
    return;
  }

  // 2. Fallback to route bounds
  if (state.routePolylineLayer) {
    try {
      state.map.fitBounds(state.routePolylineLayer.getBounds(), { padding: [60, 60], maxZoom: 15, animate: true });
      showToast('🎯 Centered on Route Formation', 'info');
      return;
    } catch(e) {}
  }

  // 3. Fallback to start waypoint
  const ride = state.currentRide || PayanamDB.getRides()[0];
  if (ride && ride.waypoints && ride.waypoints[0]) {
    state.map.flyTo([ride.waypoints[0].lat, ride.waypoints[0].lng], 14, { duration: 1.0 });
    showToast('🎯 Centered on Route Start', 'info');
  }
}

function toggleSheetExpand() {
  const sheet = document.getElementById('ridersBottomSheet');
  if (sheet) {
    state.isSheetExpanded = !state.isSheetExpanded;
    sheet.classList.toggle('expanded', state.isSheetExpanded);
  }
}

function confirmExitRide() {
  if (confirm('End live riding session and view ride summary?')) {
    renderRideSummary();
    navigateTo('screenRideSummary');
  }
}

// -------------------------------------------------------------
// GLOVE-FRIENDLY QUICK ACTIONS (Tea, Fuel, Food, Photo, SOS)
// -------------------------------------------------------------
// -------------------------------------------------------------
// AUDIO BUZZER SYNTHESIZER ENGINE (Web Audio API & Vibration)
// -------------------------------------------------------------
let activeSosAudioCtx = null;
let activeSosOscillator = null;
let sosBuzzerInterval = null;

function playSosBuzzerSound() {
  stopSosBuzzerSound();
  try {
    const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtxClass) return;

    activeSosAudioCtx = new AudioCtxClass();
    if (activeSosAudioCtx.state === 'suspended') {
      activeSosAudioCtx.resume();
    }

    const osc = activeSosAudioCtx.createOscillator();
    const gain = activeSosAudioCtx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(960, activeSosAudioCtx.currentTime);
    gain.gain.setValueAtTime(0.7, activeSosAudioCtx.currentTime);

    osc.connect(gain);
    gain.connect(activeSosAudioCtx.destination);
    osc.start();

    activeSosOscillator = osc;

    // Rapid alternating dual-tone siren pulse (960Hz <-> 640Hz)
    let isHighTone = true;
    sosBuzzerInterval = setInterval(() => {
      if (!activeSosAudioCtx || !activeSosOscillator) return;
      isHighTone = !isHighTone;
      const freq = isHighTone ? 960 : 640;
      activeSosOscillator.frequency.setValueAtTime(freq, activeSosAudioCtx.currentTime);
    }, 180);

    if (navigator.vibrate) {
      navigator.vibrate([400, 150, 400, 150, 400, 150, 800]);
    }
  } catch (e) {
    console.warn('[RideSync Audio] Could not start emergency audio buzzer:', e);
  }
}

function stopSosBuzzerSound() {
  if (sosBuzzerInterval) {
    clearInterval(sosBuzzerInterval);
    sosBuzzerInterval = null;
  }
  if (activeSosOscillator) {
    try { activeSosOscillator.stop(); } catch (e) {}
    activeSosOscillator = null;
  }
  if (activeSosAudioCtx) {
    try { activeSosAudioCtx.close(); } catch (e) {}
    activeSosAudioCtx = null;
  }
}

function playWarningChimeSound() {
  try {
    const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtxClass) return;
    const ctx = new AudioCtxClass();
    if (ctx.state === 'suspended') ctx.resume();

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15); // A5

    gain.gain.setValueAtTime(0.4, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.4);

    if (navigator.vibrate) {
      navigator.vibrate([150, 80, 150]);
    }
  } catch (e) {}
}

// -------------------------------------------------------------
// GLOVE-FRIENDLY QUICK ACTIONS (Tea, Fuel, Food, Photo, SOS)
// -------------------------------------------------------------
function triggerQuickAction(type, title) {
  const activeUser = RideSyncDB.getActiveUser();
  const ride = state.currentRide;

  // Add custom pin to DB & map
  const pin = RideSyncDB.addPin(ride.id, {
    userId: activeUser.id,
    type,
    title,
    lat: state.riders[0]?.lat || 10.2380,
    lng: state.riders[0]?.lng || 77.4890
  });

  // Post message to group chat
  RideSyncDB.addMessage(ride.id, {
    senderId: activeUser.id,
    senderName: activeUser.name,
    type: 'action',
    text: `${activeUser.name} marked a ${title}`
  });

  showToast(`📍 Broadcasted ${title} to group!`, 'success');
}

function triggerSosEmergency() {
  const activeUser = RideSyncDB.getActiveUser();
  const ride = state.currentRide;

  // Broadcast SOS alert banner + Trigger Loud Siren Audio
  showAlertBanner('sos', `🚨 SOS: ${activeUser.name} triggered an Emergency Alert! Contact: ${activeUser.emergencyContactPhone || 'Active'}`, true);

  RideSyncDB.addMessage(ride.id, {
    senderId: activeUser.id,
    senderName: activeUser.name,
    type: 'action',
    text: `🚨 SOS EMERGENCY broadcasted by ${activeUser.name} at GPS location!`
  });

  showToast('🚨 SOS DISTRESS BROADCASTED TO ENTIRE GROUP!', 'error');
}

function copySosPhoneNumber(phone) {
  if (!phone) return;
  const cleanPhone = phone.trim();
  if (navigator.clipboard) {
    navigator.clipboard.writeText(cleanPhone);
  }
  showToast(`📋 Copied emergency contact: "${cleanPhone}" to clipboard!`, 'success');
}

function showAlertBanner(type, message, persistent = false, phoneNum = null) {
  const container = document.getElementById('liveAlertsContainer');
  if (!container) return;

  const alertId = 'alert-' + Date.now();
  const alertEl = document.createElement('div');
  alertEl.id = alertId;

  let boxClass = 'info-box';
  let icon = 'ℹ️';
  let alertTitle = 'System Alert';

  // Extract phone number from message if not explicitly provided
  let extractedPhone = phoneNum;
  if (!extractedPhone && (type === 'sos' || message.includes('Contact:'))) {
    const match = message.match(/(\+?\d[\d\s-]{8,}\d)/);
    if (match) extractedPhone = match[1].trim();
  }

  if (type === 'sos') {
    boxClass = 'sos-box';
    icon = '🚨';
    alertTitle = 'SOS EMERGENCY BROADCAST';
    playSosBuzzerSound(); // Trigger emergency siren buzzer audio tone
  } else if (type === 'separation') {
    boxClass = 'separation-box';
    icon = '⚠️';
    alertTitle = 'RIDER SEPARATION ALERT';
    playWarningChimeSound(); // Trigger warning chime sound
  } else if (type === 'deviation') {
    boxClass = 'deviation-box';
    icon = '🗺️';
    alertTitle = 'ROUTE CORRIDOR DEVIATION';
    playWarningChimeSound(); // Trigger warning chime sound
  } else if (type === 'pin') {
    boxClass = 'info-box';
    icon = '📍';
    alertTitle = 'CONVOY STOP PIN';
  }

  alertEl.className = `hud-notification-box ${boxClass}`;
  alertEl.innerHTML = `
    <div class="hud-box-header">
      <div class="hud-box-title-row">
        <span class="hud-box-icon">${icon}</span>
        <span class="hud-box-title">${alertTitle}</span>
      </div>
      <div style="display:flex; gap:6px; align-items:center;">
        ${type === 'sos' ? `<button class="hud-box-btn-mute" onclick="stopSosBuzzerSound(); this.innerText='🔇 Muted';" style="background:rgba(255,23,68,0.2); border:1px solid var(--accent-red); color:var(--text-primary); font-size:10px; font-weight:800; padding:2px 8px; border-radius:4px; cursor:pointer;">🔊 Mute Siren</button>` : ''}
        <button class="hud-box-btn-close" onclick="stopSosBuzzerSound(); document.getElementById('${alertId}').remove()" title="Dismiss notification">✕</button>
      </div>
    </div>
    <div class="hud-box-body">
      ${message}
    </div>
    ${extractedPhone ? `
      <div class="hud-sos-actions">
        <button class="btn-copy-phone" onclick="copySosPhoneNumber('${extractedPhone}')">
          📋 Copy Number: ${extractedPhone}
        </button>
        <a href="tel:${extractedPhone.replace(/[\s-]/g, '')}" class="btn-call-phone">
          📞 Call Now
        </a>
      </div>
    ` : ''}
    ${!persistent ? '<div class="hud-box-progress"></div>' : ''}
  `;

  container.appendChild(alertEl);

  // Dispatch OS / Browser Notification
  const title = type === 'sos' ? '🚨 EMERGENCY SOS DISTRESS' : type === 'deviation' ? '⚠️ ROUTE DEVIATION' : '⚠️ GROUP SEPARATION';
  sendBrowserNotification(title, message);

  if (!persistent) {
    setTimeout(() => {
      const el = document.getElementById(alertId);
      if (el) {
        el.style.opacity = '0';
        el.style.transform = 'translateY(-10px)';
        el.style.transition = 'all 0.25s ease';
        setTimeout(() => el.remove(), 250);
      }
    }, 6000);
  }
}

// -------------------------------------------------------------
// SIMULATOR CONTROLS (Separation, Deviation, Peer SOS)
// -------------------------------------------------------------
function simulateSeparationAlert() {
  const karthi = state.riders.find(r => r.name === 'Karthi');
  if (karthi) {
    karthi.isSeparated = true;
    karthi.status = 'stopped';
    karthi.speed = 0.0;
    karthi.distFromMe = '2.4 km behind';
  }
  showAlertBanner('separation', '⚠️ Karthi is 2.4 km behind the group (Stopped on Salem Bypass)');
  renderRiderMarkers();
  renderRiderTelemetryCards();
  showToast('⚠️ Separation Alert Broadcasted (40s debounce test)', 'error');
}

function simulateOffRouteAlert() {
  showAlertBanner('deviation', '⚠️ Bose drifted 240m off planned route corridor! Recalculating path...');
  showToast('⚠️ Route Deviation Corridor Triggered (>200m)', 'error');
}

function simulatePeerSos() {
  showAlertBanner('sos', '🚨 SOS: Arun reported a flat tire on ghat hairpin 12! Emergency Contact: Pooja (+91 98765 00002)', true);
  showToast('🚨 Peer SOS distress signal received!', 'error');
}

function resetSimNormal() {
  stopSosBuzzerSound(); // Stop any active emergency siren
  state.riders.forEach((r, idx) => {
    r.isSeparated = false;
    r.status = 'riding';
    r.speed = 65 + (idx * 2);
    r.distFromMe = idx === 0 ? '0.0 km' : `${(idx * 0.4).toFixed(1)} km behind`;
  });
  document.getElementById('liveAlertsContainer').innerHTML = '';
  renderRiderMarkers();
  renderRiderTelemetryCards();
  showToast('🔄 Group formation restored to normal', 'success');
}

// -------------------------------------------------------------
// CHAT MODAL & MESSAGING
// -------------------------------------------------------------
function toggleChatSheet() {
  openModal('modalChat');
  renderChatMessages();
}

function renderChatMessages() {
  const container = document.getElementById('chatMessages');
  const ride = state.currentRide;
  if (!container || !ride) return;

  const messages = ride.messages || [];
  container.innerHTML = messages.map(msg => {
    if (msg.type === 'system') {
      return `<div class="chat-msg system">${msg.text}</div>`;
    } else if (msg.type === 'action') {
      return `<div class="chat-msg action-event">${msg.text}</div>`;
    } else {
      const isMe = msg.senderId === RideSyncDB.getActiveUserId();
      return `
        <div class="chat-msg ${isMe ? 'me' : 'peer'}">
          <span class="msg-sender">${msg.senderName || 'Rider'}</span>
          <span class="msg-text">${msg.text}</span>
          <span class="msg-time">${msg.time || 'Now'}</span>
        </div>
      `;
    }
  }).join('');

  container.scrollTop = container.scrollHeight;
}

function sendQuickChat(text) {
  const activeUser = RideSyncDB.getActiveUser();
  const ride = state.currentRide;
  RideSyncDB.addMessage(ride.id, {
    senderId: activeUser.id,
    senderName: activeUser.name,
    text
  });
  renderChatMessages();
  showToast(`💬 Sent: "${text}"`, 'info');
}

function sendTextMessage() {
  const input = document.getElementById('chatInputText');
  const text = input?.value.trim();
  if (!text) return;

  const activeUser = RideSyncDB.getActiveUser();
  const ride = state.currentRide;
  RideSyncDB.addMessage(ride.id, {
    senderId: activeUser.id,
    senderName: activeUser.name,
    text
  });
  input.value = '';
  renderChatMessages();
}

// -------------------------------------------------------------
// SUMMARY & HISTORY SCREENS
// -------------------------------------------------------------
function renderRideSummary() {
  const ride = state.currentRide;
  if (!ride) return;

  const titleEl = document.getElementById('summaryRideTitle');
  if (titleEl) titleEl.innerText = ride.name;

  const distEl = document.getElementById('summaryDistanceVal');
  if (distEl) distEl.innerText = ride.distanceKm || '324.8';

  const stopsContainer = document.getElementById('summaryStopsContainer');
  if (stopsContainer && ride.waypoints) {
    stopsContainer.innerHTML = ride.waypoints.map((wp, idx) => `
      <div class="timeline-stop">
        <span class="stop-icon">${wp.icon || '📍'}</span>
        <div class="stop-info">
          <span class="stop-name">${wp.name}</span>
          <span class="stop-time">Stop #${idx + 1} · ${wp.type.toUpperCase()}</span>
        </div>
      </div>
    `).join('');
  }
}

function renderHistoryScreen() {
  const container = document.getElementById('historyListContainer');
  if (!container) return;

  const rides = RideSyncDB.getRides();
  container.innerHTML = rides.map(ride => `
    <div class="ride-card" onclick="selectAndOpenSummary('${ride.id}')">
      <div class="ride-card-header">
        <div>
          <span class="ride-tag ${ride.status}">${ride.status === 'completed' ? 'Completed' : 'Active'}</span>
          <h3 class="ride-name">${ride.name}</h3>
        </div>
        <span class="ride-metric">${ride.distanceKm} km</span>
      </div>
      <p class="past-ride-sub">${ride.members?.length || 4} Riders · ${ride.waypoints?.length || 3} Stops · ${ride.durationHours}h</p>
    </div>
  `).join('');
}

function shareRideSummary() {
  showToast('📤 Ride Summary card ready for WhatsApp & Instagram!', 'success');
}

// -------------------------------------------------------------
// MODALS & SETTINGS
// -------------------------------------------------------------
function openProfileModal() {
  const user = RideSyncDB.getActiveUser();
  if (!user) return;

  document.getElementById('profileModalAvatar').innerText = user.avatar || user.name[0];
  document.getElementById('profileModalName').innerText = user.name;
  document.getElementById('profileModalPhone').innerText = user.phoneFormatted || user.phone;
  document.getElementById('profileModalRole').innerText = user.roleDefault || 'Rider';

  document.getElementById('profileEditBike').value = user.bikeModel || '';
  document.getElementById('profileEditBlood').value = user.bloodGroup || 'O+ve';
  document.getElementById('profileEditKm').value = `${user.totalKm || 0} KM`;
  document.getElementById('profileEditEmergencyName').value = user.emergencyContactName || '';
  document.getElementById('profileEditEmergencyPhone').value = user.emergencyContactPhone || '';

  openModal('modalProfile');
}

function saveProfileChanges() {
  const user = RideSyncDB.getActiveUser();
  if (!user) return;

  const bike = document.getElementById('profileEditBike').value.trim();
  const blood = document.getElementById('profileEditBlood').value.trim();
  const emergencyName = document.getElementById('profileEditEmergencyName').value.trim();
  const emergencyPhone = document.getElementById('profileEditEmergencyPhone').value.trim();

  RideSyncDB.saveProfile({
    id: user.id,
    bikeModel: bike,
    bloodGroup: blood,
    emergencyContactName: emergencyName,
    emergencyContactPhone: emergencyPhone
  });

  closeModal('modalProfile');
  reloadDynamicAppData();
  showToast('💾 Profile changes saved in DB!', 'success');
}

function openJoinModal() {
  openModal('modalJoinRide');
}

function submitJoinRide() {
  const code = document.getElementById('inputJoinRideCode')?.value.trim();
  if (!code) {
    showToast('⚠️ Please enter a ride invite code', 'error');
    return;
  }

  const user = RideSyncDB.getActiveUser();
  const result = RideSyncDB.joinRide(code, user.id);

  if (result.success) {
    closeModal('modalJoinRide');
    loadCurrentRideFromDb(result.ride.id);
    showToast(`🎉 Joined "${result.ride.name}"!`, 'success');
    navigateTo('screenRideLobby');
  } else {
    showToast(`❌ ${result.error}`, 'error');
  }
}

function openDiscoveryModal() {
  openModal('modalPlaceDiscovery');
  renderPlaceDiscoveryList();
}

// Live geocoded search with Photon
let searchDebounceTimer = null;
function handlePlaceSearchInput(query) {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(async () => {
    if (!query || query.length < 2) {
      renderPlaceDiscoveryList();
      return;
    }
    const places = await RideSyncMaps.searchPlaces(query);
    const container = document.getElementById('placesList');
    if (container) {
      if (places.length === 0) {
        container.innerHTML = `<p style="padding:20px; text-align:center; color:var(--text-muted);">No locations found for "${query}".</p>`;
      } else {
        const existingNames = new Set((state.currentRide?.waypoints || []).map(w => w.name));
        container.innerHTML = places.map(p => {
          const isAdded = existingNames.has(p.name);
          return `
            <div class="place-card" onclick="${isAdded ? '' : `addDiscoveredPlace('${escapeQuotes(p.name)}', ${p.lat}, ${p.lng}, 'custom', '📍')`}">
              <div>
                <span class="place-name">${p.name}</span>
                <span class="place-dist">${p.subText}</span>
              </div>
              <button class="btn-add-place ${isAdded ? 'added' : ''}" ${isAdded ? 'disabled' : ''}>
                ${isAdded ? '✓ Added' : '+ Add'}
              </button>
            </div>
          `;
        }).join('');
      }
    }
  }, 400);
}

function openDiscoveryModal() {
  renderPlaceDiscoveryList();
  openModal('modalPlaceDiscovery');
}

function filterPlaceCategory(btnEl, category) {
  if (btnEl && btnEl.parentElement) {
    btnEl.parentElement.querySelectorAll('.cat-pill').forEach(b => b.classList.remove('active'));
    btnEl.classList.add('active');
  }
  state.activeDiscoveryFilter = category;
  renderPlaceDiscoveryList(category);
}

function renderPlaceDiscoveryList(filterCategory) {
  const container = document.getElementById('placesList');
  if (!container) return;

  const category = filterCategory || state.activeDiscoveryFilter || 'all';

  const defaultPlaces = [
    { name: 'Kodaikanal Lake & Boathouse', cat: 'Viewpoints', sub: 'Scenic halt · 1.2 km off route', type: 'photo', icon: '📸', lat: 10.2350, lng: 77.4900 },
    { name: 'Coaker\'s Walk Valley View', cat: 'Viewpoints', sub: 'On route · Panoramic cliff', type: 'photo', icon: '📸', lat: 10.2324, lng: 77.4947 },
    { name: 'Silver Cascade Waterfall', cat: 'Viewpoints', sub: 'On route · Photo Stop', type: 'photo', icon: '📸', lat: 10.2582, lng: 77.5186 },
    { name: 'Pillar Rocks Viewpoint', cat: 'Viewpoints', sub: '1.4 km off route · 400ft Pillar Rocks', type: 'photo', icon: '📍', lat: 10.2185, lng: 77.4682 },
    { name: 'Moir Point Valley Lookout', cat: 'Viewpoints', sub: 'On route · Valley & Ghat View', type: 'photo', icon: '📸', lat: 10.2150, lng: 77.4650 },
    { name: 'Highland Filter Tea & Spices', cat: 'Tea', sub: '0.3 km from route · Hot Chai', type: 'tea', icon: '☕', lat: 10.2450, lng: 77.5020 },
    { name: 'Hilltop Bakeries & Chai Halt', cat: 'Tea', sub: 'On route · Fresh Tea & Snacks', type: 'tea', icon: '☕', lat: 10.2380, lng: 77.4950 },
    { name: 'Ghat Road Filter Coffee', cat: 'Tea', sub: '1.1 km off route · Hot Coffee', type: 'tea', icon: '☕', lat: 10.2410, lng: 77.4980 },
    { name: 'Indian Oil Ghat Station', cat: 'Fuel', sub: 'On route · High altitude fuel', type: 'fuel', icon: '⛽', lat: 10.2600, lng: 77.5100 },
    { name: 'HP Fuel & Air Pump', cat: 'Fuel', sub: '0.5 km from route · 24/7 petrol & air', type: 'fuel', icon: '⛽', lat: 10.2500, lng: 77.5050 },
    { name: 'Bharat Petroleum Eco Station', cat: 'Fuel', sub: 'On route · EV Fast Charger & Fuel', type: 'fuel', icon: '⛽', lat: 10.2280, lng: 77.4850 },
    { name: 'Cloud 9 Highway Diner', cat: 'Food', sub: 'On route · South Indian Tiffin', type: 'food', icon: '🍴', lat: 10.2520, lng: 77.5080 },
    { name: 'Kodaikanal Valley Restaurant', cat: 'Food', sub: '0.8 km off route · Full Meals', type: 'food', icon: '🍴', lat: 10.2310, lng: 77.4910 },
    { name: 'Pine Forest Food Court', cat: 'Food', sub: 'On route · Quick Snacks & Maggi', type: 'food', icon: '🍴', lat: 10.2220, lng: 77.4720 }
  ];

  const filtered = category === 'all'
    ? defaultPlaces
    : defaultPlaces.filter(p => p.cat === category || (category === 'Viewpoints' && p.cat === 'Top Attractions'));

  const existingNames = new Set((state.currentRide?.waypoints || []).map(w => w.name));

  container.innerHTML = filtered.map(p => {
    const isAdded = existingNames.has(p.name);
    return `
      <div class="place-card" onclick="${isAdded ? '' : `addDiscoveredPlace('${escapeQuotes(p.name)}', ${p.lat}, ${p.lng}, '${p.type}', '${p.icon}')`}">
        <div>
          <span class="place-name">${p.name}</span>
          <span class="place-dist">${p.sub}</span>
        </div>
        <button class="btn-add-place ${isAdded ? 'added' : ''}" ${isAdded ? 'disabled' : ''}>
          ${isAdded ? '✓ Added' : '+ Add'}
        </button>
      </div>
    `;
  }).join('');
}

function addDiscoveredPlace(name, lat, lng, type, icon) {
  if (!state.currentRide) return;
  const newWp = {
    id: Date.now(),
    name,
    type: type || 'photo',
    icon: icon || '📍',
    lat,
    lng,
    plannedDuration: 20
  };
  state.currentRide.waypoints.splice(state.currentRide.waypoints.length - 1, 0, newWp);
  RideSyncDB.saveWaypoints(state.currentRide.id, state.currentRide.waypoints);
  renderRoutePlannerWaypoints();
  renderPlaceDiscoveryList();
  showToast(`✅ Added "${name}" to route!`, 'success');
}

function openConfigModal() {
  const cfg = RideSyncDB.getMapConfig();
  document.getElementById('cfgSupabaseUrl').value = cfg.supabaseUrl || '';
  document.getElementById('cfgSupabaseKey').value = cfg.supabaseAnonKey || '';
  document.getElementById('cfgGoogleKey').value = cfg.googleMapsApiKey || '';

  document.querySelectorAll('.provider-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.provider === (cfg.provider || 'carto-dark'));
  });

  openModal('modalConfig');
}

function selectMapProvider(btn, providerKey) {
  document.querySelectorAll('.provider-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  const cfg = RideSyncDB.getMapConfig();
  cfg.provider = providerKey;
  RideSyncDB.setMapConfig(cfg);

  if (state.map) {
    RideSyncMaps.attachTileLayer(state.map, providerKey);
  }
  showToast(`🗺️ Switched map layer to: ${providerKey}`, 'info');
}

function saveApiConfig() {
  const cfg = RideSyncDB.getMapConfig();
  cfg.supabaseUrl = document.getElementById('cfgSupabaseUrl').value.trim();
  cfg.supabaseAnonKey = document.getElementById('cfgSupabaseKey').value.trim();
  cfg.googleMapsApiKey = document.getElementById('cfgGoogleKey').value.trim();

  RideSyncDB.setMapConfig(cfg);
  closeModal('modalConfig');
  showToast('💾 Database & Map API keys saved!', 'success');
}

function resetDatabaseToDefault() {
  if (confirm('Reset local database to initial seeded rider accounts and rides?')) {
    RideSyncDB.resetToDefault();
    closeModal('modalConfig');
    reloadDynamicAppData();
    showToast('🔄 Database reset to default seed data', 'info');
  }
}

function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.add('active');
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.remove('active');
}

function openAddPinDialog() {
  const title = prompt('Enter pin label (e.g. Scenic Viewpoint or Caution Pothole):');
  if (title && title.trim()) {
    triggerQuickAction('custom', title.trim());
  }
}

// Side Panel Dynamic Accounts List
function renderSidePanelAccounts() {
  const container = document.getElementById('panelQuickAccounts');
  if (!container) return;

  const profiles = RideSyncDB.getProfiles();
  const activeUser = RideSyncDB.getActiveUser();

  container.innerHTML = profiles.map(p => `
    <div class="quick-account-btn ${p.id === activeUser.id ? 'active-account' : ''}" style="${p.id === activeUser.id ? 'border-color:var(--primary-orange); background:rgba(255,107,0,0.12);' : ''}" onclick="switchActiveUserSession('${p.id}')">
      <div class="account-left">
        <div class="account-avatar" style="background:${p.avatarColor || '#FF6B00'}">${p.avatar}</div>
        <div class="account-info">
          <div class="account-name-row">
            <span class="account-name">${p.name} ${p.id === activeUser.id ? '(Active)' : ''}</span>
            <span class="account-role-tag">${p.roleDefault || 'Rider'}</span>
          </div>
          <span class="account-bike">${p.bikeModel}</span>
        </div>
      </div>
      <span class="account-quick-arrow">${p.id === activeUser.id ? '✓' : '›'}</span>
    </div>
  `).join('');
}

function switchActiveUserSession(userId) {
  RideSyncDB.setActiveUserId(userId);
  const user = RideSyncDB.getProfile(userId);
  reloadDynamicAppData();
  showToast(`👤 Switched active session to: ${user.name} (${user.bikeModel})`, 'success');
}

// Toast Utility
function showToast(message, type = 'info') {
  const existing = document.querySelector('.app-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `app-toast ${type}`;
  toast.innerText = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.classList.add('show'), 50);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 350);
  }, 3500);
}

function escapeQuotes(str) {
  return (str || '').replace(/'/g, "\\'");
}

// -------------------------------------------------------------
// LOCAL DATABASE INSPECTOR & SQL VIEWER
// -------------------------------------------------------------
function openDbInspectorModal() {
  openModal('modalDbInspector');
  switchDbTable(document.querySelector('.db-tab-btn'), 'profiles');
}

async function switchDbTable(btn, tableName) {
  document.querySelectorAll('.db-tab-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');

  const sqlInput = document.getElementById('dbCustomSqlInput');
  const sql = `SELECT * FROM ${tableName} LIMIT 20`;
  if (sqlInput) sqlInput.value = sql;

  await executeAndDisplaySql(sql);
}

async function runCustomSqlQuery() {
  const sqlInput = document.getElementById('dbCustomSqlInput');
  const sql = sqlInput?.value.trim();
  if (sql) {
    await executeAndDisplaySql(sql);
  }
}

async function executeAndDisplaySql(sql) {
  const container = document.getElementById('dbTableContainer');
  if (!container) return;

  container.innerHTML = '<div style="padding:20px; text-align:center; color:var(--text-muted);">Executing SQL on local database (ridesync.db)...</div>';

  const result = await RideSyncDB.executeSql(sql);

  if (result.error) {
    container.innerHTML = `<div style="padding:20px; color:var(--accent-red); font-family:monospace;">❌ SQL Error: ${result.error}</div>`;
    return;
  }

  const rows = result.rows || [];
  if (rows.length === 0) {
    container.innerHTML = '<div style="padding:20px; text-align:center; color:var(--text-muted);">Table is empty (0 rows returned).</div>';
    return;
  }

  const columns = Object.keys(rows[0]);
  const tableHtml = `
    <table class="db-data-table">
      <thead>
        <tr>
          ${columns.map(col => `<th>${col}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
        ${rows.map(row => `
          <tr>
            ${columns.map(col => `<td>${row[col] !== null ? escapeQuotes(String(row[col])) : '<em style="color:#64748B">NULL</em>'}</td>`).join('')}
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  container.innerHTML = tableHtml;
}

