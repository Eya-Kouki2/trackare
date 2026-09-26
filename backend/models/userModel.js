const mongoose = require('mongoose');

const userShema = mongoose.Schema({
    email : {
        type : String,
        required: true
    },
    password : {
        type : String,
        required : true
    },
    name : {
        type : String,
        required : true
    },
    lastLogin : {
        type : Date,
        default : Date.now
    },
    isVerified : {
        type : Boolean,
        default : false
    },
    resetPasswordToken : String,
    resetPasswordExpiresAt : Date,
    verificationToken : String,
    verificationTokenExpiresAt : Date,
    role: {
        type: String,
        enum: ['admin', 'nurses', 'nurse', 'doctor', 'doctors', 'triage', 'pharmacy'],
        required: true,
    },
    areaId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Area',
        default: null,
    },
    assignedRoom: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'DiseaseClass',
        default: null,
    },
    profilePicture: {
        type: String,
        default: null,
    },
    profilePicturePublicId: {
        type: String,
        default: null,
    },
},
{
    timestamps: true

});

module.exports = mongoose.model('User', userShema)