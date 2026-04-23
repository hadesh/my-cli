# 工具系统重构：内置工具直调 + MCP 外部工具接入

## TL;DR

> **Quick Summary**: 重构 my-cli 工具系统，将内置工具从脚本执行改为代码直接调用，外部工具通过 MCP 协议（mcporter 库）接入，并新增独立 `mcp` 命令管理 MCP server。
>
> **Deliverables**:
> - 内置工具（weather 等）改为纯 TypeScript 模块直接 import 执行
> - 新建 `src/mcp/` 模块封装 mcporter runtime（lazy singleton + 生命周期管理）
> - 新增 `mcp add/list/remove/enable/disable` 命令
> - `tools add/delete` 命令删除，保留 `list/enable/disable`
> - MCP 配置存入 `~/.config/my-cli/mcp-servers.json`
> - 内置工具开关状态迁移到 `config.json` 的 `builtinTools` 字段
> - 删除 `tools.json`、`src/tools/executor.ts`、内置工具脚本入口代码
> - 工具命名采用 namespacing：MCP 工具格式 `servername__toolname`
>
> **Estimated Effort**: Large
> **Parallel Execution**: YES - 3 waves
> **Critical Path**: Task 1 (类型定义) → Task 3 (MCP client) → Task 6 (ask 适配) → Task 9 (集成测试)

---

## Context

### Original Request
"重构工具系统，只保留内部工具使用代码实现，运行时引入直接调用。外部工具通过 mcp 的形式接入，设计一个 mcp 管理模块使用 mcporter 来实现 mcp 的能力调用，参考 https://github.com/steipete/mcporter"

### Interview Summary
**Key Discussions**:
- **命令体系**：新增独立 `mcp` 命令（不合并到 tools 下）
- **MCP 配置存储**：`~/.config/my-cli/mcp-servers.json`（独立文件）
- **tools.json 处理**：删除文件，enable/disable 状态合并到 `config.json`

**Research Findings**:
- **mcporter API**：`createRuntime()` → `runtime.listTools()` / `runtime.callTool()` / `runtime.close()`
- **配置格式**：`{ "mcpServers": { "name": { "command": "...", "args": [...] } } }`
- **结果提取**：`createCallResult(result).text()` + JSON fallback

### Metis Review
**Identified Gaps** (addressed):
- MCP runtime 生命周期：采用 lazy singleton + finally block
- 工具命名冲突：`servername__toolname` namespacing
- 统一工具 schema：内置工具手写 JSON Schema，MCP 工具从 `inputSchema` 取
- MCP 失败降级：server 离线时跳过，不崩溃，打印 warn
- tools.json 迁移：若存在，在 config 加载时打印迁移提示（不自动迁移）

---

## Work Objectives

### Core Objective
完整替换工具系统底层实现：内置工具直调，外部工具 MCP 化，提供统一工具注册接口供 ask 命令使用。

### Concrete Deliverables
- `src/mcp/types.ts` - MCP server 配置类型
- `src/mcp/config.ts` - mcp-servers.json 读写
- `src/mcp/client.ts` - mcporter runtime 封装（lazy singleton）
- `src/commands/mcp.ts` - mcp 命令（add/list/remove/enable/disable）
- `src/tools/builtin/weather.ts` - 去掉脚本入口，保留 ToolExecutor 实现
- `src/tools/store.ts` - 重构：内置工具直调 + MCP 工具统一聚合
- `src/types/tool.ts` - 新增 MCPTool 类型，BuiltinTool 类型分离
- `src/config/schema.ts` - 增加 `builtinTools: Record<string, boolean>`
- `src/config/paths.ts` - 增加 `MCP_SERVERS_FILE` 常量
- `src/commands/tools.ts` - 删除 add/delete，保留 list/enable/disable
- `src/commands/ask.ts` - 适配新工具调用接口
- `src/main.ts` - 注册 mcp 命令
- 删除 `src/tools/executor.ts`

### Definition of Done
- [ ] `bun run src/main.ts ask "获取北京天气"` 正常触发内置 weather 工具并返回结果
- [ ] `bun run src/main.ts mcp add` 可以交互式添加 MCP server 配置到 mcp-servers.json
- [ ] `bun run src/main.ts mcp list` 列出所有已配置的 MCP server
- [ ] `bun run src/main.ts tools list` 正确显示内置工具列表及开关状态
- [ ] `bun run src/main.ts tools enable weather` / `disable weather` 正确更新 config.json
- [ ] `bun check src/` 无 TypeScript 错误

### Must Have
- 内置工具通过 import 直接调用（不经过 Bun.spawn）
- MCP 工具命名格式：`servername__toolname`
- MCP runtime lazy singleton，进程退出前 `runtime.close()`
- MCP server 离线时优雅降级（跳过该 server，打印 warn）
- `config.json` 增加 `builtinTools` 字段控制内置工具开关

