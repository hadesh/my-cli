import { readFile, writeFile, appendFile, mkdir } from 'fs/promises'
import { dirname } from 'path'
import type { ToolExecutor } from '../base.js'
import type { BuiltinToolDef } from '../../types/tool.js'

const readFileExecutor: ToolExecutor = {
  async execute(args: Record<string, string>): Promise<string> {
    const path = args['path']
    if (!path) throw new Error('缺少参数: path')
    const content = await readFile(path, 'utf-8')
    return content
  },
}

const writeFileExecutor: ToolExecutor = {
  async execute(args: Record<string, string>): Promise<string> {
    const path = args['path']
    const content = args['content']
    if (!path) throw new Error('缺少参数: path')
    if (content === undefined) throw new Error('缺少参数: content')
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, content, 'utf-8')
    return `文件已写入: ${path}`
  },
}

const appendFileExecutor: ToolExecutor = {
  async execute(args: Record<string, string>): Promise<string> {
    const path = args['path']
    const content = args['content']
    if (!path) throw new Error('缺少参数: path')
    if (content === undefined) throw new Error('缺少参数: content')
    await mkdir(dirname(path), { recursive: true })
    await appendFile(path, content, 'utf-8')
    return `内容已追加到: ${path}`
  },
}

export const readFileToolDef: BuiltinToolDef = {
  name: 'read_file',
  description: '读取本地文件内容',
  enabled: true,
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: '文件路径（绝对路径或相对路径）',
      },
    },
    required: ['path'],
  },
}

export const writeFileToolDef: BuiltinToolDef = {
  name: 'write_file',
  description: '将内容写入本地文件（覆盖写入），父目录不存在时自动创建',
  enabled: true,
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: '文件路径（绝对路径或相对路径）',
      },
      content: {
        type: 'string',
        description: '要写入的文件内容',
      },
    },
    required: ['path', 'content'],
  },
}

export const appendFileToolDef: BuiltinToolDef = {
  name: 'append_file',
  description: '将内容追加到本地文件末尾，父目录不存在时自动创建',
  enabled: true,
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: '文件路径（绝对路径或相对路径）',
      },
      content: {
        type: 'string',
        description: '要追加的内容',
      },
    },
    required: ['path', 'content'],
  },
}

export const readFileExecutorExport = readFileExecutor
export const writeFileExecutorExport = writeFileExecutor
export const appendFileExecutorExport = appendFileExecutor
