import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openDatabase } from './database.js';

/** Always creates a new directory; never opens a caller-selected database. */
export function createEvaluationDatabase(parentDirectory = tmpdir()): string {
  const directory = mkdtempSync(join(resolve(parentDirectory), 'inventory-agent-eval-'));
  const path = join(directory, 'inventory.sqlite');
  const db = openDatabase(path);
  try {
    db.transaction(() => {
      const insert = db.prepare('INSERT INTO products (id, name, sku, unitPriceCents, stock) VALUES (?, ?, ?, ?, ?)');
      insert.run('glove-latex-m', 'Luva de procedimento látex M, caixa 100 un.', 'LUV-LAT-M-100', 3200, 8);
      insert.run('glove-nitrile-m', 'Luva nitrílica M, caixa 100 un.', 'LUV-NIT-M-100', 4500, 6);
    })();
  } finally {
    db.close();
  }
  return path;
}
