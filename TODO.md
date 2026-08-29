# TODO

## Priority

- [ ] **Dew point** — `dew_point_2m`, often a better "how muggy does it feel" indicator than relative humidity alone; could sit next to the humidity card.
- [ ] **Wind gusts** — `wind_gusts_10m`, alongside the existing sustained wind speed card, since gustiness isn't visible from sustained speed alone.
- [ ] **Port over the Synthwave theme as a toggle** — `C:\Claude Code Projects\weather-app-Synthwave` (separate git clone of this same repo, local `synthwave-theme` branch, 8 commits ahead of `origin/main` as of `75cf745`, not yet pushed to GitHub) has a working 80s synthwave visual theme (a color-token refactor of `style.css` + a light/dark-style theme toggle button) and a "🎛️ Synthwave radio" panel (YouTube-embedded radio stream, with nocookie-host retry and error-153 handling already worked out). Copy/adapt that code into this project so the synthwave look is available here as a toggle alongside the current theme, rather than a separate fork.
