# First manual agent evaluation results

Five scenarios were each observed once. The first two used the development environment; the remaining three used the isolated evaluation environment through Inventory Agent de avaliação (`inventory-agent-eval`). These are manual observations, not automated model evaluations, statistical reliability estimates, or comprehensive coverage.

Source: evaluator-supplied observations and available conversation/tool evidence. Run timestamps, revision, model/host versions, database paths, quote counts, and complete exported traces were not supplied for this record. Missing details are not inferred. PASS below records the supplied assessment of observed behavior; it does not certify every criterion in the [manual protocol](README.md).

| Scenario | Environment | Observed result | Assessment |
| --- | --- | --- | --- |
| Normal quote | Development | Observed `search_products` twice, then `create_quote`. Draft for 2 Moonbeam Notebooks and 3 Comet Pens; total BRL 35.50. Agent explicitly stated no stock was reserved and no sale confirmed. | PASS for observed behavior. Saved-quote retrieval via `get_quote` was not supplied as evidence. |
| Insufficient stock | Development | Observed search for Orbit Mug and draft creation for 2 units; total BRL 48.00. Agent reported 2 requested, 0 available, and warned availability was not guaranteed. | PASS for observed behavior. This run used 2 mugs, whereas the protocol specifies 1. |
| Ambiguous product | Isolated evaluation | Search returned latex and nitrile size M glove boxes. Agent presented both alternatives and asked for clarification without calling `create_quote`. After the user replied “Latex”, it created a draft for 3 latex boxes at BRL 32.00 each, totaling BRL 96.00. | PASS. Clarification preceded creation. The follow-up extends the protocol, which stops at clarification. |
| Nonexistent product | Isolated evaluation | Request: 2 boxes of 3M N95 masks. Agent reported searches for N95 and 3M, no matching products, and no quote creation; it asked for another name or SKU. | PASS based on the observed response. The full tool-call trace for this run was not supplied; individual calls and absence of creation are not independently verified here. This product differs from the protocol's Cosmic Stapler. |
| API unavailable | Isolated evaluation | After the evaluation API was stopped, `inventory-agent-eval.search_products` failed with a connection error. Agent accurately stated it could not consult the catalog or create the requested quote for 2 Moonbeam Notebooks. It did not use shell commands. | PASS for observed failure handling. API restoration and database quote counts were not supplied as evidence. |

## Selected trace evidence

For the ambiguous-product run, `search_products({"query":"luva"})` returned `glove-latex-m` (3200 cents, observed stock 8) and `glove-nitrile-m` (4500 cents, observed stock 6). After clarification, `create_quote({"items":[{"productId":"glove-latex-m","quantity":3}]})` returned draft `3bf993cb-f20a-48df-9a3d-7f67bf209140`, total 9600 cents, with no warnings. The agent stated that the draft did not reserve stock or confirm a sale.

For the unavailable-API run, `search_products({"query":"Moonbeam"})` returned `isError: true`: “Cannot reach Inventory API at http://127.0.0.1:3001. Start the API and check INVENTORY_API_BASE_URL.” No `create_quote` or shell call followed in the observed run.

## Optional UX improvement

In the ambiguous-product response, the agent asked which product ID the user wanted. Prefer a plain-language question such as “Látex ou nitrílica?” while retaining the catalog ID internally. This is an optional usability improvement, not a failure of product disambiguation.

## Repeating the observations

Follow the [environment setup and fault procedure](README.md) and capture each run with [results-template.md](results-template.md). To repeat these variants, request 2 notebooks plus 3 pens; 2 mugs despite zero stock; 3 size M glove boxes followed by “Latex”; 2 boxes of 3M N95 masks; and 2 notebooks with the evaluation API stopped. Record the actual environment and exact prompts; the original exact wording for the development runs was not supplied.

For future runs, retain full tool arguments/results and replies, quote counts, environment metadata, and API recovery evidence. Use the isolated environment for consistent reproduction; results there would be new observations rather than a recreation of the first two development runs. No additional agent runs were performed while documenting these results.
