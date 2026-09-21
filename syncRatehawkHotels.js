// syncRatehawkHotels.js
// Standalone static-data sync for RateHawk / Emerging Travel Group (ETG) API v3.
//
// RateHawk's live search (serp/hp) returns only hotel IDs + prices, so this script
// pre-loads the static content (names, images, location) into our local MongoDB
// `Hotel` collection so mappingService.js can enrich live results.
//
// Flow (per the ETG Integration Guide):
//   1) POST /api/b2b/v3/search/serp/region/      -> active hotel IDs for a region
//   2) POST /api/content/v1/hotel_content_by_ids/ -> static content for those IDs
//   3) Upsert the mapped content into MongoDB (bulkWrite, upsert:true)
//
// Run:   node syncRatehawkHotels.js
//        node syncRatehawkHotels.js <region_id>          (override region)
// Env:   RATEHAWK_SYNC_REGION_ID, RATEHAWK_SYNC_CHECKIN, RATEHAWK_SYNC_CHECKOUT,
//        RATEHAWK_SYNC_HOTELS_LIMIT, RATEHAWK_SYNC_LANGUAGE

require('dotenv').config();
const mongoose = require('mongoose');
const axios = require('axios');

// ==========================================
// 1. Hotel model (matches hotelSchema in server.js / syncHotels.js)
// ==========================================
const hotelSchema = new mongoose.Schema({
    hotelId: { type: String, required: true, unique: true },
    name: String,
    address: String,
    city: String,
    countryCode: String,
    stars: String,
    latitude: String,
    longitude: String,
    image: String,
    provider: { type: String, default: 'dubailink' }
});
const Hotel = mongoose.models.Hotel || mongoose.model('Hotel', hotelSchema);

// ==========================================
// 2. Configuration
// ==========================================
const MONGO_URI = process.env.MONGO_URI;
// Fully env-driven base URL (RATEHAWK_BASE_URL). Sandbox: https://api-sandbox.ratehawk.com,
// Production: https://api.ratehawk.com. Legacy *.worldota.net hosts are deprecated.
// Accepts a bare host or a trailing /api/b2b/v3 and normalizes to the host.
const BASE_URL = String(process.env.RATEHAWK_BASE_URL || 'https://api-sandbox.ratehawk.com')
    .trim().replace(/\/+$/, '').replace(/\/api\/b2b\/v3$/, '');
// HTTP Basic Auth. Accepts the requested names, falling back to the ones already in .env.
const API_ID = process.env.RATEHAWK_API_ID || process.env.RATEHAWK_KEY_ID;
const API_TOKEN = process.env.RATEHAWK_API_TOKEN || process.env.RATEHAWK_API_KEY;

const REGION_ID = Number(process.argv[2] || process.env.RATEHAWK_SYNC_REGION_ID || 5317); // 5317 = Dubai (production)
const CHECKIN = process.env.RATEHAWK_SYNC_CHECKIN || '2026-10-10';
const CHECKOUT = process.env.RATEHAWK_SYNC_CHECKOUT || '2026-10-11';
const HOTELS_LIMIT = Number(process.env.RATEHAWK_SYNC_HOTELS_LIMIT || 200);
const LANGUAGE = process.env.RATEHAWK_SYNC_LANGUAGE || 'ar';
const CURRENCY = process.env.RATEHAWK_CURRENCY || 'USD';
const RESIDENCY = String(process.env.RATEHAWK_RESIDENCY || 'ae').toLowerCase().slice(0, 2);
const CONTENT_BATCH = 100; // ids per content request

const http = axios.create({
    baseURL: BASE_URL,
    auth: { username: String(API_ID), password: String(API_TOKEN) },
    headers: { 'Content-Type': 'application/json' },
    timeout: 60000,
    // Resolve for any status so we can read ETG's error envelope (e.g. validation_error) on 4xx.
    validateStatus: () => true
});

// Pick the first high-res image URL and expand a {size} template if present.
function pickImage(hotel) {
    const raw = (hotel.images && hotel.images[0])
        || (hotel.images_ext && hotel.images_ext[0] && hotel.images_ext[0].url)
        || '';
    return raw ? raw.replace('{size}', '1024x768') : '';
}

