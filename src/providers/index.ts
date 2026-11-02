// Registro de providers: el resto del código pide un provider por su id
import type { Provider } from '../core/provider'
import { MockProvider } from './mock'
import { OpenAIProvider } from './openai/index'

export const providerIds = ['mock', 'openai'] as const

export function createProvider(id: string): Provider {
  switch (id) {
    case 'mock':
      return new MockProvider(undefined, 20)
    case 'openai':
      return new OpenAIProvider()
    default:
      throw new Error(
        `Provider desconocido: ${id}. Disponibles: ${providerIds.join(', ')}`,
      )
  }
}

// Login/Logout por provider
export async function loginProvider(
  id: string,
  print: (text: string) => void = console.log,
): Promise<void> {
  switch (id) {
    case 'openai': {
      const { login } = await import('./openai/auth')
      return login(print)
    }
    default:
      throw new Error(`El provider "${id}" no tiene login`)
  }
}
