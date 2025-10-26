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
 * Constructs the URL for a RainViewer tile based on layer type.
 * Radar frames use numeric timestamps, while RainViewer satellite frames now use hashed path IDs.
 * @param {(number|string)} frameToken - Timestamp (radar) or hashed path (satellite products).
 * @param {number} [size=TILE_SIZE] - The size of the tile (256 or 512).
 * @param {string} [layerType=currentLayerType] - The type of layer (radar, satellite, clouds, temp).
 * @returns {string} The URL for the tile.
 */
function rvFrameUrl(frameToken, size = TILE_SIZE, layerType = currentLayerType){
  const normalized = normalizeLayerType(layerType);
  if (normalized === 'radar') {
    const ts = Number.isFinite(frameToken) ? frameToken : 0;
    return `https://tilecache.rainviewer.com/v2/radar/${ts}/${size}/{z}/{x}/{y}/2/1_1.png`;
  }
  const pathId = frameToken ? String(frameToken) : '0';
  if (normalized === 'satellite') {
    // RainViewer satellite - visible light (0_0 = visible)
    return `https://tilecache.rainviewer.com/v2/satellite/${pathId}/${size}/{z}/{x}/{y}/0/0_0.png`;
  }
  // clouds & temp use infrared satellite tiles
  return `https://tilecache.rainviewer.com/v2/satellite/${pathId}/${size}/{z}/{x}/{y}/0/0_1.png`;
}

function extractSatelliteFrames(source){
  const frames = [];
  const visit = (val) => {
    if (!val) return;
    if (Array.isArray(val)) {
      val.forEach(visit);
      return;
    }
    if (typeof val === 'object') {
      const path = typeof val.path === 'string' ? val.path : null;
      const time = Number(val.time);
      if (path) {
        frames.push({
          path,
          time: Number.isFinite(time) ? time : null
        });
      }
      Object.values(val).forEach(visit);
    }
  };
  visit(source);
  const seenPaths = new Set();
  const deduped = [];
  for (const frame of frames) {
    if (!frame.path || seenPaths.has(frame.path)) continue;
    seenPaths.add(frame.path);
    deduped.push(frame);
  }
  deduped.sort((a, b) => {
    const ta = Number.isFinite(a.time) ? a.time : 0;
    const tb = Number.isFinite(b.time) ? b.time : 0;
    return ta - tb;
  });
  return deduped;
}

function getFrameToken(frame, layerType){
  const normalized = normalizeLayerType(layerType);
  if (normalized === 'radar') {
    if (Number.isFinite(frame)) return frame;
    if (frame && Number.isFinite(frame.time)) return frame.time;
    return null;
  }
  if (frame && typeof frame === 'object' && typeof frame.path === 'string') {
    return frame.path;
  }
  if (typeof frame === 'string') return frame;
  return null;
}

function getFrameTimestamp(frame){
  if (Number.isFinite(frame)) return frame;
  if (frame && typeof frame === 'object') {
    const ts = Number(frame.time);
    return Number.isFinite(ts) ? ts : null;
  }
  return null;
}

/**
 * Ensures the RainViewer layer is created and returns it.
 * If the layer doesn't exist, it creates it.
 * @returns {L.TileLayer} The Leaflet tile layer for the animated layer.
 */
function ensureRainLayer(){
  if (!rainLayer) {
    const frames = currentLayerType === 'radar' ? rainFrames : satelliteFrames;
    if (!frames || !frames.length) return null;
    const token = getFrameToken(frames[frameIndex], currentLayerType);
    if (token == null) return null;
    const opts = { 
      opacity: LAYER_OPACITY, 
      zIndex: 550,
      tms: false,
      attribution: ''
    };
    // For 512px tiles, we need to adjust zoom offset
    if (TILE_SIZE === 512) {
      opts.tileSize = 512;
      opts.zoomOffset = -1;
    }
    rainLayer = L.tileLayer(rvFrameUrl(token, TILE_SIZE, currentLayerType), opts);
  }
  return rainLayer;
}

/**
 * Sets the opacity for both the static and animated layers.
 * @param {number} v - The opacity value (0.0 to 1.0).
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

  // Update attribution
  const attrEl = document.getElementById('layerAttribution');
  if (attrEl) attrEl.textContent = getLayerAttribution(normalized);
  
  // Remove existing layers
  if (radarLayer && map.hasLayer(radarLayer)) map.removeLayer(radarLayer);
  if (rainLayer && map.hasLayer(rainLayer)) map.removeLayer(rainLayer);
  
  // Create new static layer
  const attrText = getLayerAttribution(normalized);
  radarLayer = L.tileLayer(getStaticLayerUrl(normalized), {
    opacity: LAYER_OPACITY,
    zIndex: 500,
    attribution: attrText
  });
  
  // Reset frame index and recreate animated layer if frames exist
  const frames = normalized === 'radar' ? rainFrames : satelliteFrames;
  if (frames && frames.length > 0) {
    rainLayer = null;
    frameIndex = frames.length - 1; // Start at most recent frame
    const slider = document.getElementById('frameSlider');
    if (slider) {
      slider.max = String(frames.length - 1);
      slider.value = String(frameIndex);
      slider.disabled = false;
    }
    showFrame(frameIndex);
  } else {
    // If no frames available, use static mode
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
  
  // Reapply current mode
  setMode(currentMode);
  
  if (wasPlaying) play();
}

/**
 * Displays a specific frame of the animated layer.
 * @param {number} i - The index of the frame to show.
 */