### Must NOT Have (Guardrails)
- 不保留 `tools add/delete` 命令（脚本工具系统完全废弃）
- 不保留 `src/tools/executor.ts`（删除）
- 不保留内置工具文件末尾的 `process.argv[2]` 脚本入口
- 不在 MCP 调用失败时抛出异常导致整个 ask 命令崩溃
- 不保留 `tools.json`（删除，状态迁移到 config.json）
- 不自动迁移旧 tools.json 数据（仅打印提示）
- 不在工具 schema 转换时丢失 `required` 字段信息

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** - ALL verification is agent-executed.

### Test Decision
- **Infrastructure exists**: NO（无测试框架）
- **Automated tests**: None
- **Agent-Executed QA**: ALWAYS（每个任务有具体 QA 场景）

### QA Policy
- **CLI 命令验证**：Bash (bun run) - 运行命令，检查 stdout/stderr 输出
- **TypeScript 编译**：Bash (bun check) - 零错误
- **文件存在性**：Bash (ls/cat) - 验证文件被创建/删除

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (可立即并行执行 - 基础类型和配置层):
├── Task 1: 类型定义重构 (src/types/tool.ts + src/mcp/types.ts) [quick]
├── Task 2: 配置层更新 (src/config/schema.ts + paths.ts) [quick]
└── Task 3: MCP config 模块 (src/mcp/config.ts) [quick]

Wave 2 (Wave 1 完成后 - 核心模块实现):
├── Task 4: MCP client 封装 (src/mcp/client.ts) [unspecified-high]
├── Task 5: 内置工具重构 (src/tools/builtin/weather.ts + store.ts 内置部分) [quick]
└── Task 6: tools 命令精简 (src/commands/tools.ts) [quick]

Wave 3 (Wave 2 完成后 - 整合和命令层):
├── Task 7: tools/store.ts 全量重构 (聚合内置+MCP工具) [unspecified-high]
├── Task 8: mcp 命令实现 (src/commands/mcp.ts) [unspecified-high]
└── Task 9: ask 命令适配 + main.ts 注册 + 删除废弃文件 [deep]

Wave FINAL (所有任务完成后):
├── Task F1: 计划合规审计 (oracle)
├── Task F2: TypeScript 编译 + 代码质量审查 (unspecified-high)
├── Task F3: 端到端 QA (unspecified-high)
└── Task F4: 范围保真度检查 (deep)
-> 展示结果 -> 等待用户确认

