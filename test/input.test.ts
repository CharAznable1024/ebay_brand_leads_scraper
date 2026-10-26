import { describe, expect, it } from 'vitest';
import { normalizeInput } from '../src/input.js';

describe('input', () => {
    it('expands EU countries and accepts eBay brand URLs', () => {
        const input = normalizeInput({ campaignId: 'cmp_100', shardId: 'shd_gucci_01', brands: ['Gucci'], startUrls: [{ url: 'https://www.ebay.com/b/PRADA/bn_21833299' }], sellerCountries: ['EU'] });
        expect(input.campaignId).toBe('cmp_100');
        expect(input.shardId).toBe('shd_gucci_01');
        expect(input.startUrls).toEqual(['https://www.ebay.com/b/PRADA/bn_21833299']);
        expect(input.sellerCountries).toEqual(expect.arrayContaining(['DE', 'FR', 'IT', 'SE']));
        expect(input.sellerCountries).not.toContain('GB');
        expect(input.maxProfileConcurrency).toBe(1);
        expect(input.maxRequestRetries).toBe(0);
        expect(input.navigationTimeoutSecs).toBe(60);
    });
    it('validates Aime identifiers', () => {
        expect(normalizeInput({ brands: ['Gucci'] }).campaignId).toBeNull();
        expect(() => normalizeInput({ brands: ['Gucci'], campaignId: 'bad id' })).toThrow(/campaignId/);
    });
});
