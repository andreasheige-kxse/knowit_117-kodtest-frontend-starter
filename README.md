# Kodtest – Evenemangsbokning, frontend

Det här är starter-repot för kodtestet. Uppgiften står i dokumentet du fick av oss. Här finns mock-API:t du ska bygga mot, i mappen `mock/`.

Mock-API:t är byggt med [MSW](https://mswjs.io) och beter sig medvetet som ett riktigt nätverk: svar kan vara långsamma, misslyckas eller komma i fel ordning, och andra köpare bokar platser samtidigt som du.

## Kom igång

Du behöver Node 22.12 eller senare.

```sh
npm install         # installerar beroenden och bygger mock-API:t
npm run test:mock   # kör mock-API:ts egna tester
```

## Skapa din app

Du väljer stack själv. Lägg appen i en egen mapp i repot, till exempel med Vite:

```sh
npm create vite@latest app
```

Lägg sedan till mappen bland `workspaces` i `package.json` i roten, så att appen hittar mock-API:t:

```json
"workspaces": ["mock", "app"]
```

Installera paketet i appen och skapa MSW:s service worker i appens mapp för statiska filer:

```sh
cd app
npm install @kodtest/mock-api
npx msw init public --save
```

### I webbläsaren

Starta mock-API:t innan appen renderas. Importera det dynamiskt, så att det inte följer med i ett produktionsbygge:

```ts
async function enableMocking() {
  if (!import.meta.env.DEV) return
  const { worker } = await import('@kodtest/mock-api/browser')
  await worker.start({ onUnhandledRequest: 'bypass' })
}

enableMocking().then(() => {
  // rendera appen här
})
```

### I tester

Samma handlers fungerar i Node, så dina tester går mot samma API som appen:

```ts
import { afterAll, beforeAll, beforeEach } from 'vitest'
import { reset, server } from '@kodtest/mock-api/node'

beforeAll(() => server.listen())
beforeEach(() => reset())
afterAll(() => server.close())
```

I Node behöver anropen en absolut URL, till exempel `http://localhost/api/events`.

### Med SSR

Väljer du SSR behöver även serverns runtime använda `server.listen()` från `@kodtest/mock-api/node`, till exempel i Next.js `instrumentation.ts`.

## API

| Endpoint | Beskrivning |
| --- | --- |
| `GET /api/events` | Kommande evenemang. Parametrar: `q`, `hasFreeSeats`, `includePast`, `page`, `pageSize` |
| `GET /api/events/{id}` | Ett evenemang |
| `POST /api/events/{id}/bookings` | Boka. Stöder headern `Idempotency-Key` |
| `GET /api/bookings/{id}` | En bokning, med status och plats i väntelistan |
| `DELETE /api/bookings/{id}` | Avboka |

Den fullständiga beskrivningen finns i [`mock/openapi.yaml`](mock/openapi.yaml), och typerna kan importeras från `@kodtest/mock-api`.

Fel returneras som `application/problem+json` med en maskinläsbar `code`:

| Code | Status |
| --- | --- |
| `VALIDATION_FAILED` | 400, med field errors i `errors` |
| `NOT_FOUND` | 404 |
| `SALE_NOT_STARTED`, `EVENT_STARTED`, `EMAIL_LIMIT_REACHED`, `CANCELLATION_CLOSED`, `ALREADY_CANCELLED` | 409 |
| `IDEMPOTENCY_KEY_REUSED` | 422 |
| `SERVICE_UNAVAILABLE` | 503, med `Retry-After` |

## Chaos mode

Chaos mode är påslaget (`mild`) i webbläsaren och avslaget i Node, så att tester blir förutsägbara.

```ts
import { chaos } from '@kodtest/mock-api/browser' // eller '/node'

chaos.set('off')   // 'off', 'mild' eller 'wild'
chaos.set({ errorRate: 0.2, seed: 42 })   // ändra enskilda inställningar
```

| Inställning | Betydelse |
| --- | --- |
| `latency` | Fördröjning i millisekunder, `[min, max]` |
| `errorRate` | Andel anrop som får `503` med `Retry-After`, 0–1 |
| `dropRate` | Andel anrop som utförs men vars svar aldrig kommer fram, 0–1 |
| `reorder` | Slumpad extra fördröjning, så att svar kan komma i fel ordning |
| `offline` | Alla anrop misslyckas med ett nätverksfel |
| `simulatedBuyers` | Andra köpare bokar och avbokar i bakgrunden |
| `seed` | Samma seed ger samma sekvens av fel |

Headern `X-Chaos: off` stänger av chaos mode för ett enskilt anrop.

I webbläsarens konsol finns allt även under `__mock`, till exempel `__mock.chaos.set('wild')` eller `__mock.scenarios.sellOut()`.

## Scenarier, tid och data

```ts
import { clock, reset, scenarios } from '@kodtest/mock-api/browser'

scenarios.sellOut()          // säljer slut ett evenemang och lägger till en väntelista
scenarios.saleOpensSoon(60)  // ett evenemang där försäljningen öppnar om 60 sekunder
scenarios.manyEvents(1000)   // många evenemang
clock.advance(60_000)        // flytta mock-API:ts klocka framåt
reset()                      // tillbaka till startdatan
```

Datan ligger i minnet och återställs när sidan laddas om. Startdatan innehåller bland annat ett nästan fullt evenemang, ett slutsålt med väntelista, ett som startar inom 48 timmar och ett där försäljningen inte har öppnat.

## Ändra inte i `mock/`

Mock-API:t är en del av uppgiften och ska vara orört. Hittar du ett fel i det, beskriv det i `docs/decisions.md`.
