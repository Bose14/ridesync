/**
 * RideSync Database & API Client
 * Connects to the local relational SQLite database server (http://localhost:5000)
 * backing the physical file `server/ridesync.db`, with graceful local fallback
 * and instant capability to switch to live Supabase / PostgreSQL.
 */

const RideSyncDB = (function () {
  function resolveApiBase() {
    if (typeof window !== 'undefined' && window.__RIDESYNC_API_URL__) {
      return window.__RIDESYNC_API_URL__;
    }
    try {
      const custom = localStorage.getItem('ridesync_custom_api_base');
      if (custom) return custom.replace(/\/+$/, '');
    } catch (e) {}

    if (typeof window !== 'undefined') {
      if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        return 'http://localhost:5000/api';
      }
      // Production live backend on Render
      return 'https://ridesync-yibf.onrender.com/api';
    }
    return 'https://ridesync-yibf.onrender.com/api';
  }

  const API_BASE = resolveApiBase();
  const DB_KEY = 'ridesync_db_v3_clean';
  const SESSION_KEY = 'ridesync_active_user_id';
  const MAP_CONFIG_KEY = 'ridesync_map_config';

  let isServerConnected = false;

  // Default test data for development (remove in production)
  const defaultDatabase = {
    profiles: [
      {
        id: 'usr-bose',
        name: 'Bose',
        phone: '9876543210',
        phoneFormatted: '+91 98765 43210',
        avatar: 'B',
        avatarColor: '#FF6B00',
        bikeModel: 'Royal Enfield Interceptor 650',
        bloodGroup: 'O+ve',
        emergencyContactName: 'Emergency Contact',
        emergencyContactPhone: '9876543210',
        ridesCount: 12,
        totalKm: 2450,
        roleDefault: 'Rider'
      },
      {
        id: 'usr-rider2',
        name: 'Alex Kumar',
        phone: '9988776655',
        phoneFormatted: '+91 99887 76655',
        avatar: 'A',
        avatarColor: '#00E5FF',
        bikeModel: 'Bajaj Dominar 400',
        bloodGroup: 'B+ve',
        emergencyContactName: 'Mom',
        emergencyContactPhone: '9988776655',
        ridesCount: 8,
        totalKm: 1850,
        roleDefault: 'Rider'
      },
      {
        id: 'usr-rider3',
        name: 'Sarah Johnson',
        phone: '9123456789',
        phoneFormatted: '+91 91234 56789',
        avatar: 'S',
        avatarColor: '#00E676',
        bikeModel: 'Honda CB350',
        bloodGroup: 'A+ve',
        emergencyContactName: 'Dad',
        emergencyContactPhone: '9123456789',
        ridesCount: 15,
        totalKm: 3200,
        roleDefault: 'Rider'
      }
    ],
    rides: [
      {
        id: 'ride-kodai-2026',
        code: 'KODAI26',
        name: 'Bangalore to Kodaikanal Weekend Ride',
        date: '2026-10-12',
        time: '06:00',
        status: 'lobby',
        creatorId: 'usr-bose',
        creator_id: 'usr-bose',
        startAddress: 'Bangalore, Silk Board',
        startLat: 12.9176,
        startLng: 77.6233,
        start_lat: 12.9176,
        start_lng: 77.6233,
        destAddress: 'Kodaikanal, Pillar Rocks',
        destLat: 10.2185,
        destLng: 77.4682,
        dest_lat: 10.2185,
        dest_lng: 77.4682,
        distanceKm: 324.8,
        durationHours: 8.5,
        members: [
          { userId: 'usr-bose', user_id: 'usr-bose', role: 'creator', status: 'ready', isLead: true },
          { userId: 'usr-rider2', user_id: 'usr-rider2', role: 'rider', status: 'ready' }
        ],
        waypoints: [
          { id: 1, name: 'Bangalore, Silk Board', type: 'start', lat: 12.9176, lng: 77.6233 },
          { id: 2, name: 'Salem, Tea Stall', type: 'stop', lat: 12.0658, lng: 78.1458 },
          { id: 3, name: 'Coimbatore, Lunch Stop', type: 'stop', lat: 11.0026, lng: 76.9969 },
          { id: 999, name: 'Kodaikanal, Pillar Rocks', type: 'destination', lat: 10.2185, lng: 77.4682 }
        ],
        pins: []
      },
      {
        id: 'ride-ooty-2026',
        code: 'OOTY26',
        name: 'Chennai to Ooty Hill Station Adventure',
        date: '2026-10-15',
        time: '07:00',
        status: 'planned',
        creatorId: 'usr-rider2',
        creator_id: 'usr-rider2',
        startAddress: 'Chennai, Marina Beach',
        startLat: 13.0499,
        startLng: 80.2824,
        start_lat: 13.0499,
        start_lng: 80.2824,
        destAddress: 'Ooty, Botanical Garden',
        destLat: 11.4069,
        destLng: 76.7114,
        dest_lat: 11.4069,
        dest_lng: 76.7114,
        distanceKm: 286.5,
        durationHours: 7.2,
        members: [
          { userId: 'usr-rider2', user_id: 'usr-rider2', role: 'creator', status: 'ready', isLead: true },
          { userId: 'usr-rider3', user_id: 'usr-rider3', role: 'rider', status: 'ready' }
        ],
        waypoints: [
          { id: 1, name: 'Chennai, Marina Beach', type: 'start', lat: 13.0499, lng: 80.2824 },
          { id: 2, name: 'Krishnagiri, Fuel Stop', type: 'stop', lat: 12.5057, lng: 78.9076 },
          { id: 999, name: 'Ooty, Botanical Garden', type: 'destination', lat: 11.4069, lng: 76.7114 }
        ],
        pins: []
      }
    ]
  };

  function cleanDigits(phone) {
    if (!phone) return '';
    return String(phone).replace(/\D/g, '');
  }

  function matchPhone(p1, p2) {
    if (!p1 || !p2) return false;
    const clean1 = String(p1).replace(/[\s-]/g, '');
    const clean2 = String(p2).replace(/[\s-]/g, '');
    if (clean1 === clean2) return true;
    const d1 = cleanDigits(p1);
    const d2 = cleanDigits(p2);
    if (d1 && d2 && d1 === d2) return true;
    if (d1.length >= 10 && d2.length >= 10 && d1.slice(-10) === d2.slice(-10)) return true;
    return false;
  }

  function normalizeProfile(p) {
    if (!p) return null;
    const name = p.name || 'Rider';
    const cleanPhone = (p.phone || '').replace(/[\s-]/g, '');
    const phoneFormatted = p.phoneFormatted || p.phone_formatted || p.phone || '';
    return {
      ...p,
      id: p.id,
      name,
      username: p.username || (name.toLowerCase().replace(/[^a-z0-9]/g, '') + '_' + Math.floor(100 + Math.random() * 900)),
      phone: cleanPhone,
      phoneFormatted: phoneFormatted,
      phone_formatted: phoneFormatted,
      avatar: p.avatar || name[0].toUpperCase(),
      avatarColor: p.avatarColor || p.avatar_color || '#FF6B00',
      avatar_color: p.avatarColor || p.avatar_color || '#FF6B00',
      bikeModel: p.bikeModel || p.bike_model || 'Motorcycle',
      bike_model: p.bikeModel || p.bike_model || 'Motorcycle',
      bloodGroup: p.bloodGroup || p.blood_group || 'O+ve',
      blood_group: p.bloodGroup || p.blood_group || 'O+ve',
      emergencyContactName: p.emergencyContactName || p.emergency_contact_name || '',
      emergency_contact_name: p.emergencyContactName || p.emergency_contact_name || '',
      emergencyContactPhone: p.emergencyContactPhone || p.emergency_contact_phone || '',
      emergency_contact_phone: p.emergencyContactPhone || p.emergency_contact_phone || '',
      ridesCount: p.ridesCount !== undefined ? p.ridesCount : (p.rides_count !== undefined ? p.rides_count : 0),
      rides_count: p.rides_count !== undefined ? p.rides_count : (p.ridesCount !== undefined ? p.ridesCount : 0),
      totalKm: p.totalKm !== undefined ? p.totalKm : (p.total_km !== undefined ? p.total_km : 0),
      total_km: p.total_km !== undefined ? p.total_km : (p.totalKm !== undefined ? p.totalKm : 0),
      roleDefault: p.roleDefault || p.role_default || 'Rider',
      role_default: p.roleDefault || p.role_default || 'Rider',
      createdAt: p.createdAt || p.created_at || new Date().toISOString()
    };
  }

  // Sync state directly from live backend server on load
  async function syncFromServer() {
    try {
      const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(4500) });
      if (res.ok) {
        isServerConnected = true;
        console.log(`[RideSync] Live Backend Connected: ${API_BASE}`);

        // Fetch live profiles & rides from backend
        const [profilesRes, ridesRes] = await Promise.all([
          fetch(`${API_BASE}/profiles`).then(r => r.json()).catch(() => []),
          fetch(`${API_BASE}/rides`).then(r => r.json()).catch(() => [])
        ]);

        const serverProfiles = Array.isArray(profilesRes) ? profilesRes.map(normalizeProfile) : [];
        const serverRides = Array.isArray(ridesRes) ? ridesRes : [];

        const localDb = loadDb();

        // Bidirectional merge profiles: keep local profiles and sync missing ones to server
        const mergedProfiles = [...serverProfiles];
        (localDb.profiles || []).forEach(localP => {
          const idx = mergedProfiles.findIndex(sp => sp.id === localP.id || matchPhone(sp.phone, localP.phone));
          if (idx >= 0) {
            mergedProfiles[idx] = normalizeProfile({ ...localP, ...mergedProfiles[idx] });
          } else {
            mergedProfiles.push(localP);
            // Push offline/local profile to server
            fetch(`${API_BASE}/profiles`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(localP)
            }).catch(() => {});
          }
        });

        // Merge rides
        const mergedRides = [...serverRides];
        (localDb.rides || []).forEach(localR => {
          if (!mergedRides.some(sr => sr.id === localR.id)) {
            mergedRides.push(localR);
          }
        });

        const newDb = {
          profiles: mergedProfiles,
          rides: mergedRides
        };

        saveDb(newDb);

        // Keep active session user intact across reloads
        const activeId = localStorage.getItem(SESSION_KEY);
        if (activeId) {
          const activeUser = mergedProfiles.find(p => p.id === activeId || matchPhone(p.phone, activeId));
          if (activeUser) {
            localStorage.setItem(SESSION_KEY, activeUser.id);
            if (typeof updateUserHeaderUi === 'function') {
              updateUserHeaderUi(activeUser);
            }
          }
        }

        if (typeof reloadDynamicAppData === 'function') {
          reloadDynamicAppData();
        }

        return newDb;
      }
    } catch (e) {
      console.warn('[RideSync] Live backend unreachable, operating in local storage mode:', e.message);
      isServerConnected = false;
    }
    return null;
  }

  // Initial sync from server
  syncFromServer();

  function loadDb() {
    try {
      const stored = localStorage.getItem(DB_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed.profiles) && Array.isArray(parsed.rides)) {
          parsed.profiles = parsed.profiles.map(normalizeProfile);
          return parsed;
        }
      }
    } catch (e) {}
    saveDb(defaultDatabase);
    return JSON.parse(JSON.stringify(defaultDatabase));
  }

  function saveDb(data) {
    try {
      localStorage.setItem(DB_KEY, JSON.stringify(data));
    } catch (e) {}
  }

  function loadMapConfig() {
    try {
      const cfg = localStorage.getItem(MAP_CONFIG_KEY);
      if (cfg) {
        const parsed = JSON.parse(cfg);
        if (parsed.provider === 'carto-dark') parsed.provider = 'google-roadmap';
        return parsed;
      }
    } catch (e) {}
    return { provider: 'google-roadmap' };
  }

  function saveMapConfig(cfg) {
    try {
      localStorage.setItem(MAP_CONFIG_KEY, JSON.stringify(cfg));
    } catch (e) {}
  }

  function checkServerHealth() {
    return syncFromServer();
  }

  return {
    getApiBaseUrl() {
      return API_BASE;
    },
    isServerConnected() {
      return isServerConnected;
    },
    checkServerHealth,
    normalizeProfile,
    matchPhone,

    // Run Raw SQL query on Local Database Server
    async executeSql(sql) {
      try {
        const res = await fetch(`${API_BASE}/db/query`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sql })
        });
        return await res.json();
      } catch (e) {
        return { error: 'Could not connect to local database server at ' + API_BASE };
      }
    },

    // Session
    getActiveUserId() {
      return localStorage.getItem(SESSION_KEY) || '';
    },
    setActiveUserId(userId) {
      localStorage.setItem(SESSION_KEY, userId);
    },
    clearActiveUser() {
      localStorage.removeItem(SESSION_KEY);
    },
    getActiveUser() {
      const id = this.getActiveUserId();
      return this.getProfile(id) || this.getProfiles()[0] || null;
    },

    // Profiles
    getProfiles() {
      const db = loadDb();
      return (db.profiles || []).map(normalizeProfile);
    },
    getProfile(id) {
      if (!id) return null;
      const db = loadDb();
      const match = (db.profiles || []).find(p => p.id === id || matchPhone(p.phone, id) || matchPhone(p.phoneFormatted, id));
      return match ? normalizeProfile(match) : null;
    },
    getProfileByPhone(phone) {
      if (!phone) return null;
      const db = loadDb();
      const match = (db.profiles || []).find(p => matchPhone(p.phone, phone) || matchPhone(p.phoneFormatted, phone));
      return match ? normalizeProfile(match) : null;
    },
    async saveProfile(profileData) {
      const normalized = normalizeProfile(profileData);
      const db = loadDb();
      const idx = db.profiles.findIndex(p => p.id === normalized.id || matchPhone(p.phone, normalized.phone));
      if (idx >= 0) {
        db.profiles[idx] = { ...db.profiles[idx], ...normalized, updatedAt: new Date().toISOString() };
      } else {
        db.profiles.push({
          ...normalized,
          id: normalized.id || 'usr-' + Date.now(),
          createdAt: new Date().toISOString()
        });
      }
      saveDb(db);

      // Sync with local backend server if online
      try {
        fetch(`${API_BASE}/profiles`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(normalized)
        }).catch(() => {});
      } catch (e) {}

      return normalized;
    },

    createRiderAccount(data) {
      const existing = this.getProfileByPhone(data.phone);
      if (existing) {
        const updated = {
          ...existing,
          name: data.name || existing.name,
          bikeModel: data.bikeModel || existing.bikeModel,
          bike_model: data.bikeModel || existing.bikeModel,
          bloodGroup: data.bloodGroup || existing.bloodGroup,
          blood_group: data.bloodGroup || existing.bloodGroup,
          emergencyContactName: data.emergencyContactName || existing.emergencyContactName,
          emergency_contact_name: data.emergencyContactName || existing.emergencyContactName,
          emergencyContactPhone: data.emergencyContactPhone || existing.emergencyContactPhone,
          emergency_contact_phone: data.emergencyContactPhone || existing.emergencyContactPhone
        };
        this.saveProfile(updated);
        return updated;
      }

      const db = loadDb();
      const cleanPhone = (data.phone || '').replace(/[\s-]/g, '');
      const id = 'usr-' + Date.now();
      const newProfile = normalizeProfile({
        id,
        name: data.name || 'Rider',
        phone: cleanPhone,
        phoneFormatted: data.phone,
        username: (data.name || 'rider').toLowerCase().replace(/[^a-z0-9]/g, '') + '_' + Math.floor(100 + Math.random() * 900),
        avatar: (data.name || 'R')[0].toUpperCase(),
        avatarColor: ['#FF6B00', '#00E5FF', '#00E676', '#FFD600', '#E040FB'][Math.floor(Math.random() * 5)],
        bikeModel: data.bikeModel || 'Motorcycle',
        bloodGroup: data.bloodGroup || 'O+ve',
        emergencyContactName: data.emergencyContactName || 'Emergency Contact',
        emergencyContactPhone: data.emergencyContactPhone || '',
        ridesCount: 0,
        totalKm: 0,
        roleDefault: 'Rider',
        createdAt: new Date().toISOString()
      });
      db.profiles.push(newProfile);
      saveDb(db);

      // Sync with server
      try {
        fetch(`${API_BASE}/profiles`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newProfile)
        }).catch(() => {});
      } catch (e) {}

      return newProfile;
    },

    // Rides
    getRides() {
      const db = loadDb();
      return db.rides || [];
    },
    getRide(idOrCode) {
      const db = loadDb();
      return db.rides.find(r => r.id === idOrCode || r.code.toUpperCase() === (idOrCode || '').toUpperCase());
    },
    async createRide(rideData) {
      const db = loadDb();
      const currentUser = this.getActiveUser() || { id: 'usr-bose', name: 'Lead' };
      const id = 'ride-' + Date.now();
      const code = (rideData.name.replace(/[^A-Za-z]/g, '').slice(0, 5) + Math.floor(10 + Math.random() * 89)).toUpperCase();

      const newRide = {
        id,
        code,
        name: rideData.name || 'New Group Ride',
        description: rideData.description || 'Motorcycle group ride',
        creatorId: currentUser.id,
        date: rideData.date || new Date().toISOString().split('T')[0],
        time: rideData.time || '06:00',
        status: 'lobby',
        startAddress: rideData.startAddress || 'Start Point',
        startLat: rideData.startLat || 12.9176,
        startLng: rideData.startLng || 77.6233,
        destAddress: rideData.destAddress || 'Destination',
        destLat: rideData.destLat || 10.2185,
        destLng: rideData.destLng || 77.4682,
        distanceKm: rideData.distanceKm || 0,
        durationHours: rideData.durationHours || 0,
        members: [
          { userId: currentUser.id, role: 'creator', status: 'ready', isLead: true }
        ],
        waypoints: rideData.waypoints || [],
        pins: [],
        messages: [
          { id: 'msg-' + Date.now(), type: 'system', text: `🏍️ Ride lobby created by ${currentUser.name}`, time: 'Just now' }
        ],
        createdAt: new Date().toISOString()
      };

      db.rides.unshift(newRide);
      saveDb(db);

      // Sync with server
      try {
        const res = await fetch(`${API_BASE}/rides`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newRide)
        });
        const data = await res.json();
        if (data.rideId && data.code) {
          newRide.id = data.rideId;
          newRide.code = data.code;
        }
      } catch (e) {}

      return newRide;
    },

    updateRide(id, updates) {
      const db = loadDb();
      const idx = db.rides.findIndex(r => r.id === id);
      if (idx >= 0) {
        db.rides[idx] = { ...db.rides[idx], ...updates };
        saveDb(db);

        // Sync with local backend server
        try {
          fetch(`${API_BASE}/rides/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates)
          }).catch(() => {});
        } catch (e) {}

        return db.rides[idx];
      }
      return null;
    },

    async joinRide(rideCode, userId) {
      const db = loadDb();
      const currentUser = this.getProfile(userId) || this.getActiveUser();
      const cleanCode = (rideCode || '').trim().toUpperCase();

      let serverResponse = null;
      try {
        const res = await fetch(`${API_BASE}/rides/join`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code: cleanCode, userId: currentUser ? currentUser.id : userId })
        });
        serverResponse = await res.json();
      } catch (e) {}

      const ride = (serverResponse && serverResponse.ride) || db.rides.find(r => (r.code || '').toUpperCase() === cleanCode);
      if (!ride) return { success: false, error: 'Ride code not found. Please check the 6-character code.' };

      const isCreator = ride.creator_id === (currentUser ? currentUser.id : userId) || ride.creatorId === (currentUser ? currentUser.id : userId);
      const status = (serverResponse && serverResponse.status) || (isCreator ? 'ready' : 'pending');

      // Update local member
      const existingMember = (ride.members || []).find(m => m.userId === (currentUser ? currentUser.id : userId));
      if (!existingMember) {
        if (!ride.members) ride.members = [];
        ride.members.push({
          userId: currentUser ? currentUser.id : userId,
          role: isCreator ? 'creator' : 'rider',
          status,
          isLead: isCreator
        });
      } else {
        existingMember.status = status;
      }

      // Add to local DB if not already present
      const localIdx = db.rides.findIndex(r => r.id === ride.id);
      if (localIdx >= 0) {
        db.rides[localIdx] = ride;
      } else {
        db.rides.unshift(ride);
      }
      saveDb(db);

      return {
        success: true,
        ride,
        status,
        isCreator,
        message: isCreator ? 'Joined as Lead' : (status === 'ready' ? 'Joined Ride Lobby' : 'Join request sent to Ride Lead')
      };
    },

    async approveMember(rideId, memberUserId, leadUserId, action = 'approve') {
      const db = loadDb();
      const ride = db.rides.find(r => r.id === rideId);
      if (ride && ride.members) {
        if (action === 'approve') {
          const m = ride.members.find(mem => mem.userId === memberUserId);
          if (m) m.status = 'ready';
        } else {
          ride.members = ride.members.filter(mem => mem.userId !== memberUserId);
        }
        saveDb(db);
      }

      try {
        const res = await fetch(`${API_BASE}/rides/approve-member`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rideId, userId: memberUserId, leadId: leadUserId, action })
        });
        return await res.json();
      } catch (e) {
        return { success: true, localOnly: true };
      }
    },

    async startLiveRide(rideId, leadUserId) {
      const db = loadDb();
      const ride = db.rides.find(r => r.id === rideId);
      if (ride) {
        ride.status = 'active';
        saveDb(db);
      }

      try {
        const res = await fetch(`${API_BASE}/rides/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rideId, leadId: leadUserId })
        });
        return await res.json();
      } catch (e) {
        return { success: true, status: 'active' };
      }
    },

    // End Live Ride Session
    async endLiveRide(rideId, leadUserId) {
      const db = loadDb();
      const ride = db.rides.find(r => r.id === rideId);
      if (ride) {
        ride.status = 'completed';
        saveDb(db);
      }

      try {
        const res = await fetch(`${API_BASE}/rides/end`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rideId, leadId: leadUserId })
        });
        return await res.json();
      } catch (e) {
        return { success: true, status: 'completed' };
      }
    },

    // Waypoints
    saveWaypoints(rideId, waypoints) {
      const db = loadDb();
      const ride = db.rides.find(r => r.id === rideId);
      if (ride) {
        ride.waypoints = waypoints;
        saveDb(db);

        // Sync with local server
        try {
          fetch(`${API_BASE}/rides/${rideId}/waypoints`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ waypoints })
          }).catch(() => {});
        } catch (e) {}
      }
    },

    // Pins
    addPin(rideId, pin) {
      const db = loadDb();
      const ride = db.rides.find(r => r.id === rideId);
      if (ride) {
        const newPin = {
          id: 'pin-' + Date.now(),
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          ...pin
        };
        ride.pins.push(newPin);
        saveDb(db);

        // Sync with local server
        try {
          fetch(`${API_BASE}/rides/${rideId}/pins`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newPin)
          }).catch(() => {});
        } catch (e) {}

        return newPin;
      }
    },

    // Chat Messages
    addMessage(rideId, msg) {
      const db = loadDb();
      const ride = db.rides.find(r => r.id === rideId);
      if (ride) {
        const newMsg = {
          id: 'msg-' + Date.now(),
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          ...msg
        };
        ride.messages.push(newMsg);
        saveDb(db);

        // Sync with local server
        try {
          fetch(`${API_BASE}/rides/${rideId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newMsg)
          }).catch(() => {});
        } catch (e) {}

        return newMsg;
      }
    },

    // Update Live Rider Telemetry (GPS coordinates, speed, heading, battery)
    async sendRiderTelemetry(rideId, telemetry) {
      if (!rideId || !telemetry.userId) return;

      // Update in local database state
      const db = loadDb();
      const ride = (db.rides || []).find(r => r.id === rideId);
      if (ride && ride.members) {
        const member = ride.members.find(m => (m.userId || m.user_id) === telemetry.userId);
        if (member) {
          member.last_lat = telemetry.lat;
          member.last_lng = telemetry.lng;
          member.speed = telemetry.speed ?? member.speed;
          member.heading = telemetry.heading ?? member.heading;
          member.battery = telemetry.battery ?? member.battery;
          member.status = telemetry.status || member.status;
          member.last_seen = telemetry.lastSeen || 'Just now';
          saveDb(db);
        }
      }

      // Sync with backend server
      if (isServerConnected) {
        try {
          await fetch(`${API_BASE}/rides/${rideId}/telemetry`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(telemetry)
          });
        } catch (e) {}
      }
    },

    // Map & API Configuration
    getMapConfig: loadMapConfig,
    setMapConfig: saveMapConfig,

    resetToDefault() {
      saveDb(defaultDatabase);
      return defaultDatabase;
    }
  };
})();

// Payanam Namespace Alias
const PayanamDB = RideSyncDB;

