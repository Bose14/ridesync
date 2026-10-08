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

  // Check if URL has ?join=CODE
  checkUrlJoinParameter();

  // Always request Location & Notification permissions on launch
  requestPermissionsOnLaunch();
});

function checkUrlJoinParameter() {
  const urlParams = new URLSearchParams(window.location.search);
  const joinCode = urlParams.get('join') || urlParams.get('code');
  if (joinCode) {
    console.log(`[Payanam] URL Join parameter detected: ${joinCode}`);
    const activeUser = RideSyncDB.getActiveUser();
    if (activeUser && activeUser.id) {
      setTimeout(() => {
        RideSyncDB.joinRide(joinCode, activeUser.id).then(res => {
          if (res.success) {
            state.currentRideId = res.ride.id;
            state.currentRide = res.ride;
            PayanamRealtime.connect(res.ride.id);
            navigateTo('screenRideLobby');
            if (res.status === 'pending') {
              const leadProfile = RideSyncDB.getProfile(res.ride.creator_id || res.ride.creatorId);
              const leadNameEl = document.getElementById('pendingLeadName');
              if (leadNameEl) leadNameEl.innerText = leadProfile ? leadProfile.name : 'Ride Lead';
              openModal('modalJoinRequestStatus');
            } else {
              showToast(`🏍️ ${res.message || 'Joined ride lobby!'}`, 'success');
            }
          } else {
            showToast(`❌ ${res.error}`, 'error');
          }
        });
      }, 600);
    } else {
      showToast(`🔑 Please log in to join ride with code: ${joinCode}`, 'info');
    }
  }
}

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
    initPlannerMap();
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
// GOOGLE MAPS STYLE ROUTE & STOP PLANNER ENGINE
// -------------------------------------------------------------
const plannerState = {
  start: { name: 'Bangalore, Silk Board', lat: 12.9176, lng: 77.6233 },
  destination: { name: 'Pillar Rocks, Kodaikanal', lat: 10.2185, lng: 77.4682 },
  stops: [], // Array of { id, name, lat, lng }
  distanceKm: 324.8,
  durationHours: 8.5,
  map: null,
  routeLayer: null,
  markers: []
};

let searchDebounceTimers = {};
let activePromptRequest = null;

function initPlannerMap() {
  const mapEl = document.getElementById('plannerMap');
  if (!mapEl) return;

  if (!plannerState.map) {
    plannerState.map = L.map('plannerMap', {
      zoomControl: true,
      attributionControl: false
    }).setView([plannerState.start.lat, plannerState.start.lng], 9);

    PayanamMaps.attachTileLayer(plannerState.map, 'google-roadmap');
  }

  // Populate inputs with current planner values if empty
  const startInput = document.getElementById('inputStartLocation');
  if (startInput && !startInput.value) startInput.value = plannerState.start.name;

  const destInput = document.getElementById('inputDestLocation');
  if (destInput && !destInput.value) destInput.value = plannerState.destination.name;

  renderPlannerStopsUi();

  setTimeout(() => {
    if (plannerState.map) {
      plannerState.map.invalidateSize();
      recalculatePlannerRoute();
    }
  }, 200);
}

function renderPlannerStopsUi() {
  const container = document.getElementById('gmapsStopsContainer');
  if (!container) return;

  container.innerHTML = plannerState.stops.map((stop, idx) => `
    <div class="gmaps-input-row" id="rowStop_${idx}">
      <div class="gmaps-dot stop-dot">${idx + 1}</div>
      <div class="gmaps-input-wrapper">
        <input type="text" class="gmaps-input" value="${stop.name}" placeholder="Choose stop / chai halt..." autocomplete="off" oninput="handlePlaceSearch(this.value, 'stop', ${idx})" onfocus="showPlaceSuggestions('stop', ${idx})" />
        <button class="btn-remove-stop" onclick="removeIntermediateStopRow(${idx})" title="Remove stop">✕</button>
        <div class="gmaps-suggestions" id="stopSuggestions_${idx}" style="display:none;"></div>
      </div>
    </div>
  `).join('');
}

