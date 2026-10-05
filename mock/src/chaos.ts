import type { ChaosConfig, ChaosPreset } from './types.js'
import { clock, random, randomInt, reseed } from './runtime.js'
import { db } from './store.js'
import { cancelBooking, createBooking, freeSeats } from './rules.js'

const PRESETS: Record<ChaosPreset, Omit<ChaosConfig, 'seed'>> = {
  off: { latency: [0, 0], errorRate: 0, dropRate: 0, reorder: false, offline: false, simulatedBuyers: false },
  mild: { latency: [150, 700], errorRate: 0.05, dropRate: 0.03, reorder: true, offline: false, simulatedBuyers: true },
  wild: { latency: [300, 2500], errorRate: 0.15, dropRate: 0.08, reorder: true, offline: false, simulatedBuyers: true },
}

let config: ChaosConfig = { ...PRESETS.off, seed: 1 }

export interface ChaosPlan {
  offline: boolean
  latencyMs: number
  fail: boolean
  drop: boolean
}

/** Decides, per request, what chaos mode does with it */
export function planRequest(): ChaosPlan {
  const [min, max] = config.latency
  let latencyMs = max > 0 ? randomInt(min, max) : 0
  if (config.reorder && random() < 0.3) latencyMs += randomInt(300, 1500)
  return {
    offline: config.offline,
    latencyMs,
    fail: random() < config.errorRate,
    drop: random() < config.dropRate,
  }
}

// ---- Simulated buyers -----------------------------------------------------

let buyersTimer: ReturnType<typeof setInterval> | undefined
let buyerCount = 0
const BUYER_INTERVAL_MS = 4000

export function simulateBuyersOnce(): void {
  const now = clock.now()
  const onSale = [...db.events.values()].filter((e) => e.saleStartsAt <= now && e.startsAt > now)
  if (!onSale.length) return
  const event = onSale[randomInt(0, onSale.length - 1)]

  const ownBookings = [...db.bookings.values()].filter(
    (b) => b.eventId === event.id && b.status !== 'cancelled' && b.email.startsWith('buyer-'),
  )
  if (ownBookings.length && random() < 0.3) {
    cancelBooking(ownBookings[randomInt(0, ownBookings.length - 1)].id)
    return
  }
  if (freeSeats(event) === 0 && random() < 0.7) return
  const n = ++buyerCount
  createBooking(event.id, { name: `Köpare ${n}`, email: `buyer-${n}@example.com`, seats: randomInt(1, 2) })
}

function syncBuyers(): void {
  if (config.simulatedBuyers && !buyersTimer) {
    buyersTimer = setInterval(simulateBuyersOnce, BUYER_INTERVAL_MS)
    // Do not keep a Node process (tests, SSR) alive just for the buyers
    ;(buyersTimer as { unref?: () => void }).unref?.()
  } else if (!config.simulatedBuyers && buyersTimer) {
    clearInterval(buyersTimer)
    buyersTimer = undefined
  }
}

// ---- Public API -----------------------------------------------------------

export const chaos = {
  /** Applies a preset ('off', 'mild', 'wild') or changes individual settings */
  set(update: ChaosPreset | Partial<ChaosConfig>): ChaosConfig {
    if (typeof update === 'string') {
      config = { ...PRESETS[update], seed: config.seed }
    } else {
      config = { ...config, ...update }
      if (update.seed !== undefined) reseed(update.seed)
    }
    syncBuyers()
    return chaos.get()
  },
  get(): ChaosConfig {
    return { ...config, latency: [...config.latency] as [number, number] }
  },
}

export function resetChaosRandomness(): void {
  reseed(config.seed)
  buyerCount = 0
}
