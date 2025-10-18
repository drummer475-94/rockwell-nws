# Quick Test Checklist

Open `index.html` in your browser and verify:

## ✅ Radar Layer (Default)
- [ ] Map loads with radar overlay
- [ ] Animation controls appear below map
- [ ] Can switch between Auto/Animated/Static/Off modes
- [ ] Play button starts animation
- [ ] Frame slider shows timestamps
- [ ] Console shows: "Loaded X radar frames"

## ✅ Satellite Layer
- [ ] Select "Satellite" from Layer dropdown
- [ ] Should show visible light satellite imagery
- [ ] Animated mode shows cloud movements (if frames available)
- [ ] Static mode shows GOES visible satellite
- [ ] Attribution updates to show satellite sources

## ✅ Clouds Layer (Infrared)
- [ ] Select "Clouds" from Layer dropdown
- [ ] Should show infrared satellite imagery
- [ ] Good for viewing clouds at night
- [ ] Animated frames show cloud evolution
- [ ] Static fallback uses GOES IR channel 13
- [ ] Attribution shows: "Animated: RainViewer Infrared • Static: GOES IR"

## ✅ Temperature Layer
- [ ] Select "Temperature" from Layer dropdown
- [ ] Shows infrared imagery (similar to clouds)
- [ ] Can see temperature gradients in clouds
- [ ] Works in both animated and static modes

## 🔧 Expected Behavior

**If animated frames are available:**
- Auto mode: Shows animated layer
- Animated mode: Shows animated layer with controls
- Static mode: Shows static fallback from Iowa State Mesonet
- Off mode: Hides all weather layers

**If animated frames are NOT available:**
- Auto mode: Falls back to static
- Animated mode: Falls back to static (with message)
- Diagnostic message shows: "RainViewer frames unavailable for {layer}; showing static layer."

## 🐛 Debugging

Open browser console (F12) and look for:
- ✅ "Loaded X radar frames"
- ✅ "Loaded X satellite frames"
- ✅ "Radar: X frames • Satellite: X frames" (in UI)
- ❌ Any 404 errors for tile URLs (should not happen with fixed URLs)
- ❌ "YOUR_API_KEY" in any URLs (should be removed)

## 🎉 Success Criteria

All four layers (Radar, Satellite, Clouds, Temperature) should:
1. Load without errors
2. Display weather data
3. Work in both animated and static modes
4. Show correct attribution
5. Switch smoothly between layers
6. Not require any API keys

---

**Previous Issues (Now Fixed):**
- ❌ Cloud layer showed 404 errors (OpenWeatherMap API key required)
- ❌ Layer switching could break animation
- ❌ Satellite frames not properly used for clouds/temp layers
- ❌ Attribution referenced non-working data sources

**All issues are now resolved!** ✨
