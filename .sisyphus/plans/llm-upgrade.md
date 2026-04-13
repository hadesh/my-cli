# CLI 大模型升级实现方案

## TL;DR

> **Quick Summary**: 为现有 TypeScript + Bun CLI 工具新增大模型能力，支持流式问答、多 provider 管理、session 上下文持久化、全局 agent.md system prompt。
>
> **Deliverables**:
> - `ask` 命令：流式问答，支持 --session 指定会话
> - `init` 命令：交互式引导生成 agent.md
> - `session` 命令组：new / list / switch / delete
> - `llm` 命令组：add / list / use（多 provider 管理）
> - 单元测试（bun test）覆盖所有核心模块
>
> **Estimated Effort**: Large
> **Parallel Execution**: YES — 5 Waves
> **Critical Path**: Task 1 (Foundation) → Task 2 (Session Store) + Task 3 (LLM Client) → Task 7 (Ask Command) → Final QA

---

## Context

### Original Request
> 把 CLI 工具进行升级，支持大模型的接入。支持大模型问答，支持配置各家大模型服务，支持初始化时设置全局信息到 agent.md，每次问答进行加载；支持 session 管理，每次对话为一次 session，可以新建对话开启新 session；每次对话保存上下文到 session。

### Interview Summary

**Key Discussions**:
- 交互模式：单次命令调用 `my-cli ask "问题"`，不做 REPL
- 输出：流式 streaming，实时打印到 stdout
- LLM 服务商：OpenAI 协议层兼容（DeepSeek、通义千问等）
- Session 默认行为：使用活跃 Session（`ask` 不带 `--session` 时自动续上次对话；没有活跃 session 则自动新建）
- agent.md：自由 Markdown 格式，`init` 交互式引导填写，整体作为 system prompt 前缀注入
- Context 策略：滑动窗口，默认保留最近 20 条消息（可配置）
- LLM 配置存储：独立文件 `~/.config/my-cli/llm-providers.json`
- Session 存储：`~/.config/my-cli/sessions/<id>.json`

**Research Findings**:
- `src/client/http.ts` 已有 `requestStream` 方法（基于 Bun fetch），可作为 SSE 解析的基础
- 现有 `requestStream` 返回 raw chunks，需在上层加 SSE 行解析（`data: ` 前缀处理）
- `src/config/paths.ts` 有 CONFIG_DIR 常量，需扩展 SESSIONS_DIR、AGENT_MD_FILE、LLM_CONFIG_FILE
- `src/errors/base.ts` 需新增 `LLMError`
- 命令注册在 `src/main.ts` + `src/registry.ts`，follow 现有 weather/hello 模式

### Metis Review — 识别并已处理的 Gap

- **活跃 Session 行为**（已决策）：ask 自动使用活跃 session，无则新建
- **agent.md 格式**（已决策）：纯 Markdown，整体注入 system prompt
- **LLM 配置隔离**（已决策）：独立 `llm-providers.json`，不污染 credentials.json
- **SSE 解析层缺失**（已纳入方案）：需在 LLM Client 层加 `data: ` 行解析
- **滑动窗口默认值**（已定）：默认 20 条，写入 config schema
- **Session ID 格式**（已定）：`YYYYMMDD-HHMMSS-<4位随机串>`，例 `20260410-143022-a3f9`

---

## Work Objectives

### Core Objective
在不破坏现有 hello/weather 命令的前提下，新增 LLM 问答全套能力：ask、init、session 管理、llm provider 管理，以及覆盖核心逻辑的单元测试。

### Concrete Deliverables
- `src/types/llm.ts` — OpenAI 兼容请求/响应类型
- `src/types/session.ts` — Session、Message 接口
- `src/llm/client.ts` + `src/llm/client.test.ts`
- `src/llm/config.ts` + `src/llm/config.test.ts`
- `src/session/store.ts` + `src/session/store.test.ts`
- `src/commands/ask.ts` + `src/commands/ask.test.ts`
- `src/commands/init.ts` + `src/commands/init.test.ts`
- `src/commands/session.ts` + `src/commands/session.test.ts`
- `src/commands/llm.ts` + `src/commands/llm.test.ts`
- 扩展 `src/config/paths.ts`（新增路径常量）
- 扩展 `src/config/schema.ts`（新增 contextWindow 字段）
- 扩展 `src/errors/base.ts`（新增 LLMError）

### Definition of Done
- [ ] `bun test` 全部通过，0 failure
- [ ] `my-cli ask "Hello"` 流式输出 LLM 回复（需配置好 provider）
- [ ] `my-cli init` 引导填写并生成 `~/.config/my-cli/agent.md`
- [ ] `my-cli session list` 列出所有 sessions
- [ ] `my-cli llm list` 列出所有 providers

### Must Have
- OpenAI `/v1/chat/completions` 协议兼容
- SSE 流式输出到 stdout
- Session JSON 持久化到 `~/.config/my-cli/sessions/`
- LLM Provider 配置持久化到 `llm-providers.json`
- 滑动窗口上下文裁剪

### Must NOT Have（Guardrails）
- **禁止**交互式 REPL / chat 模式（无 `my-cli chat` 命令）
- **禁止** Tool/Function Calling
- **禁止**多模态（图片/文件）
- **禁止**本地模型支持（Ollama 等）
- **禁止**修改 hello / weather 命令逻辑
- **禁止**破坏现有 config schema（只追加，不删改）
- **禁止**在 `test/` 以外目录创建集成测试
- **禁止**过度抽象（不为假想的未来需求预设扩展点）
- **禁止**会话 import/export/sync
- **禁止**消息编辑/删除

---

## 新增目录结构

```
src/
├── types/
│   ├── llm.ts          # OpenAI 兼容类型（ChatMessage, ChatRequest, ChatResponse, StreamChunk...）
│   └── session.ts      # Session, Message 接口
├── llm/
│   ├── client.ts       # SSE 流式 LLM 调用（基于 src/client/http.ts requestStream）
│   ├── client.test.ts
│   ├── config.ts       # Provider CRUD（读写 llm-providers.json）
│   └── config.test.ts
├── session/
│   ├── store.ts        # Session JSON 文件 CRUD + 活跃 session 管理
│   └── store.test.ts
└── commands/
    ├── ask.ts          # ask 命令
    ├── ask.test.ts
    ├── init.ts         # init 命令
    ├── init.test.ts
    ├── session.ts      # session 子命令组
    ├── session.test.ts
    ├── llm.ts          # llm 子命令组
    └── llm.test.ts

# 配置文件（~/.config/my-cli/）
~/.config/my-cli/
├── config.json           # 现有（新增 activeSessionId, contextWindow 字段）
├── credentials.json      # 现有（不变）
├── llm-providers.json    # 新增 —— LLM provider 列表 + 当前默认
├── agent.md              # 新增 —— 全局 system prompt
└── sessions/
    ├── 20260410-143022-a3f9.json
    └── 20260410-160055-b7e2.json
```

---

## 数据结构定义

### `src/types/llm.ts`

