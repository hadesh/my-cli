# Chat Mode 滑动窗口优化

## TL;DR

> **Quick Summary**: 为 my-cli 的 `ask` 命令新增 `lite`/`normal` 两种对话模式，各自使用不同的消息数量限制和 token 裁剪策略。
>
> **Deliverables**:
> - `src/config/schema.ts`：新增 `chatMode` 字段
> - `src/utils/context.ts`：新增 `trimMessages` 异步函数
> - `src/commands/ask.ts`：替换旧 `slice(-contextWindow)` 逻辑
>
> **Estimated Effort**: Short
> **Parallel Execution**: YES - Wave 1 两个任务可并行
> **Critical Path**: Task 1 → Task 3 → 编译验证

---

## Context

### Original Request
在 `ask` 命令中优化滑动窗口逻辑，新增两种对话模式：
- **lite**：保留最新 20 条消息，token 占用超 50% 时从最早消息开始裁剪，直至 ≤50%
- **normal**：不限条数，token 占用超 80% 才触发裁剪，裁剪至 ≤50%

### Interview Summary
**Key Discussions**:
- 阈值（20 条、50%、80%）均为固定值，不可配置
- `chatMode` 默认为 `'lite'`，保持与原行为近似
- 无需新增 CLI flag 切换 chatMode，仅通过 config 配置

**Research Findings**:
- `countTokens` 为同步函数，`freeEncoder` 必须在所有 token 计算完成后统一调用
- `calcContextStats` 已有 contextLimit 获取样板，`trimMessages` 复用同样逻辑
- session.messages 只存 user/assistant 两种 role，无 tool messages

### Metis Review
**Identified Gaps** (addressed):
- `trimMessages` 必须返回新数组，不能 mutate 原数组 → 已纳入约束
- contextLimit 为 undefined 时的降级处理 → lite 仅按条数裁剪，normal 不做 token 裁剪
- 最少保留 1 条消息（空消息数组返回空数组）→ 已纳入实现
- `freeEncoder()` 调用时机 → 在 ask.ts 中统一调用，`trimMessages` 内不调用

---

## Work Objectives

### Core Objective
在不破坏现有 API 的前提下，为 `ask` 命令引入 token 感知的消息裁剪逻辑。

### Concrete Deliverables
- `src/config/schema.ts`：`chatMode: z.enum(['lite', 'normal']).default('lite')`
- `src/utils/context.ts`：`export async function trimMessages(messages, config): Promise<Message[]>`
- `src/commands/ask.ts`：第 95-97 行替换为 `const recentMessages = await trimMessages(session.messages, config);`

### Definition of Done
- [ ] `bun build src/main.ts --target bun --outdir /tmp/check-out 2>&1` 无错误
- [ ] lite 模式：发送超过 20 条消息的 session 时，实际传给 LLM 的不超过 20 条
- [ ] normal 模式：短 session 时不触发裁剪

### Must Have
- `chatMode` 字段有效，存入 config.json 后可读取
- `trimMessages` 处理 contextLimit 为 undefined 时不崩溃
- 保持至少 1 条消息（若输入非空）

### Must NOT Have (Guardrails)
- 不得 mutate `session.messages` 原数组
- 不得在 `trimMessages` 内部调用 `freeEncoder()`（由 ask.ts 统一管理）
- 不得新增第三种 chatMode
- 不得修改 Session/Message 接口定义
- 不得在此任务中为 chatMode 新增 CLI flag
- 不得改动 `contextWindow` 字段的现有行为（保持向后兼容）

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed.

### Test Decision
- **Infrastructure exists**: YES（bun test）
- **Automated tests**: Tests-after
- **Framework**: bun test

### QA Policy
每个任务完成后编译验证：`bun build src/main.ts --target bun --outdir /tmp/check-out 2>&1`

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately - 并行):
├── Task 1: schema.ts 新增 chatMode 字段 [quick]
└── Task 2: context.ts 新增 trimMessages 函数 [unspecified-high]

Wave 2 (After Wave 1):
└── Task 3: ask.ts 替换滑动窗口逻辑 [quick]

