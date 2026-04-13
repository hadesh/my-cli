# Learnings — llm-upgrade

## [2026-04-10] 初始化

### 现有代码关键约定

1. **Command.execute 签名**：`execute(config: Config, flags: Record<string, unknown>, args: string[]): Promise<void>`
   - args 是展开的数组（main.ts: `[...match.remaining, ...parsed.positional]`）
   - 子命令路由用 `args[0]`（不是 `args.positional[0]`）

2. **loadConfig 是同步函数**，返回 `Config`（已过 zod parse）
   - 使用 `readFileSync`，不是 async

3. **ExitCode 枚举**：SUCCESS=0, GENERAL=1, USAGE=2, AUTH=3, NETWORK=4
   - LLM=7 需新增

4. **registry.register(command)** 接受 `Command` 对象（有 `name` 属性），不是 `(name, command)` 两参数
   - registry 用 command.name 做树形分割（`command.name.split(' ')`）
   - 顶层命令注册：只注册 `session`、`llm`，不注册 `session new` 等二级路径

5. **args.ts bug**：第 34-45 行子命令吞词循环，需移除
   - 正确行为：command 只取第一个非 flag 词，后续全进 positional

6. **CONFIG_FILE**：`~/.config/my-cli/config.json`（通过 `CONFIG_FILE` 常量引用）

7. **weather.ts 命令模式**：标准 Command 对象，直接从 positional[0] 取城市名

## [Task 2 完成] Session Store
- store.ts 导出的 8 个函数：createSession, getSession, updateSession, deleteSession, listSessions, getActiveSessionId, setActiveSessionId, getOrCreateActiveSession
- 测试环境隔离：通过 `process.env.HOME = tmpDir` 隔离，但 Bun 的 `homedir()` 不读取 process.env.HOME，需要手动使用 `process.env.HOME ?? homedir()`
- SESSIONS_DIR 在读写前需 `mkdirSync(SESSIONS_DIR, { recursive: true })`
- loadConfig() 是同步调用（不需要 await）
- Bun.test 中修改 process.env.HOME 需要在代码中显式使用 `process.env.HOME ?? homedir()`，而不是依赖 `os.homedir()`

## [Task 完成] LLM SSE Stream Client
- SSE 解析关键：buffer 边界处理（一行可能跨多个 chunk），用 `buffer = lines.pop()` 保留不完整行
- `[DONE]` 后直接 return，不继续处理后续数据
- 空 content delta（role-only chunk）不调用 onChunk，也不累加到 fullReply
- 非 2xx 响应：读取 response.text()，抛出 `LLMError` 包含 status 和 body
- Bun test mock fetch：每个测试末尾手动恢复 `global.fetch = originalFetch`（afterEach 在 bun:test 中不稳定）
- `ReadableStream<Uint8Array>` 构造：用 `TextEncoder().encode(text)` 生成 Uint8Array

## [Task 4 完成] session 命令组
- session 命令使用 switch-case 路由子命令（args[0] = 子命令名）
- 测试中使用真实文件系统 + process.env.HOME 隔离环境
- console.log mock：使用 `logs = []; console.log = (...args) => logs.push(...)` 模式捕获输出
- 多次 execute 后 logs 数组长度累加，重置时 `logs = []` 需谨慎处理数组索引
- UsageError 用于用户输入错误（缺少参数、未知子命令），CLIError 用于业务错误（session 不存在）
- printTable 支持 config 和 rows 数组，自动处理空数组（打印 "(无数据)"）

## [Task 5 完成] LLM 命令组 + Provider 配置管理

### 新增文件
- `src/llm/config.ts`：6 个配置管理函数
- `src/llm/config.test.ts`：7 个测试用例
- `src/commands/llm.ts`：子命令路由（add/list/use）
- `src/commands/llm.test.ts`：7 个测试用例

### 关键发现

1. **动态路径函数必须使用 `process.env.HOME ?? homedir()`**：
   - `getLLMConfigFile()` 动态构建路径，支持测试环境隔离
   - 直接使用 `os.homedir()` 在测试中不会被 `process.env.HOME` 覆盖

2. **addProvider 自动设置第一个 provider 为默认**：
   - 检查 `!config.defaultProvider`（空字符串）来判断是否需要自动设置
   - 重名检查用 `find()` 遍历 providers 数组

3. **handleList 不依赖 getDefaultProvider**：
   - `getDefaultProvider()` 在无配置时会抛错
   - 使用 `loadLLMConfig()` 直接获取 defaultProvider 名称更安全
   - 仅在 providers.length > 0 时才处理默认标记

4. **readline 交互式输入**：
   - 使用 `node:readline/promises` 的 `createInterface`
   - 必须 `rl.close()` 释放资源（放在 finally 中）

5. **测试覆盖要点**：
   - 第一个 addProvider 自动成为默认（测试 7）
   - setDefaultProvider 不存在的 name 抛 UsageError
   - getDefaultProvider 无配置时抛 UsageError
   - llm use 无参数抛 UsageError

### 测试统计
- config.test.ts：7 pass
- llm.test.ts：7 pass  
- 全量：39 pass（25 + 14）

## [Task 6 完成] init 命令 — 交互式生成 agent.md

### 新增文件
- `src/commands/init.ts`：readline 交互式引导生成 agent.md
- `src/commands/init.test.ts`：8 个测试用例

### 关键发现

1. **readline mock 的挑战**：
   - Bun 模块缓存导致 `import * as readline` 后无法直接修改 `readline.createInterface`
   - `Object.defineProperty` 也无法修改模块命名空间对象的绑定
   - 解决方案：使用对象包装器 `readlineFactory = { create: () => ... }`，可修改属性
   - 或者使用 Bun 的 `mock.module('node:readline', () => mockReadline)`（有缓存问题）

2. **交互流程顺序影响 mock 输入顺序**：
   - init 命令流程：先收集字段，再检查文件是否存在并确认覆盖
   - mock 输入顺序必须匹配代码执行顺序：`['NewBot', '角色', '风格', '注意事项', 'y']`
   - 而不是直觉顺序：`['y', 'NewBot', '角色', '风格', '注意事项']`

3. **动态路径函数模式**：
   - 使用 `process.env.HOME ?? homedir()` 支持测试环境隔离
   - getAgentMdFile() 每次调用都动态构建路径

4. **空字段处理**：
   - 空名称使用默认值 "Assistant"（检查 `trim() === ''`）
   - 空注意事项省略整个章节（不输出 "## 注意事项"）

5. **文件覆盖确认**：
   - 输入 "N" 或非 "y" 则取消（检查 `toLowerCase() !== 'y'`）
   - 输入 "y" 则覆盖

### 测试统计
- init.test.ts：8 pass
- 全量：47 pass（39 + 8）
