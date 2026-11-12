<!-- docs/API.md -->
# MandateGuard API

The V3 endpoints are available under `/v1`, `/api/v1`, and gateway aliases under `/api`. Requests and responses use JSON. The local build uses a shared `local-user` identity and currently has no API-key issuance or validation; keep it on localhost.

## Profiles

Profiles store standing limits. Creating a profile always returns `pending_confirmation`; call the confirm endpoint after reviewing its values. A confirmed profile can be selected as the owner's default. `setDefault` clears any previous default for the same owner in one SQLite transaction.

```sh
curl -X POST http://localhost:3000/v1/profiles \
  -H 'content-type: application/json' \
  -d '{"limits":{"max_total":"75.00","allow_bundles":false,"allow_addons":false,"require_first_party":true,"allowed_domains":["amazon.com","bestbuy.com"]}}'

curl -X POST http://localhost:3000/v1/profiles/PROFILE_ID/confirm -H 'content-type: application/json' -d '{}'
curl -X POST http://localhost:3000/v1/profiles/PROFILE_ID/default -H 'content-type: application/json' -d '{}'
curl http://localhost:3000/v1/profiles
```

`POST /v1/profiles` also accepts `{"instruction":"..."}`. The instruction parser returns the same standing-limit fields as structured input. `max_total` is a strict two-decimal string and may not exceed `$1,000.00`. `allowed_domains` contains lower-case registrable domains; duplicate domains are removed.

## Derived task mandates

`POST /v1/mandates` accepts `{ "instruction": "...", "profile_id": "..." }`. If `profile_id` is omitted, the active default profile is used when one exists. A task inside a confirmed profile is activated with `confirmed_by: "profile:<profile_id>"` and writes `MANDATE_AUTO_ACTIVATED`. A task that expands any profile limit remains pending and returns the exceeded keys in both `exceeded` and `notes`. Values are never clamped to the profile ceiling. Without a profile, a task must contain its own maximum and remains pending for user confirmation.

```sh
curl -X POST http://localhost:3000/v1/mandates \
  -H 'content-type: application/json' \
  -d '{"instruction":"Find a wireless mouse under $30. No bundles."}'
```

Expansion keys are `max_total`, `allow_bundles`, `allow_addons`, `require_first_party`, and `allowed_domains`.

## Evaluate an observation

`POST /v1/evaluate` accepts an observation and one optional `mandate_id` or `profile_id`. With neither identifier, it evaluates under the active default profile. If no active selection exists it returns `409 NO_PREFERENCES`. `alternatives` defaults to `true`.

When the primary decision is not `ALLOW`, the API searches using `mandate.item_query`, then the extracted category label, then the first six title words. It evaluates each candidate against the same mandate, excludes the observed domain and title, persists up to three `ALLOW` evaluations, and returns their `evaluation_id`s and observations. Alternative search is bounded to 12 seconds. Errors or timeouts leave the main decision intact and return an empty alternatives list.

```sh
curl -X POST http://localhost:3000/v1/evaluate \
  -H 'content-type: application/json' \
  -d '{"profile_id":"PROFILE_ID","observation":{"observation_id":"page-1","url":"https://www.amazon.com/dp/EXAMPLE","domain":"www.amazon.com","source":"page","title":"Wireless mouse","price_cents":2499,"currency":"USD","seller":"Amazon","sold_by_merchant":true,"availability":"in stock","image_url":null,"category_hint":"mouse","bundle_signal":false,"hidden_text_found":false,"text":"Wireless optical mouse","captured_at":"2026-11-11T12:00:00.000Z","content_hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}'
```

An allowed alternative can be turned into a proposal with:

```sh
curl -X POST http://localhost:3000/v1/proposals \
  -H 'content-type: application/json' \
  -d '{"evaluation_id":"EVALUATION_ID"}'
```

The endpoint verifies an `ALLOW` evaluation is fresh, priced, in the mandate currency, and bound to the current active mandate version. It computes `payment_mode`: `store_checkout` for a controlled demo-store checkout and `sandbox_simulation` otherwise. Simulated proposals return a fixed disclosure that nothing is purchased from the store and no real money moves. Success returns `{ "proposal": ..., "console_url": ... }`.

For a demo-store catalogue id, `/v1/evaluate` resolves the observation from the server's catalogue and ignores caller-supplied listing fields. The returned `checkout_mode` is `gateway` only for curated products on configured demo-store domains. `DEMO_STORE_DOMAINS` is a comma-separated override; by default it is derived from the curated catalogue's `.localhost` stores. Other observations, including Channel3 and real-page observations, use `checkout_mode: handoff` for the separate “Open at store” action, while an allowed item may be paid only as a disclosed sandbox simulation.

The handoff endpoint records `HANDOFF_OPENED` and returns the original server-stored URL. It never creates a proposal or order:

```sh
curl -X POST http://localhost:3000/v1/evaluations/EVALUATION_ID/handoff \
  -H 'content-type: application/json' -d '{}'
```

The demo checkout description identifies the demo store as merchant and the PayPal Sandbox business account as recipient. No real purchase or shipment occurs. For a complete merchant-side caller, see [`INTEGRATION.md`](INTEGRATION.md) and [`../examples/merchant-agent.js`](../examples/merchant-agent.js).

The browser companion can request another search with `POST /v1/search` and `{ "query": "wireless mouse", "observation": <ProductObservation> }`. The default profile is applied. Search uses the same policy checks, excludes the supplied observation's title and domain, and returns at most three allowed evaluations as `{ "alternatives": [...] }`. Search errors return an empty alternatives array so they do not change the primary evaluation.

## Marketplace discovery

Agent runs and alternative searches use Channel3's indexed `POST /v1/search` endpoint when `CHANNEL3_API_KEY` is configured. Channel3 searches its product index; MandateGuard does not download the full catalog. Each agent run requests a bounded page (up to 12 products) so the policy pipeline can inspect each result within its analysis budget. The server sends the task query, region, profile's approved-domain filter, and maximum price when available, expands each product's offers into individual store listings, and ranks first-party offers and configured trusted domains first. It accepts the paginated response's `data` array and uses the live offer URL, domain, price and currency. The policy engine still makes the allow/review/block decision from the mandate and listing evidence; trusted domains are editable ranking configuration, not a safety guarantee. `INCLUDE_DEMO_LISTINGS` defaults to `false`. If live search is unavailable, the API returns no live listings rather than substituting local demo products. The demo catalogue is included only when explicitly enabled.

Live marketplace listings may use MandateGuard's PayPal sandbox flow as a simulation. The order description begins with `SANDBOX SIMULATION`; nothing is purchased from the marketplace and no real money moves. `GET /v1/proposals/{id}/receipt` returns the captured receipt, including all V1–V12 checks and audit verification; it returns 404 for an unknown proposal and 409 until capture.

## Error responses

Errors use `{ "error": { "code": "...", "message": "..." } }`. Proposal creation can return `OBSERVATION_STALE`, `PRICE_UNKNOWN`, `CURRENCY_MISMATCH`, `DUPLICATE`, or `MANDATE_STALE` (all 409), and proposal creation is limited to ten attempts per hour per mandate. Other important codes include `NO_PREFERENCES` (409), `PROFILE_NOT_FOUND` (404), `PROFILE_INACTIVE` (409), and `INVALID_PROFILE` (422). Invalid request shapes return `VALIDATION_ERROR` (400).

## Scope note

The repository currently assigns API keys no authentication middleware or key store. Do not expose these routes publicly until an API-key verifier and owner identity are wired into the request context; the current local owner is `local-user`.
