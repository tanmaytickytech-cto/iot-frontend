const API_BASE_URL = 'https://iot-backend-ipqy.onrender.com/api';

const IS_CLOUD = location.protocol === 'https:';
const IS_ESP_MODE = location.hostname === '192.168.4.1';


let currentUser = null;
let currentDevice = null;
let authToken = null;


let currentElectricityRate = 6.0;
let currentCurrency = 'INR';

// real-time relay polling
let relayPollIntervalId = null;
const RELAY_POLL_INTERVAL = 5000; // 5 seconds

function startRelayPolling() {
    stopRelayPolling();
    if (!currentDevice || !authToken) return;
    // immediate fetch then interval
    pollRelayStatus();
    relayPollIntervalId = setInterval(pollRelayStatus, RELAY_POLL_INTERVAL);
}

function stopRelayPolling() {
    if (relayPollIntervalId) {
        clearInterval(relayPollIntervalId);
        relayPollIntervalId = null;
    }
}

async function pollRelayStatus() {
    if (!currentDevice || !authToken) return;
    try {
        const response = await fetch(`${API_BASE_URL}/devices/${currentDevice}/status`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (!response.ok) return;
        const data = await response.json();
        // expected shape: data.powerInfo.relay1 {...}
        const powerInfo = data.powerInfo || {};
        for (let i = 1; i <= 4; i++) {
            const rKey = `relay${i}`;
            const info = powerInfo[rKey] || {};
            const powerRating = (typeof info.powerRating === 'number') ? info.powerRating : 0;
            const energy = (typeof info.energyConsumed === 'number') ? info.energyConsumed : (typeof info.energyWh === 'number' ? info.energyWh : 0);
            const cumulative = (typeof info.cumulativeEnergy === 'number') ? info.cumulativeEnergy : 0;
            const price = (typeof info.pricePerKWh === 'number') ? info.pricePerKWh : (typeof info.price === 'number' ? info.price : (currentElectricityRate || 0));
            const cost = cumulative * (price / 1000.0); // Wh -> kWh * price

            // Update DOM (guard exists)
            const powerEl = document.getElementById(`relay${i}_power`);
            const energyEl = document.getElementById(`relay${i}_energy`);
            const costEl = document.getElementById(`relay${i}_cost`);
            if (powerEl) powerEl.textContent = `${powerRating.toFixed(2)} W`;
            if (energyEl) energyEl.textContent = `${energy.toFixed(2)} Wh`;
            if (costEl) costEl.textContent = formatCurrency(cost, currentCurrency || 'INR');
        }
    } catch (err) {
        console.error('Relay poll error:', err);
    }
}

// --------------------- Utilities ---------------------
function safeGet(id) {
  return document.getElementById(id) || null;
}

function formatCurrency(amount = 0, currency = 'INR') {
  if (!isFinite(amount)) amount = 0;
  if (currency === 'INR') return '₹' + Number(amount).toFixed(2);
  return '$' + Number(amount).toFixed(2);
}

function showAlert(msg) {
  // lightweight alert wrapper - you can replace with modal/toast
  alert(msg);
}

// --------------------- Auth & Init ---------------------
document.addEventListener('DOMContentLoaded', initApp);

function initApp() {
  readLocalAuth();
  attachFormHandlers();
if (typeof attachUIHelpers === "function") {
  attachUIHelpers();
}

  if (authToken && currentUser) {
    showDashboard();
    loadDevices();
  } else {
    showLogin();
  }
}

function readLocalAuth() {
  const token = localStorage.getItem('authToken');
  const user = localStorage.getItem('user');
  if (token && user) {
    authToken = token;
    try { currentUser = JSON.parse(user); } catch (e) { currentUser = null; }
  }
}

function attachFormHandlers() {
  const lf = safeGet('loginForm');
  if (lf) lf.addEventListener('submit', e => { e.preventDefault(); login(); });

  const rf = safeGet('registerForm');
  if (rf) rf.addEventListener('submit', e => { e.preventDefault(); register(); });

  const addF = safeGet('addDeviceForm');
  if (addF) addF.addEventListener('submit', e => { e.preventDefault(); addDevice(); });

  const periodSelect = safeGet('periodSelect');
  if (periodSelect) periodSelect.addEventListener('change', () => loadPowerSummary());
}

// --------------------- UI helpers ---------------------
function showLogin() {
  safeGet('loginSection') && safeGet('loginSection').classList.add('active');
  safeGet('dashboardSection') && safeGet('dashboardSection').classList.remove('active');
}

// Add tab switching functionality
function showTab(tabName) {
  const loginForm = safeGet('login');
  const registerForm = safeGet('register');
  const loginBtn = document.querySelector('.tab-btn[onclick="showTab(\'login\')"]');
  const registerBtn = document.querySelector('.tab-btn[onclick="showTab(\'register\')"]');

  if (tabName === 'login') {
    loginForm.classList.add('active');
    registerForm.classList.remove('active');
    loginBtn.classList.add('active');
    registerBtn.classList.remove('active');
  } else {
    registerForm.classList.add('active');
    loginForm.classList.remove('active');
    registerBtn.classList.add('active');
    loginBtn.classList.remove('active');
  }
}

function showDashboard() {
  safeGet('loginSection') && safeGet('loginSection').classList.remove('active');
  safeGet('dashboardSection') && safeGet('dashboardSection').classList.add('active');
  if (safeGet('userName') && currentUser) safeGet('userName').textContent = currentUser.name || 'User';
}

// exposed for HTML buttons
function showAddDeviceModal() {
  const m = safeGet('addDeviceModal'); if (m) m.style.display = 'block';
}

function closeModal() {
  document.getElementById('deviceModal').style.display = 'none';
  document.getElementById('addDeviceModal').style.display = 'none';
  // stop device-specific polling when modal closed
  stopRelayPolling();
  currentDevice = null;
  // Resume home screen polling
  loadDevices(); // This will restart home screen polling
}

// close modal on outside click (index.html already has similar but keep safe)
window.addEventListener('click', (event) => {
  const modal = safeGet('deviceModal');
  if (modal && event.target === modal) closeModal();
});

// --------------------- Auth actions ---------------------
async function login() {
  const phone = safeGet('loginPhone')?.value || '';
  const password = safeGet('loginPassword')?.value || '';
  try {
    const res = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, password })
    });
    const data = await res.json();
    if (res.ok) {
      authToken = data.token;
      currentUser = data.user;
      localStorage.setItem('authToken', authToken);
      localStorage.setItem('user', JSON.stringify(currentUser));
      showDashboard();
      await loadDevices();
    } else {
      showAlert(data.error || 'Login failed');
    }
  } catch (err) {
    showAlert('Login error: ' + err.message);
  }
}

