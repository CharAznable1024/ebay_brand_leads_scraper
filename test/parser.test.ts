import { describe, expect, it } from 'vitest';
import { brandSearchUrl, brandSourceUrl, findEuropeFilterUrl, mergeSellerCandidate, parseBrandDirectory, parseBrandItems, parseSellerFromItem } from '../src/parser.js';

describe('eBay brand discovery parser', () => {
    it('builds a search source without the All Brands directory', () => {
        expect(brandSearchUrl('Unknown Brand')).toBe('https://www.ebay.com/sch/i.html?_nkw=Unknown+Brand&LH_PrefLoc=5&mag=1');
    });

    it('uses cached public brand pages for the default portfolio', () => {
        expect(brandSourceUrl('Gucci')).toBe('https://www.ebay.com/b/Gucci/bn_21826083');
        expect(brandSourceUrl('CHANEL')).toBe('https://www.ebay.com/b/CHANEL/bn_21822039');
        expect(brandSourceUrl('Nike')).toBe('https://www.ebay.com/b/Nike/bn_21831651');
        expect(brandSourceUrl('Apple')).toBe('https://www.ebay.com/b/Apple/bn_21819543');
    });
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

    it('preserves the selected marketplace when adding the Europe filter', () => {
        expect(findEuropeFilterUrl('', 'https://www.ebay.co.uk/sch/i.html?_nkw=Gucci')).toBe('https://www.ebay.co.uk/sch/i.html?_nkw=Gucci&LH_PrefLoc=5&mag=1');
    });

    it('extracts and merges sellers from item pages', () => {
        const item = { item_url: 'https://www.ebay.com/itm/123456789012', brand: 'Gucci', category: null };
        const first = parseSellerFromItem('<a href="https://www.ebay.com/usr/vintage-shop">Seller</a><script>{"category":"Category","categoryName":"Handbags"}</script>', item)!;
        const second = { ...first, brands: ['Prada'], categories: ['Clothing'], item_urls: ['https://www.ebay.com/itm/2'] };
        expect(mergeSellerCandidate(first, second)).toMatchObject({ seller_id: 'vintage-shop', brands: ['Gucci', 'Prada'], categories: ['Handbags', 'Clothing'] });
    });

    it('prefers the embedded seller and public store over unrelated user links', () => {
        const item = { item_url: 'https://www.ebay.com/itm/800795502918', brand: 'Gucci', category: null };
        const html = '<a href="https://www.ebay.com/usr/unrelated-recommendation">Other seller</a><a href="https://www.ebay.com/str/jewelrydeals4ucom?x=1">Visit store</a><script>{"sellerUsername":"jewelrydeals4u"}</script>';
        expect(parseSellerFromItem(html, item)).toMatchObject({
            seller_id: 'jewelrydeals4u',
            seller_name: 'jewelrydeals4u',
            profile_url: 'https://www.ebay.com/str/jewelrydeals4ucom',
        });
    });
});
