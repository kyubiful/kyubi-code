// Colores de la TUI en un solo sitio

export interface ThemeColors {
  accent: string
  user: string
  muted: string
  text: string
  warning: string
  error: string
  success: string
  border: string
  selected: string
  background: string // fondo general de la app
  backgroundPanel: string // paneles y recuadros (diálogos, cabecera)
  backgroundHighlight: string // elemento seleccionado o con foco
  foreground: string // texto principal
  foregroundDim: string // texto secundario, un paso por encima de `muted`
}

export const theme = {
  accent: '#7dcfff',
  user: '#9ece6a',
  muted: '#737aa2',
  text: '#c0caf5',
  warning: '#e0af68',
  error: '#f7768e',
  success: '#9ece6a',
  border: '#3b4261',
  background: '#1a1b26',
  backgroundPanel: '#16161e',
  backgroundHighlight: '#292e42',
  foreground: '#c0caf5',
  foregroundDim: '#a9b1d6',
  selected: '#bb9af7',
}
