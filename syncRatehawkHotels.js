// Stream ETG / RateHawk static hotel data dumps into MongoDB.

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const https = require('https');
const mongoose = require('mongoose');
const { pipeline } = require('stream/promises');

const hotelSchema = new mongoose.Schema({
    hid: { type: String, required: true, index: true },
    hotelId: { type: String, required: true, unique: true },
    name: String,
    address: String,
    city: String,
    countryCode: String,
    stars: String,
    latitude: String,
    longitude: String,
    image: String,
    provider: { type: String, default: 'ratehawk' },
    staticData: mongoose.Schema.Types.Mixed
});
const Hotel = mongoose.models.Hotel || mongoose.model('Hotel', hotelSchema);

const MONGO_URI = process.env.MONGO_URI;
const BASE_URL = String(process.env.RATEHAWK_BASE_URL || 'https://api-sandbox.ratehawk.com')
    .trim().replace(/\/+$/, '').replace(/\/api\/b2b\/v3$/, '');
const API_ID = process.env.RATEHAWK_API_ID || process.env.RATEHAWK_KEY_ID;
const API_TOKEN = process.env.RATEHAWK_API_TOKEN || process.env.RATEHAWK_API_KEY;
const BULK_BATCH_SIZE = 500;
const REQUEST_TIMEOUT_MS = Number(process.env.RATEHAWK_DUMP_REQUEST_TIMEOUT_MS || 60000);
const DOWNLOAD_TIMEOUT_MS = Number(process.env.RATEHAWK_DUMP_DOWNLOAD_TIMEOUT_MS || 30 * 60 * 1000);
const DUMP_DIR = path.join(__dirname, '.ratehawk-dump');
const DUMP_FILE = path.join(DUMP_DIR, 'hotel-static.json.zst');
const JSON_FILE = path.join(DUMP_DIR, 'hotel-static.json');

function basicAuthHeader() {
    return `Basic ${Buffer.from(`${String(API_ID)}:${String(API_TOKEN)}`).toString('base64')}`;
}

function requestJson(urlString, options = {}, body = null) {
    return new Promise((resolve, reject) => {
        const url = new URL(urlString);
        const request = https.request(url, {
            method: options.method || 'GET',
            headers: {
                Accept: 'application/json',
                ...(body === null ? {} : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }),
                ...options.headers
            },
            timeout: REQUEST_TIMEOUT_MS
        }, response => {
            const chunks = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('end', () => {
                const text = Buffer.concat(chunks).toString('utf8');
                let parsed;
                try { parsed = text ? JSON.parse(text) : {}; } catch (error) {
                    reject(new Error(`ETG returned invalid JSON (HTTP ${response.statusCode}): ${error.message}`));
                    return;
                }
                if ((response.statusCode || 500) < 200 || (response.statusCode || 500) >= 300) {
                    reject(new Error(`ETG request failed with HTTP ${response.statusCode}: ${JSON.stringify(parsed)}`));
                    return;
                }
                resolve(parsed);
            });
            response.on('error', reject);
        });
        request.on('timeout', () => request.destroy(new Error(`ETG request timed out after ${REQUEST_TIMEOUT_MS}ms`)));
        request.on('error', reject);
        if (body !== null) request.write(body);
        request.end();
    });
}

async function requestDumpUrl() {
    const response = await requestJson(
        `${BASE_URL}/api/b2b/v3/hotel/info/dump/`,
        { method: 'POST', headers: { Authorization: basicAuthHeader() } },
        JSON.stringify({})
    );
    if (response.status !== 'ok') {
        const detail = response.debug && response.debug.validation_error;
        throw new Error(`ETG dump request failed: ${response.error || 'unknown'}${detail ? ` (${detail})` : ''}`);
    }
    const data = response.data || {};
    const downloadUrl = typeof data === 'string' ? data : data.url || data.download_url || response.url;
    if (!downloadUrl) throw new Error('ETG dump response did not contain a temporary download URL');
    return downloadUrl;
}

function downloadToFile(urlString, destination, redirects = 0) {
    return new Promise((resolve, reject) => {
        if (redirects > 5) {
            reject(new Error('Too many redirects while downloading ETG dump'));
            return;
        }
        const url = new URL(urlString);
        if (url.protocol !== 'https:') {
            reject(new Error(`Refusing non-HTTPS ETG dump URL: ${url.protocol}`));
            return;
        }
        const output = fs.createWriteStream(destination);
        const request = https.get(url, { timeout: DOWNLOAD_TIMEOUT_MS }, response => {
            if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
                output.close();
                fs.rmSync(destination, { force: true });
                response.resume();
                if (!response.headers.location) {
                    reject(new Error(`ETG download redirect had no Location header (HTTP ${response.statusCode})`));
                    return;
                }
                downloadToFile(new URL(response.headers.location, url).toString(), destination, redirects + 1)
                    .then(resolve, reject);
                return;
            }
            if (response.statusCode !== 200) {
                response.resume();
                output.close();
                fs.rmSync(destination, { force: true });
                reject(new Error(`ETG dump download failed with HTTP ${response.statusCode}`));
                return;
            }
            response.pipe(output);
            output.on('finish', () => output.close(resolve));
            response.on('error', error => { output.destroy(); reject(error); });
        });
        request.on('timeout', () => request.destroy(new Error(`ETG dump download timed out after ${DOWNLOAD_TIMEOUT_MS}ms`)));
        request.on('error', error => { output.destroy(); reject(error); });
    });
}