async function register() {
  const name = safeGet('registerName')?.value || '';
  const phone = safeGet('registerPhone')?.value || '';
  const password = safeGet('registerPassword')?.value || '';
  try {
    const res = await fetch(`${API_BASE_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone, password })
    });
    const data = await res.json();
    if (res.ok) {
      showAlert('Registration successful, please login.');
      showLogin();
    } else {
      showAlert(data.error || 'Registration failed');
    }
  } catch (err) {
    showAlert('Registration error: ' + err.message);
  }
}

function logout() {
  localStorage.removeItem('authToken');
  localStorage.removeItem('user');
  authToken = null;
  currentUser = null;
  showLogin();
}

// --------------------- Devices ---------------------
let deviceStates = new Map(); // Store device states
let homePollInterval = null; // For polling in home screen

async function loadDevices() {
  if (!authToken) return;
  try {
    const res = await fetch(`${API_BASE_URL}/devices`, { headers: { 'Authorization': `Bearer ${authToken}` } });
    const data = await res.json();
    if (res.ok) {
      const devices = data.devices || [];
      displayDevices(devices);
      // Start polling device states in home screen
      startHomeScreenPolling(devices);
    } else {
      displayDevices([]);
      stopHomeScreenPolling();
    }
  } catch (err) {
    console.error('loadDevices err', err);
    displayDevices([]);
    stopHomeScreenPolling();
  }
}

function startHomeScreenPolling(devices) {
  stopHomeScreenPolling(); // Clear any existing interval
  if (!devices.length) return;

  const pollDeviceStates = async () => {
    for (const device of devices) {
      try {
        const res = await fetch(`${API_BASE_URL}/devices/${device.deviceId}/status`, {
          headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (res.ok) {
          const data = await res.json();
          // Extract relay states from different possible sources
          const relayStates = data.relays || data.state?.relays || data.rawState?.relays || {};
          
          // Get existing state or initialize new one
          let existingState = deviceStates.get(device.deviceId) || {
            relays: { relay1: false, relay2: false, relay3: false, relay4: false }
          };
          
          // Update relay states preserving other data
          existingState = {
            ...existingState,
            relays: {
              ...existingState.relays,
              ...Object.keys(relayStates).reduce((acc, key) => {
                // Handle both boolean and object relay states
                const relayState = relayStates[key];
                acc[key] = typeof relayState === 'object' ? 
                  relayState.state || relayState.isOn || false :
                  !!relayState;
                return acc;
              }, {})
            }
          };
          
          // Store updated state
          deviceStates.set(device.deviceId, existingState);
          updateDeviceCardState(device.deviceId, existingState);
        }
      } catch (err) {
        console.error(`Error polling device ${device.deviceId}:`, err);
      }
    }
  };

  // Initial poll
  pollDeviceStates();
  // Set up interval
  homePollInterval = setInterval(pollDeviceStates, 5000); // Poll every 5 seconds
}

function stopHomeScreenPolling() {
  if (homePollInterval) {
    clearInterval(homePollInterval);
    homePollInterval = null;
  }
}

function updateDeviceCardState(deviceId, state) {
  // Update device card in home screen
  const deviceCard = document.querySelector(`[data-device-id="${deviceId}"]`);
  if (deviceCard) {
    const relays = state.relays || {};
    for (let i = 1; i <= 4; i++) {
      const relayKey = `relay${i}`;
      const relayState = relays[relayKey];
      
      // Update indicator in device card
      const relayIndicator = deviceCard.querySelector(`[data-relay="${i}"]`);
      if (relayIndicator) {
        const isActive = typeof relayState === 'object' ? 
          relayState.state || relayState.isOn || false :
          !!relayState;
        relayIndicator.classList.toggle('active', isActive);
      }
    }
  }

  // Update control modal if it's open and showing this device
  if (currentDevice === deviceId) {
    const relays = state.relays || {};
    for (let i = 1; i <= 4; i++) {
      const relayKey = `relay${i}`;
      const checkbox = document.getElementById(relayKey);
      if (checkbox) {
        const relayState = relays[relayKey];
        const isActive = typeof relayState === 'object' ? 
          relayState.state || relayState.isOn || false :
          !!relayState;
        checkbox.checked = isActive;
      }
    }
  }
}

function displayDevices(devices) {
    const container = safeGet('devicesList');
    if (!container) return;
    if (!devices || devices.length === 0) {
        container.innerHTML = `<div class="no-devices"><p>No devices found. Add your first device to get started!</p></div>`;
        return;
    }
    container.innerHTML = devices.map(d => {
        const deviceState = deviceStates.get(d.deviceId) || {};
        const relays = deviceState.relays || deviceState.state?.relays || deviceState.powerInfo || {};
        
        const relayIndicators = Array.from({length: 4}, (_, i) => {
            const relayNum = i + 1;
            const relayState = relays[`relay${relayNum}`];
            return `
                <div class="relay-indicator ${relayState?.state || relayState?.isOn ? 'active' : ''}" 
                     data-relay="${relayNum}">
                    R${relayNum}
                </div>
            `;
        }).join('');

        return `
            <div class="device-card" onclick="openDeviceControl('${d.deviceId}')">
                <div class="device-actions">
                    <button class="delete-device-btn" onclick="deleteDevice('${d.deviceId}', event)">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <h3>${d.name}</h3>
                <div class="device-status">
                    <span class="status-indicator ${d.status === 'online' ? '' : 'offline'}"></span>
                    <span>${d.status || 'offline'}</span>
                </div>
                <p>ID: ${d.deviceId}</p>
                <div class="relay-indicators">
                    ${relayIndicators}
                </div>
            </div>
        `;
    }).join('');
}

async function addDevice() {
  if (!authToken) { showAlert('Not authenticated'); return; }
  const name = safeGet('deviceName')?.value || '';
  const deviceId = safeGet('deviceId')?.value || '';
  const ssid = safeGet('deviceSSID')?.value || '';
  const password = safeGet('devicePassword')?.value || '';
  if (!name || !deviceId) { showAlert('Device name and ID required'); return; }
  try {
    const res = await fetch(`${API_BASE_URL}/devices/add`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
      body: JSON.stringify({ name, deviceId, ssid, password })
    });
    const data = await res.json();
    if (res.ok) {
      closeModal();
      safeGet('deviceName') && (safeGet('deviceName').value = '');
      safeGet('deviceId') && (safeGet('deviceId').value = '');
      await loadDevices();
      showAlert('Device added');
    } else showAlert(data.error || 'Failed to add device');
  } catch (err) { showAlert('Add device error: ' + err.message); }
}

async function deleteDevice(deviceId, event) {
  event && event.stopPropagation();
  if (!confirm('Delete device and schedules?')) return;
  try {
    const res = await fetch(`${API_BASE_URL}/devices/${deviceId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    const data = await res.json();
    if (res.ok) { showAlert('Deleted'); await loadDevices(); }
    else showAlert(data.error || 'Delete failed');
  } catch (err) { showAlert('Delete error: ' + err.message); }
}

// --------------------- Device Control & Polling ---------------------
async function openDeviceControl(deviceId) {
  currentDevice = deviceId;
  document.getElementById('modalTitle').textContent = `Control ${deviceId}`;
  document.getElementById('deviceModal').style.display = 'block';
  
  // Update AP name based on device ID
  const apNameElement = document.getElementById('apName');
  if (apNameElement) {
    apNameElement.textContent = `ESP32_Device_${deviceId}`;
  }
  
  loadDeviceState();
  loadSchedules();
  loadPowerSummary();
  loadCurrentRate();
  loadPowerConfiguration();
  
  // start realtime per-relay updates
  startRelayPolling();

  document.getElementById('scheduleTime').value = '';
  document.getElementById('scheduleDays').selectedIndex = -1;
  document.getElementById('timerDuration').value = '';
}

// Wi-Fi Setup Functions
function startWifiSetup() {
  if (!IS_ESP_MODE) {
    showAlert(
      'Wi-Fi setup works only when connected to the ESP device.\n\n' +
      'Please connect to ESP WiFi and open 192.168.4.1'
    );
    return;
  }

  const dialog = document.getElementById('wifiSetupDialog');
  const step1 = document.getElementById('step1');
  const step2 = document.getElementById('step2');

  dialog.style.display = 'block';
  step1.style.display = 'block';
  step2.style.display = 'none';
}

function confirmWifiConnection() {
  if (!IS_ESP_MODE) return;

  const step1 = document.getElementById('step1');
  const step2 = document.getElementById('step2');
  const setupFrame = document.getElementById('setupFrame');

  setupFrame.src = 'http://192.168.4.1';

  step1.style.display = 'none';
  step2.style.display = 'block';
}

function finishWifiSetup() {
  const dialog = document.getElementById('wifiSetupDialog');
  dialog.style.display = 'none';

  showAlert('Wi-Fi setup completed. Device will connect shortly.');

  setTimeout(() => {
    loadDeviceState();
  }, 5000);
}


async function loadDeviceState() {
  if (!currentDevice || !authToken) return;
  try {
    const res = await fetch(`${API_BASE_URL}/devices/${currentDevice}/status`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (!res.ok) return;
    const data = await res.json();
    // support multiple payload shapes
    const relays = data.relays || data.state?.relays || data.powerInfo || data.state?.powerInfo || {};
    for (let i = 1; i <= 4; i++) {
      const el = safeGet(`relay${i}`);
      const val = relays[`relay${i}`];
      if (el) {
        // If stored as object: { isActive: true } or boolean
        if (typeof val === 'object' && val !== null) el.checked = !!(val.isActive || val.isOn || val.state || false);
        else el.checked = !!val;
      }
    }
  } catch (err) { console.error('loadDeviceState error', err); }
}

function startRelayPolling() {
    stopRelayPolling();
    if (!currentDevice || !authToken) return;
    // immediate fetch then interval
    pollRelayStatus();
    relayPollIntervalId = setInterval(pollRelayStatus, RELAY_POLL_INTERVAL);
}

function stopRelayPolling() {
    if (relayPollIntervalId) {
        clearInterval(relayPollIntervalId);
        relayPollIntervalId = null;
    }
}

async function pollRelayStatus() {
    if (!currentDevice || !authToken) return;
    try {
        const response = await fetch(`${API_BASE_URL}/devices/${currentDevice}/status`, {
            headers: { 'Authorization': `Bearer ${authToken}` }
        });
        if (!response.ok) return;
        const data = await response.json();
        // expected shape: data.powerInfo.relay1 {...}
        const powerInfo = data.powerInfo || {};
        for (let i = 1; i <= 4; i++) {
            const rKey = `relay${i}`;
            const info = powerInfo[rKey] || {};
            const powerRating = (typeof info.powerRating === 'number') ? info.powerRating : 0;
            const energy = (typeof info.energyConsumed === 'number') ? info.energyConsumed : (typeof info.energyWh === 'number' ? info.energyWh : 0);
            const cumulative = (typeof info.cumulativeEnergy === 'number') ? info.cumulativeEnergy : 0;
            const price = (typeof info.pricePerKWh === 'number') ? info.pricePerKWh : (typeof info.price === 'number' ? info.price : (currentElectricityRate || 0));
            const cost = cumulative * (price / 1000.0); // Wh -> kWh * price

            // Update DOM (guard exists)
            const powerEl = document.getElementById(`relay${i}_power`);
            const energyEl = document.getElementById(`relay${i}_energy`);
            const costEl = document.getElementById(`relay${i}_cost`);
            if (powerEl) powerEl.textContent = `${powerRating.toFixed(2)} W`;
            if (energyEl) energyEl.textContent = `${energy.toFixed(2)} Wh`;
            if (costEl) costEl.textContent = formatCurrency(cost, currentCurrency || 'INR');
        }
    } catch (err) {
        console.error('Relay poll error:', err);
    }
}

// --------------------- Relay control ---------------------
async function toggleRelay(relayNumber) {
  if (!currentDevice) return;
  const checkbox = safeGet(`relay${relayNumber}`);
  if (!checkbox) return;
  const isOn = checkbox.checked;
  
  try {
    const res = await fetch(`${API_BASE_URL}/devices/${currentDevice}/control`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
      body: JSON.stringify({ relay: `relay${relayNumber}`, state: isOn })
    });
    const data = await res.json();
    if (res.ok) {
      // Get current device state or initialize new one
      const currentState = deviceStates.get(currentDevice) || {
        relays: { relay1: false, relay2: false, relay3: false, relay4: false }
      };
      
      // Update the specific relay state
      const updatedState = {
        ...currentState,
        relays: {
          ...currentState.relays,
          [`relay${relayNumber}`]: isOn
        }
      };
      
      // Store updated state
      deviceStates.set(currentDevice, updatedState);
      
      // Update UI everywhere this device is shown
      updateDeviceCardState(currentDevice, updatedState);
    } else {
      showAlert(data.error || 'Failed to control relay');
      // revert checkbox
      checkbox.checked = !isOn;
    }
  } catch (err) {
    showAlert('Control error: ' + err.message);
    checkbox.checked = !isOn;
  }
}

// --------------------- Power configuration & rate ---------------------
async function loadPowerConfiguration() {
  if (!currentDevice || !authToken) return;
  try {
    const res = await fetch(`${API_BASE_URL}/devices/${currentDevice}/status`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (!res.ok) return;
    const data = await res.json();
    const powerInfo = data.powerInfo || data.state?.powerInfo || {};
    for (let i = 1; i <= 4; i++) {
      const input = safeGet(`powerRating${i}`);
      if (input && powerInfo[`relay${i}`]) input.value = powerInfo[`relay${i}`].powerRating || '';
    }
  } catch (err) { console.error('loadPowerConfiguration error', err); }
}

async function configurePowerRatings() {
  if (!currentDevice || !authToken) { showAlert('Select a device'); return; }
  const powerConfig = [];
  for (let i = 1; i <= 4; i++) {
    const input = safeGet(`powerRating${i}`);
    if (!input) continue;
    const v = parseFloat(input.value);
    if (isFinite(v) && v >= 0) powerConfig.push({ relay: `relay${i}`, powerRating: v });
  }
  if (powerConfig.length === 0) { showAlert('Enter at least one power rating'); return; }
  try {
    const res = await fetch(`${API_BASE_URL}/power/configure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
      body: JSON.stringify({ deviceId: currentDevice, powerConfig })
    });
    const data = await res.json();
    if (res.ok) {
      showAlert('Power ratings sent');
      // refresh local view
      await loadPowerConfiguration();
    } else showAlert(data.error || 'Failed to send ratings');
  } catch (err) { showAlert('Configure error: ' + err.message); }
}

async function loadCurrentRate() {
  if (!authToken) return;
  try {
    const res = await fetch(`${API_BASE_URL}/power/rate/current`, { headers: { 'Authorization': `Bearer ${authToken}` } });
    const data = await res.json();
    if (res.ok && data.rate) {
      currentElectricityRate = data.rate.ratePerUnit || currentElectricityRate;
      currentCurrency = data.rate.currency || currentCurrency;
    }
    updateRateDisplay();
  } catch (err) {
    console.error('loadCurrentRate err', err);
    updateRateDisplay();
  }
}

function updateRateDisplay() {
  const cur = safeGet('currentRateValue');
  const rateInput = safeGet('ratePerUnit');
  const disp = safeGet('currentRateDisplay');
  if (cur) cur.textContent = Number(currentElectricityRate).toFixed(2);
  if (rateInput) rateInput.value = Number(currentElectricityRate).toFixed(2);
  if (disp) disp.innerHTML = `Current rate: ₹<span id="currentRateValue">${Number(currentElectricityRate).toFixed(2)}</span>/${currentCurrency}/kWh`;
}

async function updateElectricityRate() {
  const val = parseFloat(safeGet('ratePerUnit')?.value || 0);
  if (!isFinite(val) || val <= 0) { showAlert('Enter valid rate'); return; }
  try {
    const res = await fetch(`${API_BASE_URL}/power/rate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
      body: JSON.stringify({ ratePerUnit: val, currency: currentCurrency || 'INR' })
    });
    const data = await res.json();
    if (res.ok) {
      currentElectricityRate = val;
      updateRateDisplay();
      showAlert('Rate updated');
    } else showAlert(data.error || 'Failed to update rate');
  } catch (err) { showAlert('Rate update error: ' + err.message); }
}

// --------------------- Power summary ---------------------
async function loadPowerSummary() {
  if (!currentDevice || !authToken) return;
  try {
    const period = safeGet('periodSelect')?.value || 'daily';
    const res = await fetch(`${API_BASE_URL}/power/summary?period=${period}&deviceId=${currentDevice}`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (!res.ok) return;
    const data = await res.json();
    if (data.success) {
      currentCurrency = data.overall?.currency || currentCurrency;
      displayPowerSummary(data);
      displayDeviceBreakdown(data.summary || [], currentCurrency);
    }
  } catch (err) { console.error('loadPowerSummary err', err); }
}

function displayPowerSummary(data) {
  const overall = data.overall || {};
  safeGet('totalEnergy') && (safeGet('totalEnergy').textContent = (overall.totalEnergyWh || 0).toFixed(2));
  safeGet('energyKWh') && (safeGet('energyKWh').textContent = (overall.totalEnergyKWh || 0).toFixed(2));
  safeGet('totalUnits') && (safeGet('totalUnits').textContent = (overall.totalUnits || 0).toFixed(2));
  safeGet('totalCost') && (safeGet('totalCost').textContent = overall.totalCostFormatted || formatCurrency(overall.totalCost || 0, currentCurrency));
}

function displayDeviceBreakdown(summary = [], currency = 'INR') {
  const container = safeGet('deviceBreakdown');
  if (!container) return;
  if (!summary || summary.length === 0) { container.innerHTML = '<p>No power data</p>'; return; }
  container.innerHTML = summary.map(device => {
    const relays = device.relays ? Object.values(device.relays) : [];
    const relHtml = relays.map(r => `
      <div class="breakdown-item relay-item">
        <div class="breakdown-info"><div class="device-name">↳ ${r.relay}</div><div class="device-stats">${(r.energyKWh||0).toFixed(2)} kWh</div></div>
        <div class="breakdown-stats"><div class="cost-value">${r.costFormatted || formatCurrency(r.cost||0, currency)}</div></div>
      </div>`).join('');
    return `<div class="breakdown-item"><div class="breakdown-info"><div class="device-name">${device.deviceId}</div></div><div class="breakdown-stats">${device.totalCostFormatted||formatCurrency(device.totalCost||0,currency)}</div></div>${relHtml}`;
  }).join('');
}

// --------------------- Schedules (basic proxy) ---------------------
async function loadSchedules() {
  if (!currentDevice || !authToken) return;
  try {
    const res = await fetch(`${API_BASE_URL}/schedules/device/${currentDevice}`, { headers: { 'Authorization': `Bearer ${authToken}` }});
    if (!res.ok) return;
    const data = await res.json();
    if (data.schedules && typeof displaySchedules === 'function') displaySchedules(data.schedules);
  } catch (err) { console.error('loadSchedules err', err); }
}

// Master toggle functionality
async function toggleAllRelays(deviceId, state, event) {
  event.stopPropagation(); // Prevent opening the device control modal
  
  try {
    // Update all relays simultaneously
    const promises = [];
    for (let i = 1; i <= 4; i++) {
      promises.push(fetch(`${API_BASE_URL}/devices/${deviceId}/control`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({
          relay: `relay${i}`,
          state: state
        })
      }));
    }

    // Wait for all relay updates to complete
    const results = await Promise.all(promises);
    const allSuccess = results.every(res => res.ok);

    if (allSuccess) {
      // Update device state in memory
      const currentState = deviceStates.get(deviceId) || {};
      const relays = currentState.relays || {};
      for (let i = 1; i <= 4; i++) {
        relays[`relay${i}`] = { ...relays[`relay${i}`], state };
      }
      deviceStates.set(deviceId, { ...currentState, relays });
      
      // Update UI
      updateDeviceCardState(deviceId, { relays });
    } else {
      showAlert('Failed to control some relays');
      // Refresh device state to show actual states
      loadDevices();
    }
  } catch (err) {
    showAlert('Error controlling relays: ' + err.message);
    // Refresh device state to show actual states
    loadDevices();
  }
}

// --------------------- Exports for inline HTML ---------------------
// Some functions are used directly by buttons in index.html; expose them globally
window.showAddDeviceModal = showAddDeviceModal;
window.openDeviceControl = openDeviceControl;
window.closeModal = closeModal;
window.toggleAllRelays = toggleAllRelays; // Export the new function
window.toggleRelay = toggleRelay;
window.addSchedule = window.addSchedule || (async () => { showAlert('Add schedule not implemented in this script'); });
window.setTimer = window.setTimer || (async () => { showAlert('Set timer not implemented here'); });
window.configurePowerRatings = configurePowerRatings;
window.updateElectricityRate = updateElectricityRate;
window.deleteDevice = deleteDevice;
window.startWifiSetup = startWifiSetup;
window.confirmWifiConnection = confirmWifiConnection;
window.finishWifiSetup = finishWifiSetup;