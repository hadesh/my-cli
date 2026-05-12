# Agent 架构改进计划

## TL;DR

> **Quick Summary**: 针对 my-cli agent 实现中的 5 个已识别问题进行代码级修复，新增 `streamChatWithTools` 统一流式处理普通文本和 tool_calls（彻底删除非流式 `chatWithTools`），修复工具路由脆弱性，增强 Context 裁剪健壮性，改善工具调用的用户可见性，并澄清测试注入架构。
>
> **Deliverables**:
> - `src/llm/client.ts`：新增 `streamChatWithTools`；删除 `chatWithTools`
> - `src/types/llm.ts`：扩展 `ChatChunk` 类型（`delta.tool_calls` 字段）
> - `src/commands/ask.ts`：工具调用循环统一使用 `streamChatWithTools`；消除双重请求；改进工具 UX；移除 Factory
> - `src/tools/store.ts`：`executeUnifiedTool` 改为基于 source 路由
> - `src/utils/context.ts`：`trimMessages` 感知 tool_calls/tool 消息对结构
> - `src/types/tool.ts`：`ToolExecutor` 参数类型修正
>
> **Estimated Effort**: Medium
> **Parallel Execution**: YES - 3 waves
> **Critical Path**: Task 0（类型扩展）→ Task 4e（streamChatWithTools）→ Task 4（ask.ts 重构）

---

## Context

### Original Request
分析 agent 实现架构后，针对已识别的 5 个可改进点设计详细改进方案；并纳入统一流式处理 tool_calls 方案（彻底删除 `chatWithTools`）。

### 已识别的 5 个问题
1. 工具调用时双重 LLM 请求（性能损耗）
2. 工具名称路由脆弱（依赖 `__` 猜测而非 source 字段）
3. 无 Streaming 工具调用支持（用户体验差）
4. Context 裁剪不感知 tool message 结构（可能导致非法 messages）
5. Factory 模式为运行时可变全局状态（架构不清晰）

### 代码基准
- Bun + TypeScript，`bun test` 原生支持
- `src/session/store.test.ts` 存在，确认使用 bun test
- `streamChatWithTools` 为新增函数；`chatWithTools` 完全删除
- `streamChat` 保留不变（签名不变）

---

## Work Objectives

### Core Objective
修复 5 个已识别的架构问题，并通过新增 `streamChatWithTools` 统一流式处理，彻底消除非流式 LLM 调用路径，提升性能、可维护性和用户体验。

### Concrete Deliverables
- `src/llm/client.ts`：新增 `streamChatWithTools`；删除 `chatWithTools`
- `src/types/llm.ts`：`ChatChunk.delta.tool_calls` 字段扩展
- `src/commands/ask.ts`：工具调用循环重构（统一 streamChatWithTools、消除双重请求、改进 UX、依赖注入替换 Factory）
- `src/tools/store.ts`：基于 source 字段的工具执行路由
- `src/utils/context.ts`：感知 tool_calls/tool 消息对的裁剪逻辑

### Definition of Done
- [ ] `bun run src/main.ts ask "hello"` 仍正常工作（无工具时）
- [ ] `bun run src/main.ts ask "查天气"` 工具调用全流程正常（有工具时，流式输出最终回复）
- [ ] 有工具但 LLM 不调用时，delta.content 直接流式输出，不发起第二次 LLM 请求
- [ ] `trimMessages` 不会拆散 assistant+tool 消息对
- [ ] `executeUnifiedTool` 不依赖工具名称中的 `__` 进行路由判断
- [ ] `chatWithTools` 函数不再存在于代码库

### Must Have
- 所有现有功能保持向后兼容
- 工具调用循环最多 10 次限制保持不变
- Session 消息持久化格式不变

### Must NOT Have (Guardrails)
- 不引入新的外部依赖
- 不修改 Session JSON 存储格式（向后兼容已有的 session 文件）
- 不重构 MCP client 内部实现
- 不改变 `streamChat` 的函数签名
- 不改变 CLI 的命令行参数接口
- `chatWithTools` 必须完全删除（不保留兼容导出）

---

## Verification Strategy

### Test Decision
- **Infrastructure exists**: YES（bun test，`src/session/store.test.ts` 为证）
- **Automated tests**: Tests-after（对修改的核心函数补充单元测试）
- **Framework**: bun test

### QA Policy
每个任务包含 agent 可直接执行的 QA 场景，验证实际行为。
Evidence 保存至 `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`。

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (可立即开始 - 独立基础改动):
├── Task 0: 扩展 ChatChunk 类型（delta.tool_calls）  [quick]
├── Task 1: 修复 trimMessages - 感知 tool 消息对      [quick]
├── Task 2: 修复 executeUnifiedTool - source 路由     [quick]
└── Task 3: ToolExecutor 参数类型修正                 [quick]

