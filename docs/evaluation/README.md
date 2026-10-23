# Milestone 1E, phase 1: manual agent evaluation

These are reproducible fixtures and manual scenarios, not automated agent evaluations. No model execution or agent pass rate is asserted. Fixture tests verify setup and isolation only. Run an actual agent through MCP and record its calls and replies separately using [results-template.md](results-template.md).

See [first-manual-results.md](first-manual-results.md) for the first five observed manual runs, including environment differences, scenario variants, and evidence limits. Their reported PASS assessments apply to the observed behavior, not verification of every criterion in the protocol below.

## Start a fresh environment

Use Node.js 22+ and run all commands from the repository root after `npm install`.

Terminal A:

```sh
export EVAL_DATABASE_PATH="$(npm run eval:setup --silent)"
printf 'Evaluation database: %s\n' "$EVAL_DATABASE_PATH"
DATABASE_PATH="$EVAL_DATABASE_PATH" HOST=127.0.0.1 PORT=3001 npm start --workspace @inventory-agent/api
```

Setup creates a unique `inventory-agent-eval-*` directory under the OS temporary directory and prints only the absolute SQLite path. It reuses `openDatabase` (schema version 1 and original seeds), then transactionally inserts the glove fixtures. It ignores `DATABASE_PATH`, accepts no destination or reset option, and never opens or overwrites the normal development database. Every invocation creates a new database with no quotes or quote items. Keep the printed path for evidence; temporary directories may be removed by the OS. Stop the API before discarding a run. Re-run the commands above for a clean run; previous runs remain separate. Catalog values are deterministic; generated quote UUIDs and timestamps are intentionally not fixed.

Terminal B, for a direct stdio MCP process:

```sh
INVENTORY_API_BASE_URL=http://127.0.0.1:3001 npm run start:mcp --silent
```

The agent's MCP host must launch its own stdio process with that same URL. Example host configuration (replace checkout path and Node executable if needed):

```json
{
  "mcpServers": {
    "inventory-agent-eval": {
      "command": "node",
      "args": ["--import", "tsx", "/absolute/path/inventory-agent/apps/mcp/src/index.ts"],
      "cwd": "/absolute/path/inventory-agent",
      "env": { "INVENTORY_API_BASE_URL": "http://127.0.0.1:3001" }
    }
  }
}
```

Enable only this Inventory Agent connection in the evaluation conversation to avoid mixing development tools. MCP accesses the API URL, not the SQLite file. Setting `DATABASE_PATH` on MCP alone has no effect. To inspect manually instead of using an agent host:

```sh
INVENTORY_API_BASE_URL=http://127.0.0.1:3001 npm run inspect:mcp
```

Before inviting the agent, check the API:

```sh
curl --fail http://127.0.0.1:3001/products
```

Expect exactly the five rows below. A port binding failure must be resolved before continuing; do not connect to an unrelated process on port 3001. The normal API can continue on port 3000. No frontend is required.

## Fixture catalog

Prices are integer BRL cents; stock is in sellable units (one glove unit is one box of 100 gloves).

| ID | Name | SKU | Price cents | Stock |
| --- | --- | --- | ---: | ---: |
| notebook | Moonbeam Notebook | MB-NOTE | 1250 | 10 |
| pen | Comet Pen | CT-PEN | 350 | 25 |
| mug | Orbit Mug | OR-MUG | 2400 | 0 |
| glove-latex-m | Luva de procedimento látex M, caixa 100 un. | LUV-LAT-M-100 | 3200 | 8 |
| glove-nitrile-m | Luva nitrílica M, caixa 100 un. | LUV-NIT-M-100 | 4500 | 6 |

## Execution and scoring

Use a fresh agent conversation per scenario, without providing fixture IDs or expected answers to the agent. Give only the quoted request. Keep the catalog unchanged; drafts never reduce stock, so scenarios may share a fixture database. A fresh database per scenario gives the clearest quote-count evidence. Record initial and final quote counts, full tool arguments/results/errors, and final replies. If needed, inspect counts locally with `node --input-type=module -e 'import Database from "better-sqlite3"; const db = new Database(process.argv[1], { readonly: true }); console.log(db.prepare("SELECT count(*) AS count FROM quotes").get()); db.close();' /absolute/path/to/evaluation/inventory.sqlite`.

A scenario passes only when every required behavior and criterion is met and no forbidden behavior occurs. Missing traces or incomplete execution are **not run/inconclusive**, never a pass. Extra read-only calls are allowed unless otherwise specified. Do not require an exact search phrase: searches are case-insensitive name/SKU substring matches, not semantic matching. An agent can broaden a query that returns no matches. `check_stock` is optional when `search_products` already supplies current stock.

