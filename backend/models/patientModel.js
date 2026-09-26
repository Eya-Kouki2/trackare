const mongoose = require('mongoose');

const historyEntrySchema = mongoose.Schema(
    {
        date: {
            type: Date,
            default: Date.now,
        },
        type: {
            type: String,
            enum: ['visit', 'diagnosis', 'treatment', 'note'],
            default: 'visit',
        },
        title: {
            type: String,
            required: true,
            trim: true,
        },
        notes: {
            type: String,
            trim: true,
            default: '',
        },
        triage: {
            vitals: {
                temperature: { type: String, trim: true, default: '' },
                pulse: { type: String, trim: true, default: '' },
                bloodPressure: { type: String, trim: true, default: '' },
                weight: { type: String, trim: true, default: '' },
                height: { type: String, trim: true, default: '' },
            },
            symptoms: [{ type: String, trim: true }],
            duration: { type: String, trim: true, default: '' },
            additionalNotes: { type: String, trim: true, default: '' },
            predictions: [{
                maladie: { type: String, trim: true },
                label: { type: String, trim: true },
                confidence: { type: Number },
            }],
            priority: { type: String, trim: true, default: '' },
            suggestedClass: {
                name: { type: String, trim: true, default: '' },
                placeCode: { type: Number },
            },
        },
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
        },
    },
    { timestamps: true }
);

const patientSchema = mongoose.Schema(
    {
        cin: {
            type: String,
            required: true,
            trim: true,
            uppercase: true,
        },
        name: {
            type: String,
            required: true,
            trim: true,
        },
        dateOfBirth: {
            type: Date,
        },
        gender: {
            type: String,
            enum: ['male', 'female', 'other'],
        },
        phone: {
            type: String,
            trim: true,
            default: '',
        },
        bloodType: {
            type: String,
            trim: true,
            default: '',
        },
        address: {
            type: String,
            trim: true,
            default: '',
        },
        areaId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Area',
            required: true,
        },
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
        history: [historyEntrySchema],
        isActive: {
            type: Boolean,
            default: true,
        },
    },
    { timestamps: true }
);

patientSchema.virtual('encounters', {
    ref: 'Encounter',
    localField: '_id',
    foreignField: 'patientId',
});

patientSchema.set('toObject', { virtuals: true });
patientSchema.set('toJSON', { virtuals: true });

patientSchema.index({ areaId: 1, cin: 1 }, { unique: true, partialFilterExpression: { isActive: true } });

module.exports = mongoose.model('Patient', patientSchema);
