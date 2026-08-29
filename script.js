const form = document.getElementById('search-form');
const cityInput = document.getElementById('city-input');
const result = document.getElementById('result');
const suggestionsList = document.getElementById('suggestions-list');
const clearInputBtn = document.getElementById('clear-input-btn');
const pollenContent = document.getElementById('pollen-content');

let debounceTimer = null;
let suggestionRequestId = 0;
let currentSuggestions = [];
let highlightedIndex = -1;

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_DELAY = 350;

const UNITS_STORAGE_KEY = 'weatherapp-units';
let unitSystem = localStorage.getItem(UNITS_STORAGE_KEY) === 'imperial' ? 'imperial' : 'si';

// Theme is applied to <html> as a data-theme attribute; style.css defines a complete token set
// per theme. Synthwave is the default and needs no attribute, so only 'classic' has to persist.
// index.html reads this same key in an inline <head> script to set the attribute before first
// paint — without that, the page paints in the default theme and then snaps to the saved one.
const THEME_STORAGE_KEY = 'weatherapp-theme';
let theme = localStorage.getItem(THEME_STORAGE_KEY) === 'classic' ? 'classic' : 'synthwave';

// Cached inputs from the last successful render, so toggling units can re-render from the
// already-fetched data instead of re-fetching from the API.
let lastLocation = null;
let lastForecast = null;
let lastAirQuality = null;

// Escapes text before it's interpolated into an innerHTML template — required for anything
// that isn't a hardcoded literal (user input, geocoding results, error messages), since none
// of that is guaranteed free of HTML-special characters.
function escapeHtml(str) {
  const chars = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(str).replace(/[&<>"']/g, (ch) => chars[ch]);
}

// Maps Open-Meteo's weather codes to plain-English descriptions.
const weatherDescriptions = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Depositing rime fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Heavy drizzle',
  56: 'Light freezing drizzle',
  57: 'Freezing drizzle',
  61: 'Light rain',
  63: 'Rain',
  65: 'Heavy rain',
  66: 'Light freezing rain',
  67: 'Freezing rain',
  71: 'Light snow',
  73: 'Snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Light rain showers',
  81: 'Rain showers',
  82: 'Violent rain showers',
  85: 'Light snow showers',
  86: 'Snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with hail',
  99: 'Thunderstorm with heavy hail',
};

// Maps the same weather codes to an emoji icon, using is_day to pick sun vs moon.
// Shared with buildHourly, which uses it to decide whether an hour's precipitation box should
// show snowfall (cm) instead of rainfall (mm).
const SNOW_WEATHER_CODES = [71, 73, 75, 77, 85, 86];

function getWeatherIcon(code, isDay) {
  if (code === 0) return isDay ? '☀️' : '🌙';
  if (code === 1) return isDay ? '🌤️' : '🌙';
  if (code === 2) return isDay ? '⛅' : '☁️';
  if (code === 3) return '☁️';
  if (code === 45 || code === 48) return '🌫️';
  if ([51, 53, 55, 56, 57].includes(code)) return '🌦️';
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return '🌧️';
  if (SNOW_WEATHER_CODES.includes(code)) return '🌨️';
  if ([95, 96, 99].includes(code)) return '⛈️';
  return '❓';
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  closeSuggestions();
  searchCity(cityInput.value.trim());
});

function applyUnitToggleUI() {
  document.querySelectorAll('.unit-toggle-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.unit === unitSystem);
  });
}

document.querySelectorAll('.unit-toggle-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    if (btn.dataset.unit === unitSystem) return;
    unitSystem = btn.dataset.unit;
    localStorage.setItem(UNITS_STORAGE_KEY, unitSystem);
    applyUnitToggleUI();
    if (lastForecast) renderWeather(lastLocation, lastForecast, lastAirQuality);
  });
});

// Drawn rather than picked from the emoji set: no emoji has the slatted outrun
// sun (🌇 and 🌅 are the nearest and neither is close). Its colours are fixed
// rather than tokenised on purpose — it always depicts Synthwave, so it stays
// the same picture whichever theme is currently on, and doubles as a preview of
// the palette the button switches into.
const SYNTHWAVE_SUN_ICON = `
  <svg viewBox="0 0 32 32" width="19" height="19" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="synthwave-sun-gradient" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#ffd152"/>
        <stop offset="42%" stop-color="#ff9838"/>
        <stop offset="100%" stop-color="#ff3f72"/>
      </linearGradient>
      <!-- The slats are full-width bars, but the disc narrows towards the
           bottom, so without this they overshoot its edge and stick out as
           tabs. Clipping to the disc lets each bar end exactly on the curve. -->
      <clipPath id="synthwave-sun-clip">
        <circle cx="16" cy="16" r="11"/>
      </clipPath>
    </defs>
    <circle cx="16" cy="16" r="15" fill="#6d3d73"/>
    <circle cx="16" cy="16" r="11" fill="url(#synthwave-sun-gradient)"/>
    <!-- Three slats, not four: the disc is 22 units across but renders at 19px,
         so a fourth put every band under a pixel and they mushed together. The
         last one runs past the bottom of the disc on purpose — ending it short
         left a 0.3-unit crescent hanging below it. -->
    <g fill="#6d3d73" clip-path="url(#synthwave-sun-clip)">
      <rect x="3" y="17.1" width="26" height="1.9"/>
      <rect x="3" y="21" width="26" height="2.1"/>
      <rect x="3" y="24.8" width="26" height="3"/>
    </g>
  </svg>`;

function applyThemeToggleUI() {
  document.documentElement.setAttribute('data-theme', theme);
  const btn = document.querySelector('.theme-toggle-btn');
  if (!btn) return;
  const isSynthwave = theme === 'synthwave';
  btn.setAttribute('aria-pressed', String(isSynthwave));
  btn.title = isSynthwave ? 'Switch to classic theme' : 'Switch to synthwave theme';
  // The icon shows where the button takes you, not where you already are, so it
  // reads the same way round as the tooltip beside it: the outrun sun to go into
  // Synthwave, daylight to come back out. Both values are literals in this file,
  // so innerHTML carries no untrusted input.
  btn.innerHTML = isSynthwave ? '🌤️' : SYNTHWAVE_SUN_ICON;
}

// Deliberately does NOT re-render, unlike the unit toggle above. Units change the data; the
// theme only changes paint, and every colour — including the ones set inline below as var()
// references — re-resolves the moment the attribute flips. Re-rendering would throw away the
// hourly strip's scroll position and replace the live clock's node for no reason.
document.querySelectorAll('.theme-toggle-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    theme = theme === 'synthwave' ? 'classic' : 'synthwave';
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    applyThemeToggleUI();
    // The classic theme hides the radio entirely, and hiding a deck that is
    // still playing would leave audio running with no way to reach the stop
    // button. Entering Synthwave starts it back up, so the mode arrives with
    // its music.
    //
    // Starting audio only works here because this runs inside a real click, and
    // that gesture is what lets a browser allow playback at all. The same call
    // on page load would simply be refused, which is why entering the mode
    // starts the radio but loading the page already in it does not.
    //
    // Safe to call from here either way: a click only happens long after the
    // radio section at the foot of the file has initialised.
    if (theme === 'classic') {
      disconnectRadio();
    } else {
      connectRadio();
    }
  });
});

async function searchCity(city) {
  if (!city) return;

  result.innerHTML = '<p>Loading...</p>';

  try {
    const location = await getCoordinates(city);
    await loadLocation(location);
  } catch (error) {
    result.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
  }
}

async function loadLocation(location) {
  result.innerHTML = '<p>Loading...</p>';
  pollenContent.innerHTML = '<p class="pollen-placeholder">Loading...</p>';

  try {
    renderRadar(location.latitude, location.longitude);

    const [forecast, air] = await Promise.all([
      getForecast(location.latitude, location.longitude),
      getAirQuality(location.latitude, location.longitude),
    ]);
    lastLocation = location;
    lastForecast = forecast;
    lastAirQuality = air;
    renderWeather(location, forecast, air);
    pollenContent.innerHTML = buildPollenForecast(air);
  } catch (error) {
    result.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
  }
}


async function getCoordinates(city) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`;
  const response = await fetch(url);
  const data = await response.json();

  if (!data.results || data.results.length === 0) {
    throw new Error(`Could not find a city named "${city}".`);
  }

  const { latitude, longitude, name, country } = data.results[0];
  return { latitude, longitude, name, country };
}

async function getSuggestions(query) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=8&language=en&format=json`;
  const response = await fetch(url);
  const data = await response.json();
  return data.results || [];
}

cityInput.addEventListener('input', () => {
  const query = cityInput.value.trim();
  clearTimeout(debounceTimer);

  if (query.length < MIN_QUERY_LENGTH) {
    closeSuggestions();
    return;
  }

  debounceTimer = setTimeout(() => fetchSuggestions(query), DEBOUNCE_DELAY);
});

// Small "x" button so mobile users can clear the current city in one tap instead of
// holding backspace — shown whenever the input has text, hidden when it's empty.
cityInput.addEventListener('input', updateClearButtonVisibility);

function updateClearButtonVisibility() {
  clearInputBtn.style.display = cityInput.value.length > 0 ? 'flex' : 'none';
}

clearInputBtn.addEventListener('click', () => {
  cityInput.value = '';
  updateClearButtonVisibility();
  closeSuggestions();
  cityInput.focus();
});

async function fetchSuggestions(query) {
  const requestId = ++suggestionRequestId;
  let results = [];

  try {
    results = await getSuggestions(query);
  } catch (error) {
    results = [];
  }

  if (requestId !== suggestionRequestId) return; // superseded by a newer request

  currentSuggestions = results;
  renderSuggestions(results);
}

function renderSuggestions(suggestions) {
  highlightedIndex = -1;

  if (suggestions.length === 0) {
    suggestionsList.innerHTML = '<li class="suggestion-empty">No matches</li>';
    openSuggestions();
    return;
  }

  suggestionsList.innerHTML = suggestions
    .map((place, index) => {
      const subtitle = escapeHtml([place.admin1, place.country].filter(Boolean).join(', '));
      return `
        <li class="suggestion-item" role="option" id="suggestion-${index}" data-index="${index}">
          <span class="suggestion-name">${escapeHtml(place.name)}</span>
          ${subtitle ? `<span class="suggestion-subtitle">${subtitle}</span>` : ''}
        </li>
      `;
    })
    .join('');

  openSuggestions();
}

function openSuggestions() {
  suggestionsList.classList.add('open');
  cityInput.setAttribute('aria-expanded', 'true');
}

function closeSuggestions() {
  suggestionRequestId++; // invalidate any in-flight fetch so it can't reopen this later
  suggestionsList.classList.remove('open');
  suggestionsList.innerHTML = '';
  currentSuggestions = [];
  highlightedIndex = -1;
  cityInput.setAttribute('aria-expanded', 'false');
  cityInput.removeAttribute('aria-activedescendant');
}

function selectSuggestion(index) {
  const place = currentSuggestions[index];
  if (!place) return;

  cityInput.value = place.name;
  closeSuggestions();

  loadLocation({
    latitude: place.latitude,
    longitude: place.longitude,
    name: place.name,
    country: place.country,
  });
}

suggestionsList.addEventListener('click', (event) => {
  const item = event.target.closest('.suggestion-item[data-index]');
  if (!item) return;
  selectSuggestion(Number(item.dataset.index));
});

cityInput.addEventListener('keydown', (event) => {
  const isOpen = suggestionsList.classList.contains('open') && currentSuggestions.length > 0;

  if (event.key === 'ArrowDown') {
    if (!isOpen) return;
    event.preventDefault();
    highlightedIndex = (highlightedIndex + 1) % currentSuggestions.length;
    updateHighlight();
  } else if (event.key === 'ArrowUp') {
    if (!isOpen) return;
    event.preventDefault();
    highlightedIndex = (highlightedIndex - 1 + currentSuggestions.length) % currentSuggestions.length;
    updateHighlight();
  } else if (event.key === 'Enter') {
    if (isOpen && highlightedIndex >= 0) {
      event.preventDefault();
      selectSuggestion(highlightedIndex);
    } else {
      closeSuggestions(); // fall through to normal form submission
    }
  } else if (event.key === 'Escape') {
    if (isOpen) {
      event.preventDefault();
      closeSuggestions();
    }
  }
});

function updateHighlight() {
  const items = suggestionsList.querySelectorAll('.suggestion-item[data-index]');
  items.forEach((item) => item.classList.remove('highlighted'));

  const activeItem = items[highlightedIndex];
  if (activeItem) {
    activeItem.classList.add('highlighted');
    activeItem.scrollIntoView({ block: 'nearest' });
    cityInput.setAttribute('aria-activedescendant', activeItem.id);
  } else {
    cityInput.removeAttribute('aria-activedescendant');
  }
}

document.addEventListener('click', (event) => {
  if (!form.contains(event.target)) closeSuggestions();
});