function showFrame(i){
  const frames = currentLayerType === 'radar' ? rainFrames : satelliteFrames;
  if (!frames || frames.length === 0) {
    console.warn(`No frames available for ${currentLayerType}`);
    return;
  }
  frameIndex = (i + frames.length) % frames.length;
  const frame = frames[frameIndex];
  const token = getFrameToken(frame, currentLayerType);
  if (token == null) {
    console.warn(`Missing frame token for ${currentLayerType} index ${frameIndex}`);
    return;
  }
  const frameTime = getFrameTimestamp(frame);
  const tileUrl = rvFrameUrl(token, TILE_SIZE, currentLayerType);
  if (rainLayer && map.hasLayer(rainLayer)) {
    rainLayer.setUrl(tileUrl);
  } else {
    const opts = { 
      opacity: LAYER_OPACITY, 
      zIndex: 550,
      tms: false,
      attribution: ''
    };
    // For 512px tiles, we need to adjust zoom offset
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
    label.textContent = frameTime ? new Date(frameTime * 1000).toLocaleString() : 'Time unavailable';
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
 * @param {('auto'|'animated'|'static'|'off')} mode - The desired display mode.
 */
function setMode(mode){
  currentMode = mode;
  const layerName = getLayerDisplayName(currentLayerType);
  // Remove/add layers per mode
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
  // animated or auto -> prefer RainViewer frames if available
  if (radarLayer && map.hasLayer(radarLayer)) map.removeLayer(radarLayer);
  if (rainLayer && !map.hasLayer(rainLayer)) rainLayer.addTo(map);
  const frames = currentLayerType === 'radar' ? rainFrames : satelliteFrames;
  document.getElementById('radarDiag').textContent = `Animated ${layerName} - ${frames.length} frames @ ${FRAME_INTERVAL}ms`;
}

/**
 * Sets the resolution of the tiles.
 * @param {number} size - The tile size (256 for standard, 512 for HD).
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
 * Fetches frame data from the RainViewer API and initializes the animation controls.
 * @returns {Promise<void>} A promise that resolves when the animation is initialized.
 */
async function initRadarAnimation(){
  try {
    const radarRes = await fetch('https://tilecache.rainviewer.com/api/maps.json');
    if (!radarRes.ok) {
      // Try to read response text for more info
      let bodyText = '<no body>';
      try { bodyText = await radarRes.text(); } catch (e) { /* ignore */ }
      console.error('RainViewer API returned non-OK', radarRes.status, bodyText);
      const diag = document.getElementById('radarDiag');
      if (diag) diag.textContent = `RainViewer API error ${radarRes.status}: ${String(bodyText).slice(0,200)}`;
      // fall back to static tiles
      setMode('static');
      return;
    }
    let data;
    try {
      data = await radarRes.json();
    } catch (jsonErr) {
      let bodyText = '<unreadable body>';
      try { bodyText = await radarRes.text(); } catch (e) { /* ignore */ }
      console.error('RainViewer JSON parse failed', jsonErr, bodyText);
      const diag = document.getElementById('radarDiag');
      if (diag) diag.textContent = `RainViewer returned invalid JSON`;
      setMode('static');
      return;
    }
    
    // RainViewer provides both radar and satellite imagery
    // Extract radar frames
    if (data && data.radar) {
      const past = Array.isArray(data.radar.past) ? data.radar.past : [];
      const nowc = Array.isArray(data.radar.nowcast) ? data.radar.nowcast : [];
      const frames = past.concat(nowc).map(f => Number(f.time)).filter(Number.isFinite);
      frames.sort((a, b) => a - b);
      rainFrames = frames.slice(-MAX_FRAMES);
      console.log(`Loaded ${rainFrames.length} radar frames`);
    } else if (Array.isArray(data)) {
      const frames = data.map(Number).filter(Number.isFinite);
      frames.sort((a, b) => a - b);
      rainFrames = frames.slice(-MAX_FRAMES); // older API shape
      console.log(`Loaded ${rainFrames.length} radar frames (legacy API)`);
    } else {
      rainFrames = [];
      console.warn('RainViewer radar response missing expected data');
    }
    
    // Extract satellite frames (used for satellite, clouds, and temp layers)
    // RainViewer's `maps.json` can expose satellite frames under different keys
    // (e.g. infrared, visible, waterVapor) or in slightly different shapes.
    // Fall back to satellite.json if necessary.
    let satFrames = [];
    try {
      if (data && data.satellite) {
        satFrames = extractSatelliteFrames(data.satellite);
      }
      if (!satFrames.length) {
        const satelliteRes = await fetch('https://tilecache.rainviewer.com/api/satellite.json');
        if (satelliteRes.ok) {
          const satelliteData = await satelliteRes.json();
          satFrames = extractSatelliteFrames(satelliteData);
        } else {
          console.warn('RainViewer satellite API returned non-OK', satelliteRes.status);
        }
      }
    } catch (satErr) {
      console.warn('Error extracting satellite frames', satErr);
      satFrames = [];
    }
    satelliteFrames = satFrames.slice(-MAX_FRAMES);
    console.log(`Loaded ${satelliteFrames.length} satellite frames`);

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
      // Prefer animated layer by default in auto mode
      setMode(currentMode);
      // If animated is available, drop static to avoid double overlay
      if (typeof radarLayer !== 'undefined' && map.hasLayer(radarLayer) && (currentMode === 'animated' || currentMode === 'auto')) {
        map.removeLayer(radarLayer);
      }
      if (diagEl) diagEl.textContent = `Radar frames: ${rainFrames.length} | Satellite frames: ${satelliteFrames.length}`;
      if (controls) controls.style.opacity = '1';
    } else {
      // Hide certain controls if frames unavailable
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
    if (diag) diag.textContent = `RainViewer init failed: ${e && e.message ? e.message : String(e)}`;
    setMode('static');
  }
}

// UI wire-up for layer controls
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
  document.getElementById('maxFramesLbl').textContent = String(v);
});
document.getElementById('maxFrames')?.addEventListener('change', () => {
  // reinitialize with new cap
  pause();
  initRadarAnimation();
});
document.getElementById('speedSlider')?.addEventListener('input', (e) => {
  const v = Math.max(120, Math.min(800, parseInt(e.target.value, 10) || 450));
  FRAME_INTERVAL = v;
  document.getElementById('speedLbl').textContent = v + ' ms';
  if (isPlaying) { pause(); play(); }
});
document.getElementById('opacitySlider')?.addEventListener('input', (e) => {
  const v = (Math.max(20, Math.min(100, parseInt(e.target.value, 10) || 60))) / 100;
  document.getElementById('opacityLbl').textContent = v.toFixed(2);
  setRadarOpacity(v);
});
document.getElementById('resStd')?.addEventListener('click', () => setResolution(256));
document.getElementById('resHd')?.addEventListener('click', () => setResolution(512));
document.getElementById('modeAuto')?.addEventListener('click', () => setMode('auto'));
document.getElementById('modeAnim')?.addEventListener('click', () => setMode('animated'));
document.getElementById('modeStatic')?.addEventListener('click', () => setMode('static'));
document.getElementById('modeOff')?.addEventListener('click', () => setMode('off'));

