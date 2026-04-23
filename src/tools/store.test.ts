import { describe, test, expect } from 'bun:test';
import {
  getAllBuiltinDefs,
  getEnabledBuiltinDefs,
  getBuiltinExecutor,
  getUnifiedToolDefs,
  executeUnifiedTool,
} from './store.js';
import type { Config } from '../config/schema.js';

// Mock Config
const createConfig = (builtinTools?: Record<string, boolean>): Config => ({
  model: 'test-model',
  contextWindow: 20,
  builtinTools: builtinTools ?? {},
});

describe('getAllBuiltinDefs', () => {
  test('返回包含 weather 的列表', () => {
    const defs = getAllBuiltinDefs();
    expect(defs.length).toBeGreaterThan(0);
    const weather = defs.find(d => d.name === 'weather');
    expect(weather).toBeDefined();
    expect(weather?.description).toContain('天气');
  });
});

describe('getEnabledBuiltinDefs', () => {
  test('builtinTools 为空时默认返回 weather', () => {
    const config = createConfig();
    const defs = getEnabledBuiltinDefs(config);
    const weather = defs.find(d => d.name === 'weather');
    expect(weather).toBeDefined();
  });

  test('builtinTools.weather = false 时不返回 weather', () => {
    const config = createConfig({ weather: false });
    const defs = getEnabledBuiltinDefs(config);
    const weather = defs.find(d => d.name === 'weather');
    expect(weather).toBeUndefined();
  });

  test('builtinTools.weather = true 时返回 weather', () => {
    const config = createConfig({ weather: true });
    const defs = getEnabledBuiltinDefs(config);
    const weather = defs.find(d => d.name === 'weather');
    expect(weather).toBeDefined();
  });
});

describe('getBuiltinExecutor', () => {
  test('getBuiltinExecutor("weather") 返回非 undefined', () => {
    const executor = getBuiltinExecutor('weather');
    expect(executor).toBeDefined();
    expect(executor?.execute).toBeFunction();
  });

  test('getBuiltinExecutor("nonexistent") 返回 undefined', () => {
    const executor = getBuiltinExecutor('nonexistent');
    expect(executor).toBeUndefined();
  });
});

describe('executeUnifiedTool', () => {
  test('executeUnifiedTool("weather", { city: "Beijing" }) 返回字符串', async () => {
    const result = await executeUnifiedTool('weather', { city: 'Beijing' });
    expect(typeof result).toBe('string');
    const parsed = JSON.parse(result);
    expect(parsed.city).toBeDefined();
    expect(parsed.temperature_c).toBeDefined();
  }, { timeout: 30000 });

  test('executeUnifiedTool("nonexistent") 抛出异常', async () => {
    try {
      await executeUnifiedTool('nonexistent', {});
      expect(true).toBe(false);
    } catch (error) {
      expect((error as Error).message).toBeDefined();
    }
  });
});

describe('getUnifiedToolDefs', () => {
  test('返回内置工具（MCP 连接失败时降级）', async () => {
    const config = createConfig();
    const defs = await getUnifiedToolDefs(config);
    expect(defs.length).toBeGreaterThan(0);
    const weather = defs.find(d => d.name === 'weather');
    expect(weather).toBeDefined();
    expect(weather?.source).toBe('builtin');
  });

  test('builtinTools.weather = false 时 weather 不在列表中', async () => {
    const config = createConfig({ weather: false });
    const defs = await getUnifiedToolDefs(config);
    const weather = defs.find(d => d.name === 'weather');
    expect(weather).toBeUndefined();
  });
});