Critical Path: Task 1 → Task 4 → Task 7 → Task 9 → F1-F4 → user okay
Parallel Speedup: ~60% faster than sequential
Max Concurrent: 3 (Wave 1 & Wave 3)
```

### Dependency Matrix

| Task | 依赖 | 被依赖 |
|------|------|--------|
| 1 | - | 3, 4, 5, 7 |
| 2 | - | 3, 6, 7 |
| 3 | 1, 2 | 4, 8 |
| 4 | 1, 3 | 7, 9 |
| 5 | 1 | 7 |
| 6 | 2 | 9 |
| 7 | 1, 2, 4, 5 | 9 |
| 8 | 3, 4 | 9 |
| 9 | 4, 6, 7, 8 | FINAL |

### Agent Dispatch Summary

- **Wave 1**: 3 tasks → T1 `quick`, T2 `quick`, T3 `quick`
- **Wave 2**: 3 tasks → T4 `unspecified-high`, T5 `quick`, T6 `quick`
- **Wave 3**: 3 tasks → T7 `unspecified-high`, T8 `unspecified-high`, T9 `deep`
- **FINAL**: 4 tasks → F1 `oracle`, F2 `unspecified-high`, F3 `unspecified-high`, F4 `deep`

---

## TODOs

- [x] 1. 类型定义重构：`src/types/tool.ts` + `src/mcp/types.ts`

  **What to do**:
  - 重构 `src/types/tool.ts`：
    - 删除 `scriptPath` 字段（不再支持脚本工具）
    - 添加 `builtin: true` 标记区分内置工具
    - 新增 `BuiltinToolDef` 类型（含 name/description/enabled/parameters）
    - 保留 `ToolParameters` 类型（JSON Schema 格式，供 LLM function calling 使用）
    - 新增统一的 `UnifiedTool` 类型（name/description/parameters/source: 'builtin'|'mcp'）
  - 新建 `src/mcp/` 目录
  - 新建 `src/mcp/types.ts`：
    ```typescript
    export interface MCPServerConfig {
      command: string;
      args?: string[];
      env?: Record<string, string>;
      enabled: boolean;
    }
    export interface MCPServersConfig {
      mcpServers: Record<string, MCPServerConfig>;
    }
    export interface MCPToolInfo {
      serverName: string;
      toolName: string;           // 原始名称
      fullName: string;           // "servername__toolname" 格式
      description: string;
      inputSchema: object;        // JSON Schema
    }
    ```

  **Must NOT do**:
  - 不删除 `ToolParameters` 类型（其他地方仍使用）
  - 不修改 `src/types/llm.ts`（ChatMessage 等类型保持不变）

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1（与 Task 2、Task 3 并行）
  - **Blocks**: Task 3, 4, 5, 7
  - **Blocked By**: None（可立即开始）

  **References**:

  **Pattern References**:
  - `src/types/tool.ts` - 当前 Tool 类型定义，重构基础
  - `src/types/llm.ts:ToolCall` - LLM 工具调用类型，了解上下文

  **API/Type References**:
  - mcporter 库返回的 `ServerToolInfo`：`{ name: string, description: string, inputSchema: object }`

  **Acceptance Criteria**:

  - [ ] `src/mcp/types.ts` 文件存在，包含 MCPServerConfig、MCPServersConfig、MCPToolInfo 类型
  - [ ] `src/types/tool.ts` 不再包含 `scriptPath` 字段
  - [ ] `src/types/tool.ts` 包含 `BuiltinToolDef` 和 `UnifiedTool` 类型

  **QA Scenarios**:

  ```
  Scenario: 类型文件编译通过
    Tool: Bash
    Steps:
      1. 运行 `bun check src/types/tool.ts src/mcp/types.ts`
    Expected Result: 零 TypeScript 错误
    Evidence: .sisyphus/evidence/task-1-type-check.txt

  Scenario: 旧 scriptPath 字段已移除
    Tool: Bash
    Steps:
      1. 运行 `grep -n "scriptPath" src/types/tool.ts`
    Expected Result: 无匹配行（exit code 1）
    Evidence: .sisyphus/evidence/task-1-no-scriptpath.txt
  ```

  **Commit**: YES（与 Task 2、3 合并）
  - Message: `refactor(tools): 新增类型定义和配置层`

---

- [x] 2. 配置层更新：`src/config/schema.ts` + `src/config/paths.ts`

  **What to do**:
  - `src/config/paths.ts`：新增常量 `MCP_SERVERS_FILE = path.join(CONFIG_DIR, 'mcp-servers.json')`
  - `src/config/schema.ts`：
    - 在 Config zod schema 中增加字段：`builtinTools: z.record(z.boolean()).optional().default({})`
    - 含义：`{ "weather": true, "anotherTool": false }` 控制各内置工具开关
    - 更新 `Config` TypeScript 类型导出

  **Must NOT do**:
  - 不修改现有字段（model、contextWindow、activeSessionId）
  - 不删除现有 paths 常量

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1（与 Task 1、Task 3 并行）
  - **Blocks**: Task 3, 6, 7
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `src/config/schema.ts` - 现有 zod schema，照此格式新增字段
  - `src/config/paths.ts` - 现有路径常量格式

  **Acceptance Criteria**:
  - [ ] `src/config/paths.ts` 包含 `MCP_SERVERS_FILE` 导出
  - [ ] `src/config/schema.ts` 中 Config 类型包含 `builtinTools` 字段
  - [ ] `bun check src/config/` 零错误

  **QA Scenarios**:

  ```
  Scenario: 配置文件编译通过
    Tool: Bash
    Steps:
      1. 运行 `bun check src/config/schema.ts src/config/paths.ts`
    Expected Result: 零错误
    Evidence: .sisyphus/evidence/task-2-config-check.txt

  Scenario: 新字段存在且有默认值
    Tool: Bash
    Steps:
      1. 运行 `grep -n "builtinTools" src/config/schema.ts`
    Expected Result: 至少 1 行匹配，包含 z.record 定义
    Evidence: .sisyphus/evidence/task-2-builtin-tools-field.txt
  ```

  **Commit**: YES（与 Task 1、3 合并）

---

- [x] 3. MCP config 模块：`src/mcp/config.ts`

  **What to do**:
  - 新建 `src/mcp/config.ts`，参考 `src/llm/config.ts` 实现模式
  - 实现以下函数：
    - `loadMCPServers(): Promise<MCPServersConfig>` - 读取 mcp-servers.json，不存在时返回 `{ mcpServers: {} }`
    - `saveMCPServers(config: MCPServersConfig): Promise<void>` - 写入 mcp-servers.json
    - `addMCPServer(name: string, config: MCPServerConfig): Promise<void>` - 添加 server
    - `removeMCPServer(name: string): Promise<void>` - 删除 server（name 不存在时 throw UsageError）
    - `enableMCPServer(name: string): Promise<void>` - 设置 enabled: true
    - `disableMCPServer(name: string): Promise<void>` - 设置 enabled: false
  - 文件路径使用 `MCP_SERVERS_FILE` 常量（来自 paths.ts）
  - 写入时确保目录存在（`mkdir -p`）

  **Must NOT do**:
  - 不在此模块中调用 mcporter（纯配置读写）
  - 不合并到 llm/config.ts

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1（与 Task 1、Task 2 并行）
  - **Blocks**: Task 4, 8
  - **Blocked By**: Task 1（MCPServerConfig 类型）, Task 2（MCP_SERVERS_FILE 常量）

  **References**:

  **Pattern References**:
  - `src/llm/config.ts` - 参照此文件的读写模式、目录创建方式、错误处理
  - `src/config/paths.ts` - MCP_SERVERS_FILE 常量位置

  **API/Type References**:
  - `src/mcp/types.ts:MCPServersConfig` - 配置数据结构

  **Acceptance Criteria**:
  - [ ] `src/mcp/config.ts` 存在，导出所有 6 个函数
  - [ ] `bun check src/mcp/config.ts` 零错误
  - [ ] `loadMCPServers()` 在文件不存在时不抛异常，返回空配置

  **QA Scenarios**:

  ```
  Scenario: config 模块编译通过
    Tool: Bash
    Steps:
      1. 运行 `bun check src/mcp/config.ts`
    Expected Result: 零错误
    Evidence: .sisyphus/evidence/task-3-config-check.txt

  Scenario: 所有函数都被导出
    Tool: Bash
    Steps:
      1. 运行 `grep -n "^export" src/mcp/config.ts`
    Expected Result: 至少 6 行 export（6 个函数）
    Evidence: .sisyphus/evidence/task-3-exports.txt
  ```

  **Commit**: YES（与 Task 1、2 合并）

---

- [x] 4. MCP client 封装：`src/mcp/client.ts`

  **What to do**:
  - 安装依赖：`bun add mcporter`
  - 新建 `src/mcp/client.ts`，实现以下内容：

  1. **Lazy singleton**：
    ```typescript
    let _runtime: Runtime | null = null;
    async function getRuntime(): Promise<Runtime> {
      if (!_runtime) {
        const serversConfig = await loadMCPServers();
        // mcporter 需要 { mcpServers: {...} } 格式，只传入 enabled 的 server
        const enabledServers = Object.fromEntries(
          Object.entries(serversConfig.mcpServers)
            .filter(([_, v]) => v.enabled)
            .map(([k, v]) => [k, { command: v.command, args: v.args, env: v.env }])
        );
        _runtime = createRuntime({ mcpServers: enabledServers });
      }
      return _runtime;
    }
    export async function closeRuntime(): Promise<void> {
      if (_runtime) { await _runtime.close(); _runtime = null; }
    }
    ```

  2. **listAllMCPTools()**: 遍历所有 enabled server，调用 `runtime.listTools(serverName)`，捕获异常（server 离线）打印 warn 并跳过，返回 `MCPToolInfo[]`（含 `fullName: "servername__toolname"`）

  3. **callMCPTool(fullName: string, args: Record<string, unknown>)**: 拆分 fullName 为 serverName + toolName，调用 `runtime.callTool(serverName, toolName, { args })`，用 `createCallResult(result).text()` 提取结果，失败时 JSON.stringify fallback，抛出异常前打印 warn

  4. **getMCPToolDefs()**: 调用 listAllMCPTools，转换为 LLM function calling 格式（`{ type: 'function', function: { name, description, parameters: inputSchema } }`）

  **Must NOT do**:
  - 不在模块级别（顶层）初始化 runtime（必须 lazy）
  - 不吞掉工具调用异常（warn 后 re-throw）

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2（与 Task 5、Task 6 并行）
  - **Blocks**: Task 7, 9
  - **Blocked By**: Task 1（MCPToolInfo 类型）, Task 3（loadMCPServers 函数）

  **References**:

  **Pattern References**:
  - `src/llm/client.ts` - 参照封装模式和错误处理
  - `src/tools/executor.ts` - 了解当前执行模式（将被替换）

  **API/Type References**:
  - mcporter: `createRuntime`, `Runtime.listTools(server)`, `Runtime.callTool(server, tool, {args})`, `createCallResult(result).text()`, `describeConnectionIssue(error)`
  - `src/mcp/types.ts:MCPToolInfo` - 返回类型

  **External References**:
  - https://github.com/steipete/mcporter - mcporter 源码和 API

  **Acceptance Criteria**:
  - [ ] `bun check src/mcp/client.ts` 零错误
  - [ ] 导出 `listAllMCPTools`, `callMCPTool`, `getMCPToolDefs`, `closeRuntime`
  - [ ] 无启用的 MCP server 时，`listAllMCPTools()` 返回空数组（不抛异常）

  **QA Scenarios**:

  ```
  Scenario: client 模块编译通过
    Tool: Bash
    Steps:
      1. 运行 `bun check src/mcp/client.ts`
    Expected Result: 零错误
    Evidence: .sisyphus/evidence/task-4-client-check.txt

  Scenario: 无 MCP server 时不崩溃
    Tool: Bash
    Steps:
      1. 临时确保 mcp-servers.json 不存在或为空
      2. 运行 `bun -e "import { listAllMCPTools } from './src/mcp/client.ts'; console.log(await listAllMCPTools())"`
    Expected Result: 打印 [] 或空数组，无异常
    Evidence: .sisyphus/evidence/task-4-empty-servers.txt
  ```

  **Commit**: 独立 commit
  - Message: `feat(mcp): MCP runtime lazy singleton 封装`
  - Files: `src/mcp/client.ts`, `package.json`, `bun.lock`

---

- [x] 5. 内置工具重构：`src/tools/builtin/weather.ts` + 内置工具接口

  **What to do**:
  - `src/tools/builtin/weather.ts`：
    - 删除文件末尾的 `process.argv[2]` 脚本入口（约 5 行）
    - 保留 `ToolExecutor` 接口实现（`execute(args)` 方法）
    - 导出工具定义对象（供 store.ts 使用）：
      ```typescript
      export const weatherToolDef: BuiltinToolDef = {
        name: 'weather',
        description: '获取指定城市的天气信息',
        enabled: true,  // 默认启用
        parameters: {
          type: 'object',
          properties: {
            city: { type: 'string', description: '城市名称' }
          },
          required: ['city']
        }
      };
      export const weatherExecutor: ToolExecutor = new WeatherTool();
      ```
  - 确认 `src/tools/base.ts` 中 `ToolExecutor` 接口保持不变（`execute(args): Promise<string>`）

  **Must NOT do**:
  - 不修改 `execute()` 方法的核心逻辑
  - 不删除 `ToolExecutor` 接口

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2（与 Task 4、Task 6 并行）
  - **Blocks**: Task 7
  - **Blocked By**: Task 1（BuiltinToolDef 类型）

  **References**:

  **Pattern References**:
  - `src/tools/builtin/weather.ts` - 当前完整实现，了解要删除哪部分
  - `src/tools/base.ts` - ToolExecutor 接口定义

  **API/Type References**:
  - `src/types/tool.ts:BuiltinToolDef` - 新类型（Task 1 产出）

  **Acceptance Criteria**:
  - [ ] `bun check src/tools/builtin/weather.ts` 零错误
  - [ ] 文件中不含 `process.argv` 字样
  - [ ] 导出 `weatherToolDef` 和 `weatherExecutor`

  **QA Scenarios**:

  ```
  Scenario: weather 工具文件编译通过
    Tool: Bash
    Steps:
      1. 运行 `bun check src/tools/builtin/weather.ts`
    Expected Result: 零错误
    Evidence: .sisyphus/evidence/task-5-weather-check.txt

  Scenario: 脚本入口已清除
    Tool: Bash
    Steps:
      1. 运行 `grep -n "process.argv" src/tools/builtin/weather.ts`
    Expected Result: 无匹配行（exit code 1）
    Evidence: .sisyphus/evidence/task-5-no-argv.txt
  ```

  **Commit**: 独立 commit（可与 Task 6 合并）
  - Message: `refactor(tools): 内置工具直调重构，精简 tools 命令`

---

- [x] 6. tools 命令精简：`src/commands/tools.ts`

  **What to do**:
  - 删除 `add` 子命令（整块代码删除）
  - 删除 `delete` 子命令（整块代码删除）
  - 更新 `list` 子命令：改为从 `config.builtinTools` + 内置工具定义列表读取状态
  - 更新 `enable` 子命令：改为更新 `config.builtinTools[toolName] = true` 并保存
  - 更新 `disable` 子命令：改为更新 `config.builtinTools[toolName] = false` 并保存
  - 更新命令 `usage` 和 `description` 字符串，移除 add/delete 相关说明

  **Must NOT do**:
  - 不删除 `list/enable/disable` 子命令
  - 不修改 tools 命令的注册名称（仍为 `tools`）

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2（与 Task 4、Task 5 并行）
  - **Blocks**: Task 9
  - **Blocked By**: Task 2（Config 类型中 builtinTools 字段）

  **References**:

  **Pattern References**:
  - `src/commands/tools.ts` - 当前完整实现，了解要删除和修改哪些部分
  - `src/commands/session.ts` - 参照子命令模式和错误处理

  **API/Type References**:
  - `src/config/loader.ts` - loadConfig/saveConfig 函数
  - `src/config/schema.ts:Config.builtinTools` - 新字段（Task 2 产出）

  **Acceptance Criteria**:
  - [ ] `bun check src/commands/tools.ts` 零错误
  - [ ] 文件中不含 `add` 子命令处理逻辑
  - [ ] 文件中不含 `delete` 子命令处理逻辑
  - [ ] `list` 子命令正确读取内置工具状态

  **QA Scenarios**:

  ```
  Scenario: tools 命令编译通过
    Tool: Bash
    Steps:
      1. 运行 `bun check src/commands/tools.ts`
    Expected Result: 零错误
    Evidence: .sisyphus/evidence/task-6-tools-check.txt

  Scenario: add/delete 子命令已移除
    Tool: Bash
    Steps:
      1. 运行 `grep -n "\"add\"\|\"delete\"" src/commands/tools.ts`
    Expected Result: 无匹配或仅出现在注释中
    Evidence: .sisyphus/evidence/task-6-no-add-delete.txt
  ```

  **Commit**: YES（与 Task 5 合并）
  - Message: `refactor(tools): 内置工具直调重构，精简 tools 命令`

---

- [x] 7. tools/store.ts 全量重构：统一聚合内置工具 + MCP 工具

  **What to do**:
  - 完全重写 `src/tools/store.ts`，实现以下接口：
    1. `getAllBuiltinDefs(): BuiltinToolDef[]` - 返回所有内置工具定义列表（hardcoded，含 weatherToolDef 等）
    2. `getEnabledBuiltinDefs(config: Config): BuiltinToolDef[]` - 根据 config.builtinTools 过滤（默认 true）
    3. `getBuiltinExecutor(name: string): ToolExecutor | undefined` - 根据名称返回执行器
    4. `getUnifiedToolDefs(config: Config): Promise<UnifiedTool[]>` - 聚合内置工具 + MCP 工具，返回统一格式（供 ask.ts 使用）
    5. `executeUnifiedTool(name: string, args: Record<string, unknown>): Promise<string>` - 根据工具名称（内置直调 / MCP 调用）执行
  - 内置工具命名：直接用 `toolDef.name`（如 `weather`）
  - MCP 工具命名：`servername__toolname` 格式（由 getMCPToolDefs 保证）
  - 删除旧的 `loadTools()`, `saveTools()`, `addTool()`, `deleteTool()` 等函数
  - 不再 import `src/tools/executor.ts`

  **Must NOT do**:
  - 不引入 `src/tools/executor.ts`（将被删除）
  - 不在 store.ts 中处理 MCP runtime 生命周期（由 client.ts 负责）

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3（与 Task 8、Task 9 并行）
  - **Blocks**: Task 9
  - **Blocked By**: Task 1（UnifiedTool 类型）, Task 2（Config.builtinTools）, Task 4（getMCPToolDefs、callMCPTool）, Task 5（weatherToolDef、weatherExecutor）

  **References**:

  **Pattern References**:
  - `src/tools/store.ts` - 当前实现，了解要替换的逻辑
  - `src/tools/builtin/weather.ts:weatherToolDef` - 内置工具定义来源（Task 5 产出）

  **API/Type References**:
  - `src/mcp/client.ts:getMCPToolDefs`, `callMCPTool` - MCP 工具接口（Task 4 产出）
  - `src/types/tool.ts:UnifiedTool, BuiltinToolDef` - 统一类型

  **Acceptance Criteria**:
  - [ ] `bun check src/tools/store.ts` 零错误
  - [ ] 导出 `getAllBuiltinDefs`, `getEnabledBuiltinDefs`, `getBuiltinExecutor`, `getUnifiedToolDefs`, `executeUnifiedTool`
  - [ ] 文件中不包含 `executor.ts` 的 import

  **QA Scenarios**:

  ```
  Scenario: store 模块编译通过
    Tool: Bash
    Steps:
      1. 运行 `bun check src/tools/store.ts`
    Expected Result: 零错误
    Evidence: .sisyphus/evidence/task-7-store-check.txt

  Scenario: 不引用废弃 executor
    Tool: Bash
    Steps:
      1. 运行 `grep -n "executor" src/tools/store.ts`
    Expected Result: 无匹配或仅为注释
    Evidence: .sisyphus/evidence/task-7-no-executor.txt
  ```

  **Commit**: 独立 commit（可与 Task 8 合并）

---

- [x] 8. mcp 命令实现：`src/commands/mcp.ts`

  **What to do**:
  - 新建 `src/commands/mcp.ts`，参照 `src/commands/llm.ts` 的模式
  - 实现子命令：
    - `add`：交互式提示输入 server 名称、command、args（空格分隔）、是否立即启用；调用 `addMCPServer()`
    - `list`：调用 `loadMCPServers()`，以表格形式输出（name、command、enabled 状态）；无 server 时打印提示
    - `remove`：参数为 server 名称；调用 `removeMCPServer()`；提示确认
    - `enable`：参数为 server 名称；调用 `enableMCPServer()`
    - `disable`：参数为 server 名称；调用 `disableMCPServer()`
  - 命令 `name: 'mcp'`，`description: '管理 MCP server'`
  - 顶层 `execute()` 解析第一个 arg 为子命令，路由到对应处理函数

  **Must NOT do**:
  - 不在 mcp 命令中直接调用 mcporter runtime（只操作配置）
  - 不将 mcp 子命令合并到 tools 命令下

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3（与 Task 7、Task 9 并行）
  - **Blocks**: Task 9（main.ts 注册）
  - **Blocked By**: Task 3（mcp/config.ts 函数）, Task 4（mcp/client.ts 类型）

  **References**:

  **Pattern References**:
  - `src/commands/llm.ts` - 完整参照，子命令路由模式、交互式 prompt 方式
  - `src/commands/session.ts` - 另一个参照，错误处理和输出格式

  **API/Type References**:
  - `src/mcp/config.ts:loadMCPServers, addMCPServer, removeMCPServer, enableMCPServer, disableMCPServer`
  - `src/output/text.ts:printTable` - 表格输出
  - `src/output/formatter.ts:success, warn` - 格式化输出

  **Acceptance Criteria**:
  - [ ] `bun check src/commands/mcp.ts` 零错误
  - [ ] 包含 add/list/remove/enable/disable 五个子命令处理

  **QA Scenarios**:

  ```
  Scenario: mcp 命令编译通过
    Tool: Bash
    Steps:
      1. 运行 `bun check src/commands/mcp.ts`
    Expected Result: 零错误
    Evidence: .sisyphus/evidence/task-8-mcp-check.txt

  Scenario: mcp list 在无 server 时不崩溃
    Tool: Bash
    Steps:
      1. 临时移除 mcp-servers.json（或确保为空）
      2. 运行 `bun run src/main.ts mcp list`
    Expected Result: 打印"暂无已配置的 MCP server"类似提示，exit code 0
    Evidence: .sisyphus/evidence/task-8-mcp-list-empty.txt
  ```

  **Commit**: YES（与 Task 7 合并）
  - Message: `feat(mcp): MCP 工具系统全量实现`

---

- [x] 9. ask 命令适配 + main.ts 注册 + 删除废弃文件

  **What to do**:

  **1. 更新 `src/commands/ask.ts`**:
  - 替换工具加载逻辑：`loadTools()` → `getUnifiedToolDefs(config)`
  - 替换工具执行逻辑：`executeToolCommand(name, args)` → `executeUnifiedTool(name, args)`
  - 在 finally block 中调用 `closeRuntime()`（防止内存泄漏）
  - 工具定义格式：确保传给 `chatWithTools` 的格式与 `UnifiedTool` 对应（function calling 格式）

  **2. 更新 `src/main.ts`**:
  - import `mcpCommand` from `src/commands/mcp.ts`
  - 调用 `registry.register(mcpCommand)` 注册命令

  **3. 删除废弃文件**：
  - `rm src/tools/executor.ts`
  - 确认 `~/.config/my-cli/tools.json` 相关代码路径不再被引用（不需要删除用户磁盘上的文件，只是代码不再读取）

  **4. 清理 `src/tools/store.ts` 中残留的旧 import**（若 Task 7 未完全清除）

  **Must NOT do**:
  - 不删除 `src/tools/store.ts`（重构后仍然存在）
  - 不修改 ask.ts 的其他核心逻辑（session 管理、流式输出、context 统计等）

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO（此 task 整合所有前序产出）
  - **Parallel Group**: Wave 3 尾部（必须等 Task 4, 6, 7, 8 完成）
  - **Blocks**: FINAL wave
  - **Blocked By**: Task 4（closeRuntime）, Task 6（tools 命令精简完成），Task 7（getUnifiedToolDefs、executeUnifiedTool）, Task 8（mcp 命令注册）

  **References**:

  **Pattern References**:
  - `src/commands/ask.ts` - 当前完整实现，特别是工具调用循环（第 7 步）
  - `src/main.ts` - 命令注册格式

  **API/Type References**:
  - `src/tools/store.ts:getUnifiedToolDefs, executeUnifiedTool` - Task 7 产出
  - `src/mcp/client.ts:closeRuntime` - Task 4 产出

  **Acceptance Criteria**:
  - [ ] `bun check src/` 整个项目零 TypeScript 错误
  - [ ] `src/tools/executor.ts` 文件不存在
  - [ ] `src/main.ts` 包含 mcp 命令注册
  - [ ] `src/commands/ask.ts` 不引用 `executor.ts` 或旧 `loadTools`

  **QA Scenarios**:

  ```
  Scenario: 整个项目编译通过
    Tool: Bash
    Steps:
      1. 运行 `bun check src/`
    Expected Result: 零 TypeScript 错误
    Evidence: .sisyphus/evidence/task-9-full-check.txt

  Scenario: executor.ts 已删除
    Tool: Bash
    Steps:
      1. 运行 `ls src/tools/executor.ts 2>&1`
    Expected Result: 输出 "No such file or directory"
    Evidence: .sisyphus/evidence/task-9-no-executor.txt

  Scenario: mcp 命令可以被路由到
    Tool: Bash
    Steps:
      1. 运行 `bun run src/main.ts mcp list`
    Expected Result: 命令被正确路由，显示 MCP server 列表（空列表也可）
    Evidence: .sisyphus/evidence/task-9-mcp-list.txt

  Scenario: tools list 命令正常工作
    Tool: Bash
    Steps:
      1. 运行 `bun run src/main.ts tools list`
    Expected Result: 显示内置工具列表（至少包含 weather），exit code 0
    Evidence: .sisyphus/evidence/task-9-tools-list.txt
  ```

  **Commit**: YES（独立 commit）
  - Message: `feat(mcp): 完整 MCP 工具系统 + ask 适配，删除废弃文件`
  - Files: `src/commands/ask.ts`, `src/main.ts`; 删除 `src/tools/executor.ts`
  - Pre-commit: `bun check src/`

---

## Final Verification Wave

- [x] F1. **计划合规审计** — `oracle`
  逐条检查 "Must Have"：内置工具直调、MCP namespace、runtime singleton、降级、config.json builtinTools。逐条检查 "Must NOT Have"：搜索 tools add/delete 命令是否残留、executor.ts 是否已删除、process.argv 入口是否清除、tools.json 是否已删除。检查 .sisyphus/evidence/ 下所有证据文件是否存在。
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Evidence [N files] | VERDICT: APPROVE/REJECT`

