import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import type { Tool, ToolsConfig } from '../types/tool.js';

function getToolsConfigFile(): string {
  const home = process.env.HOME ?? homedir();
  return join(home, '.config', 'my-cli', 'tools.json');
}

export function loadTools(): Tool[] {
  try {
    const content = readFileSync(getToolsConfigFile(), 'utf-8');
    const data = JSON.parse(content) as ToolsConfig;
    return data.tools ?? [];
  } catch {
    return [];
  }
}

export async function saveTools(tools: Tool[]): Promise<void> {
  const configFile = getToolsConfigFile();
  mkdirSync(dirname(configFile), { recursive: true });
  await Bun.write(configFile, JSON.stringify({ tools }, null, 2));
}

export async function addTool(tool: Tool): Promise<void> {
  const tools = loadTools();
  const existing = tools.find(t => t.name === tool.name);
  if (existing) {
    throw new Error(`工具 "${tool.name}" 已存在`);
  }
  tools.push(tool);
  await saveTools(tools);
}

export async function updateTool(name: string, patch: Partial<Tool>): Promise<void> {
  const tools = loadTools();
  const index = tools.findIndex(t => t.name === name);
  if (index === -1) {
    throw new Error(`工具 "${name}" 不存在`);
  }
  Object.assign(tools[index], patch);
  await saveTools(tools);
}

export async function deleteTool(name: string): Promise<void> {
  const tools = loadTools();
  const index = tools.findIndex(t => t.name === name);
  if (index === -1) {
    throw new Error(`工具 "${name}" 不存在`);
  }
  tools.splice(index, 1);
  await saveTools(tools);
}
