// Login con tu cuenta de ChatGPT (Plus/Pro), el mismo flujo OAuth que usa Codex CLI
//
// OAuth 2.0 con PKCE, paso a paso:
// 1. Generamos un secreto aleatorio (code_verifier) y su hash (code_challenge).
// 2. Abrimos el navegador en la página de login de OpenAI con el challenge.
// 3. Tras el login, OpenAI redirige a http://localhost:1455/auth/callback?code=...
//    donde nuestro servidor local recoge el `code`.
// 4. Canjeamos code + verifier por tokens. Como solo nosotros conocemos el verifier,
//    nadie que intercepte el `code` puede canjearlo.
//

import {
  getCredential,
  setCredential,
  type Credential,
} from '../../core/auth-store'
import { ProviderError } from '../../core/provider'

const ISSUER = 'https://auth.openai.com'
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann' // client id público de Codex CLI
const PORT = 1455 // el redirect registrado para ese client id usa este puerto
const REDIRECT_URI = `http://localhost:${PORT}/auth/callback`
export const AUTH_KEY = 'openai'

type OAuthCredential = Extract<Credential, { type: 'oauth' }>

type TokenResponse = {
  id_token?: string
  access_token: string
  refresh_token?: string
  expires_in?: number
}

export async function login(
  print: (text: string) => void = console.log,
): Promise<void> {
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)))
  const challenge = base64url(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)),
    ),
  )
  const state = base64url(crypto.getRandomValues(new Uint8Array(16)))

  const url = new URL(`${ISSUER}/oauth/authorize`)
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'openid profile email offline_access',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true',
    state,
    originator: 'codex_cli_rs',
  }).toString()

  const {
    promise: codePromise,
    resolve,
    reject,
  } = Promise.withResolvers<string>()
  const server = Bun.serve({
    port: PORT,
    hostname: '127.0.0.1',
    routes: {
      '/auth/callback': (req) => {
        const params = new URL(req.url).searchParams
        const code = params.get('code')
        if (params.get('state') !== state || !code) {
          reject(
            new Error('Respuesta de login inválida (state o code incorrecto)'),
          )
          return new Response('Login inválido', { status: 400 })
        }
        resolve(code)
        return new Response(
          '<h1>Login completado</h1><p>Ya puedes volver a la terminal.</p>',
          { headers: { 'content-type': 'text/html; charset=utf-8' } },
        )
      },
    },
    fetch: () => new Response('Not found', { status: 404 }),
  })

  print(`Abre esta URL para iniciar sesión:\n\n${url}\n`)
  openBrowser(url.toString())

  const timeout = setTimeout(
    () => reject(new Error('Tiempo de espera agotado (5 min)')),
    5 * 60_000,
  )
  try {
    const code = await codePromise
    const tokens = await tokenRequest(
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        code_verifier: verifier,
      }),
    )
    await setCredential(AUTH_KEY, toCredential(tokens))
  } finally {
    clearTimeout(timeout)
    server.stop()
  }
}

// Devuelve un access token válido, refrescándolo si está a punto de caducar
export async function getAccessToken(force = false): Promise<OAuthCredential> {
  const credential = await getCredential(AUTH_KEY)
  if (credential?.type !== 'oauth') {
    throw new ProviderError(
      'No has iniciado sesión en OpenAI. Ejecuta: kyubi login openai',
      'auth',
      false,
    )
  }

  const expiresSoon = credential.expiresAt - Date.now() < 5 * 60_000
  if (!force && !expiresSoon) return credential

  const tokens = await tokenRequest(
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: credential.refreshToken,
      client_id: CLIENT_ID,
      scope: 'openid profile email',
    }),
  )

  // El refresh token rota: hay que guardar el nuevo
  const updated = toCredential(tokens, credential)
  await setCredential(AUTH_KEY, updated)
  return updated
}

async function tokenRequest(body: URLSearchParams): Promise<TokenResponse> {
  const res = await fetch(`${ISSUER}/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) {
    throw new ProviderError(
      `Error de OAuth (${res.status}): ${await res.text()}. Prueba: kyubi login openai`,
      'auth',
      false,
    )
  }
  return (await res.json()) as TokenResponse
}

function toCredential(
  tokens: TokenResponse,
  previous?: OAuthCredential,
): OAuthCredential {
  const claims = tokens.id_token ? decodeJwt(tokens.id_token) : {}
  const auth = claims['https://api.openai.com/auth'] as
    { chatgpt_account_id?: string } | undefined

  // Si no viene expires_in, se usa el `exp` del propio access token (es un JWT)
  const exp = decodeJwt(tokens.access_token).exp
  const expiresAt = tokens.expires_in
    ? Date.now() + tokens.expires_in * 1000
    : typeof exp === 'number'
      ? exp * 1000
      : Date.now() + 3600_000

  return {
    type: 'oauth',
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? previous?.refreshToken ?? '',
    expiresAt,
    accountId: auth?.chatgpt_account_id ?? previous?.accountId,
  }
}

// Un JWT son tres partes de base64url separadas por puntos; la segunda son los claims.
// No verificamos la firma: solo leemos los datos de un token que nos acaba de dar OpenAI
export function decodeJwt(token: string): Record<string, unknown> {
  try {
    return JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString(),
    )
  } catch {
    return {}
  }
}

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url')
}

function openBrowser(url: string) {
  const command =
    process.platform === 'darwin'
      ? ['open', url]
      : process.platform === 'win32'
        ? ['cmd', '/c', 'start', '', url]
        : ['xdg-open', url]

  try {
    Bun.spawn(command, { stdout: 'ignore', stderr: 'ignore' })
  } catch {
    // Sin navegador (SSH...): el usuario copia la URL a mano
  }
}
