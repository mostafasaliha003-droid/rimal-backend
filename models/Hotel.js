const mongoose = require('mongoose');

const translationSchema = new mongoose.Schema({
    name: String,
    description: String,
    city: String,
    address: String,
    country: String,
    source: { type: String, enum: ['editorial', 'machine', 'supplier'] },
    reviewStatus: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    updatedAt: Date,
    editor: String
}, { _id: false });

const searchAliasSchema = new mongoose.Schema({
    value: { type: String, required: true },
    normalized: { type: String, required: true },
    searchTokens: { type: [String], default: undefined },
    language: { type: String, enum: ['ar', 'en', 'es'], default: 'en' },
    source: { type: String, enum: ['editorial', 'machine'], default: 'editorial' },
    reviewStatus: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    reviewedAt: Date,
    editor: String
}, { _id: false });

const hotelSchema = new mongoose.Schema({
    hid: { type: String, index: true },
    hotelId: { type: String, required: true, unique: true },
    name: String,
    address: String,
    city: String,
    countryCode: String,
    stars: String,
    latitude: String,
    longitude: String,
    image: String,
    provider: { type: String, default: 'dubailink' },
    staticData: mongoose.Schema.Types.Mixed,
    reviews: [{ type: mongoose.Schema.Types.Mixed }],
    detailed_ratings: mongoose.Schema.Types.Mixed,
    normalizedSupplierName: { type: String, default: undefined },
    searchTokens: { type: [String], default: undefined },
    translationSearchTokens: { type: [String], default: undefined },
    translations: { type: Map, of: translationSchema, default: undefined },
    searchAliases: { type: [searchAliasSchema], default: undefined }
});

hotelSchema.index({ provider: 1, normalizedSupplierName: 1 }, { name: 'hotel_supplier_name_search' });
hotelSchema.index({ provider: 1, searchTokens: 1 }, { name: 'hotel_supplier_search_tokens' });
hotelSchema.index({ provider: 1, translationSearchTokens: 1 }, { name: 'hotel_translation_search_tokens' });
hotelSchema.index({ provider: 1, 'searchAliases.normalized': 1 }, { name: 'hotel_editorial_alias_search' });

module.exports = mongoose.models.Hotel || mongoose.model('Hotel', hotelSchema);