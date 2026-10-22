import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { openDatabase } from './database.js';
import { SqliteQuoteRepository } from './repositories.js';

let db: ReturnType<typeof openDatabase>;
let app: ReturnType<typeof buildApp>;
const create = (items: unknown = [{ productId: 'notebook', quantity: 2 }]) =>
  app.inject({ method: 'POST', url: '/quotes', payload: { items } });

beforeEach(() => { db = openDatabase(':memory:'); app = buildApp(db); });
afterEach(async () => { await app.close(); db.close(); });

describe('SQLite API', () => {
  it('lists seeded products with integer prices and stock', async () => {
    const response = await app.inject('/products');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveLength(3);
    expect(response.json()).toContainEqual({ id: 'notebook', name: 'Moonbeam Notebook', sku: 'MB-NOTE', unitPriceCents: 1250, stock: 10 });
  });

  it('creates, persists, and retrieves an ordered draft with an ISO date', async () => {
    const response = await create([{ productId: 'pen', quantity: 2 }, { productId: 'notebook', quantity: 1 }]);
    expect(response.statusCode).toBe(201);
    const { quote, warnings } = response.json();
    expect(warnings).toEqual([]);
    expect(quote).toMatchObject({ status: 'draft', totalCents: 1950 });
    expect(new Date(quote.createdAt).toISOString()).toBe(quote.createdAt);
    expect(quote.items.map((item: { productId: string }) => item.productId)).toEqual(['pen', 'notebook']);
    expect(db.prepare('SELECT count(*) AS count FROM quotes').get()).toEqual({ count: 1 });
    expect(db.prepare('SELECT count(*) AS count FROM quote_items').get()).toEqual({ count: 2 });
    const retrieved = await app.inject(`/quotes/${quote.id}`);
    expect(retrieved.statusCode).toBe(200);
    expect(retrieved.json()).toEqual(quote);
  });

  it('combines duplicate quantities, warns for insufficient/zero stock, and never changes stock', async () => {
    const before = (await app.inject('/products')).json();
    const response = await create([
      { productId: 'notebook', quantity: 6 }, { productId: 'notebook', quantity: 5 },
      { productId: 'mug', quantity: 1 },
    ]);
    expect(response.statusCode).toBe(201);
    const { quote, warnings } = response.json();
    expect(quote.items).toHaveLength(2);
    expect(quote.items[0].quantity).toBe(11);
    expect(warnings).toEqual([
      { code: 'INSUFFICIENT_STOCK', productId: 'notebook', requestedQuantity: 11, availableStock: 10 },
      { code: 'INSUFFICIENT_STOCK', productId: 'mug', requestedQuantity: 1, availableStock: 0 },
    ]);
    expect((await app.inject('/products')).json()).toEqual(before);
    db.prepare('UPDATE products SET stock = ?').run(100);
    const retrieved = (await app.inject(`/quotes/${quote.id}`)).json();
    expect(retrieved).toEqual(quote);
    expect(JSON.stringify(retrieved)).not.toMatch(/warning|stock|availability/i);
    const columns = db.prepare('PRAGMA table_info(quote_items)').all() as { name: string }[];
    expect(columns.map(column => column.name).join(' ')).not.toMatch(/warning|stock/i);
  });

  it('preserves commercial snapshots after product changes and deletion', async () => {
    const { quote } = (await create()).json();
    expect(quote.items[0]).toEqual({ productId: 'notebook', name: 'Moonbeam Notebook', sku: 'MB-NOTE', unitPriceCents: 1250, quantity: 2, subtotalCents: 2500 });
    db.prepare('UPDATE products SET name = ?, sku = ?, unitPriceCents = ?, stock = ? WHERE id = ?')
      .run('Changed', 'NEW', 9999, 0, 'notebook');
    expect((await app.inject(`/quotes/${quote.id}`)).json()).toEqual(quote);
    db.prepare('DELETE FROM products WHERE id = ?').run('notebook');
    expect((await app.inject(`/quotes/${quote.id}`)).json()).toEqual(quote);
  });

  it.each([
    {}, null, [], { items: [] }, { items: null }, { items: [null] },
    { items: [{ quantity: 1 }] }, { items: [{ productId: 'pen' }] },
    ...['', '   ', 12].map(productId => ({ items: [{ productId, quantity: 1 }] })),
    ...[0, -1, 1.5, '2', true, Number.MAX_SAFE_INTEGER + 1].map(quantity => ({ items: [{ productId: 'pen', quantity }] })),
    { items: [{ productId: 'pen', quantity: 1, unitPriceCents: 1 }] },
    { items: [{ productId: 'pen', quantity: 1 }], warnings: [] },
  ])('rejects invalid JSON shape %# without persisting', async payload => {
    const response = await app.inject({ method: 'POST', url: '/quotes', headers: { 'content-type': 'application/json' }, payload: JSON.stringify(payload) });
    expect(response.statusCode).toBe(400);
    expect(db.prepare('SELECT count(*) AS count FROM quotes').get()).toEqual({ count: 0 });
  });

  it('rejects malformed JSON and unsafe combined quantities or amounts', async () => {
    expect((await app.inject({ method: 'POST', url: '/quotes', headers: { 'content-type': 'application/json' }, payload: '{' })).statusCode).toBe(400);
    expect((await create([{ productId: 'pen', quantity: Number.MAX_SAFE_INTEGER }, { productId: 'pen', quantity: 1 }])).statusCode).toBe(400);
    expect((await create([{ productId: 'pen', quantity: Number.MAX_SAFE_INTEGER }])).statusCode).toBe(400);
    expect(db.prepare('SELECT count(*) AS count FROM quotes').get()).toEqual({ count: 0 });
  });

  it('returns 404 for missing products and quotes, with bound lookup parameters', async () => {
    expect((await create([{ productId: 'missing', quantity: 1 }])).statusCode).toBe(404);
    expect((await create([{ productId: "' OR 1=1 --", quantity: 1 }])).statusCode).toBe(404);
    expect((await app.inject('/quotes/missing')).statusCode).toBe(404);
    expect((await app.inject(`/quotes/${encodeURIComponent("' OR 1=1 --")}`)).statusCode).toBe(404);
  });

  it('rolls back the quote and earlier items on insert failure and hides internal errors', async () => {
    db.exec(`CREATE TRIGGER fail_item BEFORE INSERT ON quote_items WHEN NEW.position = 1
      BEGIN SELECT RAISE(ABORT, 'secret database detail'); END`);
    const response = await create([{ productId: 'pen', quantity: 1 }, { productId: 'mug', quantity: 1 }]);
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ error: 'Internal server error' });
    expect(db.prepare('SELECT count(*) AS count FROM quotes').get()).toEqual({ count: 0 });
    expect(db.prepare('SELECT count(*) AS count FROM quote_items').get()).toEqual({ count: 0 });
  });

  it('round-trips repository dates as Date objects', async () => {
    const { quote } = (await create()).json();
    const stored = await new SqliteQuoteRepository(db).findById(quote.id);
    expect(stored?.createdAt).toBeInstanceOf(Date);
    expect(stored?.createdAt.toISOString()).toBe(quote.createdAt);
  });

  it('persists across connection restarts without reseeding or overwriting products', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'inventory-api-'));
    const path = join(directory, 'test.sqlite');
    let connection = openDatabase(path);
    let instance = buildApp(connection);
    try {
      const response = await instance.inject({ method: 'POST', url: '/quotes', payload: { items: [{ productId: 'mug', quantity: 1 }] } });
      const { quote } = response.json();
      connection.prepare('UPDATE products SET stock = ? WHERE id = ?').run(5, 'mug');
      connection.prepare('DELETE FROM products WHERE id = ?').run('pen');
      await instance.close();
      connection.close();
      connection = openDatabase(path);
      instance = buildApp(connection);
      expect((await instance.inject(`/quotes/${quote.id}`)).json()).toEqual(quote);
      const products = (await instance.inject('/products')).json();
      expect(products).toHaveLength(2);
      expect(products.find((product: { id: string }) => product.id === 'mug').stock).toBe(5);
    } finally {
      await instance.close();
      connection.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