// Live Photon Place Search with Suggestions Dropdown
function handlePlaceSearch(query, type, stopIndex = null) {
  const timerKey = `${type}_${stopIndex !== null ? stopIndex : ''}`;
  clearTimeout(searchDebounceTimers[timerKey]);

  const targetDropdownId = type === 'start' ? 'startSuggestions' : (type === 'dest' ? 'destSuggestions' : `stopSuggestions_${stopIndex}`);
  const dropdown = document.getElementById(targetDropdownId);

  if (!query || query.trim().length < 2) {
    if (dropdown) dropdown.style.display = 'none';
    return;
  }

  searchDebounceTimers[timerKey] = setTimeout(async () => {
    const centerLat = plannerState.start.lat || 12.9176;
    const centerLng = plannerState.start.lng || 77.6233;
    const places = await PayanamMaps.searchPlaces(query, centerLat, centerLng);

    if (!dropdown) return;

    if (places.length === 0) {
      dropdown.innerHTML = `<div style="padding:10px 12px; font-size:12px; color:var(--text-muted);">No locations found for "${query}"</div>`;
      dropdown.style.display = 'block';
      return;
    }

    dropdown.innerHTML = places.map(p => `
      <div class="gmaps-suggestion-item" onclick="selectPlaceSuggestion('${type}', ${stopIndex}, '${escapeQuotes(p.name)}', ${p.lat}, ${p.lng})">
        <span class="suggestion-icon">📍</span>
        <div class="suggestion-info">
          <span class="suggestion-name">${p.name}</span>
          <span class="suggestion-sub">${p.subText}</span>
        </div>
      </div>
    `).join('');
    dropdown.style.display = 'block';
  }, 250);
}

function showPlaceSuggestions(type, stopIndex = null) {
  const targetDropdownId = type === 'start' ? 'startSuggestions' : (type === 'dest' ? 'destSuggestions' : `stopSuggestions_${stopIndex}`);
  const dropdown = document.getElementById(targetDropdownId);
  if (dropdown && dropdown.innerHTML.trim()) {
    dropdown.style.display = 'block';
  }
}

function selectPlaceSuggestion(type, stopIndex, name, lat, lng) {
  if (type === 'start') {
    plannerState.start = { name, lat, lng };
    const input = document.getElementById('inputStartLocation');
    if (input) input.value = name;
    document.getElementById('startSuggestions').style.display = 'none';
  } else if (type === 'dest') {
    plannerState.destination = { name, lat, lng };
    const input = document.getElementById('inputDestLocation');
    if (input) input.value = name;
    document.getElementById('destSuggestions').style.display = 'none';
  } else if (type === 'stop' && stopIndex !== null && plannerState.stops[stopIndex]) {
    plannerState.stops[stopIndex] = { id: plannerState.stops[stopIndex].id, name, lat, lng };
    renderPlannerStopsUi();
  }

  // Recalculate full OSRM road corridor
  recalculatePlannerRoute();
}

function useCurrentLocationForStart() {
  if ('geolocation' in navigator) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        plannerState.start = { name: '📍 My Current GPS Location', lat, lng };
        const input = document.getElementById('inputStartLocation');
        if (input) input.value = '📍 My Current GPS Location';
        showToast('📍 Start point pinpointed to current GPS location!', 'success');
        recalculatePlannerRoute();
      },
      (err) => {
        showToast('Could not fetch current GPS location: ' + err.message, 'error');
      },
      { enableHighAccuracy: true }
    );
  }
}

