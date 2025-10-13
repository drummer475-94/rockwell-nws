# Weather Layer Features

## Overview
The NWS Forecast app now supports multiple weather visualization layers beyond just radar data.

## Available Layers

### 1. **Radar** (Default)
- **Animated**: RainViewer animated precipitation radar
- **Static Fallback**: NEXRAD composite from Iowa State Mesonet
- **Best For**: Tracking precipitation and storm systems

### 2. **Satellite**
- **Animated**: RainViewer satellite imagery (visible spectrum)
- **Static Fallback**: GOES satellite from Iowa State Mesonet
- **Best For**: Viewing cloud cover and large-scale weather patterns

### 3. **Clouds**
- **Animated**: RainViewer infrared satellite imagery
- **Static Fallback**: OpenWeatherMap cloud layer
- **Best For**: Nighttime cloud tracking and temperature analysis

### 4. **Temperature**
- **Animated**: RainViewer satellite temperature overlay
- **Static Fallback**: OpenWeatherMap temperature layer
- **Best For**: Temperature distribution patterns

## How to Use

1. **Select Layer**: Use the "Layer" dropdown menu above the map
2. **Choose Mode**: 
   - **Auto**: Automatically uses animated if available, falls back to static
   - **Animated**: Shows time-lapse animation of the layer
   - **Static**: Shows current static layer only
   - **Off**: Hides all weather layers
3. **Control Animation**: Use Play/Pause and the frame slider to navigate through time
4. **Adjust Settings**: 
   - Max frames: Control memory usage
   - Speed: Adjust animation speed
   - Opacity: Change layer transparency
   - Resolution: Standard (256px) or HD (512px)

## Data Sources

- **RainViewer**: Primary source for animated radar and satellite data
- **Iowa State Mesonet**: NEXRAD radar and GOES satellite static fallbacks
- **OpenWeatherMap**: Additional cloud and temperature data (API key required for some features)

## Technical Notes

### RainViewer API
- Provides both radar and satellite imagery with past and nowcast data
- Frames are typically 5-10 minutes apart
- Historical data goes back approximately 2 hours
- Nowcast provides forecast up to 30 minutes ahead

### Layer Types
- **Radar**: `/v2/radar/{timestamp}/{size}/{z}/{x}/{y}/2/1_1.png`
- **Satellite**: `/v2/satellite/{timestamp}/{size}/{z}/{x}/{y}/0/0_0.png`
- **Clouds/IR**: `/v2/satellite/{timestamp}/{size}/{z}/{x}/{y}/0/0_1.png`

### Performance
- Recommended max frames scales with device memory:
  - Mobile devices: 24 frames
  - Desktop (4GB RAM): 36 frames
  - Desktop (8GB+ RAM): 48 frames
- HD mode (512px) uses more bandwidth but provides clearer imagery

## Future Enhancements

Potential additions for weather model viewing:
- GFS (Global Forecast System) model overlays
- European ECMWF model data
- HRRR (High-Resolution Rapid Refresh) for short-term forecasts
- Wave height and wind field overlays for marine forecasts

Note: Weather model integration (GFS/Euro) would require additional APIs like:
- Windy.com API
- OpenWeatherMap professional tier
- Custom GRIB2 file processing
- NOAA NOMADS server integration
