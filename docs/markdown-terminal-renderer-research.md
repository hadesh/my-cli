# Node.js/Bun 终端 Markdown 渲染方案调研

## 需求概述

- 在终端中美观渲染 Markdown 格式文本
- 支持常见语法：标题、列表、代码块、加粗、斜体、链接等
- 与 Bun 运行时兼容

---

## 方案对比

### 1. chalk

**简介**：chalk 是最流行的终端文本样式化库，本身不解析 Markdown，需配合解析器手动处理样式。

**优点**：
- 零依赖，体积小（44KB）
- API 简洁，链式调用
- 支持 16色、256色、Truecolor（1600万色）
- 自动检测终端颜色支持
- 被 115,000+ 包依赖，生态成熟
- Bun 完全兼容（ESM）

**缺点**：
- 不解析 Markdown，需要自己实现解析逻辑
- 需要手动处理每个 Markdown 元素的样式
- 开发成本高

**是否推荐**：⚠️ 不推荐直接使用（除非需要极致定制）

**代码示例**：
```typescript
import chalk from 'chalk';

// 需要自己解析 Markdown 并添加样式
function renderMarkdown(md: string) {
  // 简单示例：处理标题
  const lines = md.split('\n');
  return lines.map(line => {
    if (line.startsWith('# ')) {
      return chalk.green.bold(line.slice(2));
    }
    if (line.startsWith('## ')) {
      return chalk.green(line.slice(3));
    }
    // 处理粗体 **text**
    if (line.includes('**')) {
      return line.replace(/\*\*(.*?)\*\*/g, (_, text) => chalk.bold(text));
    }
    return line;
  }).join('\n');
}

console.log(renderMarkdown('# Hello **World**'));
```

---

### 2. marked + 自定义 terminal renderer

**简介**：marked 是高性能 Markdown 解析器，可创建自定义渲染器输出终端格式。

**优点**：
- marked 解析速度快，功能完整
- 完全控制渲染逻辑
- 可以精确定制每个元素的样式
- 与 Bun 兼容

**缺点**：
- 需要自己实现完整的渲染器（工作量较大）
- 需要处理表格、代码块、列表等复杂元素
- 没有现成的语法高亮支持

**是否推荐**：⚠️ 不推荐（工作量太大，不如直接用 marked-terminal）

**代码示例**：
```typescript
import { marked } from 'marked';
import chalk from 'chalk';

class TerminalRenderer extends marked.Renderer {
  heading(text: string, level: number) {
    const colors = [chalk.magenta.bold, chalk.green.bold, chalk.green];
    return colors[level - 1]?.(text) + '\n';
  }
  
  strong(text: string) {
    return chalk.bold(text);
  }
  
  em(text: string) {
    return chalk.italic(text);
  }
  
  code(code: string, language: string) {
    return chalk.yellow(code) + '\n';
  }
  
  paragraph(text: string) {
    return text + '\n';
  }
}

marked.setOptions({ renderer: new TerminalRenderer() });

const md = '# 标题\n\n这是**粗体**和*斜体*\n\n```js\nconsole.log("hello");\n```';
console.log(marked.parse(md));
```

---

### 3. ink (React for terminal)

**简介**：ink 是 React 的终端渲染器，可使用 React 组件构建 CLI UI。有配套的 ink-markdown 组件。

**优点**：
- React 生态，组件化开发
- Flexbox 布局系统
- 状态管理支持（hooks）
- ink-markdown 提现成的 Markdown 组件
- 适合构建复杂的交互式 CLI

**缺点**：
- 依赖较多（25个依赖）
- 学习曲线（需要 React 知识）
- ink-markdown 底层依赖 marked-terminal
- 非交互场景下过于重量级

**是否推荐**：✅ 推荐（用于交互式 CLI 应用）

**代码示例**：
```typescript
// 需要安装: bun add ink react ink-markdown
import React from 'react';
import { render, Text } from 'ink';
import Markdown from 'ink-markdown';

const App = () => (
  <>
    <Markdown>
      # Hello World
      
      这是 **粗体** 和 *斜体*
      
      - 列表项 1
      - 列表项 2
      
      ```typescript
      const x = 42;
      ```
    </Markdown>
  </>
);

render(<App />);
```

---

### 4. terminal-markdown

**简介**：专门的终端 Markdown 渲染工具，支持 CommonMark 和 GFM。

**优点**：
- 支持链接、表格、代码块
- 管道模式：`cat readme.md | tm`
- 自动适配终端主题
- 支持 CI/CD 环境

**缺点**：
- ⚠️ npm 包名已被废弃/不活跃（GitHub 仓库只有 2 stars）
- 不支持图片（替换为 alt 文本）
- 不支持 HTML
- 不支持表格对齐
- 依赖终端特性（链接、斜体等可能不生效）

**是否推荐**：❌ 不推荐（包不活跃，维护状态不明）

**代码示例**：
```bash
# CLI 使用（全局安装）
npm install -g terminal-markdown
tm readme.md

# 或管道模式
cat readme.md | tm
```

---

### 5. cli-markdown

**简介**：终端 Markdown 渲染库，支持语法高亮和表格。

**优点**：
- 支持 CLI 和模块化使用
- 语法高亮支持
- 表格渲染
- 最近更新（2025年6月）

**缺点**：
- GPL-3.0 许可证（商业使用受限）
- 依赖较多（14个依赖）
- 周下载量较低（1.4K）
- 不如 marked-terminal 成熟

**是否推荐**：⚠️ 不推荐（许可证限制，不如 marked-terminal）

**代码示例**：
```typescript
// CommonJS 模块
import cliMd from 'cli-markdown';

const md = '# Hello World\n\n**粗体**文本';
console.log(cliMd(md));

// CLI 使用
// md demo.md
```

