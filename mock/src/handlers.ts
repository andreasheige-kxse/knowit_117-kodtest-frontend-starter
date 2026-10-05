import { delay, http, HttpResponse, type HttpResponseResolver } from 'msw'
import { planRequest } from './chaos.js'
import { clock } from './runtime.js'
import { db } from './store.js'
import { cancelBooking, createBooking, problem, toBooking, toEvent, freeSeats } from './rules.js'
import type { EventList, ProblemDetails } from './types.js'

/** Matches any origin, so the same handlers work in the browser, in tests and with SSR */
const API = '*/api'

function baseHeaders(): Record<string, string> {
  return { Date: new Date(clock.now()).toUTCString() }
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return HttpResponse.json(body as never, { status, headers: { ...baseHeaders(), ...headers } })
}

function problemResponse(p: ProblemDetails, headers: Record<string, string> = {}) {
  return HttpResponse.json(p as never, {
    status: p.status,
    headers: { ...baseHeaders(), 'Content-Type': 'application/problem+json', ...headers },
  })
}

/** Wraps a resolver with chaos mode: latency, 503s, dropped responses and offline */
function withChaos(resolver: HttpResponseResolver): HttpResponseResolver {
  return async (info) => {
    if (info.request.headers.get('x-chaos')?.toLowerCase() === 'off') return resolver(info)

    const plan = planRequest()
    if (plan.offline) return HttpResponse.error()
    if (plan.latencyMs > 0) await delay(plan.latencyMs)
    if (plan.fail) {
      return problemResponse(problem(503, 'SERVICE_UNAVAILABLE', 'Try again shortly.'), {
        'Retry-After': String(1 + Math.floor(plan.latencyMs % 3)),
      })
    }
    const response = await resolver(info)
    // The request has been carried out, but the client never sees the response
    if (plan.drop) return HttpResponse.error()
    return response
  }
}

function parsePositiveInt(value: string | null, fallback: number): number | null {
  if (value === null) return fallback
  return /^\d+$/.test(value) ? Number(value) : null
}

export const handlers = [
  http.get(
    `${API}/events`,
    withChaos(({ request }) => {
      const url = new URL(request.url)
      const q = url.searchParams.get('q')?.trim().toLowerCase() ?? ''
      const hasFreeSeats = url.searchParams.get('hasFreeSeats') === 'true'
      const includePast = url.searchParams.get('includePast') === 'true'
      const page = parsePositiveInt(url.searchParams.get('page'), 1)
      const pageSize = parsePositiveInt(url.searchParams.get('pageSize'), 20)

      const errors: Record<string, string[]> = {}
      if (page === null || page < 1) errors.page = ['Page must be a whole number of at least 1.']
      if (pageSize === null || pageSize < 1 || pageSize > 100) errors.pageSize = ['Page size must be between 1 and 100.']
      if (Object.keys(errors).length) return problemResponse(problem(400, 'VALIDATION_FAILED', undefined, errors))

      const now = clock.now()
      const matches = [...db.events.values()]
        .filter((e) => includePast || e.startsAt > now)
        .filter((e) => !q || e.name.toLowerCase().includes(q) || e.venue.toLowerCase().includes(q))
        .filter((e) => !hasFreeSeats || freeSeats(e) > 0)
        .sort((a, b) => a.startsAt - b.startsAt || a.id.localeCompare(b.id))

      const start = (page! - 1) * pageSize!
      const body: EventList = {
        items: matches.slice(start, start + pageSize!).map(toEvent),
        total: matches.length,
        page: page!,
        pageSize: pageSize!,
      }
      return json(body)
    }),
  ),

  http.get(
    `${API}/events/:id`,
    withChaos(({ params }) => {
      const event = db.events.get(String(params.id))
      if (!event) return problemResponse(problem(404, 'NOT_FOUND', `Event ${params.id} does not exist.`))
      return json(toEvent(event))
    }),
  ),

  http.post(
    `${API}/events/:id/bookings`,
    withChaos(async ({ request, params }) => {
      const eventId = String(params.id)
      let body: unknown
      try {
        body = await request.json()
      } catch {
        return problemResponse(
          problem(400, 'VALIDATION_FAILED', undefined, { body: ['The request body must be valid JSON.'] }),
        )
      }

      const key = request.headers.get('idempotency-key')
      const fingerprint = JSON.stringify({ eventId, body })
      if (key) {
        const stored = db.idempotency.get(key)
        if (stored && stored.fingerprint !== fingerprint) {
          return problemResponse(problem(422, 'IDEMPOTENCY_KEY_REUSED'))
        }
        if (stored) {
          return HttpResponse.json(stored.body as never, {
            status: stored.status,
            headers: { ...baseHeaders(), ...stored.headers, 'Idempotent-Replayed': 'true' },
          })
        }
      }

      const result = createBooking(eventId, body)
      const status = result.ok ? 201 : result.problem.status
      const responseBody = result.ok ? result.value : result.problem
      const headers: Record<string, string> = result.ok
        ? { Location: `/api/bookings/${result.value.id}` }
        : { 'Content-Type': 'application/problem+json' }

      if (key && status < 500) db.idempotency.set(key, { fingerprint, status, body: responseBody, headers })
      return HttpResponse.json(responseBody as never, { status, headers: { ...baseHeaders(), ...headers } })
    }),
  ),

  http.get(
    `${API}/bookings/:id`,
    withChaos(({ params }) => {
      const booking = db.bookings.get(String(params.id))
      if (!booking) return problemResponse(problem(404, 'NOT_FOUND', `Booking ${params.id} does not exist.`))
      return json(toBooking(booking))
    }),
  ),

  http.delete(
    `${API}/bookings/:id`,
    withChaos(({ params }) => {
      const result = cancelBooking(String(params.id))
      if (!result.ok) return problemResponse(result.problem)
      return new HttpResponse(null, { status: 204, headers: baseHeaders() })
    }),
  ),
]
