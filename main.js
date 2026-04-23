// --- Location (default Rockwell, NC; overridden by geolocation) ---
let LAT = 35.551;   
let LON = -80.407;

async function determineLocation() {
  if (!('geolocation' in navigator)) return;
  try {
    const pos = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject));
    LAT = pos.coords.latitude;
    LON = pos.coords.longitude;
    document.getElementById('location').textContent = "Current Location";
  } catch (err) {
    console.warn('Geolocation failed, using default', err);
    document.getElementById('location').textContent = "Rockwell, NC";
  }
}

// ==========================================
// MAP & RADAR LOGIC
// ==========================================
let map, marker, radarLayer;
let currentLayerType = 'radar';

const VALID_LAYER_TYPES = ['radar', 'satellite', 'clouds', 'temp'];
const LAYER_ALIASES = { radar: 'radar', precip: 'radar', precipitation: 'radar', rain: 'radar', satellite: 'satellite', visible: 'satellite', vis: 'satellite', clouds: 'clouds', cloud: 'clouds', ir: 'clouds', infrared: 'clouds', temp: 'temp', temperature: 'temp' };
const LAYER_DISPLAY_NAMES = { radar: 'Precip', satellite: 'Satellite', clouds: 'Clouds', temp: 'Temperature' };

function normalizeLayerType(layerType) {
  if (!layerType) return 'radar';
  const key = String(layerType).toLowerCase();
  if (Object.prototype.hasOwnProperty.call(LAYER_ALIASES, key)) return LAYER_ALIASES[key];
  return VALID_LAYER_TYPES.includes(key) ? key : 'radar';
}

function getLayerDisplayName(layerType) {
  const normalized = normalizeLayerType(layerType);
  return LAYER_DISPLAY_NAMES[normalized] || (normalized.charAt(0).toUpperCase() + normalized.slice(1));
}

function initMap() {
  map = L.map('radar', { zoomControl: true, attributionControl: true }).setView([LAT, LON], 9);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: 'Map data © OpenStreetMap'
  }).addTo(map);

  radarLayer = L.tileLayer(
    'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/ridge::USCOMP-N0Q-0/{z}/{x}/{y}.png',
    { opacity: 0.6, zIndex: 500, attribution: 'Radar © Iowa State Mesonet' }
  ).addTo(map);

  marker = L.circleMarker([LAT, LON], {
    radius: 6, color: '#0ea5e9', fillColor: '#38bdf8', fillOpacity: 0.95, weight: 2
  }).addTo(map).bindPopup('Forecast Location');
}

function getStaticLayerUrl(layerType) {
  const normalized = normalizeLayerType(layerType);
  const urls = {
    radar: 'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/ridge::USCOMP-N0Q-0/{z}/{x}/{y}.png',
    satellite: 'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/ridge::GOES-CONUS-VIS-0/{z}/{x}/{y}.png',
    clouds: 'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/ridge::GOES-CONUS-13-0/{z}/{x}/{y}.png',
    temp: 'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/ridge::GOES-CONUS-13-0/{z}/{x}/{y}.png'
  };
  return urls[normalized] || urls.radar;
}

function getLayerAttribution(layerType) {
  const normalized = normalizeLayerType(layerType);
  const attrs = {
    radar: 'Animated: RainViewer - Static: NEXRAD',
    satellite: 'Animated: RainViewer Satellite - Static: GOES Visible',
    clouds: 'Animated: RainViewer Infrared - Static: GOES IR',
    temp: 'Animated: RainViewer Infrared - Static: GOES IR'
  };
  return attrs[normalized] || attrs.radar;
}

let rainFrames = [], satelliteFrames = [], rainLayer = null;
let frameIndex = 0, animTimer = null, isPlaying = false, currentMode = 'auto';
const DEVICE_MEM = navigator.deviceMemory || 4;
const IS_MOBILE = /Mobi|Android/i.test(navigator.userAgent);
const RECOMMENDED_MAX_FRAMES = Math.min(60, IS_MOBILE ? 24 : (DEVICE_MEM >= 8 ? 48 : DEVICE_MEM >= 4 ? 36 : 24));
let MAX_FRAMES = RECOMMENDED_MAX_FRAMES;
let FRAME_INTERVAL = 450, LAYER_OPACITY = 0.6, TILE_SIZE = 256;

