# Devpost submission

## Inspiration
People want AI to help them shop, but they cannot safely hand it their money. Product pages can contain misleading claims or text aimed at manipulating an agent, while a proposed cart may not match the buyer's intent.

## What it does
MandateGuard is an authorization gateway for AI shopping agents. Buyers confirm standing preferences or task mandates. An isolated model reports listing claims and possible instructions; a deterministic policy engine evaluates each proposed purchase. The buyer approves controlled demo-store orders in PayPal Sandbox, and the server verifies the exact order before capture. Other stores receive a decision and a link out.

## How we built it
The backend uses Node.js, Express, SQLite, and Zod. Listing extraction uses Gemini or Anthropic in a no-tools JSON pipeline, with replay fixtures. The web console uses React, TypeScript, Vite, and Tailwind CSS. A Manifest V3 extension submits real-page observations. The controlled demo checkout uses PayPal OAuth, Orders v2, PayPal JavaScript SDK approval, and server-side capture verification.

## Challenges we ran into
The key design challenge was separating untrusted seller text from the buyer's authority and payment data. Another was making the checkout boundary explicit: an allowed decision for an external retailer does not mean MandateGuard controls or can verify that retailer's checkout.

## Accomplishments we are proud of
The policy engine is deterministic, extracted instructions are evidence rather than authority, and external listings can be paid only through a disclosed PayPal sandbox simulation. The payment route re-fetches and checks the PayPal order before capture. The audit log records consequential events as a hash chain.

## What we learned
A model's judgment and a payment authorization are different operations. Security claims need clear boundaries: a gateway can validate what it receives and verify a payment it controls, but it cannot enforce rules at an unrelated merchant's checkout.

## What's next
- Validate the usage-based API pricing hypothesis with stores and agent developers.
- Conduct customer discovery with shoppers and agent developers.
- Add a hosted deployment with per-customer API-key issuance and identity isolation.
- Explore production checkout integration after the Sandbox flow is reviewed.
- Add a human-override flow for Needs-review listings.

## Built with
Node.js, Express, better-sqlite3, Zod, React, TypeScript, Vite, Tailwind CSS v4, Motion, Gemini/Anthropic REST APIs, Channel3 API, PayPal Orders API, PayPal JavaScript SDK, and Manifest V3.