// --- Helpers ---
/**
 * A shorthand for document.getElementById.
 * @param {string} id The ID of the element to get.
 * @returns {HTMLElement|null} The element with the specified ID, or null if not found.
 */
const $ = (id) => document.getElementById(id);

/**
 * Sets the textContent of an element.
 * @param {string} id The ID of the element.
 * @param {string} value The text to set.
 */
const setText = (id, value) => { const el = $(id); if (el) el.textContent = value; };

/**
 * Formats a date string into a localized time string.
 * @param {string} dStr The date string to format.
 * @param {object} [opts={}] Additional options for Intl.DateTimeFormat.
 * @returns {string} The formatted time string.
 */
const fmtTime = (dStr, opts={}) => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', ...opts }).format(new Date(dStr));

/**
 * Calculates sunrise and sunset times for a given location using a simplified
 * solar position model derived from NOAA/SunCalc algorithms. This provides a
 * reliable fallback when the remote sunrise-sunset API is unavailable.
 * @param {number} lat Latitude in decimal degrees.
 * @param {number} lon Longitude in decimal degrees.
 * @param {Date} [date=new Date()] The date to calculate sun times for.
 * @returns {{sunrise: Date, sunset: Date}|null} Calculated sun times or null if
 * the sun never rises/sets for the given latitude/date.
 */
