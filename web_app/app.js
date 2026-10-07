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
});

function initThemeEngine() {
  const saved = localStorage.getItem('ridesync_theme_mode') || 'night';
  applyTheme(saved);
}

function toggleCockpitTheme() {
  const nextMode = state.themeMode === 'night' ? 'sunlight' : 'night';
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

  // Automatically adapt Leaflet Map tile provider for max readability
  if (state.map && window.RideSyncMaps) {
    const mapProvider = mode === 'sunlight' ? 'osm-standard' : 'carto-dark';
    RideSyncMaps.attachTileLayer(state.map, mapProvider);
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
    setTimeout(initOrUpdateLiveMap, 200);
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
    <div class="waypoint-item" data-id="${wp.id}">
      <span class="drag-handle">☰</span>
      <span class="wp-icon">${wp.icon || '📍'}</span>
      <div class="wp-details">
        <span class="wp-name">${wp.name}</span>
        <span class="wp-type-badge ${wp.type}">${wp.type.toUpperCase()}</span>
      </div>
      ${waypoints.length > 2 ? `<button class="btn-remove-stop" onclick="removeStop(${wp.id})">✕</button>` : ''}
    </div>
  `).join('');

  calculateAndDisplayRouteStats(waypoints);
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
      lat: 11.0000 + (Math.random() * 1.5),
      lng: 77.8000 + (Math.random() * 0.5),
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

  const ride = state.currentRide || RideSyncDB.getRides()[0];
  const centerLat = ride.waypoints?.[0]?.lat || 10.2380;
  const centerLng = ride.waypoints?.[0]?.lng || 77.4890;

  if (!state.map) {
    state.map = L.map('liveRideMap', {
      zoomControl: false,
      attributionControl: false
    }).setView([centerLat, centerLng], 12);

    // Attach active Tile Layer
    const cfg = RideSyncDB.getMapConfig();
    RideSyncMaps.attachTileLayer(state.map, cfg.provider || 'carto-dark');
  }

  // Draw OSRM Road Polyline
  if (ride.waypoints && ride.waypoints.length >= 2) {
    const coords = ride.waypoints.map(w => [w.lat, w.lng]);
    const roadRoute = await RideSyncMaps.fetchRoadRoute(coords);

    if (state.routePolylineLayer) {
      state.map.removeLayer(state.routePolylineLayer);
    }

    if (roadRoute && roadRoute.latLngs) {
      state.routePolylineLayer = L.polyline(roadRoute.latLngs, {
        color: '#FF6B00',
        weight: 6,
        opacity: 0.85,
        lineCap: 'round',
        lineJoin: 'round'
      }).addTo(state.map);

      // Fit map bounds to route
      state.map.fitBounds(state.routePolylineLayer.getBounds(), { padding: [40, 40] });
    }
  }

  // Render Waypoint Markers
  renderMapWaypoints(ride.waypoints || []);

  // Render Live Riders & Start Telemetry Loop
  renderRiderMarkers();
  renderRiderTelemetryCards();
  startTelemetrySimulation();
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
  state.riders.forEach(rider => {
    const isLead = rider.isLead;
    const isSeparated = rider.isSeparated;
    const markerClass = isLead ? 'marker-lead' : isSeparated ? 'marker-emergency' : '';

    const iconHtml = `
      <div class="rider-bike-marker ${markerClass}">
        <div class="marker-pin" style="border-color:${rider.avatarColor}; box-shadow:0 0 12px ${rider.avatarColor}80">
          <span>🏍️</span>
        </div>
        <div class="marker-label" style="border-left:3px solid ${rider.avatarColor}">${rider.name}</div>
      </div>
    `;

    const markerIcon = L.divIcon({ html: iconHtml, className: '', iconSize: [40, 40], iconAnchor: [20, 20] });

    if (!state.riderMarkers[rider.id]) {
      const marker = L.marker([rider.lat, rider.lng], { icon: markerIcon }).addTo(state.map);
      marker.bindPopup(`<strong>${rider.name}</strong><br>${rider.bike}<br>Speed: ${rider.speed} km/h`);
      state.riderMarkers[rider.id] = marker;
    } else {
      state.riderMarkers[rider.id].setLatLng([rider.lat, rider.lng]);
      state.riderMarkers[rider.id].setIcon(markerIcon);
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

function recenterOnGroup() {
  if (state.map && state.routePolylineLayer) {
    state.map.fitBounds(state.routePolylineLayer.getBounds(), { padding: [50, 50] });
    showToast('🎯 Map recentered on group formation', 'info');
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
  let title = 'System Alert';

  // Extract phone number from message if not explicitly provided
  let extractedPhone = phoneNum;
  if (!extractedPhone && (type === 'sos' || message.includes('Contact:'))) {
    const match = message.match(/(\+?\d[\d\s-]{8,}\d)/);
    if (match) extractedPhone = match[1].trim();
  }

  if (type === 'sos') {
    boxClass = 'sos-box';
    icon = '🚨';
    title = 'SOS EMERGENCY BROADCAST';
    playSosBuzzerSound(); // Trigger emergency siren buzzer audio tone
  } else if (type === 'separation') {
    boxClass = 'separation-box';
    icon = '⚠️';
    title = 'RIDER SEPARATION ALERT';
    playWarningChimeSound(); // Trigger warning chime sound
  } else if (type === 'deviation') {
    boxClass = 'deviation-box';
    icon = '🗺️';
    title = 'ROUTE CORRIDOR DEVIATION';
    playWarningChimeSound(); // Trigger warning chime sound
  } else if (type === 'pin') {
    boxClass = 'info-box';
    icon = '📍';
    title = 'CONVOY STOP PIN';
  }

  alertEl.className = `hud-notification-box ${boxClass}`;
  alertEl.innerHTML = `
    <div class="hud-box-header">
      <div class="hud-box-title-row">
        <span class="hud-box-icon">${icon}</span>
        <span class="hud-box-title">${title}</span>
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
        container.innerHTML = places.map(p => `
          <div class="place-card" onclick="addDiscoveredPlace('${escapeQuotes(p.name)}', ${p.lat}, ${p.lng})">
            <div>
              <span class="place-name">${p.name}</span>
              <span class="place-dist">${p.subText}</span>
            </div>
            <button class="btn-add-place">+ Add Stop</button>
          </div>
        `).join('');
      }
    }
  }, 400);
}

