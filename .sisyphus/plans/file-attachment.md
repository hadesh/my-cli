# ask 命令文件附件支持

## TL;DR

> **Quick Summary**: 为 `my-cli ask` 命令增加 `--file` 参数，支持文本文件（内容拼接到 user message）和图片文件（base64 或 URL 传给 LLM），不持久化到 session。
>
> **Deliverables**:
> - `src/types/llm.ts` — 新增 `ContentPart` 联合类型，`ChatMessage.content` 扩展为 `string | ContentPart[]`
> - `src/args.ts` — 支持同名 flag 多次使用（聚合为数组）
> - `src/utils/file.ts` — 新文件：文件读取、MIME 检测、路径校验工具函数
> - `src/commands/ask.ts` — 解析 `--file`，构造多模态消息
>
> **Estimated Effort**: Medium
> **Parallel Execution**: YES - 2 waves
> **Critical Path**: Task 1 (类型) → Task 2 (args) → Task 3 (file utils) → Task 4 (ask 集成) → F1-F3

---

## Context

### Original Request
对话中支持文件附件（文本文件、图片文件）。通过 `--file` 参数传入，询问大模型附件相关信息或将附件内容作为上下文。

### Interview Summary
**Key Discussions**:
- 附件传入方式：`--file` 参数，支持多个叠加
- 文本文件：注入为 user message 文本（格式 `[文件: name]\n<内容>\n\n用户问题`）
- 图片文件：本地文件转 base64，http/https URL 直接传入
- 持久化：仅本次对话有效，不存入 session history

**Research Findings**:
- `ChatMessage.content` 当前为 `string` 类型，需扩展为联合类型
- `args.ts` 当前 `--flag value` 遇到同名 flag 会覆盖，不会聚合数组，**必须修改**
- `streamChat` / `chatWithTools` 直接 `JSON.stringify(messages)`，LLM 客户端层无需改动
- 通义千问（bailian）兼容 OpenAI multimodal 格式（`image_url` with base64 data URL）

### Metis Review
**Identified Gaps** (addressed):
- `args.ts` 多次同名 flag 当前覆盖而非聚合 → Task 2 专门处理
  - 文件大小限制（10MB 上限）→ Task 3 实现；路径穿越/绝对路径校验本期不做（简化范围）
- 空文件、不存在文件、权限错误等边界情况 → Task 3 + Task 4 处理
- 图片 URL vs 本地路径区分逻辑 → Task 3 中实现

---

## Work Objectives

### Core Objective
在 `ask` 命令中支持通过 `--file` 传入文本和图片附件，附件内容随本次请求发送给 LLM，不影响 session 历史存储。

### Concrete Deliverables
- `my-cli ask "图片里有什么" --file ./photo.jpg` 正常工作
- `my-cli ask "总结文档" --file ./README.md` 正常工作
- `my-cli ask "对比两个文件" --file ./a.txt --file ./b.txt` 支持多附件
- 文件不存在、类型不支持时输出清晰错误信息

### Definition of Done
- [ ] `bun run src/main.ts ask "测试" --file ./test.txt` 运行无报错，LLM 收到文件内容
- [ ] `bun run src/main.ts ask "测试" --file ./test.jpg` 运行无报错，LLM 收到 base64 图片
- [ ] `bun run src/main.ts ask "测试" --file ./not-exist.txt` 输出文件不存在错误

### Must Have
- `--file` 支持多次叠加（多文件）
- 文本文件：内容拼接到 user message
- 图片文件（.jpg/.jpeg/.png/.gif/.webp）：本地文件 → base64 data URL
- http/https URL：直接作为 image_url 传入
- 不存在/不可读文件：清晰错误信息 + 退出码 1
- 文件大小上限：单文件 10MB

### Must NOT Have (Guardrails)
- 不支持 PDF、音频、视频文件（不在范围内）
- 不将附件内容持久化到 session JSON 文件
- 不修改 `src/llm/client.ts`（LLM 客户端层无需改动）
- 不添加路径白名单/黑名单（过于复杂，下个版本再议）
- 不支持 glob 模式（如 `--file *.jpg`）
- 不支持文件内容缓存

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed.

