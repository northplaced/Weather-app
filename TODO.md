# TODO

- [ ] **Favorite city / multi-city display (overview)** — save one or more cities (localStorage), show a compact overview (e.g. name + current temp + icon per city), tap to load full detail view.
- [ ] **Use phone's location for current-location weather** — `navigator.geolocation.getCurrentPosition()`, pass lat/lon straight to the forecast API (no geocoding needed); reverse-geocode only for a display name. Needs a permission-denied fallback.
- [x] **Add rainfall in mm** — Open-Meteo's `hourly`/`current` params support `precipitation` (mm), separate from the `precipitation_probability` (%) already used.
- [x] **Toggle SI ↔ Imperial units** — °C↔°F, m/s↔mph, hPa↔inHg, mm↔in. Open-Meteo also accepts unit params directly on the request (e.g. `temperature_unit=fahrenheit`) as an alternative to converting client-side.
- [x] **Pollen forecast: add scale numbers to the meters** — small tick labels (e.g. grains/m³ values) along each species' bar so the None/Present/Elevated/Peak thresholds are visible, not just inferred from the tick mark position.
- [ ] **Proper moon calendar?** — open question on scope: a month-grid view of moon phases, vs. just extending the current moonrise/moonset card with a few upcoming days. Needs a decision before implementing.
- [x] **All 8 moon phase icons in a row with a current-phase indicator** — display every phase icon (New, Waxing Crescent, First Quarter, Waxing Gibbous, Full, Waning Gibbous, Last Quarter, Waning Crescent) side by side, with a slider/pointer that moves to and highlights today's phase, and the phase name shown as a label below.
- [ ] **Elevation** — already returned in the forecast API response (`elevation`, meters); not displayed anywhere yet.
- [ ] **Timezone name** — the API returns the IANA timezone (e.g. `Europe/Helsinki`); local time is shown but not the zone name itself.
- [ ] **Wind gusts** — `wind_gusts_10m`, alongside the existing sustained wind speed card, since gustiness isn't visible from sustained speed alone.
- [ ] **Dew point** — `dew_point_2m`, often a better "how muggy does it feel" indicator than relative humidity alone; could sit next to the humidity card.
- [ ] **Day-length trend** — e.g. "3m 12s longer than yesterday" on the sun arc card, by diffing today's and yesterday's sunrise/sunset.
- [ ] **Golden hour / blue hour times** — derived from sunrise/sunset with a fixed offset, useful for photography.
- [ ] **Historical/seasonal comparison** — e.g. "4°C above the typical high for this date," using Open-Meteo's separate historical/climate API. Bigger lift than the others — a new API integration, not just a param addition.