```typescript
// OpenAI 兼容
export type ChatRole = 'system' | 'user' | 'assistant'

export interface ChatMessage {
  role: ChatRole
  content: string
}

export interface ChatRequest {
  model: string
  messages: ChatMessage[]
  stream: boolean
  temperature?: number
  max_tokens?: number
}

export interface ChatChunk {
  id: string
  object: 'chat.completion.chunk'
  choices: Array<{
    delta: { role?: ChatRole; content?: string }
    finish_reason: string | null
  }>
}

export interface LLMProvider {
  name: string        // 唯一标识，用户自定义
  baseUrl: string     // 例 https://api.deepseek.com
  apiKey: string
  model: string       // 例 deepseek-chat
}

export interface LLMConfig {
  providers: LLMProvider[]
  defaultProvider: string  // provider name
}
```

### `src/types/session.ts`

```typescript
export interface Message {
  role: 'user' | 'assistant'
  content: string
  timestamp: string  // ISO 8601
}

export interface Session {
  id: string          // YYYYMMDD-HHMMSS-<4位随机>
  name: string        // 用户自定义名称，默认 "New Chat"
  createdAt: string   // ISO 8601
  updatedAt: string
  messages: Message[]
}

export interface SessionIndex {
  sessions: string[]  // session id 列表
  activeSessionId: string | null
}
```

### `~/.config/my-cli/llm-providers.json`

```json
{
  "providers": [
    {
      "name": "deepseek",
      "baseUrl": "https://api.deepseek.com",
      "apiKey": "sk-xxx",
      "model": "deepseek-chat"
    }
  ],
  "defaultProvider": "deepseek"
}
```

### `~/.config/my-cli/sessions/<id>.json`

```json
{
  "id": "20260410-143022-a3f9",
  "name": "New Chat",
  "createdAt": "2026-04-10T14:30:22.000Z",
  "updatedAt": "2026-04-10T14:35:10.000Z",
  "messages": [
    { "role": "user", "content": "Hello", "timestamp": "2026-04-10T14:30:22.000Z" },
    { "role": "assistant", "content": "Hi! How can I help?", "timestamp": "2026-04-10T14:30:25.000Z" }
  ]
}
```

### `~/.config/my-cli/config.json`（扩展字段）

```json
{
  "activeSessionId": "20260410-143022-a3f9",
  "contextWindow": 20
}
```

---

## 命令设计

### `my-cli ask <message> [--session <id>]`

```
用法：my-cli ask "你的问题" [--session <session-id>]

流程：
1. 读取 llm-providers.json，获取默认 provider
2. 读取 agent.md，构造 system prompt
3. 加载 session（--session 指定 > activeSessionId > 新建）
4. 取最近 contextWindow 条消息组成 messages 数组
5. 追加本次 user message
6. POST /v1/chat/completions（stream: true），SSE 实时打印
7. 收集完整 assistant reply，追加到 session
8. 保存 session，更新 activeSessionId

错误处理：
- 未配置 provider → UsageError "请先运行 my-cli llm add 添加 LLM 服务"
- --session 指定 ID 不存在 → CLIError "Session 不存在: <id>"
- API 返回非 2xx → LLMError（含状态码和响应体）
- Ctrl+C 中断 → 保存已收到的部分回复后退出
```

### `my-cli init`

```
用法：my-cli init

交互式引导（使用 readline）：
> 助手名称（default: "Assistant"）：_
> 角色设定（如：你是一个专注于 TypeScript 的编程助手）：_
> 回答风格（如：简洁、详细、代码优先）：_
> 其他注意事项（可空）：_

生成 ~/.config/my-cli/agent.md 内容：
"""
# Agent Profile

你的名字是 {name}。

## 角色
{role}

## 回答风格
{style}

## 注意事项
{notes}
"""

已存在时：提示 "agent.md 已存在，是否覆盖？(y/N)"
```

### `my-cli session <subcommand>`

```
my-cli session new [name]        # 新建 session，打印 session ID
my-cli session list              # 列出所有 session（ID、名称、消息数、最后更新）
my-cli session switch <id>       # 切换活跃 session，更新 config.json
my-cli session delete <id>       # 删除 session 文件；若为活跃 session 则清空 activeSessionId
```

### `my-cli llm <subcommand>`

```
my-cli llm add                   # 交互式引导：name, baseUrl, apiKey, model
my-cli llm list                  # 列出所有 provider，当前默认标 (*)
my-cli llm use <name>            # 设置默认 provider，更新 llm-providers.json
```

---

## SSE 解析实现要点

```
// 现有 requestStream 返回 AsyncIterable<Uint8Array>（原始字节流）
// 需在 LLM Client 层加解析：

for await (const chunk of stream) {
  const text = new TextDecoder().decode(chunk)
  for (const line of text.split('\n')) {
    if (!line.startsWith('data: ')) continue
    const data = line.slice(6).trim()
    if (data === '[DONE]') break
    const parsed: ChatChunk = JSON.parse(data)
    const content = parsed.choices[0]?.delta?.content ?? ''
    process.stdout.write(content)
    fullReply += content
  }
}
```

---

## Verification Strategy

### Test Decision
- **Infrastructure exists**: NO（test/ 目录为空）
- **Automated tests**: Tests-after（实现后补充单元测试）
- **Framework**: bun test（`bun:test` 模块）
- **Test 文件位置**: 与源文件同目录（`src/llm/client.test.ts`）

### QA Policy
- 每个任务 MUST 包含 agent 可执行的 QA 场景
- LLM 调用：mock fetch，不需要真实 API key
- 文件 I/O：使用临时目录（`/tmp/my-cli-test-<random>`）
- CLI 命令：通过 `bun run src/main.ts <args>` 执行

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately - 基础 + 类型，无依赖):
├── Task 1: Foundation（类型定义 + 路径常量 + LLMError）[quick]

Wave 2 (After Wave 1 - 核心模块，可并行):
├── Task 2: Session Store（src/session/store.ts + 测试）[deep]
└── Task 3: LLM Client（src/llm/client.ts + 测试）[deep]

Wave 3 (After Wave 2 - 命令实现，可并行):
├── Task 4: session 命令组（src/commands/session.ts）[quick]
├── Task 5: llm 命令组 + config（src/commands/llm.ts + src/llm/config.ts）[quick]
└── Task 6: init 命令（src/commands/init.ts）[quick]

Wave 4 (After Wave 3 - 核心命令):
└── Task 7: ask 命令（src/commands/ask.ts + 测试）[deep]

Wave FINAL (After ALL tasks — 并行验收):
├── Task F1: 方案符合性审计（oracle）
├── Task F2: 代码质量检查（unspecified-high）
└── Task F3: 全量 QA 场景执行（unspecified-high）
→ 呈现结果 → 等用户确认

Critical Path: Task 1 → Task 2 → Task 7 → F1-F3 → 用户确认
Parallel Speedup: ~60% 快于串行
```

### Dependency Matrix

| Task | 依赖 | 被依赖 |
|------|------|--------|
| 1. Foundation | - | 2, 3, 4, 5, 6, 7 |
| 2. Session Store | 1 | 4, 7 |
| 3. LLM Client | 1 | 7 |
| 4. session 命令 | 2 | F1-F3 |
| 5. llm 命令 + config | 1 | 7, F1-F3 |
| 6. init 命令 | 1 | 7, F1-F3 |
| 7. ask 命令 | 2, 3, 5, 6 | F1-F3 |
| F1-F3 | 1-7 | - |

### Agent Dispatch Summary

- **Wave 1**: 1 task — T1 → `quick`
- **Wave 2**: 2 tasks — T2 → `deep`, T3 → `deep`
- **Wave 3**: 3 tasks — T4 → `quick`, T5 → `quick`, T6 → `quick`
- **Wave 4**: 1 task — T7 → `deep`
- **Final**: 3 tasks — F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`

