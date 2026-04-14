import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { Tool, ToolsConfig } from '../types/tool.js';

const BUILTIN_DIR = join(fileURLToPath(import.meta.url), '..', 'builtin');

const BUILTIN_TOOLS: Tool[] = [
  {
    name: 'weather',
    description: '查询指定城市的实时天气，返回温度、湿度、风速、风向、降水概率等信息',
    enabled: true,
    builtin: true,
    scriptPath: join(BUILTIN_DIR, 'weather.ts'),
    parameters: {
      type: 'object',
      properties: {
        city: { type: 'string', description: '城市名称，支持中文或英文' },
      },
      required: ['city'],
    },
  },
]

function getToolsConfigFile(): string {
  const home = process.env.HOME ?? homedir();
  return join(home, '.config', 'my-cli', 'tools.json');
}

function loadUserTools(): Tool[] {
  try {
    const content = readFileSync(getToolsConfigFile(), 'utf-8');
    const data = JSON.parse(content) as ToolsConfig;
    return data.tools ?? [];
  } catch {
    return [];
  }
}

export function loadTools(): Tool[] {
  const userTools = loadUserTools();

  const merged = BUILTIN_TOOLS.map(builtin => {
    const override = userTools.find(t => t.name === builtin.name);
    if (override) {
      return { ...builtin, enabled: override.enabled };
    }
    return builtin;
  });

  const customTools = userTools.filter(t => !BUILTIN_TOOLS.some(b => b.name === t.name));
  return [...merged, ...customTools];
}

export async function saveTools(tools: Tool[]): Promise<void> {
  const configFile = getToolsConfigFile();
  mkdirSync(dirname(configFile), { recursive: true });
  await Bun.write(configFile, JSON.stringify({ tools }, null, 2));
}

export async function addTool(tool: Tool): Promise<void> {
  const allTools = loadTools();
  const existing = allTools.find(t => t.name === tool.name);
  if (existing) {
    throw new Error(`工具 "${tool.name}" 已存在`);
  }
  const userTools = loadUserTools();
  userTools.push(tool);
  await saveTools(userTools);
}

export async function updateTool(name: string, patch: Partial<Tool>): Promise<void> {
  const allTools = loadTools();
  const target = allTools.find(t => t.name === name);
  if (!target) {
    throw new Error(`工具 "${name}" 不存在`);
  }

  if (target.builtin) {
    const userTools = loadUserTools();
    const existing = userTools.find(t => t.name === name);
    if (existing) {
      Object.assign(existing, patch);
      await saveTools(userTools);
    } else {
      userTools.push({ ...target, ...patch });
      await saveTools(userTools);
    }
    return;
  }

  const userTools = loadUserTools();
  const index = userTools.findIndex(t => t.name === name);
  if (index === -1) {
    throw new Error(`工具 "${name}" 不存在`);
  }
  Object.assign(userTools[index], patch);
  await saveTools(userTools);
}

export async function deleteTool(name: string): Promise<void> {
  const allTools = loadTools();
  const target = allTools.find(t => t.name === name);
  if (!target) {
    throw new Error(`工具 "${name}" 不存在`);
  }
  if (target.builtin) {
    throw new Error(`工具 "${name}" 是内置工具，无法删除（可使用 disable 禁用）`);
  }

  const userTools = loadUserTools();
  const index = userTools.findIndex(t => t.name === name);
  if (index === -1) {
    throw new Error(`工具 "${name}" 不存在`);
  }
  userTools.splice(index, 1);
  await saveTools(userTools);
}
