// Stream and synchronize the ETG hotel dump into MongoDB.

require('dotenv').config();

const axios = require('axios');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const mongoose = require('mongoose');
const { pipeline } = require('stream/promises');
const client = require('./services/ratehawkClient');
const logger = require('./services/loggerService');
const { normalizeSupplierImage } = require('./services/supplierImages');
const Hotel = require('./models/Hotel');
const { normalizeHotelSearchText, hotelSearchTokens } = require('./services/hotelSearchIndex');

const MONGO_URI = process.env.MONGO_URI;
const BATCH_SIZE = 500;
const DOWNLOAD_TIMEOUT_MS = Number(process.env.RATEHAWK_DUMP_DOWNLOAD_TIMEOUT_MS || 30 * 60 * 1000);
const DUMP_DIR = path.join(__dirname, '.ratehawk-dump');
const ZST_FILE = path.join(DUMP_DIR, 'temp_dump.jsonl.zst');
const JSONL_FILE = path.join(DUMP_DIR, 'temp_dump.jsonl');

function pickImage(hotel) {
    const image = (hotel.images && hotel.images[0])
        || (hotel.images_ext && hotel.images_ext[0] && (hotel.images_ext[0].url || hotel.images_ext[0]))
        || '';
    return normalizeSupplierImage(image);
}

function toHotelOperation(hotel) {
    if (!hotel || typeof hotel !== 'object') return null;
    const hid = hotel.hid || hotel.hotel_id;
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
                    normalizedSupplierName: normalizeHotelSearchText(hotel.name || ''),
                    searchTokens: hotelSearchTokens(hotel.name || ''),
                    staticData: hotel
                }
            },
            upsert: true
        }
    };
}

async function downloadDump(url) {
    if (!/^https:\/\//i.test(url)) throw new Error('Refusing non-HTTPS hotel dump URL');
    const response = await axios.get(url, {
        responseType: 'stream',
        timeout: DOWNLOAD_TIMEOUT_MS,
        validateStatus: status => status >= 200 && status < 300
    });
    await pipeline(response.data, fs.createWriteStream(ZST_FILE));
}

async function decompressDump() {
    let zstd;
    try {
        zstd = require('simple-zstd');
    } catch (error) {
        throw new Error(`simple-zstd could not load: ${error.message}`);
    }
    const decompressor = await zstd.decompress();
    await pipeline(
        fs.createReadStream(ZST_FILE),
        decompressor,
        fs.createWriteStream(JSONL_FILE)
    );
}

async function flushBatch(batch, stats) {
    if (!batch.length) return;
    const operations = batch.map(toHotelOperation).filter(Boolean);
    stats.skipped += batch.length - operations.length;
    if (operations.length) {
        const result = await Hotel.bulkWrite(operations, { ordered: false });
        stats.upserted += result.upsertedCount || 0;
        stats.modified += result.modifiedCount || 0;
    }
    stats.batches += 1;
    logger.info('Hotel dump batch synchronized', {
        batch: stats.batches,
        read: stats.read,
        upserted: stats.upserted,
        modified: stats.modified,
        skipped: stats.skipped
    });
}

async function processJsonl() {
    const input = fs.createReadStream(JSONL_FILE, { encoding: 'utf8' });
    const lines = readline.createInterface({ input, crlfDelay: Infinity });
    const batch = [];
    const stats = { read: 0, batches: 0, upserted: 0, modified: 0, skipped: 0 };

    try {
        for await (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            stats.read += 1;
            let hotel;
            try {
                hotel = JSON.parse(trimmed);
            } catch (error) {
                throw new Error(`Invalid hotel JSON at line ${stats.read}: ${error.message}`);
            }
            batch.push(hotel);
            if (batch.length >= BATCH_SIZE) {
                lines.pause();
                await flushBatch(batch, stats);
                batch.length = 0;
                lines.resume();
            }
        }
        await flushBatch(batch, stats);
        return stats;
    } finally {
        lines.close();
        input.destroy();
    }
}

async function cleanupFiles() {
    await Promise.all([
        fs.promises.rm(ZST_FILE, { force: true }),
        fs.promises.rm(JSONL_FILE, { force: true })
    ]);
}

async function syncHotelDump() {
    if (!MONGO_URI) throw new Error('MONGO_URI is missing in environment variables');
    await fs.promises.mkdir(DUMP_DIR, { recursive: true });
    await cleanupFiles();

    try {
        await mongoose.connect(MONGO_URI);
        logger.info('Requesting ETG hotel dump URL');
        const dumpUrl = await client.getHotelDumpUrl();
        logger.info('Downloading ETG hotel dump');
        await downloadDump(dumpUrl);
        logger.info('Decompressing ETG hotel dump');
        await decompressDump();
        logger.info('Processing ETG hotel dump JSONL');
        const stats = await processJsonl();
        logger.info('ETG hotel dump synchronization complete', stats);
        return stats;
    } finally {
        await cleanupFiles();
        if (mongoose.connection.readyState !== 0) await mongoose.connection.close();
    }
}

if (require.main === module) {
    syncHotelDump().catch(error => {
        logger.error('ETG hotel dump synchronization failed', { error: error.message });
        process.exitCode = 1;
    });
}

module.exports = {
    BATCH_SIZE,
    toHotelOperation,
    processJsonl,
    syncHotelDump
};
