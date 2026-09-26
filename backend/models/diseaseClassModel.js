const mongoose = require('mongoose');
const { MALADIE_VALUES } = require('../constants/maladies');

const diseaseClassSchema = mongoose.Schema(
    {

        classNumber: {
            type: Number,
            default: 1,
        },
        placeCode: {
            type: Number,
            required: true,
            min: 1,
            max: 200,
        },
        description: {
            type: String,
            trim: true,
            default: '',
        },
        severity: {
            type: String,
            enum: ['low', 'moderate', 'high', 'critical'],
            default: 'moderate',
        },
        doctorId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
        maxPatients: {
            type: Number,
            required: true,
            default: 1,
            min: 1,
        },
        currentPatients: {
            type: Number,
            default: 0,
        },
        maladie: {
            type: String,
            enum: MALADIE_VALUES,
            required: true,
        },
        areaId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Area',
            required: true,
        },
        createdBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        isActive: {
            type: Boolean,
            default: true,
        },
    },
    { timestamps: true }
);

diseaseClassSchema.index(
    { areaId: 1, placeCode: 1 },
    { unique: true, partialFilterExpression: { isActive: true } }
);

module.exports = mongoose.model('DiseaseClass', diseaseClassSchema);
