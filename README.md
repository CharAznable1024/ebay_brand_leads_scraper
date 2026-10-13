# eBay Brand Seller Lead Scraper

Custom Actor that discovers public eBay sellers from brand/category listings, then verifies public seller feedback, profile, and location from a representative listing. It emits one `ebay_brand_seller_lead` per seller. eBay does not publish a reliable account-wide sold counter, so `items_sold` is `null`; `feedback_score` is emitted as the public trust/volume metric.
