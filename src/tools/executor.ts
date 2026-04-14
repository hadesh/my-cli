// Shell 命令执行器，支持 {{param}} 占位符替换，带超时、截断、安全转义

const MAX_OUTPUT_LENGTH = 4000
const DEFAULT_TIMEOUT = 30000

/**
 * 安全转义函数：处理 Shell 注入风险字符
 * 转义: \ → \\, " → \", $ → \$, ` → \`
 */
function escapeShellArg(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$')
    .replace(/`/g, '\\`')
}

/**
 * 替换 {{param}} 占位符
 * 未提供的参数保持原样
 */
function substitutePlaceholders(
  command: string,
  args: Record<string, string>
): string {
  return command.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = args[key]
    if (value === undefined) return `{{${key}}}`
    return escapeShellArg(value)
  })
}

/**
 * 执行工具命令
 * @param command - Shell 命令模板（含 {{param}} 占位符）
 * @param args - 参数字典（来自 LLM 的 tool_call arguments JSON）
 * @param timeoutMs - 超时毫秒，默认 30000
 * @returns 返回 stdout，失败返回错误描述（不抛出）
 */
export async function executeToolCommand(
  command: string,
  args: Record<string, string>,
  timeoutMs: number = DEFAULT_TIMEOUT
): Promise<string> {
  // 替换占位符
  const resolvedCommand = substitutePlaceholders(command, args)

  // 创建超时 Promise
  const timeoutPromise = new Promise<string>((_, reject) => {
    setTimeout(() => {
      reject(new Error('工具执行超时'))
    }, timeoutMs)
  })

  // 创建执行 Promise
  const execPromise = new Promise<string>(async (resolve) => {
    try {
      const proc = Bun.spawn(['sh', '-c', resolvedCommand], {
        stdout: 'pipe',
        stderr: 'pipe',
      })

      // 获取输出
      const stdoutPromise = new Response(proc.stdout).text()
      const stderrPromise = new Response(proc.stderr).text()

      // 等待进程结束
      const exitCode = await proc.exited
      const stdout = await stdoutPromise
      const stderr = await stderrPromise

      // 检查退出码
      if (exitCode !== 0) {
        resolve(stderr.trim() || `命令执行失败，退出码: ${exitCode}`)
        return
      }

      // 处理空输出
      const trimmedStdout = stdout.trim()
      if (trimmedStdout === '') {
        resolve('(no output)')
        return
      }

      // 截断长输出
      if (trimmedStdout.length > MAX_OUTPUT_LENGTH) {
        resolve(trimmedStdout.substring(0, MAX_OUTPUT_LENGTH) + '...(输出过长，已截断)')
        return
      }

      resolve(trimmedStdout)
    } catch (error) {
      // 捕获任何执行错误
      if (error instanceof Error) {
        resolve(error.message)
      } else {
        resolve(String(error))
      }
    }
  })

  // 竞争：执行 vs 超时
  try {
    return await Promise.race([execPromise, timeoutPromise])
  } catch (error) {
    // 超时或错误
    if (error instanceof Error && error.message === '工具执行超时') {
      return '工具执行超时'
    }
    return String(error)
  }
}
