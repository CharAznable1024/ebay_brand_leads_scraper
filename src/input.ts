import type { ActorInput, DedupeMode, Input } from './types.js';

const EU_COUNTRIES = ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE'];
export const DEFAULT_BRANDS = ['Gucci', 'CHANEL', 'Nike', 'Apple'];
const list = (value: unknown, fallback: string[], field: string): string[] => {
    const raw = value === undefined ? fallback : value;
    if (!Array.isArray(raw)) throw new Error(`${field} must be an array`);
    return [...new Set(raw.map((item) => typeof item === 'string' ? item.trim() : item && typeof item === 'object' && typeof (item as { url?: unknown }).url === 'string' ? String((item as { url: string }).url).trim() : '').filter(Boolean))];
};
const integer = (value: unknown, fallback: number, min: number, max: number, field: string): number => {
    const resolved = value === undefined ? fallback : value;
    if (!Number.isInteger(resolved) || Number(resolved) < min || Number(resolved) > max) throw new Error(`${field} must be an integer between ${min} and ${max}`);
    return Number(resolved);
};
const optionalIdentifier = (value: unknown, field: string): string | null => {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string') throw new Error(`${field} must be a string`);
    const resolved = value.trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(resolved)) throw new Error(`${field} is invalid`);
    return resolved;
};

export function normalizeInput(raw: ActorInput | null | undefined): Input {
    const data = raw ?? {};
    const startUrls = list(data.startUrls, [], 'startUrls');
    for (const value of startUrls) {
        const url = new URL(value);
        if (url.protocol !== 'https:' || !/(^|\.)ebay\.[a-z.]+$/i.test(url.hostname) || !/\/b\//.test(url.pathname)) throw new Error('startUrls must contain public eBay brand page URLs');
    }
    const requestedCountries = list(data.sellerCountries, ['EU'], 'sellerCountries').map((value) => value.toUpperCase());
    if (requestedCountries.some((value) => value !== 'EU' && !/^[A-Z]{2}$/.test(value))) throw new Error('sellerCountries must contain ISO alpha-2 codes or EU');
    const sellerCountries = [...new Set(requestedCountries.flatMap((value) => value === 'EU' ? EU_COUNTRIES : value))];
    const dedupeMode = (data.dedupeMode ?? 'new_and_updated') as DedupeMode;
    if (!['all', 'new_only', 'new_and_updated'].includes(dedupeMode)) throw new Error('Invalid dedupeMode');
    const requestedBrands = list(data.brands, [], 'brands');
    const brands = requestedBrands.length || startUrls.length ? requestedBrands : [...DEFAULT_BRANDS];
    return {
        campaignId: optionalIdentifier(data.campaignId, 'campaignId'),
        shardId: optionalIdentifier(data.shardId, 'shardId'),
        brands, startUrls, sellerCountries,
        maxListingsPerBrand: integer(data.maxListingsPerBrand, 30, 1, 200, 'maxListingsPerBrand'),
        maxItemDetails: integer(data.maxItemDetails, 80, 1, 500, 'maxItemDetails'),
        maxSellerProfiles: integer(data.maxSellerProfiles, 40, 1, 200, 'maxSellerProfiles'),
        maxSellers: integer(data.maxSellers, 10, 1, 200, 'maxSellers'),
        minFeedbackScore: integer(data.minFeedbackScore, 0, 0, 1_000_000_000, 'minFeedbackScore'),
        minMatchedListings: integer(data.minMatchedListings, 1, 1, 1_000_000, 'minMatchedListings'),
        maxConcurrency: integer(data.maxConcurrency, 5, 1, 10, 'maxConcurrency'),
        maxProfileConcurrency: integer(data.maxProfileConcurrency, 1, 1, 3, 'maxProfileConcurrency'),
        maxRequestRetries: integer(data.maxRequestRetries, 0, 0, 5, 'maxRequestRetries'),
        navigationTimeoutSecs: integer(data.navigationTimeoutSecs, 60, 15, 180, 'navigationTimeoutSecs'),
        dedupeMode,
        dedupeStoreName: typeof data.dedupeStoreName === 'string' && /^[a-zA-Z0-9._-]{3,63}$/.test(data.dedupeStoreName) ? data.dedupeStoreName : 'ebay-brand-seller-lead-state-v1',
    };
}
