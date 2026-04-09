import { NetworkError } from '../errors/base.js';

const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast';

const WMO_DESC: Record<number, string> = {
  0: '晴天',
  1: '大致晴朗', 2: '局部多云', 3: '阴天',
  45: '雾', 48: '冻雾',
  51: '小毛毛雨', 53: '中毛毛雨', 55: '大毛毛雨',
  61: '小雨', 63: '中雨', 65: '大雨',
  71: '小雪', 73: '中雪', 75: '大雪', 77: '冰粒',
  80: '阵雨', 81: '中阵雨', 82: '强阵雨',
  85: '阵雪', 86: '强阵雪',
  95: '雷暴', 96: '雷暴伴冰雹', 99: '强雷暴伴冰雹',
};

function wmoDesc(code: number): string {
  return WMO_DESC[code] ?? `天气代码 ${code}`;
}

export interface GeoResult {
  name: string;
  country: string;
  latitude: number;
  longitude: number;
  timezone: string;
}

export interface WeatherResult {
  city: string;
  country: string;
  temperature: number;
  windSpeed: number;
  windDirection: number;
  humidity: number;
  description: string;
  isDay: boolean;
  time: string;
}

export interface ForecastDay {
  date: string;
  description: string;
  tempMax: number;
  tempMin: number;
  precipitation: number;
  windSpeedMax: number;
}

export interface ForecastResult {
  city: string;
  country: string;
  days: ForecastDay[];
}

interface GeoApiResponse {
  results?: Array<{
    name: string;
    country: string;
    latitude: number;
    longitude: number;
    timezone: string;
  }>;
}

interface WeatherApiResponse {
  current_weather: {
    temperature: number;
    windspeed: number;
    winddirection: number;
    weathercode: number;
    is_day: number;
    time: string;
  };
  hourly: {
    time: string[];
    relative_humidity_2m: number[];
  };
}

interface ForecastApiResponse {
  daily: {
    time: string[];
    weathercode: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_sum: number[];
    windspeed_10m_max: number[];
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  } catch (err) {
    throw new NetworkError(`网络请求失败: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) {
    throw new NetworkError(`API 请求失败 (HTTP ${res.status})`, res.status);
  }
  return res.json() as Promise<T>;
}

export async function geocode(city: string): Promise<GeoResult> {
  const params = new URLSearchParams({
    name: city,
    count: '1',
    language: 'zh',
    format: 'json',
  });
  const data = await fetchJson<GeoApiResponse>(`${GEO_URL}?${params}`);
  if (!data.results?.length) {
    throw new NetworkError(`未找到城市「${city}」，请检查拼写或尝试英文名称。`);
  }
  const r = data.results[0]!;
  return {
    name: r.name,
    country: r.country,
    latitude: r.latitude,
    longitude: r.longitude,
    timezone: r.timezone,
  };
}

export async function fetchWeather(city: string): Promise<WeatherResult> {
  const geo = await geocode(city);

  const params = new URLSearchParams({
    latitude: String(geo.latitude),
    longitude: String(geo.longitude),
    current_weather: 'true',
    hourly: 'relative_humidity_2m',
    timezone: geo.timezone,
    forecast_days: '1',
  });
  const data = await fetchJson<WeatherApiResponse>(`${WEATHER_URL}?${params}`);

  const cw = data.current_weather;
  // 取与当前时刻最近的小时湿度值
  const currentHour = cw.time.slice(0, 13);
  const humidityIdx = data.hourly.time.findIndex((t) => t.startsWith(currentHour));
  const humidity = humidityIdx >= 0 ? (data.hourly.relative_humidity_2m[humidityIdx] ?? 0) : 0;

  return {
    city: geo.name,
    country: geo.country,
    temperature: cw.temperature,
    windSpeed: cw.windspeed,
    windDirection: cw.winddirection,
    humidity,
    description: wmoDesc(cw.weathercode),
    isDay: cw.is_day === 1,
    time: cw.time,
  };
}

export async function fetchForecast(city: string, days: number = 7): Promise<ForecastResult> {
  const geo = await geocode(city);

  const params = new URLSearchParams({
    latitude: String(geo.latitude),
    longitude: String(geo.longitude),
    daily: 'weathercode,temperature_2m_max,temperature_2m_min,precipitation_sum,windspeed_10m_max',
    timezone: geo.timezone,
    forecast_days: String(days),
  });
  const data = await fetchJson<ForecastApiResponse>(`${WEATHER_URL}?${params}`);

  const d = data.daily;
  const forecastDays: ForecastDay[] = d.time.map((date, i) => ({
    date,
    description: wmoDesc(d.weathercode[i] ?? 0),
    tempMax: d.temperature_2m_max[i] ?? 0,
    tempMin: d.temperature_2m_min[i] ?? 0,
    precipitation: d.precipitation_sum[i] ?? 0,
    windSpeedMax: d.windspeed_10m_max[i] ?? 0,
  }));

  return {
    city: geo.name,
    country: geo.country,
    days: forecastDays,
  };
}