// ==========================================
// 3. Main sync routine
// ==========================================
async function syncRatehawkHotels() {
    try {
        if (!MONGO_URI) throw new Error('MONGO_URI is missing in environment variables!');
        if (!API_ID || !API_TOKEN) throw new Error('RateHawk credentials missing (RATEHAWK_API_ID / RATEHAWK_API_TOKEN).');

        console.log('🔗 Connecting to MongoDB...');
        await mongoose.connect(MONGO_URI);
        console.log('✅ Connected to MongoDB successfully.');
        console.log(`🌐 RateHawk base URL: ${BASE_URL} (key id: ${API_ID})`);

        // ---- Step 1: SERP region search -> active hotel IDs ----
        console.log(`\n🌍 Step 1: Searching region ${REGION_ID} (${CHECKIN} → ${CHECKOUT}, limit ${HOTELS_LIMIT})...`);
        const serpRes = await http.post('/api/b2b/v3/search/serp/region/', {
            region_id: REGION_ID,
            checkin: CHECKIN,
            checkout: CHECKOUT,
            guests: [{ adults: 2, children: [] }],
            hotels_limit: HOTELS_LIMIT,
            language: LANGUAGE,
            currency: CURRENCY,
            residency: RESIDENCY
        });

        if (!serpRes.data || serpRes.data.status !== 'ok') {
            const detail = serpRes.data && serpRes.data.debug && serpRes.data.debug.validation_error;
            throw new Error(`SERP region search failed: ${(serpRes.data && serpRes.data.error) || 'unknown'}${detail ? ' (' + detail + ')' : ''}`);
        }
        const serpHotels = (serpRes.data.data && serpRes.data.data.hotels) || [];
        const ids = serpHotels.map(h => h.id).filter(Boolean);
        console.log(`   ✅ Found ${ids.length} active hotel IDs in region ${REGION_ID}.`);
        if (!ids.length) {
            console.log('⚠️  No hotels returned — nothing to sync.');
            await mongoose.connection.close();
            return process.exit(0);
        }

        // ---- Step 2: Fetch static content for those IDs (batched) ----
        console.log(`\n📚 Step 2: Fetching static content for ${ids.length} hotels (language: ${LANGUAGE})...`);
        let content = [];
        for (let i = 0; i < ids.length; i += CONTENT_BATCH) {
            const batch = ids.slice(i, i + CONTENT_BATCH);
            const cRes = await http.post('/api/content/v1/hotel_content_by_ids/', { ids: batch, language: LANGUAGE });
            if (!cRes.data || cRes.data.status !== 'ok') {
                console.warn(`   ⚠️ Content batch ${i}-${i + batch.length} failed: ${cRes.data && cRes.data.error}`);
                continue;
            }
            const arr = cRes.data.data || [];
            content = content.concat(arr);
            console.log(`   Batch ${Math.floor(i / CONTENT_BATCH) + 1}: received ${arr.length} (total ${content.length}/${ids.length}).`);
        }
        if (!content.length) {
            console.log('⚠️  No content returned — nothing to save.');
            await mongoose.connection.close();
            return process.exit(0);
        }

        // ---- Step 3: Map to hotelSchema and bulk-upsert ----
        console.log(`\n💾 Step 3: Mapping and upserting ${content.length} hotels into MongoDB...`);
        const ops = [];
        let withImages = 0;
        for (const h of content) {
            if (!h || !h.id) continue;
            const image = pickImage(h);
            if (image) withImages++;
            ops.push({
                updateOne: {
                    filter: { hotelId: String(h.id) },
                    update: {
                        $set: {
                            hotelId: String(h.id),
                            name: h.name || '',
                            address: h.address || '',
                            city: (h.region && h.region.name) || 'دبي',
                            countryCode: (h.region && h.region.country_code) || 'AE',
                            stars: String(h.star_rating != null ? h.star_rating : ''),
                            latitude: String(h.latitude != null ? h.latitude : ''),
                            longitude: String(h.longitude != null ? h.longitude : ''),
                            image: image,
                            provider: 'ratehawk'
                        }
                    },
                    upsert: true
                }
            });
        }

        const result = await Hotel.bulkWrite(ops, { ordered: false });
        const upserted = result.upsertedCount || 0;
        const modified = result.modifiedCount || 0;
        console.log(`\n🎉 Sync complete! Inserted: ${upserted}, Updated: ${modified}, Processed: ${ops.length}.`);
        console.log(`   🖼️  ${withImages}/${ops.length} hotels have an image URL (sandbox test hotels often have none).`);

        await mongoose.connection.close();
        console.log('🔌 MongoDB connection closed.');
        process.exit(0);

    } catch (error) {
        console.error('❌ RateHawk sync failed:', error.message);
        try { await mongoose.connection.close(); } catch (e) { /* ignore */ }
        // Non-zero exit so cron/CI can detect failures.
        process.exit(1);
    }
}

syncRatehawkHotels();
