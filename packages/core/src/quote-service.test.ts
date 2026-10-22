import { describe, expect, it, vi } from 'vitest';
import { QuoteService, type CreateQuoteInput, type Product, type Quote } from './index.js';

function setup() {
  const products: Product[] = [
    { id: 'a', name: 'Apple', sku: 'APL', unitPriceCents: 125, stock: 10 },
    { id: 'b', name: 'Banana', sku: 'BAN', unitPriceCents: 75, stock: 5 },
  ];
  const findByIds = vi.fn(async (_ids: string[]) => products);
  const save = vi.fn(async (_quote: Quote) => {});
  const now = new Date('2026-01-02T03:04:05Z');
  const generateId = vi.fn(() => 'quote-1');
  const clock = vi.fn(() => now);
  const service = new QuoteService({ findByIds }, { save }, generateId, clock);
  return { products, findByIds, save, now, generateId, clock, service };
}

describe('QuoteService', () => {
  it('saves a draft with deterministic metadata and repository snapshots', async () => {
    const { service, save, findByIds, now } = setup();
    const result = await service.createQuote({ items: [
      { productId: 'a', quantity: 2 },
      { productId: 'b', quantity: 3 },
    ] });
    expect(findByIds).toHaveBeenCalledExactlyOnceWith(['a', 'b']);
    expect(result).toEqual({
      quote: {
        id: 'quote-1', status: 'draft', createdAt: now, totalCents: 475,
        items: [
          { productId: 'a', name: 'Apple', sku: 'APL', unitPriceCents: 125, quantity: 2, subtotalCents: 250 },
          { productId: 'b', name: 'Banana', sku: 'BAN', unitPriceCents: 75, quantity: 3, subtotalCents: 225 },
        ],
      },
      warnings: [],
    });
    expect(save).toHaveBeenCalledExactlyOnceWith(result.quote);
  });

  it('combines duplicates before lookup, pricing, and stock checks without changing stock', async () => {
    const { service, products, findByIds, save } = setup();
    const before = structuredClone(products);
    const { quote, warnings } = await service.createQuote({ items: [
      { productId: 'a', quantity: 6 }, { productId: 'a', quantity: 5 },
    ] });
    expect(findByIds).toHaveBeenCalledExactlyOnceWith(['a']);
    expect(quote.items).toHaveLength(1);
    expect(quote.items[0]).toMatchObject({ quantity: 11, subtotalCents: 1375 });
    expect(warnings).toEqual([{
      code: 'INSUFFICIENT_STOCK', productId: 'a', requestedQuantity: 11, availableStock: 10,
    }]);
    expect(save).toHaveBeenCalledExactlyOnceWith(quote);
    expect(save.mock.calls[0][0]).not.toHaveProperty('warnings');
    expect(products).toEqual(before);
  });

  it('does not warn when quantity equals stock', async () => {
    const { service } = setup();
    expect((await service.createQuote({ items: [{ productId: 'b', quantity: 5 }] })).warnings).toEqual([]);
  });

  it('saves a quote even when stock is zero', async () => {
    const { service, products, save } = setup();
    products[0].stock = 0;
    const result = await service.createQuote({ items: [{ productId: 'a', quantity: 1 }] });
    expect(result.warnings[0]).toMatchObject({ availableStock: 0 });
    expect(save).toHaveBeenCalledOnce();
  });

  it('ignores client prices and preserves snapshots after repository data changes', async () => {
    const { service, products, save } = setup();
    const input = { items: [{ productId: 'a', quantity: 2, unitPriceCents: 1, subtotalCents: 2 }] };
    const first = await service.createQuote(input);
    products[0].unitPriceCents = 200;
    products[0].name = 'New Apple';
    products[0].sku = 'NEW';
    const second = await service.createQuote(input);
    expect(first.quote.items[0]).toEqual({
      productId: 'a', name: 'Apple', sku: 'APL', unitPriceCents: 125, quantity: 2, subtotalCents: 250,
    });
    expect(save.mock.calls[0][0]).toEqual(first.quote);
    expect(second.quote.items[0]).toMatchObject({ name: 'New Apple', sku: 'NEW', unitPriceCents: 200, subtotalCents: 400 });
  });

  it('rejects an empty quote before lookup or save', async () => {
    const { service, findByIds, save } = setup();
    await expect(service.createQuote({ items: [] })).rejects.toThrow('at least one');
    expect(findByIds).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, '2', undefined])(
    'rejects invalid quantity %s before lookup or save', async quantity => {
      const { service, findByIds, save } = setup();
      const input = { items: [{ productId: 'a', quantity }] } as CreateQuoteInput;
      await expect(service.createQuote(input)).rejects.toThrow('Quantity');
      expect(findByIds).not.toHaveBeenCalled();
      expect(save).not.toHaveBeenCalled();
    },
  );

  it.each([
    { label: 'missing', item: { quantity: 1 } },
    { label: 'undefined', item: { productId: undefined, quantity: 1 } },
    { label: 'null', item: { productId: null, quantity: 1 } },
    { label: 'number', item: { productId: 123, quantity: 1 } },
    { label: 'boolean', item: { productId: false, quantity: 1 } },
    { label: 'object', item: { productId: {}, quantity: 1 } },
    { label: 'array', item: { productId: ['a'], quantity: 1 } },
    { label: 'empty', item: { productId: '', quantity: 1 } },
    { label: 'spaces', item: { productId: '   ', quantity: 1 } },
    { label: 'mixed whitespace', item: { productId: '\t\n\r ', quantity: 1 } },
  ])('rejects $label product ID before lookup or save', async ({ item }) => {
    const { service, findByIds, save } = setup();
    const input = { items: [{ productId: 'a', quantity: 1 }, item] } as CreateQuoteInput;
    await expect(service.createQuote(input)).rejects.toThrow('Product ID must be a non-empty string');
    expect(findByIds).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('preserves non-empty product IDs exactly when looking up and saving', async () => {
    const { service, products, findByIds, save } = setup();
    products[0].id = ' a ';
    const { quote } = await service.createQuote({ items: [{ productId: ' a ', quantity: 1 }] });
    expect(findByIds).toHaveBeenCalledExactlyOnceWith([' a ']);
    expect(quote.items[0].productId).toBe(' a ');
    expect(save).toHaveBeenCalledExactlyOnceWith(quote);
  });

  it('rejects unsafe combined quantities', async () => {
    const { service, findByIds, save } = setup();
    await expect(service.createQuote({ items: [
      { productId: 'a', quantity: Number.MAX_SAFE_INTEGER }, { productId: 'a', quantity: 1 },
    ] })).rejects.toThrow('Combined quantity');
    expect(findByIds).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('rejects missing products without saving a partial quote', async () => {
    const { service, save } = setup();
    await expect(service.createQuote({ items: [
      { productId: 'a', quantity: 1 }, { productId: 'missing', quantity: 1 },
    ] })).rejects.toThrow('Product not found: missing');
    expect(save).not.toHaveBeenCalled();
  });

  it('propagates lookup failure without saving', async () => {
    const { service, findByIds, save } = setup();
    const error = new Error('Repository unavailable');
    findByIds.mockRejectedValueOnce(error);
    await expect(service.createQuote({ items: [{ productId: 'a', quantity: 1 }] })).rejects.toBe(error);
    expect(save).not.toHaveBeenCalled();
  });

  it('rejects unsafe subtotals', async () => {
    const { service, products, save } = setup();
    products[0].unitPriceCents = Number.MAX_SAFE_INTEGER;
    await expect(service.createQuote({ items: [{ productId: 'a', quantity: 2 }] })).rejects.toThrow('Subtotal');
    expect(save).not.toHaveBeenCalled();
  });

  it('rejects an unsafe total even when each subtotal is safe', async () => {
    const { service, products, save } = setup();
    products[0].unitPriceCents = Number.MAX_SAFE_INTEGER;
    await expect(service.createQuote({ items: [
      { productId: 'a', quantity: 1 }, { productId: 'b', quantity: 1 },
    ] })).rejects.toThrow('Total');
    expect(save).not.toHaveBeenCalled();
  });

  it('accepts the maximum safe total and zero prices', async () => {
    const { service, products } = setup();
    products[0].unitPriceCents = Number.MAX_SAFE_INTEGER;
    products[1].unitPriceCents = 0;
    const { quote } = await service.createQuote({ items: [
      { productId: 'a', quantity: 1 }, { productId: 'b', quantity: 1 },
    ] });
    expect(quote.totalCents).toBe(Number.MAX_SAFE_INTEGER);
  });

  it.each([-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects invalid repository prices %s', async price => {
    const { service, products, save } = setup();
    products[0].unitPriceCents = price;
    await expect(service.createQuote({ items: [{ productId: 'a', quantity: 1 }] })).rejects.toThrow('Unit price');
    expect(save).not.toHaveBeenCalled();
  });

  it('propagates save failures', async () => {
    const { service, save } = setup();
    const error = new Error('Save failed');
    save.mockRejectedValueOnce(error);
    await expect(service.createQuote({ items: [{ productId: 'a', quantity: 1 }] })).rejects.toBe(error);
  });
});