- [x] F2. **TypeScript 编译 + 代码质量** — `unspecified-high`
  运行 `bun check src/`，必须零错误。审查所有修改文件：无 `as any`、无空 catch、无 console.log（除 debug 外）、无未使用 import。检查 MCP 工具 schema 转换是否保留 `required` 字段。
  Output: `Build [PASS/FAIL] | Issues [N] | VERDICT`

- [x] F3. **端到端 QA** — `unspecified-high`
  执行以下命令并验证输出：
  1. `bun run src/main.ts tools list` → 显示 weather 及其状态
  2. `bun run src/main.ts tools enable weather` → 成功提示
  3. `bun run src/main.ts mcp list` → 列出空列表或已有 server
  4. `bun run src/main.ts mcp --help` → 显示子命令帮助
  5. `bun check src/` → 零错误
  保存每个命令的输出到 `.sisyphus/evidence/final-qa/`。
  Output: `Commands [5/5] | VERDICT`

- [x] F4. **范围保真度检查** — `deep`
  对每个 task，读取 "What to do"，用 git diff 检查实际变更，确认 1:1 对应（无遗漏、无越界）。检查 `src/tools/executor.ts` 是否已删除。检查 `~/.config/my-cli/tools.json` 是否删除相关代码路径。检查 ask.ts 是否仍使用旧 executor 调用。
  Output: `Tasks [N/N compliant] | Stale code [CLEAN/N] | VERDICT`

