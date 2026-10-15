export type DedupeMode = 'all' | 'new_only' | 'new_and_updated';

export interface ActorInput {
    brands?: unknown;
    startUrls?: unknown;
    sellerCountries?: unknown;
    maxListingsPerBrand?: unknown;
    maxItemDetails?: unknown;
    maxSellerProfiles?: unknown;
    maxSellers?: unknown;
    minFeedbackScore?: unknown;
    minMatchedListings?: unknown;
    maxConcurrency?: unknown;
    maxProfileConcurrency?: unknown;
    maxRequestRetries?: unknown;
    navigationTimeoutSecs?: unknown;
    dedupeMode?: unknown;
    dedupeStoreName?: unknown;
}

export interface Input {
    brands: string[];
    startUrls: string[];
    sellerCountries: string[];
    maxListingsPerBrand: number;
    maxItemDetails: number;
    maxSellerProfiles: number;
    maxSellers: number;
    minFeedbackScore: number;
    minMatchedListings: number;
    maxConcurrency: number;
    maxProfileConcurrency: number;
    maxRequestRetries: number;
    navigationTimeoutSecs: number;
    dedupeMode: DedupeMode;
    dedupeStoreName: string;
}

export interface BrandSource { brand: string; brand_url: string }
export interface ItemEvidence { item_url: string; brand: string; category: string | null }
export interface SellerCandidate {
    seller_id: string;
    seller_name: string;
    profile_url: string;
    brands: string[];
    categories: string[];
    item_urls: string[];
}

export interface PublicProfileStats {
    feedback_rate: number | null;
    feedback_score: number | null;
    feedback_positive_12m: number | null;
    feedback_neutral_12m: number | null;
    feedback_negative_12m: number | null;
    rating_accurate_description: number | null;
    rating_shipping_cost: number | null;
    rating_shipping_speed: number | null;
    rating_communication: number | null;
    items_sold: number | null;
    items_listed: number | null;
    follower_count: number | null;
    seller_country: string | null;
    seller_country_code: string | null;
    stats_source: 'seller_profile';
}