### Test Decision
- **Infrastructure exists**: YES（项目有 bun 测试环境）
- **Automated tests**: Tests-after（先实现，后在各 task 中添加测试）
- **Framework**: bun test

### QA Policy
每个 Task 包含 Agent-Executed QA Scenarios，证据存入 `.sisyphus/evidence/`。

- **CLI**: 使用 `Bash (bun run)` — 运行命令、断言输出、检查退出码
- **Unit**: 使用 `Bash (bun test)` — 运行测试文件、断言通过

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (立即并行启动 - 基础层):
├── Task 1: 扩展 ChatMessage 类型定义 [quick]
└── Task 2: 修改 args.ts 支持数组 flag [quick]

Wave 2 (Wave 1 完成后 - 核心实现):
├── Task 3: 新建 src/utils/file.ts 文件工具 [unspecified-high]  (depends: 1)
└── Task 4: 集成到 ask.ts 命令 [unspecified-high]  (depends: 1, 2, 3)

Wave FINAL (所有 Task 完成后 - 并行验收):
├── F1: 代码质量检查 + bun test [unspecified-high]
├── F2: E2E 场景验证 [unspecified-high]
└── F3: 范围合规审计 [oracle]
-> 汇总结果 -> 等待用户确认
```

### Dependency Matrix

| Task | 依赖 | 被依赖 |
|------|------|--------|
| 1 (类型定义) | 无 | 3, 4 |
| 2 (args 数组) | 无 | 4 |
| 3 (file utils) | 1 | 4 |
| 4 (ask 集成) | 1, 2, 3 | F1, F2, F3 |

### Agent Dispatch Summary

- **Wave 1**: 2 tasks — T1 → `quick`, T2 → `quick`
- **Wave 2**: 2 tasks — T3 → `unspecified-high`, T4 → `unspecified-high`
- **FINAL**: 3 tasks — F1 → `unspecified-high`, F2 → `unspecified-high`, F3 → `oracle`

---

## TODOs

- [x] 1. 扩展 ChatMessage 类型支持多模态 content

  **What to do**:
  - 在 `src/types/llm.ts` 新增 `TextContentPart` 和 `ImageContentPart` 接口
  - 新增 `ContentPart` 联合类型 = `TextContentPart | ImageContentPart`
  - 将 `ChatMessage.content` 类型改为 `string | ContentPart[]`
  - 同步更新 `ChatResponse.choices[].message.content` 类型（已是 `string | null`，不变）
  - 格式参考 OpenAI multimodal spec：
    ```typescript
    export interface TextContentPart { type: 'text'; text: string }
    export interface ImageContentPart {
      type: 'image_url'
      image_url: { url: string; detail?: 'auto' | 'low' | 'high' }
    }
    export type ContentPart = TextContentPart | ImageContentPart
    ```

  **Must NOT do**:
  - 不修改 `LLMConfig`、`ToolCall`、`ToolDefinition` 等其他类型
  - 不在此处添加运行时处理逻辑，仅类型定义

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1（与 Task 2 并行）
  - **Blocks**: Task 3, Task 4
  - **Blocked By**: 无

  **References**:
  - `src/types/llm.ts:1-99` — 完整现有类型文件，新增类型要放在 `ChatMessage` 接口之前
  - OpenAI multimodal format: `https://platform.openai.com/docs/guides/vision`

  **Acceptance Criteria**:
  - [ ] `src/types/llm.ts` 中新增 `TextContentPart`、`ImageContentPart`、`ContentPart` 三个导出类型
  - [ ] `ChatMessage.content` 类型为 `string | ContentPart[]`
  - [ ] `bun build src/main.ts --target bun 2>&1` 无类型错误

  ```
  Scenario: 类型定义可用
    Tool: Bash (bun)
    Steps:
      1. bun run --eval "import type { ContentPart, ChatMessage } from './src/types/llm.js'; const m: ChatMessage = { role: 'user', content: [{ type: 'text', text: 'hi' }] }; console.log('ok')"
    Expected Result: 输出 "ok"，无 TypeScript 编译报错
    Evidence: .sisyphus/evidence/task-1-type-check.txt
  ```

  **Commit**: YES（与 Task 2 合并）

