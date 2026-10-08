# Testing GPS Accuracy Improvements

## 🧪 Quick Test Checklist

### 1. **Start the App**
```bash
npm start
```
- Navigate to the Live Ride screen
- Allow GPS/Location permissions
- Watch the accuracy display in the GPS status label

### 2. **Check Accuracy Indicator**
In the top header, you should see:
- `🟢 Excellent (±5m)` - Indoor GPS with good signal
- `🟢 Very Good (±10m)` - Urban area with clear sky
- `🟡 Good (±20m)` - Suburban, some obstruction
- `🟠 Fair (±50m)` - Urban canyon, buildings

**Expected:** Accuracy should be **2-3x better** than before

### 3. **Test on a Motorcycle Ride**

#### Straight Line Test (30-60 km/h)
- Ride in a straight line
- Watch the rider marker path
- **Before fix:** Zigzag, jittery movement
- **After fix:** Smooth, straight line following actual road

#### Turn Test (40-80 km/h)
- Make a sharp turn at intersection
- Watch heading indicator (°)
- **Expected:** Heading follows your actual turn, not previous direction

#### Stop Test
- Bring motorcycle to complete stop
- Position should stabilize within 5-10 meters
- Should NOT drift or jump around
- **Adaptive polling:** Interval increases when stopped

#### Speed Spike Test
- Sudden acceleration (0→60 km/h)
- Speed indicator should NOT spike past actual speed
- Should smoothly ramp up over 2-3 seconds

#### GPS Dropout Test
- Go through a tunnel or underground parking
- Mark position before tunnel
- App should use **dead-reckoning** (accelerometer + last known speed)
- When GPS returns, smooth re-lock without jump

### 4. **Multi-Rider Formation Test**
- Start a group ride with 2-3 riders
- Each rider should appear smooth on the map
- No false "separated" alerts
- Distance between riders should be stable

### 5. **Urban Canyon Test** (High buildings, narrow streets)
- Ride through downtown area
- Accept accuracy will be ±20-50m (expected)
- But motion should still be smooth (not jittery)
- Heading should still track your actual direction

---

## 📊 Metrics to Monitor

Open browser console and run:

```javascript
// Real-time metrics
setInterval(() => {
  const m = PayanamMaps.getGpsMetrics();
  console.table(m);
}, 2000);
```

**What to look for:**

| Metric | Good Value | Bad Value |
|--------|-----------|----------|
| `kalmanAccuracy` | 5-20m | >50m |
| `currentSpeed` | Smooth ramp | Spiky/jumpy |
| `currentHeading` | ±5° of actual | Bouncing wildly |
| `adaptivePollingMs` | 500-1500 | Stuck at 1000 |
| `isMoving` | Accurate | Always true/false |
| `motionIntensity` | Correlates with acceleration | Flat/random |

---

## 🚀 Performance Expected

### Before Improvements
```
✗ Jitter: ±20-50m
✗ Bearing: Unreliable, changes on straight road
✗ Speed: Spiky, rapid +/- changes
✗ Separation alerts: False positives (riders drift apart)
✗ Path: Zigzag even on straight road
```

### After Improvements
```
✓ Jitter: ±5-15m (70% reduction)
✓ Bearing: Locked to actual heading ±3°
✓ Speed: Smooth, realistic acceleration curve
✓ Separation: Accurate distance, no false alerts
✓ Path: Smooth, follows road naturally
```

---

## 🐛 Debugging Common Issues

### Issue: "Accuracy still shows ±30-50m"
**Causes:**
- Location is in urban canyon (buildings block GPS)
- Weather/atmospheric interference
- Device GPS receiver is weak
- Airplane mode or low satellite coverage

**Solution:**
- Test in open area (parking lot, highway)
- Check if other GPS apps show similar accuracy
- Try different device if available

### Issue: "Speed still spiky"
**Causes:**
- Device compass unreliable
- Driving on winding roads (bearing changes a lot)
- GPS fix jumping

**Solution:**
- Kalman filter needs calibration time (1-2 min of riding)
- Speed validation should smooth it within 30 seconds
- Try riding in straight line first

### Issue: "Heading shows 0° or undefined"
**Causes:**
- Device doesn't have compass
- Compass disabled by browser permissions
- Speed too low (< 3 km/h) to trust bearing

**Solution:**
- Heading calculated from movement trajectory instead
- Should work fine even without compass
- Speed up to > 3 km/h for bearing to work

### Issue: "Adaptive polling stuck at 1000ms"
**Causes:**
- GPS accuracy not being estimated correctly
- Motion sensor not initialized

**Solution:**
- Allow accelerometer permissions
- Kalman filter needs to learn (wait 10-20 GPS fixes)
- Check browser console for errors

---

## 📝 Testing Log Template

```markdown
## Test Run: [Date/Time/Location]

### Environment
- Device: [iPhone/Android/Desktop]
- Browser: [Chrome/Safari/Firefox]
- Location Type: [Urban/Suburban/Highway]
- Weather: [Clear/Cloudy/Rainy]

### Accuracy Test
- Opening accuracy: [±Xm]
- Peak accuracy: [±Xm]
- Average accuracy: [±Xm]
- Observations: [Notes]

### Heading Test
- Device heading vs actual: [±X°]
- Consistency: [Stable/Jittery]
- Notes: [Description]

### Speed Test
- Max speed: [XXX km/h]
- Spike count: [N]
- Smoothness rating: [1-10]

### Formation Test
- Riders: [N]
- Max distance shown: [Xm]
- Min distance shown: [Xm]
- False separations: [N]

### Issues Found
- [ ] Issue 1
- [ ] Issue 2
- [ ] Issue 3

### Overall Rating
Rating: [1-10] ⭐⭐⭐
Performance vs Before: [Much better / Same / Worse]
Ready for Production: [Yes / No]
```

---

## 🎯 Success Criteria

✅ **You'll know it's working when:**

1. GPS accuracy shows as "Good" or better (±20m or less)
2. Rider path is a smooth line, not zigzag
3. Speed doesn't jump more than ±10 km/h
4. Heading follows actual direction (±5° error max)
5. No false separation alerts in group rides
6. Accelerometer motion detected (when riding)
7. Polling interval adapts based on speed/accuracy
8. Works reliably at 30-120+ km/h speeds

---

## 📞 Troubleshooting Support

If something isn't working:

1. **Check browser console** for errors
   ```javascript
   console.log(PayanamMaps.getGpsMetrics());
   ```

2. **Verify sensors are enabled**
   - Settings → Privacy → Location → Allow
   - Settings → Privacy → Motion & Fitness → Allow

3. **Test with official GPS app first**
   - Google Maps
   - Apple Maps
   - GPS Status app
   - Compare accuracy readings

4. **Check Kalman filter state**
   ```javascript
   // Should show improving estimate over time
   PayanamMaps.KalmanFilter1D.prototype
   ```

5. **Report detailed issue:**
   - Device model & OS version
   - Browser & version
   - Location (city/area)
   - Accuracy readings at different speeds
   - Console errors (if any)
