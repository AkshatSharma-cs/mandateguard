<!-- docs/API.md -->
# MandateGuard API

The V3 endpoints are available under both `/v1` and `/api/v1`. The `/api/v1` prefix is intended for the web console proxy. Requests and responses use JSON.

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

The endpoint verifies that the evaluation is `ALLOW`, unexpired, and still bound to the current active mandate version. The resulting protected proposal can then use the existing checkout and capture endpoints.

The browser companion can request another search with `POST /v1/search` and `{ "query": "wireless mouse", "observation": <ProductObservation> }`. The default profile is applied. Search uses the same policy checks, excludes the supplied observation's title and domain, and returns at most three allowed evaluations as `{ "alternatives": [...] }`. Search errors return an empty alternatives array so they do not change the primary evaluation.

## Marketplace discovery

Agent runs and alternative searches use Channel3 when `CHANNEL3_API_KEY` is configured. The server searches by the task text, applies the profile's approved domains as marketplace filters when present, expands product offers into individual store listings, and prioritizes first-party offers and domains in `server/src/catalogue/trusted_domains.json`. The policy engine still makes the allow/review/block decision from the mandate and listing evidence; the domain list is a preference and ranking input, not a safety guarantee. `INCLUDE_DEMO_LISTINGS` defaults to `false`. If live search is unavailable, the API returns no live listings rather than substituting local demo products. The demo catalogue is included only when explicitly enabled.

Live marketplace listings open at their merchant offer URL. MandateGuard's PayPal sandbox checkout only supports products in its own trusted demo catalogue; a live marketplace listing is not sent to the MandateGuard PayPal capture flow.

## Error responses

Errors use `{ "error": { "code": "...", "message": "..." } }`. Important codes include `NO_PREFERENCES` (409), `PROFILE_NOT_FOUND` (404), `PROFILE_INACTIVE` (409), `INVALID_PROFILE` (422), `MANDATE_STALE` (409), and `EVALUATION_EXPIRED` (409). Invalid request shapes return `VALIDATION_ERROR` (400).

## Scope note

The repository currently assigns API keys no authentication middleware or key store. Do not expose these routes publicly until an API-key verifier and owner identity are wired into the request context; the current local owner is `local-user`.
