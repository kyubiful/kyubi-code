// Credenciales guardadas en ~/.kyubi/auth.json (con permisos 600: solo tu usuario)
import { chmod, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { kyubiHome } from './paths'

export type Credential =
  | {
      type: 'oauth'
      accessToken: string
      refreshToken: string
      expiresAt: number // epoch ms
      accountId?: string
    }
  | { type: 'api'; key: string }

type AuthFile = Record<string, Credential>

function authPath(): string {
  return join(kyubiHome(), 'auth.json')
}

async function readAll(): Promise<AuthFile> {
  const file = Bun.file(authPath())
  return (await file.exists()) ? await file.json() : {}
}

async function writeAll(data: AuthFile): Promise<void> {
  const path = authPath()
  await mkdir(dirname(path), { recursive: true })
  await Bun.write(path, JSON.stringify(data, null, 2))
  await chmod(path, 0o600)
}

export async function getCredential(
  provider: string,
): Promise<Credential | undefined> {
  return (await readAll())[provider]
}

export async function setCredential(provider: string, credential: Credential) {
  await writeAll({ ...(await readAll()), [provider]: credential })
}

export async function removeCredential(provider: string): Promise<boolean> {
  const data = await readAll()
  if (!(provider in data)) return false
  delete data[provider]
  await writeAll(data)
  return true
}
