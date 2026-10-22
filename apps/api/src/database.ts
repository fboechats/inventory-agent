import Database from 'better-sqlite3';

export function openDatabase(path: string): Database.Database {
  const db = new Database(path);
  try {
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');
    // Versioned, transactional SQL initialization. Future migrations follow version 1.
    db.transaction(() => {
      const version = db.pragma('user_version', { simple: true }) as number;
      if (version > 1) throw new Error('Unsupported database version');
      if (version === 1) return;
      db.exec(`
        CREATE TABLE products (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          sku TEXT NOT NULL UNIQUE,
          unitPriceCents INTEGER NOT NULL CHECK(unitPriceCents >= 0),
          stock INTEGER NOT NULL CHECK(stock >= 0)
        ) STRICT;
        CREATE TABLE quotes (
          id TEXT PRIMARY KEY,
          status TEXT NOT NULL CHECK(status = 'draft'),
          createdAt TEXT NOT NULL,
          totalCents INTEGER NOT NULL CHECK(totalCents >= 0)
        ) STRICT;
        CREATE TABLE quote_items (
          quoteId TEXT NOT NULL REFERENCES quotes(id),
          position INTEGER NOT NULL,
          productId TEXT NOT NULL,
          name TEXT NOT NULL,
          sku TEXT NOT NULL,
          quantity INTEGER NOT NULL CHECK(quantity > 0),
          unitPriceCents INTEGER NOT NULL CHECK(unitPriceCents >= 0),
          subtotalCents INTEGER NOT NULL CHECK(subtotalCents >= 0),
          PRIMARY KEY (quoteId, position)
        ) STRICT;
      `);
      const insert = db.prepare('INSERT INTO products (id, name, sku, unitPriceCents, stock) VALUES (?, ?, ?, ?, ?)');
      insert.run('notebook', 'Moonbeam Notebook', 'MB-NOTE', 1250, 10);
      insert.run('pen', 'Comet Pen', 'CT-PEN', 350, 25);
      insert.run('mug', 'Orbit Mug', 'OR-MUG', 2400, 0);
      db.pragma('user_version = 1');
    })();
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}
