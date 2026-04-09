import { CLIError } from './base.js';
import { ExitCode } from './codes.js';

/**
 * 顶层错误处理：输出错误信息并以对应退出码退出进程
 */
export function handleError(err: unknown): never {
  if (err instanceof CLIError) {
    console.error(`[错误] ${err.message}`);
    process.exit(err.exitCode);
  }

  if (err instanceof Error) {
    console.error(`[未知错误] ${err.message}`);
    if (process.env['DEBUG']) {
      console.error(err.stack);
    }
  } else {
    console.error('[未知错误]', err);
  }

  process.exit(ExitCode.GENERAL);
}
