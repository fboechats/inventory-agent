# Inventory Agent

A local inventory and draft quote MVP with a React / Vite / Tailwind CSS frontend and a Node.js 22 / TypeScript API using Fastify and better-sqlite3. The core QuoteService owns draft creation, duplicate aggregation, commercial snapshots, and temporary stock warnings.

## Run

From the repository root:

```sh
npm install
npm run dev:api
```

In a second terminal, start the frontend:

```sh
npm run dev:web
```

Open the Vite URL printed in the terminal (normally `http://localhost:5173`). Select products, enter positive whole-number quantities, and create a draft. The result shows saved names, SKUs, unit prices, subtotals, and a BRL total. Copy the quote ID to retrieve it later with “Find quote”. Creation warnings are temporary and disappear when retrieving a saved quote; drafts do not reserve stock. The catalog shows current stock independently of saved quotes.

The web app is the `@inventory-agent/web` npm workspace under `apps/web`. API calls use relative URLs. Vite proxies `/products` and `/quotes` to `http://127.0.0.1:3000`, so no API CORS changes are needed. If you change the API port, update the proxy targets in `apps/web/vite.config.ts`. `npm run dev` remains an alias for starting the API only.

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
npm run build:web
```

Tests exercise the core and all API routes using Fastify injection without listening on a port. API tests use isolated in-memory databases plus a temporary file for restart persistence, and cover rollback, snapshots, warnings, validation, and not-found responses. `buildApp` accepts a database connection owned by its caller; the listening entrypoint handles connection shutdown.

The root test and typecheck commands include every workspace. Frontend tests use Vitest, jsdom, and Testing Library with mocked HTTP responses to cover creation payloads, snapshot rendering, transient warnings, retrieval, validation, loading, empty catalogs, and API errors. `npm run build:web` verifies a production bundle in `apps/web/dist`; production hosting must route `/products` and `/quotes` to the API separately because the Vite proxy is development-only. No authentication, product editing, or stock reservation is included.

## MCP server (Milestone 1D)

`apps/mcp` exposes the REST API to local AI clients through the official MCP TypeScript SDK v2 (`@modelcontextprotocol/server`) over stdio, with Zod v4 input and output schemas. It has no database access or QuoteService dependency. Node.js 22+ is required.

Start the API in one terminal with `npm run dev:api`. In another, launch MCP Inspector from the repository root:

```sh
npm run inspect:mcp
# Equivalent:
npx @modelcontextprotocol/inspector node --import tsx apps/mcp/src/index.ts
```

Connect using stdio, then open Tools to list and call the four tools. The direct server command is `node --import tsx apps/mcp/src/index.ts` (repository root working directory). `npm run start:mcp --silent` also starts it; the silent flag suppresses npm banners on protocol stdout. `npm run dev:mcp --silent` enables watching for development. Diagnostics use stderr.

For a local MCP host, configure an entry like this, replacing the absolute paths with your checkout and Node executable as needed:

```json
{
  "mcpServers": {
    "inventory-agent": {
      "command": "node",
      "args": ["--import", "tsx", "/absolute/path/inventory-agent/apps/mcp/src/index.ts"],
      "cwd": "/absolute/path/inventory-agent",
      "env": { "INVENTORY_API_BASE_URL": "http://127.0.0.1:3000" }
    }
  }
}
```

`INVENTORY_API_BASE_URL` defaults to `http://127.0.0.1:3000`; set it in the MCP process environment if the API runs elsewhere. HTTP requests time out after 10 seconds. The API must be running separately. This milestone provides no authentication or remote hosting.

- `search_products({"query":"pen"})` fetches the catalog and returns **all** case-insensitive name/SKU substring matches, including IDs, names, SKUs, integer BRL cent prices and observed stock. It never selects among ambiguous matches. No matches returns an empty array.
- `check_stock({"productId":"pen"})` finds an exact ID in the current catalog. Stock is an observation, with no promise of future availability.
- `create_quote({"items":[{"productId":"pen","quantity":2}]})` calls `POST /quotes`. It returns the saved draft snapshots, total and temporary warnings, with an explicit availability notice. This changes state, is non-destructive and non-idempotent: repeating it creates another draft. It neither reserves stock nor confirms a sale. API business rules handle duplicate quantities and commercial calculations.
- `get_quote({"quoteId":"QUOTE_ID"})` calls `GET /quotes/:id` and returns `{ "quote": {...} }` containing saved commercial snapshots only. It provides no historical stock or stock warnings.

Every success includes both structured content and a JSON text representation. Query tools are annotated read-only and idempotent. Invalid tool inputs are rejected before HTTP; API failures and invalid response contracts become actionable tool errors. Failed or timed-out creation requests may have created a draft: do not automatically retry when the outcome is unknown.

`npm test` and `npm run typecheck` include this workspace. MCP tests use an SDK client to exercise discovery, schemas, annotations, results and errors, plus a real subprocess stdio handshake. HTTP tool tests mock REST responses; existing API tests independently verify persistence and business rules. Inspector's browser UI is a manual check.

## Manual agent evaluation fixtures (Milestone 1E, phase 1)

Run `npm run eval:setup --silent` to create a fresh, isolated temporary SQLite database and print its absolute path. Setup reuses the API initializer and adds two distinguishable glove products for ambiguity testing. It never resets or opens the development database, and each run starts with no quotes.

See [the evaluation guide](docs/evaluation/README.md) for exact API/MCP startup commands, the deterministic catalog, five manual scenarios and objective pass/fail criteria. Copy [the results template](docs/evaluation/results-template.md) to record actual agent tool calls and outcomes. These scenarios have not been executed by a model as part of fixture setup or unit tests.
