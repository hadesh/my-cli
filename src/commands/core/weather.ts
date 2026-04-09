import type { Command } from '../../command.js';
import type { Config } from '../../config/schema.js';
import { fetchWeather, fetchForecast } from '../../client/weather-api.js';
import { print, printTable } from '../../output/text.js';
import { UsageError } from '../../errors/base.js';

export const weatherCommand: Command = {
  name: 'weather',
  description: '查询指定城市的当前天气或未来 7 天预报',
  usage: 'my-cli weather <城市名> [--forecast]',
  options: [
    {
      name: 'forecast',
      short: 'f',
      description: '显示未来 7 天天气预报',
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
      const result = await fetchForecast(city, 7);
      print(config, `${result.city}，${result.country} — 未来 7 天预报`);
      printTable(
        config,
        result.days.map((d) => ({
          日期: d.date,
          天气: d.description,
          '最高(°C)': String(d.tempMax),
          '最低(°C)': String(d.tempMin),
          '降水(mm)': String(d.precipitation),
          '风速(km/h)': String(d.windSpeedMax),
        })),
      );
    } else {
      const w = await fetchWeather(city);
      printTable(config, [
        { 项目: '城市', 值: `${w.city}，${w.country}` },
        { 项目: '天气', 值: w.description },
        { 项目: '温度', 值: `${w.temperature} °C` },
        { 项目: '湿度', 值: `${w.humidity} %` },
        { 项目: '风速', 值: `${w.windSpeed} km/h` },
        { 项目: '风向', 值: `${w.windDirection}°` },
        { 项目: '昼夜', 值: w.isDay ? '白天' : '夜间' },
        { 项目: '时间', 值: w.time },
      ]);
    }
  },
};
