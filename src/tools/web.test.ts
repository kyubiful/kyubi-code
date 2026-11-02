import { afterAll, expect, test } from 'bun:test'
import { ToolRegistry } from '../core/tools.ts'
import { webfetchTool } from './web.ts'

// Servidor local: los tests no dependen de internet
const server = Bun.serve({
  port: 0,
  routes: {
    '/doc': () =>
      new Response(
        '<html><head><style>.x{}</style><script>alert(1)</script></head><body><h1>Título</h1><p>Hola <b>mundo</b></p></body></html>',
        { headers: { 'content-type': 'text/html' } },
      ),
    '/data.json': () => Response.json({ ok: true }),
    '/missing': () => new Response('no', { status: 404 }),
  },
})
afterAll(() => server.stop())

const tools = new ToolRegistry([webfetchTool])
const ctx = { cwd: '.', signal: new AbortController().signal, agentId: 'test' }
const fetchUrl = (path: string) =>
  tools.run('webfetch', { url: `${server.url}${path.slice(1)}` }, ctx)

test('convierte HTML a Markdown sin scripts ni estilos', async () => {
  const result = await fetchUrl('/doc')
  expect(result.isError).toBe(false)
  expect(result.content).toContain('# Título')
  expect(result.content).toContain('Hola **mundo**')
  expect(result.content).not.toContain('alert')
})

test('devuelve JSON tal cual', async () => {
  expect((await fetchUrl('/data.json')).content).toBe('{"ok":true}')
})

test('un 404 es un error', async () => {
  expect((await fetchUrl('/missing')).content).toContain('404')
})

test('el permiso se pide por dominio', () => {
  expect(
    webfetchTool.permissionTarget!({ url: 'https://docs.bun.sh/api/http' }),
  ).toBe('docs.bun.sh')
})
