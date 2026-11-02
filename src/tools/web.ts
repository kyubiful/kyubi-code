// Tools web: descargar una página (webfetch) y buscar en internet (websearch).
import TurndownService from 'turndown'
import { z } from 'zod'
import { defineTool, type AnyTool, type ToolContext } from '../core/tools.ts'

const TIMEOUT_MS = 30_000
const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
})
turndown.remove(['script', 'style', 'noscript', 'iframe', 'svg'])

export const webfetchTool = defineTool({
  name: 'webfetch',
  description: `Descarga una URL y devuelve su contenido. El HTML se convierte a Markdown.
Úsala para leer documentación o páginas que el usuario menciona.`,
  schema: z.object({
    url: z.url().describe('URL completa (http o https)'),
  }),
  // No modifica nada, pero envía datos fuera (la propia URL): se pregunta por dominio
  readOnly: false,
  permissionTarget: (input) => new URL(input.url).hostname,
  execute: async (input, ctx) => await executeWebFetch(input, ctx),
})

// Usa la API de Brave Search (tiene plan gratuito): https://brave.com/search/api/
// Se activa solo si existe la variable BRAVE_API_KEY.
export const websearchTool = defineTool({
  name: 'websearch',
  description: `Busca en internet y devuelve una lista de resultados (título, URL y resumen).
Después usa webfetch para leer los resultados que te interesen.`,
  schema: z.object({
    query: z.string().describe('Términos de búsqueda'),
    count: z.number().int().min(1).max(20).default(8),
  }),
  readOnly: true,
  execute: async (input, ctx) => await executeWebSearch(input, ctx),
})

export function webTools(): AnyTool[] {
  return process.env.BRAVE_API_KEY
    ? [webfetchTool, websearchTool]
    : [webfetchTool]
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '')
}

async function executeWebSearch(
  {
    query,
    count,
  }: {
    query: string
    count: number
  },
  ctx: ToolContext,
): Promise<string> {
  const url = new URL('https://api.search.brave.com/res/v1/web/search')
  url.search = new URLSearchParams({
    q: query,
    count: String(count),
  }).toString()
  const res = await fetch(url, {
    signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(TIMEOUT_MS)]),
    headers: {
      accept: 'application/json',
      'x-subscription-token': process.env.BRAVE_API_KEY ?? '',
    },
  })
  if (!res.ok)
    throw new Error(`Brave Search respondió ${res.status}: ${await res.text()}`)
  const data = (await res.json()) as {
    web?: { results?: { title: string; url: string; description?: string }[] }
  }
  const results = data.web?.results ?? []
  if (!results.length) return 'Sin resultados'
  return results
    .map(
      (r, i) =>
        `${i + 1}. ${r.title}\n   ${r.url}\n   ${stripTags(r.description ?? '')}`,
    )
    .join('\n\n')
}
async function executeWebFetch(
  { url }: { url: string },
  ctx: ToolContext,
): Promise<string> {
  const res = await fetch(url, {
    signal: AbortSignal.any([ctx.signal, AbortSignal.timeout(TIMEOUT_MS)]),
    headers: { 'user-agent': 'kyubi-code (+https://github.com)' },
    redirect: 'follow',
  })
  if (!res.ok)
    throw new Error(`${url} respondió ${res.status} ${res.statusText}`)
  const type = res.headers.get('content-type') ?? ''
  if (type.includes('text/html')) {
    return `# ${res.url}\n\n${turndown.turndown(await res.text())}`
  }
  if (
    type.startsWith('text/') ||
    type.includes('json') ||
    type.includes('xml')
  ) {
    return await res.text()
  }
  throw new Error(`Tipo de contenido no soportado: ${type || 'desconocido'}`)
}
