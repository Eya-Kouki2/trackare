const mongoose = require('mongoose');

/**
 * ScanQueue — persists IoT-detected medicines BEFORE user acceptance.
 * Survives page refresh, internet loss, and is shared across all sessions.
 * Status lifecycle: "pending" → "accepted" (moved to Medication) | "rejected" (deleted)
 */
const ScanQueueSchema = new mongoose.Schema({
    areaId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Area',
        required: false, // null = not yet assigned to an area (set on acceptance)
        index: true,
    },
    drug_name: {
        type: String,
        required: true,
        trim: true,
        uppercase: true,
    },
    strength: {
        type: String,
        default: 'N/A',
    },
    quantity: {
        type: Number,
        default: 1,
    },
    expiry_date: {
        type: String,
        default: 'UNKNOWN',
    },
    inventory_status: {
        type: String,
        default: 'UNKNOWN',
    },
    confidence: {
        type: String,
        default: 'MEDIUM',
    },
    source: {
        type: String,
        default: 'IoT Live Camera',
    },
    image_name: {
        type: String,
        default: '',
    },
    verification: {
        type: mongoose.Schema.Types.Mixed,
        default: {},
    },
    status: {
        type: String,
        enum: ['pending', 'accepted', 'rejected'],
        default: 'pending',
        index: true,
    },
    scannedAt: {
        type: Date,
        default: Date.now,
    },
}, { timestamps: true });

module.exports = mongoose.model('ScanQueue', ScanQueueSchema);
