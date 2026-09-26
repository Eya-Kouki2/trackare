const mongoose = require('mongoose');

const MedicationSchema = new mongoose.Schema({
    areaId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Area',
        required: true,
        index: true,
    },
    drug_name: {
        type: String,
        required: true,
        trim: true,
    },
    strength: {
        type: String,
        default: "N/A",
    },
    quantity: {
        type: Number,
        default: 1,
    },
    expiry_date: {
        type: String,
        default: "UNKNOWN",
    },
    inventory_status: {
        type: String,
        default: "UNKNOWN",
    },
    scannedAt: {
        type: Date,
        default: Date.now,
    }
}, { timestamps: true });

module.exports = mongoose.model('Medication', MedicationSchema);
