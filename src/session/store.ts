// Sesiones en JSONL: una línea JSON por entrada, solo se añade al final (append-only).
// Si el harness se cierra a mitad de escritura, como mucho se pierde la última línea.
//
// ~/.kyubi/projects/<proyecto>/<sessionId>.jsonl
import { appendFile, mkdir, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { kyubiHome, projectRoot } from '../core/paths'
import type { Task } from '../core/tasks'
import { newId, type Message } from '../core/types'
import type { SessionEntry, SessionEntryBody, SessionHeader } from './types'

export class SessionStore {
  private entries: SessionEntry[] = []
  private byId = new Map<string, SessionEntry>()
  private writing: Promise<unknown> = Promise.resolve()
  private writeError: unknown = null
  private created: boolean

  private constructor(
    readonly path: string,
    readonly header: SessionHeader,
    entries: SessionEntry[],
    created: boolean,
  ) {
    for (const entry of entries) this.index(entry)
    this.created = created
  }

  get id(): string {
    return this.header.sessionId
  }

  // La última entrada es la hoja de la rama activa
  get leafId(): string | null {
    return this.entries.at(-1)?.id ?? null
  }

  // Sessión nueva. El archivo no se crea hasta la primera entrada (así no quedan
  // sesiones vacías cada vez que abres y cierras el harness)
  static create(cwd: string, extra: Partial<SessionHeader> = {}): SessionStore {
    const sessionId = newId()
    const header: SessionHeader = {
      type: 'session',
      version: 1,
      sessionId,
      cwd,
      createdAt: new Date().toISOString(),
      ...extra,
    }
    return new SessionStore(
      join(sessionsDir(cwd), `${sessionId}.jsonl`),
      header,
      [],
      false,
    )
  }

  static async open(path: string): Promise<SessionStore> {
    const lines = (await Bun.file(path).text()).split('\n').filter(Boolean)
    const parsed: unknown[] = []
    for (const line of lines) {
      try {
        parsed.push(JSON.parse(line))
      } catch {
        // Línea rota: se ignora
      }
    }
    const [header, ...entries] = parsed as [SessionHeader, ...SessionEntry[]]
    if (header?.type !== 'session')
      throw new Error(`${path} no es una sesión del harness`)
    return new SessionStore(path, header, entries, true)
  }

  // Busca por id completo o por su comienzo (como los hashes de git)
  static async find(cwd: string, idOrPrefix: string): Promise<SessionStore> {
    const files = await listSessionFiles(cwd)
    const matches = files.filter((file) => file.id.startsWith(idOrPrefix))
    if (matches.length !== 1) {
      throw new Error(
        matches.length
          ? `Varias sesiones empiezan por ${idOrPrefix}`
          : `No existe la sesión ${idOrPrefix}`,
      )
    }
    return SessionStore.open(matches[0]!.path)
  }

  // La sesión más reciente del proyecto (--continue)
  static async latest(cwd: string): Promise<SessionStore | null> {
    const [newest] = await listSessionFiles(cwd)
    return newest ? SessionStore.open(newest.path) : null
  }

  append(body: SessionEntryBody): SessionEntry {
    const entry: SessionEntry = {
      id: body.type === 'message' ? body.message.id : newId(),
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
      ...body,
    }
    this.index(entry)
    const line = `${JSON.stringify(entry)}\n`
    // Las escrituras se encadenan para que nunca se mezclen ni se desordenen
    this.writing = this.writing
      .then(async () => {
        if (!this.created) {
          await mkdir(join(this.path, '..'), { recursive: true })
          await appendFile(this.path, `${JSON.stringify(this.header)}\n`)
          this.created = true
        }
        await appendFile(this.path, line)
      })
      // Un fallo de disco no debe tumbar el agente: se guarda y flush() lo lanza
      .catch((error) => {
        this.writeError = error
      })
    return entry
  }

  // Espera a que se hayan escrito todas las entradas (antes de salir, en tests...)
  async flush(): Promise<void> {
    await this.writing
    if (this.writeError) throw this.writeError
  }

  // Entradas de la rama activa, la raíz a la hoja
  branch(leafId: string | null = this.leafId): SessionEntry[] {
    const path: SessionEntry[] = []
    let current = leafId ? this.byId.get(leafId) : undefined
    while (current) {
      path.push(current)
      current = current.parentId ? this.byId.get(current.parentId) : undefined
    }
    return path.reverse()
  }

  // Los mensajes qeu hay que enviar al modelo
  messages(): Message[] {
    return this.branch().flatMap((entry) =>
      entry.type === 'message' ? [entry.message] : [],
    )
  }

  tasks(): Task[] {
    const last = this.branch().findLast((entry) => entry.type === 'tasks')
    return last?.type === 'tasks' ? last.tasks : []
  }

  all(): readonly SessionEntry[] {
    return this.entries
  }

  private index(entry: SessionEntry) {
    this.entries.push(entry)
    this.byId.set(entry.id, entry)
  }
}

export function sessionsDir(cwd: string): string {
  // "/home/yo/proyecto" -> "-home-yo-proyecto"
  const encoded = projectRoot(cwd).replace(/[^a-zA-Z0-9]/g, '-')
  return join(kyubiHome(), 'projects', encoded)
}

// Archivos de sesión del proyecto, del más reciente al más antiguo
export async function listSessionFiles(
  cwd: string,
): Promise<{ id: string; path: string; mtime: Date }[]> {
  const dir = sessionsDir(cwd)
  const names = await readdir(dir).catch(() => [] as string[])
  const files = await Promise.all(
    names
      .filter((name) => name.endsWith('.jsonl'))
      .map(async (name) => {
        const path = join(dir, name)
        return {
          id: name.slice(0, -'.jsonl'.length),
          path,
          mtime: (await stat(path)).mtime,
        }
      }),
  )
  return files.sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
}
