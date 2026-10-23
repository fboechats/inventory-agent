import { afterEach, expect, it, vi } from 'vitest';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createServer } from './server.js';

const products = [
  { id: 'p1', name: 'Blue pen', sku: 'PEN-1', unitPriceCents: 100, stock: 2 },
  { id: 'p2', name: 'Red pen', sku: 'PEN-2', unitPriceCents: 200, stock: 0 },
];
const quote = { id: 'q1', status: 'draft', createdAt: '2026-10-22T00:00:00.000Z', items: [{ productId: 'p1', name: 'Blue pen', sku: 'PEN-1', quantity: 3, unitPriceCents: 100, subtotalCents: 300 }], totalCents: 300 };
const warnings = [{ code: 'INSUFFICIENT_STOCK', productId: 'p1', requestedQuantity: 3, availableStock: 2 }];
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { await Promise.all(cleanups.splice(0).map(fn => fn())); });
async function setup(data: unknown = products, status = 200) {
  const request = vi.fn<typeof fetch>().mockImplementation(async () => Response.json(data, { status }));
  const server = createServer({ baseUrl: 'http://example.test:3001', fetch: request });
  const client = new Client({ name: 'test', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  cleanups.push(() => client.close(), () => server.close());
  return { client, request, call: (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }) };
}
it('advertises four described tools with accurate annotations and schemas', async () => {
  const { client } = await setup();
  const { tools } = await client.listTools();
  expect(tools.map(t => t.name)).toEqual(['search_products', 'check_stock', 'create_quote', 'get_quote']);
  for (const tool of tools) {
    expect(tool.title).toBeTruthy(); expect(tool.description).toBeTruthy(); expect(tool.outputSchema).toBeTruthy();
    expect(tool.annotations).toMatchObject({ readOnlyHint: tool.name !== 'create_quote', destructiveHint: false, idempotentHint: tool.name !== 'create_quote', openWorldHint: true });
  }
});
it('returns every ambiguous name/SKU match and an empty array for no match', async () => {
  const { call, request } = await setup();
  expect((await call('search_products', { query: ' PeN ' })).structuredContent).toMatchObject({ products });
  expect((await call('search_products', { query: 'pen-2' })).structuredContent).toMatchObject({ products: [products[1]] });
  expect((await call('search_products', { query: 'missing' })).structuredContent).toMatchObject({ products: [] });
  expect(request.mock.calls[0][0]).toBe('http://example.test:3001/products');
});
it('returns exact observed stock including zero and actionable missing product errors', async () => {
  const { call } = await setup();
  expect((await call('check_stock', { productId: 'p2' })).structuredContent).toMatchObject({ productId: 'p2', stock: 0, availability: expect.stringContaining('not guaranteed') });
  expect(await call('check_stock', { productId: 'missing' })).toMatchObject({ isError: true, content: [{ type: 'text', text: expect.stringContaining('search_products') }] });
});
it('posts unchanged items and returns draft snapshots, totals and temporary warnings', async () => {
  const { call, request } = await setup({ quote, warnings }, 201);
  const items = [{ productId: 'p1', quantity: 3 }, { productId: 'p1', quantity: 1 }];
  const result = await call('create_quote', { items });
  expect(result.structuredContent).toEqual({ quote, warnings, availability: expect.stringContaining('do not reserve stock') });
  expect(request.mock.calls[0]).toMatchObject(['http://example.test:3001/quotes', { method: 'POST', body: JSON.stringify({ items }) }]);
  expect(JSON.parse((result.content as { text: string }[])[0].text)).toEqual(result.structuredContent);
});
it('retrieves encoded quote IDs and strips any stock/warnings from saved snapshots', async () => {
  const { call, request } = await setup({ ...quote, warnings, stock: 9, items: quote.items.map(item => ({ ...item, stock: 2 })) });
  expect((await call('get_quote', { quoteId: 'a/b?c' })).structuredContent).toEqual({ quote });
  expect(request.mock.calls[0][0]).toBe('http://example.test:3001/quotes/a%2Fb%3Fc');
});
it.each([
  ['search_products', { query: ' ' }], ['check_stock', { productId: '' }], ['get_quote', { quoteId: ' ' }],
  ['create_quote', { items: [] }], ['create_quote', { items: [{ productId: 'p1', quantity: 0 }] }],
  ['create_quote', { items: [{ productId: 'p1', quantity: 1.5 }] }],
  ['create_quote', { items: [{ productId: 'p1', quantity: Number.MAX_SAFE_INTEGER + 1 }] }],
  ['create_quote', { items: [{ productId: 'p1', quantity: 1, unitPriceCents: 1 }] }],
])('rejects invalid %s arguments before HTTP', async (name, args) => {
  const { call, request } = await setup();
  expect(await call(name as string, args as Record<string, unknown>)).toMatchObject({ isError: true });
  expect(request).not.toHaveBeenCalled();
});
it.each([400, 404, 500])('returns actionable API HTTP %s tool errors', async status => {
  const { call } = await setup({ error: 'API detail' }, status);
  expect(await call('get_quote', { quoteId: 'q' })).toMatchObject({ isError: true, content: [{ type: 'text', text: expect.stringContaining(`HTTP ${status}: API detail`) }] });
});
it('handles connections, non-JSON responses and invalid response contracts', async () => {
  const { call, request } = await setup();
  request.mockRejectedValueOnce(new Error('connection refused'));
  expect(await call('search_products', { query: 'pen' })).toMatchObject({ isError: true, content: [{ text: expect.stringContaining('Start the API') }] });
  request.mockResolvedValueOnce(new Response('<html>bad gateway</html>'));
  expect(await call('search_products', { query: 'pen' })).toMatchObject({ isError: true, content: [{ text: expect.stringContaining('non-JSON') }] });
  request.mockResolvedValueOnce(Response.json([{ ...products[0], stock: 'two' }]));
  expect(await call('search_products', { query: 'pen' })).toMatchObject({ isError: true, content: [{ text: expect.stringContaining('expected contract') }] });
});
it.each(['lost response', 'body read failure', 'invalid JSON', 'invalid contract', 'unexpected status', 'server error'])(
  'reports an ambiguous creation outcome for %s without suggesting automatic retries', async failure => {
    const { call, request } = await setup({ quote, warnings }, 201);
    if (failure === 'lost response') request.mockRejectedValueOnce(new Error('connection reset'));
    if (failure === 'body read failure') {
      const response = Response.json({ quote, warnings }, { status: 201 });
      vi.spyOn(response, 'text').mockRejectedValueOnce(new Error('body disconnected'));
      request.mockResolvedValueOnce(response);
    }
    if (failure === 'invalid JSON') request.mockResolvedValueOnce(new Response('{', { status: 201 }));
    if (failure === 'invalid contract') request.mockResolvedValueOnce(Response.json({}, { status: 201 }));
    if (failure === 'unexpected status') request.mockResolvedValueOnce(Response.json({ quote, warnings }, { status: 200 }));
    if (failure === 'server error') request.mockResolvedValueOnce(Response.json({ error: 'Internal server error' }, { status: 500 }));
    const result = await call('create_quote', { items: [{ productId: 'p1', quantity: 3 }] });
    expect(result).toMatchObject({ isError: true, content: [{ text: expect.stringContaining('The draft may already have been created; automatic retries may create duplicates') }] });
    if (failure === 'body read failure') expect(result.content).toMatchObject([{ text: expect.stringContaining('Cannot read') }]);
    if (failure === 'invalid JSON') expect(result.content).toMatchObject([{ text: expect.stringContaining('non-JSON') }]);
    if (failure === 'unexpected status') expect(result.content).toMatchObject([{ text: expect.stringContaining('expected HTTP 201') }]);
    expect(request).toHaveBeenCalledTimes(1);
  },
);
it.each([
  ['search_products', { query: 'pen' }, products],
  ['check_stock', { productId: 'p1' }, products],
  ['get_quote', { quoteId: 'q1' }, quote],
])('rejects an unexpected successful HTTP status for %s', async (name, args, data) => {
  const { call } = await setup(data, 201);
  expect(await call(name as string, args as Record<string, unknown>)).toMatchObject({ isError: true, content: [{ text: expect.stringContaining('unexpected HTTP 201; expected HTTP 200') }] });
});
it('distinguishes read failures from invalid JSON for GET responses', async () => {
  const { call, request } = await setup();
  const response = Response.json(products);
  vi.spyOn(response, 'text').mockRejectedValueOnce(new Error('body disconnected'));
  request.mockResolvedValueOnce(response);
  const result = await call('search_products', { query: 'pen' });
  expect(result).toMatchObject({ isError: true, content: [{ text: expect.stringContaining('Cannot read Inventory API response body') }] });
  expect(JSON.stringify(result)).not.toContain('draft may already');
});
it('starts the real stdio entrypoint with clean protocol stdout', async () => {
  const client = new Client({ name: 'stdio-test', version: '1' });
  const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', 'tsx', 'src/index.ts'], stderr: 'inherit', cwd: import.meta.dirname + '/..' });
  cleanups.push(() => client.close());
  await client.connect(transport);
  expect((await client.listTools()).tools).toHaveLength(4);
});
it('rejects invalid base URL configuration', () => {
  expect(() => createServer({ baseUrl: 'file:///tmp/db' })).toThrow('HTTP(S)');
});
