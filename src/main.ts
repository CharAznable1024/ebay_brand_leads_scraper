import { createHash } from 'node:crypto';
import { Actor, log } from 'apify';

import { createWebUnlockerUsage, fetchWithWebUnlocker, htmlToVisibleText, inspectUnlockedPage } from './bright-data.js';
import { normalizeInput } from './input.js';
import { brandNameFromUrl, findEuropeFilterUrl, mergeSellerCandidate, parseBrandDirectory, parseBrandItems, parseSellerFromItem } from './parser.js';
import { createSerialGate, mapConcurrent, roundRobinItems, selectPendingCandidates } from './pipeline.js';
import { findAboutUrl, findFeedbackUrl, mergeStats, needsFeedbackEnrichment, parsePublicProfileText } from './profile.js';
import type { ActorInput, BrandSource, PublicProfileStats, SellerCandidate } from './types.js';

function hasProfileSignals(stats: PublicProfileStats): boolean {
    return [stats.items_sold, stats.follower_count, stats.feedback_rate, stats.feedback_score].some((value) => value !== null);
}

function hasFeedbackSignals(stats: PublicProfileStats): boolean {
    return [stats.feedback_score, stats.feedback_positive_12m, stats.feedback_neutral_12m, stats.feedback_negative_12m, stats.rating_accurate_description].some((value) => value !== null);
}