---

## Commit Strategy

- **Wave 1**: `refactor(tools): 新增类型定义和配置层` - types/tool.ts, mcp/types.ts, config/schema.ts, config/paths.ts, mcp/config.ts
- **Wave 2**: `refactor(tools): 内置工具直调重构，精简 tools 命令` - tools/builtin/weather.ts, tools/store.ts(partial), commands/tools.ts
- **Wave 3**: `feat(mcp): 完整 MCP 工具系统 + ask 适配，删除废弃文件` - mcp/client.ts, tools/store.ts, commands/mcp.ts, commands/ask.ts, main.ts; 删除 tools/executor.ts

---

## Success Criteria

### Verification Commands
```bash
bun check src/                                          # Expected: 零 TypeScript 错误
bun run src/main.ts tools list                          # Expected: 显示 weather 工具及启用状态
bun run src/main.ts mcp list                            # Expected: 列出 MCP server（空或有）
bun run src/main.ts mcp --help                          # Expected: 显示 add/list/remove/enable/disable
ls src/tools/executor.ts 2>&1                           # Expected: No such file
```

### Final Checklist
- [x] 所有 "Must Have" 已实现
- [x] 所有 "Must NOT Have" 已清除
- [x] `bun check src/` 零错误
- [x] 所有 QA 场景通过，证据文件已保存
