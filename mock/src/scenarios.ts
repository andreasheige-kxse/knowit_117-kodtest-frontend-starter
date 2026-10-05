import { addBookingRecord, addEvent, db, seed } from './store.js'
import { clock, DAY, randomInt, HOUR } from './runtime.js'
import { freeSeats, toEvent } from './rules.js'
import { resetChaosRandomness } from './chaos.js'
import type { Event } from './types.js'

/** Restores the seed data, the mock's clock and the chaos randomness */
export function reset(): void {
  clock.reset()
  resetChaosRandomness()
  seed()
}

const VENUES = ['Göteborg', 'Stockholm', 'Malmö', 'Oslo', 'Helsingfors', 'Köpenhamn', 'Umeå', 'Linköping']
const TOPICS = ['React', 'Vue', 'Svelte', 'Tillgänglighet', 'Testning', 'Prestanda', 'Designsystem', 'TypeScript', 'CSS', 'Webbsäkerhet']
const FORMATS = ['frukost', 'meetup', 'workshop', 'kvällshack', 'konferens']

export const scenarios = {
  /** Sells out an event (the first one on sale by default) and adds two waitlisted bookings */
  sellOut(eventId?: string): Event {
    const now = clock.now()
    const event = eventId
      ? db.events.get(eventId)
      : [...db.events.values()].find((e) => e.saleStartsAt <= now && e.startsAt > now && freeSeats(e) > 0)
    if (!event) throw new Error('No event to sell out')
    let free = freeSeats(event)
    let n = 0
    while (free > 0) {
      const seats = Math.min(free, 4)
      n++
      addBookingRecord({ eventId: event.id, name: `Snabb köpare ${n}`, email: `rush-${event.id}-${n}@example.com`, seats, status: 'confirmed' })
      free -= seats
    }
    for (const seats of [2, 1]) {
      n++
      addBookingRecord({ eventId: event.id, name: `Snabb köpare ${n}`, email: `rush-${event.id}-${n}@example.com`, seats, status: 'waitlisted' })
    }
    return toEvent(event)
  },

  /** Adds an event whose sale opens in the given number of seconds (60 by default) */
  saleOpensSoon(seconds = 60): Event {
    const now = clock.now()
    const event = addEvent({
      name: 'Biljettsläpp: Frontendkonferensen',
      venue: 'Stockholm',
      startsAt: now + 45 * DAY,
      saleStartsAt: now + seconds * 1000,
      capacity: 300,
    })
    return toEvent(event)
  },

  /** Adds many events (1,000 by default), for testing performance and pagination */
  manyEvents(count = 1000): number {
    const now = clock.now()
    for (let i = 0; i < count; i++) {
      const topic = TOPICS[randomInt(0, TOPICS.length - 1)]
      const format = FORMATS[randomInt(0, FORMATS.length - 1)]
      const capacity = randomInt(2, 40) * 5
      const event = addEvent({
        name: `${topic}${format === 'konferens' ? 'konferensen' : '-' + format} #${i + 1}`,
        venue: VENUES[randomInt(0, VENUES.length - 1)],
        startsAt: now + randomInt(3, 180) * DAY + randomInt(8, 19) * HOUR,
        saleStartsAt: now - randomInt(0, 30) * DAY,
        capacity,
      })
      const taken = randomInt(0, capacity)
      let left = taken
      while (left > 0) {
        const seats = Math.min(left, randomInt(1, 4))
        addBookingRecord({ eventId: event.id, name: 'Testperson', email: `bulk-${event.id}-${left}@example.com`, seats, status: 'confirmed' })
        left -= seats
      }
    }
    return db.events.size
  },
}
