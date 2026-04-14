import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { toolsCommand } from './tools.js';
import { loadConfig } from '../config/loader.js';
import * as storeModule from '../tools/store.js';
import type { Tool } from '../types/tool.js';

// Mock store 模块
const mockLoadTools = mock(() => [] as Tool[]);
const mockAddTool = mock(async (_tool: Tool) => {});
const mockUpdateTool = mock(async (_name: string, _patch: Partial<Tool>) => {});
const mockDeleteTool = mock(async (_name: string) => {});

// 替换 store 模块的实现
mock.module('../tools/store.js', () => ({
  loadTools: mockLoadTools,
  addTool: mockAddTool,
  updateTool: mockUpdateTool,
  deleteTool: mockDeleteTool,
}));

describe('tools 命令组', () => {
  let output: string[];
  let originalStdoutWrite: typeof process.stdout.write;
  let originalStderrWrite: typeof process.stderr.write;

  beforeEach(() => {
    output = [];
    originalStdoutWrite = process.stdout.write.bind(process.stdout);
    originalStderrWrite = process.stderr.write.bind(process.stderr);

    // Mock stdout.write 捕获输出
    process.stdout.write = ((str: string | Uint8Array, _encoding?: BufferEncoding, _cb?: (err?: Error) => void): boolean => {
      output.push(String(str));
      return true;
    }) as typeof process.stdout.write;

    // Mock stderr.write 捕获错误输出
    process.stderr.write = ((str: string | Uint8Array, _encoding?: BufferEncoding, _cb?: (err?: Error) => void): boolean => {
      output.push(String(str));
      return true;
    }) as typeof process.stderr.write;

    // 重置 mock
    mockLoadTools.mockClear();
    mockAddTool.mockClear();
    mockUpdateTool.mockClear();
    mockDeleteTool.mockClear();
  });

  afterEach(() => {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  });

  test('list 空列表时输出 "暂无工具"', async () => {
    mockLoadTools.mockReturnValue([]);
    const config = loadConfig({ output: 'text' });

    await toolsCommand.execute(config, {}, ['list']);

    const outputStr = output.join('');
    expect(outputStr).toContain('暂无工具');
    expect(mockLoadTools).toHaveBeenCalled();
  });

  test('list 有工具时每行包含工具信息', async () => {
    const tools: Tool[] = [
      {
        name: 'curl',
        description: 'HTTP 请求工具',
        enabled: true,
        command: 'curl {{url}}',
        parameters: { type: 'object', properties: {} },
      },
      {
        name: 'grep',
        description: '文本搜索工具',
        enabled: false,
        command: 'grep {{pattern}} {{file}}',
        parameters: { type: 'object', properties: {} },
      },
    ];
    mockLoadTools.mockReturnValue(tools);
    const config = loadConfig({ output: 'text' });

    await toolsCommand.execute(config, {}, ['list']);

    const outputStr = output.join('');
    expect(outputStr).toContain('[enabled] curl: HTTP 请求工具');
    expect(outputStr).toContain('[disabled] grep: 文本搜索工具');
    expect(mockLoadTools).toHaveBeenCalled();
  });

  test('enable <name> 成功', async () => {
    mockUpdateTool.mockResolvedValue(undefined);
    const config = loadConfig({ output: 'text' });

    await toolsCommand.execute(config, {}, ['enable', 'my-tool']);

    const outputStr = output.join('');
    expect(outputStr).toContain('工具 "my-tool" 已启用');
    expect(mockUpdateTool).toHaveBeenCalledWith('my-tool', { enabled: true });
  });

  test('enable 不存在时输出错误信息', async () => {
    mockUpdateTool.mockImplementation(async () => {
      throw new Error('工具 "not-exist" 不存在');
    });
    const config = loadConfig({ output: 'text' });

    await toolsCommand.execute(config, {}, ['enable', 'not-exist']);

    const outputStr = output.join('');
    expect(outputStr).toContain('错误');
    expect(outputStr).toContain('不存在');
  });

  test('disable <name> 成功', async () => {
    mockUpdateTool.mockResolvedValue(undefined);
    const config = loadConfig({ output: 'text' });

    await toolsCommand.execute(config, {}, ['disable', 'my-tool']);

    const outputStr = output.join('');
    expect(outputStr).toContain('工具 "my-tool" 已禁用');
    expect(mockUpdateTool).toHaveBeenCalledWith('my-tool', { enabled: false });
  });

  test('disable 不存在时输出错误信息', async () => {
    mockUpdateTool.mockImplementation(async () => {
      throw new Error('工具 "not-exist" 不存在');
    });
    const config = loadConfig({ output: 'text' });

    await toolsCommand.execute(config, {}, ['disable', 'not-exist']);

    const outputStr = output.join('');
    expect(outputStr).toContain('错误');
    expect(outputStr).toContain('不存在');
  });

  test('delete <name> 成功', async () => {
    mockDeleteTool.mockResolvedValue(undefined);
    const config = loadConfig({ output: 'text' });

    await toolsCommand.execute(config, {}, ['delete', 'my-tool']);

    const outputStr = output.join('');
    expect(outputStr).toContain('工具 "my-tool" 已删除');
    expect(mockDeleteTool).toHaveBeenCalledWith('my-tool');
  });

  test('delete 不存在时输出错误信息', async () => {
    mockDeleteTool.mockImplementation(async () => {
      throw new Error('工具 "not-exist" 不存在');
    });
    const config = loadConfig({ output: 'text' });

    await toolsCommand.execute(config, {}, ['delete', 'not-exist']);

    const outputStr = output.join('');
    expect(outputStr).toContain('错误');
    expect(outputStr).toContain('不存在');
  });

  test('无子命令时输出用法说明', async () => {
    const config = loadConfig({ output: 'text' });

    await toolsCommand.execute(config, {}, []);

    const outputStr = output.join('');
    expect(outputStr).toContain('用法: my-cli tools <add|list|enable|disable|delete>');
  });

  test('enable 无参数抛出 UsageError', async () => {
    const config = loadConfig({ output: 'text' });

    expect(async () => {
      await toolsCommand.execute(config, {}, ['enable']);
    }).toThrow();
  });

  test('disable 无参数抛出 UsageError', async () => {
    const config = loadConfig({ output: 'text' });

    expect(async () => {
      await toolsCommand.execute(config, {}, ['disable']);
    }).toThrow();
  });

  test('delete 无参数抛出 UsageError', async () => {
    const config = loadConfig({ output: 'text' });

    expect(async () => {
      await toolsCommand.execute(config, {}, ['delete']);
    }).toThrow();
  });
});
