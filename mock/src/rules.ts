import type { Booking, CreateBookingRequest, ErrorCode, Event, ProblemDetails } from './types.js'
import { addBookingRecord, db, type BookingRecord, type EventRecord } from './store.js'
import { clock, HOUR } from './runtime.js'

export const MAX_SEATS_PER_BOOKING = 4
export const MAX_SEATS_PER_EMAIL = 4
export const CANCELLATION_CLOSES_BEFORE_START_MS = 48 * HOUR

type Result<T> = { ok: true; value: T } | { ok: false; problem: ProblemDetails }

const TITLES: Record<ErrorCode, string> = {
  VALIDATION_FAILED: 'One or more fields are invalid.',
  NOT_FOUND: 'The resource was not found.',
  SALE_NOT_STARTED: 'The sale has not started.',
  EVENT_STARTED: 'The event has already started.',
  EMAIL_LIMIT_REACHED: 'The email address has reached its seat limit for this event.',
  CANCELLATION_CLOSED: 'Cancellation is closed for this event.',
  ALREADY_CANCELLED: 'The booking is already cancelled.',
  IDEMPOTENCY_KEY_REUSED: 'The Idempotency-Key was already used for a different request.',
  SERVICE_UNAVAILABLE: 'The service is temporarily unavailable.',
}

export function problem(
  status: number,
  code: ErrorCode,
  detail?: string,
  errors?: Record<string, string[]>,
): ProblemDetails {
  return {
    type: `https://kodtest.example/problems/${code.toLowerCase().replaceAll('_', '-')}`,
    title: TITLES[code],
    status,
    ...(detail ? { detail } : {}),
    code,
    ...(errors ? { errors } : {}),
  }
}

const fail = (p: ProblemDetails) => ({ ok: false as const, problem: p })

// ---- Derived values -------------------------------------------------------

function bookingsFor(eventId: string): BookingRecord[] {
  return [...db.bookings.values()].filter((b) => b.eventId === eventId)
}

export function confirmedSeats(eventId: string): number {
  return bookingsFor(eventId)
    .filter((b) => b.status === 'confirmed')
    .reduce((sum, b) => sum + b.seats, 0)
}

export function freeSeats(event: EventRecord): number {
  return Math.max(0, event.capacity - confirmedSeats(event.id))
}

function waitlist(eventId: string): BookingRecord[] {
  return bookingsFor(eventId)
    .filter((b) => b.status === 'waitlisted')
    .sort((a, b) => a.seq - b.seq)
}

export function toEvent(e: EventRecord): Event {
  const confirmed = confirmedSeats(e.id)
  return {
    id: e.id,
    name: e.name,
    venue: e.venue,
    startsAt: new Date(e.startsAt).toISOString(),
    saleStartsAt: new Date(e.saleStartsAt).toISOString(),
    capacity: e.capacity,
    confirmedSeats: confirmed,
    freeSeats: Math.max(0, e.capacity - confirmed),
    waitlistedBookings: waitlist(e.id).length,
  }
}

export function toBooking(b: BookingRecord): Booking {
  const position = b.status === 'waitlisted' ? waitlist(b.eventId).findIndex((w) => w.id === b.id) + 1 : null
  return {
    id: b.id,
    eventId: b.eventId,
    name: b.name,
    email: b.email,
    seats: b.seats,
    status: b.status,
    waitlistPosition: position,
    createdAt: new Date(b.createdAt).toISOString(),
  }
}

// ---- Validation -----------------------------------------------------------

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validateBooking(input: unknown): Record<string, string[]> | null {
  const errors: Record<string, string[]> = {}
  const body = (typeof input === 'object' && input !== null ? input : {}) as Partial<CreateBookingRequest>

  if (typeof body.name !== 'string' || body.name.trim() === '') {
    errors.name = ['Name is required.']
  } else if (body.name.trim().length > 100) {
    errors.name = ['Name must be at most 100 characters.']
  }

  if (typeof body.email !== 'string' || body.email.trim() === '') {
    errors.email = ['Email is required.']
  } else if (!EMAIL.test(body.email.trim())) {
    errors.email = ['Email is not a valid email address.']
  }

  if (typeof body.seats !== 'number' || !Number.isInteger(body.seats)) {
    errors.seats = ['Seats must be a whole number.']
  } else if (body.seats < 1 || body.seats > MAX_SEATS_PER_BOOKING) {
    errors.seats = [`Seats must be between 1 and ${MAX_SEATS_PER_BOOKING}.`]
  }

  return Object.keys(errors).length ? errors : null
}

// ---- Commands -------------------------------------------------------------

/**
 * Interpretation used by the mock: the waitlist is walked in order and every booking
 * that fits is confirmed, so free seats never stay empty while a waitlisted booking fits.
 * A booking that does not fit keeps its place in line.
 */
export function promoteWaitlist(eventId: string): void {
  const event = db.events.get(eventId)
  if (!event) return
  let free = freeSeats(event)
  for (const booking of waitlist(eventId)) {
    if (free <= 0) break
    if (booking.seats <= free) {
      booking.status = 'confirmed'
      free -= booking.seats
    }
  }
}

export function createBooking(eventId: string, input: unknown): Result<Booking> {
  const event = db.events.get(eventId)
  if (!event) return fail(problem(404, 'NOT_FOUND', `Event ${eventId} does not exist.`))

  const errors = validateBooking(input)
  if (errors) return fail(problem(400, 'VALIDATION_FAILED', undefined, errors))
  const body = input as CreateBookingRequest

  const now = clock.now()
  if (now >= event.startsAt) return fail(problem(409, 'EVENT_STARTED', 'Bookings close when the event starts.'))
  if (now < event.saleStartsAt) {
    return fail(problem(409, 'SALE_NOT_STARTED', `The sale starts at ${new Date(event.saleStartsAt).toISOString()}.`))
  }

  const email = body.email.trim().toLowerCase()
  const seatsForEmail = bookingsFor(eventId)
    .filter((b) => b.status !== 'cancelled' && b.email.toLowerCase() === email)
    .reduce((sum, b) => sum + b.seats, 0)
  if (seatsForEmail + body.seats > MAX_SEATS_PER_EMAIL) {
    return fail(
      problem(409, 'EMAIL_LIMIT_REACHED', `The email address already holds ${seatsForEmail} seats for this event.`, {
        email: [`At most ${MAX_SEATS_PER_EMAIL} seats per email address and event.`],
      }),
    )
  }

  const status = body.seats <= freeSeats(event) ? 'confirmed' : 'waitlisted'
  const record = addBookingRecord({
    eventId,
    name: body.name.trim(),
    email: body.email.trim(),
    seats: body.seats,
    status,
  })
  return { ok: true, value: toBooking(record) }
}

export function cancelBooking(bookingId: string): Result<null> {
  const booking = db.bookings.get(bookingId)
  if (!booking) return fail(problem(404, 'NOT_FOUND', `Booking ${bookingId} does not exist.`))
  if (booking.status === 'cancelled') return fail(problem(409, 'ALREADY_CANCELLED'))

  const event = db.events.get(booking.eventId)!
  if (clock.now() >= event.startsAt - CANCELLATION_CLOSES_BEFORE_START_MS) {
    return fail(problem(409, 'CANCELLATION_CLOSED', 'Bookings can be cancelled up to 48 hours before the start.'))
  }

  booking.status = 'cancelled'
  promoteWaitlist(event.id)
  return { ok: true, value: null }
}