---

### 6. marked-terminal

**简介**：marked 的官方级终端渲染扩展，成熟的解决方案。

**优点**：
- ✅ 成熟稳定（7.3.0版本，2025年1月更新）
- ✅ 高下载量（4.9M/周）
- ✅ 被大量依赖（1100+ dependents）
- ✅ MIT 许可证
- ✅ 支持完整的 Markdown 语法
- ✅ 语法高亮（cli-highlight）
- ✅ 表格渲染（cli-table3）
- ✅ Emoji 支持（node-emoji）
- ✅ 可点击链接（supports-hyperlinks）
- ✅ 完全可定制的样式（使用 chalk）
- ✅ Bun 兼容（ESM）
- ✅ ink-markdown 底层依赖它

**缺点**：
- 7个依赖（但都是常用库）
- 体积较大（1.9MB）

**是否推荐**：✅✅ 强烈推荐（最佳方案）

**代码示例**：
```typescript
// Bun/Node.js ESM
import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';

// 注册终端渲染器
marked.use(markedTerminal());

// 直接渲染
const md = `
# 标题示例

这是 **粗体** 和 *斜体* 文本。

## 代码块

\`\`\`typescript
const greeting = "Hello, Bun!";
console.log(greeting);
\`\`\`

## 列表

- 项目 1
- 项目 2
  - 子项目

## 表格

| 名称 | 值 |
|------|-----|
| A    | 1   |
| B    | 2   |

> 引用文本

[链接示例](https://example.com)
`;

console.log(marked.parse(md));
```

**自定义样式示例**：
```typescript
import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import chalk from 'chalk';

// 自定义样式配置
const options = {
  code: chalk.yellow,
  blockquote: chalk.gray.italic,
  heading: chalk.cyan.bold,
  firstHeading: chalk.magenta.underline.bold,
  hr: chalk.reset,
  listitem: chalk.reset,
  table: chalk.reset,
  paragraph: chalk.reset,
  strong: chalk.bold.red,
  em: chalk.italic.cyan,
  codespan: chalk.underline.magenta,
  link: chalk.blue.underline,
  href: chalk.blue.underline,
};

marked.use(markedTerminal(options));

console.log(marked.parse('# 自定义样式的 **Markdown**'));
```

---

## Bun 兼容性测试

所有方案都与 Bun 兼容，但需要注意：

| 方案 | Bun 兼容性 | 备注 |
|------|-----------|------|
| chalk | ✅ 完全兼容 | ESM 支持 |
| marked | ✅ 完全兼容 | ESM 支持 |
| ink | ✅ 完全兼容 | 需要 React |
| terminal-markdown | ⚠️ 未知 | 包不活跃 |
| cli-markdown | ⚠️ CommonJS | 可能需要动态导入 |
| marked-terminal | ✅ 完全兼容 | 最新版是 ESM |

---

## 推荐方案

### 🏆 首选：marked-terminal

**理由**：
1. **成熟稳定** - 高下载量（4.9M/周），被大量项目依赖
2. **功能完整** - 支持所有常见 Markdown 语法、语法高亮、表格、链接、Emoji
3. **易于使用** - 一行代码即可集成
4. **高度可定制** - 可通过 chalk 自定义所有样式
5. **许可证友好** - MIT 许可证
6. **Bun 兼容** - 最新版本是 ESM 格式
7. **生态好** - ink-markdown 底层就使用它

### 🥈 替代方案：ink + ink-markdown

**适用场景**：
- 需要构建交互式 CLI 应用
- 已经使用 React/组件化开发
- 需要复杂的状态管理和用户输入

### ❌ 不推荐

- **chalk 直接使用** - 工作量太大
- **marked + 自定义 renderer** - 不如用 marked-terminal
- **terminal-markdown** - 包不活跃，维护状态不明
- **cli-markdown** - GPL 许可证限制

---

## 最终建议实现

```typescript
// markdown-renderer.ts
import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import chalk from 'chalk';

export interface MarkdownRendererOptions {
  // 自定义配色主题
  headingColor?: string;
  boldColor?: string;
  linkColor?: string;
  codeColor?: string;
}

export function renderMarkdown(
  content: string,
  options?: MarkdownRendererOptions
): string {
  const defaultOptions = {
    code: chalk.yellow,
    blockquote: chalk.gray.italic,
    heading: chalk.green.bold,
    firstHeading: chalk.magenta.underline.bold,
    strong: chalk.bold,
    em: chalk.italic,
    codespan: chalk.magenta,
    link: chalk.blue.underline,
  };

  marked.use(markedTerminal(defaultOptions));
  return marked.parse(content) as string;
}

// Bun CLI 使用示例
if (import.meta.main) {
  const content = `
# Markdown 渲染测试

欢迎使用终端 Markdown 渲染器！

## 功能列表

- **粗体文本**
- *斜体文本*
- \`代码片段\`

\`\`\`typescript
const greeting = "Hello, Bun!";
console.log(greeting);
\`\`\`

> 这是一段引用文本

[点击链接](https://bun.sh)
`;

  console.log(renderMarkdown(content));
}
```

---

## 安装命令

```bash
# Bun 安装
bun add marked marked-terminal chalk

# 或 npm
npm install marked marked-terminal chalk
```

---

## 参考资源

- [marked-terminal GitHub](https://github.com/mikaelbr/marked-terminal)
- [chalk GitHub](https://github.com/chalk/chalk)
- [ink GitHub](https://github.com/vadimdemedes/ink)
- [ink-markdown npm](https://www.npmjs.com/package/ink-markdown)
- [marked npm](https://www.npmjs.com/package/marked)