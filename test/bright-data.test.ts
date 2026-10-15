import { describe, expect, it } from 'vitest';
import { fetchWithWebUnlocker } from '../src/bright-data.js';

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
});
