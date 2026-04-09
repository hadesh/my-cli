CLI 工程开发指南
1. 先定义你的 CLI 目标
在开始写代码前，先明确这 4 件事：

1) 这个 CLI 解决什么问题
例如：

调用某个 SaaS API
管理某类资源
处理文件/文本/多媒体
提供 AI 能力入口
给开发者做自动化工具
2) 谁会使用
终端用户
开发者
自动化脚本
Agent / Bot
3) 交互模式
你的 CLI 是否需要：

纯命令行参数
交互式提问
流式输出
JSON 输出供管道处理
非交互批处理模式
4) 核心能力范围
建议先只做 3 类能力：

基础命令：init / config / help
业务命令：真正核心功能
账号/鉴权命令：login / logout / status
2. 推荐的总体架构
推荐采用下面这种结构：

Text
src/
├── main.ts
├── registry.ts
├── command.ts
├── args.ts
├── config/
│   ├── loader.ts
│   ├── schema.ts
│   └── paths.ts
├── auth/
│   ├── credentials.ts
│   ├── resolver.ts
│   └── setup.ts
├── client/
│   ├── http.ts
│   └── endpoints.ts
├── commands/
│   ├── auth/
│   ├── config/
│   ├── core/
│   └── ...
├── output/
│   ├── formatter.ts
│   ├── text.ts
│   ├── json.ts
│   └── progress.ts
├── errors/
│   ├── base.ts
│   ├── codes.ts
│   └── handler.ts
├── types/
│   ├── flags.ts
│   └── api.ts
└── utils/
    ├── env.ts
    ├── prompt.ts
    ├── fs.ts
    └── token.ts
3. 项目分层建议
3.1 入口层：main.ts
职责：

读取 process.argv
处理 --help / --version
解析命令路径
加载配置
做认证兜底
执行命令
统一错误处理
建议原则
main.ts 只做调度，不写业务
不要把某个命令的细节写进入口
3.2 命令注册层：registry.ts
职责：

注册所有命令
支持多级命令：auth login、config set
解析命令名
输出命令帮助
支持列出全部命令
推荐设计
用树结构管理命令：

ts
type CommandNode = {
  command?: Command;
  children: Map<string, CommandNode>;
};
这样以后加子命令会很自然。

3.3 命令定义层：command.ts
统一定义命令规范：

ts
export interface Command {
  name: string;
  description: string;
  usage?: string;
  options?: OptionDef[];
  examples?: string[];
  execute(config: Config, flags: GlobalFlags): Promise<void>;
}
好处
所有命令结构统一
帮助文档可自动生成
schema 导出更容易
未来可以自动生成 OpenAPI / tool schema
3.4 配置层：config/
职责：

读取 config 文件
合并 env / flags / 本地配置
校验配置合法性
提供全局运行时上下文
推荐优先级
命令行参数
环境变量
配置文件
默认值
建议用 Zod
例如：

ts
import { z } from 'zod';

export const configSchema = z.object({
  apiKey: z.string().optional(),
  baseUrl: z.string().url().optional(),
  region: z.enum(['global', 'cn']).default('global'),
  output: z.enum(['text', 'json']).default('text'),
  timeout: z.number().positive().default(300),
});
3.5 鉴权层：auth/
如果你的 CLI 需要访问 API，强烈建议单独做一层。

职责：

保存/读取 token
支持 API key / OAuth / JWT
提供 resolveCredential
提供 ensureCredential
建议分工
credentials.ts：本地凭据读写
resolver.ts：解析当前可用凭据
setup.ts：缺失时交互式补全
设计原则
命令层不要直接操心 token 存哪儿
统一从 config + credentials + env 中解析
3.6 API 客户端层：client/
职责：

统一请求封装
统一 header、超时、错误处理
支持 JSON 请求、流式请求
建议
把所有 HTTP 逻辑都封装在这里：

ts
export async function requestJson<T>(config: Config, options: RequestOptions): Promise<T> {
  // 处理 baseUrl、headers、timeout、auth
}
好处
以后你改 API 协议时，只改这一层。

3.7 输出层：output/
这是 CLI 体验最重要的部分之一。

职责：

text / json 输出
表格输出
彩色输出
progress 输出
音频/文件输出
quiet 模式输出
建议支持的输出模式
text
json
quiet
table
stream
约定
业务命令不要直接乱 console.log，尽量统一通过输出工具。

3.8 错误层：errors/
职责：