function computeSunTimes(lat, lon, date = new Date()) {
  if (!isFinite(lat) || !isFinite(lon)) return null;

  const rad = Math.PI / 180;
  const dayMs = 86400000;
  const J1970 = 2440588;
  const J2000 = 2451545;
  const e = rad * 23.4397; // obliquity of the Earth

  const toJulian = (d) => d.valueOf() / dayMs - 0.5 + J1970;
  const fromJulian = (j) => new Date((j + 0.5 - J1970) * dayMs);
  const toDays = (d) => toJulian(d) - J2000;

  const solarMeanAnomaly = (d) => rad * (357.5291 + 0.98560028 * d);
  const eclipticLongitude = (M) => {
    const C = rad * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
    const P = rad * 102.9372; // perihelion of the Earth
    return M + C + P + Math.PI;
  };
  const solarTransit = (ds, M, L) => J2000 + ds + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
  const sunDeclination = (L) => Math.asin(Math.sin(L) * Math.sin(e));
  const hourAngle = (h, phi, dec) => Math.acos((Math.sin(h) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec)));

  const lw = -lon * rad;
  const phi = lat * rad;
  const d = toDays(date);
  const n = Math.round(d - lw / (2 * Math.PI));
  const ds = n + lw / (2 * Math.PI);
  const M = solarMeanAnomaly(ds);
  const L = eclipticLongitude(M);
  const dec = sunDeclination(L);
  const Jnoon = solarTransit(ds, M, L);
  const h0 = -0.83 * rad; // solar altitude at sunrise/sunset
  const H = hourAngle(h0, phi, dec);
  if (Number.isNaN(H)) return null;

  const Jset = solarTransit(ds + H / (2 * Math.PI), M, L);
  const Jrise = Jnoon - (Jset - Jnoon);

  return { sunrise: fromJulian(Jrise), sunset: fromJulian(Jset) };
}

/**
 * Formats a date string into a short, localized weekday string.
 * @param {string} dStr The date string to format.
 * @returns {string} The formatted day string (e.g., "Mon").
 */
const fmtDay = (dStr) => new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(new Date(dStr));

/**
 * Calculates the heat index in Fahrenheit.
 * Uses the NOAA Rothfusz regression with adjustments.
 * @param {number|null} tempF The temperature in Fahrenheit.
 * @param {number|null} rh The relative humidity (e.g., 85 for 85%).
 * @returns {number|null} The calculated heat index, rounded to the nearest integer, or null if inputs are invalid.
 */
function heatIndexF(tempF, rh) {
  const T = tempF;
  const R = rh;
  if (T == null || R == null) return null;
  if (T < 80 || R < 40) return Math.round(T);
  let HI = -42.379 + 2.04901523*T + 10.14333127*R - 0.22475541*T*R - 0.00683783*T*T - 0.05481717*R*R + 0.00122874*T*T*R + 0.00085282*T*R*R - 0.00000199*T*T*R*R;
  if (R < 13 && T >= 80 && T <= 112) HI -= ((13 - R)/4) * Math.sqrt((17 - Math.abs(T - 95))/17);
  if (R > 85 && T >= 80 && T <= 87) HI += ((R - 85)/10) * ((87 - T)/5);
  return Math.round(HI);
}

/**
 * Calculates the dew point in Fahrenheit using the Magnus formula.
 * @param {number|null} tempF The temperature in Fahrenheit.
 * @param {number|null} rh The relative humidity (e.g., 50 for 50%).
 * @returns {number|null} The calculated dew point, rounded to the nearest integer, or null if inputs are invalid.
 */
function dewPointF(tempF, rh) {
  if (tempF == null || rh == null) return null;
  if (rh <= 0 || rh > 100) return null;
  const tC = (tempF - 32) * 5/9;
  const a = 17.27, b = 237.7;
  const gamma = (a * tC) / (b + tC) + Math.log(rh / 100);
  const dpC = (b * gamma) / (a - gamma);
  return Math.round(dpC * 9/5 + 32);
}

/**
 * Parses a wind speed string (e.g., "5 to 15 mph") and returns the maximum speed in MPH.
 * @param {string|null} windStr The wind speed string from the NWS API.
 * @returns {number|null} The maximum wind speed as a number, or null if parsing fails.
 */
function parseWindMph(windStr) {
  if (!windStr) return null;
  const nums = String(windStr).match(/\d+/g);
  if (!nums || !nums.length) return null;
  return Math.max(...nums.map(n => parseInt(n, 10)));
}

/**
 * Extracts the wind gust speed in MPH from a forecast period object.
 * @param {object|null} period The forecast period object from the NWS API.
 * @returns {number|null} The wind gust in MPH, or null if not available.
 */
function gustMph(period) {
  const g = period?.windGust;
  if (typeof g === 'number') return Math.round(g);
  const mph = parseWindMph(g);
  return mph != null ? mph : null;
}

/**
 * Extracts the probability of precipitation value from a NWS API object.
 * @param {object|null} obj The object containing a `value` property (e.g., `probabilityOfPrecipitation`).
 * @returns {number|null} The precipitation probability as a number, or null if not available.
 */