function normalizeBrandKey(value: string): string {
    return value.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function buildLead(candidate: SellerCandidate, stats: PublicProfileStats, scrapedAt: string, campaignId: string | null, shardId: string | null, runId: string) {
    const feedback = stats.feedback_score ?? 0;
    const matched = candidate.item_urls.length;
    const score = Math.min(100,
        Math.round(Math.log10(feedback + 1) * 18)
        + Math.round(Math.log10((stats.items_sold ?? 0) + 1) * 14)
        + Math.min(25, matched * 5),
    );
    return {
        record_type: 'ebay_brand_seller_lead',
        schema_version: '1.2',
        platform: 'ebay',
        campaign_id: campaignId,
        shard_id: shardId,
        run_id: runId,
        seller_id: candidate.seller_id,
        seller_name: candidate.seller_name,
        seller_username: candidate.seller_name,
        profile_url: candidate.profile_url,
        seller_country: stats.seller_country,
        seller_country_code: stats.seller_country_code,
        items_sold: stats.items_sold,
        items_listed: stats.items_listed,
        matched_listing_count: matched,
        follower_count: stats.follower_count,
        feedback_rate: stats.feedback_rate,
        feedback_score: stats.feedback_score,
        feedback_positive_12m: stats.feedback_positive_12m,
        feedback_neutral_12m: stats.feedback_neutral_12m,
        feedback_negative_12m: stats.feedback_negative_12m,
        rating_accurate_description: stats.rating_accurate_description,
        rating_shipping_cost: stats.rating_shipping_cost,
        rating_shipping_speed: stats.rating_shipping_speed,
        rating_communication: stats.rating_communication,
        brands: candidate.brands,
        categories: candidate.categories.slice(0, 3),
        sample_listing_urls: candidate.item_urls.slice(0, 5),
        lead_score: score,
        qualification: score >= 65 ? 'high' : score >= 35 ? 'medium' : 'low',
        dedupe_status: 'new' as 'new' | 'updated' | 'seen',
        scraped_at: scrapedAt,
    };
}

await Actor.init();
const input = normalizeInput(await Actor.getInput<ActorInput>());
const runId = process.env.APIFY_ACTOR_RUN_ID?.trim() || process.env.ACTOR_RUN_ID?.trim() || 'local';
const datasetId = process.env.APIFY_DEFAULT_DATASET_ID?.trim() || process.env.ACTOR_DEFAULT_DATASET_ID?.trim() || 'default';
const apiKey = process.env.BRIGHT_DATA_API_KEY?.trim();
const zone = process.env.BRIGHT_DATA_ZONE?.trim() || 'ebay_live_unlocker';
if (!apiKey) throw new Error('BRIGHT_DATA_API_KEY is required because eBay brand, item, and profile pages block data-center browsers.');
const brightDataUsage = createWebUnlockerUsage();
const runWebUnlockerRequest = createSerialGate(3_000);
const fetchPage = (url: string, render = false, timeoutSecs = input.navigationTimeoutSecs) => runWebUnlockerRequest(() => fetchWithWebUnlocker(url, {
    apiKey,
    zone,
    country: 'US',
    timeoutMillis: timeoutSecs * 1_000,
    maxAttempts: input.maxRequestRetries + 1,
    render,
}, fetch, brightDataUsage));

async function fetchParsedPage(url: string, label: string, usable: (stats: PublicProfileStats) => boolean, options: { renderFirst?: boolean; staticOnly?: boolean; timeoutSecs?: number } = {}) {
    const timeoutSecs = options.timeoutSecs ?? input.navigationTimeoutSecs;
    if (options.renderFirst) {
        const page = await fetchPage(url, true, timeoutSecs);
        const stats = parsePublicProfileText(htmlToVisibleText(page.html));
        return { page, stats, rendered: true };
    }
    let staticError: unknown = null;
    try {
        const page = await fetchPage(url, false, timeoutSecs);
        const stats = parsePublicProfileText(htmlToVisibleText(page.html));
        if (usable(stats) || options.staticOnly) return { page, stats, rendered: false };
    } catch (error) {
        staticError = error;
    }
    if (staticError) log.debug('Static Web Unlocker request did not produce usable data; retrying with rendering', { label, url, error: String(staticError) });
    const page = await fetchPage(url, true, timeoutSecs);
    const stats = parsePublicProfileText(htmlToVisibleText(page.html));
    return { page, stats, rendered: true };
}

log.info('Starting eBay brand seller discovery', {
    brands: input.brands,
    startUrls: input.startUrls.length,
    sellerCountries: input.sellerCountries,
    maxSellers: input.maxSellers,
    maxItemDetails: input.maxItemDetails,
    maxSellerProfiles: input.maxSellerProfiles,
    requestTimeoutSecs: input.navigationTimeoutSecs,
    retries: input.maxRequestRetries,
});

let sources: BrandSource[] = input.startUrls.map((brandUrl) => ({ brand: brandNameFromUrl(brandUrl), brand_url: brandUrl }));
const alreadyResolved = new Set(sources.map((source) => normalizeBrandKey(source.brand)));
const unresolvedBrands = input.brands.filter((brand) => !alreadyResolved.has(normalizeBrandKey(brand)));
if (unresolvedBrands.length) {
    const directoryUrl = 'https://www.ebay.com/n/all-brands';
    let directory = await fetchPage(directoryUrl, false);
    let discovered = parseBrandDirectory(directory.html, unresolvedBrands, directoryUrl);
    const unresolvedAfterStatic = unresolvedBrands.filter((brand) => !discovered.some((source) => normalizeBrandKey(source.brand) === normalizeBrandKey(brand)));
    if (unresolvedAfterStatic.length) {
        directory = await fetchPage(directoryUrl, true);
        discovered = parseBrandDirectory(directory.html, unresolvedBrands, directoryUrl);
    }
    sources = [...sources, ...discovered];
    const missing = unresolvedBrands.filter((brand) => !discovered.some((source) => normalizeBrandKey(source.brand) === normalizeBrandKey(brand)));
    if (missing.length) log.warning('Some requested brands were not found in eBay All Brands', { missing });
}
sources = [...new Map(sources.map((source) => [source.brand_url, source])).values()];
log.info('Resolved eBay brand sources', { requestedBrands: input.brands.length, directUrls: input.startUrls.length, resolvedSources: sources.length });

const discoveryDebug: Array<Record<string, unknown>> = [];
const perBrandItems = await mapConcurrent(sources, input.maxConcurrency, async (source) => {
    try {
        const europeUrl = findEuropeFilterUrl('', source.brand_url) as string;
        let filteredPage = await fetchPage(europeUrl, false);
        let items = parseBrandItems(filteredPage.html, europeUrl, source.brand, input.maxListingsPerBrand);
        if (!items.length) {
            filteredPage = await fetchPage(europeUrl, true);
            items = parseBrandItems(filteredPage.html, europeUrl, source.brand, input.maxListingsPerBrand);
        }
        discoveryDebug.push({ brand: source.brand, brand_url: source.brand_url, europe_filter_url: europeUrl, item_count: items.length, page: inspectUnlockedPage(filteredPage.html, filteredPage) });
        log.info('Collected Europe-filtered brand items', { brand: source.brand, itemCount: items.length, requestAttempts: brightDataUsage.request_attempts });
        return items;
    } catch (error) {
        discoveryDebug.push({ brand: source.brand, brand_url: source.brand_url, error: String(error) });
        log.warning('Brand discovery failed', { brand: source.brand, error: String(error) });
        return [];
    }
});
await Actor.setValue('BRAND_DISCOVERY_DEBUG', discoveryDebug);

const itemEvidence = roundRobinItems(perBrandItems, input.maxItemDetails);
const candidates = new Map<string, SellerCandidate>();
const attemptedSellerIds = new Set<string>();
const enrichmentDebug: Array<Record<string, unknown>> = [];
const emitted: ReturnType<typeof buildLead>[] = [];
const scrapedAt = new Date().toISOString();
const state = await Actor.openKeyValueStore(input.dedupeStoreName);
const itemBatchSize = Math.min(input.maxConcurrency, Math.max(1, input.maxSellers));
let itemDetailsAttempted = 0;
let itemSellersExtracted = 0;
let sellerProfilesSucceeded = 0;
let sellerProfilesFailed = 0;
let qualifiedBeforeDedupe = 0;
let dedupeFiltered = 0;
let aboutAttempted = 0;
let aboutSucceeded = 0;
let feedbackAttempted = 0;
let feedbackSucceeded = 0;

const output = (status: 'RUNNING' | 'SUCCEEDED' | 'ABORTED') => ({
    status,
    campaign_id: input.campaignId,
    shard_id: input.shardId,
    run_id: runId,
    dataset_id: datasetId,
    scanned_count: attemptedSellerIds.size,
    qualified_count: emitted.length,
    next_cursor: null,
    has_more: status !== 'SUCCEEDED' && emitted.length < input.maxSellers,
    brand_sources: sources.length,
    europe_filtered_items: itemEvidence.length,
    item_details_attempted: itemDetailsAttempted,
    item_sellers_extracted: itemSellersExtracted,
    seller_candidates: candidates.size,
    seller_profiles_attempted: attemptedSellerIds.size,
    seller_profiles_succeeded: sellerProfilesSucceeded,
    seller_profiles_failed: sellerProfilesFailed,
    about_enrichment_attempted: aboutAttempted,
    about_enrichment_succeeded: aboutSucceeded,
    feedback_enrichment_attempted: feedbackAttempted,
    feedback_enrichment_succeeded: feedbackSucceeded,
    qualified_before_dedupe: qualifiedBeforeDedupe,
    dedupe_filtered: dedupeFiltered,
    qualified_leads: emitted.length,
    stopped_early: emitted.length >= input.maxSellers && itemDetailsAttempted < itemEvidence.length,
    bright_data: brightDataUsage,
    scraped_at: scrapedAt,
});

async function persistProgress(status: 'RUNNING' | 'SUCCEEDED' | 'ABORTED'): Promise<void> {
    const value = output(status);
    await Actor.setValue('OUTPUT', value);
    await Actor.setValue('PROGRESS', value);
}

Actor.on('aborting', async () => {
    log.warning('Run is aborting; preserving checkpointed brand leads.');
    await persistProgress('ABORTED');
    await Actor.exit();
});

await persistProgress('RUNNING');

async function enrichCandidate(candidate: SellerCandidate): Promise<PublicProfileStats | null> {
    log.info('Enriching eBay seller profile', { seller: candidate.seller_id, profileAttempt: attemptedSellerIds.size, profileLimit: input.maxSellerProfiles });
    try {
        const isStoreProfile = /\/str\//i.test(candidate.profile_url);
        const profileUrl = isStoreProfile ? findAboutUrl('', candidate.profile_url, candidate.seller_name) : candidate.profile_url;
        const profile = await fetchParsedPage(profileUrl, 'profile', hasProfileSignals, isStoreProfile ? { staticOnly: true } : { renderFirst: true });
        let stats = profile.stats;
        if (!stats.seller_country_code && !isStoreProfile) {
            aboutAttempted += 1;
            const aboutUrl = findAboutUrl(profile.page.html, candidate.profile_url, candidate.seller_name);
            try {
                const about = await fetchParsedPage(aboutUrl, 'about', (value) => value.seller_country_code !== null);
                stats = mergeStats(stats, about.stats);
                if (about.stats.seller_country_code) aboutSucceeded += 1;
            } catch (error) {
                log.warning('Seller About enrichment failed', { seller: candidate.seller_id, error: String(error) });
            }
        }
        if (!stats.seller_country_code || !input.sellerCountries.includes(stats.seller_country_code)) {
            enrichmentDebug.push({ seller: candidate.seller_id, country: stats.seller_country_code, feedback_score: stats.feedback_score, items_sold: stats.items_sold, skipped_feedback: true });
            sellerProfilesSucceeded += 1;
            return stats;
        }
        if (needsFeedbackEnrichment(stats)) {
            feedbackAttempted += 1;
            const feedbackUrl = findFeedbackUrl(profile.page.html, candidate.profile_url, candidate.seller_name);
            try {
                const feedback = await fetchParsedPage(feedbackUrl, 'feedback', hasFeedbackSignals, { staticOnly: true, timeoutSecs: Math.min(input.navigationTimeoutSecs, 45) });
                stats = mergeStats(stats, feedback.stats);
                if (hasFeedbackSignals(feedback.stats)) feedbackSucceeded += 1;
            } catch (error) {
                log.warning('Seller Feedback enrichment failed', { seller: candidate.seller_id, error: String(error) });
            }
        }
        enrichmentDebug.push({ seller: candidate.seller_id, country: stats.seller_country_code, feedback_score: stats.feedback_score, items_sold: stats.items_sold });
        sellerProfilesSucceeded += 1;
        return stats;
    } catch (error) {
        sellerProfilesFailed += 1;
        enrichmentDebug.push({ seller: candidate.seller_id, error: String(error) });
        log.warning('Seller profile enrichment failed', { seller: candidate.seller_id, error: String(error) });
        return null;
    }
}

async function emitIfQualified(candidate: SellerCandidate, stats: PublicProfileStats | null): Promise<void> {
    if (!stats || stats.items_sold === null || candidate.item_urls.length < input.minMatchedListings || (stats.feedback_score ?? 0) < input.minFeedbackScore || !stats.seller_country_code || !input.sellerCountries.includes(stats.seller_country_code)) return;
    qualifiedBeforeDedupe += 1;
    const lead = buildLead(candidate, stats, scrapedAt, input.campaignId, input.shardId, runId);
    const key = `seller-${lead.seller_id}`.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 240);
    const fingerprint = createHash('sha256').update(JSON.stringify({ country: lead.seller_country_code, sold: lead.items_sold, feedback: lead.feedback_score, brands: lead.brands })).digest('hex');
    const previous = await state.getValue<{ fingerprint: string }>(key);
    lead.dedupe_status = !previous ? 'new' : previous.fingerprint === fingerprint ? 'seen' : 'updated';
    await state.setValue(key, { fingerprint, scraped_at: scrapedAt });
    if (input.dedupeMode === 'new_only' && lead.dedupe_status !== 'new') {
        dedupeFiltered += 1;
        return;
    }
    if (input.dedupeMode === 'new_and_updated' && lead.dedupe_status === 'seen') {
        dedupeFiltered += 1;
        return;
    }
    emitted.push(lead);
    await Actor.pushData(lead);
    await persistProgress('RUNNING');
    log.info('Qualified eBay brand seller lead', { seller: lead.seller_id, country: lead.seller_country_code, itemsSold: lead.items_sold, leadCount: emitted.length, target: input.maxSellers });
}

