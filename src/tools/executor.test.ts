import { describe, it, expect } from 'bun:test'
import { executeToolCommand } from './executor'

describe('executeToolCommand', () => {
  // 测试1: 占位符替换正常工作
  it('should replace placeholders correctly', async () => {
    const result = await executeToolCommand('echo {{message}}', { message: 'hello' })
    expect(result).toContain('hello')
  })

  // 测试2: 未提供的占位符保持原样
  it('should keep placeholders for missing args', async () => {
    const result = await executeToolCommand('echo {{missing}}', {})
    expect(result).toContain('{{missing}}')
  })

  // 测试3: $ 字符被正确转义
  it('should escape $ character to prevent injection', async () => {
    // 如果 $ 没有被转义，$HOME 会被展开
    const result = await executeToolCommand('echo {{value}}', { value: '$HOME' })
    // 如果转义正确，应该输出 $HOME 而不是展开它
    expect(result).toBe('$HOME')
  })

  // 测试4: 空输出返回 (no output)
  it('should return (no output) for empty stdout', async () => {
    const result = await executeToolCommand('printf ""', {})
    expect(result).toBe('(no output)')
  })

  // 测试5: 命令执行失败返回错误信息
  it('should return error message on command failure', async () => {
    const result = await executeToolCommand('nonexistentcommand', {})
    // 应该返回 stderr 或包含错误描述
    expect(result.length).toBeGreaterThan(0)
  })

  // 测试6: 超时返回 "工具执行超时"
  it('should return timeout message when command exceeds timeout', async () => {
    const result = await executeToolCommand('sleep 5', {}, 100)
    expect(result).toBe('工具执行超时')
  })
})
