import type { Product, Quote } from './types.js';

export interface ProductRepository {
  findByIds(ids: string[]): Promise<Product[]>;
}

export interface QuoteRepository {
  save(quote: Quote): Promise<void>;
}
