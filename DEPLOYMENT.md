# 🚀 RideSync & Payanam — Cloud Sandbox Deployment Guide

This guide details how to deploy the entire **RideSync** motorcycle platform for live sandbox testing with real database persistence.

---

## 🏗️ Architecture Overview

| Component | Technology | Recommended Cloud Provider | Free Tier |
| :--- | :--- | :--- | :--- |
| **Live Database** | PostgreSQL 15 + PostGIS | [Supabase](https://supabase.com) | Free (500MB DB + Realtime WebSockets) |
| **Backend API** | Node.js (REST + WebSocket Engine) | [Render](https://render.com) | Free (Web Service) |
| **Cockpit Web App** | Single Page Application (HTML5 / Vanilla CSS) | [Vercel](https://vercel.com) or [Netlify](https://netlify.com) | Free (Unlimited static hosting + Global CDN) |

---

## 1. 🗄️ Step 1: Create Live Database on Supabase (2 Mins)

1. Go to [https://supabase.com](https://supabase.com) and click **"New Project"**.
2. Give your project a name (e.g. `ridesync-sandbox`), set a secure database password, and choose a region (e.g., `Singapore / ap-southeast-1` or `Mumbai / ap-south-1`).
3. Once created, click on the **SQL Editor** tab in the left sidebar.
4. Open [supabase/migrations/20261006000000_ridesync_schema.sql](file:///supabase/migrations/20261006000000_ridesync_schema.sql), copy the contents, paste into the Supabase SQL editor, and click **RUN**.
5. Open [supabase/migrations/20261006000001_seed_accounts.sql](file:///supabase/migrations/20261006000001_seed_accounts.sql), copy the contents, paste, and click **RUN**.
6. **Done!** Your tables (`profiles`, `rides`, `ride_members`, `waypoints`, `ride_pins`, `ride_messages`, `telemetry_logs`) and test accounts (Bose, Arun, Karthi, Vicky, Priya) are live!

---

## 2. ⚡ Step 2: Deploy Backend API on Render (2 Mins)

1. Go to [https://render.com](https://render.com) and sign in with GitHub.
2. Click **"New +"** → **"Web Service"**.
3. Connect your repository: **`Bose14/ridesync`**.
4. Configure the settings:
   - **Name:** `ridesync-backend`
   - **Root Directory:** `server`
   - **Runtime:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Plan:** `Free`
5. Click **"Create Web Service"**.
6. Copy your live backend URL (e.g., `https://ridesync-backend.onrender.com`).
7. Test the health check by opening `https://ridesync-backend.onrender.com/api/health` in your browser.

---

## 3. 🌐 Step 3: Deploy Frontend on Vercel or Netlify (1 Min)

### Option A: Vercel (Recommended)
1. Go to [https://vercel.com](https://vercel.com) and click **"Add New Project"**.
2. Import GitHub repository: **`Bose14/ridesync`**.
3. Under **Build and Output Settings**:
   - **Framework Preset:** `Other`
   - **Root Directory:** `./`
   - (The repository includes `vercel.json` which automatically configures `web_app/` routing).
4. Under **Environment Variables**, you can optionally add:
   - `RIDESYNC_API_URL` = `https://ridesync-backend.onrender.com/api`
5. Click **Deploy**.

### Option B: Netlify
1. Go to [https://netlify.com](https://netlify.com) and click **"Add new site"** → **"Import an existing project"**.
2. Select GitHub repository: **`Bose14/ridesync`**.
3. (The repository includes `netlify.toml` which automatically sets `publish = "web_app"`).
4. Click **Deploy site**.

---

## 4. 🔗 Connecting Frontend to Your Live Backend

Once both are deployed, in your browser on the deployed web app:
* You can set your live backend URL directly by opening the browser console or the Database Inspector modal:
```javascript
localStorage.setItem('ridesync_custom_api_base', 'https://ridesync-backend.onrender.com/api');
location.reload();
```

---

## 🧪 Testing Your Live Sandbox

1. Open your deployed URL on your smartphone or desktop (e.g., `https://ridesync-app.vercel.app`).
2. Accept the **Location** and **Notification** permissions when prompted.
3. 1-tap login using **Bose (Lead)** or **Arun (Sweeper)**.
4. Click **Enter Ride Lobby** → **Start Live Ride**.
5. Switch layers between **Google Maps RoadMap**, **Satellite Hybrid**, and **Rain Radar**!
6. Click **🎯 Recenter** to immediately focus on your real-time smartphone GPS location.
