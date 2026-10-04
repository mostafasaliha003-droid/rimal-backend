const mongoose = require('mongoose');

const staticDictionarySchema = new mongoose.Schema({
    beddings: mongoose.Schema.Types.Mixed,
    meals: mongoose.Schema.Types.Mixed,
    room_amenities: mongoose.Schema.Types.Mixed,
    serp_filters: mongoose.Schema.Types.Mixed,
    socket_types: mongoose.Schema.Types.Mixed,
    taxes: mongoose.Schema.Types.Mixed,
    amenity_translations: mongoose.Schema.Types.Mixed,
    amenities: mongoose.Schema.Types.Mixed
}, { strict: false });

module.exports = mongoose.models.StaticDictionary
    || mongoose.model('StaticDictionary', staticDictionarySchema);
