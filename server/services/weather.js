// Open-Meteo API — free, no API key required
// Returns 7-day forecast with weather codes

const WEATHER_ICONS = {
  0: { icon: '☀️', desc: 'Clear' },
  1: { icon: '🌤️', desc: 'Mostly Clear' },
  2: { icon: '⛅', desc: 'Partly Cloudy' },
  3: { icon: '☁️', desc: 'Overcast' },
  45: { icon: '🌫️', desc: 'Foggy' },
  48: { icon: '🌫️', desc: 'Fog' },
  51: { icon: '🌦️', desc: 'Light Drizzle' },
  53: { icon: '🌦️', desc: 'Drizzle' },
  55: { icon: '🌧️', desc: 'Heavy Drizzle' },
  61: { icon: '🌧️', desc: 'Light Rain' },
  63: { icon: '🌧️', desc: 'Rain' },
  65: { icon: '🌧️', desc: 'Heavy Rain' },
  71: { icon: '🌨️', desc: 'Light Snow' },
  73: { icon: '🌨️', desc: 'Snow' },
  75: { icon: '❄️', desc: 'Heavy Snow' },
  77: { icon: '🌨️', desc: 'Snow Grains' },
  80: { icon: '🌦️', desc: 'Light Showers' },
  81: { icon: '🌧️', desc: 'Showers' },
  82: { icon: '⛈️', desc: 'Heavy Showers' },
  85: { icon: '🌨️', desc: 'Snow Showers' },
  86: { icon: '❄️', desc: 'Heavy Snow' },
  95: { icon: '⛈️', desc: 'Thunderstorm' },
  96: { icon: '⛈️', desc: 'Thunderstorm w/ Hail' },
  99: { icon: '⛈️', desc: 'Severe Thunderstorm' },
};

function getWeatherInfo(code) {
  return WEATHER_ICONS[code] || { icon: '🌡️', desc: 'Unknown' };
}

async function get7DayForecast(lat = 34.05, lon = -118.24) {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weather_code,temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&timezone=America/Los_Angeles&forecast_days=7`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();

    const days = data.daily.time.map((date, i) => {
      const d = new Date(date + 'T12:00:00');
      const dayName = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : d.toLocaleDateString('en-US', { weekday: 'short' });
      const weather = getWeatherInfo(data.daily.weather_code[i]);
      return {
        day: dayName,
        date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        high: Math.round(data.daily.temperature_2m_max[i]),
        low: Math.round(data.daily.temperature_2m_min[i]),
        icon: weather.icon,
        desc: weather.desc,
        code: data.daily.weather_code[i]
      };
    });

    return days;
  } catch (err) {
    console.error('Weather API error:', err.message);
    return null;
  }
}

module.exports = { get7DayForecast };
