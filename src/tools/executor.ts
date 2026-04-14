const MAX_OUTPUT_LENGTH = 4000
const DEFAULT_TIMEOUT = 30000

export async function executeToolCommand(
  scriptPath: string,
  args: Record<string, string>,
  timeoutMs: number = DEFAULT_TIMEOUT
): Promise<string> {
  const timeoutPromise = new Promise<string>((_, reject) => {
    setTimeout(() => {
      reject(new Error('工具执行超时'))
    }, timeoutMs)
  })

  const execPromise = new Promise<string>(async (resolve) => {
    try {
      const proc = Bun.spawn(['bun', 'run', scriptPath, JSON.stringify(args)], {
        stdout: 'pipe',
        stderr: 'pipe',
      })

      const stdoutPromise = new Response(proc.stdout).text()
      const stderrPromise = new Response(proc.stderr).text()

      const exitCode = await proc.exited
      const stdout = await stdoutPromise
      const stderr = await stderrPromise

      if (exitCode !== 0) {
        resolve(stderr.trim() || `工具执行失败，退出码: ${exitCode}`)
        return
      }

      const trimmedStdout = stdout.trim()
      if (trimmedStdout === '') {
        resolve('(no output)')
        return
      }

      if (trimmedStdout.length > MAX_OUTPUT_LENGTH) {
        resolve(trimmedStdout.substring(0, MAX_OUTPUT_LENGTH) + '...(输出过长，已截断)')
        return
      }

      resolve(trimmedStdout)
    } catch (error) {
      if (error instanceof Error) {
        resolve(error.message)
      } else {
        resolve(String(error))
      }
    }
  })

  try {
    return await Promise.race([execPromise, timeoutPromise])
  } catch (error) {
    if (error instanceof Error && error.message === '工具执行超时') {
      return '工具执行超时'
    }
    return String(error)
  }
}
