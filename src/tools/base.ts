export interface ToolExecutor {
  execute(args: Record<string, unknown>): Promise<string>
}
