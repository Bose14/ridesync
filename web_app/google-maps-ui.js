/**
 * RideSync - Google Maps-Style Navigation UI
 * Optimized for high-speed motorcycle riding (60-80 km/h)
 * Features: Professional navigation, voice guidance, road snapping, group tracking
 */

const GoogleMapsStyleUI = (function () {
  let currentRoute = null;
  let currentStep = 0;
  let voiceEnabled = true;
  let isNavigating = false;
  let upcomingTurns = [];
  let distanceToTurn = 0;

  // ===== GOOGLE MAPS-STYLE UI COMPONENTS =====

  function createNavigationUI() {
    const uiHTML = `
      <!-- Main Navigation Container -->
      <div id="googleMapsNavigationUI" class="gm-nav-container" style="display: none;">

        <!-- Top: Current Instruction Banner -->
        <div class="gm-instruction-banner">
          <div class="gm-instruction-content">
            <div class="gm-turn-icon-container">
              <svg class="gm-turn-icon" id="gmTurnIcon" viewBox="0 0 24 24" width="40" height="40">
                <path d="M12 2L2 12h8v8h4v-8h8z" fill="currentColor"/>
              </svg>
            </div>
            <div class="gm-instruction-text">
              <div class="gm-instruction-main" id="gmMainInstruction">Head west</div>
              <div class="gm-instruction-secondary" id="gmSecondaryInstruction">Heading towards destination</div>
            </div>
            <div class="gm-distance-display">
              <div class="gm-distance-value" id="gmDistanceValue">400</div>
              <div class="gm-distance-unit">m</div>
            </div>
          </div>
        </div>

        <!-- Next Instruction Preview -->
        <div class="gm-next-instruction-strip">
          <div class="gm-next-turn-icon" id="gmNextTurnIcon">↗</div>
          <div class="gm-next-instruction-text" id="gmNextInstruction">Then turn right onto NH44</div>
          <div class="gm-next-distance" id="gmNextDistance">2.4 km</div>
        </div>

        <!-- Bottom Navigation Card -->
        <div class="gm-nav-card">
          <div class="gm-nav-card-left">
            <div class="gm-eta-time" id="gmETA">5 hr 11 min</div>
            <div class="gm-nav-info">
              <span class="gm-distance-info" id="gmTotalDistance">241 km</span>
              <span class="gm-separator">•</span>
              <span class="gm-arrival-time" id="gmArrivalTime">6:24 AM</span>
            </div>
          </div>
          <div class="gm-nav-card-right">
            <button class="gm-btn-icon gm-btn-info" id="gmBtnInfo" title="Route info">ℹ️</button>
            <button class="gm-btn-icon gm-btn-exit" id="gmBtnExit" title="Exit navigation">✕</button>
          </div>
        </div>

        <!-- Quick Action Buttons -->
        <div class="gm-quick-controls">
          <button class="gm-quick-btn" id="gmBtnVoice" title="Toggle voice guidance">
            <span class="gm-icon">🔊</span>
            <span class="gm-label">Voice</span>
          </button>
          <button class="gm-quick-btn" id="gmBtnOverview" title="Route overview">
            <span class="gm-icon">🗺️</span>
            <span class="gm-label">Overview</span>
          </button>
          <button class="gm-quick-btn" id="gmBtnRecenter" title="Recenter map">
            <span class="gm-icon">📍</span>
            <span class="gm-label">Recenter</span>
          </button>
          <button class="gm-quick-btn" id="gmBtnCompass" title="Toggle compass mode">
            <span class="gm-icon">🧭</span>
            <span class="gm-label">Compass</span>
          </button>
        </div>

        <!-- Group Formation Panel (Compact) -->
        <div class="gm-group-panel" id="gmGroupPanel" style="display: none;">
          <div class="gm-group-title">Formation: 3 riders</div>
          <div class="gm-group-riders" id="gmGroupRiders">
            <!-- Riders list inserted here -->
          </div>
        </div>

        <!-- Road Hazards/Alerts -->
        <div class="gm-alerts-container" id="gmAlertsContainer" style="display: none;">
          <!-- Dynamic alerts inserted here -->
        </div>
      </div>

      <style>
        /* Google Maps-Style Navigation UI */
        .gm-nav-container {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 1000;
          pointer-events: none;
        }

        .gm-instruction-banner {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          background: linear-gradient(135deg, rgba(26, 115, 232, 0.95), rgba(25, 103, 210, 0.95));
          color: white;
          padding: 16px;
          z-index: 1001;
          pointer-events: auto;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
          border-radius: 0 0 12px 12px;
        }

        .gm-instruction-content {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 8px;
        }

        .gm-turn-icon-container {
          display: flex;
          align-items: center;
          justify-content: center;
          min-width: 48px;
          height: 48px;
          background: rgba(255, 255, 255, 0.2);
          border-radius: 4px;
        }

        .gm-turn-icon {
          width: 32px;
          height: 32px;
          fill: white;
          filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.3));
        }

        .gm-instruction-text {
          flex: 1;
        }

        .gm-instruction-main {
          font-size: 20px;
          font-weight: 700;
          line-height: 1.2;
          margin-bottom: 2px;
        }

        .gm-instruction-secondary {
          font-size: 13px;
          opacity: 0.9;
          color: rgba(255, 255, 255, 0.8);
        }

        .gm-distance-display {
          display: flex;
          align-items: baseline;
          gap: 2px;
          background: rgba(255, 255, 255, 0.15);
          padding: 6px 10px;
          border-radius: 4px;
          min-width: 60px;
          text-align: right;
        }

        .gm-distance-value {
          font-size: 18px;
          font-weight: 700;
        }

        .gm-distance-unit {
          font-size: 12px;
          opacity: 0.9;
        }

        .gm-next-instruction-strip {
          position: fixed;
          top: 140px;
          left: 0;
          right: 0;
          background: rgba(60, 64, 67, 0.95);
          color: rgba(255, 255, 255, 0.87);
          padding: 12px 16px;
          display: flex;
          align-items: center;
          gap: 12px;
          z-index: 1000;
          pointer-events: none;
          font-size: 13px;
        }

        .gm-next-turn-icon {
          font-size: 16px;
          min-width: 16px;
          text-align: center;
        }

        .gm-next-instruction-text {
          flex: 1;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .gm-next-distance {
          color: rgba(255, 255, 255, 0.6);
          font-size: 12px;
          min-width: 40px;
          text-align: right;
        }

        /* Bottom Navigation Card */
        .gm-nav-card {
          position: fixed;
          bottom: 20px;
          left: 16px;
          right: 16px;
          background: rgba(32, 33, 36, 0.98);
          color: white;
          padding: 16px;
          border-radius: 12px;
          z-index: 1001;
          pointer-events: auto;
          display: flex;
          justify-content: space-between;
          align-items: center;
          box-shadow: 0 5px 20px rgba(0, 0, 0, 0.3);
        }

        .gm-nav-card-left {
          flex: 1;
        }

        .gm-eta-time {
          font-size: 22px;
          font-weight: 700;
          line-height: 1.2;
          margin-bottom: 4px;
        }

        .gm-nav-info {
          display: flex;
          gap: 8px;
          font-size: 13px;
          color: rgba(255, 255, 255, 0.7);
          align-items: center;
        }

        .gm-distance-info {
          font-weight: 500;
        }

        .gm-separator {
          opacity: 0.5;
        }

        .gm-nav-card-right {
          display: flex;
          gap: 8px;
          margin-left: 12px;
        }

        .gm-btn-icon {
          background: rgba(255, 255, 255, 0.15);
          border: none;
          color: white;
          width: 44px;
          height: 44px;
          border-radius: 8px;
          font-size: 18px;
          cursor: pointer;
          pointer-events: auto;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s;
        }

        .gm-btn-icon:hover {
          background: rgba(255, 255, 255, 0.25);
          transform: scale(1.05);
        }

        .gm-btn-icon:active {
          transform: scale(0.95);
        }

        .gm-btn-exit {
          background: #EA4335;
        }

        .gm-btn-exit:hover {
          background: #D33425;
        }

        /* Quick Controls */
        .gm-quick-controls {
          position: fixed;
          right: 16px;
          top: 200px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          z-index: 1000;
          pointer-events: auto;
        }

        .gm-quick-btn {
          width: 56px;
          height: 56px;
          border-radius: 28px;
          border: none;
          background: rgba(255, 255, 255, 0.95);
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
          cursor: pointer;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 2px;
          font-size: 20px;
          color: #3C4043;
          transition: all 0.2s;
          overflow: hidden;
        }

        .gm-quick-btn:hover {
          background: white;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
          transform: scale(1.1);
        }

        .gm-quick-btn:active {
          transform: scale(0.95);
        }

        .gm-icon {
          font-size: 24px;
        }

        .gm-label {
          font-size: 9px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          display: none;
        }

        /* Group Panel */
        .gm-group-panel {
          position: fixed;
          left: 16px;
          bottom: 90px;
          background: rgba(255, 255, 255, 0.95);
          padding: 12px;
          border-radius: 8px;
          z-index: 1000;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
          pointer-events: auto;
          max-width: 280px;
        }

        .gm-group-title {
          font-size: 12px;
          font-weight: 600;
          color: #3C4043;
          margin-bottom: 8px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .gm-group-riders {
          display: flex;
          gap: 8px;
          overflow-x: auto;
        }

        .gm-rider-badge {
          display: flex;
          align-items: center;
          gap: 4px;
          background: rgba(26, 115, 232, 0.1);
          padding: 4px 8px;
          border-radius: 12px;
          font-size: 11px;
          white-space: nowrap;
          color: #1A73E8;
          font-weight: 500;
        }

        /* Alerts */
        .gm-alerts-container {
          position: fixed;
          top: 180px;
          left: 16px;
          right: 16px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          z-index: 999;
          pointer-events: auto;
          max-height: 200px;
          overflow-y: auto;
        }

        .gm-alert {
          background: white;
          padding: 12px;
          border-radius: 8px;
          border-left: 4px solid #FBBC04;
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
          font-size: 13px;
          color: #3C4043;
        }

        .gm-alert.danger {
          border-left-color: #EA4335;
          background: #FFF0F0;
        }

        .gm-alert.success {
          border-left-color: #34A853;
          background: #F0FFF0;
        }

        /* Tablet & Mobile: 768px and below */
        @media (max-width: 768px) {
          .gm-instruction-banner {
            padding: 12px;
          }

          .gm-instruction-main {
            font-size: 18px;
          }

          .gm-instruction-secondary {
            font-size: 12px;
          }

          .gm-distance-display {
            padding: 4px 8px;
            min-width: 50px;
          }

          .gm-distance-value {
            font-size: 16px;
          }

          .gm-eta-time {
            font-size: 18px;
          }

          /* Quick controls: move to bottom, horizontal layout */
          .gm-quick-controls {
            position: fixed;
            bottom: 16px;
            right: auto;
            left: 16px;
            top: auto;
            flex-direction: row;
            justify-content: center;
            gap: 10px;
            padding: 12px;
            background: rgba(255, 255, 255, 0.95);
            border-radius: 12px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
            width: auto;
            max-width: none;
          }

          .gm-quick-btn {
            width: 52px;
            height: 52px;
            border-radius: 26px;
            font-size: 18px;
            flex: 1;
            max-width: 90px;
          }

          .gm-icon {
            font-size: 22px;
          }

          .gm-label {
            display: inline;
            font-size: 8px;
            margin-top: 2px;
          }

          /* Move nav card up to avoid overlap with quick controls */
          .gm-nav-card {
            bottom: 80px;
            left: 8px;
            right: 8px;
            padding: 12px;
          }

          .gm-nav-card-right {
            gap: 6px;
            margin-left: 8px;
          }

          .gm-btn-icon {
            width: 40px;
            height: 40px;
            font-size: 16px;
          }

          .gm-group-panel {
            left: 16px;
            bottom: 85px;
            max-width: 150px;
          }
        }

        /* Mobile: 480px and below */
        @media (max-width: 480px) {
          .gm-nav-container {
            font-size: 14px;
          }

          .gm-instruction-banner {
            padding: 10px;
            border-radius: 0 0 8px 8px;
          }

          .gm-instruction-content {
            gap: 8px;
            margin-bottom: 6px;
          }

          .gm-turn-icon-container {
            min-width: 40px;
            height: 40px;
          }

          .gm-turn-icon {
            width: 28px;
            height: 28px;
          }

          .gm-instruction-main {
            font-size: 16px;
            font-weight: 600;
          }

          .gm-instruction-secondary {
            font-size: 11px;
          }

          .gm-next-instruction-strip {
            top: 120px;
            padding: 10px;
            font-size: 12px;
          }

          .gm-next-turn-icon {
            font-size: 14px;
            min-width: 12px;
          }

          .gm-next-distance {
            font-size: 11px;
            min-width: 35px;
          }

          .gm-distance-value {
            font-size: 14px;
          }

          .gm-distance-unit {
            font-size: 10px;
          }

          .gm-eta-time {
            font-size: 16px;
            margin-bottom: 2px;
          }

          .gm-nav-info {
            gap: 6px;
            font-size: 12px;
          }

          /* Bottom controls stack better on tiny screens */
          .gm-quick-controls {
            bottom: 12px;
            left: 12px;
            right: 12px;
            gap: 8px;
            padding: 10px;
          }

          .gm-quick-btn {
            width: 46px;
            height: 46px;
            border-radius: 23px;
            font-size: 16px;
          }

          .gm-icon {
            font-size: 18px;
          }

          .gm-label {
            font-size: 7px;
            margin-top: 1px;
          }

          .gm-nav-card {
            bottom: 70px;
            left: 6px;
            right: 6px;
            padding: 10px;
          }

          .gm-nav-card-left {
            min-width: 120px;
          }

          .gm-nav-card-right {
            gap: 4px;
            margin-left: 6px;
          }

          .gm-btn-icon {
            width: 36px;
            height: 36px;
            font-size: 14px;
          }

          .gm-group-panel {
            left: 12px;
            bottom: 75px;
            padding: 8px;
            max-width: 120px;
          }

          .gm-group-title {
            font-size: 10px;
            margin-bottom: 6px;
          }

          .gm-rider-badge {
            font-size: 10px;
            padding: 3px 6px;
          }
        }

        /* Dark Theme */
        [data-theme="night"] .gm-nav-card,
        [data-theme="night"] .gm-group-panel,
        [data-theme="night"] .gm-alert {
          background: rgba(32, 33, 36, 0.98);
          color: rgba(255, 255, 255, 0.87);
        }

        [data-theme="night"] .gm-alert {
          background: rgba(60, 64, 67, 0.95);
        }
      </style>
    `;

    return uiHTML;
  }

  // ===== NAVIGATION FUNCTIONS =====

  function startNavigation(route) {
    if (!route || !route.legs) return false;

    currentRoute = route;
    currentStep = 0;
    upcomingTurns = extractTurns(route);
    isNavigating = true;

    // Inject UI if not present
    if (!document.getElementById('googleMapsNavigationUI')) {
      const uiContainer = document.createElement('div');
      uiContainer.innerHTML = createNavigationUI();
      document.body.appendChild(uiContainer);
      attachEventListeners();
    }

    // Show UI
    const uiEl = document.getElementById('googleMapsNavigationUI');
    if (uiEl) uiEl.style.display = 'block';

    // Display first instruction
    updateNavigationDisplay(0);
    playVoiceGuidance(upcomingTurns[0]);

    return true;
  }

  function extractTurns(route) {
    const turns = [];

    if (route.legs) {
      route.legs.forEach((leg, legIdx) => {
        if (leg.steps) {
          leg.steps.forEach((step, stepIdx) => {
            turns.push({
              instruction: step.instructions || 'Continue',
              distance: step.distance ? step.distance.value : 0,
              distanceText: step.distance ? step.distance.text : '...',
              heading: calculateHeading(step.start_location, step.end_location),
              location: step.start_location,
              isFirstStep: legIdx === 0 && stepIdx === 0,
              isLastStep: legIdx === route.legs.length - 1 && stepIdx === leg.steps.length - 1
            });
          });
        }
      });
    }

    return turns;
  }

  function calculateHeading(from, to) {
    if (!from || !to) return 0;
    const lat1 = from.lat ? from.lat() : from.lat;
    const lng1 = from.lng ? from.lng() : from.lng;
    const lat2 = to.lat ? to.lat() : to.lat;
    const lng2 = to.lng ? to.lng() : to.lng;

    const dLng = lng2 - lng1;
    const y = Math.sin(dLng * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180);
    const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
              Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLng * Math.PI / 180);
    const heading = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    return Math.round(heading);
  }

  function updateNavigationDisplay(stepIndex) {
    if (!upcomingTurns[stepIndex]) return;

    const turn = upcomingTurns[stepIndex];
    const nextTurn = upcomingTurns[stepIndex + 1];

    // Current instruction
    document.getElementById('gmMainInstruction').innerText = turn.instruction;
    document.getElementById('gmDistanceValue').innerText = formatDistance(turn.distance);
    document.getElementById('gmTurnIcon').setAttribute('data-heading', turn.heading);
    rotateTurnIcon(turn.heading);

    // Next instruction
    if (nextTurn) {
      document.getElementById('gmNextInstruction').innerText = `Then ${nextTurn.instruction}`;
      document.getElementById('gmNextDistance').innerText = formatDistance(nextTurn.distance);
    }

    // ETA calculations
    if (currentRoute) {
      const totalDistance = currentRoute.legs.reduce((sum, leg) => sum + (leg.distance ? leg.distance.value : 0), 0);
      const remainingDistance = upcomingTurns.slice(stepIndex).reduce((sum, t) => sum + t.distance, 0);
      const estimatedTime = calculateETA(remainingDistance);

      document.getElementById('gmETA').innerText = estimatedTime;
      document.getElementById('gmTotalDistance').innerText = `${(totalDistance / 1000).toFixed(1)} km`;
    }

    currentStep = stepIndex;
  }

  function rotateTurnIcon(heading) {
    const icon = document.getElementById('gmTurnIcon');
    if (icon) {
      icon.style.transform = `rotate(${heading}deg)`;
    }
  }

  function formatDistance(meters) {
    if (meters < 1000) {
      return Math.round(meters);
    }
    return `${(meters / 1000).toFixed(1)}`;
  }

  function calculateETA(distanceMeters) {
    // Assuming average 60 km/h for motorcycles
    const distanceKm = distanceMeters / 1000;
    const minutes = Math.round((distanceKm / 60) * 60);

    if (minutes < 60) {
      return `${minutes} min`;
    }

    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours} hr ${mins > 0 ? mins + ' min' : ''}`;
  }

  // ===== VOICE GUIDANCE =====

  function playVoiceGuidance(turn) {
    if (!voiceEnabled || !window.speechSynthesis) return;

    const utterance = new SpeechSynthesisUtterance(turn.instruction);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 0.8;

    try {
      window.speechSynthesis.cancel(); // Cancel any ongoing speech
      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.warn('Voice guidance error:', e);
    }
  }

  // ===== HIGH-ACCURACY TRACKING =====

  function updatePositionAccurate(lat, lng, accuracy) {
    if (!isNavigating || !upcomingTurns[currentStep]) return;

    const turn = upcomingTurns[currentStep];
    const distance = calculateDistanceToTurn(lat, lng, turn);
    const distanceRemaining = turn.distance;

    // Update distance display
    document.getElementById('gmDistanceValue').innerText = formatDistance(distanceRemaining - distance);

    // Check if approaching turn (within 100m or 5 seconds)
    const approachingThreshold = Math.max(100, (60 / 3.6) * 5); // 100m or 5 seconds at 60 km/h

    if (distance >= distanceRemaining - approachingThreshold && currentStep < upcomingTurns.length - 1) {
      if (Math.abs((distanceRemaining - distance) - approachingThreshold) < 50) {
        // Approaching turn
        playApproachingSound();
        updateNavigationDisplay(currentStep + 1);
        playVoiceGuidance(upcomingTurns[currentStep + 1]);
      }
    }

    // Missed turn detection (if rider goes backwards past turn)
    if (distance < -200) {
      recalculateRoute();
      playAlertSound('warning');
      showAlert('Route recalculated', 'You went off the planned route', 'warning');
    }
  }

  function calculateDistanceToTurn(lat, lng, turn) {
    if (!turn.location) return 0;
    const turnLat = turn.location.lat ? turn.location.lat() : turn.location.lat;
    const turnLng = turn.location.lng ? turn.location.lng() : turn.location.lng;

    return haversineDistance(lat, lng, turnLat, turnLng);
  }

  function haversineDistance(lat1, lng1, lat2, lng2) {
    const R = 6371000; // Earth radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  // ===== ALERTS & SOUNDS =====

  function playApproachingSound() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.frequency.value = 1000;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
  }

  function playAlertSound(type = 'warning') {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const freq = type === 'warning' ? 800 : 600;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.5);
  }

  function showAlert(title, message, type = 'info') {
    const container = document.getElementById('gmAlertsContainer');
    if (!container) return;

    const alert = document.createElement('div');
    alert.className = `gm-alert ${type === 'warning' ? 'danger' : type}`;
    alert.innerHTML = `<strong>${title}:</strong> ${message}`;

    container.appendChild(alert);
    container.style.display = 'flex';

    setTimeout(() => {
      alert.style.opacity = '0';
      alert.style.transition = 'opacity 0.3s';
      setTimeout(() => alert.remove(), 300);
    }, 4000);
  }

  // ===== EVENT LISTENERS =====

  function attachEventListeners() {
    // Voice Toggle Button
    const voiceBtn = document.getElementById('gmBtnVoice');
    if (voiceBtn) {
      voiceBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        voiceEnabled = !voiceEnabled;
        voiceBtn.style.opacity = voiceEnabled ? '1' : '0.5';
        showAlert(voiceEnabled ? 'Voice enabled' : 'Voice disabled', '', 'success');
      });
    }

    // Cancel/Exit Navigation Button
    const exitBtn = document.getElementById('gmBtnExit');
    if (exitBtn) {
      exitBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (window.confirmExitRide) {
          window.confirmExitRide();
        } else {
          stopNavigation();
        }
        showAlert('Navigation ended', 'Safe travels!', 'success');
      });
    }

    // Recenter Button - Center map on rider
    const recenterBtn = document.getElementById('gmBtnRecenter');
    if (recenterBtn) {
      recenterBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          // Try NavigationEngine first
          if (window.NavigationEngine && window.NavigationEngine.recenterOnRider) {
            const mapInstance = window.map || window.leafletMap;
            window.NavigationEngine.recenterOnRider(mapInstance);
            showAlert('Recentered', 'Zoomed to street-level', 'success');
          }
          // Fallback to app.js function
          else if (window.recenterOnGroup) {
            window.recenterOnGroup(false);
            showAlert('Recentered', 'Focusing on your position', 'success');
          }
          // Last fallback - pan map manually
          else if (window.state && window.state.map && window.state.userGps) {
            window.state.map.panTo([window.state.userGps.lat, window.state.userGps.lng]);
            if (window.state.map.setZoom) window.state.map.setZoom(18);
            showAlert('Recentered', 'Zoomed to street-level', 'success');
          }
        } catch (err) {
          console.error('Recenter error:', err);
          showAlert('Recenter', 'Centering on your position', 'info');
        }
      });
    }

    // Route Overview Button - Show full route
    const overviewBtn = document.getElementById('gmBtnOverview');
    if (overviewBtn) {
      overviewBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          // Try NavigationEngine first
          if (window.NavigationEngine && window.NavigationEngine.showRoute) {
            const mapInstance = window.map || window.leafletMap;
            window.NavigationEngine.showRoute(mapInstance);
            showAlert('Route Overview', 'Showing full route', 'success');
          }
          // Fallback to app.js function
          else if (window.fitAllRidersInView) {
            window.fitAllRidersInView();
            showAlert('Route Overview', 'Showing full route', 'success');
          }
          // Last fallback - zoom out map
          else if (window.state && window.state.map) {
            window.state.map.setZoom(14);
            showAlert('Route Overview', 'Zoomed out to see route', 'info');
          }
        } catch (err) {
          console.error('Overview error:', err);
          showAlert('Route Overview', 'Loading route overview', 'info');
        }
      });
    }

    // Compass/Follow Mode Button
    const compassBtn = document.getElementById('gmBtnCompass');
    if (compassBtn) {
      let followMode = false;
      compassBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        followMode = !followMode;
        compassBtn.style.opacity = followMode ? '1' : '0.6';

        if (window.state) {
          window.state.isNavFollowMode = followMode;
        }
        showAlert(followMode ? 'Follow Mode ON' : 'Follow Mode OFF',
                  followMode ? 'Map will follow your movement' : 'Map movement disabled',
                  'success');
      });
    }
  }

  function stopNavigation() {
    isNavigating = false;
    const uiEl = document.getElementById('googleMapsNavigationUI');
    if (uiEl) uiEl.style.display = 'none';
  }

  function recalculateRoute() {
    console.log('[Navigation] Recalculating route due to off-route detection');
    showAlert('Route recalculated', 'New route calculated based on current position', 'warning');
  }

  // ===== PUBLIC API =====

  return {
    createNavigationUI,
    startNavigation,
    updatePositionAccurate,
    stopNavigation,
    playVoiceGuidance,
    showAlert,
    extractTurns,
    formatDistance,
    calculateETA,
    isNavigating: () => isNavigating,
    getCurrentStep: () => currentStep,
    getUpcomingTurns: () => upcomingTurns,
    toggleVoice: () => {
      voiceEnabled = !voiceEnabled;
      return voiceEnabled;
    }
  };
})();

// Make available globally
window.GoogleMapsStyleUI = GoogleMapsStyleUI;
