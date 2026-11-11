# MandateGuard

MandateGuard is a permission-aware purchasing demo. AI can propose products, but a deterministic policy engine checks each proposal against a buyer-confirmed mandate. Only an allowed protected proposal can enter PayPal checkout, and capture is verified against the stored proposal before the server calls PayPal.

## Problem

Shopping agents read seller-controlled listing text. That text can contain instructions that try to change a budget, claim buyer approval, add products, or pressure an agent to act quickly. MandateGuard treats listing descriptions as untrusted data and keeps the buyer's mandate separate from the quarantined extractor.

## Demo walkthrough

Create a natural-language mandate and confirm the proposed limits. Run the naive comparison agent against the catalogue and compare it with protected mode. The malicious `p_a1` bundle listing attempts to override the budget; the protected policy checks its trusted price, bundle status, merchant, and extracted signals. The legitimate `p_ok_1` mouse is the lower-priced approved candidate for the standard $30 mouse mandate. A buyer can then approve a protected proposal in the PayPal sandbox through `public/checkout-harness.html`; the server verifies the exact order before capture.

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
2. Copy `.env.example` to `.env`; keep the supplied replay mode unless you have configured an LLM provider and model.
3. Create PayPal sandbox business and personal accounts and configure the sandbox client ID, secret, base URL, and business email in `.env`.
4. For live extraction, set `LLM_MODE=record` and configure `LLM_PROVIDER`, `LLM_MODEL`, and `LLM_API_KEY`; replay mode requires the corresponding recorded fixtures.
5. Run `npm start`.
6. Run `npm test`; use `scripts/smoke.sh` for the mandate and agent API flow and `public/checkout-harness.html` to exercise sandbox checkout.

## Tests and attack suite

Run the tests with `npm test`. Reproduce the recorded attack suite without an API key with `LLM_MODE=replay npm run attacks`; the fixtures under `server/fixtures/llm` are required for a complete replay. The suite writes per-case output to `attacks/RESULTS.md` and `attacks/results.json`.

When required fixtures are absent, extraction fails closed and the generated report records those mismatches; that run is not a complete model evaluation.

## Limitations

This protects only purchases routed through this server. The catalogue is curated, the attack suite is a small demonstration rather than a general security evaluation, and payments run in PayPal Sandbox only. PayPal and LLM availability and features vary by country and account.

## License

MIT. See [LICENSE](LICENSE).
