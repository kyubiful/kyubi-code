// Deshace cambios de archivos. Cada write/edit guarda una entrada 'checkpoint'
// con el contenido previo del archivo. El rewind las recorre al revés y lo restaura.
// Limitación: lo que haga `bash` (rm, mv, sed...) no se queda registrado
import { rm } from 'node:fs/promises'
import type { FileChange } from '../core/tools'
import type { SessionEntry } from './types'

export type Checkpoint = { messageId: string; changes: FileChange[] }

export type RewindMode = 'conversation' | 'code' | 'both'

// Checkpoints de la rama que están DESPUÉS de la entrada `entryId`
export function checkpointsAfter(
  branch: SessionEntry[],
  entryId: string,
): Checkpoint[] {
  const index = branch.findIndex((entry) => entry.id === entryId)
  return branch
    .slice(index + 1)
    .flatMap((entry) => (entry.type === 'checkpoint' ? [entry] : []))
    .map(({ messageId, changes }) => ({ messageId, changes }))
}

// Restaura los archivos, del cambio más nuevo al más antiguo. Devuelve las rutas tocadas
export async function restoreCheckpoints(
  checkpoint: Checkpoint[],
): Promise<string[]> {
  const changes = checkpoint
    .flatMap((checkpoint) => checkpoint.changes)
    .reverse()
  for (const change of changes) {
    if (change.before === null)
      await rm(change.path, { force: true }) // No existía
    else await Bun.write(change.path, change.before)
  }
  return [...new Set(changes.map((change) => change.path))]
}
