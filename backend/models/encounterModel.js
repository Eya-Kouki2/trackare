const mongoose = require('mongoose');

const roomHistoryEntrySchema = new mongoose.Schema(
    {
        roomId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'DiseaseClass',
        },
        roomName: {
            type: String,
            trim: true,
            default: '',
        },
        placeCode: {
            type: Number,
        },
        enteredAt: {
            type: Date,
            default: Date.now,
        },
        leftAt: {
            type: Date,
            default: null,
        },
    },
    { _id: true }
);

const prescriptionItemSchema = new mongoose.Schema(
    {
        drug_name: {
            type: String,
            required: true,
            trim: true,
        },
        strength: {
            type: String,
            default: 'N/A',
            trim: true,
        },
        quantity: {
            type: Number,
            default: 1,
        },
        instructions: {
            type: String,
            default: '',
            trim: true,
        },
        dispensed: {
            type: Boolean,
            default: false,
        },
        dispensedAt: {
            type: Date,
        },
    },
    { _id: true }
);

const encounterSchema = new mongoose.Schema(
    {
        encounterNumber: {
            type: String,
            required: true,
            trim: true,
        },
        tokenNumber: {
            type: String,
            required: true,
            trim: true,
        },
        patientId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Patient',
            default: null, // Null upon anonymous arrival, linked when Doctor identifies CIN
        },
        triageSessionId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'TriageSession',
        },
        areaId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Area',
            required: true,
        },
        status: {
            type: String,
            enum: ['active', 'discharged', 'cancelled'],
            default: 'active',
        },
        startedAt: {
            type: Date,
            default: Date.now,
        },
        endedAt: {
            type: Date,
            default: null,
        },
        roomHistory: [roomHistoryEntrySchema],
        triageData: {
            symptoms: [{ type: String, trim: true }],
            vitals: {
                temperature: { type: String, trim: true, default: '' },
                pulse: { type: String, trim: true, default: '' },
                bloodPressure: { type: String, trim: true, default: '' },
                weight: { type: String, trim: true, default: '' },
                height: { type: String, trim: true, default: '' },
            },
            aiPrediction: {
                maladie: { type: String, trim: true },
                label: { type: String, trim: true },
                confidence: { type: Number },
            },
            priority: {
                type: String,
                enum: ['RED', 'ORANGE', 'YELLOW', 'GREEN', 'LOW', 'MODERATE', 'HIGH', 'CRITICAL', ''],
                default: '',
            },
            suggestedClass: {
                name: { type: String, trim: true, default: '' },
                placeCode: { type: Number },
                diseaseClassId: { type: mongoose.Schema.Types.ObjectId, ref: 'DiseaseClass' },
            },
        },
        consultation: {
            attendedBy: {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'User',
            },
            attendedAt: {
                type: Date,
            },
            clinicalNotes: {
                type: String,
                trim: true,
                default: '',
            },
            confirmedDiagnosis: {
                type: String,
                trim: true,
                default: '',
            },
            prescriptions: [prescriptionItemSchema],
        },
    },
    { timestamps: true }
);

encounterSchema.index({ areaId: 1, status: 1, startedAt: -1 });
encounterSchema.index({ patientId: 1, startedAt: -1 });
encounterSchema.index({ tokenNumber: 1, startedAt: -1 });

module.exports = mongoose.model('Encounter', encounterSchema);
