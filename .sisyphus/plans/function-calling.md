# Function Calling 工具调用系统

## TL;DR

> **Quick Summary**: 在现有 TypeScript + Bun CLI 工具中实现完整的 Function Calling 系统，包括本地工具 CRUD 管理、Shell 命令执行器、LLM 工具调用循环，以及 `tools` 命令组。
>
> **Deliverables**:
> - `src/types/tool.ts` — Tool / ToolParameters / ToolsConfig 接口
> - `src/config/paths.ts` — 追加 TOOLS_CONFIG_FILE 常量
> - `src/types/llm.ts` — 追加 tool 相关类型（只追加，不修改现有字段）
> - `src/tools/store.ts` + `store.test.ts` — tools.json CRUD
> - `src/tools/executor.ts` + `executor.test.ts` — Shell 命令执行器
> - `src/llm/client.ts` — 追加 `chatWithTools` 非流式函数
> - `src/commands/tools.ts` + `tools.test.ts` — tools 命令组（add/list/enable/disable/delete）
> - `src/commands/ask.ts` — 集成 Function Calling 循环（有工具时）
> - `src/main.ts` — 注册 toolsCommand
>
> **Estimated Effort**: Large
> **Parallel Execution**: YES - 4 waves
> **Critical Path**: Task 1 → Task 4 → Task 6 → Task 7 → Task 8

---

## Context

### Original Request
在现有 TypeScript + Bun CLI 工具中实现工具调用系统（Function Calling），本地可以注册/禁用/删除工具（`tools` 命令组），LLM 请求时可以自动调用本地注册的工具。参考阿里云 Qwen Function Calling 文档。

### Interview Summary

**Key Discussions**:
- 工具执行方式：Shell 命令 + `{{参数}}` 占位符（用户确认）
- 最后一轮 LLM 回复：流式渲染（与无工具时体验一致）（用户确认）
- `tools add` 方式：交互式 readline 输入（用户确认）
- 工具配置持久化到 `~/.config/my-cli/tools.json`

**Research Findings**:
- 阿里云 Qwen Function Calling API：第一次调用携带 tools 数组，LLM 返回 tool_calls，本地执行后追加 assistant + tool 消息再循环，最后一轮用 streamChat 流式
- 现有 `src/llm/client.ts` 的 `streamChat` 使用 `provider.baseUrl` 作为完整 URL（已含路径），新函数需遵循同样约定
- 现有 `src/session/store.ts` 使用 `Bun.write()` 写文件，`readFileSync` 读文件，新的 `tools/store.ts` 应遵循同样模式
- `src/config/paths.ts` 集中管理配置路径，需追加 `TOOLS_CONFIG_FILE` 常量

### Metis Review

**Identified Gaps** (addressed):
- 无限循环风险：需设置 `maxToolCalls` 上限（默认 10）防止 LLM 无止境调用工具
- Shell 注入安全：占位符替换时需转义特殊字符（`$`, `` ` ``, `\`, `"`）
- 工具输出截断：stdout 过大时截断为 4000 字符再发给 LLM
- 工具执行超时：默认 30s 超时，使用 AbortController 或 Promise.race
- Session 存储兼容：`Message` 类型的 `role` 仅为 `'user' | 'assistant'`，需检查是否需要扩展
- 空工具输出处理：返回 `"(no output)"` 给 LLM
- `tools.json` 不存在时：返回空列表，不报错
- 工具不存在时：向 LLM 返回错误消息而不是崩溃

---

## Work Objectives

### Core Objective
实现 Function Calling 系统：`tools` 命令管理本地工具，`ask` 命令自动携带已启用工具调用 LLM，LLM 返回 tool_calls 时本地执行并循环，最后一轮流式输出。

### Concrete Deliverables
- `~/.config/my-cli/tools.json` — 工具配置文件（运行时自动生成）
- `my-cli tools add/list/enable/disable/delete` — 完整 CRUD 命令
- `my-cli ask "问题"` — 自动携带已启用工具，触发 Function Calling 循环

### Definition of Done
- [ ] `bun test` 全部通过（55+ tests）
- [ ] `bun run tsc --noEmit` 无 TypeScript 错误
- [ ] `my-cli tools list` 可正常运行（即使 tools.json 不存在）
- [ ] `my-cli ask "xxx"` 在无工具时走原有流程（不退化）

