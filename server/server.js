/**
 * RideSync Local Database & Backend Server
 * Uses Node 24 native SQLite (DatabaseSync) to manage a physical database file (payanam.db)
 * Exposes REST API for Authentication, OTP, Profiles, Rides, Waypoints, Live Pins & Chat.
 * Allows easy switching to live Supabase / PostgreSQL by updating config.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

// WebSocket protocol helpers & client registry
const wsClientsByRide = new Map(); // rideId -> Set(socket)

function makeWsAcceptKey(key) {
  return crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
}

function broadcastToRide(rideId, data, senderSocket = null) {
  const room = wsClientsByRide.get(rideId);
  if (!room) return;
  const payloadStr = JSON.stringify(data);
  const frame = encodeWsFrame(payloadStr);

  for (const clientSocket of room) {
    if (clientSocket !== senderSocket && clientSocket.writable) {
      try {
        clientSocket.write(frame);
      } catch (e) {}
    }
  }
}

function encodeWsFrame(data) {
  const buf = Buffer.from(data, 'utf8');
  const len = buf.length;
  let header;

  if (len < 126) {
    header = Buffer.from([0x81, len]);
  } else if (len <= 65535) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, buf]);
}

function decodeWsFrame(buffer) {
  if (buffer.length < 2) return null;
  const secondByte = buffer[1];
  const isMasked = (secondByte & 0x80) === 0x80;
  let payloadLen = secondByte & 0x7f;
  let currentOffset = 2;

  if (payloadLen === 126) {
    if (buffer.length < 4) return null;
    payloadLen = buffer.readUInt16BE(2);
    currentOffset = 4;
  } else if (payloadLen === 127) {
    if (buffer.length < 10) return null;
    payloadLen = Number(buffer.readBigUInt64BE(2));
    currentOffset = 10;
  }

  let maskKey = null;
  if (isMasked) {
    if (buffer.length < currentOffset + 4) return null;
    maskKey = buffer.slice(currentOffset, currentOffset + 4);
    currentOffset += 4;
  }

  if (buffer.length < currentOffset + payloadLen) return null;
  const rawData = buffer.slice(currentOffset, currentOffset + payloadLen);

  if (isMasked && maskKey) {
    for (let i = 0; i < rawData.length; i++) {
      rawData[i] ^= maskKey[i % 4];
    }
  }

  return rawData.toString('utf8');
}


const PORT = process.env.PORT || 5000;
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'ridesync.db');
const CONFIG_FILE = path.join(__dirname, 'config.json');

// 1. Load or Create Configuration
let config = {
  dbDriver: 'local-sqlite', // 'local-sqlite' or 'supabase-postgres'
  sqliteFile: DB_FILE,
  supabaseUrl: process.env.SUPABASE_URL || '',
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
  postgresUrl: process.env.DATABASE_URL || ''
};

if (fs.existsSync(CONFIG_FILE)) {
  try {
    config = { ...config, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) };
  } catch (e) {
    console.warn('Could not parse config.json, using defaults.');
  }
} else {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// 2. Initialize Local SQLite Relational Database
console.log(`[RideSync DB] Opening local database file: ${DB_FILE}`);
const db = new DatabaseSync(DB_FILE);

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      username TEXT UNIQUE,
      phone TEXT UNIQUE NOT NULL,
      phone_formatted TEXT,
      avatar TEXT,
      avatar_color TEXT,
      bike_model TEXT NOT NULL,
      blood_group TEXT,
      emergency_contact_name TEXT,
      emergency_contact_phone TEXT,
      rides_count INTEGER DEFAULT 0,
      total_km REAL DEFAULT 0.0,
      role_default TEXT DEFAULT 'Rider',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS rides (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      creator_id TEXT NOT NULL,
      date TEXT,
      time TEXT,
      status TEXT DEFAULT 'active',
      start_address TEXT,
      start_lat REAL,
      start_lng REAL,
      dest_address TEXT,
      dest_lat REAL,
      dest_lng REAL,
      distance_km REAL,
      duration_hours REAL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (creator_id) REFERENCES profiles(id)
    );

    CREATE TABLE IF NOT EXISTS ride_members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ride_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT DEFAULT 'rider',
      status TEXT DEFAULT 'ready',
      last_lat REAL,
      last_lng REAL,
      speed REAL DEFAULT 0,
      heading REAL DEFAULT 0,
      battery INTEGER DEFAULT 100,
      last_seen TEXT,
      joined_at TEXT DEFAULT (datetime('now')),
      UNIQUE(ride_id, user_id),
      FOREIGN KEY (ride_id) REFERENCES rides(id),
      FOREIGN KEY (user_id) REFERENCES profiles(id)
    );

    CREATE TABLE IF NOT EXISTS waypoints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ride_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT DEFAULT 'custom',
      icon TEXT DEFAULT '📍',
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      sequence INTEGER DEFAULT 0,
      planned_duration INTEGER DEFAULT 0,
      FOREIGN KEY (ride_id) REFERENCES rides(id)
    );

    CREATE TABLE IF NOT EXISTS ride_pins (
      id TEXT PRIMARY KEY,
      ride_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      created_time TEXT,
      FOREIGN KEY (ride_id) REFERENCES rides(id),
      FOREIGN KEY (user_id) REFERENCES profiles(id)
    );

    CREATE TABLE IF NOT EXISTS ride_messages (
      id TEXT PRIMARY KEY,
      ride_id TEXT NOT NULL,
      sender_id TEXT,
      sender_name TEXT,
      type TEXT DEFAULT 'user',
      text TEXT NOT NULL,
      time TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (ride_id) REFERENCES rides(id)
    );

    CREATE TABLE IF NOT EXISTS otp_verifications (
      phone TEXT PRIMARY KEY,
      otp_code TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
  `);

  // Safe migrations for existing SQLite database files
  try { db.exec('ALTER TABLE ride_members ADD COLUMN last_lat REAL'); } catch(e) {}
  try { db.exec('ALTER TABLE ride_members ADD COLUMN last_lng REAL'); } catch(e) {}
  try { db.exec('ALTER TABLE ride_members ADD COLUMN speed REAL DEFAULT 0'); } catch(e) {}
  try { db.exec('ALTER TABLE ride_members ADD COLUMN heading REAL DEFAULT 0'); } catch(e) {}
  try { db.exec('ALTER TABLE ride_members ADD COLUMN battery INTEGER DEFAULT 100'); } catch(e) {}
  try { db.exec('ALTER TABLE ride_members ADD COLUMN last_seen TEXT'); } catch(e) {}

  console.log('[RideSync DB] Database schema initialized (Clean Mode - 0 test data).');
}

initSchema();

// 3. HTTP Server & REST API Endpoints
const server = http.createServer((req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // JSON Body Parser helper
  function getJsonBody(callback) {
    let body = '';
    req.on('data', chunk => (body += chunk));
    req.on('end', () => {
      try {
        const parsed = body ? JSON.parse(body) : {};
        callback(null, parsed);
      } catch (err) {
        callback(err);
      }
    });
  }

  function sendJson(statusCode, data) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }

  // --- API ROUTES ---

  // Database Admin Visual Studio UI (http://localhost:5000/db-admin)
  if (pathname === '/db-admin' || pathname === '/admin' || pathname === '/') {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>RideSync Local Database Studio (ridesync.db)</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&family=Outfit:wght@600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-dark: #0B0E14;
      --bg-card: #151A23;
      --bg-surface: #1C2330;
      --primary: #FF6B00;
      --accent-cyan: #00E5FF;
      --accent-green: #00E676;
      --text: #F0F4F8;
      --text-muted: #94A3B8;
      --border: #2A3649;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Inter', sans-serif; }
    body { background: var(--bg-dark); color: var(--text); padding: 24px; min-height: 100vh; }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px; border-bottom: 1px solid var(--border); padding-bottom: 16px; }
    .header-left { display: flex; align-items: center; gap: 12px; }
    .logo-badge { background: var(--primary); color: #FFF; font-weight: 800; padding: 8px 12px; border-radius: 10px; font-size: 18px; }
    .title { font-family: 'Outfit', sans-serif; font-size: 22px; font-weight: 800; }
    .subtitle { font-size: 12px; color: var(--accent-cyan); font-family: 'JetBrains Mono', monospace; }
    .db-path-badge { background: var(--bg-card); border: 1px solid var(--border); padding: 6px 12px; border-radius: 8px; font-size: 12px; font-family: monospace; color: var(--text-muted); }
    .layout { display: grid; grid-template-columns: 240px 1fr; gap: 24px; }
    .sidebar { background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px; padding: 16px; height: fit-content; }
    .sidebar-title { font-size: 11px; text-transform: uppercase; color: var(--text-muted); font-weight: 700; letter-spacing: 1px; margin-bottom: 12px; }
    .table-list { display: flex; flex-direction: column; gap: 6px; }
    .table-btn { display: flex; justify-content: space-between; align-items: center; background: transparent; border: 1px solid transparent; color: var(--text); padding: 10px 12px; border-radius: 8px; cursor: pointer; font-size: 13px; font-weight: 600; text-align: left; transition: all 0.15s; }
    .table-btn:hover { background: var(--bg-surface); }
    .table-btn.active { background: rgba(255, 107, 0, 0.15); border-color: var(--primary); color: var(--primary); }
    .badge-count { background: var(--bg-dark); padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: 700; color: var(--text-muted); }
    .main-panel { display: flex; flex-direction: column; gap: 16px; }
    .sql-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px; padding: 16px; }
    .sql-row { display: flex; gap: 10px; }
    .sql-input { flex: 1; background: var(--bg-dark); border: 1px solid var(--border); border-radius: 8px; padding: 12px 14px; color: var(--accent-cyan); font-family: 'JetBrains Mono', monospace; font-size: 13px; outline: none; }
    .sql-input:focus { border-color: var(--accent-cyan); }
    .btn-run { background: var(--primary); color: #FFF; border: none; padding: 0 20px; border-radius: 8px; font-weight: 700; cursor: pointer; }
    .btn-run:hover { opacity: 0.9; }
    .data-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px; padding: 16px; overflow: hidden; }
    .data-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
    .data-title { font-size: 16px; font-weight: 700; }
    .table-responsive { overflow-x: auto; max-height: 520px; border: 1px solid var(--border); border-radius: 8px; background: var(--bg-dark); }
    table { width: 100%; border-collapse: collapse; text-align: left; font-size: 13px; }
    th { background: #18202E; color: var(--text); padding: 10px 14px; font-weight: 700; border-bottom: 1px solid var(--border); position: sticky; top: 0; white-space: nowrap; }
    td { padding: 10px 14px; border-bottom: 1px solid #1E2838; color: var(--text-muted); white-space: nowrap; }
    tr:hover td { background: rgba(255, 255, 255, 0.02); color: var(--text); }
    .null-val { color: #64748B; font-style: italic; }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      <div class="logo-badge">🏍️ DB</div>
      <div>
        <h1 class="title">RideSync Database Studio</h1>
        <p class="subtitle">SQLite Relational Engine &bull; Native Node 24</p>
      </div>
    </div>
    <div class="db-path-badge">📁 server/ridesync.db</div>
  </div>

  <div class="layout">
    <div class="sidebar">
      <div class="sidebar-title">Tables in Database</div>
      <div class="table-list" id="tableList">
        <button class="table-btn active" onclick="loadTableData('profiles')">
          <span>👤 profiles</span>
          <span class="badge-count" id="count-profiles">...</span>
        </button>
        <button class="table-btn" onclick="loadTableData('rides')">
          <span>🏍️ rides</span>
          <span class="badge-count" id="count-rides">...</span>
        </button>
        <button class="table-btn" onclick="loadTableData('ride_members')">
          <span>👥 ride_members</span>
          <span class="badge-count" id="count-ride_members">...</span>
        </button>
        <button class="table-btn" onclick="loadTableData('waypoints')">
          <span>📍 waypoints</span>
          <span class="badge-count" id="count-waypoints">...</span>
        </button>
        <button class="table-btn" onclick="loadTableData('ride_pins')">
          <span>📌 ride_pins</span>
          <span class="badge-count" id="count-ride_pins">...</span>
        </button>
        <button class="table-btn" onclick="loadTableData('ride_messages')">
          <span>💬 ride_messages</span>
          <span class="badge-count" id="count-ride_messages">...</span>
        </button>
        <button class="table-btn" onclick="loadTableData('otp_verifications')">
          <span>🔐 otp_verifications</span>
          <span class="badge-count" id="count-otp_verifications">...</span>
        </button>
      </div>
    </div>

    <div class="main-panel">
      <div class="sql-card">
        <div class="sql-row">
          <input type="text" id="sqlQueryInput" class="sql-input" value="SELECT * FROM profiles" />
          <button class="btn-run" onclick="runQuery()">Execute SQL</button>
        </div>
      </div>

      <div class="data-card">
        <div class="data-header">
          <h2 class="data-title" id="activeTableHeading">Table: profiles</h2>
          <span id="rowsInfo" style="font-size:12px; color:var(--text-muted);">Showing rows</span>
        </div>
        <div class="table-responsive" id="tableContent">
          <div style="padding:24px; text-align:center; color:var(--text-muted);">Loading database rows...</div>
        </div>
      </div>
    </div>
  </div>

  <script>
    let currentTable = 'profiles';

    async function init() {
      await updateCounts();
      await loadTableData('profiles');
    }

    async function updateCounts() {
      try {
        const res = await fetch('/api/health');
        const data = await res.json();
        if (data.counts) {
          Object.keys(data.counts).forEach(k => {
            const el = document.getElementById('count-' + k);
            if (el) el.innerText = data.counts[k];
          });
        }
      } catch (e) {}
    }

    async function loadTableData(tableName) {
      currentTable = tableName;
      document.querySelectorAll('.table-btn').forEach(btn => {
        btn.classList.toggle('active', btn.innerText.includes(tableName));
      });
      document.getElementById('activeTableHeading').innerText = 'Table: ' + tableName;
      const sql = 'SELECT * FROM ' + tableName + ' LIMIT 50';
      document.getElementById('sqlQueryInput').value = sql;
      await runSql(sql);
    }

    async function runQuery() {
      const sql = document.getElementById('sqlQueryInput').value.trim();
      if (sql) await runSql(sql);
    }

    async function runSql(sql) {
      const container = document.getElementById('tableContent');
      container.innerHTML = '<div style="padding:24px; text-align:center; color:var(--text-muted);">Executing query...</div>';
      try {
        const res = await fetch('/api/db/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sql })
        });
        const result = await res.json();
        if (result.error) {
          container.innerHTML = '<div style="padding:24px; color:#FF1744; font-family:monospace;">❌ Error: ' + result.error + '</div>';
          return;
        }
        const rows = result.rows || [];
        document.getElementById('rowsInfo').innerText = rows.length + ' rows returned';
        if (rows.length === 0) {
          container.innerHTML = '<div style="padding:24px; text-align:center; color:var(--text-muted);">Table has no rows.</div>';
          return;
        }
        const cols = Object.keys(rows[0]);
        let html = '<table><thead><tr>' + cols.map(c => '<th>' + c + '</th>').join('') + '</tr></thead><tbody>';
        rows.forEach(r => {
          html += '<tr>' + cols.map(c => '<td>' + (r[c] !== null ? r[c] : '<span class="null-val">NULL</span>') + '</td>').join('') + '</tr>';
        });
        html += '</tbody></table>';
        container.innerHTML = html;
      } catch (e) {
        container.innerHTML = '<div style="padding:24px; color:#FF1744;">Failed to execute query: ' + e.message + '</div>';
      }
    }

    init();
  </script>
</body>
</html>`;
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
    return;
  }

  // Health & DB Connection Status
  if (pathname === '/api/health' && req.method === 'GET') {
    const counts = {
      profiles: db.prepare('SELECT COUNT(*) as count FROM profiles').get().count,
      rides: db.prepare('SELECT COUNT(*) as count FROM rides').get().count,
      ride_members: db.prepare('SELECT COUNT(*) as count FROM ride_members').get().count,
      waypoints: db.prepare('SELECT COUNT(*) as count FROM waypoints').get().count,
      ride_pins: db.prepare('SELECT COUNT(*) as count FROM ride_pins').get().count,
      ride_messages: db.prepare('SELECT COUNT(*) as count FROM ride_messages').get().count,
      otp_verifications: db.prepare('SELECT COUNT(*) as count FROM otp_verifications').get().count
    };
    return sendJson(200, {
      status: 'online',
      driver: config.dbDriver,
      sqliteFile: DB_FILE,
      counts
    });
  }

  // Live Database SQL Inspector Endpoint
  if (pathname === '/api/db/query' && req.method === 'POST') {
    getJsonBody((err, body) => {
      if (err || !body.sql) return sendJson(400, { error: 'Invalid SQL query' });
      try {
        const rows = db.prepare(body.sql).all();
        sendJson(200, { success: true, rows });
      } catch (sqlErr) {
        sendJson(400, { error: sqlErr.message });
      }
    });
    return;
  }

  // Clean Reset Sandbox Database (Wipes all test rows)
  if (pathname === '/api/db/clean-reset' && req.method === 'POST') {
    try {
      db.exec(`
        DELETE FROM ride_messages;
        DELETE FROM ride_pins;
        DELETE FROM waypoints;
        DELETE FROM ride_members;
        DELETE FROM rides;
        DELETE FROM profiles;
        DELETE FROM otp_verifications;
        VACUUM;
      `);
      return sendJson(200, { success: true, message: 'Sandbox database wiped clean (0 records).' });
    } catch (e) {
      return sendJson(500, { error: e.message });
    }
  }

  // Profile Output Formatter (provides both camelCase and snake_case properties)
  function formatProfileOutput(p) {
    if (!p) return null;
    return {
      ...p,
      id: p.id,
      name: p.name,
      username: p.username,
      phone: p.phone,
      phoneFormatted: p.phone_formatted || p.phone,
      phone_formatted: p.phone_formatted || p.phone,
      avatar: p.avatar,
      avatarColor: p.avatar_color || '#FF6B00',
      avatar_color: p.avatar_color || '#FF6B00',
      bikeModel: p.bike_model || 'Motorcycle',
      bike_model: p.bike_model || 'Motorcycle',
      bloodGroup: p.blood_group || 'O+ve',
      blood_group: p.blood_group || 'O+ve',
      emergencyContactName: p.emergency_contact_name || '',
      emergency_contact_name: p.emergency_contact_name || '',
      emergencyContactPhone: p.emergency_contact_phone || '',
      emergency_contact_phone: p.emergency_contact_phone || '',
      ridesCount: p.rides_count || 0,
      rides_count: p.rides_count || 0,
      totalKm: p.total_km || 0,
      total_km: p.total_km || 0,
      roleDefault: p.role_default || 'Rider',
      role_default: p.role_default || 'Rider',
      createdAt: p.created_at,
      updatedAt: p.updated_at
    };
  }

  // Robust Phone Matcher (matches exact, stripped spaces, or last 10 digits)
  function findProfileByPhone(inputPhone) {
    if (!inputPhone) return null;
    const cleanPhone = String(inputPhone).replace(/[\s-]/g, '');
    const digits = String(inputPhone).replace(/\D/g, '');
    const last10 = digits.slice(-10);

    // 1. Direct query
    let row = db.prepare('SELECT * FROM profiles WHERE phone = ? OR phone_formatted = ?').get(cleanPhone, inputPhone);
    if (row) return row;

    // 2. Scan all if digits match last 10
    if (last10.length >= 10) {
      const all = db.prepare('SELECT * FROM profiles').all();
      row = all.find(p => {
        const pDigits = String(p.phone || '').replace(/\D/g, '');
        const pFormattedDigits = String(p.phone_formatted || '').replace(/\D/g, '');
        return pDigits.endsWith(last10) || pFormattedDigits.endsWith(last10);
      });
    }
    return row || null;
  }

  // Request Phone OTP
  if (pathname === '/api/auth/request-otp' && req.method === 'POST') {
    getJsonBody((err, body) => {
      const phone = (body.phone || '').replace(/[\s-]/g, '');
      if (!phone) return sendJson(400, { error: 'Phone number is required' });

      const otp = String(Math.floor(100000 + Math.random() * 900000));
      const expiresAt = Date.now() + 10 * 60 * 1000;

      db.prepare(`
        INSERT INTO otp_verifications (phone, otp_code, expires_at)
        VALUES (?, ?, ?)
        ON CONFLICT(phone) DO UPDATE SET otp_code = excluded.otp_code, expires_at = excluded.expires_at
      `).run(phone, otp, expiresAt);

      const existingProfile = findProfileByPhone(phone);

      sendJson(200, {
        success: true,
        message: 'OTP generated and saved in DB',
        phone,
        otpCode: otp, // Returned for simulated SMS banner
        isExistingUser: !!existingProfile,
        profile: formatProfileOutput(existingProfile)
      });
    });
    return;
  }

  // Verify Phone OTP
  if (pathname === '/api/auth/verify-otp' && req.method === 'POST') {
    getJsonBody((err, body) => {
      const rawPhone = body.phone || '';
      const phone = rawPhone.replace(/[\s-]/g, '');
      const otp = body.otp;

      // Check OTP in DB or allow demo '123456'
      let record = db.prepare('SELECT * FROM otp_verifications WHERE phone = ?').get(phone);
      if (!record && rawPhone !== phone) {
        record = db.prepare('SELECT * FROM otp_verifications WHERE phone = ?').get(rawPhone);
      }

      const isValidOtp = (record && record.otp_code === otp) || otp === '123456';
      if (!isValidOtp && !record) {
        return sendJson(400, { error: 'No OTP request found for this phone' });
      }

      if (isValidOtp) {
        const profile = findProfileByPhone(rawPhone);
        sendJson(200, {
          success: true,
          isNewUser: !profile,
          profile: formatProfileOutput(profile)
        });
      } else {
        sendJson(400, { error: 'Incorrect OTP code' });
      }
    });
    return;
  }

  // Get Profiles
  if (pathname === '/api/profiles' && req.method === 'GET') {
    const profiles = db.prepare('SELECT * FROM profiles ORDER BY created_at ASC').all();
    return sendJson(200, profiles.map(formatProfileOutput));
  }

  // Create or Update Profile
  if (pathname === '/api/profiles' && req.method === 'POST') {
    getJsonBody((err, body) => {
      if (err) return sendJson(400, { error: 'Invalid JSON' });
      const cleanPhone = (body.phone || '').replace(/[\s-]/g, '');
      const existingByPhone = findProfileByPhone(body.phone || body.phoneFormatted);
      const existingById = body.id ? db.prepare('SELECT * FROM profiles WHERE id = ?').get(body.id) : null;
      const targetProfile = existingByPhone || existingById;

      const id = targetProfile ? targetProfile.id : (body.id || 'usr-' + Date.now());

      if (targetProfile) {
        db.prepare(`
          UPDATE profiles SET
            name = COALESCE(?, name),
            bike_model = COALESCE(?, bike_model),
            blood_group = COALESCE(?, blood_group),
            emergency_contact_name = COALESCE(?, emergency_contact_name),
            emergency_contact_phone = COALESCE(?, emergency_contact_phone),
            avatar = COALESCE(?, avatar),
            avatar_color = COALESCE(?, avatar_color),
            phone_formatted = COALESCE(?, phone_formatted),
            updated_at = datetime('now')
          WHERE id = ?
        `).run(
          body.name,
          body.bikeModel || body.bike_model,
          body.bloodGroup || body.blood_group,
          body.emergencyContactName || body.emergency_contact_name,
          body.emergencyContactPhone || body.emergency_contact_phone,
          body.avatar,
          body.avatarColor || body.avatar_color,
          body.phoneFormatted || body.phone_formatted || body.phone,
          id
        );
      } else {
        db.prepare(`
          INSERT INTO profiles (id, name, username, phone, phone_formatted, avatar, avatar_color, bike_model, blood_group, emergency_contact_name, emergency_contact_phone, rides_count, total_km, role_default)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id,
          body.name || 'Rider',
          body.username || 'rider_' + Date.now(),
          cleanPhone,
          body.phoneFormatted || body.phone,
          body.avatar || (body.name || 'R')[0],
          body.avatarColor || body.avatar_color || '#FF6B00',
          body.bikeModel || body.bike_model || 'Motorcycle',
          body.bloodGroup || body.blood_group || 'O+ve',
          body.emergencyContactName || body.emergency_contact_name || '',
          body.emergencyContactPhone || body.emergency_contact_phone || '',
          body.ridesCount || body.rides_count || 0,
          body.totalKm || body.total_km || 0,
          body.roleDefault || body.role_default || 'Rider'
        );
      }

      const updated = db.prepare('SELECT * FROM profiles WHERE id = ?').get(id);
      sendJson(200, { success: true, profile: formatProfileOutput(updated) });
    });
    return;
  }

  // Get Rides with Members and Waypoints
  if (pathname === '/api/rides' && req.method === 'GET') {
    const rides = db.prepare('SELECT * FROM rides ORDER BY created_at DESC').all();
    const enrichedRides = rides.map(r => {
      const members = db.prepare('SELECT * FROM ride_members WHERE ride_id = ?').all(r.id);
      const waypoints = db.prepare('SELECT * FROM waypoints WHERE ride_id = ? ORDER BY sequence ASC').all(r.id);
      const pins = db.prepare('SELECT * FROM ride_pins WHERE ride_id = ?').all(r.id);
      const messages = db.prepare('SELECT * FROM ride_messages WHERE ride_id = ? ORDER BY created_at ASC').all(r.id);
      return {
        ...r,
        members,
        waypoints,
        pins,
        messages
      };
    });
    return sendJson(200, enrichedRides);
  }

  // Create Ride
  if (pathname === '/api/rides' && req.method === 'POST') {
    getJsonBody((err, body) => {
      if (err) return sendJson(400, { error: 'Invalid JSON' });
      const id = 'ride-' + Date.now();
      const code = (body.name.replace(/[^A-Za-z]/g, '').slice(0, 5) + Math.floor(10 + Math.random() * 89)).toUpperCase();

      db.prepare(`
        INSERT INTO rides (id, code, name, description, creator_id, date, time, status, start_address, start_lat, start_lng, dest_address, dest_lat, dest_lng, distance_km, duration_hours)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        code,
        body.name || 'New Group Ride',
        body.description || '',
        body.creatorId || 'usr-bose',
        body.date || new Date().toISOString().split('T')[0],
        body.time || '06:00',
        'lobby',
        body.startAddress || 'Start Location',
        body.startLat || 12.9176,
        body.startLng || 77.6233,
        body.destAddress || 'Destination',
        body.destLat || 10.2185,
        body.destLng || 77.4682,
        body.distanceKm || 0,
        body.durationHours || 0
      );

      // Add creator as lead member
      db.prepare('INSERT INTO ride_members (ride_id, user_id, role, status) VALUES (?, ?, ?, ?)').run(id, body.creatorId || 'usr-bose', 'creator', 'ready');

      // Add waypoints
      if (body.waypoints && Array.isArray(body.waypoints)) {
        const insertWp = db.prepare('INSERT INTO waypoints (ride_id, name, type, icon, lat, lng, sequence, planned_duration) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
        body.waypoints.forEach((wp, idx) => {
          insertWp.run(id, wp.name || `Stop ${idx + 1}`, wp.type || 'custom', wp.icon || '📍', wp.lat, wp.lng, idx + 1, wp.plannedDuration || 0);
        });
      }

      // Add initial system message
      const creator = findProfileByPhone(body.creatorId) || db.prepare('SELECT * FROM profiles WHERE id = ?').get(body.creatorId);
      db.prepare(`
        INSERT INTO ride_messages (id, ride_id, sender_id, sender_name, type, text, time)
        VALUES (?, ?, ?, ?, 'system', ?, ?)
      `).run('msg-' + Date.now(), id, body.creatorId, creator ? creator.name : 'Lead', `🏍️ Ride lobby created by ${creator ? creator.name : 'Lead'}`, new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));

      sendJson(200, { success: true, rideId: id, code });
    });
    return;
  }

  // Request to Join Ride (Sends pending join request to Lead)
  if (pathname === '/api/rides/join' && req.method === 'POST') {
    getJsonBody((err, body) => {
      const code = (body.code || '').trim().toUpperCase();
      const userId = body.userId;
      if (!userId) return sendJson(400, { error: 'User ID is required' });

      const ride = db.prepare('SELECT * FROM rides WHERE UPPER(code) = ?').get(code);
      if (!ride) return sendJson(404, { error: 'Ride code not found in database' });

      const user = db.prepare('SELECT * FROM profiles WHERE id = ?').get(userId);
      const isCreator = ride.creator_id === userId;
      const initialStatus = isCreator ? 'ready' : 'pending';

      // Insert or update member status
      db.prepare(`
        INSERT INTO ride_members (ride_id, user_id, role, status)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(ride_id, user_id) DO UPDATE SET status = excluded.status
      `).run(ride.id, userId, isCreator ? 'creator' : 'rider', initialStatus);

      // Broadcast join request to Lead via WebSocket
      broadcastToRide(ride.id, {
        type: isCreator ? 'member_joined' : 'join_request',
        rideId: ride.id,
        user: user ? formatProfileOutput(user) : { id: userId, name: 'Rider' },
        status: initialStatus
      });

      sendJson(200, {
        success: true,
        ride,
        status: initialStatus,
        isCreator,
        message: isCreator ? 'Joined as Lead' : 'Join request sent to Ride Lead for approval'
      });
    });
    return;
  }

  // Lead Approves / Declines Join Request
  if (pathname === '/api/rides/approve-member' && req.method === 'POST') {
    getJsonBody((err, body) => {
      const { rideId, userId, leadId, action } = body;
      const ride = db.prepare('SELECT * FROM rides WHERE id = ?').get(rideId);
      if (!ride) return sendJson(404, { error: 'Ride not found' });
      if (ride.creator_id !== leadId) return sendJson(403, { error: 'Only the Ride Lead can approve riders' });

      const user = db.prepare('SELECT * FROM profiles WHERE id = ?').get(userId);

      if (action === 'approve') {
        db.prepare('UPDATE ride_members SET status = ? WHERE ride_id = ? AND user_id = ?').run('ready', rideId, userId);
        
        // Post welcome message
        db.prepare(`
          INSERT INTO ride_messages (id, ride_id, sender_id, sender_name, type, text, time)
          VALUES (?, ?, ?, ?, 'system', ?, ?)
        `).run('msg-' + Date.now(), rideId, userId, user ? user.name : 'Rider', `🎉 ${user ? user.name : 'A rider'} was approved to join the group!`, new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));

        broadcastToRide(rideId, {
          type: 'member_approved',
          rideId,
          userId,
          rideStatus: ride.status,
          user: user ? formatProfileOutput(user) : null
        });

        return sendJson(200, { success: true, status: 'ready', message: 'Rider approved' });
      } else {
        db.prepare('DELETE FROM ride_members WHERE ride_id = ? AND user_id = ?').run(rideId, userId);
        
        broadcastToRide(rideId, {
          type: 'member_declined',
          rideId,
          userId
        });

        return sendJson(200, { success: true, status: 'declined', message: 'Join request declined' });
      }
    });
    return;
  }

  // Start Live Ride Session (Transitions all riders into Live Map Cockpit)
  if (pathname === '/api/rides/start' && req.method === 'POST') {
    getJsonBody((err, body) => {
      const { rideId, leadId } = body;
      const ride = db.prepare('SELECT * FROM rides WHERE id = ?').get(rideId);
      if (!ride) return sendJson(404, { error: 'Ride not found' });
      if (ride.creator_id !== leadId) return sendJson(403, { error: 'Only the Ride Lead can start the live ride' });

      db.prepare('UPDATE rides SET status = ? WHERE id = ?').run('active', rideId);

      // System announcement
      db.prepare(`
        INSERT INTO ride_messages (id, ride_id, sender_id, sender_name, type, text, time)
        VALUES (?, ?, ?, 'System', 'system', '🏁 LIVE RIDE STARTED! All riders switch to cockpit.', ?)
      `).run('msg-' + Date.now(), rideId, leadId, new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));

      // Broadcast live ride start to all WebSocket connected riders
      broadcastToRide(rideId, {
        type: 'ride_started',
        rideId,
        status: 'active'
      });

      sendJson(200, { success: true, status: 'active', message: 'Live ride started successfully' });
    });
    return;
  }

  // Update Ride Details
  if (pathname.startsWith('/api/rides/') && !pathname.endsWith('/waypoints') && !pathname.endsWith('/pins') && !pathname.endsWith('/messages') && req.method === 'PUT') {
    const rideId = pathname.replace('/api/rides/', '');
    getJsonBody((err, body) => {
      if (err) return sendJson(400, { error: 'Invalid JSON' });
      db.prepare(`
        UPDATE rides SET
          name = COALESCE(?, name),
          date = COALESCE(?, date),
          time = COALESCE(?, time),
          status = COALESCE(?, status),
          distance_km = COALESCE(?, distance_km),
          duration_hours = COALESCE(?, duration_hours)
        WHERE id = ?
      `).run(body.name, body.date, body.time, body.status, body.distanceKm, body.durationHours, rideId);

      const updated = db.prepare('SELECT * FROM rides WHERE id = ?').get(rideId);
      sendJson(200, { success: true, ride: updated });
    });
    return;
  }

  // Update/Replace Waypoints for Ride
  if (pathname.startsWith('/api/rides/') && pathname.endsWith('/waypoints') && req.method === 'POST') {
    const rideId = pathname.replace('/api/rides/', '').replace('/waypoints', '');
    getJsonBody((err, body) => {
      const waypoints = body.waypoints;
      if (!Array.isArray(waypoints)) return sendJson(400, { error: 'waypoints array required' });

      // Clear existing waypoints for this ride
      db.prepare('DELETE FROM waypoints WHERE ride_id = ?').run(rideId);

      // Insert new waypoints
      const insertWp = db.prepare('INSERT INTO waypoints (ride_id, name, type, icon, lat, lng, sequence, planned_duration) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      waypoints.forEach((wp, idx) => {
        insertWp.run(rideId, wp.name, wp.type || 'custom', wp.icon || '📍', wp.lat, wp.lng, idx + 1, wp.plannedDuration || 0);
      });

      const updatedWps = db.prepare('SELECT * FROM waypoints WHERE ride_id = ? ORDER BY sequence ASC').all(rideId);
      sendJson(200, { success: true, waypoints: updatedWps });
    });
    return;
  }

  // Add Dropped Pin (Tea, Fuel, Food, Photo, Custom)
  if (pathname.startsWith('/api/rides/') && pathname.endsWith('/pins') && req.method === 'POST') {
    const rideId = pathname.replace('/api/rides/', '').replace('/pins', '');
    getJsonBody((err, body) => {
      const id = body.id || 'pin-' + Date.now();
      const time = body.time || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      db.prepare(`
        INSERT INTO ride_pins (id, ride_id, user_id, type, title, lat, lng, created_time)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, rideId, body.userId || 'usr-bose', body.type || 'custom', body.title || 'Pin', body.lat || 10.2380, body.lng || 77.4890, time);

      sendJson(200, { success: true, pin: { id, ride_id: rideId, ...body, created_time: time } });
    });
    return;
  }

  // Add Chat Message
  if (pathname.startsWith('/api/rides/') && pathname.endsWith('/messages') && req.method === 'POST') {
    const rideId = pathname.replace('/api/rides/', '').replace('/messages', '');
    getJsonBody((err, body) => {
      const id = body.id || 'msg-' + Date.now();
      const time = body.time || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

      db.prepare(`
        INSERT INTO ride_messages (id, ride_id, sender_id, sender_name, type, text, time)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, rideId, body.senderId || null, body.senderName || 'Rider', body.type || 'user', body.text || '', time);

      sendJson(200, { success: true, message: { id, ride_id: rideId, ...body, time } });
    });
    return;
  }

  // Update Rider Telemetry (GPS position, speed, heading, battery, status)
  if (pathname.startsWith('/api/rides/') && pathname.endsWith('/telemetry') && req.method === 'POST') {
    const rideId = pathname.replace('/api/rides/', '').replace('/telemetry', '');
    getJsonBody((err, body) => {
      const { userId, lat, lng, speed, heading, battery, status } = body;
      if (!userId || lat === undefined || lng === undefined) {
        return sendJson(400, { error: 'userId, lat, and lng are required' });
      }

      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

      try {
        db.prepare(`
          UPDATE ride_members SET
            last_lat = ?,
            last_lng = ?,
            speed = COALESCE(?, speed),
            heading = COALESCE(?, heading),
            battery = COALESCE(?, battery),
            status = COALESCE(?, status),
            last_seen = ?
          WHERE ride_id = ? AND user_id = ?
        `).run(lat, lng, speed ?? 0, heading ?? 0, battery ?? 100, status || 'riding', timeStr, rideId, userId);
      } catch (e) {
        console.warn('[Telemetry DB Error]:', e);
      }

      const user = db.prepare('SELECT * FROM profiles WHERE id = ?').get(userId);

      const telemetryPayload = {
        type: 'location_update',
        rideId,
        userId,
        name: user ? user.name : (body.name || 'Rider'),
        lat,
        lng,
        speed: speed ?? 0,
        heading: heading ?? 0,
        battery: battery ?? 100,
        status: status || 'riding',
        lastSeen: timeStr
      };

      // Broadcast via WebSocket to all connected peers in this ride
      broadcastToRide(rideId, telemetryPayload);

      sendJson(200, { success: true, telemetry: telemetryPayload });
    });
    return;
  }

  // Offline Telemetry Batch Sync (flushes queued points recorded during dead zones)
  if (pathname === '/api/telemetry/batch' && req.method === 'POST') {
    getJsonBody((err, body) => {
      const items = body.items || [];
      const rideId = body.rideId;
      console.log(`[RideSync DB] Syncing ${items.length} offline telemetry batch items for ride: ${rideId}`);
      
      if (rideId && items.length > 0) {
        // Broadcast flushed batch to active room members
        broadcastToRide(rideId, {
          type: 'batch_telemetry',
          rideId,
          count: items.length,
          items,
        });
      }

      sendJson(200, { success: true, processed: items.length });
    });
    return;
  }

  // Update Config (Switch DB driver, Supabase creds)
  if (pathname === '/api/config' && req.method === 'POST') {
    getJsonBody((err, body) => {
      config = { ...config, ...body };
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
      sendJson(200, { success: true, config });
    });
    return;
  }

  // Default fallback 404
  sendJson(404, { error: 'Endpoint not found' });
});

// Real-Time Native WebSocket Protocol Handler
server.on('upgrade', (req, socket, head) => {
  if (req.headers['upgrade'] !== 'websocket') {
    socket.destroy();
    return;
  }

  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy();
    return;
  }

  const acceptKey = makeWsAcceptKey(key);
  const headers = [
    'HTTP/1.1 101 Switching Protocols',
    'Upgrade: websocket',
    'Connection: Upgrade',
    `Sec-WebSocket-Accept: ${acceptKey}`
  ];

  socket.write(headers.join('\r\n') + '\r\n\r\n');

  let currentRideId = null;

  socket.on('data', (buffer) => {
    try {
      const msgStr = decodeWsFrame(buffer);
      if (!msgStr) return;
      const msg = JSON.parse(msgStr);

      if (msg.type === 'subscribe') {
        currentRideId = msg.rideId;
        if (!wsClientsByRide.has(currentRideId)) {
          wsClientsByRide.set(currentRideId, new Set());
        }
        wsClientsByRide.get(currentRideId).add(socket);
        socket.write(encodeWsFrame(JSON.stringify({ type: 'subscribed', rideId: currentRideId })));
      } else if (msg.type === 'location_update' || msg.type === 'quick_pin' || msg.type === 'sos_alert' || msg.type === 'batch_telemetry') {
        const rideId = msg.rideId || currentRideId;
        if (rideId) {
          if (msg.type === 'location_update' && msg.userId && msg.lat !== undefined && msg.lng !== undefined) {
            const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
            try {
              db.prepare(`
                UPDATE ride_members SET
                  last_lat = ?,
                  last_lng = ?,
                  speed = COALESCE(?, speed),
                  heading = COALESCE(?, heading),
                  battery = COALESCE(?, battery),
                  status = COALESCE(?, status),
                  last_seen = ?
                WHERE ride_id = ? AND user_id = ?
              `).run(msg.lat, msg.lng, msg.speed ?? 0, msg.heading ?? 0, msg.battery ?? 100, msg.status || 'riding', timeStr, rideId, msg.userId);
            } catch(e) {}
          }
          broadcastToRide(rideId, msg, socket);
        }
      }
    } catch (e) {}
  });

  socket.on('close', () => {
    if (currentRideId && wsClientsByRide.has(currentRideId)) {
      wsClientsByRide.get(currentRideId).delete(socket);
    }
  });

  socket.on('error', () => {
    if (currentRideId && wsClientsByRide.has(currentRideId)) {
      wsClientsByRide.get(currentRideId).delete(socket);
    }
  });
});

server.listen(PORT, () => {
  console.log(`[RideSync DB Server] Running on http://localhost:${PORT}`);
  console.log(`[RideSync DB Server] Local database ready at: ${DB_FILE}`);
  console.log(`[RideSync DB Server] Low-latency WebSocket server active at ws://localhost:${PORT}/ws`);
});

