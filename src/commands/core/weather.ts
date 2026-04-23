import type { Command } from '../../command.js';
import type { Config } from '../../config/schema.js';
import { fetchWeather, fetchForecast } from '../../client/weather-api.js';
import { print, printTable } from '../../output/text.js';
import { UsageError } from '../../errors/base.js';

export const weatherCommand: Command = {
  name: 'weather',
  description: '查询指定城市的当前天气或未来天气预报',
  usage: 'my-cli weather <城市名> [--forecast]',
  options: [
    {
      name: 'forecast',
      short: 'f',
      description: '显示未来天气预报（最多3天）',
      type: 'boolean',
      default: false,
    },
  ],
  examples: [
    'my-cli weather 北京',
    'my-cli weather Tokyo --forecast',
    'my-cli weather "New York" -f',
    'my-cli weather 上海 --forecast --output json',
  ],
  async execute(config: Config, flags: Record<string, unknown>, positional: string[]) {
    const city = positional[0];
    if (!city) {
      throw new UsageError('请提供城市名称。\n用法: my-cli weather <城市名> [--forecast]');
    }

    const isForecast = flags['forecast'] === true || flags['f'] === true;

    if (isForecast) {
      const result = await fetchForecast(city, 3);
      print(config, result);
    } else {
      const w = await fetchWeather(city);
      const location = [w.city, w.region, w.country]
        .filter(Boolean)
        .join('，');
      printTable(config, [
        { 项目: '城市', 值: location },
        { 项目: '天气', 值: w.description },
        { 项目: '温度', 值: `${w.temperature} °C` },
        { 项目: '体感温度', 值: `${w.feelsLike} °C` },
        { 项目: '湿度', 值: `${w.humidity} %` },
        { 项目: '气压', 值: `${w.pressure} hPa` },
        { 项目: '风速', 值: `${w.windSpeed} km/h` },
        { 项目: '风向', 值: w.windDirection },
        { 项目: '能见度', 值: `${w.visibility} km` },
        ...(w.uvIndex !== null ? [{ 项目: 'UV指数', 值: String(w.uvIndex) }] : []),
      ]);
    }
  },
};