function addIntermediateStopRow() {
  const newStop = {
    id: Date.now(),
    name: '',
    lat: (plannerState.start.lat + plannerState.destination.lat) / 2 + (Math.random() * 0.1 - 0.05),
    lng: (plannerState.start.lng + plannerState.destination.lng) / 2 + (Math.random() * 0.1 - 0.05)
  };
  plannerState.stops.push(newStop);
  renderPlannerStopsUi();
  showToast('➕ Stop added. Search location or chai halt.', 'info');
}

function removeIntermediateStopRow(index) {
  plannerState.stops.splice(index, 1);
  renderPlannerStopsUi();
  recalculatePlannerRoute();
  showToast('🗑️ Stop removed', 'info');
}

function swapStartAndDestination() {
  const temp = { ...plannerState.start };
  plannerState.start = { ...plannerState.destination };
  plannerState.destination = temp;

  const startInput = document.getElementById('inputStartLocation');
  const destInput = document.getElementById('inputDestLocation');
  if (startInput) startInput.value = plannerState.start.name;
  if (destInput) destInput.value = plannerState.destination.name;

  recalculatePlannerRoute();
  showToast('🔄 Route reversed!', 'info');
}

function quickSelectDestination(name, lat, lng) {
  plannerState.destination = { name, lat, lng };
  const destInput = document.getElementById('inputDestLocation');
  if (destInput) destInput.value = name;
  recalculatePlannerRoute();
  showToast(`🎯 Destination set to ${name}`, 'success');
}

