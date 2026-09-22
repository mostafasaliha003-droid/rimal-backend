const mongoose = require('mongoose');

const regionSchema = new mongoose.Schema({
    id: { type: Number, required: true, unique: true, index: true },
    type: String,
    name: mongoose.Schema.Types.Mixed,
    country_code: String,
    iata: String,
    center: {
        latitude: Number,
        longitude: Number
    },
    hids: [{ type: Number }],
    hotels: [{ type: String }]
});

module.exports = mongoose.models.Region || mongoose.model('Region', regionSchema);
