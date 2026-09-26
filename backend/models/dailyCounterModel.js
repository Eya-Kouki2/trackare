const mongoose = require('mongoose');

const dailyCounterSchema = new mongoose.Schema(
    {
        dateString: {
            type: String, // Format: YYYY-MM-DD
            required: true,
            trim: true,
        },
        areaId: {
            type: String,   // stored as plain string (ObjectId.toString()) for reliable upsert matching
            required: true,
        },
        sequence: {
            type: Number,
            default: 0,
        },
    },
    { timestamps: true }
);

dailyCounterSchema.index({ dateString: 1, areaId: 1 }, { unique: true });

module.exports = mongoose.model('DailyCounter', dailyCounterSchema);
