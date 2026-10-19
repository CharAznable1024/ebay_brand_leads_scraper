import { describe, expect, it } from 'vitest';
import { createSerialGate, roundRobinItems, selectPendingCandidates } from '../src/pipeline.js';

describe('request-efficient pipeline', () => {
    it('round-robins brand evidence before applying the global item cap', () => {
        const gucci = [1, 2].map((id) => ({ item_url: `https://www.ebay.com/itm/${id}`, brand: 'Gucci', category: null }));
        const prada = [3, 4].map((id) => ({ item_url: `https://www.ebay.com/itm/${id}`, brand: 'Prada', category: null }));
        expect(roundRobinItems([gucci, prada], 3).map((item) => item.brand)).toEqual(['Gucci', 'Prada', 'Gucci']);
    });

    it('selects only untried sellers with enough matching listings', () => {
        const candidates = [
            { seller_id: 'a', seller_name: 'a', profile_url: 'a', brands: ['Gucci'], categories: [], item_urls: ['1', '2'] },
            { seller_id: 'b', seller_name: 'b', profile_url: 'b', brands: ['Gucci'], categories: [], item_urls: ['3'] },
            { seller_id: 'c', seller_name: 'c', profile_url: 'c', brands: ['Gucci'], categories: [], item_urls: ['4', '5', '6'] },
        ];
        expect(selectPendingCandidates(candidates, new Set(['c']), 2, 5).map((candidate) => candidate.seller_id)).toEqual(['a']);
    });

    it('serializes Web Unlocker operations', async () => {
        const events: string[] = [];
        const gate = createSerialGate(0);
        const first = gate(async () => { events.push('start-1'); await Promise.resolve(); events.push('end-1'); });
        const second = gate(async () => { events.push('start-2'); events.push('end-2'); });
        await Promise.all([first, second]);
        expect(events).toEqual(['start-1', 'end-1', 'start-2', 'end-2']);
    });
});
