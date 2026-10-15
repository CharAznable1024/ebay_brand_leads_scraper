import { describe, expect, it } from 'vitest';
import { normalizeInput } from '../src/input.js';

describe('input', () => {
    it('expands EU countries and accepts eBay brand URLs', () => {
        const input = normalizeInput({ brands: ['Gucci'], startUrls: [{ url: 'https://www.ebay.com/b/PRADA/bn_21833299' }], sellerCountries: ['EU'] });
        expect(input.startUrls).toEqual(['https://www.ebay.com/b/PRADA/bn_21833299']);
        expect(input.sellerCountries).toEqual(expect.arrayContaining(['DE', 'FR', 'IT', 'SE']));
        expect(input.sellerCountries).not.toContain('GB');
    });
});
