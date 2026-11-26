const mongoose = require('mongoose');

// Payment provider fee schedules entered by the administrator (Ziina, Tabby, Tamara later).
// Values are decimal strings so nothing is rounded on the way in.
const financeSettingSchema = new mongoose.Schema({
    _id: String,
    providers: mongoose.Schema.Types.Mixed,
    updatedBy: String
}, { collection: 'financesettings', timestamps: true, versionKey: false, bufferCommands: false });

module.exports = mongoose.models.FinanceSetting || mongoose.model('FinanceSetting', financeSettingSchema);