function popVal(obj) {
  if (!obj) return null;
  const v = obj.value; // % or null
  return typeof v === 'number' ? v : null;
}

/**
 * Formats a wind description string from a forecast period object.
 * @param {object|null} period The forecast period object from the NWS API.
 * @returns {string} A formatted wind description (e.g., "SW 5–10 mph") or "—" if not available.
 */
function windNowText(period) {
  if (!period) return '—';
  const dir = period.windDirection || '';
  const spd = (period.windSpeed || '').replace(/ to /, '–');
  return `${dir} ${spd}`.trim() || '—';
}

// --- Fetch NWS endpoints ---
/**
 * Loads the main weather forecast data from the NWS API.
 * This includes fetching gridpoints, hourly, and daily forecasts.
 * It then updates the UI with the fetched data.
 * @returns {Promise<void>} A promise that resolves when the forecast is loaded and rendered.
 */
async function loadForecast() {
  $('lastUpdated').textContent = 'Loading…';
  $('hourly').classList.add('loading');
  $('daily').classList.add('loading');
  try {
    const pointsUrl = `https://api.weather.gov/points/${LAT},${LON}`;
    const points = await fetch(pointsUrl, { headers: { 'Accept': 'application/geo+json' } }).then(r => r.json());

    const city = points?.properties?.relativeLocation?.properties?.city;
    const state = points?.properties?.relativeLocation?.properties?.state;
    const locName = city && state ? `${city}, ${state}` : `${LAT.toFixed(2)}, ${LON.toFixed(2)}`;
    setText('location', locName);
    document.title = `${locName} - NWS Forecast`;
    const radarEl = $('radar');
    if (radarEl) radarEl.setAttribute('aria-label', `Radar map for ${locName}`);
    if (marker) marker.bindPopup(locName);

    const hourlyUrl = points?.properties?.forecastHourly;
    const dailyUrl  = points?.properties?.forecast;

    if (!hourlyUrl || !dailyUrl) {
      $('lastUpdated').textContent = 'Could not load NWS endpoints.';
      return;
    }

    const [hourly, daily] = await Promise.all([
      fetch(hourlyUrl, { headers: { 'Accept': 'application/geo+json' } }).then(r => r.json()),
      fetch(dailyUrl,  { headers: { 'Accept': 'application/geo+json' } }).then(r => r.json())
    ]);

    renderHourly(hourly?.properties?.periods || []);
    renderDaily(daily?.properties?.periods || []);

    // KPIs (now = first hourly period)
    const now = (hourly?.properties?.periods || [])[0];
    const nowTemp = now?.temperature;
    const nowRH = now?.relativeHumidity?.value;
    const nowHI = heatIndexF(nowTemp, nowRH);
    $('nowTemp').textContent = nowTemp != null ? `${Math.round(nowTemp)}°F` : '-';
    $('heatIndex').textContent = nowHI != null ? `${nowHI}°F` : '-';
    $('windNow').textContent = windNowText(now);

    // Details (top-right)
    const dp = dewPointF(nowTemp, nowRH);
    const gust = gustMph(now);
    setText('dewPoint', dp != null ? `${dp}°F` : '-');
    setText('humidityNow', nowRH != null ? `${Math.round(nowRH)}%` : '-');
    const pop1 = popVal(now?.probabilityOfPrecipitation);
    setText('pop1', isFinite(pop1) ? `${Math.round(pop1)}%` : '-');
    setText('gustNow', gust != null ? `${gust} mph` : '-');

    // Chance of rain next 6h (max of next 6 hourly pops)
    const next6 = (hourly?.properties?.periods || []).slice(0, 6);
    const pops = next6.map(p => popVal(p.probabilityOfPrecipitation)).filter(v => typeof v === 'number');
    const maxPop = pops.length ? Math.max(...pops) : NaN;
    $('pop6').textContent = isFinite(maxPop) ? `${Math.round(maxPop)}%` : '—';

    $('lastUpdated').textContent = 'Updated ' + new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date());
  } catch (err) {
    console.error('Forecast fetch failed', err);
    $('lastUpdated').textContent = 'Could not load forecast.';
  }
}

/**
 * Loads sunrise and sunset times from the sunrise-sunset.org API.
 * @returns {Promise<void>} A promise that resolves when the sun times are loaded and rendered.
 */
async function loadSunTimes() {
  const applyComputedTimes = () => {
    const computed = computeSunTimes(LAT, LON);
    if (!computed) return false;
    setText('sunrise', fmtTime(computed.sunrise));
    setText('sunset', fmtTime(computed.sunset));
    return true;
  };

  try {
    const url = `https://r.jina.ai/https://api.sunrise-sunset.org/json?lat=${LAT}&lng=${LON}&formatted=0`;
    const data = await fetch(url).then(r => r.json());
    const sr = data?.results?.sunrise;
    const ss = data?.results?.sunset;
    if (sr) setText('sunrise', fmtTime(sr));
    if (ss) setText('sunset', fmtTime(ss));
    if (!sr || !ss) applyComputedTimes();
  } catch (err) {
    console.warn('Sun times fetch failed', err);
    applyComputedTimes();
  }
}