function rvFrameUrl(frame, size = TILE_SIZE, layerType = currentLayerType){
  const normalized = normalizeLayerType(layerType);
  if (!frame || !frame.path) return '';
  if (normalized === 'radar') return `${frame.path}/${size}/{z}/{x}/{y}/2/1_1.png`;
  if (normalized === 'satellite') return `${frame.path}/${size}/{z}/{x}/{y}/0/0_0.png`;
  return `${frame.path}/${size}/{z}/{x}/{y}/0/0_1.png`;
}

function setRadarOpacity(v){
  LAYER_OPACITY = v;
  if (radarLayer) radarLayer.setOpacity(v);
  if (rainLayer) rainLayer.setOpacity(v);
}

function setLayerType(layerType) {
  const wasPlaying = isPlaying;
  if (wasPlaying) pause();
  const normalized = normalizeLayerType(layerType);
  currentLayerType = normalized;

  const attrEl = document.getElementById('layerAttribution');
  if (attrEl) attrEl.textContent = getLayerAttribution(normalized);

  if (radarLayer && map.hasLayer(radarLayer)) map.removeLayer(radarLayer);
  if (rainLayer && map.hasLayer(rainLayer)) map.removeLayer(rainLayer);

  radarLayer = L.tileLayer(getStaticLayerUrl(normalized), { opacity: LAYER_OPACITY, zIndex: 500 }).addTo(map);

  const frames = normalized === 'radar' ? rainFrames : satelliteFrames;
  if (frames && frames.length > 0) {
    rainLayer = null;
    frameIndex = frames.length - 1;
    showFrame(frameIndex);
  } else {
    setMode('static');
  }
  if (wasPlaying) play();
}

function showFrame(i){
  const frames = currentLayerType === 'radar' ? rainFrames : satelliteFrames;
  if (!frames || frames.length === 0) return;
  
  frameIndex = (i + frames.length) % frames.length;
  const frame = frames[frameIndex];
  if (!frame || !frame.path) return;
  
  const tileUrl = rvFrameUrl(frame, TILE_SIZE, currentLayerType);
  
  if (rainLayer && map.hasLayer(rainLayer)) {
    rainLayer.setUrl(tileUrl);
  } else {
    rainLayer = L.tileLayer(tileUrl, { opacity: LAYER_OPACITY, zIndex: 550, tms: false });
    if (currentMode === 'animated' || currentMode === 'auto') rainLayer.addTo(map);
  }
  
  const slider = document.getElementById('frameSlider');
  const label = document.getElementById('frameTime');
  if (slider) slider.value = String(frameIndex);
  if (label) label.textContent = frame.time ? new Date(frame.time * 1000).toLocaleTimeString() : '-';
}

function play(){
  const frames = currentLayerType === 'radar' ? rainFrames : satelliteFrames;
  if (animTimer || !frames.length) return;
  isPlaying = true; document.getElementById('playBtn').textContent = 'Pause';
  animTimer = setInterval(() => showFrame(frameIndex + 1), FRAME_INTERVAL);
}

function pause(){
  isPlaying = false; document.getElementById('playBtn').textContent = 'Play';
  if (animTimer) { clearInterval(animTimer); animTimer = null; }
}

function setMode(mode){
  currentMode = mode;
  if (mode === 'off') {
    if (radarLayer) map.removeLayer(radarLayer);
    if (rainLayer) map.removeLayer(rainLayer);
    return;
  }
  if (mode === 'static') {
    if (rainLayer) map.removeLayer(rainLayer);
    if (radarLayer && !map.hasLayer(radarLayer)) radarLayer.addTo(map);
    return;
  }
  if (radarLayer) map.removeLayer(radarLayer);
  if (rainLayer && !map.hasLayer(rainLayer)) rainLayer.addTo(map);
}

async function initRadarAnimation(){
  try {
    const res = await fetch('https://api.rainviewer.com/public/weather-maps.json');
    const data = await res.json();
    const host = data.host; 
    
    if (data.radar) {
      const past = Array.isArray(data.radar.past) ? data.radar.past : [];
      const nowc = Array.isArray(data.radar.nowcast) ? data.radar.nowcast : [];
      rainFrames = past.concat(nowc).map(f => ({ time: f.time, path: host + f.path })).slice(-MAX_FRAMES);
    }
    
    const slider = document.getElementById('frameSlider');
    if (rainFrames.length > 0 && slider) {
      slider.max = String(rainFrames.length - 1);
      slider.disabled = false;
      showFrame(rainFrames.length - 1);
    }
  } catch (e) {
    console.error('RainViewer init failed', e);
  }
}

