const express = require('express');
const verifyToken = require('../middleware/verifyToken');
const requireRole = require('../middleware/requireRole');
const {
    getPatients,
    getPatient,
    searchPatients,
    getPatientByCin,
    createPatient,
    updatePatient,
    addPatientHistory,
    updatePatientHistory,
    deletePatient,
    getPatientsWithStats,
} = require('../controllers/patientController');

const router = express.Router();

router.get('/stats', verifyToken, requireRole('admin', 'nurses', 'nurse', 'doctor', 'doctors', 'triage', 'pharmacy'), getPatientsWithStats);
router.get('/search', verifyToken, requireRole('admin', 'nurses', 'nurse', 'doctor', 'doctors', 'triage', 'pharmacy'), searchPatients);
router.get('/by-cin/:cin', verifyToken, requireRole('admin', 'nurses', 'nurse', 'doctor', 'doctors', 'triage', 'pharmacy'), getPatientByCin);
router.get('/', verifyToken, requireRole('admin', 'nurses', 'nurse', 'doctor', 'doctors', 'triage', 'pharmacy'), getPatients);
router.get('/:id', verifyToken, requireRole('admin', 'nurses', 'nurse', 'doctor', 'doctors', 'triage', 'pharmacy'), getPatient);
router.post('/', verifyToken, requireRole('admin', 'nurses', 'nurse', 'doctor', 'doctors', 'triage', 'pharmacy'), createPatient);
router.put('/:id', verifyToken, requireRole('admin', 'nurses', 'nurse', 'doctor', 'doctors', 'triage', 'pharmacy'), updatePatient);
router.post('/:id/history', verifyToken, requireRole('admin', 'nurses', 'nurse', 'doctor', 'doctors', 'triage', 'pharmacy'), addPatientHistory);
router.put('/:id/history/:historyId', verifyToken, requireRole('admin', 'nurses', 'nurse', 'doctor', 'doctors', 'triage', 'pharmacy'), updatePatientHistory);
router.delete('/:id', verifyToken, requireRole('admin'), deletePatient);

module.exports = router;

