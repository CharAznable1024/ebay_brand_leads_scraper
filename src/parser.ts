import type { BrandSource, ItemEvidence, SellerCandidate } from './types.js';

const decode = (value: string): string => value.replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&nbsp;|&#160;/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const normalize = (value: string): string => value.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '');
const anchors = (html: string): Array<{ href: string; label: string }> => [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].map((match) => ({ href: match[1].replace(/&amp;/gi, '&'), label: decode(match[2]) }));
const ebayCom = (raw: string, base: string): string => { const url = new URL(raw, base); if (/(^|\.)ebay\.[a-z.]+$/i.test(url.hostname)) url.hostname = 'www.ebay.com'; return url.toString(); };

export function parseBrandDirectory(html: string, requestedBrands: string[], baseUrl: string): BrandSource[] {
    const available = anchors(html).filter((link) => /\/b\/[^/?#]+\/bn_\d+/i.test(new URL(link.href, baseUrl).pathname));
    return requestedBrands.flatMap((brand) => {
        const wanted = normalize(brand);
        const found = available.find((link) => {
            const path = decodeURIComponent(new URL(link.href, baseUrl).pathname);
            const slug = path.match(/\/b\/([^/]+)\/bn_/i)?.[1] ?? '';
            return normalize(slug) === wanted || normalize(link.label) === wanted;
        });
        return found ? [{ brand, brand_url: ebayCom(found.href, baseUrl) }] : [];
    });
}

export function brandNameFromUrl(raw: string): string {
    const segment = decodeURIComponent(new URL(raw).pathname.match(/\/b\/([^/]+)/i)?.[1] ?? 'Unknown');
    return segment.replace(/-/g, ' ');
}

export function findEuropeFilterUrl(html: string, baseUrl: string): string | null {
    const found = anchors(html).find((link) => /^europe$/i.test(link.label) || /item location\s*europe/i.test(link.label));
    if (found) return ebayCom(found.href, baseUrl);
    const index = html.search(/>\s*Europe\s*</i);
    if (index >= 0) {
        const fragment = html.slice(Math.max(0, index - 2_000), index + 2_000);
        const hrefs = [...fragment.matchAll(/href=["']([^"']+)["']/gi)];
        const closest = hrefs.at(-1)?.[1];
        if (closest) return ebayCom(closest, baseUrl);
    }
    return null;
}

export function parseBrandItems(html: string, pageUrl: string, brand: string, maximum: number): ItemEvidence[] {
    const seen = new Set<string>(); const results: ItemEvidence[] = [];
    for (const link of anchors(html)) {
        const url = new URL(link.href, pageUrl); const itemId = url.pathname.match(/\/itm\/(?:[^/]+\/)?(\d{9,15})/i)?.[1];
        if (!itemId || seen.has(itemId)) continue;
        seen.add(itemId); results.push({ item_url: `https://www.ebay.com/itm/${itemId}`, brand, category: null });
        if (results.length >= maximum) break;
    }
    return results;
}

export function parseSellerFromItem(html: string, item: ItemEvidence): SellerCandidate | null {
    const decoded = html.replace(/&quot;/gi, '"').replace(/&amp;/gi, '&');
    const profileHref = anchors(decoded).map((link) => link.href).find((href) => /\/usr\/[^/?#"']+/i.test(href));
    const embedded = decoded.match(/"(?:sellerUsername|userAccountName|sellerName)"\s*:\s*"([^"\\]+)"/i)?.[1] ?? null;
    const username = profileHref ? decodeURIComponent(new URL(profileHref, item.item_url).pathname.match(/\/usr\/([^/?#]+)/i)?.[1] ?? '') : embedded;
    if (!username) return null;
    const category = decoded.match(/"category"\s*:\s*"([^"\\]+)"/i)?.[1] ?? decoded.match(/"categoryName"\s*:\s*"([^"\\]+)"/i)?.[1] ?? item.category;
    return { seller_id: username.toLowerCase(), seller_name: username, profile_url: `https://www.ebay.com/usr/${encodeURIComponent(username)}`, brands: [item.brand], categories: category ? [decode(category)] : [], item_urls: [item.item_url] };
}

export function mergeSellerCandidate(target: SellerCandidate, source: SellerCandidate): SellerCandidate {
    return { ...target, brands: [...new Set([...target.brands, ...source.brands])], categories: [...new Set([...target.categories, ...source.categories])], item_urls: [...new Set([...target.item_urls, ...source.item_urls])] };
}
