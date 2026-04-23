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
    // UPDATED to modern V2 RainViewer endpoint
    const radarRes = await fetch('https://api.rainviewer.com/public/weather-maps.json');
    if (!radarRes.ok) {
      console.error('RainViewer API returned non-OK', radarRes.status);
      setMode('static');
      return;
    }
    
    const data = await radarRes.json();
    const host = data.host; // Host is dynamically provided by the API
    
    // Parse Radar Frames
    if (data.radar) {
      const past = Array.isArray(data.radar.past) ? data.radar.past : [];
      const nowc = Array.isArray(data.radar.nowcast) ? data.radar.nowcast : [];
      
      rainFrames = past.concat(nowc).map(f => ({
        time: f.time,
        path: host + f.path // Pre-construct the full base path
      }));
      
      rainFrames.sort((a, b) => a.time - b.time);
      rainFrames = rainFrames.slice(-MAX_FRAMES);
      console.log(`Loaded ${rainFrames.length} radar frames`);
    }

    // Parse Satellite Frames
    if (data.satellite && data.satellite.infrared) {
      satelliteFrames = data.satellite.infrared.map(f => ({
        time: f.time,
        path: host + f.path // Pre-construct the full base path
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

// --- UI wire-up for layer controls (Completed) ---
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
