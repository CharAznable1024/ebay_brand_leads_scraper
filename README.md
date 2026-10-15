# eBay EU Brand Seller Lead Scraper

This Actor starts from eBay's public [All Brands](https://www.ebay.com/n/all-brands) directory, resolves requested brand pages, applies the public **Item location: Europe** filter, opens representative product pages to identify sellers, and enriches each seller through the same public Profile, About and Feedback pages used by the eBay Live Actor.

The output is one seller lead per public eBay username. `brands` means brands evidenced by sampled product URLs; it does not claim official authorization. `matched_listing_count` is the number of sampled Europe-filtered listings tied to the seller. Seller country is verified separately from the public seller About page before output.

eBay brand, item, and seller pages block data-center browsers, so the Actor requires the existing `BRIGHT_DATA_API_KEY` Apify secret and uses the `ebay_live_unlocker` Web Unlocker zone.