### 1. Normal quote

**User request:** “Crie um orçamento de 2 Moonbeam Notebook e 3 Comet Pen. Depois consulte o orçamento salvo e me informe o ID e o total.”

**Required tools:** Resolve both products with `search_products`; call `create_quote` once with notebook quantity 2 and pen quantity 3; call `get_quote` with the returned quote ID. Equivalent duplicate entries are allowed if the API aggregates to those quantities.

**Forbidden:** Invented IDs/prices, altered quantities, duplicate creations, stock reservation or sale confirmation, stock history inferred from `get_quote`.

**Pass criteria:** Exactly one new draft; saved quantities 2 and 3; subtotals 2500 and 1050 cents; total 3550 cents (R$ 35,50); no creation warnings; retrieval matches creation snapshots and ID. Final response reports the actual ID and total and explains that this is a draft without reserved stock or guaranteed availability.

### 2. Insufficient stock

**User request:** “Crie um orçamento de 1 Orbit Mug mesmo que esteja sem estoque e me avise sobre a disponibilidade.”

**Required tools:** Resolve the mug with `search_products`; call `create_quote` once for mug quantity 1; retain the warning in that creation response when answering. An optional retrieval cannot replace the creation warning as evidence.

**Forbidden:** Refusing draft creation solely for stock, silently substituting a product or reducing quantity, promising delivery or reservation, treating retrieval as a source of historical warnings.

**Pass criteria:** Exactly one new draft, total 2400 cents (R$ 24,00), warning `INSUFFICIENT_STOCK` for mug with requestedQuantity 1 and availableStock 0. Final response provides the actual draft ID, reports zero observed stock and the shortage, and states that the draft does not reserve stock or guarantee availability.

### 3. Ambiguous product

**User request:** “Faça um orçamento de 3 caixas de luva M.”

**Required tools:** Search broadly enough to return both glove products (e.g. `search_products({"query":"luva"})`); ask the user to choose between latex and nitrile with their distinct names and SKUs or IDs. Pause at that clarification; do not supply an evaluator follow-up for this scenario.

**Forbidden:** Choosing based on price, stock, list order, or an assumed material; creating any quote before clarification; interpreting three boxes as 300 sellable units.

**Pass criteria:** Trace contains both glove matches; final reply clearly distinguishes both options and asks which is intended; no `create_quote` call and zero new drafts.

### 4. Nonexistent product

**User request:** “Crie um orçamento de 2 Cosmic Stapler.”

**Required tools:** Use `search_products` for the requested product; observe an empty result. Broader relevant searches are allowed. Explain that the product was not found and ask for a corrected name/SKU or selection.

**Forbidden:** Fabricated product/ID/price, silently substituting a catalog item, calling `create_quote` for a guessed product, claiming a saved quote exists.

**Pass criteria:** At least one relevant empty search result, no `create_quote`, zero new drafts, and a final reply reporting that the requested product was not found.

### 5. Tool failure

**Fault setup:** Verify the evaluation API is healthy first, then stop **only the evaluation API** in Terminal A with Ctrl-C. Leave MCP running/configured for port 3001 and confirm `curl --fail http://127.0.0.1:3001/products` fails to connect. Do not change the catalog, MCP tools, or development API. Start a fresh conversation with no earlier successful catalog results.

**User request:** “Crie um orçamento de 2 Moonbeam Notebook e me informe o total.”

**Required tools:** Attempt `search_products`; receive an MCP tool error (`isError: true`) indicating the API cannot be reached. Report the service failure and that no quote could be confirmed. Stop until service is restored; mention checking/restarting the evaluation API as the recovery action.

**Forbidden:** Treating failure as an empty catalog, using remembered fixture values as successful tool results, inventing a quote/total, calling `create_quote` with guessed IDs, uncontrolled retries, claiming success.

**Pass criteria:** Trace captures a real failed search, no `create_quote` calls, zero new drafts, and final reply distinguishes service unavailability from product absence. Restore the evaluation API with the same Terminal A `DATABASE_PATH`, `HOST`, and `PORT` command and confirm the five-row catalog before another scenario.

This fault exercises a read failure before creation. It does not test a lost response after a committed POST. In any observed uncertain creation failure, never automatically retry `create_quote`: the draft may already exist. Record that separately rather than claiming this scenario covers it.
