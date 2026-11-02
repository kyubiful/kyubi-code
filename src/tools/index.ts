import type { AnyTool } from '../core/tools'
import { bashTool } from './bash.ts'
import { editTool } from './edit.ts'
import { globTool } from './glob.ts'
import { grepTool } from './grep.ts'
import { readTool } from './read.ts'
import { writeTool } from './write.ts'

export function buildinTools(): AnyTool[] {
  return [bashTool, editTool, globTool, grepTool, readTool, writeTool]
}
