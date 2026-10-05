import type { BookingStatus } from './types.js'
import { clock, DAY, HOUR } from './runtime.js'

export interface EventRecord {
  id: string
  name: string
  venue: string
  startsAt: number
  saleStartsAt: number
  capacity: number
}

export interface BookingRecord {
  id: string
  eventId: string
  name: string
  email: string
  seats: number
  status: BookingStatus
  /** Order in which bookings arrived; decides waitlist order */
  seq: number
  createdAt: number
}

export interface StoredResponse {
  fingerprint: string
  status: number
  body: unknown
  headers: Record<string, string>
}

export const db = {
  events: new Map<string, EventRecord>(),
  bookings: new Map<string, BookingRecord>(),
  idempotency: new Map<string, StoredResponse>(),
  nextEvent: 1,
  nextBooking: 1,
}

export function addEvent(input: Omit<EventRecord, 'id'>): EventRecord {
  const event = { id: `evt-${db.nextEvent++}`, ...input }
  db.events.set(event.id, event)
  return event
}

export function addBookingRecord(
  input: Omit<BookingRecord, 'id' | 'seq' | 'createdAt'>,
): BookingRecord {
  const n = db.nextBooking++
  const booking = { id: `bkg-${n}`, seq: n, createdAt: clock.now(), ...input }
  db.bookings.set(booking.id, booking)
  return booking
}

function seedBookings(eventId: string, seatsList: number[], status: BookingStatus) {
  for (const seats of seatsList) {
    const n = db.nextBooking
    addBookingRecord({
      eventId,
      name: `Testperson ${n}`,
      email: `seed-${n}@example.com`,
      seats,
      status,
    })
  }
}

/** Seed data: a nearly full event, a sold-out event with a waitlist, one starting soon, one not on sale yet, and so on */
export function seed(): void {
  db.events.clear()
  db.bookings.clear()
  db.idempotency.clear()
  db.nextEvent = 1
  db.nextBooking = 1
  const now = clock.now()

  const nearlyFull = addEvent({
    name: 'Frontendfrukost: signals i praktiken',
    venue: 'Göteborg',
    startsAt: now + 10 * DAY,
    saleStartsAt: now - 5 * DAY,
    capacity: 40,
  })
  seedBookings(nearlyFull.id, [4, 4, 3, 4, 2, 4, 4, 3, 4, 2, 3], 'confirmed') // 37 of 40

  const meetup = addEvent({
    name: 'Nordic .NET Meetup',
    venue: 'Stockholm',
    startsAt: now + 14 * DAY,
    saleStartsAt: now - 10 * DAY,
    capacity: 120,
  })
  seedBookings(meetup.id, Array(20).fill(3), 'confirmed') // 60 of 120

  const soldOut = addEvent({
    name: 'Tillgänglighet på riktigt – workshop',
    venue: 'Malmö',
    startsAt: now + 7 * DAY,
    saleStartsAt: now - 14 * DAY,
    capacity: 20,
  })
  seedBookings(soldOut.id, [4, 4, 4, 4, 4], 'confirmed') // 20 of 20
  seedBookings(soldOut.id, [3, 1, 2], 'waitlisted')

  const startingSoon = addEvent({
    name: 'Kvällshack: testning med MSW',
    venue: 'Göteborg',
    startsAt: now + 30 * HOUR, // within 48 hours: cancellation is closed
    saleStartsAt: now - 7 * DAY,
    capacity: 30,
  })
  seedBookings(startingSoon.id, [2, 2, 4, 1, 3], 'confirmed')

  addEvent({
    name: 'AI-first i vardagen',
    venue: 'Stockholm',
    startsAt: now + 30 * DAY,
    saleStartsAt: now + 2 * DAY, // sale has not started
    capacity: 200,
  })

  const design = addEvent({
    name: 'Designsystemdagen',
    venue: 'Oslo',
    startsAt: now + 21 * DAY,
    saleStartsAt: now - 3 * DAY,
    capacity: 80,
  })
  seedBookings(design.id, [2, 3, 1, 4], 'confirmed')

  const security = addEvent({
    name: 'Säkerhetskväll: OWASP Top 10',
    venue: 'Helsingfors',
    startsAt: now + 3 * DAY,
    saleStartsAt: now - 20 * DAY,
    capacity: 50,
  })
  seedBookings(security.id, Array(8).fill(3), 'confirmed')

  const past = addEvent({
    name: 'Sommarkonferensen',
    venue: 'Göteborg',
    startsAt: now - 2 * DAY, // already started
    saleStartsAt: now - 60 * DAY,
    capacity: 150,
  })
  seedBookings(past.id, Array(30).fill(4), 'confirmed')
}
