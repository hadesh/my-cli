

## [2026-04-14] Task 6: ask 命令集成 Function Calling 循环

### 完成内容
- 修改 `src/commands/ask.ts`：集成 Function Calling 循环逻辑
- 修改 `src/commands/ask.test.ts`：新增 3 个 FC 相关测试

### 实现细节

**FC 循环逻辑：**
1. 调用 LLM 前通过 `loadTools()` 获取已启用工具（`enabled: true`）
2. 无工具时走原有 `streamChat` 流式路径（完全不变）
3. 有工具时进入 FC 循环：
   - 调用 `chatWithTools`（非流式）获取 LLM 响应
   - 检查 `response.choices[0].message.tool_calls`
   - 有 tool_calls → 串行执行工具 → 追加 assistant + tool 消息 → 继续循环
   - 无 tool_calls → 最后一轮用 `streamChat` 流式输出
   - 循环上限：10 次（防止无限循环）

**消息管理：**
- FC 循环中的 assistant（含 tool_calls）和 tool 消息**只在内存中的 messages 数组**，不写入 session
- session 只存储最终的 user + assistant 消息

**Factory 扩展：**
```typescript
export const toolsStoreFactory = { loadTools };
export const chatWithToolsFactory = { call: chatWithTools };
export const executorFactory = { execute: executeToolCommand };
```

### 新增测试（3 个）
1. `ask without tools uses streamChat path` - 无工具时确认 streamChat 被调用
2. `ask with tools but LLM returns no tool_calls uses streamChat` - 有工具但一轮无 tool_calls
3. `ask with tools and tool_calls executes tool and continues` - 完整 FC 循环验证

### 测试结果
- `bun test src/commands/ask.test.ts` → 11 pass, 0 fail
- `bun test` → 87 pass (原有 84 + 新增 3), 0 fail

### 代码要点
- 保持 `streamChat` 函数签名不变
- Tool → ToolDefinition 转换：`type: 'function' as const`
- 参数解析失败时返回空对象 `{}`
- 找不到工具时返回错误信息：`工具 "${name}" 不存在`
