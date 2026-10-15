import { describe, expect, it } from 'vitest';
import { findEuropeFilterUrl, mergeSellerCandidate, parseBrandDirectory, parseBrandItems, parseSellerFromItem } from '../src/parser.js';

describe('eBay brand discovery parser', () => {
    it('resolves a requested brand from All Brands even when the label is localized', () => {
        const html = '<a href="https://cn.ebay.com/b/Gucci/bn_21826083">古驰</a><a href="/b/PRADA/bn_21833299">普拉达</a>';
        expect(parseBrandDirectory(html, ['Gucci', 'PRADA'], 'https://www.ebay.com/n/all-brands')).toEqual([
            { brand: 'Gucci', brand_url: 'https://www.ebay.com/b/Gucci/bn_21826083' },
            { brand: 'PRADA', brand_url: 'https://www.ebay.com/b/PRADA/bn_21833299' },
        ]);
    });

    it('finds the Europe item-location filter and product links', () => {
        const page = '<a href="/b/Gucci/bn_21826083?item_location=EU">Europe</a><a href="https://www.ebay.com/itm/Gucci-Bag/123456789012?x=1">Bag</a>';
        expect(findEuropeFilterUrl(page, 'https://www.ebay.com/b/Gucci/bn_21826083')).toBe('https://www.ebay.com/b/Gucci/bn_21826083?item_location=EU');
        expect(parseBrandItems(page, 'https://www.ebay.com/b/Gucci/bn_21826083', 'Gucci', 10)[0]).toMatchObject({ item_url: 'https://www.ebay.com/itm/123456789012', brand: 'Gucci' });
    });

    it('uses the real eBay Europe filter URL when the accordion options are lazy-loaded', () => {
        expect(findEuropeFilterUrl('<h3 aria-label="Item location">Item location</h3><div class="accordion-placeholder"></div>', 'https://www.ebay.com/b/Gucci/bn_21826083')).toBe('https://www.ebay.com/b/Gucci/bn_21826083?LH_PrefLoc=5&mag=1');
    });

    it('extracts and merges sellers from item pages', () => {
        const item = { item_url: 'https://www.ebay.com/itm/123456789012', brand: 'Gucci', category: null };
        const first = parseSellerFromItem('<a href="https://www.ebay.com/usr/vintage-shop">Seller</a><script>{"category":"Handbags"}</script>', item)!;
        const second = { ...first, brands: ['Prada'], categories: ['Clothing'], item_urls: ['https://www.ebay.com/itm/2'] };
        expect(mergeSellerCandidate(first, second)).toMatchObject({ seller_id: 'vintage-shop', brands: ['Gucci', 'Prada'], categories: ['Handbags', 'Clothing'] });
    });
});