// ==========================================
// NWS WEATHER DATA LOGIC (NEW)
// ==========================================
async function fetchWeatherData() {
  try {
    document.getElementById('lastUpdated').textContent = "Fetching data...";
    // NWS requires a User-Agent header
    const headers = { 'User-Agent': '(github.com/drummer475-94/rockwell-nws, contact@github.com)' };
    
    // 1. Get Grid Points from Lat/Lon
    const pointRes = await fetch(`https://api.weather.gov/points/${LAT},${LON}`, { headers });
    if (!pointRes.ok) throw new Error("Failed to fetch NWS grid");
    const pointData = await pointRes.json();
    
    const forecastUrl = pointData.properties.forecast;
    const hourlyUrl = pointData.properties.forecastHourly;

    // 2. Fetch Daily and Hourly forecasts simultaneously
    const [dailyRes, hourlyRes] = await Promise.all([
      fetch(forecastUrl, { headers }),
      fetch(hourlyUrl, { headers })
    ]);

    const dailyData = await dailyRes.json();
    const hourlyData = await hourlyRes.json();

    updateWeatherUI(dailyData.properties.periods, hourlyData.properties.periods);
  } catch (err) {
    console.error('NWS Fetch Error:', err);
    document.getElementById('lastUpdated').textContent = "Error loading weather data.";
  }
}

function updateWeatherUI(daily, hourly) {
  // Update Right Now KPI Cards
  if (hourly && hourly.length > 0) {
    const current = hourly[0];
    document.getElementById('nowTemp').textContent = `${current.temperature}°${current.temperatureUnit}`;
    document.getElementById('windNow').textContent = current.windSpeed;
    document.getElementById('pop1').textContent = current.probabilityOfPrecipitation?.value ? `${current.probabilityOfPrecipitation.value}%` : '0%';
    document.getElementById('humidityNow').textContent = current.relativeHumidity?.value ? `${Math.round(current.relativeHumidity.value)}%` : '-';
    
    // Populate Hourly Scroller
    const hourlyHtml = hourly.slice(0, 12).map(h => `
      <div class="hourCard">
        <div class="top">
          <span class="muted">${new Date(h.startTime).toLocaleTimeString([], {hour: '2-digit'})}</span>
        </div>
        <div class="temp" style="margin: 8px 0;">${h.temperature}°</div>
        <div class="muted" style="font-size:11px;">${h.shortForecast}</div>
      </div>
    `).join('');
    document.getElementById('hourly').innerHTML = hourlyHtml;
    document.getElementById('hourly').classList.remove('loading');
  }

  // Update Daily Cards
  if (daily && daily.length > 0) {
    const dailyHtml = daily.slice(0, 7).map(d => `
      <div class="dayCard">
        <div class="top" style="margin-bottom: 4px;">
          <strong>${d.name}</strong>
          <span class="temp" style="font-size: 18px;">${d.temperature}°</span>
        </div>
        <div class="muted">${d.detailedForecast}</div>
      </div>
    `).join('');
    document.getElementById('daily').innerHTML = dailyHtml;
    document.getElementById('daily').classList.remove('loading');
  }

  document.getElementById('lastUpdated').textContent = `Last updated: ${new Date().toLocaleTimeString()}`;
}

// ==========================================
// EVENT LISTENERS & INIT
// ==========================================
document.getElementById('layerSelect')?.addEventListener('change', (e) => setLayerType(e.target.value));
document.getElementById('playBtn')?.addEventListener('click', () => { if (isPlaying) pause(); else play(); });
document.getElementById('frameSlider')?.addEventListener('input', (e) => { pause(); showFrame(parseInt(e.target.value, 10)); });
document.getElementById('modeSelect')?.addEventListener('change', (e) => setMode(e.target.value));
document.getElementById('opacSlider')?.addEventListener('input', (e) => setRadarOpacity(parseFloat(e.target.value)));
document.getElementById('refreshBtn')?.addEventListener('click', () => fetchWeatherData());

// Initialize App
document.addEventListener('DOMContentLoaded', async () => {
  await determineLocation();
  initMap();
  initRadarAnimation();
  fetchWeatherData();
});
