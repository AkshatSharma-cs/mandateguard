# MandateGuard

MandateGuard is an authorization gateway for AI shopping agents: **AI proposes. MandateGuard validates. You authorize. PayPal executes.** It checks proposed purchases against shopper-confirmed limits, treats seller-provided text as untrusted, and verifies the exact PayPal Sandbox order before capture.

## Why it exists

Shopping agents can misunderstand a request, be manipulated by text embedded in a product listing, or propose a cart that exceeds the shopper's limits. MandateGuard inserts a reviewable policy boundary between an agent's proposal and payment.

## How it works

```text
Shopper confirms limits -> Agent proposes -> MandateGuard evaluates
                                             |
                         Audit trail <- Decision and evidence
                                             |
                       Shopper approves PayPal Sandbox order
                                             |
                          Server verifies order before capture
```

Shoppers can use standing preferences or create a task-specific mandate. Listing extraction runs in an isolated, no-tools model step; extracted seller instructions are evidence, never authority. A deterministic policy engine checks price, seller/domain, category, quantity, bundles, add-ons, currency, freshness, and duplicates. The buyer reviews the result before any controlled checkout.

## Checkout boundary

The integrated checkout uses PayPal Sandbox only. Demo-store orders are sandbox orders and do not represent a real purchase or shipment. An allowed external listing can also create a clearly disclosed sandbox simulation: MandateGuard does not buy from that retailer and no real money moves. **Open at store** is a separate handoff; MandateGuard does not control or verify an external retailer's checkout.

## Features

- Confirmed standing profiles and task mandates with explicit limits.
- Channel3 marketplace discovery, with optional curated demo listings.
- Quarantined listing analysis and deterministic policy decisions with reasons and rule evidence.
- Up to three allowed alternatives evaluated under the same mandate.
- Manifest V3 browser companion for checking a product page against the default profile.
- PayPal Sandbox Orders API, PayPal JavaScript SDK approval, and server-side order verification before capture.
- Append-only, hash-chained audit events and replayable security demonstrations.

## Technology

Node.js 20+, Express, better-sqlite3, Zod, React 19, TypeScript, Vite, Tailwind CSS v4, Motion, and a Manifest V3 browser extension in JavaScript. LLM REST adapters support Gemini and Anthropic, as well as fixture replay. PayPal uses OAuth 2.0 and Orders v2.

## Run locally

1. Install dependencies: `npm install`.
2. Copy `.env.example` to `.env`. `LLM_MODE=replay` is the default; replay needs matching fixtures. Configure an LLM provider and key for live parsing and extraction.
3. For live marketplace search, set `CHANNEL3_API_KEY`. Set `INCLUDE_DEMO_LISTINGS=true` only when you want curated demo listings available.
4. To exercise payment, configure a PayPal developer Sandbox app and buyer account, then set `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, and `PAYPAL_BUSINESS_EMAIL`.
5. Build the web console with `npm run build:demo`, then run `npm start`; or run backend and Vite together with `npm run dev`.
6. Open `http://localhost:3000/app/` after the build, or `http://localhost:5173/app/` in development. Create and confirm a profile before running a protected search. To allow the sample demo-store product, include `acme.localhost` in approved websites.

The local API uses a shared `local-user` identity and does not issue or validate API keys. Keep it on a trusted development machine; do not expose it publicly. `MG_API_KEY` shown in examples is for a deployment that supplies its own authentication layer.

## Browser companion

Load the `extension/` directory unpacked from `chrome://extensions` or `edge://extensions` with Developer mode enabled. The extension reads product details from the active tab only after you open it and review the extracted fields. It does not submit purchases; it opens MandateGuard for review and sandbox approval. See [extension/README.md](extension/README.md).

## Tests and security suite

Run automated tests with `npm test`. Run the attack demonstration in replay mode with `LLM_MODE=replay npm run attacks`; matching fixtures are needed for meaningful replay coverage. Missing fixtures fail closed. See [attacks/RESULTS.md](attacks/RESULTS.md) for the recorded run and its settings.

## API and project docs

- [Merchant integration quickstart](docs/INTEGRATION.md)
- [API reference](docs/API.md) and [OpenAPI contract](docs/openapi.yaml)
- [Devpost project write-up](docs/DEVPOST.md)
- [Demo video outline](docs/VIDEO-SCRIPT.md)

## Limitations

The integrated payment path is Sandbox only. Marketplace coverage depends on Channel3 and retailer offers, and external price or availability may change. Page evaluation checks what the page claims; it does not control the retailer's checkout. The unprotected comparison agent can vary between runs, and the security suite is demonstrative rather than a general security evaluation. The local API has no customer authentication or identity isolation. Usage-based API pricing is a hypothesis, not a validated business model.

## License

MIT. See [LICENSE](LICENSE).
