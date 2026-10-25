import { stable } from './domain.mjs';

const ttl = { 'query-nearby-stores': 60000, 'query-meals': 60000, 'query-meal-detail': 300000, 'query-store-coupons': 30000 };
// Account-scoped, in-memory reads only. Prices, addresses and writes are never cached.
export class ReadCache {
  constructor({ mcp, now = Date.now, concurrency = 4 }) {
    this.mcp = mcp; this.now = now; this.concurrency = concurrency;
    this.entries = new Map(); this.inflight = new Map(); this.active = 0; this.waiters = [];
  }
  async call(name, args, metrics) {
    const key = name + ':' + stable(args);
    const cached = this.entries.get(key);
    if (ttl[name] && cached?.expires > this.now()) { if (metrics) metrics.cacheHits++; return structuredClone(cached.data); }
    if (ttl[name] && this.inflight.has(key)) { if (metrics) metrics.cacheHits++; return structuredClone(await this.inflight.get(key)); }
    const run = async () => {
      if (this.active >= this.concurrency) await new Promise(resolve => this.waiters.push(resolve));
      else this.active++;
      try {
        if (metrics) metrics.officialCalls++;
        const data = await this.mcp.call(name, args);
        if (ttl[name]) {
          this.entries.delete(key); this.entries.set(key, { expires: this.now() + ttl[name], data: structuredClone(data) });
          if (this.entries.size > 250) this.entries.delete(this.entries.keys().next().value);
        }
        return data;
      } finally { const next = this.waiters.shift(); if (next) next(); else this.active--; }
    };
    const pending = run();
    if (ttl[name]) this.inflight.set(key, pending);
    try { return structuredClone(await pending); } finally { if (ttl[name]) this.inflight.delete(key); }
  }
}

export async function mapLimit(values, fn, limit = 4) {
  const results = new Array(values.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (next < values.length) { const index = next++; results[index] = await fn(values[index], index); }
  }));
  return results;
}
