# Google hotel reviews

The integration uses Places API (New), not scraping or imported review files. It is disabled until the server has both a key and explicit enablement. No Google credentials belong in Vite variables, source files, logs or chat.

## Enable on Staging

1. Create or select a Google Cloud project, attach billing, and enable **Places API (New)**.
2. Create a server API key. Restrict it to Places API (New) and appropriate server egress IPs where possible. Do not apply browser HTTP-referrer restrictions to a server key.
3. In Render **rimal-api-staging** → Environment, add:

   ```env
   GOOGLE_PLACES_API_KEY=<server key entered privately in Render>
   GOOGLE_REVIEWS_ENABLED=true
   GOOGLE_PLACES_DAILY_REQUEST_LIMIT=200
   ```

4. Save and deploy on Staging. Leave Production unchanged.
5. Open a hotel, select **Show Google reviews**, and check the matched Google listing, author links, source links, translated/original text and numeric rating. Confirm the Google Cloud project can access the required Places fields.

Google bills matching searches and review detail requests according to its current SKUs. The daily setting caps provider HTTP requests, not currency expenditure. Configure billing budgets/alerts in Google Cloud as well. Repeated visitors requesting reviews consume additional detail requests because ratings and review content are not cached.

## Matching and display

- The server uses the supplier's canonical name and coordinates. A match must be a lodging property within 300 metres with a sufficiently close name, matching building qualifiers, and exactly one qualifying place ID. Ambiguous matches show no rating.
- Only Google place IDs and our own verification timestamps are stored. Reviews, ratings, search responses and author profiles are not persisted or put in a completed-response cache. Concurrent requests can share an in-flight response.
- The widget requests reviews only after visitor interaction. It never labels Google authors as verified Remal guests, invents a rating, filters out low ratings, or constructs rating distributions from Google's selected sample.
- Google chooses up to five reviews in relevance order. The widget explains this, shows author attribution, links to individual reviews when supplied, offers original text, and displays visit month/year when provided.
- The official unmodified Google Maps attribution logo is bundled from [Google's attribution assets](https://developers.google.com/maps/documentation/places/web-service/policies?hl=en). Public `/privacy` and `/terms` pages incorporate Google policy links.
- A missing key, disabled API, exhausted quota, unmatched property or provider outage never blocks room offers, checkout or existing bookings. A Google Maps search link remains available, clearly labelled as a search.

## Verification

`node --test test-google-hotel-reviews.js` uses provider fixtures and makes no Google requests. `npm run test:frontend-isolated` covers the display, negative ratings, source attribution and original text without Google billing. Live retrieval must also be checked after a valid key is configured; fixture checks do not establish Google project access.

References: [Places policies](https://developers.google.com/maps/documentation/places/web-service/policies?hl=en), [Text Search](https://developers.google.com/maps/documentation/places/web-service/text-search?hl=en), [Place Details](https://developers.google.com/maps/documentation/places/web-service/place-details?hl=en).