Wave FINAL:
└── Task F1: 编译验证 + 快速功能测试 [quick]
```

### Dependency Matrix

- **1**: 无依赖 → 被 Task 3 依赖（chatMode 类型）
- **2**: 无依赖 → 被 Task 3 依赖（trimMessages 函数）
- **3**: 依赖 1、2 → 被 F1 依赖
- **F1**: 依赖 3

---

## TODOs

- [x] 1. 新增 chatMode 字段到 schema.ts

  **What to do**:
  - 在 `src/config/schema.ts` 的 `configSchema` 中，在 `model` 字段后添加：
    ```typescript
    chatMode: z.enum(['lite', 'normal']).default('lite'),
    ```

  **Must NOT do**:
  - 不得删除或修改 `contextWindow` 字段
  - 不得修改其他已有字段

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1（与 Task 2 并行）
  - **Blocks**: Task 3
  - **Blocked By**: 无

  **References**:
  - `src/config/schema.ts`（全文，直接修改）

  **Acceptance Criteria**:
  - [ ] `bun build src/main.ts --target bun --outdir /tmp/check-out 2>&1` 无错误
  - [ ] `Config` 类型中含 `chatMode: 'lite' | 'normal'` 字段

  **QA Scenarios**:

  ```
  Scenario: schema 编译通过
    Tool: Bash
    Steps:
      1. bun build src/main.ts --target bun --outdir /tmp/check-out 2>&1
    Expected Result: exit 0, 无 TS 错误
    Evidence: .sisyphus/evidence/task-1-build.txt

  Scenario: 类型推断正确
    Tool: Bash
    Steps:
      1. 在临时脚本中 import { configSchema } 并 parse { chatMode: 'lite' }
      2. 验证返回值类型含 chatMode
    Expected Result: 解析成功，chatMode 为 'lite'
    Evidence: .sisyphus/evidence/task-1-type.txt
  ```

  **Commit**: YES（与 Task 2 合并）
  - Message: `feat(config): add chatMode field to schema`
  - Files: `src/config/schema.ts`

---

- [x] 2. 新增 trimMessages 函数到 context.ts

  **What to do**:
  - 在 `src/utils/context.ts` 末尾新增：

  ```typescript
  export async function trimMessages(
    messages: Array<{ role: string; content: string }>,
    config: Config
  ): Promise<Array<{ role: string; content: string }>> {
    const isLite = (config.chatMode ?? 'lite') === 'lite';
    let result = isLite ? messages.slice(-20) : [...messages];

    if (!config.model) return result;

    const [providerName, modelId] = config.model.split('/');
    if (!providerName || !modelId) return result;

    const llmConfig = await loadLLMConfig();
    const provider = llmConfig.providers.find(p => p.name === providerName);
    const contextLimit = provider?.models?.[modelId]?.limit?.context;

    if (!contextLimit) return result;

    const triggerRatio = isLite ? 0.5 : 0.8;
    const targetRatio = 0.5;

    const getTokens = () => countTokens(result.map(m => m.content).join(''));

    if (getTokens() / contextLimit > triggerRatio) {
      while (result.length > 1 && getTokens() / contextLimit > targetRatio) {
        result = result.slice(1);
      }
    }

    return result;
  }
  ```

  **Must NOT do**:
  - 不得在函数内调用 `freeEncoder()`
  - 不得 mutate 原始 `messages` 数组
  - 不得将 agentMd 计入 token 计算

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1（与 Task 1 并行）
  - **Blocks**: Task 3
  - **Blocked By**: 无

  **References**:
  - `src/utils/context.ts`（现有 `calcContextStats` 的 contextLimit 获取逻辑为样板，复用）
  - `src/utils/tokenizer.ts`（`countTokens` 同步函数签名）
  - `src/llm/config.ts`（`loadLLMConfig` 函数）

  **Acceptance Criteria**:
  - [ ] 函数导出正确，可被 ask.ts import
  - [ ] `bun build src/main.ts --target bun --outdir /tmp/check-out 2>&1` 无错误
  - [ ] lite 模式：输入 25 条消息时，返回最多 20 条
  - [ ] lite 模式：contextLimit 为 undefined 时，直接返回最多 20 条，不报错
  - [ ] normal 模式：contextLimit 为 undefined 时，返回全部消息，不报错
  - [ ] 空输入返回空数组

  **QA Scenarios**:

  ```
  Scenario: lite 模式消息数量裁剪
    Tool: Bash (bun repl / test script)
    Steps:
      1. 构造 25 条 { role: 'user', content: 'short' } 消息
      2. 调用 trimMessages(messages, { chatMode: 'lite', model: undefined })
      3. 断言返回数组长度 === 20
    Expected Result: 返回最新 20 条
    Evidence: .sisyphus/evidence/task-2-lite-count.txt

  Scenario: contextLimit 为 undefined 时不崩溃
    Tool: Bash
    Steps:
      1. config.model = undefined
      2. 调用 trimMessages(25条消息, config)
      3. 验证不抛出异常，返回最多 20 条（lite）
    Expected Result: 无异常，正常返回
    Evidence: .sisyphus/evidence/task-2-no-limit.txt
  ```

  **Commit**: YES（与 Task 1 合并）
  - Message: `feat(config): add chatMode field to schema`（合并入同一 commit 或单独）
  - Files: `src/utils/context.ts`

---

- [x] 3. ask.ts 替换滑动窗口逻辑

  **What to do**:
  - 在 `src/commands/ask.ts` 顶部 import 中新增 `trimMessages`：
    ```typescript
    import { calcContextStats, formatContextLine, trimMessages } from '../utils/context.js';
    ```
  - 替换第 95-97 行（`// 滑动窗口裁剪` 块）：
    ```typescript
    // 替换前:
    const contextWindow = config.contextWindow ?? 20;
    const recentMessages = session.messages.slice(-contextWindow);

    // 替换后:
    const recentMessages = await trimMessages(session.messages, config);
    ```
  - 确保 `freeEncoder()` 在 `calcContextStats` 和 `trimMessages` 都调用完后再统一调用（当前第 149 行的 `freeEncoder()` 在 `calcContextStats` 之后，此处 `trimMessages` 在 `calcContextStats` 之前调用，因此需要确认顺序：先 `trimMessages`，构造 messages，再 `calcContextStats`，再 `freeEncoder()`）

  **执行顺序说明**（当前 ask.ts 逻辑）：
  - 第 95-97 行：裁剪消息（原 slice，现替换为 trimMessages）
  - 第 100-107 行：构造 messages 数组
  - 第 148-150 行：calcContextStats → freeEncoder()
  
  由于 `trimMessages` 也调用 `countTokens`，而 `freeEncoder` 在第 149 行才调用，需确认 `freeEncoder` 是否安全（tiktoken encoder 同一进程内复用单例，多次调用 countTokens 不需要每次 free，只需在全部计算完后 free 一次）。当前 ask.ts 中第 149 行的位置已是最后一次 token 计算之后，trimMessages 先于 calcContextStats 执行，顺序正确。

  **Must NOT do**:
  - 不得删除 `freeEncoder()` 调用
  - 不得修改 messages 构造逻辑（第 100-107 行保持不变，仅替换 recentMessages 赋值）
  - 不得引入新的 import 除 trimMessages

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2（顺序）
  - **Blocks**: Task F1
  - **Blocked By**: Task 1、Task 2

  **References**:
  - `src/commands/ask.ts`（第 95-107 行为替换目标，第 16 行为 import 行）
  - `src/utils/context.ts`（trimMessages 函数签名）

  **Acceptance Criteria**:
  - [ ] `bun build src/main.ts --target bun --outdir /tmp/check-out 2>&1` 无错误
  - [ ] 无 TS 类型错误

  **QA Scenarios**:

  ```
  Scenario: 编译通过
    Tool: Bash
    Steps:
      1. bun build src/main.ts --target bun --outdir /tmp/check-out 2>&1
    Expected Result: exit 0，无任何错误输出
    Evidence: .sisyphus/evidence/task-3-build.txt

  Scenario: 运行时不崩溃（smoke test）
    Tool: Bash
    Steps:
      1. bun run src/main.ts ask "hello" 2>&1（需要有效 provider 配置，或 mock）
      2. 或者检查 ask.test.ts 中的单元测试通过
    Expected Result: 无 "TypeError" / "undefined is not a function" 类报错
    Evidence: .sisyphus/evidence/task-3-smoke.txt
  ```

  **Commit**: YES
  - Message: `feat(ask): use token-aware trimMessages for sliding window`
  - Files: `src/commands/ask.ts`
  - Pre-commit: `bun build src/main.ts --target bun --outdir /tmp/check-out`

