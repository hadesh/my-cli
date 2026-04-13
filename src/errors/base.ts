import { ExitCode } from './codes.js';

/**
 * CLI 统一错误基类
 */
export class CLIError extends Error {
  readonly exitCode: ExitCode;

  constructor(message: string, exitCode: ExitCode = ExitCode.GENERAL) {
    super(message);
    this.name = 'CLIError';
    this.exitCode = exitCode;
  }
}

export class UsageError extends CLIError {
  constructor(message: string) {
    super(message, ExitCode.USAGE);
    this.name = 'UsageError';
  }
}

export class AuthError extends CLIError {
  constructor(message: string) {
    super(message, ExitCode.AUTH);
    this.name = 'AuthError';
  }
}

export class NetworkError extends CLIError {
  readonly statusCode: number | undefined;

  constructor(message: string, statusCode?: number) {
    super(message, ExitCode.NETWORK);
    this.name = 'NetworkError';
    this.statusCode = statusCode;
  }
}

export class HttpError extends NetworkError {
  readonly body: unknown;

  constructor(statusCode: number, message: string, body: unknown) {
    super(`HTTP ${statusCode}: ${message}`, statusCode);
    this.name = 'HttpError';
    this.body = body;
  }
}

export class LLMError extends CLIError {
  constructor(message: string) {
    super(message, ExitCode.LLM);
    this.name = 'LLMError';
  }
}
