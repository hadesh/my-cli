import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  createSession,
  getSession,
  updateSession,
  deleteSession,
  listSessions,
  getActiveSessionId,
  setActiveSessionId,
  getOrCreateActiveSession,
} from './store.js';
import { CLIError } from '../errors/base.js';

const originalHome = process.env.HOME;

let tmpDir: string;

beforeEach(() => {
  tmpDir = `/tmp/my-cli-test-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  mkdirSync(tmpDir, { recursive: true });
  process.env.HOME = tmpDir;
  
  const configDir = join(tmpDir, '.config', 'my-cli');
  mkdirSync(configDir, { recursive: true });
  mkdirSync(join(configDir, 'sessions'), { recursive: true });
});

afterEach(() => {
  process.env.HOME = originalHome;
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('Session Store', () => {
  test('create and get session', async () => {
    const session = await createSession();
    const retrieved = await getSession(session.id);
    
    expect(retrieved.id).toBe(session.id);
    expect(retrieved.name).toBe('New Chat');
    expect(retrieved.messages).toEqual([]);
    expect(retrieved.createdAt).toBe(session.createdAt);
    expect(retrieved.updatedAt).toBe(session.updatedAt);
  });

  test('get nonexistent session throws', async () => {
    expect(async () => {
      await getSession('nonexistent');
    }).toThrow();
    
    try {
      await getSession('nonexistent');
    } catch (error) {
      expect(error).toBeInstanceOf(CLIError);
      expect((error as CLIError).message).toContain('Session 不存在');
    }
  });

  test('getOrCreate creates new when no active', async () => {
    const activeIdBefore = await getActiveSessionId();
    expect(activeIdBefore).toBeNull();
    
    const session = await getOrCreateActiveSession();
    
    expect(session).toBeDefined();
    expect(session.id).toBeDefined();
    expect(session.name).toBe('New Chat');
    
    const activeIdAfter = await getActiveSessionId();
    expect(activeIdAfter).toBe(session.id);
  });

  test('getOrCreate returns active session', async () => {
    const created = await createSession('Test Session');
    
    const retrieved = await getOrCreateActiveSession();
    
    expect(retrieved.id).toBe(created.id);
  });

  test('delete active session clears activeSessionId', async () => {
    const session = await createSession();
    
    const activeIdBefore = await getActiveSessionId();
    expect(activeIdBefore).toBe(session.id);
    
    await deleteSession(session.id);
    
    const activeIdAfter = await getActiveSessionId();
    expect(activeIdAfter).toBeNull();
  });

  test('list sessions returns all sorted by updatedAt', async () => {
    const session1 = await createSession('Session 1');
    
    await new Promise(resolve => setTimeout(resolve, 10));
    
    const session2 = await createSession('Session 2');
    
    const sessions = await listSessions();
    
    expect(sessions.length).toBe(2);
    expect(sessions.map(s => s.id)).toContain(session1.id);
    expect(sessions.map(s => s.id)).toContain(session2.id);
    
    const sortedIds = sessions.map(s => s.id);
    expect(sortedIds.indexOf(session2.id)).toBeLessThan(sortedIds.indexOf(session1.id));
  });

  test('update session', async () => {
    const session = await createSession('Original Name');
    
    await new Promise(resolve => setTimeout(resolve, 10));
    
    session.name = 'Updated Name';
    session.messages.push({
      role: 'user',
      content: 'Hello',
      timestamp: new Date().toISOString(),
    });
    
    await updateSession(session);
    
    const retrieved = await getSession(session.id);
    
    expect(retrieved.name).toBe('Updated Name');
    expect(retrieved.messages.length).toBe(1);
    expect(retrieved.messages[0].content).toBe('Hello');
    expect(retrieved.updatedAt).not.toBe(session.createdAt);
  });
});