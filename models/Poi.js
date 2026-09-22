const mongoose = require('mongoose');

const poiSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true },
    hid: { type: Number, required: true, index: true },
    pois: [{
        poi_name: String,
        poi_name_en: String,
        poi_type: String,
        poi_subtype: String,
        distance: mongoose.Schema.Types.Mixed
    }]
});

module.exports = mongoose.models.Poi || mongoose.model('Poi', poiSchema);
