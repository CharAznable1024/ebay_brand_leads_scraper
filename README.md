# eBay EU Brand Seller Lead Scraper

This Actor starts from eBay's public [All Brands](https://www.ebay.com/n/all-brands) directory, resolves requested brand pages, applies the public **Item location: Europe** filter, opens representative product pages to identify sellers, and enriches each seller through the same public Profile, About and Feedback pages used by the eBay Live Actor.

`brands` and `startUrls` are optional. When both are empty, the Actor automatically uses a balanced default portfolio (`Gucci`, `CHANEL`, `Nike`, and `Apple`) so a caller can request seller leads with only `maxSellers` and qualification filters.

The current eBay Europe filter URL is `LH_PrefLoc=5&mag=1` (for example `https://www.ebay.com/b/Gucci/bn_21826083?LH_PrefLoc=5&mag=1`). The item-location filter narrows product evidence; seller country is still verified independently from About.

The output is one seller lead per public eBay username. `brands` means brands evidenced by sampled product URLs; it does not claim official authorization. `matched_listing_count` is the number of sampled Europe-filtered listings tied to the seller. Seller country is verified separately from the public seller About page before output.

A seller is emitted only after both its public country and `items_sold` value have been parsed. Candidates with only a country and no public sales count are skipped so a low-information profile cannot consume the requested output quota.

eBay brand, item, and seller pages block data-center browsers, so the Actor requires the existing `BRIGHT_DATA_API_KEY` Apify secret and uses the `ebay_live_unlocker` Web Unlocker zone.

## Aime shard tracing and timeout safety

Optional `campaignId` and `shardId` inputs are copied to every Dataset row as `campaign_id` and `shard_id`. The Actor reads `run_id` and `dataset_id` from the current Apify runtime. Each qualified seller is pushed immediately instead of waiting for the Run to finish, and OUTPUT/PROGRESS expose `scanned_count`, `qualified_count`, `next_cursor`, and `has_more`. If the Run times out, already checkpointed Dataset rows remain available; Aime should aggregate and deduplicate by `campaign_id + seller_id`.

## Request-efficient execution

The Actor processes small item batches, verifies sellers as soon as they are discovered, and stops once `maxSellers` leads have actually passed country, threshold, and deduplication checks. It no longer opens every item and every seller profile before applying the output limit.

- Static HTML is requested first. Browser rendering is used only when a page does not contain the required public fields.
- Item parsing prioritizes the product's embedded seller username over unrelated `/usr` links from recommendation modules, and uses the seller's public `/str` store URL when available.
- Store leads use the static `/str/<store>?_tab=about` and `?_tab=feedback` pages, which publish the seller country, items sold, followers, and feedback without browser rendering.
- Web Unlocker calls are serialized with a short cooldown, and an adaptive-rate-limit response receives one dedicated retry.
- Feedback detail is optional enrichment and uses one rendered request capped at 45 seconds, so it cannot add two full page timeouts to every qualified seller.
- Feedback enrichment runs only when the score or positive/neutral/negative counts are missing. Missing optional detailed ratings remain `null` without another paid request.
- Brand evidence from multiple requested brands is sampled round-robin before the global item limit is applied.
- The default Web Unlocker timeout is 60 seconds with no automatic retry. Operators can still increase both values for unstable runs.
- The `OUTPUT` record contains item/profile progress, early-stop status, Bright Data attempts, successful requests, and estimated Bright Data cost at $0.0015 per successful request.
- Progress is logged after every brand, item-detail batch, seller-profile batch, and qualified lead.

For API calls, `startUrls` uses Apify request objects:

```json
{
  "brands": [],
  "startUrls": [
    {
      "url": "https://www.ebay.com/b/Gucci/bn_21826083?LH_PrefLoc=5&mag=1"
    }
  ],
  "sellerCountries": ["EU"],
  "maxSellers": 1,
  "dedupeMode": "all"
}
```
