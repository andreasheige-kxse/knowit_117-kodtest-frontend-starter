export type BookingStatus = 'confirmed' | 'waitlisted' | 'cancelled'

export interface Event {
  id: string
  name: string
  venue: string
  /** ISO 8601, UTC */
  startsAt: string
  /** ISO 8601, UTC */
  saleStartsAt: string
  capacity: number
  confirmedSeats: number
  freeSeats: number
  waitlistedBookings: number
}

export interface EventList {
  items: Event[]
  total: number
  page: number
  pageSize: number
}

export interface Booking {
  id: string
  eventId: string
  name: string
  email: string
  seats: number
  status: BookingStatus
  /** 1-based position in the waitlist, or null when the booking is not waitlisted */
  waitlistPosition: number | null
  /** ISO 8601, UTC */
  createdAt: string
}

export interface CreateBookingRequest {
  name: string
  email: string
  seats: number
}

export type ErrorCode =
  | 'VALIDATION_FAILED'
  | 'NOT_FOUND'
  | 'SALE_NOT_STARTED'
  | 'EVENT_STARTED'
  | 'EMAIL_LIMIT_REACHED'
  | 'CANCELLATION_CLOSED'
  | 'ALREADY_CANCELLED'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'SERVICE_UNAVAILABLE'

/** RFC 9457 problem details, extended with a machine-readable code */
export interface ProblemDetails {
  type: string
  title: string
  status: number
  detail?: string
  code: ErrorCode
  /** Field errors, keyed by field name */
  errors?: Record<string, string[]>
}

export interface ChaosConfig {
  /** Latency range in milliseconds, [min, max] */
  latency: [number, number]
  /** Share of requests answered with 503 and Retry-After, 0–1 */
  errorRate: number
  /** Share of requests that are carried out but whose response is dropped, 0–1 */
  dropRate: number
  /** Adds random extra latency so responses can arrive out of order */
  reorder: boolean
  /** Every request fails with a network error */
  offline: boolean
  /** Other buyers book and cancel seats in the background */
  simulatedBuyers: boolean
  /** Seed for all randomness, so a sequence can be reproduced */
  seed: number
}

export type ChaosPreset = 'off' | 'mild' | 'wild'
