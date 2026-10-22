import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import App from './App';
import { formatBRL, getQuote } from './api';

const product = { id: 'mug', name: 'Mug', sku: 'MUG-01', unitPriceCents: 2500, stock: 0 };
const quote = {
  id: 'quote-123', status: 'draft', createdAt: '2026-10-22T12:00:00.000Z',
  items: [{ productId: 'mug', name: 'Snapshot mug', sku: 'OLD-SKU', unitPriceCents: 2300, quantity: 2, subtotalCents: 4600 }],
  totalCents: 4600,
};
function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
afterEach(() => vi.unstubAllGlobals());

it('creates a quote above stock using only IDs and quantities, then clears warnings on retrieval', async () => {
  const fetch = vi.fn().mockResolvedValueOnce(respond([product]))
    .mockResolvedValueOnce(respond({ quote, warnings: [{ code: 'INSUFFICIENT_STOCK', productId: 'mug', requestedQuantity: 2, availableStock: 0 }] }, 201))
    .mockResolvedValueOnce(respond(quote));
  vi.stubGlobal('fetch', fetch);
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole('checkbox', { name: /Mug/ }));
  const quantity = screen.getByRole('spinbutton', { name: 'Quantity' });
  await user.clear(quantity);
  await user.type(quantity, '2');
  await user.click(screen.getByRole('button', { name: /Create draft quote/ }));
  expect(await screen.findByText('Temporary stock warnings')).toBeInTheDocument();
  expect(fetch).toHaveBeenNthCalledWith(2, '/quotes', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: [{ productId: 'mug', quantity: 2 }] }),
  });
  expect(screen.getByText('Snapshot mug')).toBeInTheDocument();
  expect(screen.getByText('OLD-SKU')).toBeInTheDocument();
  expect(screen.getByText('R$ 23,00', { exact: false })).toBeInTheDocument();
  await user.type(screen.getByLabelText('Quote ID', { selector: 'input' }), 'quote-123');
  await user.click(screen.getByRole('button', { name: 'Find quote' }));
  await waitFor(() => expect(screen.queryByText('Temporary stock warnings')).not.toBeInTheDocument());
  expect(fetch).toHaveBeenLastCalledWith('/quotes/quote-123', undefined);
  expect(screen.getByText('Snapshot mug')).toBeInTheDocument();
});

it('validates selection and positive whole quantities without submitting', async () => {
  const fetch = vi.fn().mockResolvedValue(respond([product]));
  vi.stubGlobal('fetch', fetch);
  const user = userEvent.setup();
  render(<App />);
  await screen.findByText('Mug');
  await user.click(screen.getByRole('button', { name: /Create draft quote/ }));
  expect(screen.getByRole('alert')).toHaveTextContent('Select at least one product');
  await user.click(screen.getByRole('checkbox', { name: /Mug/ }));
  await user.clear(screen.getByRole('spinbutton'));
  await user.type(screen.getByRole('spinbutton'), '1.5');
  await user.click(screen.getByRole('button', { name: /Create draft quote/ }));
  expect(screen.getByRole('alert')).toHaveTextContent('positive whole-number');
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('shows product loading, error with retry, and empty catalog states', async () => {
  let resolve!: (value: Response) => void;
  const fetch = vi.fn().mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; }))
    .mockResolvedValueOnce(respond([]));
  vi.stubGlobal('fetch', fetch);
  const user = userEvent.setup();
  render(<App />);
  expect(screen.getByRole('status')).toHaveTextContent('Loading products');
  resolve(respond({ error: 'Internal server error' }, 500));
  expect(await screen.findByRole('alert')).toHaveTextContent('Internal server error');
  await user.click(screen.getByRole('button', { name: 'Retry products' }));
  expect(await screen.findByRole('status')).toHaveTextContent('No products available');
});

it('shows create and lookup API errors and allows retry', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(respond([product]))
    .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    .mockResolvedValueOnce(respond({ error: 'Quote not found' }, 404)));
  const user = userEvent.setup();
  render(<App />);
  await user.click(await screen.findByRole('checkbox', { name: /Mug/ }));
  await user.click(screen.getByRole('button', { name: /Create draft quote/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the API');
  expect(screen.getByRole('button', { name: /Create draft quote/ })).toBeEnabled();
  await user.type(screen.getByLabelText('Quote ID'), 'missing');
  await user.click(screen.getByRole('button', { name: 'Find quote' }));
  expect(await screen.findByText('Quote not found')).toBeInTheDocument();
});

it('validates empty quote IDs locally', async () => {
  const fetch = vi.fn().mockResolvedValue(respond([]));
  vi.stubGlobal('fetch', fetch);
  render(<App />);
  await userEvent.click(screen.getByRole('button', { name: 'Find quote' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Enter a quote ID');
  expect(fetch).toHaveBeenCalledTimes(1);
});

it('encodes quote IDs as a single URL segment and formats integer cents as BRL', async () => {
  const fetch = vi.fn().mockResolvedValue(respond(quote));
  vi.stubGlobal('fetch', fetch);
  await getQuote('id/with ?#');
  expect(fetch).toHaveBeenCalledWith('/quotes/id%2Fwith%20%3F%23', undefined);
  expect(formatBRL(123456).replace(/\s/g, ' ')).toBe('R$ 1.234,56');
});
