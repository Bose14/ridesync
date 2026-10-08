# RideSync - Quick Start Guide

## 🚀 Getting Started

### **Step 1: Start the Backend Server** (REQUIRED)

Open a **NEW terminal/PowerShell** and run:

```bash
cd server
npm start
```

You should see:
```
[RideSync] Server running on http://localhost:5000
[RideSync] SQLite Database ready: ridesync.db
```

⚠️ **DO NOT close this terminal!** The server must run in the background.

### **Step 2: Start the Frontend**

In a **DIFFERENT terminal**, run:

```bash
cd web_app
# No build step needed - just serve the HTML
# You can use any static server or just open index.html in a browser
```

Open your browser to `http://localhost:3000` (or whatever port your static server uses)

**Or simply:**
1. Open `web_app/index.html` directly in your browser
2. App will work with local database (limited functionality)

---

## ✅ What's Working Now

### **Without Server** (Local Mode)
- ✅ View home screen
- ✅ See test rides and riders
- ✅ View ride details
- ✅ View history
- ✅ GPS tracking (if enabled)
- ✅ Map viewing
- ❌ Cannot **create** new rides
- ❌ Cannot **join** rides
- ❌ Cannot **save** changes

### **With Server Running** (Full Mode)
- ✅ Everything works!
- ✅ Create new rides
- ✅ Join existing rides
- ✅ Real-time updates
- ✅ Data persistence
- ✅ Full live tracking

---

## 🐛 Common Issues & Fixes

### **Issue: "No active rides" shown but buttons don't work**
**Solution:** Start the backend server first!
```bash
cd server
npm start
```

### **Issue: "Cannot POST to http://localhost:5000"**
**Solution:** Make sure server is running and `npm install` was completed in server folder:
```bash
cd server
npm install
npm start
```

### **Issue: "RideSync] Database file not found"**
**Solution:** Server will create `ridesync.db` automatically on first run. Wait a few seconds and refresh the page.

### **Issue: Buttons still don't work after server is running**
**Solution:** Hard refresh your browser:
- **Windows/Linux:** Ctrl + Shift + R
- **Mac:** Cmd + Shift + R
- Or clear browser cache and reload

---

## 📝 Test Data (Pre-loaded)

The app now includes test data:

### **Test Riders:**
1. **Bose** - Royal Enfield Interceptor 650
2. **Alex Kumar** - Bajaj Dominar 400  
3. **Sarah Johnson** - Honda CB350

### **Test Rides:**
1. **Bangalore to Kodaikanal** (Lobby state) - 324.8 km
2. **Chennai to Ooty** (Planned) - 286.5 km

You can:
- View these test rides on home screen
- Click "ENTER LIVE COCKPIT" on active rides
- Create new rides (with server running)
- Join rides with codes

---

## 🎮 Testing the App

### **Test 1: View Rides**
1. Open app
2. You should see 2 test rides
3. Click on a ride card
4. Click "ENTER LIVE COCKPIT" or "OPEN RIDE LOBBY"

### **Test 2: GPS Tracking**
1. Start a live ride
2. Wait for GPS permission request
3. See your location on the map
4. Check GPS accuracy display in header

### **Test 3: Create a New Ride** (Requires Server)
1. Make sure backend server is running
2. Click "Create Ride" button
3. Fill in ride details
4. Click "Save & Create"
5. Should appear in your rides list

### **Test 4: Navigation**
1. Click bottom navigation buttons:
   - 🏠 Home
   - 📍 Plan (create ride)
   - 🚀 Live (active rides)
   - 📋 History (past rides)

---

## 🔧 Backend Server Setup (If Needed)

### **First Time Setup:**

```bash
cd server
npm install
npm start
```

### **What the Server Does:**
- Runs on `http://localhost:5000`
- Manages SQLite database
- Provides REST API for CRUD operations
- Handles WebSocket connections (optional)
- Stores ride data persistently

