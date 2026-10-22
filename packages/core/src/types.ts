export interface Product {
  id: string;
  name: string;
  sku: string;
  unitPriceCents: number;
  stock: number;
}

export interface QuoteItem {
  productId: string;
  name: string;
  sku: string;
  unitPriceCents: number;
  quantity: number;
  subtotalCents: number;
}

export interface Quote {
  id: string;
  status: 'draft';
  createdAt: Date;
  items: QuoteItem[];
  totalCents: number;
}

export interface CreateQuoteInput {
  items: { productId: string; quantity: number }[];
}

export interface StockWarning {
  code: 'INSUFFICIENT_STOCK';
  productId: string;
  requestedQuantity: number;
  availableStock: number;
}

export interface CreateQuoteResult {
  quote: Quote;
  warnings: StockWarning[];
}
