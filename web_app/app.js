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

  // Restore active ride session from URL parameter or localStorage on refresh
  restoreSavedRideStateFromUrlOrStorage();

  // Always request Location & Notification permissions on launch
  requestPermissionsOnLaunch();
});

// URL & Session State Synchronization
function updateUrlAndSessionState(screenId, ride) {
  const code = ride?.code || '';
  if (screenId === 'screenLiveMap' && code) {
    window.history.replaceState({ screen: 'live', ride: code }, '', `?screen=live&ride=${code}`);
    localStorage.setItem('ridesync_active_ride_code', code);
    localStorage.setItem('ridesync_active_screen', 'screenLiveMap');
  } else if (screenId === 'screenRideLobby' && code) {
    window.history.replaceState({ screen: 'lobby', ride: code }, '', `?screen=lobby&ride=${code}`);
    localStorage.setItem('ridesync_active_ride_code', code);
    localStorage.setItem('ridesync_active_screen', 'screenRideLobby');
  } else if (screenId === 'screenHome') {
    window.history.replaceState({ screen: 'home' }, '', window.location.pathname);
    localStorage.removeItem('ridesync_active_screen');
  } else if (screenId === 'screenHistory' || screenId === 'screenCreateRide' || screenId === 'screenRideSummary') {
    window.history.replaceState({ screen: screenId }, '', window.location.pathname);
  }
}

