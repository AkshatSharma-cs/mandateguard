# MandateGuard web app

## Run in mock mode

From the repository root, install dependencies once with `npm install` and `npm --prefix web install`. The checked-in `web/.env.local` selects mock mode with `VITE_USE_MOCK=true`. Start the frontend with:

```sh
npm --prefix web run dev
```

Open `http://localhost:5173/app/`.

## Run against the backend

Set `VITE_USE_MOCK=false` in `web/.env.local`, start the backend from the repository root with `npm start`, and start the frontend with `npm --prefix web run dev`. Vite proxies `/api` and `/attacks` to `http://localhost:3000`. Configure PayPal Sandbox credentials on the backend; the public client id is fetched from `/api/config/public`.

## Build

Run `npm run build` from this directory. Vite writes the production app to `../public/app`. From the repository root, `npm run build:web` runs the same build.

## Folder structure

```text
src/
  api/          API client, mock implementation and fixtures
  components/   shared shell, PayPal checkout and UI primitives
  lib/          motion settings
  pages/        Home, Console and Security tests pages
  state/        application state provider
  types.ts      API and view data types
../public/app/  generated production output
```
