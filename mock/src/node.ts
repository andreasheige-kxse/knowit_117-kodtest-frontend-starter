import { setupServer } from 'msw/node'
import { chaos, handlers } from './index.js'

/** Request interception for tests and server runtimes (SSR): server.listen() */
export const server = setupServer(...handlers)

// In Node, chaos mode starts off so tests are deterministic; turn it on with chaos.set()
chaos.set('off')

export * from './index.js'