---

## TODOs

- [ ] 1. Foundation：类型定义 + 路径常量 + LLMError + args 解析修复 + config 写接口

  **What to do**:

  **1a. 修复 `src/args.ts` 参数解析 + `src/main.ts` 子命令分发（先做，其他命令依赖）**：

  **args.ts 修改**：
  - 当前 bug：`parseArgs` 会把子命令后的所有非 flag 词都吞进 `command` 数组（第 38-45 行子命令循环），导致 `my-cli ask "hello"` → `command=['ask','hello'], positional=[]`，而正确行为应为 `command=['ask'], positional=['hello']`
  - 实际修改方式（最小改动）：去掉第 36-45 行的子命令自动吞词循环，改为：`command` 只取第一个非 flag 词；后续非 flag 词全部进 `positional`
  - 新行为示例：
    ```
    my-cli ask "hello world"   → command=['ask'], positional=['hello world']
    my-cli session new "chat"  → command=['session'], positional=['new', 'chat']
    my-cli llm use deepseek    → command=['llm'], positional=['use', 'deepseek']
    my-cli weather 北京         → command=['weather'], positional=['北京']
    ```

  **main.ts + registry.ts 修改（支持子命令组二次分发）**：
  - 当前 `main.ts` 用 `registry.resolve(parsed.command)` 解析完整命令路径（如 `['session', 'new']`），但改 args.ts 后 `parsed.command` 只有 `['session']`，`registry.resolve(['session'])` 找不到叶子命令 → 会 fallback 到 help 或报错
  - **修改方案**：`main.ts` 中对 `session` / `llm` 这类"命令组"，查到顶层命令后，由命令自身的 `execute(args)` 负责二次路由，使用 `args.positional[0]` 判断子命令
  - 具体实现：在 `src/commands/session.ts` 和 `src/commands/llm.ts` 内部，通过 `args.positional[0]` switch 到对应的子命令函数
  - `src/registry.ts` 只需注册顶层命令（`session`、`llm`、`ask`、`init`），不需要注册 `session new`、`llm add` 等二级路径
  - **验证 hello/weather 不受影响**：这两个命令是叶子节点，改法不影响它们，但必须在修改后运行 `bun run src/main.ts weather 北京` 验证

  **1b. 在 `src/config/loader.ts` 新增 `saveConfig()` 写接口**：
  - 新增函数：
    ```typescript
    export async function saveConfig(partial: Partial<Config>): Promise<void>
    // 读取现有 config.json（若不存在则 {}）→ 合并 partial → 写回 CONFIG_FILE
    ```
  - 使用 `Bun.write(CONFIG_FILE, JSON.stringify(merged, null, 2))` 写入
  - Task 2 的 `setActiveSessionId()` 和后续命令通过此接口写 `activeSessionId`
  - **Must NOT**：不修改 `loadConfig()` 函数签名和行为

  **1c. 类型定义、路径常量、LLMError（原计划内容）**：
  - 在 `src/errors/base.ts` 新增 `LLMError extends CLIError`，exitCode 使用已有 `EXIT_CODES.NETWORK_ERROR`（若无则新增 `LLM_ERROR = 7`）
  - 在 `src/config/paths.ts` 新增三个常量：
    ```typescript
    export const SESSIONS_DIR = join(CONFIG_DIR, 'sessions')
    export const AGENT_MD_FILE = join(CONFIG_DIR, 'agent.md')
    export const LLM_CONFIG_FILE = join(CONFIG_DIR, 'llm-providers.json')
    ```
  - 创建 `src/types/llm.ts`，包含：`ChatRole`、`ChatMessage`、`ChatRequest`、`ChatChunk`、`LLMProvider`、`LLMConfig`（见方案中数据结构）
  - 创建 `src/types/session.ts`，包含：`Message`、`Session`、`SessionIndex`（见方案中数据结构）
  - 扩展 `src/config/schema.ts`，在 configSchema 中新增：
    ```typescript
    contextWindow: z.number().default(20).optional()
    activeSessionId: z.string().optional()
    ```

  **Must NOT do**:
  - 不修改现有 CLIError / UsageError / AuthError / NetworkError / HttpError
  - 不删改 config schema 中现有字段
  - 不破坏现有 hello / weather 命令的解析行为（修改 args.ts 后必须验证）
  - 不引入任何外部依赖

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 类型/常量定义 + 两处小改动（args.ts 和 loader.ts），逻辑清晰
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO（其他所有 task 依赖此 task）
  - **Parallel Group**: Wave 1（单独执行）
  - **Blocks**: Tasks 2, 3, 4, 5, 6, 7
  - **Blocked By**: None（可立即开始）

  **References**:

  **Pattern References**:
  - `src/args.ts` — **直接修改此文件**；当前第 34-45 行子命令吞词逻辑需要移除
  - `src/registry.ts` — **直接修改此文件**；只注册顶层命令（session/llm/ask/init），不注册二级子命令路径
  - `src/main.ts` — **直接修改此文件**；命令组（session/llm）由其 execute() 自身二次路由，main.ts 只做一级 dispatch
  - `src/errors/base.ts` — 现有 CLIError 继承模式，LLMError 跟随同一写法
  - `src/config/paths.ts` — 现有路径常量写法，跟随 `join(CONFIG_DIR, ...)` 模式
  - `src/config/schema.ts` — 现有 zod schema，追加字段到同一 object
  - `src/config/loader.ts` — **直接修改此文件**；新增 `saveConfig()` 函数，使用 Bun.write

  **Acceptance Criteria**:
  - [ ] `tsc --noEmit` 无报错
  - [ ] `parseArgs(['ask', 'hello world'])` → `{ command: ['ask'], positional: ['hello world'], flags: {} }`
  - [ ] `parseArgs(['session', 'new', 'chat'])` → `{ command: ['session'], positional: ['new', 'chat'], flags: {} }`
  - [ ] `parseArgs(['weather', '北京'])` → `{ command: ['weather'], positional: ['北京'], flags: {} }`（weather 命令不受影响）
  - [ ] `saveConfig({ activeSessionId: 'test' })` 写入文件，`loadConfig()` 能读回
  - [ ] `src/types/llm.ts` 导出所有 6 个类型
  - [ ] `src/types/session.ts` 导出所有 3 个接口
  - [ ] `src/config/paths.ts` 导出 SESSIONS_DIR、AGENT_MD_FILE、LLM_CONFIG_FILE
  - [ ] 新增 LLMError 可被 `throw new LLMError("msg")` 实例化

  **QA Scenarios**:
  ```
  Scenario: args.ts 修复验证 — ask 命令 positional 正确
    Tool: Bash
    Steps:
      1. bun run -e "import { parseArgs } from './src/args.ts'; console.log(JSON.stringify(parseArgs(['ask', 'hello world'])))"
    Expected Result: {"command":["ask"],"positional":["hello world"],"flags":{}}
    Evidence: .sisyphus/evidence/task-1-args-ask.txt

  Scenario: args.ts 修复验证 — session new 子命令 positional 正确
    Tool: Bash
    Steps:
      1. bun run -e "import { parseArgs } from './src/args.ts'; console.log(JSON.stringify(parseArgs(['session', 'new', 'my-chat'])))"
    Expected Result: {"command":["session"],"positional":["new","my-chat"],"flags":{}}
    Evidence: .sisyphus/evidence/task-1-args-session.txt

  Scenario: saveConfig + loadConfig 写读一致
    Tool: Bash
    Steps:
      1. HOME=/tmp/my-cli-test-args bun run -e "import { saveConfig, loadConfig } from './src/config/loader.ts'; await saveConfig({ activeSessionId: 'test-id-001' }); const c = loadConfig(); console.log(c.activeSessionId)"
    Expected Result: 输出 "test-id-001"
    Evidence: .sisyphus/evidence/task-1-save-config.txt

  Scenario: 类型导出验证
    Tool: Bash
    Steps:
      1. bun run -e "import { LLMProvider, LLMConfig, ChatMessage } from './src/types/llm.ts'; console.log('OK')"
    Expected Result: 输出 "OK"，无 TS 报错
    Evidence: .sisyphus/evidence/task-1-types-export.txt

  Scenario: LLMError 可抛出
    Tool: Bash
    Steps:
      1. bun run -e "import { LLMError } from './src/errors/base.ts'; try { throw new LLMError('test') } catch(e) { console.log(e instanceof LLMError, e.message) }"
    Expected Result: 输出 "true test"
    Evidence: .sisyphus/evidence/task-1-llmerror.txt
  ```

  **Evidence to Capture**:
  - [ ] task-1-args-ask.txt
  - [ ] task-1-args-session.txt
  - [ ] task-1-save-config.txt
  - [ ] task-1-types-export.txt
  - [ ] task-1-llmerror.txt

  **Commit**: YES（与 Task 2-3 一起提交 Commit 1）
  - Message: `feat(foundation): fix args parsing, add saveConfig, add LLM/session types`
  - Files: `src/types/llm.ts`, `src/types/session.ts`, `src/errors/base.ts`, `src/config/paths.ts`, `src/config/schema.ts`

