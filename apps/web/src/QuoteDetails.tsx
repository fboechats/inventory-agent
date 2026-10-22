import { formatBRL, type QuoteResponse, type StockWarning } from './api';

export function QuoteDetails({ quote, warnings }: { quote: QuoteResponse; warnings?: StockWarning[] }) {
  return (
    <section className="panel" aria-labelledby="quote-title" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="quote-title">Quote details</h2>
        <span className="rounded-full bg-teal-100 px-3 py-1 text-sm font-semibold text-teal-900">Draft</span>
      </div>
      <dl className="my-5 grid gap-3 text-sm">
        <div><dt className="text-slate-500">Quote ID</dt><dd className="break-all font-mono select-all">{quote.id}</dd></div>
        <div><dt className="text-slate-500">Created</dt><dd>{new Date(quote.createdAt).toLocaleString('pt-BR')}</dd></div>
      </dl>
      <p className="mb-4 text-sm text-slate-600">Saved commercial snapshots. Creating a draft does not reserve or change stock.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Saved quote items and prices</caption>
          <thead><tr><th>Product / SKU</th><th>Qty</th><th className="text-right">Unit price</th><th className="text-right">Subtotal</th></tr></thead>
          <tbody>{quote.items.map(item => (
            <tr key={item.productId}>
              <td><span className="font-medium">{item.name}</span><span className="block text-slate-500">{item.sku}</span></td>
              <td>{item.quantity}</td><td className="whitespace-nowrap text-right">{formatBRL(item.unitPriceCents)}</td>
              <td className="whitespace-nowrap text-right">{formatBRL(item.subtotalCents)}</td>
            </tr>
          ))}</tbody>
          <tfoot><tr className="border-none"><th colSpan={3}>Total</th><td className="whitespace-nowrap text-right text-lg font-bold">{formatBRL(quote.totalCents)}</td></tr></tfoot>
        </table>
      </div>
      {warnings && warnings.length > 0 && (
        <aside className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950" aria-labelledby="warning-title">
          <h3 id="warning-title" className="font-semibold">Temporary stock warnings</h3>
          <p className="mt-1 text-sm">Stock checked at creation only. These warnings are not saved with the quote.</p>
          <ul className="mt-3 list-inside list-disc text-sm">{warnings.map(warning => (
            <li key={warning.productId}>{quote.items.find(item => item.productId === warning.productId)?.name ?? warning.productId}: requested {warning.requestedQuantity}, available {warning.availableStock}.</li>
          ))}</ul>
        </aside>
      )}
    </section>
  );
}