---

- [x] 2. 修改 args.ts 支持数组 flag 聚合

  **What to do**:
  - 在 `parseArgs` 函数中，增加"数组 flag 名称白名单"常量 `ARRAY_FLAGS = ['file']`
  - 修改 `--key value` 分支：若 `camel(key)` 在 `ARRAY_FLAGS` 中，则聚合为数组（push），否则直接赋值（原有行为）
  - 同理处理 `--key=value` 分支
  - `ParsedArgs.flags` 类型不需要改（`Record<string, unknown>` 兼容数组值）

  **修改逻辑示例**（第 22-31 行）：
  ```typescript
  const ARRAY_FLAGS = new Set(['file']);

  // --key=value 分支
  const k = camel(key.slice(0, eqIdx));
  const v = key.slice(eqIdx + 1);
  if (ARRAY_FLAGS.has(k)) {
    const existing = flags[k];
    flags[k] = Array.isArray(existing) ? [...existing, v] : [v];
  } else {
    flags[k] = v;
  }

  // --key value 分支（next 不以 - 开头时）
  if (ARRAY_FLAGS.has(camel(key))) {
    const existing = flags[camel(key)];
    flags[camel(key)] = Array.isArray(existing) ? [...existing, next] : [next];
    i++;
  } else {
    flags[camel(key)] = next;
    i++;
  }
  ```

  **Must NOT do**:
  - 不破坏现有 flag 解析行为（非 ARRAY_FLAGS 的 flag 保持原有覆盖语义）
  - 不修改 `camel()` 函数
  - 不改变 `ParsedArgs` 接口定义

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1（与 Task 1 并行）
  - **Blocks**: Task 4
  - **Blocked By**: 无

  **References**:
  - `src/args.ts:1-48` — 完整现有 args 文件，修改第 22-31 行逻辑

  **Acceptance Criteria**:
  - [ ] `--file a.txt --file b.txt` 解析后 `flags.file` 为 `['a.txt', 'b.txt']`
  - [ ] `--file a.txt` 解析后 `flags.file` 为 `['a.txt']`（单个也是数组）
  - [ ] `--provider deepseek` 等非 ARRAY_FLAGS 的 flag 行为不变，仍为字符串值

  ```
  Scenario: 多个 --file 聚合为数组
    Tool: Bash (bun)
    Steps:
      1. bun run --eval "import { parseArgs } from './src/args.js'; const r = parseArgs(['ask', 'hi', '--file', 'a.txt', '--file', 'b.txt']); console.log(JSON.stringify(r.flags.file))"
    Expected Result: 输出 ["a.txt","b.txt"]
    Evidence: .sisyphus/evidence/task-2-array-flag.txt

  Scenario: 单个 --file 也是数组
    Tool: Bash (bun)
    Steps:
      1. bun run --eval "import { parseArgs } from './src/args.js'; const r = parseArgs(['ask', 'hi', '--file', 'a.txt']); console.log(JSON.stringify(r.flags.file))"
    Expected Result: 输出 ["a.txt"]
    Evidence: .sisyphus/evidence/task-2-single-flag.txt
  ```

  **Commit**: YES（与 Task 1 合并：`feat(types,args): add ContentPart type and array flag support`）

---

