export interface ToolExecutor {
  execute(args: Record<string, string>): Promise<string>
}
