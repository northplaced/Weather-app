# Weather App

A single-page weather app — vanilla HTML/CSS/JS, no frameworks, no build step, no dependencies.

**Live:** https://northplaced.github.io/Weather-app/

## Features

- City search with autocomplete, current conditions, 24-hour scroll, and 10-day forecast
- Wind, UV index, air quality, humidity, and pressure (with a 3-hour trend) detail cards
- Sunrise & sunset arc, including golden/blue hour windows and the sun's live compass
  direction and elevation
- Moonrise & moonset arc, moon phase (with illumination %), and the moon's live compass
  direction and elevation
- Pollen forecast for six species (Europe only)
- Interactive rain radar — drag to pan, scroll to zoom, slider for the past 2h and a short
  forecast
- °C/°F and metric/imperial unit toggle
- Two themes: a light "classic" look (default) and a dark neon "synthwave" theme, including
  a Nightride FM radio player that only appears in synthwave mode — pick with the toggle next
  to the unit switcher, top right

## Running locally

No build step — just serve the folder and open it.

```bash
npx http-server . -p 8793
```

Then open `http://localhost:8793`. A plain static server is enough; nothing here needs a
backend.

## Data sources

- [Open-Meteo](https://open-meteo.com/) — weather, air quality, pollen, and geocoding
  (CC BY 4.0, credited in the app)
- [RainViewer](https://www.rainviewer.com/) — rain radar imagery
- [OpenStreetMap](https://www.openstreetmap.org/copyright) — radar base map tiles
- [Nightride FM](https://nightride.fm/) — synthwave radio streams (synthwave theme only)

## Project notes

See [TODO.md](TODO.md) for planned work.