- [x] 3. 新建 src/utils/file.ts — 文件附件工具函数

  **What to do**:
  新建 `src/utils/file.ts`，实现以下函数：

  **a. `isImageFile(filePath: string): boolean`**
  - 根据扩展名判断：`.jpg`, `.jpeg`, `.png`, `.gif`, `.webp` → true，其余 → false
  - 若传入的是 http/https URL，检查路径末尾扩展名

  **b. `isRemoteUrl(filePath: string): boolean`**
  - 以 `http://` 或 `https://` 开头 → true

  **c. `getMimeType(ext: string): string`**
  - `.jpg`/`.jpeg` → `image/jpeg`
  - `.png` → `image/png`
  - `.gif` → `image/gif`
  - `.webp` → `image/webp`
  - 其他 → `application/octet-stream`

  **d. `readFileAsBase64DataUrl(filePath: string): Promise<string>`**
  - 读取本地文件为 `ArrayBuffer`，转 base64
  - 返回格式：`data:image/jpeg;base64,<base64string>`
  - 文件大小超过 10MB（10 * 1024 * 1024 bytes）时抛出错误：`文件过大（最大 10MB）: <path>`
  - 文件不存在时抛出 `UsageError`：`文件不存在: <path>`

  **e. `readFileAsText(filePath: string): Promise<string>`**
  - 读取本地文本文件为 string
  - 文件不存在时抛出 `UsageError`：`文件不存在: <path>`
  - 文件大小超过 10MB 时抛出错误：`文件过大（最大 10MB）: <path>`

  **f. `buildAttachmentContentParts(filePaths: string[], userMessage: string): Promise<ContentPart[]>`**
  - 核心函数：接收 `--file` 路径列表 + 用户原始消息
  - 遍历每个 filePath：
    - 若是远程 URL 且路径符合图片扩展名 → `{ type: 'image_url', image_url: { url } }`
    - 若是本地图片文件 → 读 base64 → `{ type: 'image_url', image_url: { url: 'data:...' } }`
    - 若是本地文本文件 → 读内容 → 作为 `{ type: 'text', text: '[文件: name]\n<内容>' }`
    - 不支持的类型（如 .pdf）→ 抛出 `UsageError`：`不支持的文件类型: <ext>`
  - 最后追加 `{ type: 'text', text: userMessage }`
  - 返回完整 `ContentPart[]`

  **Must NOT do**:
  - 不添加路径穿越/绝对路径安全检验（本期不实现，Metis 建议但已决策推迟）
  - 不处理 URL 图片的下载（URL 直接传给 LLM）
  - 不添加文件缓存逻辑

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES（可与 Task 4 准备工作并行，但 Task 4 执行依赖本 Task）
  - **Parallel Group**: Wave 2（Task 3 完成后 Task 4 才能完成）
  - **Blocks**: Task 4
  - **Blocked By**: Task 1

  **References**:
  - `src/types/llm.ts` — 引用 `ContentPart`、`TextContentPart`、`ImageContentPart` 类型（Task 1 完成后）
  - `src/errors/base.ts` — `UsageError` 类，用于文件错误
  - `src/utils/tokenizer.ts` — 参考单例工具函数写法风格
  - Bun file API: `Bun.file(path).arrayBuffer()`, `Bun.file(path).text()`, `Bun.file(path).size`

  **Acceptance Criteria**:
  - [ ] `src/utils/file.ts` 文件存在并导出上述 6 个函数
  - [ ] 单图片 `buildAttachmentContentParts(['./test.jpg'], '问题')` 返回 `[{type:'image_url',...}, {type:'text',text:'问题'}]`
  - [ ] 单文本 `buildAttachmentContentParts(['./README.md'], '总结')` 返回 `[{type:'text',text:'[文件: README.md]\n...'}, {type:'text',text:'总结'}]`
  - [ ] 不存在文件抛出含"文件不存在"的错误

  ```
  Scenario: 文本文件读取 ContentParts
    Tool: Bash (bun)
    Preconditions: echo "hello world" > /tmp/test-attach.txt
    Steps:
      1. bun run --eval "import { buildAttachmentContentParts } from './src/utils/file.js'; const parts = await buildAttachmentContentParts(['/tmp/test-attach.txt'], '总结'); console.log(JSON.stringify(parts))"
    Expected Result: JSON 包含 type:text 且 text 含 "[文件: test-attach.txt]" 和 "hello world"
    Evidence: .sisyphus/evidence/task-3-text-parts.txt

  Scenario: 不存在文件抛错
    Tool: Bash (bun)
    Steps:
      1. bun run --eval "import { buildAttachmentContentParts } from './src/utils/file.js'; try { await buildAttachmentContentParts(['/tmp/not-exist-xyz.txt'], 'q'); } catch(e) { console.log(e.message) }"
    Expected Result: 输出包含 "文件不存在"
    Evidence: .sisyphus/evidence/task-3-file-not-found.txt
  ```

  **Commit**: YES（单独提交：`feat(utils): add file attachment utilities`）

