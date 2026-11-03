// Se carga antes de los tests (ver bunfig.toml). Todos los tests usan un
// ~/.kyubi temporal, así nunca tocan tus sesiones ni tu configuración local
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.KYUBI_HOME = mkdtempSync(join(tmpdir(), 'kyubi-home-'))