---

## Final Verification Wave

- [x] F1. **编译 + 功能验证** — `quick`
  1. `bun build src/main.ts --target bun --outdir /tmp/check-out 2>&1` → 无错误
  2. 检查 `src/config/schema.ts` 含 `chatMode` 字段
  3. 检查 `src/utils/context.ts` 导出 `trimMessages`
  4. 检查 `src/commands/ask.ts` import `trimMessages` 且不再有 `slice(-contextWindow)` 逻辑
  
  Output: `Build [PASS/FAIL] | chatMode [YES/NO] | trimMessages [YES/NO] | ask.ts [UPDATED/NOT] | VERDICT`

---

## Commit Strategy

1. `feat(config): add chatMode field to schema` — `src/config/schema.ts`
2. `feat(context): add trimMessages for token-aware sliding window` — `src/utils/context.ts`
3. `feat(ask): use token-aware trimMessages for sliding window` — `src/commands/ask.ts`

---

## Success Criteria

### Verification Commands
```bash
bun build src/main.ts --target bun --outdir /tmp/check-out 2>&1
# Expected: 无输出（exit 0）
```

### Final Checklist
- [ ] `chatMode` 字段已加入 schema
- [ ] `trimMessages` 已实现并导出
- [ ] `ask.ts` 使用 `trimMessages` 替代旧 `slice` 逻辑
- [ ] 编译无错误