- [ ] 2. Session Store：JSON 文件 CRUD + 活跃 session 管理

  **What to do**:
  - 创建 `src/session/store.ts`，实现以下函数（全部 async）：
    ```typescript
    createSession(name?: string): Promise<Session>
    getSession(id: string): Promise<Session>
    updateSession(session: Session): Promise<void>
    deleteSession(id: string): Promise<void>
    listSessions(): Promise<Session[]>
    getActiveSessionId(): Promise<string | null>
    setActiveSessionId(id: string | null): Promise<void>
    getOrCreateActiveSession(): Promise<Session>  // ask 命令使用
    ```
  - Session ID 生成：`YYYYMMDD-HHmmss-<4位随机字母数字>`，例 `20260410-143022-a3f9`
  - 文件路径：`SESSIONS_DIR/<id>.json`
  - `activeSessionId` 存储在 `config.json`（通过已有 config loader 读写）
  - 目录不存在时自动创建（`mkdir -p`）
  - 创建 `src/session/store.test.ts`，使用临时目录测试所有函数
    - 用 `Bun.env.HOME = '/tmp/my-cli-test-XXX'` 隔离测试环境
    - 测试：create、get、update、delete、list、getOrCreate（无活跃时新建）、getOrCreate（有活跃时复用）
    - 边界：get 不存在的 ID → 抛出 CLIError；delete 活跃 session → activeSessionId 变 null

  **Must NOT do**:
  - 不绕过 config loader：必须通过 Task 1 新增的 `saveConfig()` 接口写 `activeSessionId`，不得直接操作 config.json 文件
  - 不修改 `src/config/loader.ts` 中已有的 `loadConfig()` 函数签名
  - 不实现 session import/export

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 需要理解现有 config 读写机制，正确操作文件系统，处理边界情况
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES（与 Task 3 并行）
  - **Parallel Group**: Wave 2（与 Task 3）
  - **Blocks**: Tasks 4, 7
  - **Blocked By**: Task 1

  **References**:

  **Pattern References**:
  - `src/config/loader.ts` — 了解如何读写 config.json（需用同一机制读写 activeSessionId）
  - `src/config/paths.ts` — 使用 SESSIONS_DIR、CONFIG_DIR 常量
  - `src/commands/core/weather.ts` — 了解 async/await 在命令中的用法

  **API/Type References**:
  - `src/types/session.ts:Session` — 文件存储结构
  - `src/types/session.ts:SessionIndex` — 参考理解，但实际只存 activeSessionId 在 config.json

  **Acceptance Criteria**:
  - [ ] `bun test src/session/store.test.ts` 全部通过
  - [ ] 测试覆盖：create, get, update, delete, list, getOrCreate（两种路径）, 错误路径

  **QA Scenarios**:
  ```
  Scenario: 创建并读取 session
    Tool: Bash
    Steps:
      1. bun test src/session/store.test.ts --test-name "create and get session"
    Expected Result: PASS
    Evidence: .sisyphus/evidence/task-2-create-get.txt

  Scenario: 获取不存在的 session 应抛出错误
    Tool: Bash
    Steps:
      1. bun test src/session/store.test.ts --test-name "get nonexistent session throws"
    Expected Result: PASS（CLIError 被正确抛出）
    Evidence: .sisyphus/evidence/task-2-not-found-error.txt

  Scenario: getOrCreateActiveSession — 无活跃 session 时自动新建
    Tool: Bash
    Steps:
      1. bun test src/session/store.test.ts --test-name "getOrCreate creates new when no active"
    Expected Result: PASS，返回新建 Session，activeSessionId 已更新
    Evidence: .sisyphus/evidence/task-2-get-or-create.txt

  Scenario: 删除活跃 session 后 activeSessionId 变 null
    Tool: Bash
    Steps:
      1. bun test src/session/store.test.ts --test-name "delete active session clears activeSessionId"
    Expected Result: PASS
    Evidence: .sisyphus/evidence/task-2-delete-active.txt
  ```

  **Commit**: YES（Commit 2）
  - Message: `feat(session): add session store with JSON persistence`
  - Files: `src/session/store.ts`, `src/session/store.test.ts`
  - Pre-commit: `bun test src/session/store.test.ts`