定义统一错误类型
定义退出码
统一错误处理格式
推荐结构
base.ts：CLIError
codes.ts：退出码枚举
handler.ts：顶层错误输出
示例
ts
export enum ExitCode {
  SUCCESS = 0,
  GENERAL = 1,
  USAGE = 2,
  AUTH = 3,
}
4. CLI 命令设计规范
4.1 命令命名
建议使用：

一级分组：auth、config、file
二级动作：login、set、list
例如：

mycli auth login
mycli config set
mycli file upload
4.2 选项命名
建议统一：

长参数：--my-option
多词参数：--base-url
尽量不要随意混用驼峰和短横线
解析后字段
尽量统一成 camelCase：

--base-url → flags.baseUrl
--file-id → flags.fileId
4.3 每个命令都要有这些字段
建议每个命令至少包含：

ts
{
  name,
  description,
  usage,
  options,
  examples,
  execute
}
4.4 命令实现原则
每个命令只做四件事：

校验参数
组装请求/业务输入
调用 client/service
格式化输出
不要把：

配置加载
token 处理
输出格式
错误分类
写在命令里。

5. 推荐的开发流程
5.1 第一步：搭基础骨架
先实现：

main.ts
command.ts
registry.ts
errors/
config/
一个简单 hello 命令
5.2 第二步：做统一参数与配置
先把下面几个能力打通：

--help
--version
--output
--quiet
--dry-run
config 文件读写
5.3 第三步：做一个最小业务闭环
例如：

login
status
list
get
把“登录 → 请求 → 输出”流程跑通。

5.4 第四步：补交互式体验
加入：

prompt
自动补参
缺失参数提示
确认输入
5.5 第五步：补测试
重点测试：

参数解析
配置合并
认证解析
命令路由
输出格式
6. 推荐的工程规范
6.1 TypeScript
开启 strict
禁止滥用 any
命令、配置、API 响应都要定义类型
6.2 ESM
全项目统一 ESM
import/export 保持一致
6.3 文件命名
文件：kebab-case.ts
命令：按目录分组
6.4 错误处理
所有命令抛出的错误尽量统一为 CLIError
顶层由 handleError 接管
6.5 输出规范
非必要不要直接 console.log
可脚本化输出优先 JSON
人类阅读优先 text/table
7. 推荐的最小命令集合
如果你要做自己的 CLI，我建议从这几个命令开始：

基础命令
help
version
config show
config set
认证命令
auth login
auth logout
auth status
业务命令
list
get
create
delete
高级能力
export-schema
sync
watch
batch
8. 推荐的 CLI 运行时上下文
建议统一一个 Config 类型，例如：

ts
export interface Config {
  apiKey?: string;
  baseUrl: string;
  region: 'global' | 'cn';
  output: 'text' | 'json';
  timeout: number;
  quiet: boolean;
  verbose: boolean;
  dryRun: boolean;
  nonInteractive: boolean;
}
这样每个 command 都拿同一个上下文，代码会非常整洁。

9. 推荐的项目初始化方案
你可以这样起步：

bash
mkdir my-cli
cd my-cli
bun init
然后安装基础依赖：

typescript
zod
@clack/prompts
commander 或自己写 parser
tsx 或 Bun 直接运行
eslint
prettier
bun:test
如果你想走更像这个项目的路线，建议：

自己写轻量命令系统
不依赖太重的 CLI 框架
用 TypeScript + Bun 原生能力完成主要逻辑
10. 你可以直接采用的目录模板
Text
my-cli/
├── src/
│   ├── main.ts
│   ├── registry.ts
│   ├── command.ts
│   ├── args.ts
│   ├── config/
│   │   ├── loader.ts
│   │   ├── schema.ts
│   │   └── paths.ts
│   ├── auth/
│   │   ├── credentials.ts
│   │   ├── resolver.ts
│   │   └── setup.ts
│   ├── client/
│   │   ├── http.ts
│   │   └── endpoints.ts
│   ├── commands/
│   │   ├── auth/
│   │   ├── config/
│   │   └── core/
│   ├── output/
│   │   ├── formatter.ts
│   │   └── text.ts
│   ├── errors/
│   │   ├── base.ts
│   │   ├── codes.ts
│   │   └── handler.ts
│   ├── types/
│   └── utils/
├── test/
├── package.json
├── tsconfig.json
└── README.md
11. 最重要的设计建议
如果你只记住 5 条，请记住这 5 条：

入口只做调度，不写业务
命令只做输入输出转换，不碰全局细节
配置、认证、输出、错误都要抽层
所有命令都要统一接口
先做最小闭环，再逐步扩展