---

- [x] 4. 在 ask.ts 集成 --file 附件支持

  **What to do**:

  1. **解析 `--file` flag**（在 `execute` 函数顶部，第 66-74 行附近）：
     ```typescript
     const filePaths = flags['file'] as string[] | undefined;
     ```

  2. **构造 user message content**（替换第 122 行 `messages.push({ role: 'user', content: message })`）：
     ```typescript
     if (filePaths && filePaths.length > 0) {
       const { buildAttachmentContentParts } = await import('../utils/file.js');
       const contentParts = await buildAttachmentContentParts(filePaths, message);
       messages.push({ role: 'user', content: contentParts });
     } else {
       messages.push({ role: 'user', content: message });
     }
     ```

  3. **保存 session 时仅用原始文本**（第 298 行）：
     ```typescript
     // 保持不变：session.messages.push({ role: 'user', content: message, timestamp: now })
     // message 是原始字符串，附件内容不写入 session（已符合需求）
     ```

  4. **context 统计兼容**（第 162 行）：
     ```typescript
     // 当前：messages.map(m => m.content ?? '')
     // 需要处理 content 为 ContentPart[] 的情况：
     const contentToText = (c: string | ContentPart[]): string => {
       if (typeof c === 'string') return c;
       return c.filter(p => p.type === 'text').map(p => (p as TextContentPart).text).join('');
     };
     const preStats = await calcContextStats(messages.map(m => contentToText(m.content)), config);
     ```

  5. **更新 usage/description/examples**（第 57-64 行）：
     ```typescript
     usage: 'my-cli ask <消息> [--file <路径>] [--session <id>] [--provider <name>] [--verbose]',
     examples: [
       'my-cli ask 什么是 TypeScript?',
       'my-cli ask "图片里有什么" --file ./photo.jpg',
       'my-cli ask "总结文档" --file ./README.md --file ./CHANGELOG.md',
     ],
     ```

  **Must NOT do**:
  - 不将 `ContentPart[]` 写入 session（session 里 `content` 字段仍为原始字符串 `message`）
  - 不修改 `src/llm/client.ts`
  - 不改变无附件时的行为（回退到原有字符串逻辑）

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2（必须在 Task 1、2、3 完成后执行）
  - **Blocks**: F1, F2, F3
  - **Blocked By**: Task 1, Task 2, Task 3

  **References**:
  - `src/commands/ask.ts:65-122` — 参数解析和消息构造区域（重点修改位置）
  - `src/commands/ask.ts:162` — context 统计处（需处理 ContentPart[]）
  - `src/commands/ask.ts:297-302` — session 存储区域（确认 message 原始字符串不含附件）
  - `src/utils/file.ts` — Task 3 新建的工具函数（动态 import）
  - `src/types/llm.ts` — `ContentPart`、`TextContentPart` 类型（Task 1 新增）

  **Acceptance Criteria**:
  - [ ] `bun run src/main.ts ask "测试" --file ./README.md` 运行无报错，终端输出 LLM 回复
  - [ ] session JSON 文件中 user message 的 `content` 字段为原始字符串，不含附件内容
  - [ ] `bun run src/main.ts ask "测试" --file ./nonexistent.txt` 输出"文件不存在"错误并退出码 1
  - [ ] `bun run src/main.ts ask "测试"` 无 `--file` 时行为与修改前完全一致

  ```
  Scenario: 文本附件消息构造单元验证
    Tool: Bash (bun)
    Preconditions: echo "这是测试内容 hello world" > /tmp/e2e-test.txt
    Steps:
      1. bun run --eval "
           import { buildAttachmentContentParts } from './src/utils/file.js';
           const parts = await buildAttachmentContentParts(['/tmp/e2e-test.txt'], '总结这个文件');
           const textParts = parts.filter(p => p.type === 'text');
           const hasFileLabel = textParts.some(p => p.text.includes('[文件: e2e-test.txt]'));
           const hasContent = textParts.some(p => p.text.includes('这是测试内容'));
           const hasQuestion = parts[parts.length - 1].text === '总结这个文件';
           console.log(JSON.stringify({ hasFileLabel, hasContent, hasQuestion }));
         "
    Expected Result: 输出 {"hasFileLabel":true,"hasContent":true,"hasQuestion":true}
    Evidence: .sisyphus/evidence/task-4-e2e-text.txt

  Scenario: 不存在文件错误处理
    Tool: Bash (bun)
    Steps:
      1. bun run src/main.ts ask "测试" --file /tmp/xyz-not-exist-abc.txt 2>&1; echo "EXIT:$?"
    Expected Result: 输出包含"文件不存在"，且最后一行为 EXIT:1
    Evidence: .sisyphus/evidence/task-4-file-error.txt

  Scenario: 无附件时行为不变（类型兼容性验证）
    Tool: Bash (bun)
    Steps:
      1. bun run --eval "
           import { parseArgs } from './src/args.js';
           const r = parseArgs(['ask', '你好']);
           console.log('file flag:', r.flags.file);
           console.log('command:', r.command[0]);
         "
    Expected Result: 输出 file flag: undefined, command: ask（确认无 --file 时 flags.file 为 undefined，不影响现有流程）
    Evidence: .sisyphus/evidence/task-4-no-attachment.txt
  ```

  **Commit**: YES（单独提交：`feat(ask): integrate --file attachment support`）

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 3 个审查 Agent 并行运行，全部通过后汇总给用户确认。
>
> **Do NOT auto-proceed after verification. Wait for user's explicit approval before completing.**

