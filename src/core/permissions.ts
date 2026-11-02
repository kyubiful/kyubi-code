// Permisos: decide si una tool se ejecuta sin preguntar, se pregunta o se bloquea.
//
// Reglas en la config: "read", "bash(git *)", "edit(src/**)", "mcp__github__*".
// El `*` encaja con cualquier texto (también "/"). Orden de evaluación:
//   1. deny  → bloquea siempre
//   2. modo plan → bloquea todo lo que no sea de solo lectura
//   3. ask   → pregunta aunque otra regla lo permita
//   4. allow → permite
//   5. por defecto: solo lectura se permite; el resto se pregunta
//      (en modo acceptEdits, write/edit también se permiten)

import { updateConfigFile, type Config } from './config'
import type { AnyTool } from './tools'

export type PermissionMode = 'default' | 'acceptEdits' | 'plan'
export type PermissionRule = { tool: string; pattern?: string }
export type PermissionAnswer = 'allow_once' | 'allow_always' | 'deny'
export type Decision = 'allow' | 'ask' | 'deny'

export type PermissionRequest = {
  requestId: string
  toolName: string
  input: unknown
  target?: string // lo que devolvió permissionTarget
  respond(answer: PermissionAnswer): void
}

// Las tools que modifican archivos (para el modo acceptEdits)
const EDIT_TOOLS = new Set(['write', 'edit'])

export function parseRule(rule: string): PermissionRule {
  const match = /^([^(]+)\((.*)\)$/.exec(rule.trim())
  return match ? { tool: match[1]!, pattern: match[2]! } : { tool: rule.trim() }
}

export function formatRule(rule: PermissionRule): string {
  return rule.pattern === undefined
    ? rule.tool
    : `${rule.tool}(${rule.pattern})`
}

export function matchesRule(
  rule: PermissionRule,
  toolName: string,
  target?: string,
): boolean {
  if (!wildcard(rule.tool).test(toolName)) return false
  if (rule.pattern === undefined) return true
  return target !== undefined && wildcard(rule.pattern).test(target)
}

function wildcard(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replaceAll('*', '.*')
  return new RegExp(`^${escaped}$`)
}

export class Permissions {
  mode: PermissionMode
  private allow: PermissionRule[]
  private ask: PermissionRule[]
  private deny: PermissionRule[]

  constructor(
    config: Config['permissions'],
    // Dónde guardas las reglas de "permitir siempre" (config.local.json)
    private savePath?: string,
    // false = nadie puede responder (headless --no-interactive): "ask" se trata como "deny"
    readonly interactive = true,
  ) {
    this.mode = config.mode
    this.allow = config.allow.map(parseRule)
    this.ask = config.ask.map(parseRule)
    this.deny = config.deny.map(parseRule)
  }

  evaluate(tool: AnyTool, target?: string): Decision {
    const matches = (rules: PermissionRule[]) =>
      rules.some((rule) => matchesRule(rule, tool.name, target))

    if (matches(this.deny)) return 'deny'
    if (this.mode === 'plan' && !tool.readOnly) return 'deny'
    if (matches(this.ask)) return 'ask'
    if (matches(this.allow)) return 'allow'
    if (tool.readOnly) return 'allow'
    if (this.mode === 'acceptEdits' && EDIT_TOOLS.has(tool.name)) return 'allow'
    return 'ask'
  }

  async allowAlways(toolName: string, target?: string): Promise<void> {
    const rule: PermissionRule = { tool: toolName, pattern: target }
    this.allow.push(rule)
    if (this.savePath) {
      await updateConfigFile(this.savePath, {
        permissions: { allow: [formatRule(rule)] },
      })
    }
  }

  // Mensaje que recibe el modelo cuando no se ejecuta la tool
  denialMessage(tool: AnyTool, byUser: boolean): string {
    if (byUser) {
      return 'El usuario ha denegado el permiso para esta acción. No la repitas, si no está claro cómo seguir, pregunta al usuario.'
    }
    if (this.mode === 'plan' && !tool.readOnly) {
      return 'Estás en modo plan (solo lectura): no puedes modificar nada. Investiga y propón un plan.'
    }
    return 'Esta acción está bloqueada por la configuración de permisos.'
  }
}
