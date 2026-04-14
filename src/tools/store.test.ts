import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { loadTools, saveTools, addTool, updateTool, deleteTool } from './store.js';
import type { Tool } from '../types/tool.js';

const originalHome = process.env.HOME;

let tmpDir: string;

const mockTool: Tool = {
  name: 'test_tool',
  description: '测试工具',
  enabled: true,
  command: 'echo {{message}}',
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
  test('loadTools returns empty array when file does not exist', () => {
    const tools = loadTools();
    expect(tools).toEqual([]);
  });

  test('loadTools parses file correctly when exists', async () => {
    await saveTools([mockTool]);
    const tools = loadTools();
    expect(tools.length).toBe(1);
    expect(tools[0].name).toBe('test_tool');
    expect(tools[0].description).toBe('测试工具');
  });

  test('addTool successfully adds and can be loaded', async () => {
    await addTool(mockTool);
    const tools = loadTools();
    expect(tools.length).toBe(1);
    expect(tools[0].name).toBe('test_tool');
  });

  test('addTool throws when name already exists', async () => {
    await addTool(mockTool);
    expect(async () => {
      await addTool(mockTool);
    }).toThrow();

    try {
      await addTool(mockTool);
    } catch (error) {
      expect((error as Error).message).toContain('已存在');
    }
  });

  test('updateTool updates fields correctly', async () => {
    await addTool(mockTool);
    await updateTool('test_tool', { description: '更新后的描述', enabled: false });
    const tools = loadTools();
    expect(tools[0].description).toBe('更新后的描述');
    expect(tools[0].enabled).toBe(false);
    expect(tools[0].name).toBe('test_tool');
  });

  test('updateTool throws when tool does not exist', async () => {
    expect(async () => {
      await updateTool('nonexistent', { description: 'test' });
    }).toThrow();

    try {
      await updateTool('nonexistent', { description: 'test' });
    } catch (error) {
      expect((error as Error).message).toContain('不存在');
    }
  });

  test('deleteTool removes tool correctly', async () => {
    await addTool(mockTool);
    let tools = loadTools();
    expect(tools.length).toBe(1);

    await deleteTool('test_tool');
    tools = loadTools();
    expect(tools.length).toBe(0);
  });

  test('deleteTool throws when tool does not exist', async () => {
    expect(async () => {
      await deleteTool('nonexistent');
    }).toThrow();

    try {
      await deleteTool('nonexistent');
    } catch (error) {
      expect((error as Error).message).toContain('不存在');
    }
  });
});