- [ ] 3. LLM Client：SSE 流式调用

  **What to do**:
  - 创建 `src/llm/client.ts`，核心函数：
    ```typescript
    // 流式调用，onChunk 每次收到内容片段时回调
    streamChat(
      provider: LLMProvider,
      messages: ChatMessage[],
      onChunk: (content: string) => void
    ): Promise<string>  // 返回完整回复文本
    ```
  - 调用路径：`POST {baseUrl}/v1/chat/completions`，header 带 `Authorization: Bearer {apiKey}`
  - 直接使用原生 `fetch` 实现 SSE 流式调用（不复用 `requestStream`，原因：`requestStream` 的第一参数是内部 `Config` 类型，与 `LLMProvider` 结构不兼容）
  - SSE 解析：`TextDecoder().decode(chunk)` → 按 `\n` 分割 → 过滤 `data: ` 前缀 → JSON.parse → 提取 `choices[0].delta.content`
  - 遇到 `[DONE]` 时结束
  - API 返回非 2xx 时抛出 `LLMError`（包含状态码和响应体）
  - 创建 `src/llm/client.test.ts`，使用 mock fetch 测试：
    - 正常 SSE 流（多 chunk → 拼接完整文本）
    - API 401/500 错误 → 抛出 LLMError
    - 空 content delta（role-only chunk）→ 不调用 onChunk
    - `[DONE]` 后不再处理

  **Must NOT do**:
  - 不实现非 streaming 调用（stream: true 是必须的）
  - 不处理 function_call / tool_calls 字段
  - 不引入外部 SSE 解析库

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: SSE 解析有细节（分块边界、Unicode 拆分），需要仔细处理
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES（与 Task 2 并行）
  - **Parallel Group**: Wave 2（与 Task 2）
  - **Blocks**: Task 7
  - **Blocked By**: Task 1

  **References**:

  **Pattern References**:
  - `src/errors/base.ts` — LLMError 继承写法（与现有 CLIError 保持一致）
  - 注意：`src/client/http.ts` 的 `requestStream` **没有** SSE 行级解析逻辑（只把解码后字符串直接传给 onChunk），不能作为参考。LLM Client 的 SSE 解析须按下方 External References 描述自行实现。

  **External References**:
  - OpenAI SSE format: 每行 `data: <json>` 或 `data: [DONE]`，空行分隔事件；实现步骤：`TextDecoder` 解码 chunk → 按 `\n` 分割 → 跳过非 `data: ` 开头的行 → JSON.parse 每行的 `data:` 后内容 → 提取 `choices[0].delta.content` → 遇到 `data: [DONE]` 终止

  **Acceptance Criteria**:
  - [ ] `bun test src/llm/client.test.ts` 全部通过
  - [ ] 测试覆盖：正常流式调用、错误响应、空 content delta、[DONE] 终止

  **QA Scenarios**:
  ```
  Scenario: 正常 SSE 流解析，多个 chunk 拼接
    Tool: Bash
    Steps:
      1. bun test src/llm/client.test.ts --test-name "streamChat returns full response"
    Expected Result: PASS，onChunk 被调用 N 次，返回值为所有 content 拼接
    Evidence: .sisyphus/evidence/task-3-stream-success.txt

  Scenario: API 返回 401 → 抛出 LLMError
    Tool: Bash
    Steps:
      1. bun test src/llm/client.test.ts --test-name "streamChat throws LLMError on 401"
    Expected Result: PASS，LLMError.message 包含 "401"
    Evidence: .sisyphus/evidence/task-3-stream-401.txt

  Scenario: SSE [DONE] 后不再处理后续 chunk
    Tool: Bash
    Steps:
      1. bun test src/llm/client.test.ts --test-name "streamChat stops on [DONE]"
    Expected Result: PASS
    Evidence: .sisyphus/evidence/task-3-stream-done.txt
  ```

  **Commit**: YES（Commit 3）
  - Message: `feat(llm): add OpenAI-compatible SSE streaming client`
  - Files: `src/llm/client.ts`, `src/llm/client.test.ts`
  - Pre-commit: `bun test src/llm/client.test.ts`

- [ ] 4. session 命令组：new / list / switch / delete

  **What to do**:
  - 创建 `src/commands/session.ts`，作为顶层命令（**不使用 registry 树形子命令**）：
    - `execute(args)` 函数通过 `args.positional[0]` 做二次路由（与 Task 1 的架构一致）：
      ```
      switch(args.positional[0]) {
        case 'new':    handleNew(args)
        case 'list':   handleList()
        case 'switch': handleSwitch(args)
        case 'delete': handleDelete(args)
        default:       throw UsageError("usage: session <new|list|switch|delete>")
      }
      ```
    - `registry.register('session', { execute })` 只注册顶层命令（不注册 `session new` 等路径）
  - `session new [name]`：调用 `createSession(name)`，打印新建的 session ID 和名称
  - `session list`：调用 `listSessions()`，按 updatedAt 倒序，打印表格（ID | 名称 | 消息数 | 最后更新）；当前活跃 session 在 ID 前加 `*`
  - `session switch <id>`：调用 `setActiveSessionId(id)`；ID 不存在则报错
  - `session delete <id>`：调用 `deleteSession(id)`；提示 "Session <id> 已删除"；若为当前活跃则额外提示 "活跃 session 已清除"
  - 在 `src/main.ts` 注册 session 命令（`registry.register('session', sessionCommand)`）
  - 创建 `src/commands/session.test.ts`，mock session store，测试所有子命令的参数解析和输出

  **Must NOT do**:
  - 不实现 session rename / export / import

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 逻辑简单，直接调用 store 函数，参照 weather.ts 命令结构
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES（与 Task 5、Task 6 并行）
  - **Parallel Group**: Wave 3（与 Tasks 5, 6）
  - **Blocks**: F1-F3
  - **Blocked By**: Task 2

  **References**:

  **Pattern References**:
  - `src/commands/core/weather.ts` — 命令结构、execute 函数签名、错误处理模式
  - `src/registry.ts` — 如何注册子命令组（树形结构）
  - `src/main.ts` — 命令注册位置
  - `src/output/text.ts:printTable` — 表格输出方法

  **API/Type References**:
  - `src/session/store.ts` — 所有被调用的函数签名

  **Acceptance Criteria**:
  - [ ] `bun test src/commands/session.test.ts` 全部通过
  - [ ] `bun run src/main.ts session --help` 列出 new/list/switch/delete
  - [ ] `bun run src/main.ts session new "test-chat"` 打印 session ID

  **QA Scenarios**:
  ```
  Scenario: session new 创建并打印 ID
    Tool: Bash
    Steps:
      1. SESSION_ID=$(bun run src/main.ts session new "test-chat" 2>&1)
      2. echo "$SESSION_ID" | grep -E "[0-9]{8}-[0-9]{6}-[a-z0-9]{4}"
    Expected Result: 匹配 Session ID 格式
    Evidence: .sisyphus/evidence/task-4-session-new.txt

  Scenario: session list 显示活跃 session 标记 *
    Tool: Bash
    Steps:
      1. bun run src/main.ts session new "chat-1"
      2. bun run src/main.ts session list
      3. 输出中检查 * 标记
    Expected Result: 输出包含 "* <session-id>"
    Evidence: .sisyphus/evidence/task-4-session-list.txt

  Scenario: session switch 到不存在的 ID 报错
    Tool: Bash
    Steps:
      1. bun run src/main.ts session switch "99999999-999999-xxxx" 2>&1
      2. 检查退出码非 0
    Expected Result: stderr 包含 "Session 不存在"，退出码 != 0
    Evidence: .sisyphus/evidence/task-4-session-switch-error.txt
  ```

  **Commit**: YES（与 Task 5、6 一起 Commit 4）

