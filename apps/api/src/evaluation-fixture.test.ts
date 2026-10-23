import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { openDatabase } from './database.js';
import { createEvaluationDatabase } from './evaluation-fixture.js';
import { buildApp } from './app.js';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

it('creates deterministic fixtures through the shared initializer and persists them on reopen', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'inventory-fixture-test-'));
  directories.push(directory);
  const path = createEvaluationDatabase(directory);
  expect(isAbsolute(path)).toBe(true);
  const db = openDatabase(path);
  const app = buildApp(db);
  try {
    expect(db.pragma('user_version', { simple: true })).toBe(1);
    const products = (await app.inject('/products')).json();
    expect(products).toHaveLength(5);
    expect(products).toEqual(expect.arrayContaining([
      { id: 'notebook', name: 'Moonbeam Notebook', sku: 'MB-NOTE', unitPriceCents: 1250, stock: 10 },
      { id: 'pen', name: 'Comet Pen', sku: 'CT-PEN', unitPriceCents: 350, stock: 25 },
      { id: 'mug', name: 'Orbit Mug', sku: 'OR-MUG', unitPriceCents: 2400, stock: 0 },
      { id: 'glove-latex-m', name: 'Luva de procedimento látex M, caixa 100 un.', sku: 'LUV-LAT-M-100', unitPriceCents: 3200, stock: 8 },
      { id: 'glove-nitrile-m', name: 'Luva nitrílica M, caixa 100 un.', sku: 'LUV-NIT-M-100', unitPriceCents: 4500, stock: 6 },
    ]));
    const result = await app.inject({ method: 'POST', url: '/quotes', payload: { items: [{ productId: 'mug', quantity: 1 }] } });
    expect(result.statusCode).toBe(201);
    expect(result.json().warnings).toEqual([{ code: 'INSUFFICIENT_STOCK', productId: 'mug', requestedQuantity: 1, availableStock: 0 }]);
  } finally {
    await app.close();
    db.close();
  }
});

it('repeated setup isolates runs and ignores DATABASE_PATH without changing an existing database', () => {
  const directory = mkdtempSync(join(tmpdir(), 'inventory-fixture-test-'));
  directories.push(directory);
  const developmentPath = join(directory, 'development.sqlite');
  const development = openDatabase(developmentPath);
  const previous = process.env.DATABASE_PATH;
  try {
    development.prepare('UPDATE products SET stock = 99 WHERE id = ?').run('pen');
    process.env.DATABASE_PATH = developmentPath;
    const firstPath = createEvaluationDatabase(directory);
    const first = openDatabase(firstPath);
    try {
      first.prepare('UPDATE products SET stock = 1 WHERE id = ?').run('pen');
      first.prepare("INSERT INTO quotes VALUES ('prior-run', 'draft', '2026-01-01T00:00:00.000Z', 0)").run();
      const secondPath = createEvaluationDatabase(directory);
      expect(secondPath).not.toBe(firstPath);
      const second = openDatabase(secondPath);
      try {
        expect(second.prepare('SELECT stock FROM products WHERE id = ?').get('pen')).toEqual({ stock: 25 });
        expect(second.prepare('SELECT count(*) AS count FROM quotes').get()).toEqual({ count: 0 });
        expect(second.prepare('SELECT count(*) AS count FROM quote_items').get()).toEqual({ count: 0 });
      } finally { second.close(); }
      expect(first.prepare('SELECT count(*) AS count FROM quotes').get()).toEqual({ count: 1 });
    } finally { first.close(); }
    expect(development.prepare('SELECT stock FROM products WHERE id = ?').get('pen')).toEqual({ stock: 99 });
    expect(development.prepare('SELECT count(*) AS count FROM products').get()).toEqual({ count: 3 });
  } finally {
    development.close();
    if (previous === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previous;
  }
});
