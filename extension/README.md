<!-- extension/README.md -->
# MandateGuard browser companion

The Manifest V3 popup checks a product observation against the active default profile. It does not need a task mandate. The extension never submits a purchase itself; it creates a protected proposal and opens the MandateGuard console for review and PayPal approval.

## Install locally

1. Start the backend at `http://localhost:3000` and serve the web app from `/app/`.
2. In Chrome or Edge, open `chrome://extensions` or `edge://extensions`, enable Developer mode, choose **Load unpacked**, and select this folder.
3. Open a product page and click the extension. Keep the API URL at `http://localhost:3000`; leave the API key blank for local development.
4. If a default profile exists, review the page details and choose **Check this page**. Otherwise create a profile in the inline form or open **Set preferences** in the web app. The compact form creates, confirms, and sets the new profile as default.

The Manifest V3 popup uses `activeTab`, `scripting`, and `storage`. It requests access to a non-local API origin only when you save that address. The background service worker sends API requests with a 15 second timeout.

The popup injects `content/extract.js` only into the active tab after it is opened. The extractor reads JSON-LD Product, Open Graph metadata, microdata, a small set of visible product selectors, and visible text. It never reads cookies, form fields, or the full DOM. Review the extracted fields before submitting.

Only the extracted product fields are sent to the API: URL, domain, title, price, currency, seller when available, availability, bundle signal, hidden-text flag, and up to 4,000 characters of visible product text. Cookies, form fields, and unrelated page content are not sent. Selectors used are `script[type="application/ld+json"]`, Open Graph/product price metadata, `[itemprop="name"]`, `[itemprop="price"]`, `h1`, `[data-price]`, `#feature-bullets li`, `[data-feature]`, `.a-unordered-list .a-list-item`, `[itemprop="description"]`, `#productDescription`, and `main p`.

The popup calls `GET /v1/profiles`, `POST /v1/profiles`, `POST /v1/profiles/:id/confirm`, `POST /v1/profiles/:id/default`, `POST /v1/mandates`, `POST /v1/evaluate`, `POST /v1/search`, `POST /v1/proposals`, and `POST /v1/evaluations/:id/handoff`. Page evaluation omits both mandate and profile identifiers so the API selects the confirmed default profile. A task mandate is optional and only used after the user chooses **Narrow to a task**.

The backend does not currently authenticate API keys. Keep it local and do not expose it on a public network.

Page observations use `checkout_mode: handoff` for the separate **Open at store** action. An Allowed listing also offers **Buy now** as a disclosed PayPal sandbox simulation: nothing is purchased from the retailer and no real money moves. Payment completes in the web app. Blocked and review listings never show Buy now. The badge displays `OK`, `REV`, or `BLK` for the last evaluation and clears when the tab navigates.

The active page may be denied by the browser (browser settings pages, extension stores, and file URLs cannot be checked). The extractor uses JSON-LD Product, `og:title`, `product:price:amount`, `[itemprop="name"]`, `[itemprop="price"]`, `h1`, and common Amazon feature selectors; sites with unusual markup may need a manual correction.

## Tests

Run the extension API and selector tests with `node --test extension/test/*.test.js`. The original popup selector IDs remain `listing-form`, `mandate`, `url`, `title`, `price`, `description`, `submit`, `result`, and `error`.

## Manual test plan

1. Load the unpacked folder in Chrome or Edge and configure the local API address.
2. Open a product page, click MandateGuard, and confirm the extracted title, URL, price, currency, and visible text.
3. Check an Allowed product and confirm the toolbar badge and the **Buy now** sandbox disclosure.
4. Continue to PayPal in the web app; for an external store, verify the order description starts with `SANDBOX SIMULATION` and the receipt says nothing was bought from the retailer.
5. Check a blocked and a review listing; neither should show **Buy now**. Confirm **Open at store** opens the original listing.
