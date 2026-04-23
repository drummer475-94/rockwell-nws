// --- Location (default Rockwell, NC; overridden by geolocation) ---
let LAT = 35.551;   // Rockwell, NC approx
let LON = -80.407;

/**
 * Attempts to get the user's current location using the browser's geolocation API.
 * If successful, it updates the global LAT and LON variables.
 * If it fails or the API is unavailable, it does nothing and the default location is used.
 * @returns {Promise<void>} A promise that resolves when the location has been determined.
 */
async function determineLocation() {
  if (!('geolocation' in navigator)) return;
  try {
    const pos = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject));
    LAT = pos.coords.latitude;
    LON = pos.coords.longitude;
  } catch (err) {
    console.warn('Geolocation failed', err);
  }
}

let map, marker, radarLayer;
let currentLayerType = 'radar'; // radar | satellite | clouds | temp

const VALID_LAYER_TYPES = ['radar', 'satellite', 'clouds', 'temp'];
const LAYER_ALIASES = {
  radar: 'radar',
  precip: 'radar',
  precipitation: 'radar',
  rain: 'radar',
  satellite: 'satellite',
  visible: 'satellite',
  vis: 'satellite',
  clouds: 'clouds',
  cloud: 'clouds',
  ir: 'clouds',
  infrared: 'clouds',
  temp: 'temp',
  temperature: 'temp'
};
const LAYER_DISPLAY_NAMES = {
  radar: 'Precip',
  satellite: 'Satellite',
  clouds: 'Clouds',
  temp: 'Temperature'
};

function normalizeLayerType(layerType) {
  if (!layerType) return 'radar';
  const key = String(layerType).toLowerCase();
  if (Object.prototype.hasOwnProperty.call(LAYER_ALIASES, key)) {
    return LAYER_ALIASES[key];
  }
  return VALID_LAYER_TYPES.includes(key) ? key : 'radar';
}

function getLayerDisplayName(layerType) {
  const normalized = normalizeLayerType(layerType);
  return LAYER_DISPLAY_NAMES[normalized] || (normalized.charAt(0).toUpperCase() + normalized.slice(1));
}

/**
 * Initializes the Leaflet map, adds a tile layer from OpenStreetMap,
 * and sets up the initial static radar layer and location marker.
 */
function initMap() {
  map = L.map('radar', { zoomControl: true, attributionControl: true }).setView([LAT, LON], 9);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: 'Map data © OpenStreetMap contributors'
  }).addTo(map);

  // Static fallback radar (NEXRAD via Iowa State Mesonet)
  radarLayer = L.tileLayer(
    'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/ridge::USCOMP-N0Q-0/{z}/{x}/{y}.png',
    { opacity: 0.6, zIndex: 500, attribution: 'Radar © Iowa State Mesonet / NWS NEXRAD' }
  ).addTo(map);

  marker = L.circleMarker([LAT, LON], {
    radius: 6,
    color: '#0ea5e9',
    fillColor: '#38bdf8',
    fillOpacity: 0.95,
    weight: 2
  }).addTo(map).bindPopup('Loading location…');
}

/**
 * Gets the static layer URL based on layer type
 */
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

/**
 * Gets attribution text for the current layer
 */
function getLayerAttribution(layerType) {
  const normalized = normalizeLayerType(layerType);
  const attrs = {
    radar: 'Animated: RainViewer - Static: NEXRAD (Iowa State Mesonet)',
    satellite: 'Animated: RainViewer Satellite - Static: GOES Visible (Iowa State Mesonet)',
    clouds: 'Animated: RainViewer Infrared - Static: GOES IR (Iowa State Mesonet)',
    temp: 'Animated: RainViewer Infrared - Static: GOES IR (Iowa State Mesonet)'
  };
  return attrs[normalized] || attrs.radar;
}

// --- RainViewer animated radar (frames + controls) ---
let rainFrames = [];
let satelliteFrames = [];
let rainLayer = null;
let frameIndex = 0;
let animTimer = null;
let isPlaying = false;
let currentMode = 'auto'; // auto | animated | static | off