- [ ] 5. llm 命令组 + Provider 配置管理

  **What to do**:
  - 创建 `src/llm/config.ts`，实现：
    ```typescript
    loadLLMConfig(): Promise<LLMConfig>
    saveLLMConfig(config: LLMConfig): Promise<void>
    addProvider(provider: LLMProvider): Promise<void>  // 重名则报错
    listProviders(): Promise<LLMProvider[]>
    getDefaultProvider(): Promise<LLMProvider>  // 无 defaultProvider 则报 UsageError
    setDefaultProvider(name: string): Promise<void>  // name 不存在则报错
    ```
  - 配置文件：`LLM_CONFIG_FILE`（`~/.config/my-cli/llm-providers.json`）
  - 文件不存在时返回 `{ providers: [], defaultProvider: '' }`
  - 创建 `src/commands/llm.ts`，作为顶层命令（**不使用 registry 树形子命令**）：
    - `execute(args)` 通过 `args.positional[0]` 做二次路由：
      ```
      switch(args.positional[0]) {
        case 'add':  handleAdd()   // readline 交互
        case 'list': handleList()
        case 'use':  handleUse(args)
        default:     throw UsageError("usage: llm <add|list|use>")
      }
      ```
    - `registry.register('llm', { execute })` 只注册顶层命令
    - `llm add`：交互式（readline）提示 name / baseUrl / apiKey / model，调用 `addProvider`
    - `llm list`：调用 `listProviders()`，打印表格（名称 | baseUrl | model），默认 provider 标 `(*)`
    - `llm use <name>`：调用 `setDefaultProvider(name)`
  - 在 `src/main.ts` 注册 llm 命令（`registry.register('llm', llmCommand)`）
  - 创建 `src/llm/config.test.ts` 和 `src/commands/llm.test.ts`，mock 文件系统

  **Must NOT do**:
  - 不实现 `llm edit` / `llm delete` / `llm test`（future features）
  - 不在 credentials.json 中存储 LLM 配置

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: CRUD 逻辑清晰，交互式输入用 readline 即可
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES（与 Task 4、Task 6 并行）
  - **Parallel Group**: Wave 3（与 Tasks 4, 6）
  - **Blocks**: Task 7, F1-F3
  - **Blocked By**: Task 1

  **References**:

  **Pattern References**:
  - `src/commands/core/weather.ts` — 命令结构
  - `src/config/loader.ts` — 文件读写参考（JSON 读写模式）
  - `src/config/paths.ts:LLM_CONFIG_FILE` — 配置文件路径
  - `src/output/text.ts:printTable` — 表格输出

  **API/Type References**:
  - `src/types/llm.ts:LLMProvider`, `LLMConfig` — 数据结构

  **Acceptance Criteria**:
  - [ ] `bun test src/llm/config.test.ts` 全部通过
  - [ ] `bun test src/commands/llm.test.ts` 全部通过
  - [ ] `bun run src/main.ts llm list` 在空配置时输出 "暂无已配置的 LLM provider"

  **QA Scenarios**:
  ```
  Scenario: llm add 后可通过 llm list 看到
    Tool: Bash
    Steps:
      1. bun test src/llm/config.test.ts --test-name "addProvider then list shows provider"
    Expected Result: PASS
    Evidence: .sisyphus/evidence/task-5-llm-add-list.txt

  Scenario: 重复 provider name 报错
    Tool: Bash
    Steps:
      1. bun test src/llm/config.test.ts --test-name "addProvider duplicate name throws"
    Expected Result: PASS，抛出 UsageError
    Evidence: .sisyphus/evidence/task-5-duplicate-error.txt

  Scenario: llm use 设置默认 provider，list 显示 (*)
    Tool: Bash
    Steps:
      1. bun test src/llm/config.test.ts --test-name "setDefaultProvider marks as default"
    Expected Result: PASS
    Evidence: .sisyphus/evidence/task-5-use-default.txt
  ```

  **Commit**: YES（与 Task 4、6 一起 Commit 4）
  - Message: `feat(commands): add session and llm command groups`
  - Pre-commit: `bun test`

- [ ] 6. init 命令：交互式生成 agent.md

  **What to do**:
  - 创建 `src/commands/init.ts`：
    - 使用 `readline` 交互式提示（不引入额外依赖）
    - 收集字段：助手名称（default "Assistant"）、角色设定、回答风格、注意事项（可空）
    - 写入 `AGENT_MD_FILE`（`~/.config/my-cli/agent.md`）
    - 已存在时提示 "agent.md 已存在，是否覆盖？(y/N)"，默认 N（不覆盖）
    - 写入内容格式：
      ```markdown
      # Agent Profile

      你的名字是 {name}。

      ## 角色
      {role}

      ## 回答风格
      {style}

      ## 注意事项
      {notes}
      ```
  - 在 `src/main.ts` 注册 init 命令
  - 创建 `src/commands/init.test.ts`，mock readline 和文件写入，测试：
    - 正常创建 agent.md（验证文件内容格式）
    - 已存在 + 用户选 N → 不覆盖
    - 已存在 + 用户选 y → 覆盖

  **Must NOT do**:
  - 不实现其他 init 逻辑（不初始化 config.json 或 credentials.json）
  - 不引入 @clack/prompts 等外部 prompt 库

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 逻辑简单，readline + 文件写入
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES（与 Task 4、Task 5 并行）
  - **Parallel Group**: Wave 3（与 Tasks 4, 5）
  - **Blocks**: Task 7, F1-F3
  - **Blocked By**: Task 1

  **References**:

  **Pattern References**:
  - `src/config/paths.ts:AGENT_MD_FILE` — 写入路径
  - `src/commands/core/hello.ts` — 最简单命令结构参考

  **Acceptance Criteria**:
  - [ ] `bun test src/commands/init.test.ts` 全部通过
  - [ ] 测试验证生成的 agent.md 包含 "# Agent Profile" 标题
  - [ ] 测试验证已存在 + 用户选 N 时文件未被修改

  **QA Scenarios**:
  ```
  Scenario: 正常创建 agent.md，文件内容符合模板
    Tool: Bash
    Steps:
      1. bun test src/commands/init.test.ts --test-name "init creates agent.md with correct format"
    Expected Result: PASS，文件包含 "# Agent Profile" 和所有填写的字段
    Evidence: .sisyphus/evidence/task-6-init-create.txt

  Scenario: 已存在 + 用户选 N 不覆盖
    Tool: Bash
    Steps:
      1. bun test src/commands/init.test.ts --test-name "init does not overwrite when user selects N"
    Expected Result: PASS，原文件内容不变
    Evidence: .sisyphus/evidence/task-6-init-no-overwrite.txt
  ```

  **Commit**: YES（与 Task 4、5 一起 Commit 4）

