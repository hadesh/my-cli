# my-cli 项目 AI 文档

## 项目定位

`my-cli` 是一个基于 **Bun + TypeScript** 的本地命令行 AI 助手工具。入口为 `src/main.ts`，通过树形命令注册系统路由所有子命令，核心能力是与 LLM 进行多轮对话、管理会话历史、支持工具调用（Function Calling）。

---

## 目录结构

```
src/
├── main.ts                    # 入口，注册所有命令并路由
├── registry.ts                # 树形命令注册/解析器（Registry）
├── command.ts                 # Command 接口定义
├── args.ts                    # CLI 参数解析（flags / positional / command）
├── config/
│   ├── schema.ts              # Config zod schema（含 model、contextWindow、activeSessionId）
│   ├── loader.ts              # 读写 ~/.config/my-cli/config.json
│   └── paths.ts               # 所有配置文件路径常量
├── types/
│   ├── llm.ts                 # ChatMessage、LLMProvider、ModelInfo、ToolCall 等类型
│   ├── session.ts             # Session、Message、SessionIndex 类型
│   └── tool.ts                # Tool、ToolParameters、ToolsConfig 类型
├── llm/
│   ├── config.ts              # 读写 llm-providers.json，提供 getDefaultProvider/addProvider 等
│   └── client.ts              # streamChat（流式）和 chatWithTools（非流式）HTTP 调用
├── session/
│   └── store.ts               # Session CRUD，活跃 session 管理
├── tools/
│   ├── base.ts                # ToolExecutor 接口
│   ├── store.ts               # 工具加载/保存/增删改，内置+用户工具合并
│   ├── executor.ts            # Bun.spawn 执行工具脚本
│   └── builtin/
│       └── weather.ts         # 内置天气工具
├── commands/
│   ├── ask.ts                 # 核心 LLM 对话命令（含工具调用循环、context 输出）
│   ├── session.ts             # session new/list/switch/delete/info 子命令
│   ├── llm.ts                 # llm add/list/use 子命令
│   ├── init.ts                # 交互式生成 agent.md
│   ├── tools.ts               # tools add/list/enable/disable/delete 子命令
│   └── core/
│       ├── hello.ts
│       └── weather.ts
├── utils/
│   ├── tokenizer.ts           # tiktoken cl100k_base 单例封装（countTokens/freeEncoder）
│   └── context.ts             # calcContextStats/formatContextLine 统一 context 统计
├── output/
│   ├── markdown.ts            # marked + chalk 终端 Markdown 渲染
│   ├── text.ts                # print/printTable 输出工具
│   └── formatter.ts           # success/warn/info 格式化输出
└── errors/
    ├── base.ts                # CLIError/UsageError/AuthError/NetworkError/LLMError
    ├── codes.ts               # ExitCode 枚举
    └── handler.ts             # 全局错误处理
```

---

## 配置文件（~/.config/my-cli/）

| 文件 | 说明 |
|------|------|
| `config.json` | 通用配置，zod schema 校验，含 `model`、`contextWindow`、`activeSessionId` 等字段 |
| `llm-providers.json` | LLM provider 配置，含 provider 列表、每个 provider 的 models 及 context limit |
| `agent.md` | 系统提示文件（HIBot 角色定义），每次 `ask` 时作为第一条 system message 注入；由 `init` 命令交互式生成 |
| `sessions/<id>.json` | 单个 session 的持久化 JSON 文件 |
| `tools.json` | 用户自定义工具配置列表 |

**当前关键配置值：**
- `config.model` = `"bailian-coding-plan/qwen3.5-flash"`
- `config.contextWindow` = `20`（滑动窗口，保留最近 N 条消息）
- qwen3.5-flash context limit = `1,000,000` tokens
- `defaultProvider` = `"bailian-coding-plan"`

---

## 命令系统

### Registry 树形路由

`src/registry.ts` 实现树形 `Registry`，支持多级子命令：

```
my-cli
├── ask              # LLM 对话（核心命令）
├── session          # 会话管理
│   ├── new
│   ├── list
│   ├── switch
│   ├── delete
│   └── info
├── llm              # LLM provider 管理
│   ├── add
│   ├── list
│   └── use
├── init             # 交互式初始化 agent.md
├── tools            # 工具管理
│   ├── add
│   ├── list
│   ├── enable
│   ├── disable
│   └── delete
├── hello
└── weather
```

### Command 接口

```typescript
interface Command {
  name: string;
  description: string;
  usage: string;
  examples: string[];
  execute(config: Config, flags: Record<string, unknown>, args: string[]): Promise<void>;
}
```

---

## 核心流程：ask 命令（src/commands/ask.ts）

