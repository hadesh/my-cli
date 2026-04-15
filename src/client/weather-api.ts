import { spawn } from 'child_process';
import { NetworkError } from '../errors/base.js';

const WTTR_URL = 'https://wttr.in';

export interface WeatherResult {
  city: string;
  region: string;
  country: string;
  temperature: number;
  feelsLike: number;
  windSpeed: number;
  windDirection: string;
  humidity: number;
  description: string;
  pressure: number;
  visibility: number;
  uvIndex: number | null;
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
  region: string;
  country: string;
  days: ForecastDay[];
}

function fetchWithCurl(city: string, queryParams: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const encodedCity = encodeURIComponent(city);
    const url = `${WTTR_URL}/${encodedCity}${queryParams}`;

    const curl = spawn('curl', [
      '-s',
      '-H', 'Accept-Language: zh-cn',
      '-m', '15',
      url,
    ]);

    let stdout = '';
    let stderr = '';

    curl.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    curl.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    curl.on('close', (code) => {
      if (code !== 0) {
        reject(new NetworkError(`curl 请求失败: ${stderr || `退出码 ${code}`}`));
      } else if (stdout.includes('Unknown location') || stdout.includes('404')) {
        reject(new NetworkError(`未找到城市「${city}」，请检查拼写或尝试英文名称。`));
      } else {
        resolve(stdout.trim());
      }
    });

    curl.on('error', (err) => {
      reject(new NetworkError(`curl 执行失败: ${err.message}`));
    });
  });
}

export async function fetchWeather(city: string): Promise<WeatherResult> {
  const format = '%l: %c%C %t %f %w %h %P\n';
  const result = await fetchWithCurl(city, `?format=${encodeURIComponent(format)}`);

  const lines = result.split('\n').filter((line) => line.trim());
  const firstLine = lines[0] || '';

  const match = firstLine.match(/^(.+?):\s*(\S+)\s+(\S+)\s+([+-]?\d+)°C\s+([+-]?\d+)°C\s+(\S+)\s+(\d+)%\s+(\d+)hPa/);

  if (!match) {
    return {
      city: firstLine.split(':')[0] || city,
      region: '',
      country: '',
      temperature: 0,
      feelsLike: 0,
      windSpeed: 0,
      windDirection: '',
      humidity: 0,
      description: result,
      pressure: 0,
      visibility: 0,
      uvIndex: null,
      time: new Date().toISOString(),
    };
  }

  const [, location, icon, weatherDesc, tempStr, feelsLikeStr, windStr, humidityStr, pressureStr] = match;

  const windMatch = windStr.match(/\d+/);
  const windSpeed = windMatch ? parseInt(windMatch[0], 10) : 0;
  const windDirection = windStr.replace(/\d+/g, '').replace(/km\/h/g, '').trim();

  return {
    city: location.trim(),
    region: '',
    country: '',
    temperature: parseInt(tempStr, 10),
    feelsLike: parseInt(feelsLikeStr, 10),
    windSpeed,
    windDirection,
    humidity: parseInt(humidityStr, 10),
    description: `${icon} ${weatherDesc}`.trim(),
    pressure: parseInt(pressureStr, 10),
    visibility: 0,
    uvIndex: null,
    time: new Date().toISOString(),
  };
}

export async function fetchForecast(city: string, _days: number = 3): Promise<string> {
  return fetchWithCurl(city, '?n');
}

export async function fetchWeatherText(city: string): Promise<string> {
  return fetchWithCurl(city, '?0q');
}
