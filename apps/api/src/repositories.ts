import type Database from 'better-sqlite3';
import type {
  Product, Quote, QuoteItem, ReadableProductRepository, ReadableQuoteRepository,
} from '@inventory-agent/core';

export class SqliteProductRepository implements ReadableProductRepository {
  constructor(private readonly db: Database.Database) {}

  async list(): Promise<Product[]> {
    return this.db.prepare('SELECT id, name, sku, unitPriceCents, stock FROM products ORDER BY id').all() as Product[];
  }

  async findByIds(ids: string[]): Promise<Product[]> {
    // A bound lookup per ID avoids SQLite's variable limit for large input arrays.
    const lookup = this.db.prepare('SELECT id, name, sku, unitPriceCents, stock FROM products WHERE id = ?');
    return [...new Set(ids)].flatMap(id => {
      const product = lookup.get(id) as Product | undefined;
      return product ? [product] : [];
    });
  }
}

type QuoteRow = Omit<Quote, 'createdAt' | 'items'> & { createdAt: string };

export class SqliteQuoteRepository implements ReadableQuoteRepository {
  private readonly persist: (quote: Quote) => void;

  constructor(private readonly db: Database.Database) {
    const insertQuote = db.prepare('INSERT INTO quotes (id, status, createdAt, totalCents) VALUES (?, ?, ?, ?)');
    const insertItem = db.prepare(`INSERT INTO quote_items
      (quoteId, position, productId, name, sku, quantity, unitPriceCents, subtotalCents)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    this.persist = db.transaction((quote: Quote) => {
      insertQuote.run(quote.id, quote.status, quote.createdAt.toISOString(), quote.totalCents);
      quote.items.forEach((item, position) => {
        insertItem.run(quote.id, position, item.productId, item.name, item.sku,
          item.quantity, item.unitPriceCents, item.subtotalCents);
      });
    });
  }

  async save(quote: Quote): Promise<void> {
    this.persist(quote);
  }

  async findById(id: string): Promise<Quote | null> {
    const row = this.db.prepare('SELECT id, status, createdAt, totalCents FROM quotes WHERE id = ?').get(id) as QuoteRow | undefined;
    if (!row) return null;
    const items = this.db.prepare(`SELECT productId, name, sku, quantity, unitPriceCents, subtotalCents
      FROM quote_items WHERE quoteId = ? ORDER BY position`).all(id) as QuoteItem[];
    return { ...row, createdAt: new Date(row.createdAt), items };
  }
}
