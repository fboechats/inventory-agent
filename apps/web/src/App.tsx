import { useEffect, useState } from 'react';
import { ProductPicker } from './ProductPicker';
import { QuoteDetails } from './QuoteDetails';
import { QuoteLookup } from './QuoteLookup';
import { getProducts, type Product, type QuoteResponse, type StockWarning } from './api';

export default function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ quote: QuoteResponse; warnings?: StockWarning[] }>();
  async function loadProducts() {
    setLoading(true); setError('');
    try { setProducts(await getProducts()); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not load products.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void loadProducts(); }, []);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-8">
        <p className="mb-3 text-2xl sm:text-3xl font-bold uppercase tracking-widest text-teal-700">Inventory Agent</p>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">From products to a draft quote.</h1>
        <p className="mt-3 max-w-2xl text-slate-600">Choose your products, set quantities, and save a quote with prices captured at creation.</p>
      </header>
      <main className="grid items-start gap-6 lg:grid-cols-2">
        <section className="panel" aria-labelledby="products-title">
          <h2 id="products-title">Build a quote</h2>
          <p className="mb-5 mt-1 text-sm text-slate-600">Select products from the current catalog.</p>
          {loading ? <p role="status">Loading products…</p> : error ? <div><p role="alert" className="error">{error}</p><button className="secondary mt-3" onClick={() => void loadProducts()}>Retry products</button></div> : products.length ? <ProductPicker products={products} onCreated={setResult} /> : <p role="status">No products available. Add products to the API catalog to get started.</p>}
        </section>
        <div className="grid gap-6">
          <QuoteLookup onFound={quote => setResult({ quote })} />
          {result ? <QuoteDetails quote={result.quote} warnings={result.warnings} /> : <section className="rounded-2xl border border-dashed border-slate-300 p-6 text-slate-600"><h2 className="text-slate-800">Your quote will appear here</h2><p className="mt-2 text-sm">Create a draft or find a saved quote by its ID.</p></section>}
        </div>
      </main>
    </div>
  );
}