### Must Have
- Tool CRUD: add（交互式）/ list / enable / disable / delete
- Shell 命令执行：`{{paramName}}` 占位符替换
- Function Calling 循环：chatWithTools → execute → append → repeat（最多 10 次）
- 最后一轮用 streamChat 流式渲染
- `~/.config/my-cli/tools.json` 持久化
- 所有新模块有单元测试

### Must NOT Have (Guardrails)
- ❌ 不修改 `hello` / `weather` 命令逻辑
- ❌ 不删改 `src/types/llm.ts` 现有字段（只追加）
- ❌ 不删改 `src/config/schema.ts` 现有字段（只追加）
- ❌ 不修改 `streamChat` 函数签名
- ❌ 不修改 `src/types/session.ts` 中的 `Message` 接口（session 消息只存 user/assistant）
- ❌ 不实现自动工具发现、工具市场、工具版本管理、远程工具定义
- ❌ 不实现并发工具执行（串行即可）
- ❌ 不支持多级工具嵌套调用
- ❌ 不在 session 中存储 tool/tool_call 类型消息（只存最终 user/assistant）
- ❌ `{{param}}` 以外的占位符格式（如 `${param}` 或 `%param%`）

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed.

### Test Decision
- **Infrastructure exists**: YES（bun test）
- **Automated tests**: Tests-after（先实现，再补测试）
- **Framework**: `bun test`

### QA Policy
每个 Task 必须包含 agent 可执行的 QA Scenarios。证据保存到 `.sisyphus/evidence/task-{N}-{slug}.{ext}`。

- **CLI 命令**：Bash 执行命令，验证 stdout/stderr 和退出码
- **单元测试**：`bun test <file>` 通过
- **TypeScript 类型**：`bun run tsc --noEmit` 无错误

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (立即开始 - 无依赖，全部并行):
├── Task 1: 新增 src/types/tool.ts + 修改 src/config/paths.ts + 修改 src/types/llm.ts [quick]
└── (单任务，涉及文件少且全为类型定义/常量，5 分钟内完成)

Wave 2 (Wave 1 完成后 - 最大并行):
├── Task 2: 新增 src/tools/store.ts + store.test.ts (depends: 1) [unspecified-low]
├── Task 3: 新增 src/tools/executor.ts + executor.test.ts (depends: 1) [unspecified-low]
└── Task 4: 修改 src/llm/client.ts 追加 chatWithTools + 更新 client.test.ts (depends: 1) [unspecified-low]

Wave 3 (Wave 2 完成后 - 并行):
├── Task 5: 新增 src/commands/tools.ts + tools.test.ts (depends: 1, 2) [unspecified-low]
└── Task 6: 修改 src/commands/ask.ts 集成 FC 循环 (depends: 2, 3, 4) [unspecified-high]

Wave 4 (Wave 3 完成后):
└── Task 7: 修改 src/main.ts 注册 toolsCommand + 运行 bun test 全量验证 (depends: 5, 6) [quick]

Wave FINAL (Task 7 完成后 - 并行 review):
├── Task F1: Plan Compliance Audit (oracle)
├── Task F2: Code Quality Review (unspecified-high)
├── Task F3: Real Manual QA (unspecified-high)
└── Task F4: Scope Fidelity Check (deep)
→ 汇总结果 → 等待用户 okay