// Heuristic performance cap for frames
const DEVICE_MEM = navigator.deviceMemory || 4;
const IS_MOBILE = /Mobi|Android/i.test(navigator.userAgent);
const RECOMMENDED_MAX_FRAMES = Math.min(60, IS_MOBILE ? 24 : (DEVICE_MEM >= 8 ? 48 : DEVICE_MEM >= 4 ? 36 : 24));
let MAX_FRAMES = RECOMMENDED_MAX_FRAMES;
let FRAME_INTERVAL = 450; // ms
let LAYER_OPACITY = 0.6;
let TILE_SIZE = 256;

/**
 * Constructs the URL for a RainViewer tile based on the frame path provided by the API.
 * @param {Object} frame - The frame object containing the base path.
 * @param {number} [size=TILE_SIZE] - The size of the tile (256 or 512).
 * @param {string} [layerType=currentLayerType] - The type of layer (radar, satellite, clouds, temp).
 * @returns {string} The URL for the tile.
 */
function rvFrameUrl(frame, size = TILE_SIZE, layerType = currentLayerType){
  const normalized = normalizeLayerType(layerType);
  if (!frame || !frame.path) return '';

  if (normalized === 'radar') {
    // 2 = color scheme, 1_1 = smoothing and snow mask
    return `${frame.path}/${size}/{z}/{x}/{y}/2/1_1.png`;
  }
  if (normalized === 'satellite') {
    // Visible satellite
    return `${frame.path}/${size}/{z}/{x}/{y}/0/0_0.png`;
  }
  // Infrared (clouds & temp)
  return `${frame.path}/${size}/{z}/{x}/{y}/0/0_1.png`;
}

/**
 * Ensures the RainViewer layer is created and returns it.
 */
function ensureRainLayer(){
  if (!rainLayer) {
    const frames = currentLayerType === 'radar' ? rainFrames : satelliteFrames;
    if (!frames || !frames.length) return null;
    
    const frame = frames[frameIndex];
    if (!frame || !frame.path) return null;

    const opts = { 
      opacity: LAYER_OPACITY, 
      zIndex: 550,
      tms: false,
      attribution: ''
    };
    if (TILE_SIZE === 512) {
      opts.tileSize = 512;
      opts.zoomOffset = -1;
    }
    rainLayer = L.tileLayer(rvFrameUrl(frame, TILE_SIZE, currentLayerType), opts);
  }
  return rainLayer;
}

/**
 * Sets the opacity for both the static and animated layers.
 */
function setRadarOpacity(v){
  LAYER_OPACITY = v;
  if (radarLayer) radarLayer.setOpacity(v);
  if (rainLayer) rainLayer.setOpacity(v);
}

/**
 * Changes the layer type (radar, satellite, clouds, temp)
 */
function setLayerType(layerType) {
  const wasPlaying = isPlaying;
  if (wasPlaying) pause();

  const normalized = normalizeLayerType(layerType);
  currentLayerType = normalized;

  const attrEl = document.getElementById('layerAttribution');
  if (attrEl) attrEl.textContent = getLayerAttribution(normalized);

  if (radarLayer && map.hasLayer(radarLayer)) map.removeLayer(radarLayer);
  if (rainLayer && map.hasLayer(rainLayer)) map.removeLayer(rainLayer);

  const attrText = getLayerAttribution(normalized);
  radarLayer = L.tileLayer(getStaticLayerUrl(normalized), {
    opacity: LAYER_OPACITY,
    zIndex: 500,
    attribution: attrText
  });

  const frames = normalized === 'radar' ? rainFrames : satelliteFrames;
  if (frames && frames.length > 0) {
    rainLayer = null;
    frameIndex = frames.length - 1;
    const slider = document.getElementById('frameSlider');
    if (slider) {
      slider.max = String(frames.length - 1);
      slider.value = String(frameIndex);
      slider.disabled = false;
    }
    showFrame(frameIndex);
  } else {
    const slider = document.getElementById('frameSlider');
    const label = document.getElementById('frameTime');
    if (slider) {
      slider.value = '0';
      slider.disabled = true;
    }
    if (label) label.textContent = '-';
    if (currentMode === 'animated' || currentMode === 'auto') {
      setMode('static');
      return;
    }
  }

  setMode(currentMode);
  if (wasPlaying) play();
}

