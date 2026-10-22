# Inventory Agent

A local Node.js 22 / TypeScript API using Fastify and better-sqlite3. The core QuoteService owns draft creation, duplicate aggregation, commercial snapshots, and temporary stock warnings.

## Run

From the repository root:

```sh
npm install
npm run dev
```

The API listens on `http://127.0.0.1:3000`. Configure `PORT`, `HOST`, and `DATABASE_PATH` through environment variables:

```sh
DATABASE_PATH=/tmp/inventory.sqlite PORT=3001 npm run dev
```

The default database is `apps/api/data/inventory.sqlite` when launched through npm workspace scripts (paths are relative to the API working directory). Parent directories are created automatically. For a non-watching process, use `npm start --workspace @inventory-agent/api`.

On first opening a database, a transactional SQL migration creates `products`, `quotes`, and `quote_items`, then seeds three fictional products: `notebook`, `pen`, and `mug`. `PRAGMA user_version` tracks schema version 1. Reopening preserves data and does not reseed. Local SQLite files and their journal/WAL files are ignored by Git. better-sqlite3 uses a native addon; installation may require a C++ build toolchain if no prebuilt binary is available.

## API

```sh
curl http://127.0.0.1:3000/products

curl -i http://127.0.0.1:3000/quotes \
  -H 'Content-Type: application/json' \
  -d '{"items":[{"productId":"notebook","quantity":2},{"productId":"mug","quantity":1}]}'

# Replace QUOTE_ID with the UUID returned by POST.
curl http://127.0.0.1:3000/quotes/QUOTE_ID
```

- `GET /products` returns a product array with current stock and integer prices in cents.
- `POST /quotes` returns HTTP 201 with `{ "quote": {...}, "warnings": [...] }`. The quote has `id`, `status: "draft"`, `createdAt` (UTC ISO 8601), `items`, and `totalCents`. Each item snapshots `productId`, `name`, `sku`, `quantity`, `unitPriceCents`, and `subtotalCents`.
- `GET /quotes/:id` returns the quote directly. It reads persisted snapshots, even if a product is changed or deleted. It never returns stock or warnings.

Insufficient or zero stock **allows creation** and produces an `INSUFFICIENT_STOCK` warning only in that POST response. Warnings are never stored; creation neither reserves nor modifies stock. Quote and item inserts commit together or roll back together.

JSON input is strict: quantities must be positive safe integers, IDs must contain a non-whitespace character, items must be nonempty, and extra fields (including client prices) are rejected. Duplicate product IDs are combined. Invalid bodies, unsafe combined quantities, and unsafe calculated amounts return HTTP 400. Missing products and quotes return HTTP 404; unsupported content types return HTTP 415. Unexpected failures return HTTP 500 with a generic error. Errors use `{ "error": "..." }`.

## Verify

```sh
npm test
npm run typecheck
```

Tests exercise the core and all API routes using Fastify injection without listening on a port. API tests use isolated in-memory databases plus a temporary file for restart persistence, and cover rollback, snapshots, warnings, validation, and not-found responses. `buildApp` accepts a database connection owned by its caller; the listening entrypoint handles connection shutdown.
