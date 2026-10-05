import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { chaos, clock, reset, scenarios, server } from '../src/node.js'
import type { Booking, Event, EventList, ProblemDetails } from '../src/types.js'

const BASE = 'http://localhost/api'
const DAY = 24 * 60 * 60 * 1000

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
beforeEach(() => reset())
afterEach(() => chaos.set('off'))
afterAll(() => server.close())

async function get<T>(path: string, headers: Record<string, string> = {}) {
  const res = await fetch(`${BASE}${path}`, { headers })
  return { res, body: (await res.json()) as T }
}

async function book(eventId: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${BASE}/events/${eventId}/bookings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
  return { res, body: (await res.json()) as Booking & ProblemDetails }
}

const cancel = (id: string) => fetch(`${BASE}/bookings/${id}`, { method: 'DELETE' })
const person = (n: number, seats = 1) => ({ name: `Kandidat ${n}`, email: `kandidat-${n}@example.com`, seats })

describe('GET /api/events', () => {
  it('lists upcoming events sorted by start, without past events', async () => {
    const { body } = await get<EventList>('/events')
    expect(body.total).toBe(7)
    const starts = body.items.map((e) => e.startsAt)
    expect(starts).toEqual([...starts].sort())
    expect(body.items.some((e) => e.name === 'Sommarkonferensen')).toBe(false)
  })

  it('filters on search, free seats and past events, and paginates', async () => {
    expect((await get<EventList>('/events?q=göteborg')).body.total).toBe(2)
    expect((await get<EventList>('/events?hasFreeSeats=true')).body.items.every((e) => e.freeSeats > 0)).toBe(true)
    expect((await get<EventList>('/events?includePast=true')).body.total).toBe(8)
    const page = (await get<EventList>('/events?page=2&pageSize=3')).body
    expect(page).toMatchObject({ page: 2, pageSize: 3, total: 7 })
    expect(page.items).toHaveLength(3)
  })

  it('rejects invalid paging with field errors', async () => {
    const { res, body } = await get<ProblemDetails>('/events?pageSize=500')
    expect(res.status).toBe(400)
    expect(res.headers.get('content-type')).toContain('application/problem+json')
    expect(body.code).toBe('VALIDATION_FAILED')
    expect(body.errors?.pageSize).toBeDefined()
  })
})

describe('POST /api/events/{id}/bookings', () => {
  it('confirms a booking that fits and returns 201 with a Location', async () => {
    const { res, body } = await book('evt-1', person(1, 3))
    expect(res.status).toBe(201)
    expect(res.headers.get('location')).toBe(`/api/bookings/${body.id}`)
    expect(body).toMatchObject({ status: 'confirmed', seats: 3, waitlistPosition: null })
    expect((await get<Event>('/events/evt-1')).body.freeSeats).toBe(0)
  })

  it('puts the whole booking on the waitlist when it does not fit', async () => {
    const { res, body } = await book('evt-1', person(1, 4)) // 3 seats free
    expect(res.status).toBe(201)
    expect(body).toMatchObject({ status: 'waitlisted', waitlistPosition: 1 })
    expect((await get<Event>('/events/evt-1')).body).toMatchObject({ freeSeats: 3, waitlistedBookings: 1 })
  })

  it('returns field errors for invalid input and invalid JSON', async () => {
    const { res, body } = await book('evt-1', { name: ' ', email: 'not-an-email', seats: 5 })
    expect(res.status).toBe(400)
    expect(Object.keys(body.errors ?? {}).sort()).toEqual(['email', 'name', 'seats'])
    expect((await book('evt-1', '{oops')).body.errors?.body).toBeDefined()
  })

  it('limits each email address to 4 seats per event', async () => {
    await book('evt-2', person(1, 3))
    const { res, body } = await book('evt-2', { ...person(1, 2), email: 'KANDIDAT-1@example.com' })
    expect(res.status).toBe(409)
    expect(body.code).toBe('EMAIL_LIMIT_REACHED')
    expect(body.errors?.email).toBeDefined()
  })

  it('rejects bookings before the sale starts and after the event has started', async () => {
    expect((await book('evt-5', person(1))).body.code).toBe('SALE_NOT_STARTED')
    expect((await book('evt-8', person(1))).body.code).toBe('EVENT_STARTED')
    expect((await book('evt-404', person(1))).res.status).toBe(404)
  })

  it('lets a sale open when the mock clock is moved forward', async () => {
    clock.advance(2 * DAY + 1000)
    expect((await book('evt-5', person(1))).res.status).toBe(201)
  })
})