1. **解析参数**：`--session`、`--provider`、`--verbose`、`--timeout`
2. **获取 Provider**：从 `llm-providers.json` 读取，默认使用 `defaultProvider`
3. **加载 agent.md**：读取 `~/.config/my-cli/agent.md`，作为第一条 system message
4. **加载/创建 Session**：从 JSON 文件加载历史，若无活跃 session 则自动新建
5. **滑动窗口裁剪**：`session.messages.slice(-contextWindow)`，默认保留最近 20 条
6. **构造 messages**：`[system(agentMd), ...recentMessages, user(message)]`
7. **工具调用循环（最多 10 次）**：
   - 有启用工具 → `chatWithTools`（非流式）→ 检测 `tool_calls`
   - 有 `tool_calls` → `Bun.spawn` 执行脚本 → 结果作为 tool message 追加 → 继续循环
   - 无 `tool_calls` → `streamChat`（流式）输出最终回复
   - 无工具 → 直接 `streamChat`
8. **渲染输出**：`marked` + `marked-terminal` + `chalk` 将 Markdown 渲染为终端彩色输出
9. **Context 统计**：输出到 stderr，格式 `Context: 2.3K (0.2%)`
10. **保存 Session**：追加 user/assistant 消息，写盘

---

## Session 管理（src/session/store.ts）

- **ID 格式**：`YYYYMMDD-HHmmss-xxxx`（时间戳 + 4 位随机）
- **持久化**：每个 session 存为独立 JSON 文件 `~/.config/my-cli/sessions/<id>.json`
- **活跃 session**：ID 存于 `config.json` 的 `activeSessionId` 字段
- **自动创建**：`getOrCreateActiveSession()` 若无活跃 session 则自动新建并激活

---

## LLM 调用（src/llm/client.ts）

| 函数 | 说明 |
|------|------|
| `streamChat(provider, messages, onChunk, opts)` | 流式调用，逐 chunk 输出，返回完整回复字符串 |
| `chatWithTools(provider, messages, toolDefs, opts)` | 非流式调用，返回完整响应对象（含 `tool_calls`） |

---

## 工具系统（src/tools/）

- **内置工具**：`src/tools/builtin/weather.ts`，硬编码在 store 中
- **用户工具**：配置存于 `~/.config/my-cli/tools.json`，含工具名、描述、参数 schema、脚本路径
- **执行方式**：`Bun.spawn(['bun', 'run', scriptPath, JSON.stringify(args)])`，超时 30 秒
- **启用/禁用**：每个工具有 `enabled` 字段，`ask` 时只加载 `enabled: true` 的工具

---

## Context 统计（src/utils/context.ts）

`ask` 和 `session info` 两处使用**完全相同**的统计逻辑：

```typescript
const contextWindow = config.contextWindow ?? 20;
const recentMessages = session.messages.slice(-contextWindow);
const messageText = recentMessages.map(m => m.content).join('');
const stats = await calcContextStats([agentMd, messageText], config);
// stats = { totalTokens, contextLimit }
// 输出格式："Context: 2.3K (0.2%)"
```

- `totalTokens`：tiktoken `cl100k_base` 统计所有文本的 token 数
- `contextLimit`：从 `llm-providers.json` 的 `providers[name].models[modelId].limit.context` 读取
- 百分比 = `totalTokens / contextLimit * 100`，表示**占模型上下文窗口的比例**

---

## Token 计数（src/utils/tokenizer.ts）

- 使用 `tiktoken` 的 `cl100k_base` 编码
- 单例懒加载，首次调用时初始化，后续复用
- 每次命令结束后必须调用 `freeEncoder()` 释放 WASM 内存

---

## 输出渲染

| 模块 | 说明 |
|------|------|
| `src/output/markdown.ts` | `renderMarkdown(text)` → 终端彩色 Markdown 渲染 |
| `src/output/text.ts` | `print()`、`printTable()` 纯文本/表格输出 |
| `src/output/formatter.ts` | `success()`、`warn()`、`info()` 带图标格式化输出 |

---

## 错误处理（src/errors/）

| 类 | ExitCode | 说明 |
|----|----------|------|
| `CLIError` | - | 基类，含 `exitCode` |
| `UsageError` | 1 | 用法错误 |
| `AuthError` | 2 | 认证失败 |
| `NetworkError` | 3 | 网络错误 |
| `LLMError` | 4 | LLM 调用失败 |

---

## 依赖

| 包 | 用途 |
|----|------|
| `chalk` | 终端彩色输出 |
| `marked` | Markdown 解析 |
| `marked-terminal` | Markdown → 终端渲染 |
| `tiktoken` | Token 计数（cl100k_base） |
| `zod` | Config schema 校验 |