/**
 * Displays a specific frame of the animated layer.
 */
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
    const opts = { 
      opacity: LAYER_OPACITY, 
      zIndex: 550,
      tms: false,
      attribution: ''
    };
    if (TILE_SIZE === 512) {
      opts.tileSize = 512;
      opts.zoomOffset = -1;
    }
    rainLayer = L.tileLayer(tileUrl, opts);
    if (currentMode === 'animated' || currentMode === 'auto') rainLayer.addTo(map);
  }
  
  const slider = document.getElementById('frameSlider');
  const label = document.getElementById('frameTime');
  if (slider) slider.value = String(frameIndex);
  if (label) {
    label.textContent = frame.time ? new Date(frame.time * 1000).toLocaleString() : 'Time unavailable';
  }
}

/**
 * Starts the layer animation.
 */
function play(){
  const frames = currentLayerType === 'radar' ? rainFrames : satelliteFrames;
  if (animTimer || !frames.length) return;
  isPlaying = true; updatePlayBtn();
  animTimer = setInterval(() => showFrame(frameIndex + 1), FRAME_INTERVAL);
}

/**
 * Pauses the layer animation.
 */
function pause(){
  isPlaying = false; updatePlayBtn();
  if (animTimer) { clearInterval(animTimer); animTimer = null; }
}

/**
 * Updates the text of the play/pause button based on the current animation state.
 */
function updatePlayBtn(){
  const btn = document.getElementById('playBtn');
  if (btn) btn.textContent = isPlaying ? 'Pause' : 'Play';
}

/**
 * Sets the display mode and updates the map layers accordingly.
 */
function setMode(mode){
  currentMode = mode;
  const layerName = getLayerDisplayName(currentLayerType);
  if (mode === 'off') {
    if (radarLayer && map.hasLayer(radarLayer)) map.removeLayer(radarLayer);
    if (rainLayer && map.hasLayer(rainLayer)) map.removeLayer(rainLayer);
    document.getElementById('radarDiag').textContent = 'Layer off';
    return;
  }
  if (mode === 'static') {
    if (rainLayer && map.hasLayer(rainLayer)) map.removeLayer(rainLayer);
    if (radarLayer && !map.hasLayer(radarLayer)) radarLayer.addTo(map);
    document.getElementById('radarDiag').textContent = `Static ${layerName} tiles`;
    return;
  }
  if (radarLayer && map.hasLayer(radarLayer)) map.removeLayer(radarLayer);
  if (rainLayer && !map.hasLayer(rainLayer)) rainLayer.addTo(map);
  const frames = currentLayerType === 'radar' ? rainFrames : satelliteFrames;
  document.getElementById('radarDiag').textContent = `Animated ${layerName} - ${frames.length} frames @ ${FRAME_INTERVAL}ms`;
}

/**
 * Sets the resolution of the tiles.
 */
function setResolution(size){
  const wasPlaying = isPlaying;
  if (wasPlaying) pause();
  TILE_SIZE = size;
  FRAME_INTERVAL = size === 512 ? 650 : 450;
  const speedSlider = document.getElementById('speedSlider');
  if (speedSlider) {
    speedSlider.value = String(FRAME_INTERVAL);
    document.getElementById('speedLbl').textContent = FRAME_INTERVAL + ' ms';
  }
  if (rainLayer && map.hasLayer(rainLayer)) map.removeLayer(rainLayer);
  rainLayer = null;
  showFrame(frameIndex);
  setMode(currentMode);
  if (wasPlaying) play();
}

/**
 * Fetches frame data from the RainViewer V2 API.
 */
