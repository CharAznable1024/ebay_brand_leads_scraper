import { describe, expect, it } from 'vitest';
import { createWebUnlockerUsage, fetchWithWebUnlocker } from '../src/bright-data.js';

describe('Web Unlocker', () => {
    it('sends a rendered request', async () => {
        let body = '';
        const fetcher = (async (_url: RequestInfo | URL, init?: RequestInit) => { body = String(init?.body); return new Response('<html>ok</html>', { status: 200 }); }) as typeof fetch;
        await fetchWithWebUnlocker('https://www.ebay.com/b/Gucci/bn_1', { apiKey: 'x', zone: 'z', country: 'US', timeoutMillis: 1000 }, fetcher);
        expect(JSON.parse(body)).toMatchObject({ render: 'true', country: 'us' });
    });
    it('supports non-rendered requests for static item evidence', async () => {
        let body = ''; const fetcher = (async (_url: RequestInfo | URL, init?: RequestInit) => { body = String(init?.body); return new Response('<html>ok</html>', { status: 200 }); }) as typeof fetch;
        await fetchWithWebUnlocker('https://www.ebay.com/itm/1', { apiKey: 'x', zone: 'z', country: 'US', timeoutMillis: 1000, render: false }, fetcher);
        expect(JSON.parse(body)).toMatchObject({ render: 'false' });
    });
    it('tracks successful requests, retry attempts and cost', async () => {
        let attempts = 0;
        const fetcher = (async () => {
            attempts += 1;
            if (attempts === 1) throw new Error('temporary failure');
            return new Response('<html>ok</html>', { status: 200 });
        }) as typeof fetch;
        const usage = createWebUnlockerUsage();
        await fetchWithWebUnlocker('https://www.ebay.com/itm/1', { apiKey: 'x', zone: 'z', country: 'US', timeoutMillis: 1000, maxAttempts: 2, retryDelayMillis: 0, render: false }, fetcher, usage);
        expect(usage).toEqual({ logical_requests: 1, request_attempts: 2, successful_requests: 1, failed_attempts: 1, static_attempts: 2, rendered_attempts: 0, estimated_cost_usd: 0.0015 });
    });
    it('retries an adaptive rate limit once even when normal retries are disabled', async () => {
        let attempts = 0;
        const fetcher = (async () => {
            attempts += 1;
            if (attempts === 1) return new Response('<html>limited</html>', { status: 200, headers: { 'x-brd-error': 'A global adaptive rate limit has been applied' } });
            return new Response('<html>ok</html>', { status: 200 });
        }) as typeof fetch;
        const usage = createWebUnlockerUsage();
        await fetchWithWebUnlocker('https://www.ebay.com/itm/1', { apiKey: 'x', zone: 'z', country: 'US', timeoutMillis: 1000, maxAttempts: 1, retryDelayMillis: 0, render: false }, fetcher, usage);
        expect(usage).toMatchObject({ request_attempts: 2, successful_requests: 1, failed_attempts: 1 });
    });
});
