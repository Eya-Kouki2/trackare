const mongoose = require('mongoose');

const triageSessionSchema = new mongoose.Schema(
    {
        tokenNumber: {
            type: String,
            required: true,
            trim: true,
        },
        encounterId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Encounter',
            required: true,
        },
        date: {
            type: Date,
            default: Date.now,
        },
        areaId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Area',
            required: true,
        },
        symptoms: [{
            type: String,
            trim: true,
        }],
        vitals: {
            temperature: { type: String, trim: true, default: '' },
            pulse: { type: String, trim: true, default: '' },
            bloodPressure: { type: String, trim: true, default: '' },
            weight: { type: String, trim: true, default: '' },
            height: { type: String, trim: true, default: '' },
        },
        prediction: {
            maladie: { type: String, trim: true },
            label: { type: String, trim: true },
            confidence: { type: Number },
        },
        priority: {
            type: String,
            enum: ['RED', 'ORANGE', 'YELLOW', 'GREEN', 'LOW', 'MODERATE', 'HIGH', 'CRITICAL', ''],
            default: 'GREEN',
        },
        suggestedClass: {
            name: { type: String, trim: true, default: '' },
            placeCode: { type: Number },
            diseaseClassId: { type: mongoose.Schema.Types.ObjectId, ref: 'DiseaseClass' },
        },
        assignedRoom: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'DiseaseClass',
            default: null,
        },
        status: {
            type: String,
            enum: ['waiting_room', 'assigned', 'in_consultation', 'completed'],
            default: 'assigned',
        },
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
    },
    { timestamps: true }
);

triageSessionSchema.index({ areaId: 1, status: 1, createdAt: -1 });
triageSessionSchema.index({ tokenNumber: 1, date: -1 });

module.exports = mongoose.model('TriageSession', triageSessionSchema);
