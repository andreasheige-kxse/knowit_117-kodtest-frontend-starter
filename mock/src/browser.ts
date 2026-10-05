import { setupWorker } from 'msw/browser'
import { chaos, handlers, reset, scenarios, clock } from './index.js'

/** Service worker for the browser. Start it before your app renders: await worker.start() */
export const worker = setupWorker(...handlers)

// In the browser, chaos mode is on from the start
chaos.set('mild')

// Handy when exploring in the devtools console: __mock.chaos.set('wild'), __mock.scenarios.sellOut() …
;(globalThis as Record<string, unknown>).__mock = { chaos, scenarios, reset, clock }

export * from './index.js'