Wave 2 (After Wave 1 - 核心新函数 + ask.ts 主循环重构):
├── Task 4e: 新增 streamChatWithTools（依赖 Task 0）  [unspecified-high]
└── Task 4:  重构 ask.ts 工具调用循环（依赖 Task 2,3,4e）[unspecified-high]
    - 统一使用 streamChatWithTools（删除 chatWithTools 调用）
    - 消除双重 LLM 请求
    - 改善工具调用 UX（显示参数摘要）
    - 将 Factory 替换为依赖注入参数（内部函数提取）
    - ask.test.ts 同步迁移

Wave 3 (After Wave 2 - 测试补充):
├── Task 5: 补充 trimMessages 单元测试  [quick]
└── Task 6: 补充 executeUnifiedTool 单元测试  [quick]

Wave FINAL (After ALL - 并行验证):
├── Task F1: 计划合规审计 (oracle)
├── Task F2: 代码质量审查 (unspecified-high)
└── Task F3: 真实 QA 执行 (unspecified-high)
```

### Dependency Matrix
- Task 0, 1, 2, 3: 无依赖，可并行
- Task 4e: 依赖 Task 0（需要扩展后的 ChatChunk 类型）
- Task 4: 依赖 Task 2, 3, 4e
- Task 5: 依赖 Task 1
- Task 6: 依赖 Task 2
- F1-F3: 依赖所有实现任务

### Agent Dispatch Summary
- **Wave 1**: 4× `quick`
- **Wave 2**: 2× `unspecified-high`
- **Wave 3**: 2× `quick`
- **FINAL**: `oracle` + 2× `unspecified-high`

---

## TODOs

---

- [ ] 0. 扩展 ChatChunk 类型：增加 delta.tool_calls 字段

  **What to do**:
  - 修改 `src/types/llm.ts`，在 `ChatChunk` 的 `delta` 中新增 `tool_calls` 可选字段：
    ```typescript
    tool_calls?: Array<{
      index: number          // 标识哪个 tool call（支持并发多工具）
      id?: string            // 只在首个 chunk 出现
      type?: string          // 'function'，只在首个 chunk 出现
      function?: {
        name?: string        // 只在首个 chunk 出现
        arguments?: string   // 每个 chunk 追加一段 JSON 片段
      }
    }>
    ```
  - 同时新增 `ToolCallStreamResult` 接口，供 `streamChatWithTools` 返回类型使用：
    ```typescript
    export interface ToolCallStreamResult {
      reply: string             // finish_reason === 'stop' 时的完整文本；tool_calls 时为 ''
      thinking: string          // reasoning_content 累积
      toolCalls: ToolCall[] | null  // finish_reason === 'tool_calls' 时解析后的结构；stop 时为 null
    }
    ```

  **Must NOT do**:
  - 不删除或修改 `ChatChunk` 的其他字段
  - 不修改 `ToolCall` 接口

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1（与 Task 1, 2, 3 并行）
  - **Blocks**: Task 4e
  - **Blocked By**: None

  **References**:
  - `src/types/llm.ts:35-42` - 当前 ChatChunk 定义
  - `src/types/llm.ts:95-102` - ToolCall 接口（返回类型复用）
  - OpenAI streaming tool_calls 格式：每个 chunk 的 `choices[0].delta.tool_calls` 是数组，每项有 `index`；首个 chunk 包含 `id`/`type`/`function.name`；后续 chunk 只追加 `function.arguments` 片段

  **Acceptance Criteria**:
  - [ ] `src/types/llm.ts` 中 `ChatChunk.delta.tool_calls` 字段存在且类型正确
  - [ ] `ToolCallStreamResult` 接口导出
  - [ ] `bunx tsc --noEmit` 无新增 error

  **QA Scenarios**:
  ```
  Scenario: 类型定义完整性
    Tool: Bash
    Steps:
      1. grep -n "tool_calls\|ToolCallStreamResult" src/types/llm.ts
    Expected Result: 可见 tool_calls 字段定义和 ToolCallStreamResult 接口
    Failure Indicators: grep 无输出
    Evidence: .sisyphus/evidence/task-0-types.txt
  ```

  **Commit**: NO（与 Task 4e 合并提交）

---

- [ ] 4e. 新增 streamChatWithTools 函数（统一流式处理 content + tool_calls）

  **What to do**:
  - 在 `src/llm/client.ts` 中新增导出函数 `streamChatWithTools`
  - **完全删除** `chatWithTools` 函数（不保留，不保留兼容导出）
  - 函数签名：
    ```typescript
    export async function streamChatWithTools(
      provider: LLMProvider,
      messages: ChatMessage[],
      tools: ToolDefinition[],
      onChunk: (content: string) => void,
      options?: { timeout?: number; verbose?: boolean; onThinkingChunk?: (content: string) => void }
    ): Promise<ToolCallStreamResult>
    ```
  - **核心实现逻辑**：
    ```typescript
    const toolCallBuffers = new Map<number, {
      id: string; type: string; name: string; arguments: string
    }>();

    // 解析每个 SSE chunk：
    // 1. delta.content → 立即调用 onChunk(content)，累积到 fullReply
    // 2. delta.tool_calls → 按 index 处理：
    //    - 首次出现该 index（有 id）→ 初始化 buffer
    //    - 后续 chunk → 追加 arguments 片段
    // 3. finish_reason === 'stop' 或其他非 tool_calls 值 → 
    //       return { reply: fullReply, thinking: fullThinking, toolCalls: null }
    // 4. finish_reason === 'tool_calls' →
    //       将每个 buffer.arguments 解析为 JSON
    //       return { reply: '', thinking: fullThinking, toolCalls: parsedToolCalls }
    ```
  - **请求体构造**：`tools.length > 0` 时才传 `tools` 字段（避免空数组导致 API 报错）；始终 `stream: true`
  - **arguments 解析异常处理**：`JSON.parse(buffer.arguments)` 失败时，arguments 保留原始字符串，记录 verbose 日志，不抛出（容错）
  - **`finish_reason` 边界**：`'length'`/`'content_filter'` 等非预期值按 `'stop'` 处理（返回已累积 reply）

  **Must NOT do**:
  - 不修改 `streamChat` 函数（签名、行为均不变）
  - 不保留 `chatWithTools` 的任何形式（包括 deprecated 注释导出）

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES（与 Task 4 的 ask.ts 改造并行度有限；但 4e 产出物是 Task 4 的前置条件）
  - **Parallel Group**: Wave 2（先于 Task 4 完成）
  - **Blocks**: Task 4
  - **Blocked By**: Task 0

  **References**:
  - `src/llm/client.ts:6-142` - `streamChat` 完整实现（SSE 解析、buffer 处理、错误处理模式完全复用）
  - `src/llm/client.ts:144-204` - `chatWithTools`（删除目标，理解请求体构造）
  - `src/types/llm.ts:35-42` - `ChatChunk`（Task 0 扩展后含 tool_calls）
  - `src/types/llm.ts:86-102` - `ToolDefinition`、`ToolCall` 类型

  **Acceptance Criteria**:
  - [ ] `streamChatWithTools` 函数导出，签名与上述一致
  - [ ] `chatWithTools` 函数不存在于 `src/llm/client.ts`
  - [ ] `finish_reason === 'stop'`：`toolCalls` 为 null，`reply` 非空
  - [ ] `finish_reason === 'tool_calls'`：`toolCalls` 为 ToolCall 数组，`reply` 为 ''
  - [ ] `bunx tsc --noEmit` 无新增 error

  **QA Scenarios**:
  ```
  Scenario: chatWithTools 已删除
    Tool: Bash
    Steps:
      1. grep -n "export.*chatWithTools\|function chatWithTools" src/llm/client.ts
    Expected Result: 无匹配
    Failure Indicators: 任何匹配输出
    Evidence: .sisyphus/evidence/task-4e-no-chatWithTools.txt

  Scenario: streamChatWithTools 已导出
    Tool: Bash
    Steps:
      1. grep -n "export.*streamChatWithTools\|export async function streamChatWithTools" src/llm/client.ts
    Expected Result: 可见函数导出声明
    Evidence: .sisyphus/evidence/task-4e-function-exists.txt
  ```

  **Commit**: YES（groups with Task 0）
  - Message: `feat(llm): 新增 streamChatWithTools 统一流式处理 content 和 tool_calls；删除非流式 chatWithTools`
  - Files: `src/llm/client.ts`, `src/types/llm.ts`
  - Pre-commit: `bunx tsc --noEmit`

---

- [ ] 1. 修复 trimMessages：感知 tool_calls/tool 消息对结构

  **What to do**:
  - 修改 `src/utils/context.ts` 的 `trimMessages` 函数
  - 当前逻辑：`result.slice(1)` 逐条从头部删除，不感知消息结构
  - 新逻辑：识别消息"组"，一个"组"定义为：
    - 普通消息（user/assistant 无 tool_calls）：单条消息
    - 工具调用组：`assistant（含 tool_calls）` + 其后所有对应的 `tool` 消息（按 tool_call_id 匹配），作为一个不可分割的原子单元
  - 裁剪时以"组"为单位从头部删除，而非逐条删除
  - 如果裁剪后仍超过 targetRatio，继续删除下一组，直到满足条件或只剩1组
  - 函数签名保持不变，向后兼容

  **Must NOT do**:
  - 不修改函数签名
  - 不改变 triggerRatio (0.8) 和 targetRatio (0.5) 的默认值
  - 不引入新依赖

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1（与 Task 0, 2, 3 并行）
  - **Blocks**: Task 5（单元测试）
  - **Blocked By**: None

  **References**:
  - `src/utils/context.ts:39-68` - 当前 trimMessages 完整实现，基础是 `result.slice(1)` 逐条删除
  - `src/types/session.ts:8-20` - Message 类型，`tool_calls?: ToolCall[]` 和 `tool_call_id?: string`
  - `src/types/llm.ts:95-102` - ToolCall 类型

  **改造思路（具体算法）**:
  ```typescript
  function groupMessages(messages: Array<...>): Array<typeof messages> {
    const groups: Array<typeof messages> = [];
    let i = 0;
    while (i < messages.length) {
      const msg = messages[i];
      if (msg.role === 'assistant' && msg.tool_calls && msg.tool_calls.length > 0) {
        const group = [msg];
        i++;
        while (i < messages.length && messages[i].role === 'tool') {
          group.push(messages[i]);
          i++;
        }
        groups.push(group);
      } else {
        groups.push([msg]);
        i++;
      }
    }
    return groups;
  }
  // 裁剪时以 group 为单位 shift
  ```

  **Acceptance Criteria**:
  - [ ] messages 含 `[user, assistant(tool_calls), tool, assistant(tool_calls), tool, user]` 时，裁剪后 assistant+tool 始终成对出现
  - [ ] 函数签名 `trimMessages(messages, config): Promise<...>` 不变

  **QA Scenarios**:
  ```
  Scenario: 组结构感知（代码审查）
    Tool: Bash
    Steps:
      1. grep -n "groupMessages\|tool_calls.*length\|role.*tool" src/utils/context.ts > .sisyphus/evidence/task-1-trim-logic.txt
      2. cat .sisyphus/evidence/task-1-trim-logic.txt
    Expected Result: 可见组划分逻辑，不存在裸 .slice(1) 删除单条消息的逻辑
    Failure Indicators: grep 无输出
    Evidence: .sisyphus/evidence/task-1-trim-logic.txt
  ```

  **Commit**: YES（groups with Task 5）
  - Message: `fix(context): trimMessages 按 tool 消息对为单位裁剪，避免拆散工具调用组`
  - Files: `src/utils/context.ts`

---

- [ ] 2. 修复 executeUnifiedTool：基于 source 字段路由，移除 `__` 猜测

  **What to do**:
  - 修改 `src/tools/store.ts` 的 `executeUnifiedTool` 函数
  - 当前签名：`executeUnifiedTool(name: string, args: Record<string, unknown>): Promise<string>`
  - 新签名：`executeUnifiedTool(tool: UnifiedTool, args: Record<string, unknown>): Promise<string>`
  - 路由逻辑改为：`if (tool.source === 'builtin') → getBuiltinExecutor(tool.name)` / `else → callMCPTool(tool.fullName ?? tool.name, args)`
  - 为 `UnifiedTool` 类型添加可选字段 `fullName?: string`（MCP 工具用，存储 `servername__toolname`；内置工具无需此字段）
  - 更新 `src/commands/ask.ts` 中的调用处，传入 `UnifiedTool` 对象而非仅工具名

  **Must NOT do**:
  - 不修改 `callMCPTool` 的签名
  - 不删除 `UnifiedTool.name` 字段
  - 不改变内置工具的 name 命名规范

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: Task 4（ask.ts 调用 executeUnifiedTool 时需传入 UnifiedTool 对象）
  - **Blocked By**: None

  **References**:
  - `src/tools/store.ts:73-83` - 当前 executeUnifiedTool，通过 `name.includes('__')` 判断
  - `src/types/tool.ts:16-22` - UnifiedTool 接口定义
  - `src/tools/store.ts:47-66` - `getUnifiedToolDefs`，构建 UnifiedTool 列表
  - `src/commands/ask.ts:252` - 当前调用处（需改为传 UnifiedTool）

  **关键约束**：
  - LLM 返回的 `tool_call.function.name` 是 `UnifiedTool.name`
  - 建议在 `ask.ts` 中构建 `toolsByName: Map<string, UnifiedTool>` 索引

  **Acceptance Criteria**:
  - [ ] `executeUnifiedTool` 函数签名接收 `UnifiedTool` 对象
  - [ ] 路由不依赖字符串 `__`，而是 `tool.source` 字段

  **QA Scenarios**:
  ```
  Scenario: source 路由存在
    Tool: Bash
    Steps:
      1. grep -n "tool\.source\|source ===" src/tools/store.ts > .sisyphus/evidence/task-2-source-routing.txt
      2. cat .sisyphus/evidence/task-2-source-routing.txt
    Expected Result: 可见基于 source 字段的条件分支
    Evidence: .sisyphus/evidence/task-2-source-routing.txt

  Scenario: __ 猜测逻辑已删除
    Tool: Bash
    Steps:
      1. grep -n "includes('__')\|indexOf('__')" src/tools/store.ts
    Expected Result: 无匹配输出
    Evidence: .sisyphus/evidence/task-2-no-double-underscore.txt
  ```

  **Commit**: YES（groups with Task 6）
  - Message: `refactor(tools): executeUnifiedTool 改为基于 source 字段路由，移除 __ 名称猜测`
  - Files: `src/tools/store.ts`, `src/types/tool.ts`

---

- [ ] 3. 修正 ToolExecutor 参数类型

  **What to do**:
  - 当前 `src/tools/base.ts`：`execute(args: Record<string, string>): Promise<string>`
  - 修改为：`execute(args: Record<string, unknown>): Promise<string>`
  - 更新所有实现此接口的内置工具文件（`src/tools/builtin/weather.ts`、及其他 builtin 工具）使参数类型一致

  **Must NOT do**:
  - 不修改工具的业务逻辑，只更新参数类型签名

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1
  - **Blocks**: Task 4
  - **Blocked By**: None

  **References**:
  - `src/tools/base.ts:1-3` - ToolExecutor 接口
  - `src/tools/builtin/weather.ts` - weather executor 实现
  - `src/tools/store.ts:79` - 调用处（修复后可移除 `as Record<string, string>` 强制转型）

  **Acceptance Criteria**:
  - [ ] `ToolExecutor.execute` 参数类型为 `Record<string, unknown>`
  - [ ] `src/tools/store.ts` 中的 `as Record<string, string>` 强制转型被移除

  **QA Scenarios**:
  ```
  Scenario: 类型一致性
    Tool: Bash
    Steps:
      1. grep -n "Record<string, string>" src/tools/base.ts src/tools/store.ts src/tools/builtin/*.ts > .sisyphus/evidence/task-3-type-fix.txt 2>&1; echo "exit:$?" >> .sisyphus/evidence/task-3-type-fix.txt
      2. cat .sisyphus/evidence/task-3-type-fix.txt
    Expected Result: 无匹配（全部改为 unknown）
    Evidence: .sisyphus/evidence/task-3-type-fix.txt
  ```

  **Commit**: NO（与 Task 4 合并提交）

---

- [ ] 4. 重构 ask.ts 工具调用循环：统一使用 streamChatWithTools + 消除双重请求 + 改善 UX + 移除 Factory

  **What to do**:

  **4a. 统一工具调用循环使用 streamChatWithTools**：
  - 删除 `ask.ts` 中所有 `chatWithTools` / `chatWithToolsFactory.call` 的调用
  - 工具调用循环统一调用 `streamChatWithTools(provider, messages, toolDefs, onChunk, opts)`
  - 根据返回的 `toolCalls` 判断后续行为：
    - `toolCalls !== null`：执行工具 → 将 assistant（含 tool_calls）和 tool result 追加到 messages → 继续循环
    - `toolCalls === null`：`reply` 已通过 `onChunk` 流式输出完毕，循环结束
  - 无工具时直接调用 `streamChat`（保持原有逻辑不变）
  - 消除双重请求：当 LLM 不调用工具时，`onChunk` 已实时输出内容，无需第二次请求

  **4b. 改善工具调用 UX**：
  - `printToolThinking` 显示参数摘要（截断到 80 字符），格式：`▸ 调用 [toolName] 参数: {key: val, ...}`
  - 工具执行完成后输出执行时间：`  ✓ 完成 (123ms)`

  **4c. 将 Factory 替换为内部依赖（含 ask.test.ts 同步改造）**：

  **背景约束**：`src/commands/ask.test.ts` 目前通过 factory 属性替换 mock。删除 factory 后必须同步迁移。

  **新的测试注入方案**：使用 `bun:test` 的 `mock.module()` 模块级 mock：
  1. 删除 `streamChatFactory`、`chatWithToolsFactory`、`executorFactory`、`toolsStoreFactory` 四个 factory 导出
  2. 内部改为直接调用：`streamChat(...)`, `streamChatWithTools(...)`, `executeUnifiedTool(...)`, `getUnifiedToolDefs(...)`
  3. 同步改造 `ask.test.ts`：
     - 移除这四个 factory 的 import 和 mock 代码
     - 改用 `mock.module('../llm/client.js', ...)` mock `streamChat`/`streamChatWithTools`
     - 改用 `mock.module('../tools/store.js', ...)` mock `getUnifiedToolDefs`/`executeUnifiedTool`
     - `storeFactory` 保留不动
  4. **同步更新 FC 测试断言**：原来断言 `chatWithToolsCallCount` → 改为断言 `streamChatWithToolsCallCount`；修复双重请求后，LLM 不调用工具时 `streamChatCalled === false`（已由 streamChatWithTools 处理）

  **4d. 更新 executeUnifiedTool 调用**（配合 Task 2）：
  - 构建 `toolsByName: Map<string, UnifiedTool>` 索引
  - 执行工具时 `const tool = toolsByName.get(toolName)` 然后 `executeUnifiedTool(tool, argsObject)`

  **Must NOT do**:
  - 不改变 ask.ts 的 CLI 接口（参数、flags 不变）
  - 不删除 `storeFactory`（session store 的注入点）
  - 不改变 session 消息的持久化格式
  - 不修改 `streamChat` 函数签名

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2（串行，依赖 Task 2, 3, 4e 完成）
  - **Blocks**: Task F1-F3
  - **Blocked By**: Task 2, 3, 4e

  **References**:
  - `src/commands/ask.ts:165-308` - 工具调用循环主体
  - `src/commands/ask.ts:272-299` - 双重请求的来源（toolCallCount === 0 分支）
  - `src/commands/ask.ts:20-54` - 所有 Factory 定义
  - `src/commands/ask.test.ts` - 现有测试，需同步迁移
  - `src/session/store.test.ts` - bun test mock 写法参考
  - `src/llm/client.ts` - `streamChatWithTools` 函数（Task 4e 产出）

  **新的工具循环结构**：
  ```typescript
  const result = await streamChatWithTools(provider, messages, toolDefs, onChunk, opts);
  if (result.toolCalls !== null) {
    // 追加 assistant message（含 tool_calls）
    messages.push({ role: 'assistant', content: '', tool_calls: result.toolCalls });
    // 执行每个工具
    for (const tc of result.toolCalls) {
      const tool = toolsByName.get(tc.function.name);
      const toolResult = await executeUnifiedTool(tool, JSON.parse(tc.function.arguments));
      messages.push({ role: 'tool', content: toolResult, tool_call_id: tc.id });
    }
    // 继续循环
  } else {
    // reply 已流式输出，循环结束
    fullReply = result.reply;
    break;
  }
  ```

  **Acceptance Criteria**:
  - [ ] 无工具时：`bun run src/main.ts ask "hello"` 正常输出（流式）
  - [ ] 有工具但 LLM 不调用时：只发起 1 次 LLM 请求（`streamChatWithTools`），内容流式输出
  - [ ] 工具调用发生后：流式探测 → 执行工具 → 再次流式请求最终回复
  - [ ] `chatWithToolsFactory`、`streamChatFactory`、`executorFactory`、`toolsStoreFactory` 不再存在
  - [ ] `bun test src/commands/ask.test.ts` 通过（含更新后的 FC 断言）

  **QA Scenarios**:
  ```
  Scenario: 无工具正常对话
    Tool: Bash
    Steps:
      1. bun run src/main.ts ask "用一句话介绍 TypeScript" 2>/dev/null > .sisyphus/evidence/task-4-no-tools.txt
      2. cat .sisyphus/evidence/task-4-no-tools.txt
    Expected Result: stdout 包含关于 TypeScript 的文字描述，无报错
    Failure Indicators: 输出为空；出现 "LLM 调用失败"
    Evidence: .sisyphus/evidence/task-4-no-tools.txt

  Scenario: Factory 已移除
    Tool: Bash
    Steps:
      1. grep -n "chatWithToolsFactory\|streamChatFactory\|executorFactory\|toolsStoreFactory" src/commands/ask.ts > .sisyphus/evidence/task-4-factory-removed.txt 2>&1 || echo "no match" > .sisyphus/evidence/task-4-factory-removed.txt
      2. cat .sisyphus/evidence/task-4-factory-removed.txt
    Expected Result: 无匹配（或文件内容为 "no match"）
    Evidence: .sisyphus/evidence/task-4-factory-removed.txt

  Scenario: chatWithTools 调用已删除
    Tool: Bash
    Steps:
      1. grep -n "chatWithTools\b" src/commands/ask.ts > .sisyphus/evidence/task-4-no-chatWithTools.txt 2>&1 || echo "no match" > .sisyphus/evidence/task-4-no-chatWithTools.txt
      2. cat .sisyphus/evidence/task-4-no-chatWithTools.txt
    Expected Result: 无匹配
    Evidence: .sisyphus/evidence/task-4-no-chatWithTools.txt
  ```

  **Commit**: YES
  - Message: `refactor(ask): 统一使用 streamChatWithTools，消除双重 LLM 请求，改善工具 UX，移除 Factory`
  - Files: `src/commands/ask.ts`, `src/tools/base.ts`, `src/tools/builtin/weather.ts`
  - Pre-commit: `bun run src/main.ts ask "hello" 2>/dev/null`

---

- [ ] 5. 补充 trimMessages 单元测试

  **What to do**:
  - 新建 `src/utils/context.test.ts`（若不存在）
  - 针对 `trimMessages` 新增以下测试用例：
    1. **happy path（无工具消息）**：普通 user/assistant 交替，超 triggerRatio 时裁剪为 targetRatio，不拆散任何消息
    2. **工具调用组完整性**：`[user, assistant(tool_calls), tool, user, assistant]` 超阈值时，裁剪后 `assistant(tool_calls)` 与其 `tool` 始终成对
    3. **最小组保留**：所有消息都在一个工具组中，超阈值时整组保留（不拆分）
    4. **无需裁剪**：总 token 数未超过 triggerRatio，返回原数组不变

  **Must NOT do**:
  - 不 mock tiktoken（使用真实 token 计数）
  - 不修改 `trimMessages` 实现本身

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES（与 Task 6 并行）
  - **Parallel Group**: Wave 3
  - **Blocks**: F1-F3
  - **Blocked By**: Task 1

  **References**:
  - `src/utils/context.ts:39-68` - trimMessages 实现
  - `src/session/store.test.ts` - bun test 写法参考（describe/test/expect）
  - `src/types/session.ts:8-20` - Message 类型（构造测试数据用）

  **Acceptance Criteria**:
  - [ ] `bun test src/utils/context.test.ts` 通过（4 个用例全 pass）
  - [ ] 工具调用组完整性用例：断言裁剪结果中 tool 消息数量 === assistant(tool_calls) 中 tool_calls.length 之和

  **QA Scenarios**:
  ```
  Scenario: 单元测试全部通过
    Tool: Bash
    Steps:
      1. bun test src/utils/context.test.ts 2>&1 | tee .sisyphus/evidence/task-5-test-result.txt
    Expected Result: "X pass, 0 fail" 且包含工具调用组完整性测试通过
    Failure Indicators: 任何 "fail" 行出现
    Evidence: .sisyphus/evidence/task-5-test-result.txt
  ```

  **Commit**: YES（groups with Task 1）
  - Message: `test(context): 补充 trimMessages 单元测试，覆盖工具调用组完整性场景`
  - Files: `src/utils/context.ts`, `src/utils/context.test.ts`
  - Pre-commit: `bun test src/utils/context.test.ts`

---

- [ ] 6. 补充 executeUnifiedTool 单元测试

  **What to do**:
  - 新建 `src/tools/store.test.ts`（若不存在）
  - 针对 `executeUnifiedTool` 新增以下测试用例：
    1. **内置工具路由**：`tool.source === 'builtin'` → 调用对应的内置 executor，返回结果字符串
    2. **MCP 工具路由**：`tool.source === 'mcp'` → 调用 `callMCPTool(tool.fullName, args)`
    3. **source 无 `__` 时仍正确路由**：工具名不含 `__`，靠 source 字段路由，不报错
    4. **未知 source 报错**：source 为其他值时抛出可识别的错误

  - 使用 `mock.module('path/to/module', ...)` mock 内置 executor 和 MCP client

  **Must NOT do**:
  - 不进行真实 MCP/网络调用
  - 不修改 `executeUnifiedTool` 实现本身

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES（与 Task 5 并行）
  - **Parallel Group**: Wave 3
  - **Blocks**: F1-F3
  - **Blocked By**: Task 2

  **References**:
  - `src/tools/store.ts:73-83` - executeUnifiedTool 实现（Task 2 重构后）
  - `src/types/tool.ts:16-22` - UnifiedTool 接口
  - `src/session/store.test.ts` - mock.module 写法参考

  **Acceptance Criteria**:
  - [ ] `bun test src/tools/store.test.ts` 通过（4 个用例全 pass）
  - [ ] 测试中无硬编码 `__` 字符串用于路由判断

  **QA Scenarios**:
  ```
  Scenario: 单元测试全部通过
    Tool: Bash
    Steps:
      1. bun test src/tools/store.test.ts 2>&1 | tee .sisyphus/evidence/task-6-test-result.txt
    Expected Result: "X pass, 0 fail"
    Failure Indicators: 任何 "fail" 行
    Evidence: .sisyphus/evidence/task-6-test-result.txt
  ```

  **Commit**: YES（groups with Task 2）
  - Message: `test(tools): 补充 executeUnifiedTool 单元测试，覆盖 source 路由场景`
  - Files: `src/tools/store.ts`, `src/types/tool.ts`, `src/tools/store.test.ts`
  - Pre-commit: `bun test src/tools/store.test.ts`

---

## Final Verification Wave

> 3 个 review agent 并行运行。全部 APPROVE 后向用户展示汇总结果并等待明确 OK 才算完成。
> 任何 REJECT 或用户反馈 → 修复 → 重新运行 → 再次等待用户 OK。

- [ ] F1. **计划合规审计** — `oracle`

  逐条检查 "Must Have"（功能向后兼容、最多 10 次循环、Session 格式不变）和 "Must NOT Have"（无新依赖、无改 streamChat 签名、chatWithTools 已彻底删除）。

  具体步骤：
  1. `grep -rn "chatWithTools" src/` → 期望：无匹配
  2. `grep -n "chatWithToolsFactory\|streamChatFactory\|executorFactory\|toolsStoreFactory" src/commands/ask.ts` → 期望：无匹配
  3. `grep -n "maxToolCalls\|toolCallCount" src/commands/ask.ts` → 期望：存在且值为 10
  4. `bunx tsc --noEmit` → 期望：0 errors
  5. 检查 `.sisyphus/evidence/` 目录下各 task 的 evidence 文件是否存在

  Output: `Must Have [N/N] | Must NOT Have [N/N] | Evidence Files [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **代码质量审查** — `unspecified-high`

  具体步骤：
  1. `bunx tsc --noEmit 2>&1 | tee .sisyphus/evidence/final-tsc.txt` → 期望：0 errors
  2. `bun test 2>&1 | tee .sisyphus/evidence/final-test.txt` → 期望：全部 pass
  3. `grep -rn "as any\|@ts-ignore\|console\.log" src/` → 记录发现
  4. 检查新增代码是否有 AI slop（过度注释、无意义变量名、空 catch 块）

  Output: `Build [PASS/FAIL] | Tests [N pass/N fail] | Lint Issues [N] | VERDICT: APPROVE/REJECT`

- [ ] F3. **真实 QA 执行** — `unspecified-high`

  具体步骤：
  1. `bun run src/main.ts ask "用一句话介绍 TypeScript" 2>/dev/null | tee .sisyphus/evidence/final-qa-no-tools.txt`
     → 期望：有实质性输出
  2. 收集所有 task 的 evidence 文件，验证文件存在且内容符合预期
  3. `bun test 2>&1 | tee .sisyphus/evidence/final-qa-tests.txt`
     → 期望：0 fail
  4. `grep -c "chatWithTools" src/llm/client.ts src/commands/ask.ts 2>/dev/null | tee .sisyphus/evidence/final-qa-deleted.txt`
     → 期望：所有文件计数为 0

  Output: `E2E [PASS/FAIL] | Evidence [N/N] | Tests [N pass/N fail] | VERDICT: APPROVE/REJECT`

---

## Commit Strategy

| Commit | Message | Files | Pre-commit |
|--------|---------|-------|------------|
| C1 | `feat(llm): 新增 streamChatWithTools 统一流式处理 content 和 tool_calls；删除非流式 chatWithTools` | `src/llm/client.ts`, `src/types/llm.ts` | `bunx tsc --noEmit` |
| C2 | `fix(context): trimMessages 按 tool 消息对为单位裁剪，避免拆散工具调用组` | `src/utils/context.ts`, `src/utils/context.test.ts` | `bun test src/utils/context.test.ts` |
| C3 | `refactor(tools): executeUnifiedTool 改为基于 source 字段路由，移除 __ 名称猜测` | `src/tools/store.ts`, `src/types/tool.ts`, `src/tools/store.test.ts` | `bun test src/tools/store.test.ts` |
| C4 | `refactor(ask): 统一使用 streamChatWithTools，消除双重 LLM 请求，改善工具 UX，移除 Factory` | `src/commands/ask.ts`, `src/tools/base.ts`, `src/tools/builtin/weather.ts` | `bun run src/main.ts ask "hello" 2>/dev/null` |

---

## Success Criteria

### Verification Commands
```bash
bunx tsc --noEmit            # Expected: 0 errors
bun test                     # Expected: all pass
grep -rn "chatWithTools" src/ # Expected: no match
bun run src/main.ts ask "用一句话介绍 TypeScript" 2>/dev/null  # Expected: 有实质输出
```

### Final Checklist
- [ ] `chatWithTools` 从代码库彻底删除
- [ ] 所有 Factory（除 storeFactory 外）从 ask.ts 删除
- [ ] `executeUnifiedTool` 不含 `includes('__')` 路由
- [ ] `trimMessages` 按工具调用组为单位裁剪
- [ ] `bun test` 全部通过
- [ ] `bunx tsc --noEmit` 无 error

