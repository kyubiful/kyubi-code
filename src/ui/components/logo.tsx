import { theme } from '../theme'
const HEADER = `██╗  ██╗██╗   ██╗██╗   ██╗██████╗ ██╗███████╗██╗   ██╗██╗     
██║ ██╔╝╚██╗ ██╔╝██║   ██║██╔══██╗██║██╔════╝██║   ██║██║     
█████╔╝  ╚████╔╝ ██║   ██║██████╔╝██║█████╗  ██║   ██║██║     
██╔═██╗   ╚██╔╝  ██║   ██║██╔══██╗██║██╔══╝  ██║   ██║██║     
██║  ██╗   ██║   ╚██████╔╝██████╔╝██║██║     ╚██████╔╝███████╗
╚═╝  ╚═╝   ╚═╝    ╚═════╝ ╚═════╝ ╚═╝╚═╝      ╚═════╝ ╚══════╝`

export function Logo() {
  return (
    <box
      flexDirection="column"
      flexShrink={0}
      alignItems="center"
      padding={1}
      width="100%"
    >
      <text fg={theme.accent}>{HEADER}</text>
    </box>
  )
}
