import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { loadTools, saveTools, addTool, updateTool, deleteTool } from './store.js';
import type { Tool } from '../types/tool.js';

const originalHome = process.env.HOME;

let tmpDir: string;

const mockTool: Tool = {
  name: 'test_tool',
  description: '测试工具',
  enabled: true,
  scriptPath: '/tmp/test_tool.ts',
  parameters: {
    type: 'object',
    properties: {
      message: { type: 'string', description: '消息内容' }
    },
    required: ['message']
  }
};

beforeEach(() => {
  tmpDir = `/tmp/my-cli-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  mkdirSync(tmpDir, { recursive: true });
  process.env.HOME = tmpDir;
});

afterEach(() => {
  process.env.HOME = originalHome;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('Tools Store', () => {
  test('loadTools includes builtin weather tool', () => {
    const tools = loadTools();
    const weather = tools.find(t => t.name === 'weather');
    expect(weather).toBeDefined();
    expect(weather?.builtin).toBe(true);
    expect(weather?.enabled).toBe(true);
  });

  test('loadTools returns builtin + custom tools', async () => {
    await saveTools([mockTool]);
    const tools = loadTools();
    expect(tools.find(t => t.name === 'weather')).toBeDefined();
    expect(tools.find(t => t.name === 'test_tool')).toBeDefined();
  });

  test('loadTools parses custom tool scriptPath correctly', async () => {
    await saveTools([mockTool]);
    const tools = loadTools();
    const tool = tools.find(t => t.name === 'test_tool');
    expect(tool?.scriptPath).toBe('/tmp/test_tool.ts');
  });

  test('addTool successfully adds custom tool', async () => {
    await addTool(mockTool);
    const tools = loadTools();
    expect(tools.find(t => t.name === 'test_tool')).toBeDefined();
  });

  test('addTool throws when name already exists', async () => {
    await addTool(mockTool);
    try {
      await addTool(mockTool);
      expect(true).toBe(false);
    } catch (error) {
      expect((error as Error).message).toContain('已存在');
    }
  });

  test('addTool throws when trying to add tool with builtin name', async () => {
    const duplicateBuiltin: Tool = {
      ...mockTool,
      name: 'weather',
      scriptPath: '/tmp/fake-weather.ts',
    };
    try {
      await addTool(duplicateBuiltin);
      expect(true).toBe(false);
    } catch (error) {
      expect((error as Error).message).toContain('已存在');
    }
  });

  test('updateTool updates custom tool correctly', async () => {
    await addTool(mockTool);
    await updateTool('test_tool', { description: '更新后的描述', enabled: false });
    const tools = loadTools();
    const tool = tools.find(t => t.name === 'test_tool');
    expect(tool?.description).toBe('更新后的描述');
    expect(tool?.enabled).toBe(false);
  });

  test('updateTool can disable builtin tool', async () => {
    await updateTool('weather', { enabled: false });
    const tools = loadTools();
    const weather = tools.find(t => t.name === 'weather');
    expect(weather?.enabled).toBe(false);
    expect(weather?.builtin).toBe(true);
  });

  test('updateTool throws when tool does not exist', async () => {
    try {
      await updateTool('nonexistent', { description: 'test' });
      expect(true).toBe(false);
    } catch (error) {
      expect((error as Error).message).toContain('不存在');
    }
  });

  test('deleteTool removes custom tool correctly', async () => {
    await addTool(mockTool);
    let tools = loadTools();
    expect(tools.find(t => t.name === 'test_tool')).toBeDefined();

    await deleteTool('test_tool');
    tools = loadTools();
    expect(tools.find(t => t.name === 'test_tool')).toBeUndefined();
  });

  test('deleteTool throws when trying to delete builtin tool', async () => {
    try {
      await deleteTool('weather');
      expect(true).toBe(false);
    } catch (error) {
      expect((error as Error).message).toContain('内置工具');
    }
  });

  test('deleteTool throws when tool does not exist', async () => {
    try {
      await deleteTool('nonexistent');
      expect(true).toBe(false);
    } catch (error) {
      expect((error as Error).message).toContain('不存在');
    }
  });
});