async function decompressDump() {
    let zstd;
    try {
        zstd = require('simple-zstd');
    } catch (error) {
        throw new Error(`simple-zstd could not load. Install the system zstd executable: ${error.message}`);
    }
    await pipeline(
        fs.createReadStream(DUMP_FILE),
        zstd.ZSTDDecompress(),
        fs.createWriteStream(JSON_FILE)
    );
}

function pickImage(hotel) {
    const image = (hotel.images && hotel.images[0])
        || (hotel.images_ext && hotel.images_ext[0] && (hotel.images_ext[0].url || hotel.images_ext[0]))
        || '';
    return typeof image === 'string' ? image.replace(/\{size\}/gi, '2048x1536') : '';
}

function toHotelUpdate(hotel) {
    const hid = hotel && (hotel.hid || hotel.hotel_id);
    if (hid === undefined || hid === null || hid === '') return null;
    const region = hotel.region || {};
    const hotelId = hotel.id || hotel.hotel_id || hid;
    return {
        updateOne: {
            filter: { hid: String(hid) },
            update: {
                $set: {
                    hid: String(hid),
                    hotelId: String(hotelId),
                    name: hotel.name || '',
                    address: hotel.address || '',
                    city: hotel.city || region.name || '',
                    countryCode: hotel.country_code || region.country_code || '',
                    stars: String(hotel.star_rating != null ? hotel.star_rating : ''),
                    latitude: String(hotel.latitude != null ? hotel.latitude : ''),
                    longitude: String(hotel.longitude != null ? hotel.longitude : ''),
                    image: pickImage(hotel),
                    provider: 'ratehawk',
                    staticData: hotel
                }
            },
            upsert: true
        }
    };
}

async function flushBatch(batch, stats) {
    if (!batch.length) return;
    const result = await Hotel.bulkWrite(batch, { ordered: false });
    stats.upserted += result.upsertedCount || 0;
    stats.modified += result.modifiedCount || 0;
    stats.batches += 1;
    console.log(`   MongoDB batch ${stats.batches}: ${batch.length} hotels (read ${stats.read}, skipped ${stats.skipped})`);
    batch.length = 0;
}

async function processDump() {
    const batch = [];
    const stats = { read: 0, skipped: 0, parsed: 0, upserted: 0, modified: 0, batches: 0 };
    const stream = fs.createReadStream(JSON_FILE, { highWaterMark: 1024 * 1024 });
    let buffer = '';

    for await (const chunk of stream) {
        buffer += chunk.toString('utf8');
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            stats.read += 1;
            let hotel;
            try { hotel = JSON.parse(trimmed); } catch (error) {
                throw new Error(`Invalid hotel JSON at line ${stats.read}: ${error.message}`);
            }
            const operation = toHotelUpdate(hotel);
            if (!operation) {
                stats.skipped += 1;
                continue;
            }
            stats.parsed += 1;
            batch.push(operation);
            if (batch.length === BULK_BATCH_SIZE) await flushBatch(batch, stats);
        }
    }

    const finalLine = buffer.trim();
    if (finalLine) {
        stats.read += 1;
        let operation;
        try { operation = toHotelUpdate(JSON.parse(finalLine)); } catch (error) {
            throw new Error(`Invalid hotel JSON at line ${stats.read}: ${error.message}`);
        }
        if (operation) {
            stats.parsed += 1;
            batch.push(operation);
        } else stats.skipped += 1;
    }
    await flushBatch(batch, stats);
    return stats;
}

async function cleanupFiles() {
    await Promise.all([
        fs.promises.rm(DUMP_FILE, { force: true }),
        fs.promises.rm(JSON_FILE, { force: true })
    ]);
}

async function syncRatehawkHotels() {
    if (!MONGO_URI) throw new Error('MONGO_URI is missing in environment variables');
    if (!API_ID || !API_TOKEN) throw new Error('RateHawk credentials are missing');

    await fs.promises.mkdir(DUMP_DIR, { recursive: true });
    await cleanupFiles();
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(MONGO_URI);
        console.log('MongoDB connected.');
        console.log('Requesting ETG hotel static dump URL...');
        const downloadUrl = await requestDumpUrl();
        console.log('Temporary dump URL received; downloading compressed dump...');
        await downloadToFile(downloadUrl, DUMP_FILE);
        console.log('Compressed dump downloaded; decompressing with simple-zstd...');
        await decompressDump();
        console.log('Dump decompressed; processing hotel records in 500-item batches...');
        const stats = await processDump();
        console.log(`Sync complete: ${stats.parsed} parsed, ${stats.upserted} inserted, ${stats.modified} updated, ${stats.skipped} skipped.`);
    } finally {
        await cleanupFiles();
        await mongoose.connection.close();
        console.log('Temporary dump files removed; MongoDB connection closed.');
    }
}

syncRatehawkHotels().catch(error => {
    console.error(`RateHawk static dump sync failed: ${error.message}`);
    process.exitCode = 1;
});