- [ ] 7. ask 命令：流式问答 + session 上下文 + agent.md

  **What to do**:
  - 创建 `src/commands/ask.ts`，实现命令 `ask <message> [--session <id>]`：
    1. 参数解析：从 `args` 取第一个位置参数为 `message`；支持 `--session <id>` flag
    2. 加载 LLM provider：调用 `getDefaultProvider()`；无配置 → UsageError "请先运行 my-cli llm add 添加 LLM 服务"
    3. 读取 agent.md：尝试读取 `AGENT_MD_FILE`；文件不存在则 system prompt 为空字符串
     4. 加载 session（**注意：此时仅加载，不写盘**）：
        - 有 `--session <id>` → `getSession(id)`，不存在则 CLIError "Session 不存在: <id>"
        - 无 flag → `getOrCreateActiveSession()`（在内存中创建/获取，**不立即写文件**）
     5. 滑动窗口裁剪：从 session.messages 取最后 `contextWindow`（默认 20）条
     6. 构造 messages 数组：
        ```
        [
          { role: 'system', content: agentMd },  // 若 agentMd 非空才加
          ...裁剪后的历史消息（user/assistant）,
          { role: 'user', content: message }
        ]
        ```
     7. 调用 `streamChat(provider, messages, onChunk)`（**LLM 调用，尚未写盘**）：
        - `onChunk` 回调：`process.stdout.write(content)`
        - 流式完成后 `process.stdout.write('\n')`
        - LLM 调用失败 → 捕获 LLMError，打印友好错误信息，**直接返回，不写任何 session 文件**
     8. **LLM 调用成功后才写盘**：
        - 追加 user message 到 session（timestamp: ISO 8601）
        - 追加 assistant 回复到 session（timestamp: ISO 8601）
        - 保存 session 到文件（`saveSession(session)`）
     9. 更新 activeSessionId（`setActiveSessionId(session.id)`）
  - Ctrl+C 处理（SIGINT）：监听 `process.on('SIGINT', ...)`，将已收到的部分回复追加到 session 后 `process.exit(0)`
  - 在 `src/main.ts` 注册 ask 命令
  - 创建 `src/commands/ask.test.ts`，mock `streamChat`、session store、文件系统，测试：
    - 正常流式调用（mock streamChat 返回 "Hello"），验证 session 中保存了 user + assistant 消息
    - `--session <id>` flag 覆盖活跃 session
    - `--session <nonexistent>` → CLIError
    - 未配置 provider → UsageError
     - agent.md 不存在时 → messages 中无 system 消息
     - agent.md 存在时 → messages 第一条为 system
     - 滑动窗口：session 有 25 条消息时，只取最后 20 条
     - **LLM 调用失败时不写盘**：mock streamChat 抛出 LLMError，验证 `saveSession` 未被调用（session 文件不存在）

  **Must NOT do**:
  - 不实现 REPL / 交互式 chat 循环
  - 不处理 function_call / tool_calls
  - 不实现多模态（图片等）
  - 不修改 hello / weather 命令

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: 整合 session store、LLM client、agent.md、config 四个模块，有多路错误处理和 SIGINT 边界情况
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO（依赖 Tasks 2、3、5、6）
  - **Parallel Group**: Wave 4（单独执行）
  - **Blocks**: F1-F3
  - **Blocked By**: Tasks 2, 3, 5, 6

  **References**:

  **Pattern References**:
  - `src/commands/core/weather.ts` — 命令结构、execute 签名、args 解析方式
  - `src/args.ts` — 如何解析 `--session <id>` flag（参考现有 flag 解析逻辑）
  - `src/config/loader.ts` — 读取 contextWindow 配置字段
  - `src/session/store.ts` — 所有被调用的函数签名

  **API/Type References**:
  - `src/llm/client.ts:streamChat` — 调用签名
  - `src/llm/config.ts:getDefaultProvider` — provider 获取
  - `src/types/session.ts:Message` — 追加消息时的数据结构
  - `src/config/paths.ts:AGENT_MD_FILE` — agent.md 读取路径

  **External References**:
  - Node.js `process.on('SIGINT', ...)` — Ctrl+C 处理

  **Acceptance Criteria**:
  - [ ] `bun test src/commands/ask.test.ts` 全部通过
  - [ ] 测试覆盖：正常调用、--session flag、不存在 session、无 provider、无 agent.md、滑动窗口裁剪
  - [ ] `bun run src/main.ts ask --help` 显示命令说明

  **QA Scenarios**:
  ```
  Scenario: 正常 ask，session 中保存 user + assistant 消息
    Tool: Bash
    Steps:
      1. bun test src/commands/ask.test.ts --test-name "ask saves user and assistant messages to session"
    Expected Result: PASS，session.messages 包含 role=user 和 role=assistant 各一条
    Evidence: .sisyphus/evidence/task-7-ask-saves-messages.txt

  Scenario: --session 指定不存在的 ID 报 CLIError
    Tool: Bash
    Steps:
      1. bun test src/commands/ask.test.ts --test-name "ask --session nonexistent throws CLIError"
    Expected Result: PASS，CLIError.message 包含 "Session 不存在"
    Evidence: .sisyphus/evidence/task-7-ask-session-not-found.txt

  Scenario: 未配置 provider 报 UsageError
    Tool: Bash
    Steps:
      1. bun test src/commands/ask.test.ts --test-name "ask throws UsageError when no provider configured"
    Expected Result: PASS，UsageError.message 包含 "my-cli llm add"
    Evidence: .sisyphus/evidence/task-7-ask-no-provider.txt

  Scenario: 滑动窗口 — 25 条历史消息时只取最后 20 条
    Tool: Bash
    Steps:
      1. bun test src/commands/ask.test.ts --test-name "ask trims context window to 20 messages"
    Expected Result: PASS，传给 streamChat 的 messages 中历史消息数 = 20（不超过 contextWindow）
    Evidence: .sisyphus/evidence/task-7-ask-sliding-window.txt

  Scenario: agent.md 存在时 messages 第一条为 system
    Tool: Bash
    Steps:
      1. bun test src/commands/ask.test.ts --test-name "ask includes system message when agent.md exists"
    Expected Result: PASS，messages[0].role === 'system'
    Evidence: .sisyphus/evidence/task-7-ask-system-prompt.txt

  Scenario: agent.md 不存在时 messages 中无 system 消息
    Tool: Bash
    Steps:
      1. bun test src/commands/ask.test.ts --test-name "ask skips system message when agent.md missing"
    Expected Result: PASS，messages 中无 role=system 条目
    Evidence: .sisyphus/evidence/task-7-ask-no-system-prompt.txt
  ```

  **Evidence to Capture**:
  - [ ] task-7-ask-saves-messages.txt
  - [ ] task-7-ask-session-not-found.txt
  - [ ] task-7-ask-no-provider.txt
  - [ ] task-7-ask-sliding-window.txt
  - [ ] task-7-ask-system-prompt.txt
  - [ ] task-7-ask-no-system-prompt.txt

  **Commit**: YES（Commit 5）
  - Message: `feat(ask): add streaming ask command with session context`
  - Files: `src/commands/ask.ts`, `src/commands/ask.test.ts`, `src/main.ts`
  - Pre-commit: `bun test`

---

## Final Verification Wave

> 3 个 review agent 并行运行，全部 APPROVE 后向用户呈现结果，等待用户明确确认后才算完成。