async function getForecast(latitude, longitude) {
  const params = [
    `latitude=${latitude}`,
    `longitude=${longitude}`,
    `current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,surface_pressure,is_day`,
    `hourly=temperature_2m,weather_code,precipitation_probability,precipitation,snowfall,visibility,uv_index,is_day,surface_pressure`,
    `daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max,moonrise,moonset,moon_phase`,
    `timezone=auto`,
    `wind_speed_unit=ms`,
    `forecast_days=10`,
  ].join('&');

  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!response.ok) {
    throw new Error('Could not fetch weather data. Please try again.');
  }
  return response.json();
}

async function getAirQuality(latitude, longitude) {
  try {
    const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${latitude}&longitude=${longitude}&current=european_aqi,alder_pollen,birch_pollen,grass_pollen,mugwort_pollen,olive_pollen,ragweed_pollen&timezone=auto`;
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.json();
    return data.current;
  } catch {
    return null;
  }
}

let hourlyForecastClockInterval = null;

function renderWeather(location, forecast, air) {
  const { current, hourly, daily } = forecast;
  const isDay = current.is_day === 1;
  const nowIndex = getClosestHourIndex(hourly.time, current.time);
  const description = weatherDescriptions[current.weather_code] || 'Unknown conditions';
  const precipNow = hourly.precipitation_probability[nowIndex];
  const isSnowyNow = SNOW_WEATHER_CODES.includes(current.weather_code);
  const amountNow = isSnowyNow ? hourly.snowfall[nowIndex] : hourly.precipitation[nowIndex];
  const amountNowLabel =
    amountNow != null
      ? (isSnowyNow
          ? convertSnowCm(amountNow).toFixed(precipDecimals()) + ' ' + snowUnitLabel()
          : convertPrecipMm(amountNow).toFixed(precipDecimals()) + ' ' + precipUnitLabel()) + ' &middot; '
      : '';

  result.innerHTML = `
    <div class="current">
      <h2>${escapeHtml(location.name)}, ${escapeHtml(location.country)}</h2>
      <p class="current-clock" id="hourly-forecast-clock">${formatWeekdayDateTime(new Date())}</p>
      <div class="current-columns">
        <p class="temp-big">${Math.round(convertTemp(current.temperature_2m))}&deg;${tempUnitLabel()}</p>
        <div class="current-icon">${getWeatherIcon(current.weather_code, isDay)}</div>
        <p class="feels-like">Feels like ${Math.round(convertTemp(current.apparent_temperature))}&deg;${tempUnitLabel()}</p>
        <p class="condition">${description}</p>
        <p class="hi-lo">High ${Math.round(convertTemp(daily.temperature_2m_max[0]))}&deg; &middot; Low ${Math.round(convertTemp(daily.temperature_2m_min[0]))}&deg;</p>
        <p class="current-precip">${amountNowLabel}${precipNow != null ? precipNow + '%' : ''}</p>
      </div>
    </div>

    <section>
      <h3>Hourly forecast</h3>
      <div class="hourly-scroll">${buildHourly(hourly, nowIndex)}</div>
    </section>

    <section>
      <h3>Details</h3>
      <div class="details-grid">${buildDetails(current, hourly, daily, air, nowIndex)}</div>
    </section>

    <section>
      <div class="section-header">
        <h3>☀️ Sunrise &amp; sunset</h3>
        <span class="local-time">Local time ${formatTime(current.time)}</span>
      </div>
      <div class="sun-arc-wrap">${buildSunPath(daily, current.time, location.latitude, location.longitude)}</div>
    </section>

    <section>
      <h3>🌙 Moonrise &amp; moonset</h3>
      <div class="moon-arc-wrap">${buildMoonPath(daily, current.time, location.latitude, location.longitude)}</div>
    </section>

    <section>
      <div class="moon-phase-section">${buildMoonPhaseSection(daily)}</div>
    </section>

    <section>
      <h3>10-day forecast</h3>
      <div class="daily-list">${buildDaily(daily)}</div>
    </section>
  `;

  clearInterval(hourlyForecastClockInterval);
  hourlyForecastClockInterval = setInterval(() => {
    const clockEl = document.getElementById('hourly-forecast-clock');
    if (!clockEl) {
      clearInterval(hourlyForecastClockInterval);
      return;
    }
    clockEl.textContent = formatWeekdayDateTime(new Date());
  }, 1000);
}

function buildHourly(hourly, nowIndex) {
  let html = '';
  const end = Math.min(nowIndex + 24, hourly.time.length);

  for (let i = nowIndex; i < end; i++) {
    const time = new Date(hourly.time[i]);
    const label = i === nowIndex ? 'Now' : time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    const icon = getWeatherIcon(hourly.weather_code[i], hourly.is_day[i] === 1);
    const precip = hourly.precipitation_probability[i];
    // When the hour's own weather is snow, the same box reports snowfall (cm) instead of
    // rainfall (mm) — showing rain mm during a snowy hour is both the wrong substance and
    // usually near-zero, since it's snow's liquid-equivalent, not its actual accumulation.
    const isSnowy = SNOW_WEATHER_CODES.includes(hourly.weather_code[i]);
    const amount = isSnowy ? hourly.snowfall[i] : hourly.precipitation[i];
    const amountCap = isSnowy ? 3 : 5; // cm/h vs mm/h "heavy" reference used to scale the fill
    const amountFillPercent = amount != null ? Math.min(100, (amount / amountCap) * 100) : 0;
    const amountLabel =
      amount != null
        ? isSnowy
          ? convertSnowCm(amount).toFixed(precipDecimals()) + ' ' + snowUnitLabel()
          : convertPrecipMm(amount).toFixed(precipDecimals()) + ' ' + precipUnitLabel()
        : '';

    html += `
      <div class="hour-item">
        <div class="hour-label">${label}</div>
        <div class="hour-temp">${Math.round(convertTemp(hourly.temperature_2m[i]))}&deg;</div>
        <div class="hour-icon">${icon}</div>
        <div class="hour-rain-box${isSnowy ? ' hour-rain-box-snow' : ''}">
          <div class="hour-rain-bar-zone">
            <div class="hour-rain-fill" style="height: ${amountFillPercent.toFixed(1)}%;">
              <div class="hour-rain-value">${amountLabel}</div>
            </div>
          </div>
        </div>
        <div class="hour-precip">${precip != null ? precip + '%' : ''}</div>
      </div>
    `;
  }

  return html;
}

function buildDetails(current, hourly, daily, air, nowIndex) {
  const windDir = degToCompass(current.wind_direction_10m);
  const windKmh = Math.round(current.wind_speed_10m * 3.6);
  const windPercent = (Math.max(0, Math.min(130, windKmh)) / 130) * 100;

  const uv = hourly.uv_index[nowIndex] != null ? Math.round(hourly.uv_index[nowIndex]) : null;
  const uvPercent = uv != null ? (Math.max(0, Math.min(12, uv)) / 12) * 100 : null;
  const aqi = air && air.european_aqi != null ? Math.round(air.european_aqi) : null;
  const aqiPercent = aqi != null ? (Math.max(0, Math.min(120, aqi)) / 120) * 100 : null;
  const humidityPercent =
    current.relative_humidity_2m != null ? Math.max(0, Math.min(100, current.relative_humidity_2m)) : null;
  const pressureHpa = Math.round(current.surface_pressure);
  const pressurePercent = (Math.max(950, Math.min(1050, pressureHpa)) - 950) / 100 * 100;
  const pressureValueLabel =
    unitSystem === 'imperial'
      ? `${convertPressureHpa(current.surface_pressure).toFixed(2)} ${pressureUnitLabel()}`
      : `${pressureHpa} ${pressureUnitLabel()}`;
  const pressureSecondaryLabel = unitSystem === 'imperial' ? `(${pressureHpa} hPa)` : '(mbar)';
  const pressureScalePoints = [
    { hpa: 950, left: 0, transform: 'translateX(0)' },
    { hpa: 980, left: 30, transform: 'translateX(-50%)' },
    { hpa: 1020, left: 70, transform: 'translateX(-50%)' },
    { hpa: 1050, left: 100, transform: 'translateX(-100%)' },
  ];

  // 3-hour pressure tendency — the number meteorologists actually watch for incoming weather,
  // since a fast drop is a reliable short-term storm signal even before the absolute level
  // looks low. Falls back to a shorter window near the very start of the fetched hourly data;
  // at hour zero exactly there's no prior data at all (we don't have yesterday's hours), so we
  // show an explicit "unavailable" note rather than silently hiding the whole line — otherwise
  // this header changes shape for ~1 hour a day depending on time of day, which reads as a bug.
  const pressureTrendHours = Math.min(3, nowIndex);
  const pressureTrendChange =
    pressureTrendHours > 0 ? current.surface_pressure - hourly.surface_pressure[nowIndex - pressureTrendHours] : null;
  let pressureTrendLabel = 'Trend unavailable yet';
  let pressureTrendColor = 'var(--text-secondary)';
  if (pressureTrendChange != null) {
    const sign = pressureTrendChange > 0 ? '+' : '';
    const detail = `<span class="pressure-trend-detail">(${sign}${pressureTrendChange.toFixed(1)} hPa/${pressureTrendHours}h)</span>`;
    if (pressureTrendChange > 1) {
      pressureTrendLabel = `↑ Rising ${detail}`;
      pressureTrendColor = 'var(--scale-good)';
    } else if (pressureTrendChange < -1) {
      pressureTrendLabel = `↓ Falling ${detail}`;
      pressureTrendColor = 'var(--scale-high)';
    } else {
      pressureTrendLabel = `→ Steady ${detail}`;
    }
  }

  return `
    <div class="detail-card">
      <div class="label">💨 Wind <span class="wind-dir-arrow" style="transform: rotate(${current.wind_direction_10m}deg)">↑</span> ${windDir}</div>
      <div class="wind-bar-wrap">
        <div class="wind-bar">
          <span class="wind-segment wind-segment-blue"></span>
          <span class="wind-segment wind-segment-green"></span>
          <span class="wind-segment wind-segment-yellow"></span>
          <span class="wind-segment wind-segment-red"></span>
          <span class="wind-segment wind-segment-purple"></span>
          <span class="wind-segment wind-segment-maroon"></span>
        </div>
        <div class="wind-marker" style="left: ${windPercent.toFixed(1)}%">
          <span class="wind-marker-value" style="transform: ${markerAnchor(windPercent)}">${convertWindSpeedMs(current.wind_speed_10m).toFixed(1)} ${windSpeedUnitLabel()} <span class="wind-marker-value-secondary">(${windKmh} km/h)</span></span>
        </div>
      </div>
      <div class="sub">${getBeaufortDescription(windKmh)}</div>
    </div>
    <div class="detail-card">
      <div class="label">🔆 UV index</div>
      <div class="uv-bar-wrap">
        <div class="uv-bar">
          <span class="uv-segment uv-segment-green"></span>
          <span class="uv-segment uv-segment-yellow"></span>
          <span class="uv-segment uv-segment-orange"></span>
          <span class="uv-segment uv-segment-red"></span>
          <span class="uv-segment uv-segment-violet"></span>
        </div>
        ${uvPercent != null ? `<div class="uv-marker" style="left: ${uvPercent.toFixed(1)}%">
          <span class="uv-marker-value" style="transform: ${markerAnchor(uvPercent)}">${uv}</span>
        </div>` : ''}
      </div>
      <div class="sub">${getUvLabel(uv)}</div>
    </div>
    <div class="detail-card">
      <div class="label">🍃 Air quality</div>
      <div class="aqi-bar-wrap">
        <div class="aqi-bar">
          <span class="aqi-segment aqi-segment-blue"></span>
          <span class="aqi-segment aqi-segment-green"></span>
          <span class="aqi-segment aqi-segment-yellow"></span>
          <span class="aqi-segment aqi-segment-red"></span>
          <span class="aqi-segment aqi-segment-purple"></span>
          <span class="aqi-segment aqi-segment-maroon"></span>
        </div>
        ${aqiPercent != null ? `<div class="aqi-marker" style="left: ${aqiPercent.toFixed(1)}%">
          <span class="aqi-marker-value" style="transform: ${markerAnchor(aqiPercent)}">${aqi}</span>
        </div>` : ''}
      </div>
      <div class="sub">${getAqiLabel(aqi)}</div>
    </div>
    <div class="detail-card">
      <div class="label">💧 Humidity</div>
      <div class="humidity-bar-wrap">
        <div class="humidity-bar">
          <span class="humidity-segment humidity-segment-blue"></span>
          <span class="humidity-segment humidity-segment-green"></span>
          <span class="humidity-segment humidity-segment-yellow"></span>
          <span class="humidity-segment humidity-segment-red"></span>
          <span class="humidity-segment humidity-segment-purple"></span>
        </div>
        ${humidityPercent != null ? `<div class="humidity-marker" style="left: ${humidityPercent.toFixed(1)}%">
          <span class="humidity-marker-value" style="transform: ${markerAnchor(humidityPercent)}">${current.relative_humidity_2m}%</span>
        </div>` : ''}
      </div>
      <div class="sub">${getHumidityLabel(current.relative_humidity_2m)}</div>
    </div>
    <div class="detail-card detail-card-wide">
      <div class="label pressure-trend-label">
        <span>📊 Pressure</span>
        <span class="pressure-trend-indicator" style="color: ${pressureTrendColor}">${pressureTrendLabel}</span>
      </div>
      <div class="pressure-bar-wrap">
        <div class="pressure-bar">
          <span class="pressure-segment pressure-segment-red"></span>
          <span class="pressure-segment pressure-segment-yellow"></span>
          <span class="pressure-segment pressure-segment-green"></span>
        </div>
        <div class="pressure-marker" style="left: ${pressurePercent.toFixed(1)}%">
          <span class="pressure-marker-value" style="transform: ${markerAnchor(pressurePercent)}">${pressureValueLabel} <span class="pressure-unit-secondary">${pressureSecondaryLabel}</span></span>
        </div>
        <div class="pressure-scale">
          ${pressureScalePoints
            .map(
              (p) =>
                `<span class="pressure-scale-tick" style="left: ${p.left}%; transform: ${p.transform}">${unitSystem === 'imperial' ? Math.round(convertPressureHpa(p.hpa)) : p.hpa}</span>`
            )
            .join('')}
        </div>
      </div>
      <div class="pressure-legend">
        <div class="pressure-legend-item">
          <div class="pressure-legend-main">Stormy/Rainy</div>
          <div class="pressure-legend-sub">(Low Pressure)</div>
        </div>
        <div class="pressure-legend-item">
          <div class="pressure-legend-main">Variable</div>
          <div class="pressure-legend-sub">(Normal Pressure)</div>
        </div>
        <div class="pressure-legend-item">
          <div class="pressure-legend-main">Fair/Sunny</div>
          <div class="pressure-legend-sub">(High Pressure)</div>
        </div>
      </div>
    </div>
  `;
}

// Simplified solar position (azimuth/elevation), mirroring getMoonAzimuthElevation below —
// same low-precision approach (a couple of periodic correction terms for the ecliptic
// longitude, the sun's ecliptic latitude is ~0 so no correction needed there), same final
// RA/Dec -> sidereal time -> hour angle -> horizontal-coordinate steps. Accurate to well under
// a tenth of a degree, more than enough for a compass/elevation reading.
function getSunAzimuthElevation(date, latDeg, lonDeg) {
  const RAD = Math.PI / 180;
  const DEG = 180 / Math.PI;
  const normalizeDeg = (deg) => ((deg % 360) + 360) % 360;

  const julianDate = date.getTime() / 86400000 + 2440587.5;
  const daysSinceJ2000 = julianDate - 2451545.0;

  const meanLongitude = normalizeDeg(280.46 + 0.9856474 * daysSinceJ2000);
  const meanAnomaly = normalizeDeg(357.528 + 0.9856003 * daysSinceJ2000);

  const eclipticLon = normalizeDeg(
    meanLongitude + 1.915 * Math.sin(meanAnomaly * RAD) + 0.02 * Math.sin(2 * meanAnomaly * RAD)
  );

  const obliquity = 23.4397 * RAD;
  const lonRad = eclipticLon * RAD;

  const rightAscension = Math.atan2(Math.cos(obliquity) * Math.sin(lonRad), Math.cos(lonRad));
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(lonRad));

  const gmst = normalizeDeg(280.46061837 + 360.98564736629 * daysSinceJ2000);
  const localSiderealTime = normalizeDeg(gmst + lonDeg);
  const hourAngle = normalizeDeg(localSiderealTime - rightAscension * DEG) * RAD;

  const observerLat = latDeg * RAD;
  const elevation = Math.asin(
    Math.sin(observerLat) * Math.sin(declination) + Math.cos(observerLat) * Math.cos(declination) * Math.cos(hourAngle)
  );
  const azimuthFromSouth = Math.atan2(
    Math.sin(hourAngle),
    Math.cos(hourAngle) * Math.sin(observerLat) - Math.tan(declination) * Math.cos(observerLat)
  );
  const azimuthDeg = normalizeDeg(azimuthFromSouth * DEG + 180);

  return { azimuthDeg, elevationDeg: elevation * DEG };
}

// Draws a day arc between sunrise and sunset, with the sunrise/sunset times shown as large
// labels flanking it, tick marks at its base, and a dashed horizon line running the full
// width behind everything. The sun marker's (x,y) is computed with the same ellipse math
// used for the arc's "A" path command, so it always sits exactly on the drawn curve.
function buildSunPath(daily, currentTimeIso, latitude, longitude) {
  const sunriseIso = daily.sunrise[0];
  const sunsetIso = daily.sunset[0];

  if (!sunriseIso || !sunsetIso) {
    return '<p class="sun-arc-unavailable">Sunrise/sunset data unavailable for this location.</p>';
  }

  const sunriseDate = new Date(sunriseIso);
  const sunsetDate = new Date(sunsetIso);
  const now = new Date(currentTimeIso);

  const dayMs = sunsetDate - sunriseDate;
  refineDayLengthTrend(latitude, longitude, dayMs);
  const elapsedMs = now - sunriseDate;
  // Sun position along the arc; before sunrise/after sunset it's pinned to the sunrise/sunset
  // tick rather than continuing past it (we have no data for a night-side path).
  const t = Math.max(0, Math.min(1, dayMs > 0 ? elapsedMs / dayMs : 0));

  // Arc geometry, in SVG user units.
  const leftX = 4;
  const rightX = 336;
  const dayLeftX = 80; // sunrise tick
  const dayRightX = 260; // sunset tick
  const baselineY = 85;
  const dayRy = 65; // dome height
  const dayRx = (dayRightX - dayLeftX) / 2; // 90
  const dayCx = (dayLeftX + dayRightX) / 2; // 170

  // Point on the arc at progress t (0 = sunrise/left, 1 = sunset/right).
  const angle = Math.PI - t * Math.PI;
  const sunX = (dayCx + dayRx * Math.cos(angle)).toFixed(1);
  const sunY = (baselineY - dayRy * Math.sin(angle)).toFixed(1);

  const durationMin = Math.max(0, Math.round(dayMs / 60000));
  const durationLabel = `${Math.floor(durationMin / 60)}h ${durationMin % 60}m`;
  const sunriseLabel = formatTime(sunriseIso);
  const sunsetLabel = formatTime(sunsetIso);

  const sunriseAzimuth = getSunAzimuthElevation(sunriseDate, latitude, longitude).azimuthDeg;
  const sunsetAzimuth = getSunAzimuthElevation(sunsetDate, latitude, longitude).azimuthDeg;
  const sunriseDirection = `${Math.round(sunriseAzimuth)}&deg; (${degToCompass(sunriseAzimuth)})`;
  const sunsetDirection = `${Math.round(sunsetAzimuth)}&deg; (${degToCompass(sunsetAzimuth)})`;

  const { azimuthDeg, elevationDeg } = getSunAzimuthElevation(now, latitude, longitude);
  const horizonCompass = `🧭 ${Math.round(azimuthDeg)}&deg; (${degToCompass(azimuthDeg)})`;
  const horizonElevation = `${Math.round(Math.abs(elevationDeg))}° ${elevationDeg >= 0 ? 'above' : 'below'} Horizon`;

  // Outside daylight hours, "remaining daylight" doesn't apply — show a countdown to the next
  // sunrise instead (today's if we're still before dawn, otherwise tomorrow's, which `daily`
  // already has since it covers the full 10-day forecast, not just today).
  let bottomLabel;
  let bottomValue;

  if (now < sunriseDate || now > sunsetDate) {
    const nextSunriseIso = now < sunriseDate ? sunriseIso : daily.sunrise[1];
    const untilSunriseMin = nextSunriseIso ? Math.max(0, Math.round((new Date(nextSunriseIso) - now) / 60000)) : 0;
    bottomLabel = 'Daytime in';
    bottomValue = `${Math.floor(untilSunriseMin / 60)}h ${untilSunriseMin % 60}m`;
  } else {
    const remainingMin = Math.max(0, Math.round((dayMs * (1 - t)) / 60000));
    bottomLabel = 'Remaining daylight';
    bottomValue = `${Math.floor(remainingMin / 60)}h ${remainingMin % 60}m`;
  }

  return `
    <div class="sun-arc-caption">
      <span class="sun-arc-caption-label">Length of day</span>
      <span class="sun-arc-caption-value-wrap">
        <span class="sun-arc-caption-value">${durationLabel}<span class="day-length-trend" id="day-length-trend"></span></span>
      </span>
    </div>
    <svg class="sun-arc" viewBox="0 2 340 90" preserveAspectRatio="xMidYMid meet" role="img"
         aria-label="Sun position: ${durationLabel} of daytime, ${bottomLabel.toLowerCase()} ${bottomValue}, sunrise ${sunriseLabel}, sunset ${sunsetLabel}">
      <line class="sun-arc-baseline" x1="${leftX}" y1="${baselineY}" x2="${rightX}" y2="${baselineY}" />
      <path class="sun-arc-elapsed" d="M ${dayLeftX},${baselineY} A ${dayRx},${dayRy} 0 0,1 ${sunX},${sunY}" />
      <path class="sun-arc-remaining" d="M ${sunX},${sunY} A ${dayRx},${dayRy} 0 0,1 ${dayRightX},${baselineY}" />
      <line class="sun-arc-tick" x1="${dayLeftX}" y1="${baselineY - 6}" x2="${dayLeftX}" y2="${baselineY + 6}" />
      <line class="sun-arc-tick" x1="${dayRightX}" y1="${baselineY - 6}" x2="${dayRightX}" y2="${baselineY + 6}" />
      <circle class="sun-arc-glow" cx="${sunX}" cy="${sunY}" r="14" />
      <circle class="sun-arc-marker" cx="${sunX}" cy="${sunY}" r="7" />
      <text class="sun-arc-side-label" x="${leftX}" y="${baselineY - 37}">Sunrise</text>
      <text class="sun-arc-side-direction" x="${leftX}" y="${baselineY - 26}">${sunriseDirection}</text>
      <text class="sun-arc-side-value" x="${leftX}" y="${baselineY - 6}">${sunriseLabel}</text>
      <text class="sun-arc-side-label" x="${rightX}" y="${baselineY - 37}" text-anchor="end">Sunset</text>
      <text class="sun-arc-side-direction" x="${rightX}" y="${baselineY - 26}" text-anchor="end">${sunsetDirection}</text>
      <text class="sun-arc-side-value" x="${rightX}" y="${baselineY - 6}" text-anchor="end">${sunsetLabel}</text>
      <text class="sun-arc-horizon-compass" x="${dayCx}" y="${baselineY - 17}" text-anchor="middle">${horizonCompass}</text>
      <text class="sun-arc-horizon-label" x="${dayCx}" y="${baselineY - 4}" text-anchor="middle">${horizonElevation}</text>
    </svg>
    ${buildGoldenBlueHour(sunriseDate, sunsetDate)}
    <div class="sun-arc-caption">
      <span class="sun-arc-caption-label">${bottomLabel}</span>
      <span class="sun-arc-caption-value">${bottomValue}</span>
    </div>
  `;
}

// Golden/blue hour windows, approximated with fixed offsets from sunrise/sunset rather than
// true solar-elevation math (would need a library — see the no-dependencies rule). Blue hour
// sits fully on the night side of sunrise/sunset, golden hour fully on the day side, so the
// transition point can just be sunrise/sunset itself rather than an invented buffer.
function buildGoldenBlueHour(sunriseDate, sunsetDate) {
  const morningBlueStart = new Date(sunriseDate.getTime() - 30 * 60000);
  const morningGoldenEnd = new Date(sunriseDate.getTime() + 60 * 60000);
  const eveningGoldenStart = new Date(sunsetDate.getTime() - 60 * 60000);
  const eveningBlueEnd = new Date(sunsetDate.getTime() + 30 * 60000);

  return `
    <div class="golden-hour-section">
      <div class="golden-hour-col">
        <div class="golden-hour-row">🔵 ${formatTime(morningBlueStart)}-${formatTime(sunriseDate)} 🌅</div>
        <div class="golden-hour-row">🟡 ${formatTime(sunriseDate)}-${formatTime(morningGoldenEnd)} ☀️</div>
      </div>
      <div class="golden-hour-divider">
        <span class="golden-hour-divider-compact">📷</span>
        <span class="golden-hour-divider-full">«📷Golden &amp; blue hours»</span>
      </div>
      <div class="golden-hour-col">
        <div class="golden-hour-row">🟡 ${formatTime(eveningGoldenStart)}-${formatTime(sunsetDate)} 🌇</div>
        <div class="golden-hour-row">🔵 ${formatTime(sunsetDate)}-${formatTime(eveningBlueEnd)} 🌙</div>
      </div>
    </div>
  `;
}

// Best-effort day-length trend badge next to the bottom sun-arc caption's bold value. Fetches
// yesterday's sunrise/sunset in an isolated request rather than widening the shared forecast
// fetch with past_days — same reasoning as refineMoonHorizonNote: every other feature (sun arc,
// 10-day list, etc.) assumes daily index 0 = today, and this keeps that assumption intact.
async function refineDayLengthTrend(latitude, longitude, todayDayMs) {
  try {
    const params = [
      `latitude=${latitude}`,
      `longitude=${longitude}`,
      `daily=sunrise,sunset`,
      `timezone=auto`,
      `past_days=1`,
      `forecast_days=1`,
    ].join('&');
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
    if (!response.ok) return;
    const data = await response.json();
    const yesterdaySunrise = data.daily.sunrise[0];
    const yesterdaySunset = data.daily.sunset[0];
    if (!yesterdaySunrise || !yesterdaySunset) return;

    const yesterdayDayMs = new Date(yesterdaySunset) - new Date(yesterdaySunrise);
    const diffSeconds = Math.round((todayDayMs - yesterdayDayMs) / 1000);
    const el = document.getElementById('day-length-trend');
    if (el) applyDayLengthTrend(el, diffSeconds);
  } catch {
    // Best-effort refinement only — leave the badge empty on failure.
  }
}

// Mirrors the pressure-trend indicator's arrow + colored delta styling ("↑ Rising (+2.1 hPa/3h)").
function applyDayLengthTrend(el, diffSeconds) {
  const absSeconds = Math.abs(diffSeconds);
  const minutes = Math.floor(absSeconds / 60);
  const seconds = absSeconds % 60;

  let arrow;
  let word;
  let color;
  let bracket = '';
  if (absSeconds < 10) {
    arrow = '→';
    word = 'Steady';
    color = 'var(--text-secondary)';
  } else if (diffSeconds > 0) {
    arrow = '↑';
    word = 'Longer';
    color = 'var(--daylength-longer)';
    bracket = ` (+${minutes}m ${seconds}s)`;
  } else {
    arrow = '↓';
    word = 'Shorter';
    color = 'var(--daylength-shorter)';
    bracket = ` (-${minutes}m ${seconds}s)`;
  }

  el.innerHTML = `${arrow} <strong>${word}</strong>${bracket}`;
  el.style.color = color;
  el.title = absSeconds < 10 ? 'Same length as yesterday' : `${minutes}m ${seconds}s ${word.toLowerCase()} than yesterday`;
}

// Buckets Open-Meteo's 0-1 moon_phase fraction into the 8 traditional phase names, each
// centered on its exact fraction (0/0.25/0.5/0.75/1 = New/First Quarter/Full/Last Quarter/New)
// with a 1/8-wide band around it.
function getMoonPhaseInfo(phase) {
  const p = ((phase % 1) + 1) % 1;
  if (p < 0.0625 || p >= 0.9375) return { label: 'New Moon', local: 'Uusikuu', icon: '🌑' };
  if (p < 0.1875) return { label: 'Waxing Crescent', local: 'Kasvava sirppi', icon: '🌒' };
  if (p < 0.3125) return { label: 'First Quarter', local: 'Ensimmäinen neljännes', icon: '🌓' };
  if (p < 0.4375) return { label: 'Waxing Gibbous', local: 'Kasvava kupera kuu', icon: '🌔' };
  if (p < 0.5625) return { label: 'Full Moon', local: 'Täysikuu', icon: '🌕' };
  if (p < 0.6875) return { label: 'Waning Gibbous', local: 'Vähenevä kupera kuu', icon: '🌖' };
  if (p < 0.8125) return { label: 'Last Quarter', local: 'Viimeinen neljännes', icon: '🌗' };
  return { label: 'Waning Crescent', local: 'Vähenevä sirppi', icon: '🌘' };
}

// Static, ordered to match getMoonPhaseInfo's icon/label output — used only to render the
// 8-icon row below; the actual phase bucketing logic lives solely in getMoonPhaseInfo so
// there's one source of truth for which icon a given phase fraction maps to.
// New Moon is listed at both ends (index 0 and 8) so the row reads as one full cycle, start
// to finish, rather than looking like it just stops after Waning Crescent.
const MOON_PHASES = [
  { label: 'New Moon', icon: '🌑' },
  { label: 'Waxing Crescent', icon: '🌒' },
  { label: 'First Quarter', icon: '🌓' },
  { label: 'Waxing Gibbous', icon: '🌔' },
  { label: 'Full Moon', icon: '🌕' },
  { label: 'Waning Gibbous', icon: '🌖' },
  { label: 'Last Quarter', icon: '🌗' },
  { label: 'Waning Crescent', icon: '🌘' },
  { label: 'New Moon', icon: '🌑' },
];

// Mirrors getMoonPhaseInfo's own boundaries exactly (that function stays the single source of
// truth for the bucketing), but returns a 0-8 row index instead of a label/icon — needed because
// New Moon now appears at both ends of the row (0 and 8), so matching by icon/label alone can't
// tell which end of the cycle a New Moon reading belongs to. Without this, the indicator would
// always snap back to index 0, never reaching the rightmost icon, breaking the requirement that
// it travels all the way right before jumping back to the start of the next cycle.
function getMoonPhaseRowIndex(phase) {
  const p = ((phase % 1) + 1) % 1;
  if (p < 0.0625) return 0;
  if (p < 0.1875) return 1;
  if (p < 0.3125) return 2;
  if (p < 0.4375) return 3;
  if (p < 0.5625) return 4;
  if (p < 0.6875) return 5;
  if (p < 0.8125) return 6;
  if (p < 0.9375) return 7;
  return 8;
}

// Independent from buildMoonPath/the Moonrise & moonset card on purpose — a separate section
// so it can be iterated on without risking that already-working card.
// Average length of a lunar cycle (new moon to new moon), in days. The real synodic month
// varies by roughly ±0.3 days from this due to the moon's elliptical orbit, so dates computed
// from it drift a little across the row — fine for a labeled calendar reference, not precise
// enough for anything time-critical.
const SYNODIC_MONTH_DAYS = 29.530588853;

function buildMoonPhaseSection(daily) {
  const phase = daily.moon_phase[0];
  if (phase == null) {
    return '<p class="moon-phase-section-unavailable">Moon phase unavailable for this location.</p>';
  }

  const phaseInfo = getMoonPhaseInfo(phase);
  const currentIndex = getMoonPhaseRowIndex(phase);
  // Raw phase fraction, not the bucket index — the two New Moon buckets are half-width
  // (6.25% each) and the other seven are exactly 12.5%, matching the icon row's even spacing,
  // so this lands the indicator continuously within the current icon's slot instead of
  // snapping between 9 fixed stops, while the highlighted icon still comes from the bucket.
  const normalizedPhase = ((phase % 1) + 1) % 1;
  const indicatorPercent = normalizedPhase * 100;

  // Illuminated fraction from the phase angle: 0 at New Moon, 100 at Full Moon, back to 0 at
  // the next New Moon — the standard (1 - cos(2π·phase)) / 2 approximation.
  const illumination = ((1 - Math.cos(2 * Math.PI * normalizedPhase)) / 2) * 100;

  // Calendar date for each of the 9 row icons, derived from today's phase position rather than
  // fetched — the row spans one full cycle, and daily.moon_phase only covers the 10-day forecast
  // window, which won't reach both the most recent New Moon and the next one in most cases.
  const today = new Date(daily.time[0]);
  const daysSinceCycleStart = normalizedPhase * SYNODIC_MONTH_DAYS;
  const cycleStartMs = today.getTime() - daysSinceCycleStart * 86400000;

  const icons = MOON_PHASES.map(
    (p, i) => `
    <div class="moon-phase-icon${i === currentIndex ? ' moon-phase-icon-current' : ''}">${p.icon}</div>
  `
  ).join('');
  const dates = MOON_PHASES.map((p, i) => {
    const iconDate = new Date(cycleStartMs + (i / 8) * SYNODIC_MONTH_DAYS * 86400000);
    return `<div class="moon-phase-date">${formatDDMMDot(iconDate)}</div>`;
  }).join('');

  return `
    <div class="moon-phase-label">${phaseInfo.label}</div>
    <div class="moon-phase-label-local">(${phaseInfo.local})</div>
    <div class="moon-phase-row-wrap">
      <div class="moon-phase-indicator" style="left: ${indicatorPercent.toFixed(1)}%; transform: ${markerAnchor(indicatorPercent)}"><span class="moon-phase-illumination ${normalizedPhase < 0.5 ? 'moon-phase-illumination-right' : 'moon-phase-illumination-left'}">${illumination.toFixed(1)}%</span>▼</div>
      <div class="moon-phase-row">${icons}</div>
    </div>
    <div class="moon-phase-dates">${dates}</div>
    <div class="moon-phase-endpoints">
      <span>New Moon</span>
      <span class="moon-phase-endpoint-center">Full Moon</span>
      <span>Old Moon</span>
    </div>
  `;
}

// Builds a chronological {time, type: 'rise'|'set'} event list from parallel moonrise/moonset
// arrays (as returned by Open-Meteo's daily block), skipping the null entries that mark days
// where the moon doesn't cross the horizon at all.
function collectMoonEvents(moonriseArr, moonsetArr) {
  const events = [];
  for (let i = 0; i < moonriseArr.length; i++) {
    if (moonriseArr[i]) events.push({ time: new Date(moonriseArr[i]), type: 'rise' });
    if (moonsetArr[i]) events.push({ time: new Date(moonsetArr[i]), type: 'set' });
  }
  events.sort((a, b) => a.time - b.time);
  return events;
}

// Infers whether the moon is currently up or down from a sorted event list: it's up if the
// most recent event before `now` was a rise, or — if the event list has nothing before `now`
// in range — if the next event after `now` is a set (a set can only happen if it's already up).
// Returns null if the event list has no events on either side (window too short to tell).
function inferMoonState(events, now) {
  let prevEvent = null;
  let nextEvent = null;
  for (const event of events) {
    if (event.time <= now) prevEvent = event;
    else if (!nextEvent) nextEvent = event;
  }
  if (prevEvent) return prevEvent.type === 'rise' ? 'up' : 'down';
  if (nextEvent) return nextEvent.type === 'set' ? 'up' : 'down';
  return null;
}

function moonHorizonNote(state) {
  return state === 'up'
    ? 'The moon is above the horizon all day today — no rise or set at this latitude right now.'
    : 'The moon is below the horizon all day today — no rise or set at this latitude right now.';
}

// Only reached when even the already-fetched 10-day forward window has no rise/set event to
// infer from (an unusually long circumpolar stretch) — fetches a wider backward+forward window
// scoped to just this lookup, and patches the placeholder note in place once it resolves. Kept
// as a separate best-effort request rather than widening the shared forecast fetch, so it can't
// affect any other feature's day-indexing (sun arc, 10-day list, etc. all assume index 0 = today).
async function refineMoonHorizonNote(latitude, longitude, currentTimeIso) {
  try {
    const params = [
      `latitude=${latitude}`,
      `longitude=${longitude}`,
      `daily=moonrise,moonset`,
      `timezone=auto`,
      `past_days=14`,
      `forecast_days=14`,
    ].join('&');
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
    if (!response.ok) return;
    const data = await response.json();
    const events = collectMoonEvents(data.daily.moonrise, data.daily.moonset);
    const state = inferMoonState(events, new Date(currentTimeIso));
    const noteEl = document.getElementById('moon-horizon-note');
    if (noteEl && state) noteEl.textContent = moonHorizonNote(state);
  } catch {
    // Best-effort refinement only — leave the generic placeholder in place on failure.
  }
}

// Draws a moon arc between moonrise and moonset, mirroring buildSunPath's geometry and
// before/after fallback logic, but as a fully separate function/markup/CSS namespace so the
// sun card is untouched.
// Simplified lunar position (azimuth/elevation) for a given time and observer location — no
// fetch, no library. Uses only the single largest periodic correction term for the Moon's
// ecliptic longitude/latitude (Meeus's low-precision approximation, good to within roughly a
// third of a degree), which is plenty for a "which way to look" compass reading. Validated
// against this same day's Open-Meteo moonrise/moonset: plugging those exact times in yields an
// elevation of ~0 degrees, confirming the two independent calculations agree.
function getMoonAzimuthElevation(date, latDeg, lonDeg) {
  const RAD = Math.PI / 180;
  const DEG = 180 / Math.PI;
  const normalizeDeg = (deg) => ((deg % 360) + 360) % 360;

  const julianDate = date.getTime() / 86400000 + 2440587.5;
  const daysSinceJ2000 = julianDate - 2451545.0;

  const meanLongitude = normalizeDeg(218.316 + 13.176396 * daysSinceJ2000);
  const meanAnomaly = normalizeDeg(134.963 + 13.064993 * daysSinceJ2000);
  const argOfLatitude = normalizeDeg(93.272 + 13.22935 * daysSinceJ2000);

  const eclipticLon = meanLongitude + 6.289 * Math.sin(meanAnomaly * RAD);
  const eclipticLat = 5.128 * Math.sin(argOfLatitude * RAD);

  const obliquity = 23.4397 * RAD;
  const lonRad = eclipticLon * RAD;
  const latRad = eclipticLat * RAD;

  const rightAscension = Math.atan2(
    Math.sin(lonRad) * Math.cos(obliquity) - Math.tan(latRad) * Math.sin(obliquity),
    Math.cos(lonRad)
  );
  const declination = Math.asin(
    Math.sin(latRad) * Math.cos(obliquity) + Math.cos(latRad) * Math.sin(obliquity) * Math.sin(lonRad)
  );

  const gmst = normalizeDeg(280.46061837 + 360.98564736629 * daysSinceJ2000);
  const localSiderealTime = normalizeDeg(gmst + lonDeg);
  const hourAngle = normalizeDeg(localSiderealTime - rightAscension * DEG) * RAD;

  const observerLat = latDeg * RAD;
  const elevation = Math.asin(
    Math.sin(observerLat) * Math.sin(declination) + Math.cos(observerLat) * Math.cos(declination) * Math.cos(hourAngle)
  );
  // Standard formula gives azimuth from South, clockwise; +180 converts to compass (from North).
  const azimuthFromSouth = Math.atan2(
    Math.sin(hourAngle),
    Math.cos(hourAngle) * Math.sin(observerLat) - Math.tan(declination) * Math.cos(observerLat)
  );
  const azimuthDeg = normalizeDeg(azimuthFromSouth * DEG + 180);

  return { azimuthDeg, elevationDeg: elevation * DEG };
}

function buildMoonPath(daily, currentTimeIso, latitude, longitude) {
  const moonriseIso = daily.moonrise[0];
  const moonsetIso = daily.moonset[0];
  const phase = daily.moon_phase[0];

  if (phase == null) {
    return '<p class="moon-arc-unavailable">Moon data unavailable for this location.</p>';
  }

  const phaseInfo = getMoonPhaseInfo(phase);

  // At high latitudes the moon can stay above or below the horizon for the whole local day
  // (the same effect as the midnight sun), so some days have no rise or set to draw an arc
  // for — but the phase itself is still known, so show that instead of hiding everything.
  if (!moonriseIso || !moonsetIso) {
    const now = new Date(currentTimeIso);
    const state = inferMoonState(collectMoonEvents(daily.moonrise, daily.moonset), now);

    if (state == null) refineMoonHorizonNote(latitude, longitude, currentTimeIso);

    const note = state ? moonHorizonNote(state) : 'Checking whether the moon is above or below the horizon…';

    return `
      <p class="moon-arc-unavailable" id="moon-horizon-note">${note}</p>
    `;
  }

  const moonriseDate = new Date(moonriseIso);
  let moonsetDate = new Date(moonsetIso);
  const now = new Date(currentTimeIso);

  // Some days the moon sets early — the tail of the previous night's rise — and then rises
  // again later that same day, so today's own moonset[0] falls BEFORE moonrise[0]
  // chronologically. If we're already past that second rise, moonset[0] is stale (it belongs
  // to the period that already ended); the real end of the current up-period is tomorrow's
  // moonset.
  if (moonsetDate <= moonriseDate && now >= moonriseDate && daily.moonset[1]) {
    moonsetDate = new Date(daily.moonset[1]);
  }

  // Mirror case: still up from a rise that happened before the fetched window (e.g. last
  // night), so today's early moonset is real but has no matching moonrise in `daily.moonrise`
  // to pair it with. Confirm via the same event-based inference used for the circumpolar case.
  // Pinning the marker at the moonset tick (the sun's before-sunrise/after-sunset convention)
  // doesn't fit here — the sun's case is pinned because it genuinely hasn't started or has
  // already finished its arc, but the moon here is actively mid-arc, so sitting it right at the
  // moonset tick falsely reads as "setting right now." Instead, substitute an estimated rise
  // time using the moon's average time above the horizon (~12h25m, roughly half its 24h50m day)
  // so the marker lands at a plausible mid-arc position — this estimate never surfaces in any
  // displayed label, it only shapes where the dot sits.
  const AVERAGE_MOON_UP_MS = (12 * 60 + 25) * 60000;
  let forcedUp = false;
  let arcMoonriseDate = moonriseDate;
  if (moonsetDate <= moonriseDate && now < moonriseDate) {
    forcedUp = inferMoonState(collectMoonEvents(daily.moonrise, daily.moonset), now) === 'up';
    if (forcedUp) arcMoonriseDate = new Date(moonsetDate.getTime() - AVERAGE_MOON_UP_MS);
  }

  const upMs = moonsetDate - arcMoonriseDate;
  const elapsedMs = now - arcMoonriseDate;
  const t = Math.max(0, Math.min(1, upMs > 0 ? elapsedMs / upMs : 0));

  const leftX = 4;
  const rightX = 336;
  const arcLeftX = 80;
  const arcRightX = 260;
  const baselineY = 85;
  const arcRy = 65;
  const arcRx = (arcRightX - arcLeftX) / 2;
  const arcCx = (arcLeftX + arcRightX) / 2;

  const angle = Math.PI - t * Math.PI;
  const moonX = (arcCx + arcRx * Math.cos(angle)).toFixed(1);
  const moonY = (baselineY - arcRy * Math.sin(angle)).toFixed(1);

  const moonriseLabel = formatTime(moonriseIso);
  const moonsetLabel = formatTime(moonsetDate);

  const moonriseAzimuth = getMoonAzimuthElevation(moonriseDate, latitude, longitude).azimuthDeg;
  const moonsetAzimuth = getMoonAzimuthElevation(moonsetDate, latitude, longitude).azimuthDeg;
  const moonriseDirection = `${Math.round(moonriseAzimuth)}&deg; (${degToCompass(moonriseAzimuth)})`;
  const moonsetDirection = `${Math.round(moonsetAzimuth)}&deg; (${degToCompass(moonsetAzimuth)})`;

  const { azimuthDeg, elevationDeg } = getMoonAzimuthElevation(now, latitude, longitude);
  const horizonCompass = `🧭 ${Math.round(azimuthDeg)}&deg; (${degToCompass(azimuthDeg)})`;
  const horizonElevation = `${Math.round(Math.abs(elevationDeg))}° ${elevationDeg >= 0 ? 'above' : 'below'} Horizon`;

  let bottomLabel;
  let bottomValue;

  if (forcedUp) {
    const remainingMin = Math.max(0, Math.round((moonsetDate - now) / 60000));
    bottomLabel = 'Moonset in';
    bottomValue = `${Math.floor(remainingMin / 60)}h ${remainingMin % 60}m`;
  } else if (now < moonriseDate || now > moonsetDate) {
    const nextMoonriseIso = now < moonriseDate ? moonriseIso : daily.moonrise[1];
    const untilMoonriseMin = nextMoonriseIso ? Math.max(0, Math.round((new Date(nextMoonriseIso) - now) / 60000)) : 0;
    bottomLabel = 'Moonrise in';
    bottomValue = `${Math.floor(untilMoonriseMin / 60)}h ${untilMoonriseMin % 60}m`;
  } else {
    const remainingMin = Math.max(0, Math.round((upMs * (1 - t)) / 60000));
    bottomLabel = 'Moonset in';
    bottomValue = `${Math.floor(remainingMin / 60)}h ${remainingMin % 60}m`;
  }

  return `
    <div class="moon-arc-caption">
      <span class="moon-arc-caption-label">${bottomLabel}</span>
      <span class="moon-arc-caption-value">${bottomValue}</span>
    </div>
    <svg class="moon-arc" viewBox="0 2 340 98" preserveAspectRatio="xMidYMid meet" role="img"
         aria-label="Moon phase: ${phaseInfo.label}, ${bottomLabel.toLowerCase()} ${bottomValue}, moonrise ${moonriseLabel}, moonset ${moonsetLabel}">
      <line class="moon-arc-baseline" x1="${leftX}" y1="${baselineY}" x2="${rightX}" y2="${baselineY}" />
      <path class="moon-arc-elapsed" d="M ${arcLeftX},${baselineY} A ${arcRx},${arcRy} 0 0,1 ${moonX},${moonY}" />
      <path class="moon-arc-remaining" d="M ${moonX},${moonY} A ${arcRx},${arcRy} 0 0,1 ${arcRightX},${baselineY}" />
      <line class="moon-arc-tick" x1="${arcLeftX}" y1="${baselineY - 6}" x2="${arcLeftX}" y2="${baselineY + 6}" />
      <line class="moon-arc-tick" x1="${arcRightX}" y1="${baselineY - 6}" x2="${arcRightX}" y2="${baselineY + 6}" />
      <circle class="moon-arc-glow" cx="${moonX}" cy="${moonY}" r="14" />
      <circle class="moon-arc-marker" cx="${moonX}" cy="${moonY}" r="7" />
      <text class="moon-arc-side-label" x="${leftX}" y="${baselineY - 37}">Moonrise</text>
      <text class="moon-arc-side-direction" x="${leftX}" y="${baselineY - 26}">${moonriseDirection}</text>
      <text class="moon-arc-side-value" x="${leftX}" y="${baselineY - 6}">${moonriseLabel}</text>
      <text class="moon-arc-side-label" x="${rightX}" y="${baselineY - 37}" text-anchor="end">Moonset</text>
      <text class="moon-arc-side-direction" x="${rightX}" y="${baselineY - 26}" text-anchor="end">${moonsetDirection}</text>
      <text class="moon-arc-side-value" x="${rightX}" y="${baselineY - 6}" text-anchor="end">${moonsetLabel}</text>
      <text class="moon-arc-horizon-compass" x="${arcCx}" y="${baselineY - 17}" text-anchor="middle">${horizonCompass}</text>
      <text class="moon-arc-horizon-label" x="${arcCx}" y="${baselineY - 4}" text-anchor="middle">${horizonElevation}</text>
    </svg>
  `;
}

function buildDaily(daily) {
  let html = `
    <div class="daily-row daily-header">
      <div class="day">Date</div>
      <div class="icon">Weather</div>
      <div class="prob prob-header"><span class="prob-icon">🌧️</span>/<span class="prob-icon">🌨️</span></div>
      <div class="temps">Hi / Lo</div>
    </div>
  `;

  for (let i = 0; i < daily.time.length; i++) {
    const date = new Date(daily.time[i]);
    const label = `<span class="day-weekday">${
      i === 0 ? 'Today' : date.toLocaleDateString([], { weekday: 'short' })
    }</span><span class="day-date">${i === 0 ? formatDDMMYYYY(daily.time[i]) : formatDDMM(daily.time[i])}</span>`;
    const icon = getWeatherIcon(daily.weather_code[i], true);
    const condition = weatherDescriptions[daily.weather_code[i]] || '';
    const prob = daily.precipitation_probability_max[i];

    html += `
      <div class="daily-row">
        <div class="day">${label}</div>
        <div class="icon">
          <div>${icon}</div>
          <div class="daily-condition">${condition}</div>
        </div>
        <div class="prob">${prob != null ? prob + '%' : ''}</div>
        <div class="temps">${Math.round(convertTemp(daily.temperature_2m_max[i]))}&deg; / ${Math.round(convertTemp(daily.temperature_2m_min[i]))}&deg;</div>
      </div>
    `;
  }

  return html;
}

// current.time often includes real-world minutes (e.g. 14:23) while hourly.time entries
// are always on the hour (14:00), so an exact string match can miss — find the nearest one instead.
function getClosestHourIndex(hourlyTimes, currentTimeIso) {
  const currentDate = new Date(currentTimeIso);
  let closestIndex = 0;
  let smallestDiff = Infinity;

  for (let i = 0; i < hourlyTimes.length; i++) {
    const diff = Math.abs(new Date(hourlyTimes[i]) - currentDate);
    if (diff < smallestDiff) {
      smallestDiff = diff;
      closestIndex = i;
    }
  }

  return closestIndex;
}

// Unit conversion + label helpers. Bar-percent math and threshold logic (Beaufort, pollen
// buckets, etc.) elsewhere always stays computed from the canonical SI values fetched from
// the API — these only affect the final text shown to the user.
function convertTemp(celsius) {
  return unitSystem === 'imperial' ? (celsius * 9) / 5 + 32 : celsius;
}
function tempUnitLabel() {
  return unitSystem === 'imperial' ? 'F' : 'C';
}
function convertWindSpeedMs(ms) {
  return unitSystem === 'imperial' ? ms * 2.236936 : ms;
}
function windSpeedUnitLabel() {
  return unitSystem === 'imperial' ? 'mph' : 'm/s';
}
function convertPressureHpa(hpa) {
  return unitSystem === 'imperial' ? hpa * 0.02952998 : hpa;
}
function pressureUnitLabel() {
  return unitSystem === 'imperial' ? 'inHg' : 'hPa';
}
function convertPrecipMm(mm) {
  return unitSystem === 'imperial' ? mm / 25.4 : mm;
}
function precipUnitLabel() {
  return unitSystem === 'imperial' ? 'in' : 'mm';
}

// Inches are ~1/25th the magnitude of mm, so 1 decimal place loses far more resolution there —
// e.g. 0.1mm (a real, visible amount) rounds all the way down to 0.0in at 1 decimal.
function precipDecimals() {
  return unitSystem === 'imperial' ? 2 : 1;
}

function convertSnowCm(cm) {
  return unitSystem === 'imperial' ? cm / 2.54 : cm;
}
function snowUnitLabel() {
  return unitSystem === 'imperial' ? 'in' : 'cm';
}

function degToCompass(deg) {
  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const index = Math.round(deg / 22.5) % 16;
  return directions[index];
}

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatDDMM(iso) {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatDDMMYYYY(iso) {
  const d = new Date(iso);
  return `${formatDDMM(iso)}/${d.getFullYear()}`;
}

function formatDDMMDot(date) {
  return `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.`;
}

function formatWeekdayDateTime(iso) {
  const d = new Date(iso);
  const weekday = d.toLocaleDateString([], { weekday: 'short' });
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${weekday}, ${day}.${month}.${d.getFullYear()}, ${formatTime(iso)}`;
}

function getUvLabel(uv) {
  if (uv == null) return '';
  if (uv <= 2) return 'Low';
  if (uv <= 5) return 'Moderate';
  if (uv <= 7) return 'High';
  if (uv <= 10) return 'Very high';
  return 'Extreme';
}

function getAqiLabel(aqi) {
  if (aqi == null) return '';
  if (aqi <= 20) return 'Good';
  if (aqi <= 40) return 'Fair';
  if (aqi <= 60) return 'Moderate';
  if (aqi <= 80) return 'Poor';
  if (aqi <= 100) return 'Very poor';
  return 'Extremely poor';
}

function getHumidityLabel(humidity) {
  if (humidity == null) return '';
  if (humidity <= 30) return 'Dry';
  if (humidity <= 50) return 'Comfortable';
  if (humidity <= 65) return 'Tolerable';
  if (humidity <= 80) return 'Humid';
  return 'Oppressive';
}

// Beaufort wind force scale (0-12), thresholds in km/h per the Met Office reference table.
function getBeaufortDescription(kmh) {
  if (kmh == null) return '';
  if (kmh < 1) return 'Calm';
  if (kmh < 6) return 'Light air';
  if (kmh < 12) return 'Light breeze';
  if (kmh < 20) return 'Gentle breeze';
  if (kmh < 29) return 'Moderate breeze';
  if (kmh < 39) return 'Fresh breeze';
  if (kmh < 50) return 'Strong breeze';
  if (kmh < 62) return 'Near gale';
  if (kmh < 75) return 'Gale';
  if (kmh < 89) return 'Strong gale';
  if (kmh < 103) return 'Storm';
  if (kmh < 118) return 'Violent storm';
  return 'Hurricane';
}

// Absolute None/Present/Elevated/Peak thresholds (grains/m³), per species. Tree pollens
// (alder, birch, olive, mugwort) share one scale; grass and ragweed share a lower one.
// Ordered by standard annual pollen cycle: alder/birch (early spring) -> olive (spring) ->
// grass (late spring-summer) -> mugwort -> ragweed (late summer-autumn).
// activeStart/activeEnd are rendered stacked (start above end) rather than as one
// "Start – End" string, since the combined string is too wide to fit a narrow mobile column
// without wrapping mid-word.
const POLLEN_SPECIES = [
  { key: 'alder_pollen', name: 'Alder', local: 'Leppä', seasonStart: 10, peak: 100, activeStart: 'Jan', activeEnd: 'Mar' },
  { key: 'birch_pollen', name: 'Birch', local: 'Koivu', seasonStart: 10, peak: 100, activeStart: 'Mar', activeEnd: 'May' },
  { key: 'olive_pollen', name: 'Olive', local: 'Oliivi', seasonStart: 10, peak: 100, activeStart: 'Apr', activeEnd: 'Jun' },
  { key: 'grass_pollen', name: 'Grass', local: 'Heinä', seasonStart: 3, peak: 50, activeStart: 'May', activeEnd: 'Jul' },
  { key: 'mugwort_pollen', name: 'Mugwort', local: 'Pujo', seasonStart: 10, peak: 100, activeStart: 'Jul', activeEnd: 'Aug' },
  { key: 'ragweed_pollen', name: 'Ragweed', local: 'Ambrosia', seasonStart: 3, peak: 50, activeStart: 'Aug', activeEnd: 'Nov' },
];

function getPollenCategory(value, seasonStart, peak) {
  if (value <= 0) return { label: 'None', color: 'var(--text-muted)' };
  if (value < seasonStart) return { label: 'Present', color: 'var(--precip)' };
  if (value < peak) return { label: 'Elevated', color: 'var(--scale-elevated)' };
  return { label: 'Peak', color: 'var(--scale-high)' };
}

function buildPollenForecast(air) {
  const hasData = air && POLLEN_SPECIES.some((species) => air[species.key] != null);
  if (!hasData) {
    return '<p class="pollen-placeholder">Pollen data isn\'t available for this location (coverage is currently Europe-only).</p>';
  }

  const columns = POLLEN_SPECIES.map((species) => {
    const value = air[species.key];

    if (value == null) {
      return `
        <div class="pollen-col">
          <div class="pollen-value">--</div>
          <div class="pollen-bar-track"></div>
          <div class="pollen-category">N/A</div>
          <div class="pollen-active-window">
            <div>${species.activeStart}</div>
            <div>${species.activeEnd}</div>
          </div>
          <div class="pollen-name">${species.name}</div>
          <div class="pollen-name-local">(${species.local})</div>
        </div>
      `;
    }

    const category = getPollenCategory(value, species.seasonStart, species.peak);
    const fillPercent = Math.min(100, (value / species.peak) * 100);
    const tickPercent = (species.seasonStart / species.peak) * 100;

    return `
      <div class="pollen-col">
        <div class="pollen-scale-peak">${species.peak}</div>
        <div class="pollen-bar-wrap">
          <div class="pollen-bar-track">
            <div class="pollen-bar-fill" style="height: ${fillPercent.toFixed(1)}%; background: ${category.color};"></div>
          </div>
          <div class="pollen-tick" style="bottom: ${tickPercent.toFixed(1)}%;"></div>
          <div class="pollen-scale-tick" style="bottom: ${tickPercent.toFixed(1)}%;">${species.seasonStart}</div>
        </div>
        <div class="pollen-value">${value.toFixed(1)}</div>
        <div class="pollen-category" style="color: ${category.color};">${category.label}</div>
        <div class="pollen-active-window">
          <div>${species.activeStart}</div>
          <div>${species.activeEnd}</div>
        </div>
        <div class="pollen-name">${species.name}</div>
        <div class="pollen-name-local">(${species.local})</div>
      </div>
    `;
  }).join('');

  const withData = POLLEN_SPECIES.filter((species) => air[species.key] != null);
  const mostActive = withData.reduce((max, species) => {
    const ratio = air[species.key] / species.peak;
    const maxRatio = air[max.key] / max.peak;
    return ratio > maxRatio ? species : max;
  }, withData[0]);

  let summary;
  if (mostActive && air[mostActive.key] > 0) {
    const category = getPollenCategory(air[mostActive.key], mostActive.seasonStart, mostActive.peak);
    summary = `
      <p class="pollen-summary">
        ${mostActive.name} (${mostActive.local}) is the most active today: <strong style="color: ${category.color}">${category.label}</strong>
        at ${air[mostActive.key].toFixed(1)} grains/m&sup3; — season starts at ${mostActive.seasonStart}, peak at ${mostActive.peak}.
      </p>
    `;
  } else {
    summary = '<p class="pollen-summary">No significant pollen activity detected today.</p>';
  }

  return `
    <div class="pollen-grid">${columns}</div>
    ${summary}
    <p class="pollen-note">Tick marks show each species' own season-start threshold — bar height is scaled to that species' own peak level (grains/m&sup3;), not a shared scale, since species differ widely in allergenicity.</p>
  `;
}

// The floating marker label is centered on its tick by default, but centering can push wide
// labels (e.g. wind's "4.7 m/s (17 km/h)") past the card's edge when the tick sits near either
// end of the bar. Anchoring left/right instead near the edges keeps the label fully in bounds
// while it still tracks the tick's exact position.
function markerAnchor(percent) {
  if (percent < 35) return 'translateX(0)';
  if (percent > 65) return 'translateX(-100%)';
  return 'translateX(-50%)';
}

// --- Rain radar map (hand-built interactive "slippy map" using OpenStreetMap + RainViewer tiles) ---

const RADAR_TILE_SIZE = 256;
const RADAR_MAP_SIZE = 544;
const RADAR_DEFAULT_ZOOM = 9;
const RADAR_MIN_ZOOM = 3;
const RADAR_MAX_ZOOM = 18;
const RADAR_TILE_MAX_ZOOM = 7; // RainViewer has no real radar data past this zoom

const radarMapEl = document.getElementById('radar-map');
const radarTilesEl = document.getElementById('radar-tiles');
const radarPlaceholderEl = document.getElementById('radar-placeholder');
const radarCaptionEl = document.getElementById('radar-caption');
const radarZoomInBtn = document.getElementById('radar-zoom-in');
const radarZoomOutBtn = document.getElementById('radar-zoom-out');
const radarTimeSliderEl = document.getElementById('radar-time-slider');
const radarTimeLabelEl = document.getElementById('radar-time-label');
const radarForecastNoteEl = document.getElementById('radar-forecast-note');

// Holds everything needed to redraw the map: null until the first successful search.
let radarState = null;

// Converts a lon/lat pair into pixel coordinates on the standard "slippy map" world grid at a given zoom.
function lonLatToWorldPx(lon, lat, zoom) {
  const scale = 2 ** zoom * RADAR_TILE_SIZE;
  const x = ((lon + 180) / 360) * scale;
  const latRad = (lat * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * scale;
  return { x, y };
}

async function renderRadar(lat, lon) {
  radarTilesEl.innerHTML = '';
  radarCaptionEl.textContent = '';
  radarPlaceholderEl.textContent = 'Loading radar...';
  radarPlaceholderEl.style.display = 'block';
  radarTimeSliderEl.disabled = true;

  try {
    const response = await fetch('https://api.rainviewer.com/public/weather-maps.json');
    const data = await response.json();
    // RainViewer's documented guarantee is "past": 2 hours of history in 10-minute steps.
    // "nowcast" (forecast) isn't in their public docs and is often empty — when it does have
    // frames we use them for the +2h side of the slider, but the app works fine without it.
    const pastFrames = (data.radar && data.radar.past) || [];
    const forecastFrames = (data.radar && data.radar.nowcast) || [];

    if (pastFrames.length === 0) {
      throw new Error('Radar data unavailable.');
    }

    const zoom = RADAR_DEFAULT_ZOOM;
    const centerPx = lonLatToWorldPx(lon, lat, zoom);
    const nowIndex = pastFrames.length - 1;

    radarState = {
      zoom,
      centerPxX: centerPx.x,
      centerPxY: centerPx.y,
      cityLon: lon,
      cityLat: lat,
      frames: [...pastFrames, ...forecastFrames], // chronological: oldest past ... now ... forecast
      nowIndex,
      frameIndex: nowIndex, // slider starts on the most recent real data
    };

    radarPlaceholderEl.style.display = 'none';
    drawRadarTiles();

    radarTimeSliderEl.disabled = false;
    radarTimeSliderEl.min = '0';
    radarTimeSliderEl.max = String(radarState.frames.length - 1);
    radarTimeSliderEl.value = String(nowIndex);
    radarForecastNoteEl.textContent = forecastFrames.length > 0 ? '+2h' : 'forecast unavailable';
    updateRadarTimeLabel();

    radarCaptionEl.textContent = 'Drag to pan, scroll to zoom, use the slider for past/forecast radar';
  } catch (error) {
    radarState = null;
    radarPlaceholderEl.textContent = 'Could not load rain radar.';
    radarPlaceholderEl.style.display = 'block';
  }
}

function updateRadarTimeLabel() {
  if (!radarState) return;
  const frame = radarState.frames[radarState.frameIndex];
  const offsetMin = (radarState.frameIndex - radarState.nowIndex) * 10;
  const timeStr = new Date(frame.time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

  let offsetLabel = 'Now';
  if (offsetMin > 0) offsetLabel = `+${offsetMin} min (forecast)`;
  else if (offsetMin < 0) offsetLabel = `${offsetMin} min`;

  radarTimeLabelEl.textContent = `${offsetLabel} · ${timeStr}`;
}

radarTimeSliderEl.addEventListener('input', () => {
  if (!radarState) return;
  radarState.frameIndex = parseInt(radarTimeSliderEl.value, 10);
  updateRadarTimeLabel();
  drawRadarOverlayTiles();
});

// The container is responsive (CSS max-width: 100% shrinks it on small screens), so all pixel
// math must use its real rendered size rather than the RADAR_MAP_SIZE constant — otherwise
// positioning (and anything "centered" on the box) drifts on any screen narrower than that.
function getMapSize() {
  return radarMapEl.clientWidth || RADAR_MAP_SIZE;
}

// Rebuilds the base map tiles + radar overlay + city marker for the current radarState
// (zoom/pan position). Used for pan/zoom, where the base map itself needs to change.
function drawRadarTiles() {
  if (!radarState) return;

  radarTilesEl.style.transform = '';
  radarTilesEl.innerHTML = '';

  const { zoom, centerPxX, centerPxY, cityLon, cityLat } = radarState;
  const worldTiles = 2 ** zoom;
  const mapSize = getMapSize();

  const originX = centerPxX - mapSize / 2;
  const originY = centerPxY - mapSize / 2;

  const startTileX = Math.floor(originX / RADAR_TILE_SIZE);
  const endTileX = Math.floor((originX + mapSize) / RADAR_TILE_SIZE);
  const startTileY = Math.floor(originY / RADAR_TILE_SIZE);
  const endTileY = Math.floor((originY + mapSize) / RADAR_TILE_SIZE);

  for (let x = startTileX; x <= endTileX; x++) {
    for (let y = startTileY; y <= endTileY; y++) {
      if (y < 0 || y >= worldTiles) continue; // no tiles beyond the poles

      const left = x * RADAR_TILE_SIZE - originX;
      const top = y * RADAR_TILE_SIZE - originY;
      const wrappedX = ((x % worldTiles) + worldTiles) % worldTiles;

      const baseTile = document.createElement('img');
      baseTile.className = 'tile base-tile';
      baseTile.draggable = false;
      baseTile.onerror = () => baseTile.remove();
      baseTile.src = `https://a.tile.openstreetmap.org/${zoom}/${wrappedX}/${y}.png`;
      baseTile.style.left = `${left}px`;
      baseTile.style.top = `${top}px`;
      radarTilesEl.appendChild(baseTile);
    }
  }

  drawRadarOverlayTiles();

  // The marker stays pinned to the searched city's real coordinates, not the map center.
  const cityPx = lonLatToWorldPx(cityLon, cityLat, zoom);
  const marker = document.createElement('div');
  marker.className = 'marker';
  marker.style.left = `${cityPx.x - originX}px`;
  marker.style.top = `${cityPx.y - originY}px`;
  radarTilesEl.appendChild(marker);
}

// Rebuilds just the rain radar overlay for the currently selected time (radarState.frameIndex),
// leaving the base map and marker untouched — this is what the time slider calls on every drag,
// so scrubbing through frames doesn't re-request unchanged OpenStreetMap tiles.
function drawRadarOverlayTiles() {
  if (!radarState) return;

  radarTilesEl.querySelectorAll('.radar-tile').forEach((el) => el.remove());

  const frame = radarState.frames[radarState.frameIndex];
  if (!frame) return;

  const { zoom, centerPxX, centerPxY } = radarState;
  const mapSize = getMapSize();
  const originX = centerPxX - mapSize / 2;
  const originY = centerPxY - mapSize / 2;

  // RainViewer's radar imagery only has real data up to RADAR_TILE_MAX_ZOOM — beyond that
  // it silently returns an identical "not supported" placeholder image. So once the map is
  // zoomed in further than that, we fetch the radar tile at the capped zoom and stretch it
  // with CSS to cover the same ground area as the (now several) higher-zoom base tiles.
  const radarZoom = Math.min(zoom, RADAR_TILE_MAX_ZOOM);
  const radarScale = 2 ** (zoom - radarZoom);
  const radarWorldTiles = 2 ** radarZoom;
  const radarTileSpan = RADAR_TILE_SIZE * radarScale;

  // The further past its native resolution the radar tile gets stretched, the blockier and
  // more visually "loud" it becomes — fade it out so street names stay readable underneath.
  const zoomPastMax = Math.max(0, zoom - RADAR_TILE_MAX_ZOOM);
  const radarOpacity = Math.max(0.3, 1 - zoomPastMax * 0.12);

  const originRX = originX / radarScale;
  const originRY = originY / radarScale;
  const mapSizeR = mapSize / radarScale;

  const startRTileX = Math.floor(originRX / RADAR_TILE_SIZE);
  const endRTileX = Math.floor((originRX + mapSizeR) / RADAR_TILE_SIZE);
  const startRTileY = Math.floor(originRY / RADAR_TILE_SIZE);
  const endRTileY = Math.floor((originRY + mapSizeR) / RADAR_TILE_SIZE);

  for (let x = startRTileX; x <= endRTileX; x++) {
    for (let y = startRTileY; y <= endRTileY; y++) {
      if (y < 0 || y >= radarWorldTiles) continue;

      const left = (x * RADAR_TILE_SIZE - originRX) * radarScale;
      const top = (y * RADAR_TILE_SIZE - originRY) * radarScale;
      const wrappedX = ((x % radarWorldTiles) + radarWorldTiles) % radarWorldTiles;

      const radarTile = document.createElement('img');
      radarTile.className = 'tile radar-tile';
      radarTile.draggable = false;
      radarTile.onerror = () => radarTile.remove();
      radarTile.src = `https://tilecache.rainviewer.com${frame.path}/256/${radarZoom}/${wrappedX}/${y}/2/1_1.png`;
      radarTile.style.left = `${left}px`;
      radarTile.style.top = `${top}px`;
      radarTile.style.width = `${radarTileSpan}px`;
      radarTile.style.height = `${radarTileSpan}px`;
      radarTile.style.opacity = radarOpacity;
      radarTilesEl.appendChild(radarTile);
    }
  }
}

// Zooms toward a specific point on screen (screenX/screenY are pixels inside #radar-map),
// keeping that point stationary — the same trick Google Maps uses for scroll-to-zoom.
function zoomRadar(direction, screenX, screenY) {
  if (!radarState) return;

  const newZoom = Math.min(RADAR_MAX_ZOOM, Math.max(RADAR_MIN_ZOOM, radarState.zoom + direction));
  if (newZoom === radarState.zoom) return;

  const mapSize = getMapSize();
  const originX = radarState.centerPxX - mapSize / 2;
  const originY = radarState.centerPxY - mapSize / 2;
  const worldX = originX + screenX;
  const worldY = originY + screenY;

  const scaleFactor = 2 ** (newZoom - radarState.zoom);

  radarState.centerPxX = worldX * scaleFactor - screenX + mapSize / 2;
  radarState.centerPxY = worldY * scaleFactor - screenY + mapSize / 2;
  radarState.zoom = newZoom;

  drawRadarTiles();
}

// --- Interactions: mouse drag, wheel zoom, touch drag, zoom buttons ---
// Set up once at load; handlers read the shared `radarState`, so they work for every search.

let radarDrag = null;

radarMapEl.addEventListener('mousedown', (event) => {
  if (!radarState) return;
  radarDrag = {
    startX: event.clientX,
    startY: event.clientY,
    startCenterPxX: radarState.centerPxX,
    startCenterPxY: radarState.centerPxY,
  };
  radarMapEl.style.cursor = 'grabbing';
});

window.addEventListener('mousemove', (event) => {
  if (!radarDrag) return;
  const dx = event.clientX - radarDrag.startX;
  const dy = event.clientY - radarDrag.startY;
  radarTilesEl.style.transform = `translate(${dx}px, ${dy}px)`;
});

window.addEventListener('mouseup', (event) => {
  if (!radarDrag) return;
  const dx = event.clientX - radarDrag.startX;
  const dy = event.clientY - radarDrag.startY;
  radarState.centerPxX = radarDrag.startCenterPxX - dx;
  radarState.centerPxY = radarDrag.startCenterPxY - dy;
  radarDrag = null;
  radarMapEl.style.cursor = 'grab';
  drawRadarTiles();
});

radarMapEl.addEventListener(
  'wheel',
  (event) => {
    if (!radarState) return;
    event.preventDefault();
    const rect = radarMapEl.getBoundingClientRect();
    zoomRadar(event.deltaY < 0 ? 1 : -1, event.clientX - rect.left, event.clientY - rect.top);
  },
  { passive: false }
);

radarZoomInBtn.addEventListener('click', () => zoomRadar(1, getMapSize() / 2, getMapSize() / 2));
radarZoomOutBtn.addEventListener('click', () => zoomRadar(-1, getMapSize() / 2, getMapSize() / 2));

// Touch: single finger drags, two fingers pinch-to-zoom (anchored at the pinch midpoint,
// so panning while pinching works too — same live-preview-then-snap pattern as mouse drag).
let radarTouch = null;

function touchDistance(t0, t1) {
  const dx = t1.clientX - t0.clientX;
  const dy = t1.clientY - t0.clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

function touchMidpoint(t0, t1, rect) {
  return {
    x: (t0.clientX + t1.clientX) / 2 - rect.left,
    y: (t0.clientY + t1.clientY) / 2 - rect.top,
  };
}

radarMapEl.addEventListener(
  'touchstart',
  (event) => {
    if (!radarState) return;
    const mapSize = getMapSize();

    if (event.touches.length === 1) {
      const touch = event.touches[0];
      const rect = radarMapEl.getBoundingClientRect();
      const touchX = touch.clientX - rect.left;
      const touchY = touch.clientY - rect.top;
      const now = Date.now();

      // If this touch lands where/when the last tap did, it's the second tap of a double-tap.
      // Google Maps behavior: a quick lift zooms in one level; holding and dragging afterward
      // (handled in touchmove/touchend below) instead zooms continuously, anchored right here.
      const isSecondTap =
        lastTapPos &&
        now - lastTapTime < DOUBLE_TAP_MAX_GAP_MS &&
        Math.hypot(touchX - lastTapPos.x, touchY - lastTapPos.y) < DOUBLE_TAP_MAX_DISTANCE_PX;

      if (isSecondTap) {
        lastTapTime = 0;
        lastTapPos = null;
        radarTouch = {
          mode: 'doubleTapZoom',
          anchorX: touchX,
          anchorY: touchY,
          startTouchX: touch.clientX,
          startTouchY: touch.clientY,
          startTime: now,
        };
        radarTilesEl.style.transformOrigin = `${touchX}px ${touchY}px`;
      } else {
        radarTouch = {
          mode: 'drag',
          startX: touch.clientX,
          startY: touch.clientY,
          startCenterPxX: radarState.centerPxX,
          startCenterPxY: radarState.centerPxY,
          startTime: now,
        };
      }
    } else if (event.touches.length === 2) {
      const rect = radarMapEl.getBoundingClientRect();
      const startMid = touchMidpoint(event.touches[0], event.touches[1], rect);

      radarTouch = {
        mode: 'pinch',
        startDistance: touchDistance(event.touches[0], event.touches[1]),
        startZoom: radarState.zoom,
        startMid,
        // The real-world point under the pinch midpoint, so it can be kept anchored there
        // (the same "zoom toward a fixed point" trick zoomRadar uses for scroll-to-zoom).
        startWorldMidX: radarState.centerPxX - mapSize / 2 + startMid.x,
        startWorldMidY: radarState.centerPxY - mapSize / 2 + startMid.y,
        lastMid: startMid,
        lastScale: 1,
        startTime: Date.now(),
      };
      radarTilesEl.style.transformOrigin = `${startMid.x}px ${startMid.y}px`;
    }
  },
  { passive: true }
);

radarMapEl.addEventListener(
  'touchmove',
  (event) => {
    if (!radarTouch) return;

    if (radarTouch.mode === 'drag' && event.touches.length === 1) {
      event.preventDefault();
      const touch = event.touches[0];
      const dx = touch.clientX - radarTouch.startX;
      const dy = touch.clientY - radarTouch.startY;
      radarTilesEl.style.transform = `translate(${dx}px, ${dy}px)`;
    } else if (radarTouch.mode === 'doubleTapZoom' && event.touches.length === 1) {
      event.preventDefault();
      const touch = event.touches[0];
      const dy = touch.clientY - radarTouch.startTouchY;
      // Dragging up zooms in, dragging down zooms out — anchored at the double-tap point,
      // which stays fixed on screen the whole time (no panning from this gesture).
      radarTouch.lastZoomDelta = -dy / DRAG_ZOOM_PX_PER_LEVEL;
      radarTilesEl.style.transform = `scale(${2 ** radarTouch.lastZoomDelta})`;
    } else if (radarTouch.mode === 'pinch' && event.touches.length === 2) {
      event.preventDefault();
      const rect = radarMapEl.getBoundingClientRect();
      const mid = touchMidpoint(event.touches[0], event.touches[1], rect);
      const distance = touchDistance(event.touches[0], event.touches[1]);

      radarTouch.lastMid = mid;
      radarTouch.lastScale = distance / radarTouch.startDistance;

      const dx = mid.x - radarTouch.startMid.x;
      const dy = mid.y - radarTouch.startMid.y;
      radarTilesEl.style.transform = `translate(${dx}px, ${dy}px) scale(${radarTouch.lastScale})`;
    }
  },
  { passive: false }
);

// Tap detection: a touch that ends quickly without much movement counts as a tap.
// Two of those close together in time and position form a double-tap; touchstart above
// already recognizes the second one and switches into 'doubleTapZoom' mode for it, so this
// only needs to record single taps here (see DRAG_ZOOM_PX_PER_LEVEL for the drag-to-zoom rate).
const TAP_MAX_DURATION_MS = 300;
const TAP_MAX_MOVE_PX = 12;
const DOUBLE_TAP_MAX_GAP_MS = 350;
const DOUBLE_TAP_MAX_DISTANCE_PX = 40;
const DRAG_ZOOM_PX_PER_LEVEL = 120;

let lastTapTime = 0;
let lastTapPos = null;

function endRadarTouch(event) {
  if (!radarTouch) return;
  const duration = Date.now() - radarTouch.startTime;

  if (radarTouch.mode === 'drag') {
    const endTouch = event.changedTouches && event.changedTouches[0];
    const rect = radarMapEl.getBoundingClientRect();
    const tapX = endTouch ? endTouch.clientX - rect.left : null;
    const tapY = endTouch ? endTouch.clientY - rect.top : null;
    const moved = endTouch ? Math.hypot(endTouch.clientX - radarTouch.startX, endTouch.clientY - radarTouch.startY) : Infinity;

    if (endTouch && moved < TAP_MAX_MOVE_PX && duration < TAP_MAX_DURATION_MS) {
      radarTilesEl.style.transform = '';
      radarTouch = null;
      lastTapTime = Date.now();
      lastTapPos = { x: tapX, y: tapY };
      return;
    }

    const match = /translate\(([-\d.]+)px, ([-\d.]+)px\)/.exec(radarTilesEl.style.transform);
    if (match) {
      radarState.centerPxX = radarTouch.startCenterPxX - parseFloat(match[1]);
      radarState.centerPxY = radarTouch.startCenterPxY - parseFloat(match[2]);
    }
  } else if (radarTouch.mode === 'doubleTapZoom') {
    const endTouch = event.changedTouches && event.changedTouches[0];
    const dy = endTouch ? endTouch.clientY - radarTouch.startTouchY : 0;
    const dx = endTouch ? endTouch.clientX - radarTouch.startTouchX : 0;
    const moved = Math.hypot(dx, dy);

    radarTilesEl.style.transform = '';
    radarTilesEl.style.transformOrigin = '';

    const anchorX = radarTouch.anchorX;
    const anchorY = radarTouch.anchorY;
    radarTouch = null;

    if (moved < TAP_MAX_MOVE_PX && duration < TAP_MAX_DURATION_MS) {
      zoomRadar(1, anchorX, anchorY); // quick double-tap, no drag: zoom in one level
    } else {
      const deltaLevels = Math.round(-dy / DRAG_ZOOM_PX_PER_LEVEL);
      if (deltaLevels !== 0) {
        zoomRadar(deltaLevels, anchorX, anchorY); // double-tap + drag: zoom by however far it moved
      } else {
        drawRadarTiles();
      }
    }
    return;
  } else if (radarTouch.mode === 'pinch') {
    const mapSize = getMapSize();
    const newZoom = Math.min(
      RADAR_MAX_ZOOM,
      Math.max(RADAR_MIN_ZOOM, Math.round(radarTouch.startZoom + Math.log2(radarTouch.lastScale)))
    );
    const scaleFactor = 2 ** (newZoom - radarTouch.startZoom);

    radarTilesEl.style.transform = '';
    radarTilesEl.style.transformOrigin = '';

    radarState.centerPxX = radarTouch.startWorldMidX * scaleFactor - radarTouch.lastMid.x + mapSize / 2;
    radarState.centerPxY = radarTouch.startWorldMidY * scaleFactor - radarTouch.lastMid.y + mapSize / 2;
    radarState.zoom = newZoom;
  }

  radarTouch = null;
  radarTilesEl.style.transformOrigin = '';
  drawRadarTiles();
}

function cancelRadarTouch() {
  radarTouch = null;
  radarTilesEl.style.transformOrigin = '';
  drawRadarTiles();
}

radarMapEl.addEventListener('touchend', endRadarTouch);
radarMapEl.addEventListener('touchcancel', cancelRadarTouch);

// Show a default city as soon as the page loads.
applyThemeToggleUI();
applyUnitToggleUI();
cityInput.value = 'Tampere';
updateClearButtonVisibility();
searchCity('Tampere');
// ---------------------------------------------------------------------------
// Synthwave radio
//
// A plain <audio> element pointed at Nightride FM, deliberately not an embedded
// player. That choice is the whole point of this section: every iframe embed
// (YouTube, Spotify, SoundCloud) requires a real origin and a Referer, so none
// of them will start on a page opened straight from disk — YouTube answers with
// "Error 153" and no amount of configuration changes it. Audio playback needs
// neither, so this behaves identically from file:///C:/... and from a hosted
// https:// origin.
//
// Browsers still refuse to start audio without a user gesture, so playback
// always begins from the Play button; nothing autoplays on load.
// ---------------------------------------------------------------------------

// The ids double as the stream filename and as the "station" field in the
// metadata feed, so they have to stay exactly as the station spells them.
const RADIO_CHANNELS = [
  { id: 'nightride', name: 'Synthwave FM' },
  { id: 'chillsynth', name: 'Chillsynth FM' },
  { id: 'datawave', name: 'Datawave FM' },
  { id: 'spacesynth', name: 'Spacesynth FM' },
  { id: 'darksynth', name: 'Darksynth FM' },
  { id: 'horrorsynth', name: 'Horrorsynth FM' },
];

// Server-sent events, one JSON array per message, carrying the current track for
// every station at once — so this is filtered down to the channel being played.
const RADIO_META_URL = 'https://nightride.fm/meta';

const VOLUME_STORAGE_KEY = 'weatherapp-volume';
const CHANNEL_STORAGE_KEY = 'weatherapp-radio-channel';

// What a first-time listener gets. Kept as named constants rather than the
// first channel in the list, so the picker's running order stays free to change
// without silently moving the default. The volume default is mirrored by the
// input's value attribute in index.html.
const DEFAULT_VOLUME = 33;
const DEFAULT_CHANNEL = 'nightride';

const playerToggle = document.getElementById('player-toggle');
const playerToggleLabel = document.getElementById('player-toggle-label');
const playerToggleIcon = playerToggle.querySelector('.player-launch-icon');
const playerVolume = document.getElementById('player-volume');
const playerChannel = document.getElementById('player-channel');
const playerNowPlaying = document.getElementById('player-nowplaying');
const playerNowPlayingTrack = document.getElementById('player-nowplaying-track');
const playerNote = document.getElementById('player-note');

const radio = new Audio();
radio.preload = 'none';

let radioMeta = null;
let radioMetaReceived = false;

function setNowPlaying(text) {
  // textContent, never innerHTML: these strings come off a third-party feed.
  playerNowPlayingTrack.textContent = text || '';
  playerNowPlaying.hidden = !text;
}

function stopMeta() {
  if (radioMeta) {
    radioMeta.close();
    radioMeta = null;
  }
  radioMetaReceived = false;
  setNowPlaying('');
}

// One feed carries every station, and reconnecting replays the current track for
// all of them straight away — which is why a channel change reopens the stream
// rather than just changing the filter. Waiting for the next track to roll round
// would leave the line blank for minutes.
function startMeta() {
  stopMeta();

  const channel = storedChannel();
  let source;
  try {
    source = new EventSource(RADIO_META_URL);
  } catch (error) {
    return; // no metadata; the line simply stays hidden
  }
  radioMeta = source;

  source.onmessage = (event) => {
    let rows;
    try {
      rows = JSON.parse(event.data);
    } catch (error) {
      return;
    }
    if (!Array.isArray(rows)) return;

    const match = rows.find((row) => row && row.station === channel);
    if (!match) return;

    radioMetaReceived = true;
    const title = (match.title || '').trim();
    const artist = (match.artist || '').trim();
    if (!title && !artist) return;
    setNowPlaying(artist && title ? `${title} — ${artist}` : title || artist);
  };

  source.onerror = () => {
    // EventSource retries on its own, which is what a dropped connection wants.
    // But if nothing ever arrived the feed is unreachable for this page — most
    // likely opened from disk, where the cross-origin request is refused — so
    // stop retrying and leave the line hidden rather than looping forever.
    if (!radioMetaReceived) stopMeta();
  };
}

// Null has to be rejected before the range check, not by it: Number(null) is 0,
// which is a perfectly valid volume, so a first-time listener with nothing saved
// yet would otherwise get a silent player and no clue why.
function storedVolume() {
  const raw = localStorage.getItem(VOLUME_STORAGE_KEY);
  if (raw === null) return DEFAULT_VOLUME;
  const level = Number(raw);
  return Number.isFinite(level) && level >= 0 && level <= 100 ? level : DEFAULT_VOLUME;
}

function storedChannel() {
  const saved = localStorage.getItem(CHANNEL_STORAGE_KEY);
  return RADIO_CHANNELS.some((channel) => channel.id === saved) ? saved : DEFAULT_CHANNEL;
}

function setPlayerNote(message) {
  playerNote.textContent = message || '';
  playerNote.style.display = message ? 'block' : 'none';
}

function setToggleState(state) {
  const labels = { playing: 'Pause', connecting: 'Connecting', idle: 'Play' };
  playerToggleIcon.innerHTML = state === 'playing' ? '&#10074;&#10074;' : '&#9654;';
  playerToggleLabel.textContent = labels[state];
  playerToggle.setAttribute('aria-pressed', String(state !== 'idle'));
}

// A live stream has no meaningful paused position: leaving the connection open
// would just buffer air. Stopping releases it, and playing again reconnects to
// whatever is going out now, which is what "live" should mean.
function disconnectRadio() {
  radio.pause();
  radio.removeAttribute('src');
  radio.load();
  stopMeta();
  setToggleState('idle');
}

function connectRadio() {
  const channel = storedChannel();
  radio.src = `https://stream.nightride.fm/${channel}.mp3`;
  radio.volume = storedVolume() / 100;
  setToggleState('connecting');
  setPlayerNote('');
  startMeta();

  const attempt = radio.play();
  if (attempt && typeof attempt.catch === 'function') {
    attempt.catch(() => {
      // Either the browser declined to start the audio, or the stream could not
      // be reached. The error event handler covers the second case with a better
      // message, so only fall back to a generic one if it stays silent.
      if (radio.paused) {
        setToggleState('idle');
        setPlayerNote('Could not start playback. Check the connection, or open the station directly.');
      }
    });
  }
}

RADIO_CHANNELS.forEach((channel) => {
  const option = document.createElement('option');
  option.value = channel.id;
  option.textContent = channel.name;
  playerChannel.appendChild(option);
});

// The picker is the only place the channel is named now, so there is nothing
// else to keep in step with it.
function syncChannelSelect() {
  playerChannel.value = storedChannel();
}

playerToggle.addEventListener('click', () => {
  if (radio.paused) {
    connectRadio();
  } else {
    disconnectRadio();
  }
});

playerVolume.addEventListener('input', () => {
  const level = Number(playerVolume.value);
  localStorage.setItem(VOLUME_STORAGE_KEY, String(level));
  radio.volume = level / 100;
});

playerChannel.addEventListener('change', () => {
  localStorage.setItem(CHANNEL_STORAGE_KEY, playerChannel.value);
  syncChannelSelect();
  // Switching channel mid-listen should keep playing, just from the new stream.
  if (!radio.paused) connectRadio();
});

radio.addEventListener('playing', () => {
  setToggleState('playing');
  setPlayerNote('');
});

radio.addEventListener('waiting', () => {
  if (!radio.paused) setToggleState('connecting');
});

radio.addEventListener('error', () => {
  // Fires on teardown too, when the src has deliberately been removed.
  if (!radio.getAttribute('src')) return;
  disconnectRadio();
  setPlayerNote('Could not reach the stream. The station link below always works.');
});

playerVolume.value = String(storedVolume());
radio.volume = storedVolume() / 100;
syncChannelSelect();
setToggleState('idle');
setPlayerNote('');
