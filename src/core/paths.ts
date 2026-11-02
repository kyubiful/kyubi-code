// Rutas del harness. HOME permite usar otra carpeta (los tests la usan)
// para no tocar tu path real

import { homedir } from 'node:os'
import { join } from 'node:path'

export function kyubiHome(): string {
  return process.env.KYUBI_HOME ?? join(homedir(), '.kyubi')
}

// Raíz del proyecto: la del repo git si lo hay: si no, el propio cwd.
// Así .kyubi/ se encuentra aunque ejecutes kyubi desde una subcarpeta
export function projectRoot(cwd: string): string {
  const git = Bun.spawnSync(['git', 'rev-parse', '--show-toplevel'], {
    cwd,
    stdout: 'pipe',
    stderr: 'ignore',
  })
  return git.exitCode === 0 ? git.stdout.toString().trim() : cwd
}

// Carpeta .kyubi del proyecto (agents/, commands/, skills/, config.json...)
export function projectDir(cwd: string): string {
  return join(projectRoot(cwd), '.kyubi')
}
