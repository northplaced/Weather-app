# TODO

- [ ] **Favorite city / multi-city display (overview)** — save one or more cities (localStorage), show a compact overview (e.g. name + current temp + icon per city), tap to load full detail view.
- [ ] **Use phone's location for current-location weather** — `navigator.geolocation.getCurrentPosition()`, pass lat/lon straight to the forecast API (no geocoding needed); reverse-geocode only for a display name. Needs a permission-denied fallback.
- [ ] **Add rainfall in mm** — Open-Meteo's `hourly`/`current` params support `precipitation` (mm), separate from the `precipitation_probability` (%) already used.
- [ ] **Toggle SI ↔ Imperial units** — °C↔°F, m/s↔mph, hPa↔inHg, mm↔in. Open-Meteo also accepts unit params directly on the request (e.g. `temperature_unit=fahrenheit`) as an alternative to converting client-side.
- [ ] **Pollen forecast: add scale numbers to the meters** — small tick labels (e.g. grains/m³ values) along each species' bar so the None/Present/Elevated/Peak thresholds are visible, not just inferred from the tick mark position.
- [ ] **Proper moon calendar?** — open question on scope: a month-grid view of moon phases, vs. just extending the current moonrise/moonset card with a few upcoming days. Needs a decision before implementing.