/**
 * Loads the long-range (days 8-14) forecast from forecast.weather.gov.
 * @returns {Promise<void>} A promise that resolves when the forecast is loaded and rendered.
 */
async function loadLongRangeForecast() {
  const cont = $('longRange');
  if (!cont) return;
  cont.classList.add('loading');
  try {
    const url = `https://r.jina.ai/https://forecast.weather.gov/MapClick.php?lat=${LAT}&lon=${LON}&FcstType=digitalJSON`;
    const data = await fetch(url).then(r => r.json());
    const names = data?.time?.startPeriodName || [];
    const temps = data?.data?.temperature || [];
    const pops = data?.data?.pop12 || [];
    const wx = data?.data?.weather || [];
    const windSpd = data?.data?.windSpeed || [];
    const windDir = data?.data?.windDirection || [];
    const icons = data?.data?.iconLink || [];
    const labels = data?.time?.tempLabel || [];
    const periods = [];
    for (let i = 0; i < labels.length; i++) {
      if (labels[i] === 'High') {
        periods.push({
          name: names[i],
          temperature: temps[i],
          probabilityOfPrecipitation: { value: pops[i] },
          shortForecast: wx[i],
          windSpeed: windSpd[i] ? `${windSpd[i]} mph` : '',
          windDirection: windDir[i] || '',
          icon: icons[i]
        });
      }
    }
    const extended = periods.slice(7, 14);
    renderLongRange(extended);
  } catch (err) {
    console.error(err);
    cont.innerHTML = '<div class="error">Could not load long range forecast.</div>';
  } finally {
    cont.classList.remove('loading');
  }
}

/**
 * Renders the hourly forecast into the UI.
 * @param {Array<object>} periods An array of hourly forecast period objects from the NWS API.
 */
function renderHourly(periods) {
  const cont = $('hourly');
  cont.innerHTML = '';
  periods.slice(0, 12).forEach(p => {
    const div = document.createElement('div');
    div.className = 'hourCard';
    const icon = p.icon ? `<img src="${p.icon}" alt="${p.shortForecast}" style="width:36px;height:36px;border-radius:8px;object-fit:cover"/>` : '';
    const pop = popVal(p.probabilityOfPrecipitation);
    div.innerHTML = `
      <div class="top">
        <div>
          <div class="muted">${fmtDay(p.startTime)} - ${fmtTime(p.startTime)}</div>
          <div class="temp">${Math.round(p.temperature)}°F</div>
        </div>
        ${icon}
      </div>
      <div class="muted" style="margin-top:6px">${p.shortForecast || ''}</div>
      <div class="row" style="margin-top:8px">
        <div class="pill" title="Chance of precipitation"><span>🌧️</span><strong>${isFinite(pop) ? pop + '%' : '—'}</strong></div>
        <div class="pill" title="Wind"><span>💨</span><strong>${windNowText(p)}</strong></div>
      </div>
    `;
    cont.appendChild(div);
  });
  cont.classList.remove('loading');
}

/**
 * Renders the daily forecast into the UI.
 * @param {Array<object>} periods An array of daily forecast period objects from the NWS API.
 */
function renderDaily(periods) {
  const cont = $('daily');
  cont.innerHTML = '';
  // Use daytime periods for a clean 7-day overview
  const days = periods.filter(p => p.isDaytime).slice(0, 7);
  days.forEach(p => {
    const div = document.createElement('div');
    div.className = 'dayCard';
    const pop = popVal(p.probabilityOfPrecipitation);
    const icon = p.icon ? `<img src="${p.icon}" alt="${p.shortForecast}" style="width:44px;height:44px;border-radius:10px;object-fit:cover"/>` : '';
    div.innerHTML = `
      <div class="top">
        <div>
          <div style="font-weight:800">${p.name}</div>
          <div class="muted">${p.shortForecast || ''}</div>
        </div>
        ${icon}
      </div>
      <div class="row" style="margin-top:10px">
        <div class="pill"><span>🌡️</span><strong>${Math.round(p.temperature)}°F</strong></div>
        <div class="pill"><span>🌧️</span><strong>${isFinite(pop) ? pop + '%' : '—'}</strong></div>
        <div class="pill"><span>💨</span><strong>${windNowText(p)}</strong></div>
      </div>
    `;
    cont.appendChild(div);
  });
  cont.classList.remove('loading');
}

/**
 * Renders the long-range forecast into the UI.
 * @param {Array<object>} periods An array of daily forecast period objects for the long-range forecast.
 */
