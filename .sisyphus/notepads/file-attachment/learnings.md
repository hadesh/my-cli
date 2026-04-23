# file-attachment Learnings

## 2026-04-23 — 项目初始化

### 代码约定
- 项目使用 Bun + TypeScript，入口 src/main.ts
- 错误处理：使用 src/errors/base.ts 中的 UsageError/CLIError 等
- 工具函数放 src/utils/ 目录
- 命令文件放 src/commands/ 目录
- 类型定义放 src/types/ 目录

### 关键文件位置
- ChatMessage 类型：src/types/llm.ts:4-9（content 当前为 string）
- args 解析：src/args.ts:7-44（多次同名 flag 会覆盖，需修改）
- ask 命令：src/commands/ask.ts（消息构造在第 107-122 行）
- context 统计：src/utils/context.ts（calcContextStats 接收 string[]）

### Bun 文件 API
- Bun.file(path).text() — 读取文本
- Bun.file(path).arrayBuffer() — 读取二进制
- Bun.file(path).size — 文件大小（bytes）
- Bun.file(path).exists() — 检查是否存在（返回 Promise<boolean>）
