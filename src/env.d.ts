// Declaraciones para módulos que no traen tipos

// Scriot de @opentui/solid que registra el plugin de JSX (ver src/cli.ts)
declare module '@opentui/solid/preload'

// Bun permite importar archivos de texto: import prompt from './x.md' with { type: 'text' }
declare module '*.md' {
  const content: string
  export default content
}
