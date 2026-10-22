import { useState } from 'react';
import { getQuote, type QuoteResponse } from './api';

export function QuoteLookup({ onFound }: { onFound: (quote: QuoteResponse) => void }) {
  const [id, setId] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    if (!id.trim()) { setError('Enter a quote ID.'); return; }
    setPending(true);
    try { onFound(await getQuote(id.trim())); }
    catch (error) { setError(error instanceof Error ? error.message : 'Could not retrieve quote.'); }
    finally { setPending(false); }
  }
  return (
    <section className="panel" aria-labelledby="lookup-title">
      <h2 id="lookup-title">Find a saved quote</h2>
      <form className="mt-4" onSubmit={submit} noValidate>
        <label className="mb-2 block text-sm font-medium" htmlFor="quote-id">Quote ID</label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input className="min-w-0 flex-1" id="quote-id" value={id} onChange={event => setId(event.target.value)} placeholder="Paste a quote ID" disabled={pending} />
          <button className="secondary" disabled={pending} type="submit">{pending ? 'Finding…' : 'Find quote'}</button>
        </div>
        {error && <p role="alert" className="error mt-3">{error}</p>}
      </form>
    </section>
  );
}
