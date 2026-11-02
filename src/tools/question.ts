import { z } from 'zod'
import { defineTool } from '../core/tools.ts'
import type { ToolContext } from '../core/tools.ts'
import type { Question } from '../core/questions.ts'

export const questionTool = defineTool({
  name: 'question',
  description: `Hace una o varias preguntas de opción múltiple al usuario y espera su respuesta.
Úsala cuando necesites una decisión que solo el usuario puede tomar (requisitos ambiguos,
elegir entre enfoques con trade-offs reales).
NO la uses para:
- cosas que puedes averiguar leyendo el código o la configuración del proyecto;
- decisiones con un default razonable: elige tú y explica por qué;
- pedir permiso para continuar.
El usuario siempre puede responder con texto libre ("Otro"), no hace falta que lo añadas.`,
  schema: z.object({
    questions: z
      .array(
        z.object({
          question: z.string().describe('La pregunta completa'),
          header: z
            .string()
            .max(20)
            .describe('Etiqueta muy corta (máx. 20 caracteres)'),
          options: z
            .array(
              z.object({
                label: z.string().describe('Texto de la opción (1-5 palabras)'),
                description: z
                  .string()
                  .optional()
                  .describe('Qué implica elegirla'),
              }),
            )
            .min(2)
            .max(4),
          multiSelect: z.boolean().default(false),
        }),
      )
      .min(1)
      .max(4),
  }),
  readOnly: true,
  execute: async (params, ctx) => await executeQuestion(params, ctx),
})

async function executeQuestion(
  { questions }: { questions: Question[] },
  ctx: ToolContext,
): Promise<string> {
  if (!ctx.ask) {
    throw new Error(
      'No hay nadie para responder (modo no interactivo). Decide tú y explica por qué.',
    )
  }
  const answers = await ctx.ask.question(questions)
  if (!answers) throw new Error('El usuario ha cancelado la pregunta')
  return answers
    .map((answer) => {
      const chosen = [
        ...answer.selected,
        ...(answer.other ? [answer.other] : []),
      ]
      return `"${answer.question}" → ${chosen.join(', ') || '(sin respuesta)'}`
    })
    .join('\n')
}