- [ ] F1. **代码质量检查** — `unspecified-high`

  运行以下命令并收集结果：

  ```
  步骤:
  1. bun build src/main.ts --target bun 2>&1; echo "BUILD:$?"
     Expected: 无 TypeScript 类型错误，BUILD:0
     Evidence: .sisyphus/evidence/final-qa/f1-build.txt

  2. bun test 2>&1; echo "TEST:$?"
     Expected: 所有测试通过，TEST:0（若无测试文件则 0 tests passed 也接受）
     Evidence: .sisyphus/evidence/final-qa/f1-test.txt

  3. grep -r "as any\|@ts-ignore\|console\.log" src/utils/file.ts src/args.ts 2>&1
     Expected: 无输出（无这些 pattern）
     Evidence: .sisyphus/evidence/final-qa/f1-lint.txt
  ```

  输出格式：`Build [PASS/FAIL] | Tests [N pass/N fail] | Lint [CLEAN/ISSUES] | VERDICT: APPROVE/REJECT`

- [ ] F2. **E2E 场景验证** — `unspecified-high`

  按顺序执行以下所有场景，保存证据到 `.sisyphus/evidence/final-qa/`：

  ```
  场景 1: 文本文件 ContentPart 构造
    bun run --eval "
      import { buildAttachmentContentParts } from './src/utils/file.js';
      import { writeFileSync } from 'node:fs';
      writeFileSync('/tmp/f2-test.txt', '测试内容 abc123');
      const parts = await buildAttachmentContentParts(['/tmp/f2-test.txt'], '总结');
      const ok = parts.some(p => p.type === 'text' && p.text.includes('[文件: f2-test.txt]'))
               && parts[parts.length-1].text === '总结';
      console.log('场景1:', ok ? 'PASS' : 'FAIL');
    "
    Evidence: .sisyphus/evidence/final-qa/f2-text-parts.txt

  场景 2: 不存在文件抛出 UsageError
    bun run --eval "
      import { readFileAsText } from './src/utils/file.js';
      try {
        await readFileAsText('/tmp/f2-not-exist-xyz.txt');
        console.log('场景2: FAIL (未抛错)');
      } catch(e) {
        const ok = e.message.includes('文件不存在');
        console.log('场景2:', ok ? 'PASS' : 'FAIL - message: ' + e.message);
      }
    "
    Evidence: .sisyphus/evidence/final-qa/f2-file-not-found.txt

  场景 3: --file flag 聚合为数组
    bun run --eval "
      import { parseArgs } from './src/args.js';
      const r = parseArgs(['ask', 'hi', '--file', 'a.txt', '--file', 'b.txt']);
      const ok = Array.isArray(r.flags.file) && r.flags.file.length === 2;
      console.log('场景3:', ok ? 'PASS' : 'FAIL - ' + JSON.stringify(r.flags.file));
    "
    Evidence: .sisyphus/evidence/final-qa/f2-array-flag.txt

  场景 4: 单个 --file 也返回数组
    bun run --eval "
      import { parseArgs } from './src/args.js';
      const r = parseArgs(['ask', 'hi', '--file', 'a.txt']);
      const ok = Array.isArray(r.flags.file) && r.flags.file[0] === 'a.txt';
      console.log('场景4:', ok ? 'PASS' : 'FAIL - ' + JSON.stringify(r.flags.file));
    "
    Evidence: .sisyphus/evidence/final-qa/f2-single-array.txt

  场景 5: 不支持的文件类型抛错
    bun run --eval "
      import { buildAttachmentContentParts } from './src/utils/file.js';
      try {
        await buildAttachmentContentParts(['/tmp/test.pdf'], 'q');
        console.log('场景5: FAIL (未抛错)');
      } catch(e) {
        const ok = e.message.includes('不支持的文件类型');
        console.log('场景5:', ok ? 'PASS' : 'FAIL - ' + e.message);
      }
    "
    Evidence: .sisyphus/evidence/final-qa/f2-unsupported-type.txt
  ```

  输出格式：`场景 [N/N PASS] | VERDICT: APPROVE/REJECT`

