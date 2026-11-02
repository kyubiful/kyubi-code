// Tool mock para probar el loop
import { z } from 'zod'
import { defineTool } from '../core/tools'

export const echoTool = defineTool({
  name: 'echo',
  description: 'Devuelve el texto que recibe. Úsala solo para pruebas.',
  schema: z.object({ text: z.string().describe('Texto a devolver') }),
  readOnly: true,
  async execute(input) {
    return input.text
  },
})