// Recalculate road corridor via OSRM and render markers on planner map
async function recalculatePlannerRoute() {
  if (!plannerState.map) return;

  const allPoints = [plannerState.start, ...plannerState.stops.filter(s => s.name && s.lat), plannerState.destination];
  const coords = allPoints.map(p => [p.lat, p.lng]);

  // Clear existing markers & route polyline
  (plannerState.markers || []).forEach(m => {
    try { plannerState.map.removeLayer(m); } catch(e) {}
  });
  plannerState.markers = [];

  if (plannerState.routeLayer) {
    try { plannerState.map.removeLayer(plannerState.routeLayer); } catch(e) {}
    plannerState.routeLayer = null;
  }

  // Draw Start Marker
  const startIcon = L.divIcon({
    className: 'planner-pin start',
    html: '<div style="background:#00E676; color:#000; font-weight:800; border-radius:50%; width:28px; height:28px; display:flex; align-items:center; justify-content:center; border:2px solid #FFF; box-shadow:0 0 10px rgba(0,230,118,0.8);">🟢</div>',
    iconSize: [28, 28],
    iconAnchor: [14, 14]
  });
  const startMarker = L.marker([plannerState.start.lat, plannerState.start.lng], { icon: startIcon }).addTo(plannerState.map);
  startMarker.bindTooltip(`<b>Start:</b> ${plannerState.start.name}`, { permanent: false, direction: 'top' });
  plannerState.markers.push(startMarker);

  // Draw Stop Markers
  plannerState.stops.forEach((stop, idx) => {
    if (stop.lat && stop.lng) {
      const stopIcon = L.divIcon({
        className: 'planner-pin stop',
        html: `<div style="background:#00E5FF; color:#000; font-weight:800; border-radius:50%; width:26px; height:26px; display:flex; align-items:center; justify-content:center; border:2px solid #FFF; font-size:12px; box-shadow:0 0 10px rgba(0,229,255,0.6);">${idx + 1}</div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13]
      });
      const m = L.marker([stop.lat, stop.lng], { icon: stopIcon }).addTo(plannerState.map);
      m.bindTooltip(`<b>Stop ${idx + 1}:</b> ${stop.name || 'Waypoint'}`, { permanent: false, direction: 'top' });
      plannerState.markers.push(m);
    }
  });

  // Draw Destination Marker
  const destIcon = L.divIcon({
    className: 'planner-pin dest',
    html: '<div style="background:#FF6B00; color:#FFF; font-weight:800; border-radius:50%; width:28px; height:28px; display:flex; align-items:center; justify-content:center; border:2px solid #FFF; box-shadow:0 0 10px rgba(255,107,0,0.8);">🏁</div>',
    iconSize: [28, 28],
    iconAnchor: [14, 14]
  });
  const destMarker = L.marker([plannerState.destination.lat, plannerState.destination.lng], { icon: destIcon }).addTo(plannerState.map);
  destMarker.bindTooltip(`<b>Destination:</b> ${plannerState.destination.name}`, { permanent: false, direction: 'top' });
  plannerState.markers.push(destMarker);

  // Fetch real highway route from OSRM
  const roadData = await PayanamMaps.fetchRoadRoute(coords);
  if (roadData && roadData.latLngs) {
    plannerState.distanceKm = roadData.distanceKm;
    plannerState.durationHours = (roadData.durationMins / 60).toFixed(1);

    plannerState.routeLayer = L.polyline(roadData.latLngs, {
      color: '#FF6B00',
      weight: 5,
      opacity: 0.9,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(plannerState.map);

    try {
      plannerState.map.fitBounds(plannerState.routeLayer.getBounds(), { padding: [30, 30] });
    } catch(e) {}

    // Update Distance & Duration UI Badges
    const distBadge = document.getElementById('plannerDistanceBadge');
    if (distBadge) distBadge.innerText = `📍 ${roadData.distanceKm} km`;

    const durBadge = document.getElementById('plannerDurationBadge');
    if (durBadge) {
      const hrs = Math.floor(roadData.durationMins / 60);
      const mins = roadData.durationMins % 60;
      durBadge.innerText = `⏱️ ~${hrs > 0 ? hrs + 'h ' : ''}${mins}m`;
    }
  }
}

// Submit and Create Ride
async function submitCreateOrSaveRide() {
  const nameInput = document.getElementById('inputRideName');
  const dateInput = document.getElementById('inputRideDate');
  const timeInput = document.getElementById('inputRideTime');

  const name = (nameInput?.value || '').trim() || 'Motorcycle Group Ride';
  const date = dateInput?.value || new Date().toISOString().split('T')[0];
  const time = timeInput?.value || '06:00';

  // Build waypoints array from start, intermediate stops, and destination
  const waypoints = [
    { id: 1, name: plannerState.start.name, type: 'start', icon: '🟢', lat: plannerState.start.lat, lng: plannerState.start.lng },
    ...plannerState.stops.map((s, idx) => ({
      id: s.id || Date.now() + idx,
      name: s.name || `Stop ${idx + 1}`,
      type: 'custom',
      icon: '📍',
      lat: s.lat,
      lng: s.lng,
      plannedDuration: 15
    })),
    { id: 999, name: plannerState.destination.name, type: 'destination', icon: '🏁', lat: plannerState.destination.lat, lng: plannerState.destination.lng }
  ];

  const ridePayload = {
    name,
    date,
    time,
    startAddress: plannerState.start.name,
    startLat: plannerState.start.lat,
    startLng: plannerState.start.lng,
    destAddress: plannerState.destination.name,
    destLat: plannerState.destination.lat,
    destLng: plannerState.destination.lng,
    distanceKm: parseFloat(plannerState.distanceKm) || 0,
    durationHours: parseFloat(plannerState.durationHours) || 0,
    waypoints
  };

  const newRide = await RideSyncDB.createRide(ridePayload);
  state.currentRideId = newRide.id;
  state.currentRide = newRide;

  // Connect to realtime WebSocket room
  PayanamRealtime.connect(newRide.id);

  showToast(`🎉 Ride Lobby Created! Code: ${newRide.code}`, 'success');
  navigateTo('screenRideLobby');
}

// -------------------------------------------------------------
// RIDE LOBBY ROOM ENGINE (Dynamic Members, Join Requests & Roles)
// -------------------------------------------------------------
function renderRideLobby() {
  const ride = state.currentRide || RideSyncDB.getRide(state.currentRideId) || RideSyncDB.getRides()[0];
  if (!ride) return;

  state.currentRide = ride;
  state.currentRideId = ride.id;

  const activeUser = RideSyncDB.getActiveUser() || { id: 'usr-bose', name: 'Rider' };
  const isLead = ride.creator_id === activeUser.id || ride.creatorId === activeUser.id;

  // Connect to realtime room
  PayanamRealtime.connect(ride.id);

  // 1. Banner Info
  const titleEl = document.getElementById('lobbyRideTitle');
  if (titleEl) titleEl.innerText = ride.name;

  const codeEl = document.getElementById('lobbyRideCode');
  if (codeEl) codeEl.innerText = ride.code;

  const myRoleBadge = document.getElementById('lobbyMyRoleBadge');
  if (myRoleBadge) {
    myRoleBadge.innerText = isLead ? '👑 Ride Lead' : '🏍️ Group Member';
    myRoleBadge.style.background = isLead ? 'rgba(255,107,0,0.15)' : 'rgba(0,229,255,0.15)';
    myRoleBadge.style.color = isLead ? 'var(--primary-orange)' : 'var(--accent-cyan)';
    myRoleBadge.style.borderColor = isLead ? 'rgba(255,107,0,0.3)' : 'rgba(0,229,255,0.3)';
  }

  const dateTimeEl = document.getElementById('lobbyRideDateTime');
  if (dateTimeEl) {
    dateTimeEl.innerText = `${ride.date || 'Today'} · ${ride.time || '06:00'} Departure &bull; ${ride.distanceKm || 0} km`;
  }

  const startSummary = document.getElementById('lobbyStartSummary');
  if (startSummary) startSummary.innerText = (ride.startAddress || ride.start_address || 'Start').split(',')[0];

  const destSummary = document.getElementById('lobbyDestSummary');
  if (destSummary) destSummary.innerText = (ride.destAddress || ride.dest_address || 'Destination').split(',')[0];

  // 2. Share Links
  const fullJoinUrl = `${window.location.origin}/?join=${ride.code}`;
  const inviteEl = document.getElementById('lobbyInviteLink');
  if (inviteEl) inviteEl.innerText = fullJoinUrl;

  // 3. Permission Notice
  const permissionBanner = document.getElementById('lobbyPermissionBanner');
  const permissionText = document.getElementById('lobbyPermissionText');
  if (permissionBanner && permissionText) {
    if (isLead) {
      permissionText.innerHTML = `<strong>Lead Privileges Active:</strong> You can approve riders, manage stops, and launch the live ride.`;
    } else {
      permissionText.innerHTML = `<strong>Read-Only Member:</strong> Waiting for Lead (<strong style="color:var(--primary-orange);">Lead</strong>) to start the journey.`;
    }
  }

  // 4. Split Members into Approved & Pending
  const dbProfiles = RideSyncDB.getProfiles();
  const members = ride.members || [];
  const approvedMembers = members.filter(m => m.status === 'ready' || m.status === 'active' || m.role === 'creator' || m.isLead);
  const pendingMembers = members.filter(m => m.status === 'pending');

  // Check current user status
  const myMemberEntry = members.find(m => m.userId === activeUser.id);
  const isMyMembershipPending = !isLead && myMemberEntry && myMemberEntry.status === 'pending';

  // 5. Pending Join Requests (Visible to Lead only)
  const pendingSection = document.getElementById('lobbyPendingRequestsSection');
  const pendingCountEl = document.getElementById('pendingRequestsCount');
  const pendingContainer = document.getElementById('pendingRidersContainer');

  if (pendingSection && pendingContainer) {
    if (isLead && pendingMembers.length > 0) {
      pendingSection.style.display = 'block';
      if (pendingCountEl) pendingCountEl.innerText = pendingMembers.length;

      pendingContainer.innerHTML = pendingMembers.map(m => {
        const p = dbProfiles.find(prof => prof.id === m.userId) || { name: 'Rider', bikeModel: 'Motorcycle', avatar: 'R', avatarColor: '#00E5FF', phone: '' };
        return `
          <div class="pending-rider-card">
            <div class="pending-rider-left">
              <div class="account-avatar" style="background:${p.avatarColor || '#00E5FF'}; width:36px; height:36px; font-size:14px;">${p.avatar || p.name[0]}</div>
              <div>
                <span style="font-size:13px; font-weight:700; color:var(--text-primary); display:block;">${p.name}</span>
                <span style="font-size:11px; color:var(--text-secondary);">${p.bikeModel} &bull; ${p.phone || ''}</span>
              </div>
            </div>
            <div class="pending-rider-actions">
              <button class="btn-approve-sm" onclick="handleLeadApprove('${m.userId}')">✅ Approve</button>
              <button class="btn-decline-sm" onclick="handleLeadDecline('${m.userId}')">✕</button>
            </div>
          </div>
        `;
      }).join('');
    } else {
      pendingSection.style.display = 'none';
    }
  }

  // 6. Approved Riders List
  const ridersListContainer = document.getElementById('lobbyRiderListContainer');
  const countHeader = document.getElementById('lobbyRidersCountHeader');
  const readyBadge = document.getElementById('lobbyReadyBadge');

  if (countHeader) countHeader.innerText = `Approved Riders (${approvedMembers.length})`;
  if (readyBadge) readyBadge.innerText = `${approvedMembers.length} Ready`;

  if (ridersListContainer) {
    ridersListContainer.innerHTML = approvedMembers.map(m => {
      const p = dbProfiles.find(prof => prof.id === m.userId) || {
        name: 'Rider',
        bikeModel: 'Motorcycle',
        avatar: 'R',
        avatarColor: '#FF6B00'
      };
      const isRiderLead = m.isLead || m.role === 'creator' || ride.creator_id === m.userId || ride.creatorId === m.userId;

      return `
        <div class="lobby-rider-card">
          <div class="avatar-ring is-ready" style="border-color:${p.avatarColor || '#FF6B00'}">
            <span>${p.avatar || p.name[0]}</span>
          </div>
          <div class="rider-info">
            <span class="rider-name">${p.name} ${isRiderLead ? '<strong style="color:var(--primary-orange);">(Lead)</strong>' : ''}</span>
            <span class="rider-bike">${p.bikeModel}</span>
          </div>
          <span class="status-pill ready">${isRiderLead ? '👑 Lead' : '✓ Ready'}</span>
        </div>
      `;
    }).join('');
  }

  // 7. Bottom Action Button
  const btnStart = document.getElementById('btnStartLiveRide');
  const waitingHint = document.getElementById('lobbyWaitingHint');

  if (isLead) {
    if (btnStart) {
      btnStart.style.display = 'block';
      btnStart.disabled = false;
      btnStart.innerText = '🚀 START LIVE RIDE NOW';
    }
    if (waitingHint) waitingHint.style.display = 'none';
  } else if (isMyMembershipPending) {
    if (btnStart) {
      btnStart.style.display = 'block';
      btnStart.disabled = true;
      btnStart.innerText = '⏳ JOIN REQUEST PENDING APPROVAL';
      btnStart.style.background = '#374151';
    }
    if (waitingHint) {
      waitingHint.style.display = 'block';
      waitingHint.innerText = '⏳ The Ride Lead has been notified. You will enter the lobby once approved.';
    }
  } else {
    // Approved Member
    if (btnStart) {
      btnStart.style.display = 'block';
      btnStart.disabled = true;
      btnStart.innerText = '⏳ WAITING FOR LEAD TO START RIDE';
      btnStart.style.background = '#1E293B';
    }
    if (waitingHint) {
      waitingHint.style.display = 'block';
      waitingHint.innerText = '🏍️ All set! Keep your gear on. The cockpit will automatically launch when Lead starts the ride.';
    }
  }
}

// Lead Approves a Pending Member
async function handleLeadApprove(userId) {
  const activeUser = RideSyncDB.getActiveUser();
  await RideSyncDB.approveMember(state.currentRideId, userId, activeUser.id, 'approve');
  showToast('✅ Rider approved and added to lobby!', 'success');
  refreshLobbyData();
}

// Lead Declines a Pending Member
async function handleLeadDecline(userId) {
  const activeUser = RideSyncDB.getActiveUser();
  await RideSyncDB.approveMember(state.currentRideId, userId, activeUser.id, 'decline');
  showToast('❌ Join request declined', 'info');
  refreshLobbyData();
}

// Lead Launches the Live Ride
async function handleStartLiveRide() {
  const activeUser = RideSyncDB.getActiveUser();
  const res = await RideSyncDB.startLiveRide(state.currentRideId, activeUser.id);
  
  // Broadcast to all WebSocket members
  PayanamRealtime.broadcast({ type: 'ride_started', rideId: state.currentRideId });

  startLiveRideSession();
}

function startLiveRideSession() {
  navigateTo('screenLiveMap');
  showToast('🚀 Live Ride Active! GPS Telemetry & Cockpit Engaged', 'success');
}

// Refresh Lobby Data from Server or Local DB
async function refreshLobbyData() {
  const apiBase = RideSyncDB.getApiBaseUrl();
  try {
    const res = await fetch(`${apiBase}/rides`);
    if (res.ok) {
      const rides = await res.json();
      const current = rides.find(r => r.id === state.currentRideId);
      if (current) {
        state.currentRide = current;
        if (state.activeScreen === 'screenRideLobby') {
          renderRideLobby();
        }
      }
    }
  } catch(e) {}
}

// Real-time WebSocket Protocol & Event Handler
const PayanamRealtime = (function () {
  let socket = null;
  let subscribedRideId = null;
  let pollInterval = null;

  function getWsUrl() {
    const apiBase = RideSyncDB.getApiBaseUrl();
    return apiBase.replace(/^http/, 'ws').replace(/\/api$/, '') + '/ws';
  }

  function connect(rideId) {
    if (!rideId) return;
    subscribedRideId = rideId;

    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'subscribe', rideId }));
      return;
    }

    try {
      socket = new WebSocket(getWsUrl());
      socket.onopen = () => {
        console.log('[Payanam WS] Connected to live lobby gateway for ride:', rideId);
        socket.send(JSON.stringify({ type: 'subscribe', rideId }));
      };
      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          handleRealtimeMessage(msg);
        } catch (e) {}
      };
      socket.onerror = (e) => console.warn('[Payanam WS] Gateway error:', e);
      socket.onclose = () => console.log('[Payanam WS] Gateway closed');
    } catch (e) {
      console.warn('[Payanam WS] Realtime connection fallback:', e);
    }

    // Polling fallback every 3s
    clearInterval(pollInterval);
    pollInterval = setInterval(() => {
      if (state.activeScreen === 'screenRideLobby' && state.currentRideId) {
        refreshLobbyData();
      }
    }, 3000);
  }

  function broadcast(data) {
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ ...data, rideId: subscribedRideId }));
    }
  }

  return { connect, broadcast };
})();

// Real-time Event Dispatcher
function handleRealtimeMessage(msg) {
  console.log('[Payanam Realtime Event]', msg);
  const activeUser = RideSyncDB.getActiveUser();

  if (msg.type === 'join_request') {
    const isLead = state.currentRide && (state.currentRide.creator_id === activeUser.id || state.currentRide.creatorId === activeUser.id);
    if (isLead && msg.user) {
      // Prompt Lead with Join Request Modal
      activePromptRequest = msg;
      const avatarEl = document.getElementById('promptRiderAvatar');
      const nameEl = document.getElementById('promptRiderName');
      const bikeEl = document.getElementById('promptRiderBike');
      const phoneEl = document.getElementById('promptRiderPhone');

      if (avatarEl) {
        avatarEl.innerText = msg.user.avatar || msg.user.name[0];
        avatarEl.style.background = msg.user.avatarColor || '#00E5FF';
      }
      if (nameEl) nameEl.innerText = msg.user.name;
      if (bikeEl) bikeEl.innerText = msg.user.bikeModel || msg.user.bike_model || 'Motorcycle';
      if (phoneEl) phoneEl.innerText = msg.user.phoneFormatted || msg.user.phone || '';

      openModal('modalJoinApprovalPrompt');
      showToast(`🔔 ${msg.user.name} requested to join the ride!`, 'info');
    }
    refreshLobbyData();
  } else if (msg.type === 'member_approved') {
    if (msg.userId === activeUser.id) {
      closeModal('modalJoinRequestStatus');
      showToast('🎉 Your join request was approved by the Lead!', 'success');
    }
    refreshLobbyData();
  } else if (msg.type === 'member_declined') {
    if (msg.userId === activeUser.id) {
      closeModal('modalJoinRequestStatus');
      showToast('❌ Join request was declined by the Lead.', 'error');
      navigateTo('screenHome');
    }
    refreshLobbyData();
  } else if (msg.type === 'ride_started') {
    if (state.activeScreen === 'screenRideLobby') {
      showToast('🚀 Lead launched the ride! Entering live map cockpit...', 'success');
      startLiveRideSession();
    }
  }
}

function handlePromptApprove() {
  if (activePromptRequest && activePromptRequest.user) {
    handleLeadApprove(activePromptRequest.user.id);
  }
  closeModal('modalJoinApprovalPrompt');
}

function handlePromptDecline() {
  if (activePromptRequest && activePromptRequest.user) {
    handleLeadDecline(activePromptRequest.user.id);
  }
  closeModal('modalJoinApprovalPrompt');
}

// Join Ride Submission (via Modal or URL)
async function submitJoinRide() {
  const codeInput = document.getElementById('inputJoinRideCode');
  const code = (codeInput?.value || '').trim();
  if (!code) {
    showToast('⚠️ Please enter a valid ride code', 'error');
    return;
  }

  const activeUser = RideSyncDB.getActiveUser();
  const res = await RideSyncDB.joinRide(code, activeUser.id);

  if (res.success) {
    state.currentRideId = res.ride.id;
    state.currentRide = res.ride;
    closeModal('modalJoinRide');

    PayanamRealtime.connect(res.ride.id);
    navigateTo('screenRideLobby');

    if (res.status === 'pending') {
      const leadProfile = RideSyncDB.getProfile(res.ride.creator_id || res.ride.creatorId);
      const leadNameEl = document.getElementById('pendingLeadName');
      if (leadNameEl) leadNameEl.innerText = leadProfile ? leadProfile.name : 'Ride Lead';
      openModal('modalJoinRequestStatus');
    } else {
      showToast(`🏍️ ${res.message || 'Joined ride lobby!'}`, 'success');
    }
  } else {
    showToast(`❌ ${res.error}`, 'error');
  }
}

// Share Functions
function copyInviteLink() {
  const code = state.currentRide?.code || 'KODAI26';
  const url = `${window.location.origin}/?join=${code}`;
  if (navigator.clipboard) {
    navigator.clipboard.writeText(url);
  }
  showToast(`📋 Copied Invite Link: ${url}`, 'success');
}

function shareViaWhatsApp() {
  const ride = state.currentRide;
  const code = ride?.code || 'KODAI26';
  const url = `${window.location.origin}/?join=${code}`;
  const text = encodeURIComponent(`🏍️ Join our motorcycle group ride "${ride?.name || 'Ride'}" on Payanam!\n\n🔑 Code: ${code}\n👉 Join link: ${url}`);
  window.open(`https://api.whatsapp.com/send?text=${text}`, '_blank');
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

