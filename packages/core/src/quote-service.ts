import type { ProductRepository, QuoteRepository } from './repositories.js';
import type { CreateQuoteInput, CreateQuoteResult, QuoteItem, StockWarning } from './types.js';

function requireSafeInteger(value: number, minimum: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${label} must be a safe integer >= ${minimum}`);
  }
}

export class QuoteService {
  constructor(
    private readonly products: ProductRepository,
    private readonly quotes: QuoteRepository,
    private readonly generateId: () => string,
    private readonly clock: () => Date,
  ) {}

  async createQuote(input: CreateQuoteInput): Promise<CreateQuoteResult> {
    if (input.items.length === 0) {
      throw new Error('A quote must contain at least one product');
    }

    const quantities = new Map<string, number>();
    for (const item of input.items) {
      if (typeof item.productId !== 'string' || item.productId.trim().length === 0) {
        throw new Error('Product ID must be a non-empty string');
      }
      requireSafeInteger(item.quantity, 1, 'Quantity');
      const quantity = (quantities.get(item.productId) ?? 0) + item.quantity;
      requireSafeInteger(quantity, 1, 'Combined quantity');
      quantities.set(item.productId, quantity);
    }

    const products = await this.products.findByIds([...quantities.keys()]);
    const productsById = new Map(products.map(product => [product.id, product]));
    const items: QuoteItem[] = [];
    const warnings: StockWarning[] = [];
    let totalCents = 0;

    for (const [productId, quantity] of quantities) {
      const product = productsById.get(productId);
      if (!product) throw new Error(`Product not found: ${productId}`);
      requireSafeInteger(product.unitPriceCents, 0, 'Unit price');
      requireSafeInteger(product.stock, 0, 'Stock');
      const subtotalCents = product.unitPriceCents * quantity;
      requireSafeInteger(subtotalCents, 0, 'Subtotal');
      totalCents += subtotalCents;
      requireSafeInteger(totalCents, 0, 'Total');

      items.push({
        productId,
        name: product.name,
        sku: product.sku,
        unitPriceCents: product.unitPriceCents,
        quantity,
        subtotalCents,
      });
      if (quantity > product.stock) {
        warnings.push({
          code: 'INSUFFICIENT_STOCK',
          productId,
          requestedQuantity: quantity,
          availableStock: product.stock,
        });
      }
    }

    const quote = {
      id: this.generateId(),
      status: 'draft' as const,
      createdAt: new Date(this.clock().getTime()),
      items,
      totalCents,
    };
    await this.quotes.save(quote);
    return { quote, warnings };
  }
}
