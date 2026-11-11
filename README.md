# MandateGuard

MandateGuard is a permission-aware shopping companion. It searches live marketplace offers from a buyer's task and confirmed preferences, then checks each listing against those limits before presenting it. The buyer opens the real retailer listing to purchase; MandateGuard does not place orders on external stores.

## Problem

Shopping agents read seller-controlled listing text. That text can contain instructions that try to change a budget, claim buyer approval, add products, or pressure an agent to act quickly. MandateGuard treats listing descriptions as untrusted data and keeps the buyer's mandate separate from the quarantined extractor.

## Shopping flow

Create and confirm a preference profile with spending, bundle, add-on, seller, and approved-domain limits. Describe a task in the Console. The backend searches Channel3 using the task and approved domains, analyzes the returned store listings as untrusted text, and applies the deterministic policy engine. Allowed offers link to their retailer pages. Blocked offers stay visible with reasons and any allowed alternatives. The local curated catalogue and PayPal sandbox harness remain available only for explicitly enabled/demo catalogue flows.

## Architecture

```text
Buyer instruction
      |
      v
Pending mandate -- buyer confirms --> Active mandate
      |
      +--> Quarantined listing extractor (untrusted text only)
                     |
                     v
             Deterministic policy engine <--- trusted catalogue + mandate
                     |
              Allowed protected proposal
                     |
       PayPal order + buyer approval (JS SDK)
                     |
        Server-side order verification
                     |
          Atomic capture reservation
                     |
              Append-only audit chain
```

## Invariants

1. AI cannot create, modify, or expand a mandate without explicit buyer confirmation.
2. Seller text is confined to the extractor and never becomes trusted instructions or payment input.
3. AI checks can flag or reject a proposal; they cannot authorize it.
4. Deterministic policy and buyer approval authorize payment.
5. The backend verifies the exact PayPal order and uses an atomic capture transition.
6. Consequential steps are appended to the audit chain.
7. Errors, timeouts, and invalid outputs fail closed.

## Tools and APIs

The server uses Node.js ESM, Express, better-sqlite3, Zod, dotenv, and native `fetch`. The quarantined extractor uses the Gemini or Anthropic REST API in JSON mode; replay mode reads recorded fixtures without network access. PayPal integration obtains an OAuth token, creates and reads Orders v2 orders, captures approved orders server-side, and uses the PayPal JavaScript SDK only for the buyer approval step. API credentials stay in `.env` and are never included in responses or logs.

## Setup

1. Clone the repository and run `npm install`.
2. Copy `.env.example` to `.env` and set `LLM_MODE=live`, `LLM_PROVIDER`, `LLM_MODEL`, and `LLM_API_KEY` for listing analysis and mandate parsing. Replay mode is only usable when matching fixtures exist.
3. Set `CHANNEL3_API_KEY` to enable real marketplace discovery. `CHANNEL3_REGION` selects the search market. Demo listings are disabled unless `INCLUDE_DEMO_LISTINGS=true`; if live search is unavailable, the agent returns no listings instead of silently showing demo products. The server uses Channel3's `POST /v1/search` endpoint and its retailer offer URLs. [Channel3 API guide](https://github.com/channel3-ai/skills/blob/main/skills/channel3-api/SKILL.md).
4. Configure PayPal sandbox credentials (`PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, and `PAYPAL_BUSINESS_EMAIL`) only if you want to use the sample catalogue's sandbox checkout. Live marketplace listings open on the retailer site; MandateGuard cannot inspect or control that site's checkout and does not capture those purchases.
5. Set `web/.env.local` to `VITE_USE_MOCK=false` for the backend-backed UI, then run `npm run dev`. The UI is at `http://localhost:5173/app/`, and the API is at `http://localhost:3000`.
6. Run `npm test`; use `scripts/smoke.sh` for the mandate and agent API flow.

The API currently uses a local owner identity and has no API-key authentication middleware. Keep it bound to your development machine; do not expose it publicly.

## Browser companion

Load `extension/` unpacked from `chrome://extensions` with Developer mode enabled. It calls the local API at `http://localhost:3000`; its current permission set does not read page content automatically, so enter the displayed price and description in the popup. See [extension/README.md](extension/README.md).

## Tests and attack suite

Run the tests with `npm test`. Reproduce the recorded attack suite without an API key with `LLM_MODE=replay npm run attacks`; the fixtures under `server/fixtures/llm` are required for a complete replay. The suite writes per-case output to `attacks/RESULTS.md` and `attacks/results.json`.

When required fixtures are absent, extraction fails closed and the generated report records those mismatches; that run is not a complete model evaluation.

## Limitations

Live discovery depends on Channel3 availability, retailer coverage, and the configured region. MandateGuard evaluates the listing information returned by discovery, but external prices and stock can change after the result is shown. It cannot enforce limits at an external retailer's checkout; the user completes that purchase on the retailer's own site. The API has no authentication middleware and the local owner identity is shared, so keep it local. PayPal sandbox checkout applies only to the sample catalogue and is not the checkout path for live retailer offers. The attack suite is a small demonstration, not a general security evaluation.

## License

MIT. See [LICENSE](LICENSE).
