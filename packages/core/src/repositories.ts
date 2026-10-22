import type { Product, Quote } from './types.js';

export interface ProductRepository {
  findByIds(ids: string[]): Promise<Product[]>;
}

export interface QuoteRepository {
  save(quote: Quote): Promise<void>;
}

export interface ReadableProductRepository extends ProductRepository {
  list(): Promise<Product[]>;
}

export interface ReadableQuoteRepository extends QuoteRepository {
  findById(id: string): Promise<Quote | null>;
}