Critical Path: Task 1 → Task 4 → Task 6 → Task 7 → F1-F4 → user okay
Parallel Speedup: ~60% faster than sequential
Max Concurrent: 3 (Wave 2)
```

### Dependency Matrix

| Task | Depends On | Blocks |
|------|-----------|--------|
| 1 | - | 2, 3, 4, 5, 6 |
| 2 | 1 | 5, 6 |
| 3 | 1 | 6 |
| 4 | 1 | 6 |
| 5 | 1, 2 | 7 |
| 6 | 2, 3, 4 | 7 |
| 7 | 5, 6 | F1-F4 |

### Agent Dispatch Summary

- **Wave 1** (1 task): T1 → `quick`
- **Wave 2** (3 tasks): T2, T3, T4 → `unspecified-low`
- **Wave 3** (2 tasks): T5 → `unspecified-low`, T6 → `unspecified-high`
- **Wave 4** (1 task): T7 → `quick`
- **FINAL** (4 tasks): F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

- [x] Task 1: 新增 `src/types/tool.ts` + 修改 `src/config/paths.ts`（追加 TOOLS_CONFIG_FILE）+ 修改 `src/types/llm.ts`（追加 tool 相关类型）
- [x] Task 2: 新增 `src/tools/store.ts` + `src/tools/store.test.ts`（tools.json CRUD）
- [x] Task 3: 新增 `src/tools/executor.ts` + `src/tools/executor.test.ts`（Shell 命令执行器）
- [x] Task 4: 修改 `src/llm/client.ts` 追加 `chatWithTools` 非流式函数 + 更新 `src/llm/client.test.ts`
- [x] Task 5: 新增 `src/commands/tools.ts` + `src/commands/tools.test.ts`（tools add/list/enable/disable/delete）
- [x] Task 6: 修改 `src/commands/ask.ts` 集成 Function Calling 循环 + 更新 `src/commands/ask.test.ts`
- [x] Task 7: 修改 `src/main.ts` 注册 toolsCommand + 运行 `bun test` 全量验证

---

## Final Verification Wave

> 4 个 review agent 并行运行。所有人必须 APPROVE。汇总结果展示给用户，等待明确的 "okay" 后才能完成。
>
> **不得自动跳过此步骤。拒绝或用户反馈 → 修复 → 重跑 → 再次展示 → 等待 okay。**

- [ ] F1. **Plan Compliance Audit** — `oracle`
  读取完整计划，逐条核查 "Must Have"：验证实现存在（读文件、执行命令）。逐条核查 "Must NOT Have"：在代码库中搜索被禁止的模式（如发现则报告 file:line）。检查 `.sisyphus/evidence/` 中的证据文件是否存在。
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  运行 `bun run tsc --noEmit` + `bun test`。审查所有改动文件：`as any`/`@ts-ignore`、空 catch、生产代码中的 console.log、被注释的代码、未使用的 import。检查 AI slop：过多注释、过度抽象、通用命名（data/result/item/temp）。
  Output: `Build [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high`
  从干净状态开始。执行每个 Task 的全部 QA Scenarios（含 happy path + error scenarios）。测试跨 Task 集成（tools add → ask 触发 FC 循环）。保存证据到 `.sisyphus/evidence/final-qa/`。
  Output: `Scenarios [N/N pass] | Integration [N/N] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  对每个 Task：读取 "What to do"，读取实际 git diff。验证 1:1 对应（规格中的功能全部实现，没有规格外的代码）。检查 "Must NOT do" 合规。检查跨 Task 污染（Task N 的文件被 Task M 修改）。标记未说明的改动。
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

| Commit | Message | Files |
|--------|---------|-------|
| 1 | `feat(types): add Tool types and extend LLM types for function calling` | `src/types/tool.ts`, `src/config/paths.ts`, `src/types/llm.ts` |
| 2 | `feat(tools): add tool store with CRUD operations` | `src/tools/store.ts`, `src/tools/store.test.ts` |
| 3 | `feat(tools): add shell command executor with placeholder substitution` | `src/tools/executor.ts`, `src/tools/executor.test.ts` |
| 4 | `feat(llm): add chatWithTools non-streaming function` | `src/llm/client.ts`, `src/llm/client.test.ts` |
| 5 | `feat(commands): add tools command group (add/list/enable/disable/delete)` | `src/commands/tools.ts`, `src/commands/tools.test.ts` |
| 6 | `feat(ask): integrate function calling loop` | `src/commands/ask.ts`, `src/commands/ask.test.ts` |
| 7 | `feat(main): register tools command` | `src/main.ts` |

Pre-commit check: `bun run tsc --noEmit && bun test`

---

## Success Criteria

### Verification Commands
```bash
# TypeScript 编译无错误
bun run tsc --noEmit  # Expected: 无输出，exit code 0

# 全量测试通过
bun test              # Expected: 所有 pass, 0 fail

# tools 命令可用
my-cli tools list     # Expected: "暂无工具" 或工具列表

# ask 命令向前兼容
my-cli ask "What is 2+2?"  # Expected: 数学答案（不崩溃）
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] `bun test` 全部通过
- [ ] `bun run tsc --noEmit` 无错误
- [ ] `hello` / `weather` 命令正常
- [ ] `ask` 无工具时走原有 streamChat 路径