function renderPlaceDiscoveryList() {
  const container = document.getElementById('placesList');
  if (!container) return;

  const defaultPlaces = [
    { name: 'Kodaikanal Lake & Boathouse', cat: 'Top Attractions', sub: 'Scenic halt · 1.2 km off route', lat: 10.2350, lng: 77.4900 },
    { name: 'Coaker\'s Walk Valley View', cat: 'Viewpoints', sub: 'On route · Panoramic cliff', lat: 10.2324, lng: 77.4947 },
    { name: 'Silver Cascade Waterfall', cat: 'Viewpoints', sub: 'On route · Photo Stop', lat: 10.2582, lng: 77.5186 },
    { name: 'Highland Filter Tea & Spices', cat: 'Tea', sub: '0.3 km from route · Hot Chai', lat: 10.2450, lng: 77.5020 },
    { name: 'Indian Oil Ghat Station', cat: 'Fuel', sub: 'On route · High altitude fuel', lat: 10.2600, lng: 77.5100 }
  ];

  container.innerHTML = defaultPlaces.map(p => `
    <div class="place-card" onclick="addDiscoveredPlace('${escapeQuotes(p.name)}', ${p.lat}, ${p.lng})">
      <div>
        <span class="place-name">${p.name}</span>
        <span class="place-dist">${p.sub}</span>
      </div>
      <button class="btn-add-place">+ Add</button>
    </div>
  `).join('');
}

function addDiscoveredPlace(name, lat, lng) {
  const newWp = {
    id: Date.now(),
    name,
    type: 'photo',
    icon: '📸',
    lat,
    lng,
    plannedDuration: 20
  };
  state.currentRide.waypoints.splice(state.currentRide.waypoints.length - 1, 0, newWp);
  RideSyncDB.saveWaypoints(state.currentRide.id, state.currentRide.waypoints);
  renderRoutePlannerWaypoints();
  closeModal('modalPlaceDiscovery');
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

