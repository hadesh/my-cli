import type { ToolExecutor } from '../base.js'
import type { BuiltinToolDef } from '../../types/tool.js'

const WMO_CODES: Record<number, string> = {
  0: '晴天',
  1: '基本晴朗', 2: '局部多云', 3: '阴天',
  45: '雾', 48: '冻雾',
  51: '小毛毛雨', 53: '中毛毛雨', 55: '大毛毛雨',
  61: '小雨', 63: '中雨', 65: '大雨',
  71: '小雪', 73: '中雪', 75: '大雪',
  80: '小阵雨', 81: '中阵雨', 82: '大阵雨',
  95: '雷阵雨', 96: '雷阵雨伴小冰雹', 99: '雷阵雨伴大冰雹',
}

interface GeoResult {
  name: string
  latitude: number
  longitude: number
  country_code: string
  population?: number
  admin1?: string
}

async function fetchGeo(query: string, countryCode?: string): Promise<GeoResult[]> {
  const params = new URLSearchParams({ name: query, count: '10', language: 'zh', format: 'json' })
  if (countryCode) params.set('country_code', countryCode)
  const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${params}`)
  const data = await res.json() as { results?: GeoResult[] }
  return data.results ?? []
}

async function resolveCoordinates(city: string): Promise<{ name: string; lat: number; lon: number }> {
  const isChinese = /[\u4e00-\u9fff]/.test(city)

  if (isChinese) {
    const withShi = city.endsWith('市') ? city : `${city}市`
    let candidates = await fetchGeo(withShi, 'CN')
    candidates = candidates.filter(r => r.country_code === 'CN' && (r.population ?? 0) > 0)

    if (candidates.length === 0) {
      const fallback = await fetchGeo(city, 'CN')
      candidates = fallback.filter(r => r.country_code === 'CN')
    }

    if (candidates.length === 0) throw new Error(`找不到城市: ${city}`)
    candidates.sort((a, b) => (b.population ?? 0) - (a.population ?? 0))
    const best = candidates[0]
    return { name: best.name, lat: best.latitude, lon: best.longitude }
  }

  const results = await fetchGeo(city)
  if (results.length === 0) throw new Error(`找不到城市: ${city}`)
  results.sort((a, b) => (b.population ?? 0) - (a.population ?? 0))
  const best = results[0]
  return { name: best.name, lat: best.latitude, lon: best.longitude }
}

async function fetchWeather(lat: number, lon: number) {
  const params = new URLSearchParams({
    latitude: String(lat),
    longitude: String(lon),
    current: [
      'temperature_2m',
      'relative_humidity_2m',
      'wind_speed_10m',
      'wind_direction_10m',
      'precipitation_probability',
      'weathercode',
    ].join(','),
    timezone: 'auto',
    forecast_days: '1',
  })
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`)
  return res.json() as Promise<{
    current: {
      time: string
      temperature_2m: number
      relative_humidity_2m: number
      wind_speed_10m: number
      wind_direction_10m: number
      precipitation_probability: number
      weathercode: number
    }
  }>
}

const weatherTool: ToolExecutor = {
  async execute(args: Record<string, string>): Promise<string> {
    const city = args['city']
    if (!city) throw new Error('缺少参数: city')

    const { name, lat, lon } = await resolveCoordinates(city)
    const forecast = await fetchWeather(lat, lon)
    const c = forecast.current

    return JSON.stringify({
      city: name,
      time: c.time,
      temperature_c: c.temperature_2m,
      humidity_percent: c.relative_humidity_2m,
      wind_speed_kmh: c.wind_speed_10m,
      wind_direction_deg: c.wind_direction_10m,
      precipitation_probability_percent: c.precipitation_probability,
      weather_code: c.weathercode,
      weather_description: WMO_CODES[c.weathercode] ?? `代码${c.weathercode}`,
    })
  },
}

export const weatherToolDef: BuiltinToolDef = {
  name: 'weather',
  description: '获取指定城市的实时天气信息',
  enabled: true,
  parameters: {
    type: 'object',
    properties: {
      city: {
        type: 'string',
        description: '城市名称，支持中文（如"北京"）或英文（如"Beijing"）',
      },
    },
    required: ['city'],
  },
}

export const weatherExecutor: ToolExecutor = weatherTool
