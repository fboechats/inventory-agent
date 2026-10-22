import type { CreateQuoteInput, Product, Quote, StockWarning } from '@inventory-agent/core';

// Dates are serialized to ISO strings at the REST boundary.
export type QuoteResponse = Omit<Quote, 'createdAt'> & { createdAt: string };
export type CreateQuoteResponse = { quote: QuoteResponse; warnings: StockWarning[] };
export type { Product, StockWarning };

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, options);
  } catch {
    throw new Error('Could not reach the API. Check that it is running and try again.');
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(typeof body?.error === 'string' ? body.error : `Request failed (${response.status}). Please try again.`);
  }
  return response.json();
}

export const getProducts = () => request<Product[]>('/products');
export const getQuote = (id: string) => request<QuoteResponse>(`/quotes/${encodeURIComponent(id)}`);
export const createQuote = (input: CreateQuoteInput) => request<CreateQuoteResponse>('/quotes', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(input),
});

export function formatBRL(cents: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
}
