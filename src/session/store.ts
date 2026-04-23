import { mkdirSync, readdirSync, readFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { Session } from '../types/session.js';
import { loadConfig, saveConfig } from '../config/loader.js';
import { CLIError } from '../errors/base.js';

function getSessionsDir(): string {
  const home = process.env.HOME ?? homedir();
  return join(home, '.config', 'my-cli', 'sessions');
}

/**
 * 生成 Session ID: YYYYMMDD-HHmmss-<4位随机字母数字>
 */
function generateSessionId(): string {
  const now = new Date();
  const datePart = now.toISOString().slice(0, 10).replace(/-/g, '');
  const timePart = now.toISOString().slice(11, 19).replace(/:/g, '');
  const randomPart = Math.random().toString(36).slice(2, 6);
  return `${datePart}-${timePart}-${randomPart}`;
}

/**
 * 创建新 Session
 */
export async function createSession(name?: string): Promise<Session> {
  const id = generateSessionId();
  const now = new Date().toISOString();
  
  mkdirSync(getSessionsDir(), { recursive: true });
  
  const session: Session = {
    id,
    name: name ?? 'New Chat',
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
  
  const filePath = join(getSessionsDir(), `${id}.json`);
  await Bun.write(filePath, JSON.stringify(session, null, 2));
  
  await setActiveSessionId(id);
  
  return session;
}

/**
 * 获取 Session
 */
export async function getSession(id: string): Promise<Session> {
  const filePath = join(getSessionsDir(), `${id}.json`);
  
  try {
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as Session;
  } catch {
    throw new CLIError(`Session 不存在: ${id}`);
  }
}

/**
 * 更新 Session
 */
export async function updateSession(session: Session): Promise<void> {
  session.updatedAt = new Date().toISOString();
  const filePath = join(getSessionsDir(), `${session.id}.json`);
  await Bun.write(filePath, JSON.stringify(session, null, 2));
}

/**
 * 删除 Session
 */
export async function deleteSession(id: string): Promise<void> {
  const filePath = join(getSessionsDir(), `${id}.json`);
  
  try {
    unlinkSync(filePath);
  } catch {
    throw new CLIError(`Session 不存在: ${id}`);
  }
  
  const activeId = await getActiveSessionId();
  if (activeId === id) {
    await setActiveSessionId(null);
  }
}

/**
 * 列出所有 Session
 */
export async function listSessions(): Promise<Session[]> {
  const sessionsDir = getSessionsDir();
  try {
    readdirSync(sessionsDir);
  } catch {
    return [];
  }
  
  const files = readdirSync(sessionsDir)
    .filter(f => f.endsWith('.json'));
  
  const sessions: Session[] = files.map(f => {
    const filePath = join(sessionsDir, f);
    const content = readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as Session;
  });
  
  sessions.sort((a, b) => 
    new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
  
  return sessions;
}

/**
 * 获取活跃 Session ID
 */
export async function getActiveSessionId(): Promise<string | null> {
  const config = loadConfig();
  return config.activeSessionId ?? null;
}

/**
 * 设置活跃 Session ID
 */
export async function setActiveSessionId(id: string | null): Promise<void> {
  await saveConfig({ activeSessionId: id ?? undefined });
}

/**
 * 获取或创建活跃 Session
 */
export async function getOrCreateActiveSession(): Promise<Session> {
  const activeId = await getActiveSessionId();
  
  if (activeId) {
    try {
      return await getSession(activeId);
    } catch {
      return await createSession();
    }
  }
  
  return await createSession();
}