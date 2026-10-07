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
  const DB_KEY = 'ridesync_db_v2';
  const SESSION_KEY = 'ridesync_active_user_id';
  const MAP_CONFIG_KEY = 'ridesync_map_config';

  let isServerConnected = false;

  // Check connection to local database server on startup
  async function checkServerHealth() {
    try {
      const res = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(1500) });
      if (res.ok) {
        const data = await res.json();
        isServerConnected = true;
        console.log('[RideSync] Connected to Local SQLite DB Server (ridesync.db):', data);
        return data;
      }
    } catch (e) {
      console.warn('[RideSync] Local server offline, using local storage database mode.');
      isServerConnected = false;
    }
    return null;
  }

  // Initial health check
  checkServerHealth();

  // Clean Sandbox Storage Baseline
  const defaultDatabase = {
    profiles: [],
    rides: []
  };

  function loadDb() {
    try {
      const stored = localStorage.getItem(DB_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed.profiles) && Array.isArray(parsed.rides)) return parsed;
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

  return {
    getApiBaseUrl() {
      return API_BASE;
    },
    isServerConnected() {
      return isServerConnected;
    },
    checkServerHealth,

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
      return localStorage.getItem(SESSION_KEY) || 'usr-bose';
    },
    setActiveUserId(userId) {
      localStorage.setItem(SESSION_KEY, userId);
    },
    clearActiveUser() {
      localStorage.removeItem(SESSION_KEY);
    },
    getActiveUser() {
      const id = this.getActiveUserId();
      return this.getProfile(id) || this.getProfiles()[0];
    },

    // Profiles
    getProfiles() {
      const db = loadDb();
      return db.profiles || [];
    },
    getProfile(id) {
      const db = loadDb();
      return db.profiles.find(p => p.id === id || p.phone === id);
    },
    getProfileByPhone(phone) {
      const db = loadDb();
      const cleanPhone = phone.replace(/[\s-]/g, '');
      return db.profiles.find(p => p.phone.replace(/[\s-]/g, '') === cleanPhone);
    },
    async saveProfile(profileData) {
      const db = loadDb();
      const idx = db.profiles.findIndex(p => p.id === profileData.id);
      if (idx >= 0) {
        db.profiles[idx] = { ...db.profiles[idx], ...profileData, updatedAt: new Date().toISOString() };
      } else {
        db.profiles.push({
          id: profileData.id || 'usr-' + Date.now(),
          createdAt: new Date().toISOString(),
          ...profileData
        });
      }
      saveDb(db);

      // Sync with local backend server if online
      try {
        fetch(`${API_BASE}/profiles`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(profileData)
        }).catch(() => {});
      } catch (e) {}

      return profileData;
    },

    createRiderAccount(data) {
      const db = loadDb();
      const cleanPhone = data.phone.replace(/[\s-]/g, '');
      const id = 'usr-' + Date.now();
      const newProfile = {
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
      };
      db.profiles.push(newProfile);
      saveDb(db);

      // Sync with local server
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
    createRide(rideData) {
      const db = loadDb();
      const currentUser = this.getActiveUser();
      const newRide = {
        id: 'ride-' + Date.now(),
        code: (rideData.name.replace(/[^A-Za-z]/g, '').slice(0, 5) + Math.floor(10 + Math.random() * 89)).toUpperCase(),
        name: rideData.name || 'New Group Ride',
        description: rideData.description || 'Motorcycle group ride',
        creatorId: currentUser ? currentUser.id : 'usr-bose',
        date: rideData.date || new Date().toISOString().split('T')[0],
        time: rideData.time || '06:00',
        status: 'active',
        startAddress: rideData.startAddress || 'Bangalore',
        startLat: rideData.startLat || 12.9176,
        startLng: rideData.startLng || 77.6233,
        destAddress: rideData.destAddress || 'Destination',
        destLat: rideData.destLat || 10.2185,
        destLng: rideData.destLng || 77.4682,
        distanceKm: rideData.distanceKm || 320,
        durationHours: rideData.durationHours || 8.0,
        members: [
          { userId: currentUser.id, role: 'creator', status: 'ready', isLead: true }
        ],
        waypoints: rideData.waypoints || [],
        pins: [],
        messages: [
          { id: 'msg-' + Date.now(), type: 'system', text: `Ride "${rideData.name}" created by ${currentUser.name}`, time: 'Just now' }
        ],
        createdAt: new Date().toISOString()
      };
      db.rides.unshift(newRide);
      saveDb(db);

      // Sync with local server
      try {
        fetch(`${API_BASE}/rides`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newRide)
        }).catch(() => {});
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

    joinRide(rideCode, userId, role = 'rider') {
      const db = loadDb();
      const ride = db.rides.find(r => r.code.toUpperCase() === rideCode.trim().toUpperCase());
      if (!ride) return { success: false, error: 'Ride code not found in database' };

      const existingMember = ride.members.find(m => m.userId === userId);
      if (!existingMember) {
        ride.members.push({ userId, role, status: 'ready', isLead: false });
        const user = this.getProfile(userId);
        ride.messages.push({
          id: 'msg-' + Date.now(),
          type: 'system',
          text: `🏍️ ${user ? user.name : 'A rider'} joined the ride lobby`,
          time: 'Just now'
        });
        saveDb(db);

        // Sync with local server
        try {
          fetch(`${API_BASE}/rides/join`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: rideCode, userId })
          }).catch(() => {});
        } catch (e) {}
      }
      return { success: true, ride };
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

