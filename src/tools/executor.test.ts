import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { executeToolCommand } from './executor'

let tmpDir: string

beforeAll(() => {
  tmpDir = `/tmp/executor-test-${Date.now()}`
  mkdirSync(tmpDir, { recursive: true })
})

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

function writeTool(name: string, body: string): string {
  const path = join(tmpDir, `${name}.ts`)
  writeFileSync(path, body, 'utf-8')
  return path
}

describe('executeToolCommand', () => {
  it('should pass args and return stdout', async () => {
    const scriptPath = writeTool('echo', `
const args = JSON.parse(process.argv[2] ?? '{}')
process.stdout.write(args.message + '\\n')
`)
    const result = await executeToolCommand(scriptPath, { message: 'hello' })
    expect(result).toContain('hello')
  })

  it('should return (no output) for empty stdout', async () => {
    const scriptPath = writeTool('empty', ``)
    const result = await executeToolCommand(scriptPath, {})
    expect(result).toBe('(no output)')
  })

  it('should return error info when script exits non-zero', async () => {
    const scriptPath = writeTool('fail', `
process.stderr.write('something went wrong\\n')
process.exit(1)
`)
    const result = await executeToolCommand(scriptPath, {})
    expect(result.length).toBeGreaterThan(0)
    expect(result).toContain('something went wrong')
  })

  it('should return timeout message when script exceeds timeout', async () => {
    const scriptPath = writeTool('slow', `
await Bun.sleep(5000)
`)
    const result = await executeToolCommand(scriptPath, {}, 100)
    expect(result).toBe('工具执行超时')
  })

  it('should pass complex args as JSON', async () => {
    const scriptPath = writeTool('json-args', `
const args = JSON.parse(process.argv[2] ?? '{}')
process.stdout.write(JSON.stringify({ received: args }) + '\\n')
`)
    const result = await executeToolCommand(scriptPath, { city: '北京', lang: 'zh' })
    const parsed = JSON.parse(result)
    expect(parsed.received.city).toBe('北京')
    expect(parsed.received.lang).toBe('zh')
  })
})
