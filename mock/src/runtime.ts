/** The mock API's notion of "now". Can be moved forward to test time-based rules. */
let offsetMs = 0

export const clock = {
  now: (): number => Date.now() + offsetMs,
  /** Moves the mock's clock forward, for example to let a sale open without waiting */
  advance(ms: number): void {
    offsetMs += ms
  },
  reset(): void {
    offsetMs = 0
  },
}

/** Seeded pseudo-random generator (mulberry32), so chaos sequences can be reproduced */
let state = 1

export function reseed(seed: number): void {
  state = seed >>> 0 || 1
}

export function random(): number {
  state = (state + 0x6d2b79f5) >>> 0
  let t = state
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

export function randomInt(min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1))
}

export const HOUR = 60 * 60 * 1000
export const DAY = 24 * HOUR
