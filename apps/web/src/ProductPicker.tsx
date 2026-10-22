import { useState } from 'react';
import { createQuote, formatBRL, type CreateQuoteResponse, type Product } from './api';

export function ProductPicker({ products, onCreated }: { products: Product[]; onCreated: (result: CreateQuoteResponse) => void }) {
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const selected = products.filter(product => quantities[product.id] !== undefined);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    if (!selected.length) { setError('Select at least one product.'); return; }
    const items = selected.map(product => ({ productId: product.id, quantity: Number(quantities[product.id]) }));
    if (items.some(item => !Number.isSafeInteger(item.quantity) || item.quantity < 1)) {
      setError('Enter a positive whole-number quantity for every selected product.'); return;
    }
    setPending(true);
    try { onCreated(await createQuote({ items })); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not create quote.'); }
    finally { setPending(false); }
  }

  return (
    <form onSubmit={submit} noValidate>
      <fieldset disabled={pending}>
        <legend className="sr-only">Choose products and quantities</legend>
        <div className="grid gap-3">{products.map(product => {
          const checked = quantities[product.id] !== undefined;
          return (
            <div key={product.id} className={`rounded-xl border p-4 ${checked ? 'border-teal-600 bg-teal-50/50' : 'border-slate-200'}`}>
              <div className="flex items-start gap-3">
                <input className="mt-1 h-5 w-5 accent-teal-700" type="checkbox" id={`select-${product.id}`} checked={checked} onChange={event => setQuantities(previous => {
                  const next = { ...previous };
                  if (event.target.checked) next[product.id] = '1'; else delete next[product.id];
                  return next;
                })} />
                <label className="flex-1 cursor-pointer" htmlFor={`select-${product.id}`}><span className="block font-semibold">{product.name}</span><span className="text-sm text-slate-500">{product.sku}</span></label>
                <span className="font-semibold">{formatBRL(product.unitPriceCents)}</span>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 pl-8">
                <span className="text-sm text-slate-600">Current stock: {product.stock}</span>
                {checked && <label className="flex items-center gap-2 text-sm">Quantity<input className="w-24" type="number" min="1" max={Number.MAX_SAFE_INTEGER} step="1" value={quantities[product.id]} onChange={event => setQuantities(previous => ({ ...previous, [product.id]: event.target.value }))} /></label>}
              </div>
            </div>
          );
        })}</div>
        <p className="my-4 text-sm text-slate-600">You can quote more than current stock. Any shortages will appear as temporary warnings.</p>
        {error && <p role="alert" className="error mb-4">{error}</p>}
        <button className="primary w-full sm:w-auto" type="submit">{pending ? 'Creating draft…' : `Create draft quote${selected.length ? ` (${selected.length})` : ''}`}</button>
        <span role="status" className="sr-only">{pending ? 'Creating draft quote' : ''}</span>
      </fieldset>
    </form>
  );
}
