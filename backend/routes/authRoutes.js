const express = require('express');
const { 
    signup,
    login, 
    logout, 
    verifyEmail, 
    forgotPassword,
    verifyResetCode,
    resetPassword,
    checkAuth,
    resendVerificationEmail,
    updateProfilePicture,
    deleteProfilePicture,
    updateProfile,
} = require('../controllers/authController');

const verifyToken = require('../middleware/verifyToken');
const requireRole = require('../middleware/requireRole');
const User = require('../models/userModel');
const Area = require('../models/areaModel');
const DiseaseClass = require('../models/diseaseClassModel');

const router = express.Router();

router.get('/check-auth', verifyToken, checkAuth);

router.post('/profile-picture', verifyToken, updateProfilePicture);

router.delete('/profile-picture', verifyToken, deleteProfilePicture);

router.put('/profile', verifyToken, updateProfile);

router.post('/signup', signup);

router.post('/login', login);

router.post('/logout', logout);

router.post('/verify-email', verifyEmail);

router.post('/resend-verification-email', resendVerificationEmail);

router.post('/forgot-password', forgotPassword);

router.post('/verify-reset-code', verifyResetCode);

router.post('/reset-password', resetPassword);

/* ── GET /api/auth/staff ─ Admin: list all staff in their hospital area with assigned rooms ── */
router.get('/staff', verifyToken, requireRole('admin'), async (req, res) => {
    try {
        // Find the area that belongs to this admin
        const area = await Area.findOne({ adminId: req.userID, isActive: true });
        if (!area) {
            return res.status(404).json({ success: false, message: 'No area found for this admin.' });
        }

        // Fetch all non-admin users linked to this area
        const staff = await User.find({
            areaId: area._id,
            role: { $in: ['nurses', 'nurse', 'doctor', 'doctors', 'triage', 'pharmacy'] },
        })
            .select('name email role profilePicture lastLogin isVerified createdAt assignedRoom')
            .populate('assignedRoom', 'placeCode maladie description maxPatients currentPatients')
            .sort({ role: 1, name: 1 });

        // Fetch all disease class rooms configured for this hospital area
        const rooms = await DiseaseClass.find({ areaId: area._id, isActive: true })
            .select('placeCode maladie description maxPatients currentPatients')
            .sort({ placeCode: 1 });

        res.json({ success: true, area: { name: area.name, code: area.code }, staff, rooms });
    } catch (err) {
        console.error('Error fetching staff:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

/* ── PUT /api/auth/staff/:id/role ─ Admin: update staff member role and doctor room assignment ── */
router.put('/staff/:id/role', verifyToken, requireRole('admin'), async (req, res) => {
    try {
        const { role, assignedRoom } = req.body;

        const area = await Area.findOne({ adminId: req.userID, isActive: true });
        if (!area) {
            return res.status(404).json({ success: false, message: 'No area found for this admin.' });
        }

        const validRoles = ['nurses', 'nurse', 'doctor', 'doctors', 'triage', 'pharmacy'];
        if (!validRoles.includes(role)) {
            return res.status(400).json({ success: false, message: 'Invalid role specified.' });
        }

        const staffMember = await User.findOne({ _id: req.params.id, areaId: area._id });
        if (!staffMember) {
            return res.status(404).json({ success: false, message: 'Staff member not found in your hospital.' });
        }

        // Normalize role name
        let normalizedRole = role;
        if (normalizedRole === 'nurse') normalizedRole = 'nurses';
        if (normalizedRole === 'doctors') normalizedRole = 'doctor';

        staffMember.role = normalizedRole;

        if (normalizedRole === 'doctor') {
            if (assignedRoom) {
                const room = await DiseaseClass.findOne({ _id: assignedRoom, areaId: area._id, isActive: true });
                if (!room) {
                    return res.status(400).json({ success: false, message: 'Invalid room selected for this hospital.' });
                }
                staffMember.assignedRoom = room._id;
            } else {
                staffMember.assignedRoom = null;
            }
        } else {
            staffMember.assignedRoom = null;
        }

        await staffMember.save();

        const updated = await User.findById(staffMember._id)
            .select('name email role profilePicture lastLogin isVerified createdAt assignedRoom')
            .populate('assignedRoom', 'placeCode maladie description maxPatients currentPatients');

        res.json({ success: true, message: 'Staff updated successfully', staff: updated });
    } catch (err) {
        console.error('Error updating staff role:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = router;