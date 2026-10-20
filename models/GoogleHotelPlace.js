const mongoose = require('mongoose');
const schema = new mongoose.Schema({
    hid: { type: String, required: true, unique: true },
    placeId: { type: String, required: true },
    supplierIdentity: { type: String, required: true },
    verifiedAt: { type: Date, required: true }
}, { versionKey: false });
// Only the exempt Google place ID is persisted, never ratings or review content.
module.exports = mongoose.models.GoogleHotelPlace || mongoose.model('GoogleHotelPlace', schema);