function renderLongRange(periods) {
  const cont = $('longRange');
  if (!cont) return;
  cont.innerHTML = '';
  periods.forEach(p => {
    const div = document.createElement('div');
    div.className = 'dayCard';
    const pop = popVal(p.probabilityOfPrecipitation);
    const icon = p.icon ? `<img src="${p.icon}" alt="${p.shortForecast}" style="width:44px;height:44px;border-radius:10px;object-fit:cover"/>` : '';
    div.innerHTML = `
      <div class="top">
        <div>
          <div style="font-weight:800">${p.name}</div>
          <div class="muted">${p.shortForecast || ''}</div>
        </div>
        ${icon}
      </div>
      <div class="row" style="margin-top:10px">
        <div class="pill"><span>🌡️</span><strong>${Math.round(p.temperature)}°F</strong></div>
        <div class="pill"><span>🌧️</span><strong>${isFinite(pop) ? pop + '%' : '—'}</strong></div>
        <div class="pill"><span>💨</span><strong>${windNowText(p)}</strong></div>
      </div>
    `;
    cont.appendChild(div);
  });
  cont.classList.remove('loading');
}

// --- Lake Levels (High Rock only) ---
const USGS_HIGHROCK_SITE = '02122500';
const USGS_HIGHROCK_DATUM_FT = 558.68; // NGVD29 (USGS inventory)
const FULL_POND_HIGHROCK = 655;

/**
 * Fetches the latest High Rock Lake level from the USGS.
 * @returns {Promise<object|null>} A promise that resolves to an object with the lake level value, timestamp, and source, or null on failure.
 */
async function fetchHighRockFromUSGS(){
  try {
    const url = `https://waterservices.usgs.gov/nwis/iv/?format=json&sites=${USGS_HIGHROCK_SITE}&parameterCd=00065&siteStatus=all`;
    const data = await fetch(url).then(r => r.json());
    const ts = data?.value?.timeSeries?.[0];
    const arr = ts?.values?.[0]?.value || [];
    const last = arr[arr.length - 1];
    const gageFt = parseFloat(last?.value);
    const when = last?.dateTime;
    if (isFinite(gageFt)) {
      return { value: +(USGS_HIGHROCK_DATUM_FT + gageFt).toFixed(2), when, src: 'USGS' };
    }
  } catch(err){ console.warn('USGS fetch failed', err); }
  return null;
}

/**
 * Fetches lake levels for High Rock from Cube Carolinas' website by scraping the HTML.
 * @returns {Promise<object>} A promise that resolves to an object containing highrock level data, or null value on failure.
 */
async function fetchFromCube(){
  const candidates = [
    'https://r.jina.ai/https://cubecarolinas.com/lake-levels/',
    'https://r.jina.ai/http://cubecarolinas.com/lake-levels/',
    'https://r.jina.ai/https://www.cubecarolinas.com/lake-levels/',
    'https://r.jina.ai/https://cubecarolinas.com/current-lake-levels/'
  ];
  const parse = (html) => {
    const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const collectNums = (text) => {
      if (!text) return [];
      const matches = text.match(/([0-9]{3}(?:\\.[0-9]+)?)/g) || [];
      return matches
        .map(v => parseFloat(v))
        .filter(v => Number.isFinite(v));
    };
    let doc = null;
    if (typeof DOMParser !== 'undefined') {
      try {
        doc = new DOMParser().parseFromString(html, 'text/html');
      } catch (err) {
        console.warn('Cube DOM parse failed', err);
      }
    }
    const find = (names, avoidFull) => {
      const values = [];
      const lowerNames = names.map(n => n.toLowerCase());
      if (doc?.body) {
        const nodes = Array.from(doc.body.querySelectorAll('*'));
        for (const node of nodes) {
          const text = node.textContent || '';
          if (!text) continue;
          const lower = text.toLowerCase();
          if (!lowerNames.some(n => lower.includes(n))) continue;
          values.push(...collectNums(text));
          const parent = node.parentElement;
          if (parent) values.push(...collectNums(parent.textContent));
          let sibling = node.nextElementSibling;
          for (let i = 0; i < 3 && sibling; i++, sibling = sibling.nextElementSibling) {
            values.push(...collectNums(sibling.textContent));
          }
        }
      }
      if (!values.length) {
        for (const name of names) {
          const re = new RegExp(escapeRegex(name) + "[^0-9]*([0-9]{3}(?:\\.[0-9]+)?)", 'i');
          const m = html.match(re);
          if (m) values.push(parseFloat(m[1]));
        }
      }
      const unique = [];
      for (const val of values) {
        if (!Number.isFinite(val)) continue;
        if (!unique.includes(val)) unique.push(val);
      }
      const preferNotFull = (arr) => (avoidFull != null ? arr.filter(v => Math.abs(v - avoidFull) > 0.002) : arr);
      const decimals = unique.filter(v => Number.isFinite(v) && String(v).includes('.'));
      let candidate = preferNotFull(decimals)[0];
      if (candidate == null) candidate = decimals[0];
      if (candidate == null) candidate = preferNotFull(unique)[0];
      if (candidate == null) candidate = unique[0];
      return candidate ?? null;
    };
    return {
      hr: find(['High Rock Lake', 'High Rock'], FULL_POND_HIGHROCK)
    };
  };
  for (const url of candidates) {
    try {
      const html = await fetch(url).then(r => r.text());
      if (!html) continue;
      const { hr } = parse(html);
      const now = new Date().toISOString();
      const result = {
        highrock: hr != null ? { value: +(+hr).toFixed(2), when: now, src: 'Cube Carolinas' } : null
      };
      if (result.highrock) return result;
    } catch(err){ console.warn('Cube levels fetch failed', url, err); }
  }
  return { highrock: null };
}

