import { createHash } from 'node:crypto';
import { Actor, log } from 'apify';

import { fetchWithWebUnlocker, htmlToVisibleText, inspectUnlockedPage } from './bright-data.js';
import { normalizeInput } from './input.js';
import { brandNameFromUrl, findEuropeFilterUrl, mergeSellerCandidate, parseBrandDirectory, parseBrandItems, parseSellerFromItem } from './parser.js';
import { findAboutUrl, findFeedbackUrl, mergeStats, parsePublicProfileText } from './profile.js';
import type { ActorInput, BrandSource, PublicProfileStats, SellerCandidate } from './types.js';

await Actor.init();
const input = normalizeInput(await Actor.getInput<ActorInput>());
const apiKey = process.env.BRIGHT_DATA_API_KEY?.trim();
const zone = process.env.BRIGHT_DATA_ZONE?.trim() || 'ebay_live_unlocker';
if (!apiKey) throw new Error('BRIGHT_DATA_API_KEY is required because eBay brand, item, and profile pages block data-center browsers.');
if (!input.brands.length && !input.startUrls.length) throw new Error('Provide at least one brand name or public eBay brand page URL.');

const fetchPage = (url: string, render = true) => fetchWithWebUnlocker(url, { apiKey, zone, country: 'US', timeoutMillis: input.navigationTimeoutSecs * 1_000, maxAttempts: input.maxRequestRetries + 1, render });
async function mapConcurrent<T, R>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
    const results = new Array<R>(items.length); let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (cursor < items.length) { const index = cursor; cursor += 1; results[index] = await worker(items[index], index); }
    }));
    return results;
}

let sources: BrandSource[] = input.startUrls.map((brandUrl) => ({ brand: brandNameFromUrl(brandUrl), brand_url: brandUrl }));
if (input.brands.length) {
    const directory = await fetchPage('https://www.ebay.com/n/all-brands', false);
    const discovered = parseBrandDirectory(directory.html, input.brands, 'https://www.ebay.com/n/all-brands');
    sources = [...sources, ...discovered];
    const missing = input.brands.filter((brand) => !discovered.some((source) => source.brand.toLowerCase() === brand.toLowerCase()));
    if (missing.length) log.warning('Some requested brands were not found in eBay All Brands', { missing });
}
sources = [...new Map(sources.map((source) => [source.brand_url, source])).values()];

const discoveryDebug: Array<Record<string, unknown>> = [];
const perBrandItems = await mapConcurrent(sources, input.maxConcurrency, async (source) => {
    try {
        const europeUrl = findEuropeFilterUrl('', source.brand_url) as string;
        let filteredPage = await fetchPage(europeUrl, false);
        let items = parseBrandItems(filteredPage.html, europeUrl, source.brand, input.maxListingsPerBrand);
        if (!items.length) { filteredPage = await fetchPage(europeUrl, true); items = parseBrandItems(filteredPage.html, europeUrl, source.brand, input.maxListingsPerBrand); }
        discoveryDebug.push({ brand: source.brand, brand_url: source.brand_url, europe_filter_url: europeUrl, item_count: items.length, page: inspectUnlockedPage(filteredPage.html, filteredPage) });
        return items;
    } catch (error) {
        discoveryDebug.push({ brand: source.brand, brand_url: source.brand_url, error: String(error) });
        log.warning('Brand discovery failed', { brand: source.brand, error: String(error) });
        return [];
    }
});
await Actor.setValue('BRAND_DISCOVERY_DEBUG', discoveryDebug);
const itemEvidence = [...new Map(perBrandItems.flat().map((item) => [item.item_url, item])).values()].slice(0, input.maxItemDetails);

const sellerParts = await mapConcurrent(itemEvidence, input.maxConcurrency, async (item) => {
    try { let page = await fetchPage(item.item_url, false); let seller = parseSellerFromItem(page.html, item); if (!seller) { page = await fetchPage(item.item_url, true); seller = parseSellerFromItem(page.html, item); } return seller; }
    catch (error) { log.warning('Item seller extraction failed', { itemUrl: item.item_url, error: String(error) }); return null; }
});
const candidates = new Map<string, SellerCandidate>();
for (const part of sellerParts) {
    if (!part) continue;
    const current = candidates.get(part.seller_id); candidates.set(part.seller_id, current ? mergeSellerCandidate(current, part) : part);
}
const selectedCandidates = [...candidates.values()].sort((a, b) => b.item_urls.length - a.item_urls.length).slice(0, input.maxSellerProfiles);

