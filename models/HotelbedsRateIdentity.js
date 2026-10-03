const mongoose = require('mongoose');

module.exports = new mongoose.Schema({
    hotelCode: { type: String, required: true, minlength: 1, maxlength: 200 },
    roomCode: { type: String, required: true, minlength: 1, maxlength: 200 },
    checkIn: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    checkOut: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    net: { type: String, required: true, match: /^\d+(?:\.\d+)?$/ },
    currency: { type: String, required: true, uppercase: true, match: /^[A-Z]{3}$/ },
    rateClass: { type: String, required: true, minlength: 1, maxlength: 80 },
    boardCode: { type: String, required: true, minlength: 1, maxlength: 80 },
    packaging: { type: Boolean, required: true },
    roomCount: { type: Number, required: true, min: 1, max: 9 },
    adultCount: { type: Number, required: true, min: 1, max: 36 },
    childCount: { type: Number, required: true, min: 0, max: 36 },
    paymentType: { type: String, required: true, minlength: 1, maxlength: 80 }
}, { _id: false, strict: 'throw' });