describe('DELETE /api/bookings/{id}', () => {
  it('promotes waitlisted bookings that fit, in order, skipping those that do not', async () => {
    // evt-3: 20 of 20 confirmed (bkg-32..36, 4 seats each), waitlist 3, 1, 2 seats
    expect((await cancel('bkg-32')).status).toBe(204)
    const [three, one, two] = await Promise.all(['bkg-37', 'bkg-38', 'bkg-39'].map((id) => get<Booking>(`/bookings/${id}`)))
    expect(three.body.status).toBe('confirmed')
    expect(one.body.status).toBe('confirmed')
    expect(two.body).toMatchObject({ status: 'waitlisted', waitlistPosition: 1 })
  })

  it('closes cancellation 48 hours before the start and rejects double cancellation', async () => {
    const closed = await cancel('bkg-40') // evt-4 starts in 30 hours
    expect(closed.status).toBe(409)
    expect(((await closed.json()) as ProblemDetails).code).toBe('CANCELLATION_CLOSED')

    await cancel('bkg-1')
    const again = await cancel('bkg-1')
    expect(((await again.json()) as ProblemDetails).code).toBe('ALREADY_CANCELLED')
  })
})

describe('Idempotency-Key', () => {
  it('replays the original response instead of creating a duplicate', async () => {
    const first = await book('evt-2', person(1, 2), { 'Idempotency-Key': 'abc' })
    const second = await book('evt-2', person(1, 2), { 'Idempotency-Key': 'abc' })
    expect(second.res.status).toBe(201)
    expect(second.res.headers.get('idempotent-replayed')).toBe('true')
    expect(second.body.id).toBe(first.body.id)
    expect((await get<Event>('/events/evt-2')).body.confirmedSeats).toBe(62)
  })

  it('rejects the same key with a different request', async () => {
    await book('evt-2', person(1, 2), { 'Idempotency-Key': 'abc' })
    const { res, body } = await book('evt-2', person(1, 1), { 'Idempotency-Key': 'abc' })
    expect(res.status).toBe(422)
    expect(body.code).toBe('IDEMPOTENCY_KEY_REUSED')
  })
})

describe('chaos mode', () => {
  it('answers 503 with Retry-After, and X-Chaos: off bypasses it', async () => {
    chaos.set({ errorRate: 1 })
    const { res, body } = await get<ProblemDetails>('/events')
    expect(res.status).toBe(503)
    expect(res.headers.get('retry-after')).toMatch(/^\d+$/)
    expect(body.code).toBe('SERVICE_UNAVAILABLE')
    expect((await get<EventList>('/events', { 'X-Chaos': 'off' })).res.status).toBe(200)
  })

  it('can carry out a booking and drop the response; a retry with the same key recovers it', async () => {
    chaos.set({ dropRate: 1 })
    await expect(book('evt-2', person(1, 2), { 'Idempotency-Key': 'k1' })).rejects.toThrow()
    const retry = await book('evt-2', person(1, 2), { 'Idempotency-Key': 'k1', 'X-Chaos': 'off' })
    expect(retry.res.headers.get('idempotent-replayed')).toBe('true')
    expect((await get<Event>('/events/evt-2', { 'X-Chaos': 'off' })).body.confirmedSeats).toBe(62)
  })

  it('fails every request with a network error when offline', async () => {
    chaos.set({ offline: true })
    await expect(fetch(`${BASE}/events`)).rejects.toThrow()
  })

  it('reproduces the same error sequence for the same seed', async () => {
    const run = async () => {
      chaos.set({ errorRate: 0.5, seed: 42 })
      reset()
      const statuses: number[] = []
      for (let i = 0; i < 12; i++) statuses.push((await fetch(`${BASE}/events`)).status)
      return statuses
    }
    const first = await run()
    expect(first).toContain(503)
    expect(first).toContain(200)
    expect(await run()).toEqual(first)
  })
})

describe('scenarios', () => {
  it('sells out an event and adds a waitlist', async () => {
    const event = scenarios.sellOut('evt-2')
    expect(event).toMatchObject({ freeSeats: 0, waitlistedBookings: 2 })
  })

  it('adds an event whose sale opens soon', async () => {
    const event = scenarios.saleOpensSoon(30)
    expect((await book(event.id, person(1))).body.code).toBe('SALE_NOT_STARTED')
    clock.advance(31_000)
    expect((await book(event.id, person(1))).res.status).toBe(201)
  })

  it('adds many events for paging and performance', async () => {
    scenarios.manyEvents(1000)
    const { body } = await get<EventList>('/events?pageSize=100')
    expect(body.total).toBe(1007)
    expect(body.items).toHaveLength(100)
  })
})