- [ ] F1. **方案符合性审计** — `oracle`
  逐条检查 Must Have / Must NOT Have。对 ask/init/session/llm 命令：执行 `bun run src/main.ts <command> --help` 验证命令存在；检查 Must NOT Have（REPL/工具调用等）是否在 codebase 中出现。
  Output: `Must Have [N/N] | Must NOT Have [N/N] | VERDICT: APPROVE/REJECT`

  **QA Scenarios**:
  ```
  Scenario: 验证所有新命令均已注册
    Tool: Bash
    Steps:
      1. bun run src/main.ts --help 2>&1
      → 输出中必须包含 ask、init、session、llm 关键词
      2. bun run src/main.ts session --help 2>&1
      → 输出中必须包含 new、list、switch、delete
      3. bun run src/main.ts llm --help 2>&1
      → 输出中必须包含 add、list、use
    Expected Result: 三条命令均正常输出帮助信息，无 "command not found" 或 process exit code ≠ 0
    Failure Indicators: 缺少任意子命令、命令抛出异常
    Evidence: .sisyphus/evidence/final-f1-commands-registered.txt

  Scenario: 验证 Must NOT Have — 无 REPL / 工具调用实现
    Tool: Bash
    Steps:
      1. grep -r "tool_calls\|function_call" src/ --include="*.ts" 2>&1
      → 预期：无任何输出（0 matches）
      2. grep -r "while.*readline\|rl\.on.*line\|rl\.on.*close" src/ --include="*.ts" 2>&1
      → 预期：只允许出现在 src/commands/init.ts（init 命令合法使用 readline），其他文件不得有 readline 循环（即非 REPL 实现）
      NOTE: readline/createInterface 本身是合法的（init 命令用它交互式收集输入），
      禁止的是 REPL 循环模式（readline + while true + processInput）
    Expected Result: tool_calls/function_call grep 退出码 1；readline 循环模式仅存在于 init.ts（如存在）
    Failure Indicators: tool_calls 或 function_call 在任何文件出现；非 init.ts 文件中有 readline 循环
    Evidence: .sisyphus/evidence/final-f1-must-not-have.txt
  ```

- [ ] F2. **代码质量检查** — `unspecified-high`
  运行 `bun test` + `tsc --noEmit`。检查所有新文件：无 `as any`，无空 catch，无 console.log（生产代码），无 TODO 遗留，无 unused imports。
  Output: `Build [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

  **QA Scenarios**:
  ```
  Scenario: 类型检查全部通过
    Tool: Bash
    Steps:
      1. bun tsc --noEmit 2>&1
      → 预期：无任何 error 输出，退出码 0
    Expected Result: exit code 0，无 TypeScript 错误
    Failure Indicators: 出现 "error TS" 字样
    Evidence: .sisyphus/evidence/final-f2-tsc.txt

  Scenario: 所有测试通过
    Tool: Bash
    Steps:
      1. bun test 2>&1
      → 预期：所有 test suite 均为 PASS，0 failures
    Expected Result: "X tests passed" 且 "0 failed"
    Failure Indicators: 任何 "FAIL" 或 "error" 行
    Evidence: .sisyphus/evidence/final-f2-tests.txt

  Scenario: 无 AI slop / 代码质量问题
    Tool: Bash
    Steps:
      1. grep -rn "as any\|@ts-ignore\|console\.log\|// TODO" src/llm src/session src/commands/ask.ts src/commands/session.ts src/commands/llm.ts src/commands/init.ts 2>&1
      → 预期：无任何输出
    Expected Result: grep 退出码 1（无匹配）
    Failure Indicators: 任何匹配行出现
    Evidence: .sisyphus/evidence/final-f2-slop-check.txt
  ```

- [ ] F3. **全量 QA 场景执行** — `unspecified-high`
  从干净状态执行每个 task 的所有 QA 场景（见各 task 中的 QA Scenarios 章节）。保存证据到 `.sisyphus/evidence/final-qa/`。
  Output: `Scenarios [N/N pass] | Edge Cases [N tested] | VERDICT`

  **QA Scenarios**:
  ```
  Scenario: 完整 happy path — 配置 provider 并验证失败时不保存 session
    Tool: Bash
    Preconditions:
      - 使用临时目录 /tmp/my-cli-f3，通过直接写 JSON fixture 方式配置 provider（不依赖交互式 llm add）
      - SESSIONS_DIR 为空（干净状态）
    Steps:
      1. mkdir -p /tmp/my-cli-f3/.config/my-cli/sessions
      2. cat > /tmp/my-cli-f3/.config/my-cli/llm-providers.json << 'EOF'
         {"providers":[{"name":"test","baseUrl":"https://api.openai.com","apiKey":"sk-fake","model":"gpt-4o"}],"defaultProvider":"test"}
         EOF
         → 手动写入 provider 配置（等效于 llm add）
      3. HOME=/tmp/my-cli-f3 bun run src/main.ts session list 2>&1
         → 预期：打印 "No sessions" 或空列表，退出码 0
      4. HOME=/tmp/my-cli-f3 bun run src/main.ts ask "hello" 2>&1
         → 由于 API key 是假的，预期：LLMError 被捕获并打印友好错误信息（包含 "401" 或 "Unauthorized" 字样），非 uncaught stack trace
         → 调用失败，session 不保存：ls /tmp/my-cli-f3/.config/my-cli/sessions/ 应为空目录（0 个文件）
      5. HOME=/tmp/my-cli-f3 bun run src/main.ts session list 2>&1
         → 预期：仍打印 "No sessions" 或空列表（失败不保存，不应有任何 session）
    Expected Result: 步骤 3 exit 0；步骤 4 显示友好错误（不含 stack trace）；步骤 5 仍为空列表（无 session）
    Failure Indicators: 步骤 4 出现未捕获异常 / stack trace；步骤 5 出现 session 记录（失败不应保存）；步骤 3 报命令不存在
    Evidence: .sisyphus/evidence/final-f3-happy-path.txt

  Scenario: session switch + 继续对话 context 保留
    Tool: Bash
    Preconditions: 已有至少 2 个 session（可直接写 JSON fixture 到临时目录）
    Steps:
      1. HOME=/tmp/my-cli-f3 bun run src/main.ts session list 2>&1 | head -5
         → 记录 session ID 列表
      2. HOME=/tmp/my-cli-f3 bun run src/main.ts session switch <session-id-2>
         → 预期：打印 "Switched to session <id>"，退出码 0
      3. HOME=/tmp/my-cli-f3 cat ~/.config/my-cli/config.json | grep activeSessionId
         → 预期：值为 <session-id-2>
    Expected Result: 活跃 session 已切换，config.json 已更新
    Failure Indicators: activeSessionId 未变更；命令报错
    Evidence: .sisyphus/evidence/final-f3-session-switch.txt
  ```

---

## Commit Strategy

- **Commit 1**: `feat(types): add LLM and session type definitions` — T1 完成后
- **Commit 2**: `feat(session): add session store with JSON persistence` — T2 完成后
- **Commit 3**: `feat(llm): add OpenAI-compatible streaming client` — T3 完成后
- **Commit 4**: `feat(commands): add session and llm command groups` — T4+T5+T6 完成后
- **Commit 5**: `feat(ask): add streaming ask command with session context` — T7 完成后
- **Pre-commit check**: `bun test`

---

## Success Criteria

### Verification Commands
```bash
bun test                          # 预期：所有测试通过，0 failure
bun run src/main.ts --help        # 预期：列出 ask/init/session/llm 命令
bun run src/main.ts session new   # 预期：打印新建的 session ID
bun run src/main.ts llm list      # 预期：列出 providers（需先 llm add）
bun run src/main.ts init          # 预期：交互式提示
```

### Final Checklist
- [ ] 所有 Must Have 已实现
- [ ] 所有 Must NOT Have 未出现
- [ ] bun test 全部通过
- [ ] ask 命令流式输出正常
- [ ] session 持久化正常
