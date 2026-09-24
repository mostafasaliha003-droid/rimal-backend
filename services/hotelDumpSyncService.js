const axios = require('axios');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const zlib = require('zlib');
const mongoose = require('mongoose');
const { pipeline } = require('stream/promises');
const logger = require('./loggerService');
const { normalizeSupplierImage } = require('./supplierImages');

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
    staticData: mongoose.Schema.Types.Mixed,
    reviews: [{ type: mongoose.Schema.Types.Mixed }],
    detailed_ratings: mongoose.Schema.Types.Mixed
});
const Hotel = mongoose.models.Hotel || mongoose.model('Hotel', hotelSchema);

const BATCH_SIZE = 500;
const DOWNLOAD_TIMEOUT_MS = Number(process.env.RATEHAWK_DUMP_DOWNLOAD_TIMEOUT_MS || 30 * 60 * 1000);
const DUMP_DIR = path.join(__dirname, '..', '.ratehawk-dump');

function pickImage(hotel) {
    const image = (hotel.images && hotel.images[0])
        || (hotel.images_ext && hotel.images_ext[0] && (hotel.images_ext[0].url || hotel.images_ext[0]))
        || '';
    return normalizeSupplierImage(image);
}

function toStaticOperation(hotel) {
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
                    staticData: hotel
                }
            },
            upsert: true
        }
    };
}

function toReviewsOperation(hotel) {
    if (!hotel || typeof hotel !== 'object') return null;
    const hid = hotel.hid || hotel.hotel_id;
    if (hid === undefined || hid === null || hid === '') return null;
    const update = {};
    if (Array.isArray(hotel.reviews)) update.reviews = hotel.reviews;
    if (hotel.detailed_ratings !== undefined) update.detailed_ratings = hotel.detailed_ratings;
    if (!Object.keys(update).length) return null;
    return {
        updateOne: {
            filter: { hid: String(hid) },
            update: { $set: update },
            upsert: false
        }
    };
}

async function downloadDump(url, zstFile) {
    if (!/^https:\/\//i.test(url)) throw new Error('Refusing non-HTTPS hotel dump URL');
    const response = await axios.get(url, {
        responseType: 'stream',
        timeout: DOWNLOAD_TIMEOUT_MS,
        validateStatus: status => status >= 200 && status < 300
    });
    await pipeline(response.data, fs.createWriteStream(zstFile));
}

async function decompressDump(archiveFile, jsonlFile, compression = 'zstd') {
    if (compression === 'gzip') {
        await pipeline(
            fs.createReadStream(archiveFile),
            zlib.createGunzip(),
            fs.createWriteStream(jsonlFile)
        );
        return;
    }
    if (compression !== 'zstd') throw new Error(`Unsupported dump compression: ${compression}`);

    let zstd;
    try {
        zstd = require('simple-zstd');
    } catch (error) {
        throw new Error(`simple-zstd could not load: ${error.message}`);
    }
    const decompressor = await zstd.decompress();
    await pipeline(
        fs.createReadStream(archiveFile),
        decompressor,
        fs.createWriteStream(jsonlFile)
    );
}

async function processJsonl(jsonlFile, operationFactory, label, model = Hotel) {
    const input = fs.createReadStream(jsonlFile, { encoding: 'utf8' });
    const lines = readline.createInterface({ input, crlfDelay: Infinity });
    const batch = [];
    const stats = { read: 0, batches: 0, upserted: 0, modified: 0, skipped: 0 };

    async function flushBatch() {
        if (!batch.length) return;
        const operations = batch.map(operationFactory).filter(Boolean);
        stats.skipped += batch.length - operations.length;
        if (operations.length) {
            const result = await model.bulkWrite(operations, { ordered: false });
            stats.upserted += result.upsertedCount || 0;
            stats.modified += result.modifiedCount || 0;
        }
        stats.batches += 1;
        logger.info(`${label} dump batch synchronized`, {
            batch: stats.batches,
            read: stats.read,
            upserted: stats.upserted,
            modified: stats.modified,
            skipped: stats.skipped
        });
    }

    try {
        for await (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            stats.read += 1;
            let record;
            try {
                record = JSON.parse(trimmed);
            } catch (error) {
                throw new Error(`Invalid ${label} dump JSON at line ${stats.read}: ${error.message}`);
            }
            batch.push(record);
            if (batch.length >= BATCH_SIZE) {
                lines.pause();
                await flushBatch();
                batch.length = 0;
                lines.resume();
            }
        }
        await flushBatch();
        return stats;
    } finally {
        lines.close();
        input.destroy();
    }
}

async function cleanupFiles(files) {
    await Promise.all(files.map(file => fs.promises.rm(file, { force: true })));
}

async function syncDump({ name, getUrl, operationFactory, compression = 'zstd', model = Hotel }) {
    if (!process.env.MONGO_URI) throw new Error('MONGO_URI is missing in environment variables');
    if (!['zstd', 'gzip'].includes(compression)) throw new Error(`Unsupported dump compression: ${compression}`);
    const safeName = name.replace(/[^a-z0-9_-]/gi, '-').toLowerCase();
    const archiveFile = path.join(DUMP_DIR, `${safeName}.jsonl.${compression === 'gzip' ? 'gz' : 'zst'}`);
    const jsonlFile = path.join(DUMP_DIR, `${safeName}.jsonl`);
    await fs.promises.mkdir(DUMP_DIR, { recursive: true });
    await cleanupFiles([archiveFile, jsonlFile]);

    try {
        await mongoose.connect(process.env.MONGO_URI);
        logger.info(`Requesting ETG ${name} dump URL`);
        const url = await getUrl();
        logger.info(`Downloading ETG ${name} dump`);
        await downloadDump(url, archiveFile);
        logger.info(`Decompressing ETG ${name} dump`);
        await decompressDump(archiveFile, jsonlFile, compression);
        logger.info(`Processing ETG ${name} dump JSONL`);
        const stats = await processJsonl(jsonlFile, operationFactory, name, model);
        logger.info(`ETG ${name} dump synchronization complete`, stats);
        return stats;
    } finally {
        await cleanupFiles([archiveFile, jsonlFile]);
        if (mongoose.connection.readyState !== 0) await mongoose.connection.close();
    }
}

module.exports = {
    BATCH_SIZE,
    toStaticOperation,
    toReviewsOperation,
    decompressDump,
    processJsonl,
    syncDump
};