- [ ] F3. **范围合规审计** — `oracle`

  执行以下检查：

  ```
  检查 1: session 不存储附件内容
    grep -n "ContentPart\|contentParts\|buildAttachment" src/commands/ask.ts
    Expected: 只在消息构造处使用（第 120 行附近），session.messages.push 处（约第 298 行）
              不应出现 contentParts 或 ContentPart[]
    Evidence: .sisyphus/evidence/final-qa/f3-session-check.txt

  检查 2: LLM 客户端层未修改
    git diff src/llm/client.ts
    Expected: 无输出（client.ts 无任何修改）
    Evidence: .sisyphus/evidence/final-qa/f3-client-unchanged.txt

  检查 3: 无 PDF/音频/视频支持代码
    grep -rn "\.pdf\|\.mp3\|\.mp4\|\.wav\|pdf-parse\|ffmpeg" src/utils/file.ts
    Expected: 无输出（这些类型未被支持）
    Evidence: .sisyphus/evidence/final-qa/f3-no-pdf-audio.txt

  检查 4: Must NOT Have 全部通过后输出 APPROVE，任一失败输出 REJECT 并说明原因
  ```

  输出格式：`Session [CLEAN/VIOLATION] | Client [UNCHANGED/MODIFIED] | Scope [CLEAN/VIOLATION] | VERDICT: APPROVE/REJECT`

---

## Commit Strategy

- Task 1+2 合并提交: `feat(types,args): add ContentPart type and array flag support`
- Task 3 单独提交: `feat(utils): add file attachment utilities`
- Task 4 单独提交: `feat(ask): integrate --file attachment support`

---

## Success Criteria

### Verification Commands
```bash
# 文本附件
bun run src/main.ts ask "总结这个文件" --file ./README.md
# Expected: LLM 回复包含对 README.md 内容的总结

# 图片附件
bun run src/main.ts ask "图片里有什么" --file ./test.jpg
# Expected: LLM 回复包含图片内容描述

# 多附件
bun run src/main.ts ask "对比两个文件" --file ./a.txt --file ./b.txt
# Expected: LLM 回复基于两个文件内容

# 错误处理
bun run src/main.ts ask "测试" --file ./nonexistent.txt
# Expected: 错误信息 "文件不存在: ./nonexistent.txt"，退出码 1
```

### Final Checklist
- [ ] 所有 Must Have 项已实现
- [ ] 所有 Must NOT Have 项未出现
- [ ] `bun test` 通过
- [ ] 文件附件不写入 session JSON