/**
 * Fetches the High Rock Lake level from the NOAA NWPS website by scraping the HTML.
 * @returns {Promise<object|null>} A promise that resolves to an object with the lake level value, timestamp, and source, or null on failure.
 */
async function fetchHighRockFromNOAA(){
  try {
    const text = await fetch('https://r.jina.ai/http://water.noaa.gov/gauges/hgrn7').then(r => r.text());
    const m = text.match(/Pool \(FT\)[^0-9]*([0-9]{3}\.[0-9]+)/i);
    if (m) return { value: +parseFloat(m[1]).toFixed(2), when: new Date().toISOString(), src: 'NOAA NWPS' };
  } catch(err){ console.warn('NOAA NWPS fetch failed', err); }
  return null;
}

/**
 * Renders the lake levels into the UI (High Rock only).
 * @param {object} vals An object containing `highrock` lake level data.
 */
function renderLakeLevels(vals){
  const cont = $('lakes');
  if (!cont) return;
  cont.innerHTML = '';
  const addRow = (label, item, full) => {
    const div = document.createElement('div');
    div.className = 'dayCard';
    let valueText = '—';
    let sub = '';
    if (item && isFinite(item.value)) {
      const diff = (full != null) ? +(full - item.value).toFixed(2) : null;
      const dir = diff != null ? (diff >= 0 ? 'below' : 'above') : '';
      const mag = diff != null ? Math.abs(diff).toFixed(2) : '';
      valueText = `${item.value.toFixed(2)} ft`;
      sub = (diff != null) ? `${mag} ft ${dir} full (${full} ft)` : '';
    }
    const top = document.createElement('div');
    top.className = 'top';
    div.appendChild(top);

    const left = document.createElement('div');
    top.appendChild(left);

    const lblDiv = document.createElement('div');
    lblDiv.style.fontWeight = '800';
    lblDiv.textContent = label;
    left.appendChild(lblDiv);

    const mutedDiv = document.createElement('div');
    mutedDiv.className = 'muted';
    mutedDiv.textContent = sub || '';
    left.appendChild(mutedDiv);

    const tempDiv = document.createElement('div');
    tempDiv.className = 'temp';
    tempDiv.textContent = valueText;
    top.appendChild(tempDiv);

    const footDiv = document.createElement('div');
    footDiv.className = 'footnote';
    footDiv.textContent = item?.src ? 'Source: ' + item.src : '';
    div.appendChild(footDiv);

    cont.appendChild(div);
  };
  addRow('High Rock Lake', vals.highrock, FULL_POND_HIGHROCK);
}

/**
 * Loads lake level data from various sources and renders it.
 * It tries Cube Carolinas first, then falls back to USGS and NOAA for High Rock Lake.
 * @returns {Promise<void>} A promise that resolves when the lake levels are loaded and rendered.
 */
async function loadLakeLevels(){
  const vals = { highrock: null };
  // Try operator site first for High Rock only
  const cube = await fetchFromCube();
  if (cube.highrock) vals.highrock = cube.highrock;
  // High Rock fallbacks
  if (!vals.highrock) vals.highrock = await fetchHighRockFromUSGS();
  if (!vals.highrock) vals.highrock = await fetchHighRockFromNOAA();
  renderLakeLevels(vals);
}

// --- Initial Load ---
/**
 * Triggers all the initial data loading functions for the application.
 */
function initialLoad() {
  loadForecast();
  loadLakeLevels();
  initRadarAnimation();
  loadSunTimes();
}

document.getElementById('refreshBtn')?.addEventListener('click', initialLoad);

/**
 * The main initialization function for the application.
 * It determines the user's location, initializes the map, and then loads all data.
 * @returns {Promise<void>}
 */
async function init() {
  await determineLocation();
  initMap();
  setText('location', `${LAT.toFixed(2)}, ${LON.toFixed(2)}`);
  initialLoad();
}

// Run on page load
init();










