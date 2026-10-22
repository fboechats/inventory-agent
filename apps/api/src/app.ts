import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyError } from 'fastify';
import type Database from 'better-sqlite3';
import { QuoteService, type CreateQuoteInput } from '@inventory-agent/core';
import { SqliteProductRepository, SqliteQuoteRepository } from './repositories.js';

class RequestError extends Error {
  constructor(readonly statusCode: number, message: string) { super(message); }
}

// The caller owns the connection, including closing it after app.close().
export function buildApp(db: Database.Database, options: { logger?: boolean } = {}) {
  const app = Fastify({
    logger: options.logger ?? false,
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
  });
  const products = new SqliteProductRepository(db);
  const quotes = new SqliteQuoteRepository(db);
  const service = new QuoteService(products, quotes, randomUUID, () => new Date());

  app.setErrorHandler<FastifyError>((error, request, reply) => {
    if (error instanceof RequestError) {
      return reply.code(error.statusCode).send({ error: error.message });
    }
    if (error.validation || (error.statusCode && error.statusCode >= 400 && error.statusCode < 500)) {
      return reply.code(error.statusCode ?? 400).send({ error: 'Invalid request' });
    }
    request.log.error(error);
    return reply.code(500).send({ error: 'Internal server error' });
  });

  app.get('/products', () => products.list());

  app.post<{ Body: CreateQuoteInput }>('/quotes', {
    schema: {
      body: {
        type: 'object', additionalProperties: false, required: ['items'],
        properties: {
          items: {
            type: 'array', minItems: 1,
            items: {
              type: 'object', additionalProperties: false, required: ['productId', 'quantity'],
              properties: {
                productId: { type: 'string', pattern: '\\S' },
                quantity: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    // Validate aggregate arithmetic at the boundary; service business rules stay unchanged.
    const quantities = new Map<string, number>();
    for (const item of request.body.items) {
      const quantity = (quantities.get(item.productId) ?? 0) + item.quantity;
      if (!Number.isSafeInteger(quantity)) throw new RequestError(400, 'Combined quantity exceeds safe integer range');
      quantities.set(item.productId, quantity);
    }
    const found = await products.findByIds([...quantities.keys()]);
    if (found.length !== quantities.size) throw new RequestError(404, 'Product not found');
    let total = 0;
    for (const product of found) {
      const subtotal = product.unitPriceCents * quantities.get(product.id)!;
      total += subtotal;
      if (!Number.isSafeInteger(subtotal) || !Number.isSafeInteger(total)) {
        throw new RequestError(400, 'Quote amount exceeds safe integer range');
      }
    }
    const result = await service.createQuote(request.body);
    return reply.code(201).send(result);
  });

  app.get<{ Params: { id: string } }>('/quotes/:id', async (request, reply) => {
    const quote = await quotes.findById(request.params.id);
    if (!quote) return reply.code(404).send({ error: 'Quote not found' });
    return quote;
  });

  return app;
}
