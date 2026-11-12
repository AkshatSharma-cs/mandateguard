<!-- docs/INTEGRATION.md -->
# Merchant and agent integration

The local demo storefront is the merchant for store checkout. A Channel3 result or a real page may be paid only as a clearly disclosed PayPal sandbox simulation: MandateGuard does not purchase it from the store and no real money moves.

## Six-step flow

1. The AI agent proposes a product and cart contents.
2. The merchant backend submits the observation to `POST /v1/evaluate` under the buyer's default confirmed profile.
3. The gateway returns `ALLOW`, `REVIEW`, or `BLOCK`, with reasons and up to three allowed alternatives.
4. Any allowed, fresh observation with a known price and matching currency can be converted with `POST /v1/proposals`; server-computed `payment_mode` is `store_checkout` or `sandbox_simulation`.
5. MandateGuard creates a PayPal Sandbox order; external listings use the explicit simulation disclosure. The buyer approves it using the PayPal JavaScript SDK.
6. The merchant/store backend calls capture; MandateGuard verifies the exact approved order before capture. The audit trail records the actions.

```text
Shopper        AI agent       Merchant backend       MandateGuard       PayPal
   |               |                  |                    |               |
   |-- limits ---->|                  |                    |               |
   |               |-- proposed item->|                    |               |
   |               |                  |-- evaluate ------->|               |
   |               |                  |<- decision/reasons-|               |
   |               |                  |-- proposal ------->|               |
   |               |                  |<- proposal id -----|               |
   |<---------------- PayPal Sandbox approval UI ------------------------->|
   |               |                  |-- create order ------------------->|
   |               |                  |<- order id -----------------------|
   |               |                  |-- capture + verify --------------->|
   |               |                  |<- capture result -----------------|
   |               |                  |    audit chain records events     |
```

## Local API use

Start the backend and web app (`npm run dev`), create and confirm a profile in Preferences, and include `acme.localhost` in its approved websites to allow the sample product. Configure a PayPal Sandbox business app/account if you want to complete checkout. Local API routes currently use the shared `local-user` identity and do **not** issue or validate API keys. `MG_API_KEY` is accepted by the example as a bearer header for deployments that provide their own gateway authentication, but it is not a local credential and there is no key-creation endpoint in this repository. Keep the local server private.

For a demo-store product, the gateway resolves the submitted curated product id against its own catalogue. Client-supplied price, seller, category, description, and `checkout_mode` do not establish gateway eligibility.

```sh
# Evaluate with the default confirmed profile. The response contains evaluation_id.
curl -X POST http://localhost:3000/v1/evaluate \
  -H 'content-type: application/json' \
  -d '{"observation":{"observation_id":"p_ok_1","url":"http://acme.localhost:3000/demo-store/p_ok_1.html","domain":"acme.localhost","source":"curated","title":"client title is ignored for this trusted catalogue id","price_cents":2499,"currency":"USD","seller":"Acme","sold_by_merchant":true,"availability":"in stock","image_url":null,"category_hint":"mouse","bundle_signal":false,"hidden_text_found":false,"text":"client text is ignored for this trusted catalogue id","captured_at":"2026-11-12T12:00:00.000Z","content_hash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}'

# Use the returned evaluation_id. Only gateway ALLOW results can create proposals.
curl -X POST http://localhost:3000/v1/proposals \
  -H 'content-type: application/json' \
  -d '{"evaluation_id":"EVALUATION_ID"}'

# One-command merchant-side example; choose a product id from GET /api/catalogue.
node examples/merchant-agent.js p_ok_1
```

`POST /v1/proposals` returns `{ proposal, console_url }`, including server-computed `payment_mode`, `simulated`, and (for simulations) `disclosure`. Open the console URL to approve via PayPal Sandbox. After capture, `GET /api/proposals/:id/receipt` (also available under `/v1` and `/api/v1`) returns the product, PayPal ids, V1–V12 checks, audit status, and the simulation disclosure.

The equivalent payment calls are shown here for a merchant that owns the approval UI. Call capture only after the buyer approves the returned PayPal order:

```sh
curl -X POST http://localhost:3000/api/proposals/PROPOSAL_ID/checkout \
  -H 'content-type: application/json' -d '{}'

curl -X POST http://localhost:3000/api/proposals/PROPOSAL_ID/capture \
  -H 'content-type: application/json' \
  -d '{"order_id":"APPROVED_PAYPAL_ORDER_ID"}'
```

For page observations or Channel3 results, send `source: "page"` or `source: "channel3"`. Their `checkout_mode` is `handoff`, so `POST /v1/evaluations/:id/handoff` remains available for “Open at store.” A separate allowed Buy now creates a disclosed sandbox simulation proposal and PayPal order.

```sh
curl -X POST http://localhost:3000/v1/evaluations/EVALUATION_ID/handoff \
  -H 'content-type: application/json' -d '{}'
```

See [OpenAPI](openapi.yaml) and [API.md](API.md) for schemas and the rest of the endpoints.

## What the gateway guarantees and what it does not

It validates a proposed cart against the confirmed mandate and verifies the exact PayPal order before capture. It does not purchase from stores it does not host; the sandbox order is a simulation. It does not stop someone who has the buyer's PayPal credentials, and judges what a page claims.