function restoreSavedRideStateFromUrlOrStorage() {
  const urlParams = new URLSearchParams(window.location.search);
  const joinCode = urlParams.get('join');
  const rideCode = urlParams.get('ride') || urlParams.get('code') || localStorage.getItem('ridesync_active_ride_code');
  const requestedScreen = urlParams.get('screen') || localStorage.getItem('ridesync_active_screen');

  if (joinCode) {
    checkUrlJoinParameter();
    return;
  }

  if (rideCode) {
    const rides = RideSyncDB.getRides();
    const ride = rides.find(r => (r.code && r.code.toUpperCase() === rideCode.toUpperCase()) || r.id === rideCode);
    if (ride) {
      state.currentRide = ride;
      state.currentRideId = ride.id;
      const activeUser = RideSyncDB.getActiveUser();
      const isMember = (ride.members || []).some(m => (m.userId || m.user_id) === activeUser?.id);
      const isLead = ride.creator_id === activeUser?.id || ride.creatorId === activeUser?.id;

      if (isMember || isLead) {
        if (ride.status === 'active' || requestedScreen === 'screenLiveMap' || requestedScreen === 'live') {
          console.log(`[Payanam] Restoring active live ride session for: ${ride.name}`);
          setTimeout(() => {
            startLiveRideSession();
          }, 300);
          return;
        } else if (ride.status === 'lobby' || requestedScreen === 'screenRideLobby' || requestedScreen === 'lobby') {
          console.log(`[Payanam] Restoring ride lobby for: ${ride.name}`);
          setTimeout(() => {
            navigateTo('screenRideLobby');
          }, 300);
          return;
        }
      }
    }
  }
}

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

            if (res.status === 'pending') {
              navigateTo('screenRideLobby');
              const leadProfile = RideSyncDB.getProfile(res.ride.creator_id || res.ride.creatorId);
              const leadNameEl = document.getElementById('pendingLeadName');
              if (leadNameEl) leadNameEl.innerText = leadProfile ? leadProfile.name : 'Ride Lead';
              openModal('modalJoinRequestStatus');
            } else if (res.ride?.status === 'active') {
              showToast('🚀 Joined active ride! Launching cockpit...', 'success');
              startLiveRideSession();
            } else {
              navigateTo('screenRideLobby');
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

// Haversine formula to compute actual geographic distance between riders across cities
function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  if (lat1 === undefined || lon1 === undefined || lat2 === undefined || lon2 === undefined) return null;
  const numLat1 = Number(lat1);
  const numLon1 = Number(lon1);
  const numLat2 = Number(lat2);
  const numLon2 = Number(lon2);
  if (isNaN(numLat1) || isNaN(numLon1) || isNaN(numLat2) || isNaN(numLon2)) return null;

  const R = 6371; // Earth radius in km
  const dLat = (numLat2 - numLat1) * Math.PI / 180;
  const dLon = (numLon2 - numLon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(numLat1 * Math.PI / 180) * Math.cos(numLat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Synchronize rider members from DB profiles & live coordinates
function syncRidersFromDb(ride) {
  const activeUser = RideSyncDB.getActiveUser();
  const dbProfiles = RideSyncDB.getProfiles();

  const myLat = state.userGps?.lat || (state.riders.find(r => r.isMe)?.lat) || ride.start_lat || ride.startLat || 12.9716;
  const myLng = state.userGps?.lng || (state.riders.find(r => r.isMe)?.lng) || ride.start_lng || ride.startLng || 77.5946;

  state.riders = (ride.members || []).map((m, idx) => {
    const memberId = m.userId || m.user_id;
    const profile = dbProfiles.find(p => p.id === memberId) || {
      id: memberId,
      name: 'Rider ' + (idx + 1),
      bikeModel: 'Motorcycle',
      avatar: 'R',
      avatarColor: '#00E5FF'
    };

    const isMe = profile.id === activeUser.id;
    const isLead = m.isLead || m.role === 'creator' || ride.creator_id === memberId || ride.creatorId === memberId;

    const existing = state.riders.find(r => r.id === profile.id);

    let lat, lng;
    const startBaseLat = ride.waypoints?.[0]?.lat || ride.start_lat || ride.startLat || 12.9716;
    const startBaseLng = ride.waypoints?.[0]?.lng || ride.start_lng || ride.startLng || 77.5946;

    if (isMe) {
      lat = state.userGps?.lat ?? existing?.lat ?? m.last_lat ?? m.lastLat ?? startBaseLat;
      lng = state.userGps?.lng ?? existing?.lng ?? m.last_lng ?? m.lastLng ?? startBaseLng;
    } else {
      lat = existing?.lat ?? m.last_lat ?? m.lastLat ?? (startBaseLat + idx * 0.003);
      lng = existing?.lng ?? m.last_lng ?? m.lastLng ?? (startBaseLng + idx * 0.003);
    }

    let distStr = '0.0 km';
    if (!isMe) {
      const d = calculateDistanceKm(myLat, myLng, lat, lng);
      if (d !== null) {
        distStr = d >= 10 ? `${Math.round(d)} km away` : `${d.toFixed(1)} km away`;
      }
    }

    return {
      id: profile.id,
      name: profile.name,
      phone: profile.phone,
      bike: profile.bikeModel,
      avatar: profile.avatar || profile.name[0],
      avatarColor: profile.avatarColor || (isLead ? '#FF6B00' : '#00E5FF'),
      isMe,
      isLead,
      role: m.role || (isLead ? 'creator' : 'rider'),
      lat,
      lng,
      speed: existing?.speed ?? (m.speed || 0),
      heading: existing?.heading ?? (m.heading || 0),
      status: existing?.status ?? (m.status || 'riding'),
      distFromMe: isMe ? '0.0 km' : distStr,
      battery: existing?.battery ?? (m.battery || 95),
      lastSeen: existing?.lastSeen || (m.last_seen || 'Live'),
      isSeparated: false
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

  // Sync URL and LocalStorage session state
  updateUrlAndSessionState(screenId, state.currentRide);

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

  // Active & In-Progress Rides from DB (visible until ride ends)
  const rides = RideSyncDB.getRides();
  const activeRides = rides.filter(r => r.status === 'active' || r.status === 'lobby' || r.status === 'planned');
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
      activeContainer.innerHTML = activeRides.map(ride => {
        const isLive = ride.status === 'active';
        const isLobby = ride.status === 'lobby';

        return `
          <div class="ride-card active-ride-card ${isLive ? 'is-live-card' : ''}" onclick="selectAndOpenRide('${ride.id}')">
            <div class="ride-card-header">
              <div>
                ${isLive ? `
                  <span class="ride-tag live-pulsing" style="background:rgba(0,230,118,0.18); color:#00E676; border:1px solid rgba(0,230,118,0.4); font-weight:800; display:inline-flex; align-items:center; gap:6px;">
                    <span class="status-pulse-dot" style="background:#00E676;"></span> 🟢 LIVE IN PROGRESS
                  </span>
                ` : `
                  <span class="ride-tag upcoming">🏍️ Lobby Open · ${ride.date || 'Today'}</span>
                `}
                <h3 class="ride-name" style="margin-top:6px;">${ride.name}</h3>
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
                  const p = RideSyncDB.getProfile(m.userId || m.user_id);
                  return `<div class="avatar-sm" style="background:${p?.avatarColor || '#FF6B00'}" title="${p?.name || 'Rider'}">${p?.avatar || p?.name?.[0] || 'R'}</div>`;
                }).join('')}
                <span class="rider-count-text">${ride.members?.length || 1} Riders Joined</span>
              </div>
              <div class="ride-meta">
                <span>📍 ${ride.distanceKm || 0} km</span>
                <span>⏱️ ~${ride.durationHours || 1} hrs</span>
              </div>
            </div>

            <button class="btn-enter-lobby" style="${isLive ? 'background:var(--primary-orange); box-shadow:0 4px 14px rgba(255,107,0,0.4);' : ''}" onclick="event.stopPropagation(); selectAndOpenRide('${ride.id}');">
              ${isLive ? 'ENTER LIVE COCKPIT ⚡' : 'OPEN RIDE LOBBY 🏍️'}
            </button>
          </div>
        `;
      }).join('');
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
  const ride = state.currentRide || RideSyncDB.getRide(rideId);
  if (ride && ride.status === 'active') {
    startLiveRideSession();
  } else {
    navigateTo('screenRideLobby');
  }
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
  const isLead = ride.creator_id === activeUser.id || 
                 ride.creatorId === activeUser.id || 
                 (ride.members || []).some(m => (m.userId === activeUser.id || m.user_id === activeUser.id) && (m.role === 'creator' || m.isLead)) ||
                 !ride.creator_id || 
                 (!ride.members || ride.members.length <= 1);

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

  if (isLead || ride.status === 'active') {
    if (btnStart) {
      btnStart.style.display = 'block';
      btnStart.disabled = false;
      btnStart.innerText = ride.status === 'active' ? '🚀 RIDE IN PROGRESS — ENTER COCKPIT' : '🚀 START LIVE RIDE NOW';
      btnStart.style.background = 'var(--primary-orange)';
      btnStart.onclick = () => handleStartLiveRide();
    }
    if (waitingHint) waitingHint.style.display = 'none';
  } else if (isMyMembershipPending) {
    if (btnStart) {
      btnStart.style.display = 'block';
      btnStart.disabled = true;
      btnStart.innerText = '⏳ JOIN REQUEST PENDING APPROVAL';
      btnStart.style.background = '#374151';
      btnStart.onclick = null;
    }
    if (waitingHint) {
      waitingHint.style.display = 'block';
      waitingHint.innerText = '⏳ The Ride Lead has been notified. You will enter the lobby once approved.';
    }
  } else {
    // Approved Member - allow starting / entering cockpit
    if (btnStart) {
      btnStart.style.display = 'block';
      btnStart.disabled = false;
      btnStart.innerText = '🚀 ENTER LIVE COCKPIT';
      btnStart.style.background = 'var(--primary-orange)';
      btnStart.onclick = () => handleStartLiveRide();
    }
    if (waitingHint) {
      waitingHint.style.display = 'none';
    }
  }
}

// Lead Approves a Pending Member
async function handleLeadApprove(userId) {
  const activeUser = RideSyncDB.getActiveUser();
  await RideSyncDB.approveMember(state.currentRideId, userId, activeUser.id, 'approve');
  showToast('✅ Rider approved and added to ride!', 'success');
  refreshLobbyData();
}

// Lead Declines a Pending Member
async function handleLeadDecline(userId) {
  const activeUser = RideSyncDB.getActiveUser();
  await RideSyncDB.approveMember(state.currentRideId, userId, activeUser.id, 'decline');
  showToast('❌ Join request declined', 'info');
  refreshLobbyData();
}

// Launch the Live Ride
async function handleStartLiveRide() {
  const db = window.RideSyncDB || window.PayanamDB;
  const activeUser = db ? db.getActiveUser() : { id: 'usr-bose', name: 'Rider' };
  const targetRideId = state.currentRideId || state.currentRide?.id || (db ? db.getRides()[0]?.id : null);

  if (targetRideId) {
    state.currentRideId = targetRideId;
    if (state.currentRide) state.currentRide.status = 'active';
    try {
      if (db && db.startLiveRide) {
        await db.startLiveRide(targetRideId, activeUser ? activeUser.id : 'lead');
      }
    } catch (e) {
      console.warn('startLiveRide API notification:', e);
    }

    // Broadcast to all WebSocket members
    if (window.PayanamRealtime) {
      PayanamRealtime.broadcast({ type: 'ride_started', rideId: targetRideId });
    }
  }

  startLiveRideSession();
}

function startLiveRideSession() {
  closeModal('modalJoinRequestStatus');
  closeModal('modalJoinApprovalPrompt');
  if (state.currentRide) state.currentRide.status = 'active';
  state.isNavFollowMode = true;
  navigateTo('screenLiveMap');
  showToast('🚀 Ride Started! Journey Mode Active', 'success');
  setTimeout(() => {
    // Initialize journey mode with enhanced features
    RideSyncEnhancements.initializeJourneyMode();
    RideSyncEnhancements.smartRecenter(null, {
      duration: 800,
      enableFollow: true,
      showFeedback: false
    });
    RideSyncEnhancements.startIntelligentLocationFollow();
  }, 400);
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
        const activeUser = RideSyncDB.getActiveUser();
        const myMember = (current.members || []).find(m => (m.userId || m.user_id) === activeUser?.id);
        const isApproved = myMember && (myMember.status === 'ready' || myMember.status === 'active' || myMember.role === 'creator' || myMember.isLead);

        // If ride is already in progress and this rider is approved, enter cockpit immediately
        if (current.status === 'active' && isApproved && state.activeScreen === 'screenRideLobby') {
          startLiveRideSession();
          return;
        }

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

    // Polling fallback every 3s (syncs lobby and live peer locations)
    clearInterval(pollInterval);
    pollInterval = setInterval(async () => {
      if (!state.currentRideId) return;

      if (state.activeScreen === 'screenRideLobby') {
        refreshLobbyData();
      } else if (state.activeScreen === 'screenLiveMap') {
        const apiBase = RideSyncDB.getApiBaseUrl();
        try {
          const res = await fetch(`${apiBase}/rides`);
          if (res.ok) {
            const rides = await res.json();
            const current = rides.find(r => r.id === state.currentRideId);
            if (current && current.members) {
              syncRidersFromDb(current);
              renderRiderMarkers();
              renderRiderTelemetryCards();
            }
          }
        } catch(e) {}
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
      
      // If the ride is already in progress, immediately enter live cockpit!
      if (msg.rideStatus === 'active' || state.currentRide?.status === 'active') {
        showToast('🚀 Ride is already in progress! Entering cockpit...', 'success');
        startLiveRideSession();
        return;
      }
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
    if (msg.ride) {
      state.currentRide = msg.ride;
      state.currentRideId = msg.ride.id;
    }
    if (state.activeScreen === 'screenRideLobby') {
      showToast('🚀 Lead launched the ride! Entering live map cockpit...', 'success');
      startLiveRideSession();
    } else if (state.activeScreen === 'screenLiveMap') {
      if (msg.ride) drawRideRoutePath(msg.ride);
    }
  } else if (msg.type === 'ride_ended') {
    showToast('🏁 The Ride Lead has completed the ride!', 'info');
    if (state.currentRide) state.currentRide.status = 'completed';
    localStorage.removeItem('ridesync_active_screen');
    renderRideSummary();
    navigateTo('screenRideSummary');
  } else if (msg.type === 'location_update') {
    // Process real-time location update from peer rider
    if (msg.userId && msg.userId !== activeUser.id && typeof msg.lat === 'number' && typeof msg.lng === 'number') {
      let rider = (state.riders || []).find(r => r.id === msg.userId);
      const myRider = (state.riders || []).find(r => r.isMe || r.id === activeUser.id);
      const myLat = myRider?.lat || state.userGps?.lat;
      const myLng = myRider?.lng || state.userGps?.lng;

      let distStr = '';
      if (myLat && myLng && msg.lat && msg.lng) {
        const d = calculateDistanceKm(myLat, myLng, msg.lat, msg.lng);
        if (d !== null) {
          distStr = d >= 10 ? `${Math.round(d)} km away` : `${d.toFixed(1)} km away`;
        }
      }

      if (rider) {
        rider.lat = msg.lat;
        rider.lng = msg.lng;
        rider.speed = msg.speed !== undefined ? msg.speed : rider.speed;
        rider.heading = msg.heading !== undefined ? msg.heading : rider.heading;
        rider.battery = msg.battery !== undefined ? msg.battery : rider.battery;
        rider.status = msg.status || 'riding';
        rider.lastSeen = msg.lastSeen || 'Just now';
        if (distStr) rider.distFromMe = distStr;
      } else {
        const profile = RideSyncDB.getProfile(msg.userId) || {
          id: msg.userId,
          name: msg.name || 'Rider',
          bikeModel: 'Motorcycle',
          avatar: (msg.name || 'R')[0],
          avatarColor: '#00E5FF'
        };

        state.riders.push({
          id: profile.id,
          name: profile.name,
          phone: profile.phone || '',
          bike: profile.bikeModel,
          avatar: profile.avatar || profile.name[0],
          avatarColor: profile.avatarColor || '#00E5FF',
          isMe: false,
          isLead: false,
          role: 'rider',
          lat: msg.lat,
          lng: msg.lng,
          speed: msg.speed || 0,
          heading: msg.heading || 0,
          status: msg.status || 'riding',
          distFromMe: distStr || 'Connected',
          battery: msg.battery || 95,
          lastSeen: 'Just now',
          isSeparated: false
        });

        showToast(`📍 Peer location received from ${msg.name || 'Rider'} (${distStr})`, 'info');
      }

      renderRiderMarkers();
      renderRiderTelemetryCards();
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
    } else if (res.ride?.status === 'active') {
      showToast('🚀 Ride is active! Entering live cockpit...', 'success');
      startLiveRideSession();
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
// LIVE GPS BROADCAST & MULTI-RIDER REALTIME TELEMETRY
// -------------------------------------------------------------
let lastTelemetryBroadcastTime = 0;

function broadcastMyLiveLocation(lat, lng, speed = 0, heading = 0) {
  const db = window.RideSyncDB || window.PayanamDB;
  const activeUser = db ? db.getActiveUser() : null;
  const currentRide = state.currentRide || (db ? db.getRides()[0] : null);
  if (typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) return;

  state.userGps = { lat, lng, speed: Math.round(speed || 0), heading: Math.round(heading || 0) };

  // Update my rider coordinates in state.riders
  state.riders = state.riders || [];
  let myRider = state.riders.find(r => r.isMe || (activeUser && (r.id === activeUser.id || r.name === activeUser.name)));
  if (myRider) {
    myRider.lat = lat;
    myRider.lng = lng;
    myRider.speed = Math.max(0, speed || 0);
    myRider.heading = Math.round(heading || 0);
    myRider.isMe = true;
    myRider.status = (speed || 0) > 2 ? 'riding' : 'stopped';
    myRider.lastSeen = 'Just now';
  } else {
    myRider = {
      id: activeUser ? activeUser.id : 'user-me',
      name: activeUser ? activeUser.name : 'You',
      bike: activeUser ? (activeUser.bike || activeUser.bikeModel || 'Motorcycle') : 'Motorcycle',
      avatarColor: activeUser ? (activeUser.avatarColor || '#00E5FF') : '#00E5FF',
      isMe: true,
      isLead: false,
      lat: lat,
      lng: lng,
      speed: Math.max(0, speed || 0),
      heading: Math.round(heading || 0),
      battery: 95,
      status: (speed || 0) > 2 ? 'riding' : 'stopped',
      lastSeen: 'Just now'
    };
    state.riders.unshift(myRider);
  }

  // Recalculate distance from me to all other riders
  state.riders.forEach(r => {
    if (!r.isMe && typeof r.lat === 'number' && typeof r.lng === 'number') {
      const d = calculateDistanceKm(lat, lng, r.lat, r.lng);
      if (d !== null) {
        r.distFromMe = d >= 10 ? `${Math.round(d)} km away` : `${d.toFixed(1)} km away`;
      }
    }
  });

  // Use enhanced smooth marker animation
  if (myRider && state.riderMarkers[myRider.id]) {
    const oldPos = state.riderMarkers[myRider.id].getLatLng();
    RideSyncEnhancements.updateRiderLocationWithoutFlicker(myRider.id, oldPos.lat, oldPos.lng, lat, lng, speed, heading);
  }

  renderRiderMarkers();
  renderRiderTelemetryCards();

  // If Ride Navigation follow mode is active, smoothly track rider with intelligent follow
  if (state.isNavFollowMode && state.map && RideSyncEnhancements.isFollowingEnabled()) {
    state.map.panTo([lat, lng], { animate: true, duration: 0.45, easeLinearity: 0.25 });
  }

  const now = Date.now();
  if (now - lastTelemetryBroadcastTime > 1500) {
    lastTelemetryBroadcastTime = now;

    const payload = {
      type: 'location_update',
      rideId: currentRide?.id,
      userId: activeUser ? activeUser.id : 'user-me',
      name: activeUser ? activeUser.name : 'You',
      lat,
      lng,
      speed: Math.round(speed || 0),
      heading: Math.round(heading || 0),
      battery: 95,
      status: (speed || 0) > 2 ? 'riding' : 'stopped'
    };

    // 1. Broadcast over WebSocket to peer riders
    if (window.PayanamRealtime) {
      PayanamRealtime.broadcast(payload);
    }

    // 2. Persist to server SQLite database
    if (currentRide?.id && db && db.sendRiderTelemetry) {
      db.sendRiderTelemetry(currentRide.id, payload);
    }
  }
}

function updateGpsAccuracyMetrics() {
  const metrics = PayanamMaps.getGpsMetrics();

  if (!metrics.isActive) return;

  const accuracyEl = document.getElementById('gpsStatusLabel');
  if (accuracyEl) {
    let quality = '🔴 Poor';
    if (metrics.kalmanAccuracy < 5) quality = '🟢 Excellent (±5m)';
    else if (metrics.kalmanAccuracy < 10) quality = '🟢 Very Good (±10m)';
    else if (metrics.kalmanAccuracy < 20) quality = '🟡 Good (±20m)';
    else if (metrics.kalmanAccuracy < 50) quality = '🟠 Fair (±50m)';

    accuracyEl.innerText = quality;
  }
}

function startLiveGpsBroadcast() {
  if (navigator.geolocation) {
    // Immediate one-shot fix
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const speed = pos.coords.speed ? Math.max(0, pos.coords.speed * 3.6) : 0;
        broadcastMyLiveLocation(pos.coords.latitude, pos.coords.longitude, speed, pos.coords.heading || 0);
      },
      () => {},
      { enableHighAccuracy: true, timeout: 5000 }
    );

    // Continuous GPS watch with Kalman filtering
    PayanamMaps.startLiveGpsTracking(
      state.map,
      (pos) => {
        broadcastMyLiveLocation(pos.lat, pos.lng, pos.speed || 0, pos.heading || 0);

        const speedEl = document.getElementById('navCurrentSpeed');
        if (speedEl) speedEl.innerText = `${Math.round(pos.speed || 0)} km/h`;

        // Update accuracy metrics
        updateGpsAccuracyMetrics();
      },
      (errMsg) => {
        console.warn('GPS watch notice:', errMsg);
      }
    );

    const label = document.getElementById('gpsStatusLabel');
    const icon = document.getElementById('gpsBtnIcon');
    if (label) label.innerText = 'KALMAN GPS 🛰️';
    if (icon) icon.innerText = '🟢';

    // Periodic metric updates
    setInterval(() => {
      if (PayanamMaps.isGpsActive()) {
        updateGpsAccuracyMetrics();
      }
    }, 1000);
  }
}

// Fit map viewport to encompass all riders (e.g. Bangalore & Chennai)
function fitAllRidersInView() {
  if (!state.map || !state.riders || state.riders.length === 0) return;
  state.isNavFollowMode = false;
  updateRecenterButtonUI();
  const validCoords = state.riders
    .filter(r => typeof r.lat === 'number' && typeof r.lng === 'number' && !isNaN(r.lat) && !isNaN(r.lng))
    .map(r => [r.lat, r.lng]);

  if (validCoords.length === 1) {
    state.map.setView(validCoords[0], 15);
    showToast(`🎯 Centered on ${state.riders[0].name}`, 'info');
  } else if (validCoords.length > 1) {
    const bounds = L.latLngBounds(validCoords);
    state.map.fitBounds(bounds, { padding: [60, 60], maxZoom: 15, animate: true });
    showToast(`👥 Formation: Viewing all ${validCoords.length} riders across locations`, 'info');
  }
}

// -------------------------------------------------------------
// LIVE MAP ENGINE (Leaflet & Telemetry Simulation)
// -------------------------------------------------------------
async function initOrUpdateLiveMap() {
  const mapContainer = document.getElementById('liveRideMap');
  if (!mapContainer) return;

  const ride = state.currentRide || PayanamDB.getRides()[0];
  const activeUser = PayanamDB.getActiveUser();
  const myRider = (state.riders || []).find(r => r.isMe || (activeUser && r.id === activeUser.id)) || (state.riders || [])[0];
  const centerLat = state.userGps?.lat ?? myRider?.lat ?? ride.waypoints?.[0]?.lat ?? ride.start_lat ?? 12.9716;
  const centerLng = state.userGps?.lng ?? myRider?.lng ?? ride.waypoints?.[0]?.lng ?? ride.start_lng ?? 77.5946;

  // Connect WebSocket channel for this live ride
  if (ride && ride.id) {
    PayanamRealtime.connect(ride.id);
  }

  if (!state.map) {
    state.map = L.map('liveRideMap', {
      zoomControl: false,
      attributionControl: false,
      fadeAnimation: true,
      zoomAnimation: true,
      maxZoom: 21
    }).setView([centerLat, centerLng], 18.5);

    // Attach user gesture listeners to pause auto-follow mode when user pans away
    state.map.on('dragstart', () => {
      state.isNavFollowMode = false;
      updateRecenterButtonUI();
    });
    state.map.on('zoomstart', (e) => {
      if (e && e.originalEvent) {
        state.isNavFollowMode = false;
        updateRecenterButtonUI();
      }
    });

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

  // Render Live Riders & Start Live Telemetry Broadcast
  renderRiderMarkers();
  renderRiderTelemetryCards();
  startLiveGpsBroadcast();

  // Draw Full Ride Path Corridor & Waypoints
  drawRideRoutePath(ride);

  // Sync latest full ride route with all waypoints from backend server
  if (ride && ride.id) {
    const apiBase = RideSyncDB.getApiBaseUrl();
    fetch(`${apiBase}/rides`)
      .then(res => res.json())
      .then(rides => {
        if (Array.isArray(rides)) {
          const current = rides.find(r => r.id === ride.id);
          if (current) {
            state.currentRide = current;
            drawRideRoutePath(current);
          }
        }
      })
      .catch(() => {});
  }

  // Immediately center on rider in Google Maps street-level Ride Navigation View
  setTimeout(() => {
    try { 
      state.map.invalidateSize();
      if (state.isNavFollowMode !== false) {
        recenterOnGroup(false);
      }
    } catch(e) {}
  }, 250);
}

// Draw Complete Ride Route Path & Waypoints on Live Map for Lead and All Group Riders
function drawRideRoutePath(ride) {
  if (!state.map || !ride) return;

  // 1. Reconstruct waypoints if array is missing or incomplete
  let waypoints = Array.isArray(ride.waypoints) ? [...ride.waypoints] : [];
  if (waypoints.length < 2) {
    const sLat = ride.start_lat ?? ride.startLat;
    const sLng = ride.start_lng ?? ride.startLng;
    const dLat = ride.dest_lat ?? ride.destLat;
    const dLng = ride.dest_lng ?? ride.destLng;
    if (typeof sLat === 'number' && typeof sLng === 'number' && typeof dLat === 'number' && typeof dLng === 'number') {
      waypoints = [
        { id: 1, name: ride.start_address || ride.startAddress || 'Start Point', type: 'start', icon: '🟢', lat: sLat, lng: sLng },
        { id: 999, name: ride.dest_address || ride.destAddress || 'Destination', type: 'destination', icon: '🏁', lat: dLat, lng: dLng }
      ];
      ride.waypoints = waypoints;
    }
  }

  if (waypoints.length < 2) return;

  const coords = waypoints.map(w => [w.lat, w.lng]);

  // 2. Draw immediate fallback straight line so polyline is immediately visible
  if (!state.routePolylineLayer) {
    state.routePolylineLayer = L.polyline(coords, {
      color: '#FF6B00',
      weight: 6,
      opacity: 0.9,
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(state.map);
  }

  // Render Waypoint Markers & Live Dropped Pins
  renderMapWaypoints(waypoints);
  renderMapPins(ride.pins || []);

  // 3. Fetch precision OSRM Road Geometry in the background (non-blocking)
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
        updateNavBanner(roadRoute.steps[0], roadRoute.distanceKm || ride.distance_km || ride.distanceKm || 0);
      }
    }
  }).catch(err => console.warn('Background OSRM route fetch notice:', err));
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
    startLiveGpsBroadcast();
    showToast('🛰️ Connected to Live Device GPS Hardware!', 'success');
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
    const headingDeg = rider.heading || 0;
    const navBeam = isMe ? `
      <div class="nav-beam-container" style="transform: rotate(${headingDeg}deg);">
        <div class="nav-heading-cone"></div>
        <div class="nav-heading-arrow">▲</div>
      </div>
    ` : '';

    const iconHtml = `
      <div class="rider-bike-marker ${markerClass}">
        ${navBeam}
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

function toggleF1TowerCollapse() {
  const tower = document.getElementById('f1TelemetryTower');
  if (tower) {
    tower.classList.toggle('is-collapsed');
  }
}

function renderRiderTelemetryCards() {
  const stackContainer = document.getElementById('f1RiderStack');
  const titleEl = document.getElementById('f1TowerTitle');
  const dbProfiles = RideSyncDB.getProfiles();
  const activeUser = RideSyncDB.getActiveUser();

  // If current ride members are not in state.riders yet, ensure we sync them
  if (state.currentRide && state.currentRide.members && (!state.riders || state.riders.length === 0)) {
    syncRidersFromDb(state.currentRide);
  }

  // Also ensure any member in ride.members is represented in state.riders
  if (state.currentRide?.members) {
    state.currentRide.members.forEach(m => {
      const memberId = m.userId || m.user_id;
      if (!state.riders.some(r => r.id === memberId)) {
        const p = dbProfiles.find(prof => prof.id === memberId) || { name: 'Rider', bikeModel: 'Motorcycle', avatar: 'R', avatarColor: '#00E5FF' };
        state.riders.push({
          id: memberId,
          name: p.name,
          phone: p.phone || '',
          bike: p.bikeModel,
          avatar: p.avatar || p.name[0],
          avatarColor: p.avatarColor || '#00E5FF',
          isMe: memberId === activeUser?.id,
          isLead: m.role === 'creator' || m.isLead || state.currentRide.creator_id === memberId,
          role: m.role || 'rider',
          lat: m.last_lat || state.currentRide.start_lat || 12.9716,
          lng: m.last_lng || state.currentRide.start_lng || 77.5946,
          speed: m.speed || 0,
          heading: m.heading || 0,
          status: m.status || 'riding',
          distFromMe: 'Connected',
          battery: m.battery || 95,
          lastSeen: 'Live',
          isSeparated: false
        });
      }
    });
  }

  // Sort riders: Leader first (P1), then others by speed/distance
  const sortedRiders = [...(state.riders || [])].sort((a, b) => {
    if (a.isLead) return -1;
    if (b.isLead) return 1;
    return (b.speed || 0) - (a.speed || 0);
  });

  const activeCount = sortedRiders.filter(r => r.status === 'riding' || r.speed > 0).length;

  if (titleEl) {
    titleEl.innerText = `FORMATION (${sortedRiders.length} RIDERS • ${activeCount} RIDING)`;
  }

  if (!stackContainer) return;

  if (sortedRiders.length === 0) {
    stackContainer.innerHTML = `<div style="padding:10px; font-size:11px; color:#94A3B8; text-align:center;">Waiting for group riders...</div>`;
    return;
  }

  stackContainer.innerHTML = sortedRiders.map((rider, idx) => {
    const profile = dbProfiles.find(p => p.id === rider.id || p.name === rider.name) || {};
    const isLead = rider.isLead || idx === 0;
    const isMe = rider.isMe || (activeUser && rider.id === activeUser.id);
    const isStopped = (rider.speed || 0) < 2 || rider.status === 'stopped';
    const isEmergency = rider.isSeparated || rider.status === 'emergency';
    const posLabel = isLead ? 'P1' : `P${idx + 1}`;

    let gapDisplay = 'LEADER';
    if (!isLead) {
      gapDisplay = rider.distFromMe && rider.distFromMe !== '0.0 km' ? `+${rider.distFromMe.replace(' away', '')}` : `+${(idx * 0.4).toFixed(1)} km`;
    }

    return `
      <div class="f1-rider-row ${isLead ? 'p1-lead' : ''} ${isMe ? 'is-me' : ''} ${isEmergency ? 'is-emergency' : ''}" onclick="centerMapOnRider('${rider.id}', ${rider.lat}, ${rider.lng})" title="Click to track ${rider.name} on map">
        <div class="f1-pos-badge">${posLabel}</div>
        <div class="f1-rider-avatar" style="border-color:${isMe ? '#00E5FF' : (rider.avatarColor || '#FF6B00')}">
          ${rider.avatar || rider.name[0]}
        </div>
        <div class="f1-rider-name-col">
          <span class="f1-name">${rider.name} ${isMe ? '<span class="f1-you">(You)</span>' : ''}</span>
          <span class="f1-bike-info">${rider.bike || profile.bikeModel || 'Motorcycle'}</span>
        </div>
        <div class="f1-telemetry-metrics">
          <span class="f1-speed ${isStopped ? 'speed-stopped' : ''}">${Math.round(rider.speed || 0)} <small>KM/H</small></span>
          <span class="f1-gap">${gapDisplay}</span>
        </div>
        <div class="f1-battery-pill">🔋${rider.battery || 95}%</div>
      </div>
    `;
  }).join('');
}

function centerMapOnRider(riderId, lat, lng) {
  if (state.map && typeof lat === 'number' && typeof lng === 'number' && !isNaN(lat) && !isNaN(lng)) {
    state.map.setView([lat, lng], 15, { animate: true });
    const rider = (state.riders || []).find(r => r.id === riderId);
    showToast(`🎯 Tracking ${rider ? rider.name : 'Rider'} (${rider?.bike || ''})`, 'info');
  }
}

// Live GPS Simulation Loop
function startTelemetrySimulation() {
  clearInterval(state.simInterval);
  state.simInterval = setInterval(() => {
    if (!state.isSimRunning) return;
    simStep += 0.0003;

    // Move leader and members along path
    (state.riders || []).forEach((rider, idx) => {
      if (rider.status === 'riding') {
        const stepLat = Math.cos(simStep + idx) * 0.00018;
        const stepLng = Math.sin(simStep + idx) * 0.00018;
        rider.lat += stepLat;
        rider.lng += stepLng;
        rider.heading = Math.round(((Math.atan2(stepLng, stepLat) * 180 / Math.PI) + 360) % 360);
        rider.speed = Math.max(45, Math.min(85, rider.speed + (Math.random() * 4 - 2)));
      }
    });

    renderRiderMarkers();
    renderRiderTelemetryCards();

    // If Ride Navigation follow mode is active, smoothly track user's rider like Google Maps
    const db = window.RideSyncDB || window.PayanamDB;
    const activeUser = db ? db.getActiveUser() : null;
    const myRider = (state.riders || []).find(r => r.isMe || (activeUser && (r.id === activeUser.id || r.name === activeUser.name)));
    if (myRider) {
      const speedEl = document.getElementById('navCurrentSpeed');
      if (speedEl) speedEl.innerText = `${Math.round(myRider.speed || 0)} km/h`;

      if (state.isNavFollowMode && state.map) {
        state.map.panTo([myRider.lat, myRider.lng], { animate: true, duration: 0.5, easeLinearity: 0.25 });
      }
    }
  }, 1200);
}

function toggleTelemetrySim() {
  state.isSimRunning = !state.isSimRunning;
  const icon = document.getElementById('simBtnIcon');
  if (icon) icon.innerText = state.isSimRunning ? '⏸️' : '▶️';
  showToast(state.isSimRunning ? '▶️ Telemetry Stream Active' : '⏸️ Telemetry Stream Paused', 'info');
}

let lastRecenterClickTime = 0;

// Update UI state of Recenter button in bottom HUD
function updateRecenterButtonUI() {
  // Use enhanced version
  RideSyncEnhancements.updateRecenterButtonSmartly();
}

// Toggle 3D Cockpit Ride Perspective (Google Maps style forward road perspective)
function toggleCockpit3dPerspective() {
  const mapEl = document.getElementById('liveRideMap');
  const btn = document.getElementById('btnCockpit3d');
  if (!mapEl) return;

  state.is3dCockpit = !state.is3dCockpit;
  if (state.is3dCockpit) {
    mapEl.classList.add('cockpit-3d-active');
    if (btn) btn.innerHTML = '🗺️ 2D View';
    showToast('🕶️ 3D Cockpit Navigation View Active', 'info');
  } else {
    mapEl.classList.remove('cockpit-3d-active');
    if (btn) btn.innerHTML = '🕶️ 3D View';
    showToast('🗺️ Top-Down 2D Road View Active', 'info');
  }

  setTimeout(() => {
    if (state.map) state.map.invalidateSize();
  }, 250);
}

// Enhanced Recenter with intelligent zoom and follow mode
function recenterOnGroup(showFeedback = true) {
  if (!state.map) return;
  try { state.map.invalidateSize(); } catch(e) {}

  const now = Date.now();
  const isDoubleTap = (now - lastRecenterClickTime) < 500;
  lastRecenterClickTime = now;

  // Double-tap to toggle 3D perspective
  if (isDoubleTap) {
    toggleCockpit3dPerspective?.();
    return;
  }

  // Use enhanced smart recenter
  RideSyncEnhancements.smartRecenter(null, {
    duration: 1000,
    zoom: null, // Auto-determine based on rider count
    enableFollow: true,
    showFeedback: showFeedback,
    smooth: true
  });

  // Throttled refresh of GPS position
  RideSyncEnhancements.throttledGetCurrentPosition(
    (pos) => {
      const liveLat = pos.coords.latitude;
      const liveLng = pos.coords.longitude;
      state.userGps = { lat: liveLat, lng: liveLng, accuracy: pos.coords.accuracy };

      const activeUser = PayanamDB.getActiveUser();
      const myRider = (state.riders || []).find(r => r.isMe || (activeUser && r.id === activeUser.id));
      if (myRider) {
        myRider.lat = liveLat;
        myRider.lng = liveLng;
      }

      renderRiderMarkers();
      renderRiderTelemetryCards();
    },
    () => {},
    { enableHighAccuracy: true, timeout: 3500 }
  );
}

function openLiveRide() {
  const activeRide = state.currentRide || PayanamDB.getRides().find(r => r.status === 'active') || PayanamDB.getRides()[0];
  if (activeRide) {
    state.currentRide = activeRide;
    state.currentRideId = activeRide.id;
  }
  startLiveRideSession();
}
window.openLiveRide = openLiveRide;

function toggleSheetExpand() {
  const sheet = document.getElementById('ridersBottomSheet');
  if (sheet) {
    state.isSheetExpanded = !state.isSheetExpanded;
    sheet.classList.toggle('expanded', state.isSheetExpanded);
  }
}

async function confirmExitRide() {
  const activeUser = RideSyncDB.getActiveUser();
  const ride = state.currentRide;
  const isLead = ride && (ride.creator_id === activeUser?.id || ride.creatorId === activeUser?.id);

  if (isLead) {
    const choice = confirm('🏁 As Ride Lead, do you want to END & COMPLETE this ride for all riders?\n\n• OK: Complete ride and conclude group session\n• Cancel: Go to home screen while ride stays active');
    if (choice) {
      await RideSyncDB.endLiveRide(ride.id, activeUser.id);
      PayanamRealtime.broadcast({ type: 'ride_ended', rideId: ride.id, status: 'completed' });
      localStorage.removeItem('ridesync_active_ride_code');
      localStorage.removeItem('ridesync_active_screen');
      showToast('🏁 Ride completed successfully!', 'success');
      renderRideSummary();
      navigateTo('screenRideSummary');
      return;
    }
  }

  // Go to home screen while ride stays active in Active Rides
  navigateTo('screenHome');
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

