import type { ItemEvidence, SellerCandidate } from './types.js';

export function createSerialGate(minDelayMillis: number) {
    let tail = Promise.resolve();
    let nextAllowedAt = 0;
    return function runSerially<T>(operation: () => Promise<T>): Promise<T> {
        const run = tail.then(async () => {
            const waitMillis = Math.max(0, nextAllowedAt - Date.now());
            if (waitMillis) await new Promise((resolve) => setTimeout(resolve, waitMillis));
            try {
                return await operation();
            } finally {
                nextAllowedAt = Date.now() + Math.max(0, minDelayMillis);
            }
        });
        tail = run.then(() => undefined, () => undefined);
        return run;
    };
}

export async function mapConcurrent<T, R>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
    const results = new Array<R>(items.length);
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
        while (cursor < items.length) {
            const index = cursor;
            cursor += 1;
            results[index] = await worker(items[index], index);
        }
    }));
    return results;
}

export function roundRobinItems(groups: ItemEvidence[][], maximum: number): ItemEvidence[] {
    const results: ItemEvidence[] = [];
    const seen = new Set<string>();
    const longest = Math.max(0, ...groups.map((group) => group.length));
    for (let index = 0; index < longest && results.length < maximum; index += 1) {
        for (const group of groups) {
            const item = group[index];
            if (!item || seen.has(item.item_url)) continue;
            seen.add(item.item_url);
            results.push(item);
            if (results.length >= maximum) break;
        }
    }
    return results;
}

export function selectPendingCandidates(candidates: Iterable<SellerCandidate>, attemptedSellerIds: Set<string>, minimumMatchedListings: number, maximum: number): SellerCandidate[] {
    return [...candidates]
        .filter((candidate) => !attemptedSellerIds.has(candidate.seller_id) && candidate.item_urls.length >= minimumMatchedListings)
        .sort((left, right) => right.item_urls.length - left.item_urls.length || left.seller_id.localeCompare(right.seller_id))
        .slice(0, maximum);
}