async function initRadarAnimation(){
  try {
    const radarRes = await fetch('https://api.rainviewer.com/public/weather-maps.json');
    if (!radarRes.ok) {
      console.error('RainViewer API returned non-OK', radarRes.status);
      setMode('static');
      return;
    }
    
    const data = await radarRes.json();
    const host = data.host; 
    
    // Parse Radar Frames
    if (data.radar) {
      const past = Array.isArray(data.radar.past) ? data.radar.past : [];
      const nowc = Array.isArray(data.radar.nowcast) ? data.radar.nowcast : [];
      
      rainFrames = past.concat(nowc).map(f => ({
        time: f.time,
        path: host + f.path
      }));
      
      rainFrames.sort((a, b) => a.time - b.time);
      rainFrames = rainFrames.slice(-MAX_FRAMES);
      console.log(`Loaded ${rainFrames.length} radar frames`);
    }

    // Parse Satellite Frames
    if (data.satellite && data.satellite.infrared) {
      satelliteFrames = data.satellite.infrared.map(f => ({
        time: f.time,
        path: host + f.path
      }));
      
      satelliteFrames.sort((a, b) => a.time - b.time);
      satelliteFrames = satelliteFrames.slice(-MAX_FRAMES);
      console.log(`Loaded ${satelliteFrames.length} satellite frames`);
    } else {
      satelliteFrames = [];
    }

    const slider = document.getElementById('frameSlider');
    const frames = currentLayerType === 'radar' ? rainFrames : satelliteFrames;
    const controls = document.getElementById('radarControls');
    const diagEl = document.getElementById('radarDiag');
    const hasFrames = Array.isArray(frames) && frames.length > 0;

    if (hasFrames) {
      if (slider) {
        slider.max = String(frames.length - 1);
        slider.disabled = false;
      }
      showFrame(frames.length - 1);
      setMode(currentMode);
      if (typeof radarLayer !== 'undefined' && map.hasLayer(radarLayer) && (currentMode === 'animated' || currentMode === 'auto')) {
        map.removeLayer(radarLayer);
      }
      if (diagEl) diagEl.textContent = `Radar frames: ${rainFrames.length} | Satellite frames: ${satelliteFrames.length}`;
      if (controls) controls.style.opacity = '1';
    } else {
      if (controls) controls.style.opacity = '0.6';
      if (slider) {
        slider.value = '0';
        slider.disabled = true;
      }
      if (diagEl) diagEl.textContent = `RainViewer frames unavailable for ${getLayerDisplayName(currentLayerType)}; showing static layer.`;
      setMode('static');
    }
  } catch (e) {
    console.error('RainViewer init failed', e);
    const diag = document.getElementById('radarDiag');
    if (diag) diag.textContent = `RainViewer init failed: ${e.message}`;
    setMode('static');
  }
}

// --- UI wire-up for layer controls ---
document.getElementById('layerSelect')?.addEventListener('change', (e) => {
  setLayerType(e.target.value);
});

document.getElementById('playBtn')?.addEventListener('click', () => {
  if (isPlaying) pause(); else play();
});

document.getElementById('frameSlider')?.addEventListener('input', (e) => {
  pause();
  const v = parseInt(e.target.value, 10) || 0;
  showFrame(v);
});

document.getElementById('maxFrames')?.addEventListener('input', (e) => {
  const v = Math.max(6, Math.min(60, parseInt(e.target.value, 10) || RECOMMENDED_MAX_FRAMES));
  MAX_FRAMES = v;
  const lbl = document.getElementById('maxFramesLbl');
  if(lbl) lbl.textContent = String(v);
});

document.getElementById('maxFrames')?.addEventListener('change', () => {
  pause();
  initRadarAnimation();
});

document.getElementById('opacSlider')?.addEventListener('input', (e) => {
  const v = parseFloat(e.target.value) || 0.6;
  setRadarOpacity(v);
});

document.getElementById('speedSlider')?.addEventListener('input', (e) => {
  FRAME_INTERVAL = parseInt(e.target.value, 10) || 450;
  const speedLbl = document.getElementById('speedLbl');
  if (speedLbl) speedLbl.textContent = FRAME_INTERVAL + ' ms';
  if (isPlaying) {
    pause();
    play();
  }
});

document.getElementById('modeSelect')?.addEventListener('change', (e) => {
  setMode(e.target.value);
});

document.getElementById('resSelect')?.addEventListener('change', (e) => {
  setResolution(parseInt(e.target.value, 10) || 256);
});

// --- Optional: Global initialization if missing from your HTML file ---
// (Uncomment this block if your page isn't calling initMap() and initRadarAnimation() automatically)
/*
document.addEventListener('DOMContentLoaded', async () => {
  await determineLocation();
  initMap();
  initRadarAnimation();
});
*/
