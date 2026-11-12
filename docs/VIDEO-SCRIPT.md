# Demo video script — 2:45

## 0:00 — Problem
**Spoken:** Shopping agents can read product pages that contain misleading claims or instructions aimed at the agent. A proposal that looks reasonable can still exceed what the buyer asked for.

**On screen:** Open the MandateGuard overview and show the injected listing scenario. If the live page is unavailable, use the checked-in attack fixture.

## 0:15 — Thesis
**Spoken:** AI proposes. MandateGuard validates. You authorize. PayPal executes.

**On screen:** Show the gateway flow from proposal through verified order.

## 0:25 — Preferences and task
**Spoken:** I set a spending ceiling and merchant rules, confirm them, then create a task within those limits.

**On screen:** Create a profile and task, review the limits, and confirm. If parsing is unavailable, use the structured preferences form and a prepared task.

## 0:50 — Compare agents
**Spoken:** Both agents see the same listings. The unprotected agent chooses a $79.99 bundle whose text says to ignore the budget. MandateGuard blocks it, shows the sentence as evidence, and offers an allowed alternative.

**On screen:** Run both agents. Expand the blocked bundle evidence and show the alternative. If live LLM output differs, switch to the recorded replay fixture and identify it as replay.

## 1:25 — Controlled checkout
**Spoken:** This is the MandateGuard demo store. I review the PayPal Sandbox order and approve it. The server checks the exact order before capture, then the audit trail records the result.

**On screen:** Click Buy now, confirm the disclosed sandbox simulation when using an external store, approve using the Sandbox buyer, show all 12 verification checks and the verified audit chain. If Sandbox approval is unavailable, show the order and refused/error state; do not imply capture succeeded.

## 2:00 — External store boundary
**Spoken:** A real page from the browser extension and a live marketplace result can still be evaluated. For stores MandateGuard does not host, it gives a decision and opens the merchant page. Their checkouts remain outside MandateGuard.

**On screen:** Submit a real product observation in the extension and show Open at the retailer domain. If Channel3 is unavailable, use a saved observation and label it as such.

## 2:20 — API
**Spoken:** A merchant backend can submit an observation to the same evaluate endpoint. Buy now creates a PayPal sandbox order for the exact approved product. For stores MandateGuard does not host, this simulates the purchase: nothing is bought from the store.

**On screen:** Run `node examples/merchant-agent.js p_ok_1` or show one curl request to `/v1/evaluate`. If no confirmed profile exists, create one first or show the API's `NO_PREFERENCES` response.

## 2:35 — Limits and close
**Spoken:** The PayPal flow is Sandbox only. An external listing uses a clearly disclosed simulation, and nothing is bought from its retailer. MandateGuard keeps the buyer in control.

**On screen:** Show the checkout-boundary note and project repository.