const enrichmentDebug: Array<Record<string, unknown>> = [];
const enriched = await mapConcurrent(selectedCandidates, input.maxProfileConcurrency, async (candidate) => {
    try {
        const profile = await fetchPage(candidate.profile_url); let stats = parsePublicProfileText(htmlToVisibleText(profile.html));
        if (!stats.seller_country_code) {
            const about = await fetchPage(findAboutUrl(profile.html, candidate.profile_url, candidate.seller_name));
            stats = mergeStats(stats, parsePublicProfileText(htmlToVisibleText(about.html)));
        }
        if (!stats.seller_country_code || !input.sellerCountries.includes(stats.seller_country_code)) {
            enrichmentDebug.push({ seller: candidate.seller_id, country: stats.seller_country_code, feedback_score: stats.feedback_score, items_sold: stats.items_sold, skipped_feedback: true });
            return { candidate, stats };
        }
        if ([stats.feedback_score, stats.feedback_positive_12m, stats.rating_accurate_description].some((value) => value === null)) {
            const feedback = await fetchPage(findFeedbackUrl(profile.html, candidate.profile_url, candidate.seller_name));
            stats = mergeStats(stats, parsePublicProfileText(htmlToVisibleText(feedback.html)));
        }
        enrichmentDebug.push({ seller: candidate.seller_id, country: stats.seller_country_code, feedback_score: stats.feedback_score, items_sold: stats.items_sold });
        return { candidate, stats };
    } catch (error) { enrichmentDebug.push({ seller: candidate.seller_id, error: String(error) }); log.warning('Seller profile enrichment failed', { seller: candidate.seller_id, error: String(error) }); return { candidate, stats: null as PublicProfileStats | null }; }
});
await Actor.setValue('SELLER_ENRICHMENT_DEBUG', enrichmentDebug);

const scrapedAt = new Date().toISOString();
let leads = enriched.map(({ candidate, stats }) => {
    const feedback = stats?.feedback_score ?? 0; const matched = candidate.item_urls.length;
    const score = Math.min(100, Math.round(Math.log10(feedback + 1) * 18) + Math.round(Math.log10((stats?.items_sold ?? 0) + 1) * 14) + Math.min(25, matched * 5));
    return {
        record_type: 'ebay_brand_seller_lead', schema_version: '1.1', platform: 'ebay', seller_id: candidate.seller_id,
        seller_name: candidate.seller_name, seller_username: candidate.seller_name, profile_url: candidate.profile_url,
        seller_country: stats?.seller_country ?? null, seller_country_code: stats?.seller_country_code ?? null,
        items_sold: stats?.items_sold ?? null, items_listed: stats?.items_listed ?? null, matched_listing_count: matched,
        follower_count: stats?.follower_count ?? null, feedback_rate: stats?.feedback_rate ?? null, feedback_score: stats?.feedback_score ?? null,
        feedback_positive_12m: stats?.feedback_positive_12m ?? null, feedback_neutral_12m: stats?.feedback_neutral_12m ?? null, feedback_negative_12m: stats?.feedback_negative_12m ?? null,
        rating_accurate_description: stats?.rating_accurate_description ?? null, rating_shipping_cost: stats?.rating_shipping_cost ?? null, rating_shipping_speed: stats?.rating_shipping_speed ?? null, rating_communication: stats?.rating_communication ?? null,
        brands: candidate.brands, categories: candidate.categories.slice(0, 3), sample_listing_urls: candidate.item_urls.slice(0, 5),
        lead_score: score, qualification: score >= 65 ? 'high' : score >= 35 ? 'medium' : 'low', dedupe_status: 'new' as 'new' | 'updated' | 'seen', scraped_at: scrapedAt,
    };
}).filter((lead) => lead.matched_listing_count >= input.minMatchedListings && (lead.feedback_score ?? 0) >= input.minFeedbackScore && !!lead.seller_country_code && input.sellerCountries.includes(lead.seller_country_code));

const state = await Actor.openKeyValueStore(input.dedupeStoreName); const emitted: typeof leads = [];
for (const lead of leads.sort((a, b) => b.lead_score - a.lead_score)) {
    const key = `seller-${lead.seller_id}`.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 240);
    const fingerprint = createHash('sha256').update(JSON.stringify({ country: lead.seller_country_code, sold: lead.items_sold, feedback: lead.feedback_score, brands: lead.brands })).digest('hex');
    const previous = await state.getValue<{ fingerprint: string }>(key); lead.dedupe_status = !previous ? 'new' : previous.fingerprint === fingerprint ? 'seen' : 'updated';
    await state.setValue(key, { fingerprint, scraped_at: scrapedAt });
    if (input.dedupeMode === 'new_only' && lead.dedupe_status !== 'new') continue;
    if (input.dedupeMode === 'new_and_updated' && lead.dedupe_status === 'seen') continue;
    emitted.push(lead); if (emitted.length >= input.maxSellers) break;
}
leads = emitted;
await Actor.pushData(leads);
await Actor.setValue('OUTPUT', { status: 'SUCCEEDED', brand_sources: sources.length, europe_filtered_items: itemEvidence.length, seller_candidates: candidates.size, seller_profiles_attempted: selectedCandidates.length, qualified_leads: leads.length, scraped_at: scrapedAt });
await Actor.exit();
