/**
 * RideSync Authentication & Phone OTP Controller
 * Supports Live Phone Verification, SMS Simulation, Auto-fill Test Accounts,
 * and Rider Profile Onboarding directly into the Database.
 */

const RideSyncAuth = (function () {
  let pendingPhone = '';
  let generatedOtp = '';
  let resendCountdown = 30;
  let resendTimerInterval = null;

  // Initialize Auth State on Page Load
  function init() {
    setupOtpInputListeners();
    checkSession();
  }

  function checkSession() {
    const activeUserId = RideSyncDB.getActiveUserId();
    const user = RideSyncDB.getProfile(activeUserId);
    if (user) {
      updateUserHeaderUi(user);
    } else {
      showAuthScreen();
    }
  }

  function showAuthScreen() {
    // Show Screen Auth
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const authScreen = document.getElementById('screenAuth');
    if (authScreen) authScreen.classList.add('active');
    resetOtpState();
  }

  function resetOtpState() {
    const stepPhone = document.getElementById('authStepPhone');
    const stepOtp = document.getElementById('authStepOtp');
    const stepProfile = document.getElementById('authStepProfile');

    if (stepPhone) stepPhone.style.display = 'block';
    if (stepOtp) stepOtp.style.display = 'none';
    if (stepProfile) stepProfile.style.display = 'none';

    clearInterval(resendTimerInterval);
    resendCountdown = 30;
    const resendBtn = document.getElementById('btnResendOtp');
    if (resendBtn) {
      resendBtn.disabled = true;
      resendBtn.innerText = 'Resend in 30s';
    }
  }

  // Step 1: Request OTP for Phone
  async function requestOtp(customPhone) {
    const phoneInput = document.getElementById('authPhoneInput');
    const countryCode = document.getElementById('authCountryCode')?.value || '+91';
    let rawPhone = customPhone || (phoneInput ? phoneInput.value.trim() : '');

    if (!rawPhone) {
      showToast('⚠️ Please enter a valid phone number', 'error');
      return;
    }

    // Format phone number
    if (!rawPhone.startsWith('+')) {
      rawPhone = countryCode + ' ' + rawPhone.replace(/^0+/, '');
    }
    pendingPhone = rawPhone;

    // Call Backend API
    try {
      const apiUrl = typeof RideSyncDB !== 'undefined' && RideSyncDB.getApiBaseUrl ? RideSyncDB.getApiBaseUrl() : 'https://ridesync-yibf.onrender.com/api';
      const res = await fetch(`${apiUrl}/auth/request-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: pendingPhone })
      });
      const data = await res.json();
      generatedOtp = data.otpCode || String(Math.floor(100000 + Math.random() * 900000));
    } catch (e) {
      generatedOtp = String(Math.floor(100000 + Math.random() * 900000));
    }

    // Show simulated SMS notification toast at the top
    showSmsNotification(pendingPhone, generatedOtp);

    // Switch to Step 2: OTP Verification
    document.getElementById('authStepPhone').style.display = 'none';
    document.getElementById('authStepOtp').style.display = 'block';
    document.getElementById('authStepProfile').style.display = 'none';

    // Update phone display
    const phoneDisplay = document.getElementById('authPhoneDisplay');
    if (phoneDisplay) phoneDisplay.innerText = pendingPhone;

    // Auto-focus first OTP digit
    const otpInputs = document.querySelectorAll('.otp-digit');
    otpInputs.forEach(i => i.value = '');
    if (otpInputs[0]) otpInputs[0].focus();

    // Start 30s Resend Timer
    startResendTimer();
  }

  // Quick 1-tap Test Rider Account Login
  async function quickLoginTestRider(riderId) {
    const profile = RideSyncDB.getProfile(riderId);
    if (!profile) return;

    pendingPhone = profile.phoneFormatted || profile.phone;
    generatedOtp = '123456';

    try {
      const apiUrl = typeof RideSyncDB !== 'undefined' && RideSyncDB.getApiBaseUrl ? RideSyncDB.getApiBaseUrl() : 'https://ridesync-yibf.onrender.com/api';
      await fetch(`${apiUrl}/auth/request-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: pendingPhone })
      });
    } catch (e) {}

    showSmsNotification(pendingPhone, generatedOtp);

    document.getElementById('authStepPhone').style.display = 'none';
    document.getElementById('authStepOtp').style.display = 'block';
    document.getElementById('authStepProfile').style.display = 'none';

    const phoneDisplay = document.getElementById('authPhoneDisplay');
    if (phoneDisplay) phoneDisplay.innerText = pendingPhone;

    // Auto-fill OTP digits
    const digits = generatedOtp.split('');
    const otpInputs = document.querySelectorAll('.otp-digit');
    otpInputs.forEach((input, index) => {
      input.value = digits[index] || '';
    });

    startResendTimer();
    showToast(`✅ Auto-filled credentials for ${profile.name} (${profile.bikeModel})`, 'info');
  }

  function startResendTimer() {
    clearInterval(resendTimerInterval);
    resendCountdown = 30;
    const resendBtn = document.getElementById('btnResendOtp');

    resendTimerInterval = setInterval(() => {
      resendCountdown--;
      if (resendCountdown <= 0) {
        clearInterval(resendTimerInterval);
        if (resendBtn) {
          resendBtn.disabled = false;
          resendBtn.innerText = 'Resend OTP';
        }
      } else {
        if (resendBtn) {
          resendBtn.disabled = true;
          resendBtn.innerText = `Resend in ${resendCountdown}s`;
        }
      }
    }, 1000);
  }

  // Step 2: Verify Entered OTP
  async function verifyOtp() {
    const otpInputs = document.querySelectorAll('.otp-digit');
    let enteredOtp = '';
    otpInputs.forEach(i => enteredOtp += i.value.trim());

    if (enteredOtp.length < 6) {
      showToast('⚠️ Please enter all 6 digits of the OTP', 'error');
      return;
    }

    let serverProfile = null;
    let isBackendSuccess = false;

    try {
      const apiUrl = typeof RideSyncDB !== 'undefined' && RideSyncDB.getApiBaseUrl ? RideSyncDB.getApiBaseUrl() : 'https://ridesync-yibf.onrender.com/api';
      const res = await fetch(`${apiUrl}/auth/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: pendingPhone, otp: enteredOtp })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        isBackendSuccess = true;
        if (data.profile) {
          serverProfile = RideSyncDB.normalizeProfile(data.profile);
          RideSyncDB.saveProfile(serverProfile);
        }
      } else if (!res.ok && enteredOtp !== generatedOtp && enteredOtp !== '123456') {
        showToast(`❌ ${data.error || 'Incorrect OTP'}`, 'error');
        return;
      }
    } catch (e) {
      console.warn('[RideSync Auth] Server verify-otp error/offline:', e);
    }

    // Accept server validation, generated OTP, or fallback demo OTP '123456'
    if (isBackendSuccess || enteredOtp === generatedOtp || enteredOtp === '123456') {
      showToast('🔐 OTP Verified Successfully!', 'success');

      // Check if user already exists in DB (server profile or local storage profile by phone)
      let user = serverProfile || RideSyncDB.getProfileByPhone(pendingPhone);
      if (user) {
        completeLogin(user);
      } else {
        // Step 3: Brand new user - prompt Rider Profile setup
        document.getElementById('authStepOtp').style.display = 'none';
        document.getElementById('authStepProfile').style.display = 'block';
        const profilePhoneInput = document.getElementById('newProfilePhone');
        if (profilePhoneInput) profilePhoneInput.value = pendingPhone;
      }
    } else {
      showToast('❌ Incorrect OTP code. Please check SMS or use 123456', 'error');
    }
  }

  // Step 3: Complete Registration for new rider
  function completeNewRiderRegistration() {
    const name = document.getElementById('newProfileName')?.value.trim();
    const bike = document.getElementById('newProfileBike')?.value.trim();
    const blood = document.getElementById('newProfileBlood')?.value || 'O+ve';
    const emergencyName = document.getElementById('newProfileEmergencyName')?.value.trim();
    const emergencyPhone = document.getElementById('newProfileEmergencyPhone')?.value.trim();

    if (!name || !bike) {
      showToast('⚠️ Please provide your Name and Motorcycle Model', 'error');
      return;
    }

    const newRider = RideSyncDB.createRiderAccount({
      name,
      phone: pendingPhone,
      bikeModel: bike,
      bloodGroup: blood,
      emergencyContactName: emergencyName,
      emergencyContactPhone: emergencyPhone
    });

    showToast(`🎉 Welcome to RideSync, ${newRider.name}!`, 'success');
    completeLogin(newRider);
  }

  function completeLogin(user) {
    RideSyncDB.setActiveUserId(user.id);
    updateUserHeaderUi(user);

    // Navigate to Home screen
    if (typeof navigateTo === 'function') {
      navigateTo('screenHome');
    } else {
      document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
      document.getElementById('screenHome')?.classList.add('active');
    }

    if (typeof reloadDynamicAppData === 'function') {
      reloadDynamicAppData();
    }
  }

  function logout() {
    RideSyncDB.clearActiveUser();
    showToast('👋 Logged out from RideSync', 'info');
    closeModal('modalProfile');
    showAuthScreen();
  }

  function updateUserHeaderUi(user) {
    const greetingName = document.querySelector('.user-greeting');
    if (greetingName) {
      greetingName.innerHTML = `${user.name} 👋`;
    }

    const avatarInitial = document.querySelector('.avatar-initial');
    if (avatarInitial) {
      avatarInitial.innerText = user.avatar || user.name[0];
    }

    const statBike = document.getElementById('statCurrentBike');
    if (statBike) {
      statBike.innerText = user.bikeModel.split(' ')[0] + ' ' + (user.bikeModel.split(' ')[1] || '');
    }

    const statKm = document.getElementById('statTotalKm');
    if (statKm) {
      statKm.innerText = user.totalKm.toLocaleString();
    }

    const statRides = document.getElementById('statGroupRides');
    if (statRides) {
      statRides.innerText = user.ridesCount;
    }
  }

  function setupOtpInputListeners() {
    const inputs = document.querySelectorAll('.otp-digit');
    inputs.forEach((input, idx) => {
      input.addEventListener('input', (e) => {
        if (e.target.value.length === 1 && idx < inputs.length - 1) {
          inputs[idx + 1].focus();
        }
      });

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !e.target.value && idx > 0) {
          inputs[idx - 1].focus();
        } else if (e.key === 'Enter') {
          verifyOtp();
        }
      });

      input.addEventListener('paste', (e) => {
        e.preventDefault();
        const pasteData = (e.clipboardData || window.clipboardData).getData('text').trim();
        if (/^\d+$/.test(pasteData)) {
          const digits = pasteData.slice(0, inputs.length).split('');
          digits.forEach((d, i) => {
            if (inputs[i]) inputs[i].value = d;
          });
          const targetIndex = Math.min(digits.length, inputs.length - 1);
          if (inputs[targetIndex]) inputs[targetIndex].focus();
        }
      });
    });
  }

  function showSmsNotification(phone, code) {
    const existing = document.getElementById('smsToastNotification');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = 'smsToastNotification';
    toast.className = 'sms-banner-toast';
    toast.innerHTML = `
      <div class="sms-icon">💬</div>
      <div class="sms-content">
        <div class="sms-header">
          <strong>Messages · RideSync SMS</strong>
          <span class="sms-time">Now</span>
        </div>
        <p class="sms-text">Your RideSync verification code is <span class="sms-otp-code">${code}</span>. Valid for 10 minutes.</p>
      </div>
      <button class="sms-autofill-btn" onclick="RideSyncAuth.autofillOtp('${code}')">Auto-fill</button>
    `;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('show');
    }, 50);

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 400);
    }, 9000);
  }

  function autofillOtp(code) {
    const inputs = document.querySelectorAll('.otp-digit');
    const digits = code.split('');
    inputs.forEach((input, index) => {
      input.value = digits[index] || '';
    });
    showToast('✨ OTP Code Auto-filled!', 'success');
  }

  return {
    init,
    showAuthScreen,
    requestOtp,
    quickLoginTestRider,
    verifyOtp,
    completeNewRiderRegistration,
    logout,
    autofillOtp,
    resetOtpState
  };
})();

// Payanam Namespace Alias
const PayanamAuth = RideSyncAuth;

