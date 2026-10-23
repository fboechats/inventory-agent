import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod';

const id = z.string().regex(/\S/, 'Use a nonblank ID from a previous tool result');
const integer = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const product = z.object({ id, name: z.string(), sku: z.string(), unitPriceCents: integer, stock: integer });
const quote = z.object({
  id, status: z.literal('draft'), createdAt: z.iso.datetime(),
  items: z.array(z.object({ productId: id, name: z.string(), sku: z.string(), quantity: integer.positive(), unitPriceCents: integer, subtotalCents: integer })),
  totalCents: integer,
});
const created = z.object({ quote, warnings: z.array(z.object({ code: z.literal('INSUFFICIENT_STOCK'), productId: id, requestedQuantity: integer.positive(), availableStock: integer })) });
const availability = 'Stock is an observation only; future availability is not guaranteed. Draft quotes do not reserve stock or confirm a sale.';
const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

export function createServer(options: { baseUrl?: string; fetch?: typeof fetch } = {}) {
  const baseUrl = new URL(options.baseUrl ?? process.env.INVENTORY_API_BASE_URL ?? 'http://127.0.0.1:3000');
  if (!['http:', 'https:'].includes(baseUrl.protocol) || baseUrl.search || baseUrl.hash) {
    throw new Error('INVENTORY_API_BASE_URL must be an HTTP(S) URL without query or fragment');
  }
  const request = options.fetch ?? fetch;
  async function api<T>(path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
    const expectedStatus = body === undefined ? 200 : 201;
    const uncertainCreation = body === undefined ? '' : ' The draft may already have been created; automatic retries may create duplicates. Check API logs before retrying.';
    let response: Response;
    try {
      response = await request(`${baseUrl.href.replace(/\/$/, '')}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new Error(`Cannot reach Inventory API at ${baseUrl.origin}. Start the API and check INVENTORY_API_BASE_URL.${uncertainCreation}`);
    }
    let text: string;
    try { text = await response.text(); } catch {
      throw new Error(`Cannot read Inventory API response body (HTTP ${response.status}). Check API logs.${uncertainCreation}`);
    }
    let data: unknown;
    try { data = JSON.parse(text); } catch {
      throw new Error(`Inventory API returned non-JSON (HTTP ${response.status}). Check the API URL and server logs.${uncertainCreation}`);
    }
    if (!response.ok) {
      const detail = z.object({ error: z.string() }).safeParse(data);
      const advice = response.status === 404 ? 'Check the product or quote ID using the catalog or saved quote ID.'
        : response.status === 400 ? 'Check IDs and positive safe-integer quantities; the API also validates combined quantities and amounts.'
        : `Check API logs before retrying.${uncertainCreation}`;
      throw new Error(`Inventory API HTTP ${response.status}: ${detail.success ? detail.data.error : 'Request failed'}. ${advice}`);
    }
    if (response.status !== expectedStatus) {
      throw new Error(`Inventory API returned unexpected HTTP ${response.status}; expected HTTP ${expectedStatus}. Check the API version and logs.${uncertainCreation}`);
    }
    const parsed = schema.safeParse(data);
    if (!parsed.success) throw new Error(`Inventory API response does not match the expected contract. Check the API version and logs.${uncertainCreation}`);
    return parsed.data;
  }
  const server = new McpServer({ name: 'inventory-agent', version: '1.0.0' });
  function register<I extends z.ZodRawShape, O extends z.ZodRawShape>(
    name: string, title: string, description: string, inputSchema: z.ZodObject<I>, outputSchema: z.ZodObject<O>,
    annotations: typeof readOnly, run: (input: z.infer<z.ZodObject<I>>) => Promise<z.infer<z.ZodObject<O>>>,
  ) {
    server.registerTool(name, { title, description, inputSchema, outputSchema, annotations }, async input => {
      try {
        const result = await run(input);
        return { content: [{ type: 'text' as const, text: JSON.stringify(result) }], structuredContent: result };
      } catch (error) {
        return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : 'Inventory API request failed. Check API logs.' }] };
      }
    });
  }
  register('search_products', 'Search product catalog',
    'Find all catalog products whose name or SKU contains the query (case-insensitive). Returns IDs, names, SKUs, prices in BRL cents and current stock. Never choose an ambiguous match automatically; ask the user to select an ID. Stock does not guarantee future availability.',
    z.strictObject({ query: z.string().trim().min(1).describe('Name or SKU text to search; all matching products are returned') }),
    z.object({ products: z.array(product), availability: z.string() }), readOnly,
    async ({ query }) => ({ products: (await api('/products', z.array(product))).filter(p => [p.name, p.sku].some(value => value.toLowerCase().includes(query.toLowerCase()))), availability }));
  register('check_stock', 'Check observed stock', 'Look up current observed stock for an exact product ID. This observation does not promise future availability.',
    z.strictObject({ productId: id.describe('Exact product ID from search_products') }),
    z.object({ productId: id, stock: integer, availability: z.string() }), readOnly,
    async ({ productId }) => {
      const found = (await api('/products', z.array(product))).find(p => p.id === productId);
      if (!found) throw new Error('Product not found. Use search_products to choose an existing product ID.');
      return { productId, stock: found.stock, availability };
    });
  register('create_quote', 'Create draft quote', 'Create a saved draft via POST /quotes using explicit product IDs and positive integer quantities. Returns commercial snapshots, BRL cent prices, total and temporary stock warnings. Never reserves stock or confirms a sale. Availability is not guaranteed. Creates a new draft on every call.',
    z.strictObject({ items: z.array(z.strictObject({ productId: id.describe('Exact product ID selected from search_products'), quantity: integer.positive().describe('Positive safe integer quantity') })).min(1).describe('Products and requested quantities; API combines duplicate IDs') }),
    created.extend({ availability: z.string() }), { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    async input => ({ ...await api('/quotes', created, input), availability }));
  register('get_quote', 'Retrieve saved draft quote', 'Retrieve GET /quotes/:id commercial snapshots and BRL cent totals. Saved quotes contain no historical stock availability or stock warnings; do not infer either from a saved quote.',
    z.strictObject({ quoteId: id.describe('Saved quote ID returned by create_quote') }), z.object({ quote }), readOnly,
    async ({ quoteId }) => ({ quote: await api(`/quotes/${encodeURIComponent(quoteId)}`, quote) }));
  return server;
}
