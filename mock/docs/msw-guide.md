# Getting started with MSW

A short introduction for anyone who has not used [MSW (Mock Service Worker)](https://mswjs.io) before. You don't need to know MSW to do the code test. The mock API is already built, and you write your app exactly as you would against a real backend. This guide explains what happens behind the scenes and how to control the mock API while you develop and test.

## What MSW does

MSW intercepts network requests **before they leave your app** and answers them with mocked responses. Your code calls `fetch('/api/events')` as usual, and there is no separate mock server to start.

- **In the browser**, MSW registers a service worker (`mockServiceWorker.js`). It catches the requests and passes them to handlers that run in your page.
- **In Node** (tests, SSR), MSW hooks into Node's `fetch` and `http`, with no service worker involved.

The handlers are the same in both cases, so your app and your tests run against exactly the same API.

```
your code ── fetch('/api/events') ──▶ MSW ──▶ handler in @kodtest/mock-api ──▶ response
                                       │
                                       └─ anything that is not /api/* goes to the network as usual
```

So you do **not** need to write any handlers yourself. They are already in `@kodtest/mock-api`.

## Get started in four steps

These steps assume you have created your app in a folder, here `app/`, and added it to `workspaces` in the root `package.json` (see the [README](../../README.md)).

### 1. Install the package in your app

```sh
cd app
npm install @kodtest/mock-api
```

### 2. Put the service worker among your static files

```sh
npx msw init public --save
```

This copies `mockServiceWorker.js` into `public/`, or into whichever folder your framework serves static files from. Include `--save`, or the command stops and waits for an answer to a prompt.

### 3. Start the mock API before your app renders

```ts
// main.ts / main.tsx
async function enableMocking() {
  if (!import.meta.env.DEV) return
  const { worker } = await import('@kodtest/mock-api/browser')
  await worker.start({ onUnhandledRequest: 'bypass' })
}

enableMocking().then(() => {
  // render your app here
})
```

The `await` matters. If the app makes requests before the worker has started, they go to the real network and get a 404.

### 4. Call the API

```ts
const res = await fetch('/api/events')
const { items, total } = await res.json()
```

Open the devtools console. If you see `[MSW] Mocking enabled.`, it works.

## See what is happening

- **The Network tab** shows every request as usual. Responses from MSW are marked *ServiceWorker* in the Size column.
- **The console** gives you the whole mock API under `__mock`:

```js
__mock.chaos.set('off')          // turn chaos mode off while you build a view
__mock.chaos.set('wild')         // see how your app copes with a really bad network
__mock.chaos.get()               // current settings
__mock.scenarios.sellOut()       // sell out an event
__mock.scenarios.saleOpensSoon(30)
__mock.clock.advance(60_000)     // move the mock API's clock one minute forward
__mock.reset()                   // back to the seed data
```

The data lives in memory, so reloading the page resets everything.

## Chaos mode: why the app sometimes "doesn't work"

In the browser, chaos mode is on (`mild`) from the start. That is on purpose. Any request can run into the following:

| What you see | Why | How it shows up in code |
| --- | --- | --- |
| Slow responses, 150–700 ms | `latency` | The request takes time, and you need a loading state |
| Responses arrive out of order | `reorder` | An older search result can arrive after a newer one |
| `503` with `Retry-After` | `errorRate` | `res.ok === false`, `res.status === 503` |
| The request fails completely | `dropRate`, `offline` | `fetch` throws a `TypeError` |
| Seats disappear while you look | `simulatedBuyers` | The data changes between two requests |

Two things worth knowing:

- **A dropped response does not mean the request failed.** With `dropRate`, the booking is carried out, but the response never arrives. So send the same `Idempotency-Key` when you retry, and you get the original response back instead of a double booking.
- **`fetch` only throws on network errors.** A `409` or `503` is a normal response. Check `res.ok` and read `code` from the problem JSON.

The `X-Chaos: off` header turns chaos mode off for a single request. It's handy while debugging, but don't use it in your app's real code.

## In tests

In Node the mock API works the same way, but chaos mode is off so your tests are predictable.

```ts
// test/setup.ts (add it under setupFiles in vitest.config)
import { afterAll, afterEach, beforeAll, beforeEach } from 'vitest'
import { chaos, reset, server } from '@kodtest/mock-api/node'

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
beforeEach(() => reset())
afterEach(() => {
  server.resetHandlers()
  chaos.set('off')
})
afterAll(() => server.close())
```

- **Absolute URLs in Node.** There is no page to resolve against, so `fetch('/api/events')` doesn't work. Let your app take a base URL, for example `http://localhost`, in tests.
- **`onUnhandledRequest: 'error'`** fails the test if your code calls something that isn't mocked, instead of silently going out to the network.

### Testing error handling with chaos mode

You can turn chaos mode on in individual tests, with full control:

```ts
import { chaos, scenarios } from '@kodtest/mock-api/node'

it('shows an error message when the service does not respond', async () => {
  chaos.set({ errorRate: 1 })          // every request gets a 503
  // render, and expect an error message
})

it('survives a dropped response when booking', async () => {
  chaos.set({ dropRate: 1 })           // the booking is made, but the response is dropped
  // ...
})

it('shows sold out', async () => {
  scenarios.sellOut('evt-2')
  // ...
})
```

With the same `seed`, the sequence of errors is the same every time: `chaos.set({ errorRate: 0.3, seed: 42 })`.

### Overriding a response in a single test

If you need a response the mock API can't give you, you can add your own handler for one test. Install `msw` in your app first (`npm install -D msw`).

```ts
import { http, HttpResponse } from 'msw'
import { server } from '@kodtest/mock-api/node'

it('handles an empty list', async () => {
  server.use(
    http.get('*/api/events', () => HttpResponse.json({ items: [], total: 0, page: 1, pageSize: 20 })),
  )
  // ...
})
```

`server.use()` puts the handler first in line, and `server.resetHandlers()` in `afterEach` removes it again. Most of the time `chaos` and `scenarios` are enough, and then you test against the same rules as your app.

### End-to-end in a real browser

If you run, say, Playwright against your dev server, it's the browser version that runs, with chaos mode `mild` and simulated buyers. Reset at the start of every test so IDs and seat counts don't drift:

```ts
test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => {
    __mock.reset()
    __mock.chaos.set('off')
  })
})
```

## Common problems

| Symptom | Likely cause |
| --- | --- |
| `404` on `/api/...` in the browser | The worker wasn't started, or the app rendered before `worker.start()` finished |
| `Failed to register a ServiceWorker` in the console | `mockServiceWorker.js` isn't in your static files folder. Run `npx msw init <folder> --save` |
| Warning that the worker was generated by a different version of MSW | `mockServiceWorker.js` is from another MSW version. Run `npx msw init` again |
| `TypeError: Failed to parse URL` in tests | A relative URL in Node. Use `http://localhost/api/...` |
| Tests pass but the app behaves strangely | That's chaos mode. Run `__mock.chaos.set('off')` and compare |
| Data changes without you doing anything | Simulated buyers (`simulatedBuyers`) |

## Read more

- [README](../../README.md): endpoints, error codes, chaos mode and scenarios
- [`openapi.yaml`](../openapi.yaml): the full API description
- [mswjs.io/docs](https://mswjs.io/docs): MSW's own documentation
