import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { toolsCommand, toolsFactory } from './tools.js';
import type { BuiltinToolDef } from '../types/tool.js';

let output: string[];
let originalStdoutWrite: typeof process.stdout.write;
let originalStderrWrite: typeof process.stderr.write;
let originalGetAllBuiltinDefs: typeof toolsFactory.getAllBuiltinDefs;
let originalLoadConfig: typeof toolsFactory.loadConfig;
let originalSaveConfig: typeof toolsFactory.saveConfig;

let saveConfigCalls: unknown[];

beforeEach(() => {
  output = [];
  saveConfigCalls = [];
  originalStdoutWrite = process.stdout.write.bind(process.stdout);
  originalStderrWrite = process.stderr.write.bind(process.stderr);
  originalGetAllBuiltinDefs = toolsFactory.getAllBuiltinDefs;
  originalLoadConfig = toolsFactory.loadConfig;
  originalSaveConfig = toolsFactory.saveConfig;

  process.stdout.write = ((str: string | Uint8Array) => { output.push(String(str)); return true; }) as typeof process.stdout.write;
  process.stderr.write = ((str: string | Uint8Array) => { output.push(String(str)); return true; }) as typeof process.stderr.write;

  toolsFactory.getAllBuiltinDefs = () => [];
  toolsFactory.loadConfig = () => ({}) as any;
  toolsFactory.saveConfig = async (partial: any) => { saveConfigCalls.push(partial); };
});

afterEach(() => {
  process.stdout.write = originalStdoutWrite;
  process.stderr.write = originalStderrWrite;
  toolsFactory.getAllBuiltinDefs = originalGetAllBuiltinDefs;
  toolsFactory.loadConfig = originalLoadConfig;
  toolsFactory.saveConfig = originalSaveConfig;
});

function setTools(tools: BuiltinToolDef[]) {
  toolsFactory.getAllBuiltinDefs = () => tools;
}

describe('tools 命令组', () => {
  test('list 空列表时输出 "暂无内置工具"', async () => {
    await toolsCommand.execute({ builtinTools: {} } as any, {}, ['list']);
    expect(output.join('')).toContain('暂无内置工具');
  });

  test('list 有工具时输出工具信息', async () => {
    setTools([
      { name: 'weather', description: '查询天气', enabled: true, parameters: { type: 'object', properties: {} } },
      { name: 'read_file', description: '读取文件', enabled: true, parameters: { type: 'object', properties: {} } },
    ]);

    await toolsCommand.execute({ builtinTools: {} } as any, {}, ['list']);

    const outputStr = output.join('');
    expect(outputStr).toContain('[enabled] [builtin] weather: 查询天气');
    expect(outputStr).toContain('[enabled] [builtin] read_file: 读取文件');
  });

  test('list 已禁用的工具显示 disabled', async () => {
    setTools([
      { name: 'weather', description: '查询天气', enabled: true, parameters: { type: 'object', properties: {} } },
    ]);

    await toolsCommand.execute({ builtinTools: { weather: false } } as any, {}, ['list']);

    expect(output.join('')).toContain('[disabled] [builtin] weather: 查询天气');
  });

  test('enable 成功', async () => {
    setTools([{ name: 'weather', description: '查询天气', enabled: true, parameters: { type: 'object', properties: {} } }]);

    await toolsCommand.execute({} as any, {}, ['enable', 'weather']);

    expect(output.join('')).toContain('工具 "weather" 已启用');
    expect(saveConfigCalls[0]).toEqual({ builtinTools: { weather: true } });
  });

  test('enable 不存在时输出错误', async () => {
    setTools([]);

    await toolsCommand.execute({} as any, {}, ['enable', 'not-exist']);

    const outputStr = output.join('');
    expect(outputStr).toContain('错误');
    expect(outputStr).toContain('未知工具');
  });

  test('disable 成功', async () => {
    setTools([{ name: 'read_file', description: '读取文件', enabled: true, parameters: { type: 'object', properties: {} } }]);

    await toolsCommand.execute({} as any, {}, ['disable', 'read_file']);

    expect(output.join('')).toContain('工具 "read_file" 已禁用');
    expect(saveConfigCalls[0]).toEqual({ builtinTools: { read_file: false } });
  });

  test('disable 不存在时输出错误', async () => {
    setTools([]);

    await toolsCommand.execute({} as any, {}, ['disable', 'not-exist']);

    expect(output.join('')).toContain('错误');
  });

  test('无子命令时输出用法说明', async () => {
    await toolsCommand.execute({} as any, {}, []);

    expect(output.join('')).toContain('用法: my-cli tools <list|enable|disable>');
  });

  test('enable 无参数抛出 UsageError', async () => {
    await expect(async () => {
      await toolsCommand.execute({} as any, {}, ['enable']);
    }).toThrow();
  });

  test('disable 无参数抛出 UsageError', async () => {
    await expect(async () => {
      await toolsCommand.execute({} as any, {}, ['disable']);
    }).toThrow();
  });
});
