<!-- extension/README.md -->
# MandateGuard browser companion

The Manifest V3 popup checks a product observation against the active default profile. It does not need a task mandate. The extension never submits a purchase itself; it creates a protected proposal and opens the MandateGuard console for review and PayPal approval.

## Install locally

1. Start the backend at `http://localhost:3000` and serve the web app from `/app/`.
2. In Chrome, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select this folder.
3. Open a product page and click the extension. Keep the API URL at `http://localhost:3000`; leave the API key blank for local development.
4. If a default profile exists, review the page details and choose **Check this page**. Otherwise create a profile in the inline form or open **Set preferences** in the web app. The compact form creates, confirms, and sets the new profile as default.

The current manifest only grants `activeTab` and access to `http://localhost:3000/*`. Do not enter a remote API URL with this build; remote origins require an explicitly reviewed host permission. No permissions were added for this change.

Page details are user supplied. The current permission set does not allow the popup to read page DOM or price data, so it pre-fills the active HTTPS page URL and tab title and asks for the displayed price and visible description. It sends the observation only after the user submits it.

The popup calls `GET /v1/profiles`, `POST /v1/profiles`, `POST /v1/profiles/:id/confirm`, `POST /v1/profiles/:id/default`, `POST /v1/mandates`, `POST /v1/evaluate`, `POST /v1/search`, and `POST /v1/proposals`. Page evaluation omits both mandate and profile identifiers so the API selects the confirmed default profile. A task mandate is optional and only used after the user chooses **Narrow to a task**.

The backend does not currently authenticate API keys. Keep it local and do not expose it on a public network.

An allowed evaluation can be sent to the proposal endpoint and opens the console if the backend returns a protected proposal. External page observations may remain advisory and be refused for checkout because the payment service only accepts trusted catalogue products. Alternative search returns evaluated allowed alternatives; choosing one creates a protected proposal before opening the console. The badge displays `OK`, `REV`, or `BLK` for the last evaluation and clears when the tab navigates.

## Tests

Run the extension API and selector tests with `node --test extension/test/*.test.js`. The original popup selector IDs remain `listing-form`, `mandate`, `url`, `title`, `price`, `description`, `submit`, `result`, and `error`.