### **Server Endpoints:**
```
GET  /api/profiles      - Get all riders
GET  /api/rides         - Get all rides
POST /api/rides         - Create new ride
GET  /api/rides/:id     - Get ride details
PUT  /api/rides/:id     - Update ride
DELETE /api/rides/:id   - Delete ride
POST /api/rides/:id/members - Join ride
```

---

## 🚀 Using the App

### **Home Screen**
- See your rides
- Quick stats (bike model, total km, rides count)
- Active ride cards with member avatars
- Recent completed rides

### **Create Ride Screen**
- Enter ride name, date, time
- Set start and destination
- Add intermediate stops
- View distance and duration
- Save and create

### **Ride Lobby**
- See approved members
- Request approval from lead (if member)
- Approve/decline join requests (if lead)
- Start live ride (if lead)
- View ride details

### **Live Map**
- GPS-tracked motorcycle position
- Rider formation display
- Route visualization
- Speed and heading display
- Emergency SOS button
- Weather radar (optional)
- Recenter and navigation controls

---

## 📊 Features Included

### **GPS & Navigation**
- ✅ Real-time GPS tracking
- ✅ Kalman filtering for smooth movement
- ✅ Adaptive polling based on accuracy
- ✅ Google Maps, CartoDB, ESRI satellite views
- ✅ OSRM routing with turn-by-turn

### **Group Features**
- ✅ Multi-rider formation tracking
- ✅ Rider separation detection
- ✅ Route deviation alerts
- ✅ Real-time telemetry
- ✅ Group chat messages
- ✅ Waypoint navigation

### **Safety Features**
- ✅ Emergency SOS with audio alert
- ✅ Battery level monitoring
- ✅ Weather radar overlay
- ✅ Separation notifications
- ✅ Off-route warnings

### **UI/UX**
- ✅ Google Maps-style journey mode
- ✅ Smart intelligent re-center
- ✅ Smooth animations
- ✅ Dark/Light themes
- ✅ Helmet-friendly button sizing
- ✅ Glove-friendly controls

---

## 🎯 Next Steps

1. ✅ **Start Backend Server**
   ```bash
   cd server
   npm start
   ```

2. ✅ **Open Frontend**
   - Open `web_app/index.html` in browser
   - Or serve with: `python -m http.server 8000` in web_app folder

3. ✅ **Create a Test Ride**
   - Click "Create Ride"
   - Fill in details
   - Start a live ride

4. ✅ **Test GPS Tracking**
   - Allow location permission
   - Watch position update on map
   - Check accuracy display

5. ✅ **Explore Features**
   - Try different map layers
   - Test recenter button
   - Check separation alerts
   - View ride history

---

## 📞 Troubleshooting

| Problem | Solution |
|---------|----------|
| Buttons don't work | Start backend server (`npm start` in server folder) |
| No rides shown | Hard refresh browser (Ctrl+Shift+R) |
| Can't create rides | Ensure server is running |
| GPS not working | Allow location permission when prompted |
| Map not loading | Check browser console for errors (F12) |
| Server won't start | Run `npm install` in server folder first |
| Port 5000 already in use | Change port in `server/server.js` and in `db.js` |

---

## ✨ Pro Tips

1. **Keep server running** in a separate terminal while developing
2. **Check browser console** (F12) for helpful debug messages
3. **Hard refresh** (Ctrl+Shift+R) if changes don't appear
4. **Use Chrome DevTools** for better debugging
5. **Test on mobile** by accessing `http://[your-ip]:port` from phone

---

## 🆘 Getting Help

1. Check this guide first
2. Read console errors (F12)
3. Check `/FINAL_SUMMARY.md` for feature overview
4. Review `/COMPLETE_ENHANCEMENT_SUMMARY.md` for bug fixes
5. Check `/BUG_FIXES_AND_IMPROVEMENTS.md` for known issues

---

**Ready to ride?** 🏍️ Let's go! 🚀