for (let offset = 0; offset < itemEvidence.length; offset += itemBatchSize) {
    if (emitted.length >= input.maxSellers || attemptedSellerIds.size >= input.maxSellerProfiles) break;
    const batch = itemEvidence.slice(offset, offset + itemBatchSize);
    itemDetailsAttempted += batch.length;
    const sellerParts = await mapConcurrent(batch, input.maxConcurrency, async (item) => {
        try {
            let page = await fetchPage(item.item_url, false);
            let seller = parseSellerFromItem(page.html, item);
            if (!seller) {
                page = await fetchPage(item.item_url, true);
                seller = parseSellerFromItem(page.html, item);
            }
            if (seller) itemSellersExtracted += 1;
            return seller;
        } catch (error) {
            log.warning('Item seller extraction failed', { itemUrl: item.item_url, error: String(error) });
            return null;
        }
    });
    for (const part of sellerParts) {
        if (!part) continue;
        const current = candidates.get(part.seller_id);
        candidates.set(part.seller_id, current ? mergeSellerCandidate(current, part) : part);
    }
    log.info('Processed item-detail batch', {
        processedItems: itemDetailsAttempted,
        availableItems: itemEvidence.length,
        sellerCandidates: candidates.size,
        profileAttempts: attemptedSellerIds.size,
        qualifiedLeads: emitted.length,
        brightDataSuccessfulRequests: brightDataUsage.successful_requests,
    });

    while (emitted.length < input.maxSellers && attemptedSellerIds.size < input.maxSellerProfiles) {
        const remainingProfileBudget = input.maxSellerProfiles - attemptedSellerIds.size;
        const pending = selectPendingCandidates(candidates.values(), attemptedSellerIds, input.minMatchedListings, Math.min(input.maxProfileConcurrency, remainingProfileBudget));
        if (!pending.length) break;
        for (const candidate of pending) attemptedSellerIds.add(candidate.seller_id);
        const enriched = await mapConcurrent(pending, input.maxProfileConcurrency, async (candidate) => ({ candidate, stats: await enrichCandidate(candidate) }));
        for (const result of enriched) {
            if (emitted.length >= input.maxSellers) break;
            await emitIfQualified(result.candidate, result.stats);
        }
        log.info('Processed seller-profile batch', {
            profileAttempts: attemptedSellerIds.size,
            profileLimit: input.maxSellerProfiles,
            qualifiedLeads: emitted.length,
            target: input.maxSellers,
            brightDataSuccessfulRequests: brightDataUsage.successful_requests,
            brightDataEstimatedCostUsd: brightDataUsage.estimated_cost_usd,
        });
    }
}

await Actor.setValue('SELLER_ENRICHMENT_DEBUG', enrichmentDebug);
await persistProgress('SUCCEEDED');
log.info('Finished eBay brand seller discovery', output('SUCCEEDED'));
await Actor.exit();
