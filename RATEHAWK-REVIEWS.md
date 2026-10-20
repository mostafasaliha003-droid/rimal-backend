# RateHawk guest reviews

Hotel pages use the provider's `/api/content/v1/hotel_reviews_by_ids/` endpoint through the existing server credentials. No Google project or key is required. Google appears only as an optional, separate source when explicitly enabled and configured.

- Reviews are matched to the exact numeric hotel ID. A response for another hotel is rejected.
- Scores stay on the provider's **0–10** scale. Zero is a valid rating; missing or invalid scores never become zero.
- The displayed average is calculated from the available numeric reviews, with its sample size stated. It is not presented as a provider-wide hotel aggregate. Category averages use only actual numeric values supplied for that category.
- Reviews are shown newest first, including both positive and negative comments, author, date and room/stay information when supplied. Up to 200 recent reviews can be browsed in pages of ten; the UI states when the cap applies.
- Results, including a confirmed empty response, are cached for 12 hours in `RatehawkReviewCache`, separately by hotel, supplier environment and language. The cache never uses the site's customer-created `Hotel.reviews` array or Google content.
- Sandbox requests English, as required by ETG. The widget labels the environment and resolved review language. Production uses the requested supported language. Sandbox and Production content must not be mixed.
- Provider calls share an in-flight request. Hotel offers render independently. A slow lookup gets a bounded interactive wait and limited client retries; errors are distinct from a confirmed absence of reviews.
- No demo reviews are shipped to the live application. The current Sandbox returned an empty review list for the user's Vida property (hid `9770149`) and the sampled Hyatt property. A working integration does not establish that every hotel has provider reviews.

Validation: `node --test test-ratehawk-hotel-reviews.js`; `npm run test:frontend-isolated`. Fixtures exercise populated reviews, including negative feedback and a zero rating. Live checks must describe the response actually supplied by the configured environment.

[Official ETG reference](https://docs.emergingtravel.com/docs/content-api/retrieve-hotels-review-by-ids/)
