const express = require('express');
const verifyToken = require('../middleware/verifyToken');
const requireRole = require('../middleware/requireRole');
const {
    getDiseaseClasses,
    createDiseaseClass,
    updateDiseaseClass,
    deleteDiseaseClass,
    incrementPatients,
    decrementPatients,
    resetQueue,
} = require('../controllers/diseaseClassController');

const router = express.Router();

router.get('/', verifyToken, requireRole('admin', 'nurses', 'nurse', 'doctor', 'doctors', 'triage', 'pharmacy'), getDiseaseClasses);
router.post('/', verifyToken, requireRole('admin'), createDiseaseClass);
router.put('/:id', verifyToken, requireRole('admin'), updateDiseaseClass);
router.delete('/:id', verifyToken, requireRole('admin'), deleteDiseaseClass);
router.post('/:id/increment', verifyToken, requireRole('admin', 'nurses', 'nurse', 'doctor', 'doctors', 'triage', 'pharmacy'), incrementPatients);
router.post('/:id/decrement', verifyToken, requireRole('admin', 'nurses', 'nurse', 'doctor', 'doctors', 'triage', 'pharmacy'), decrementPatients);
router.post('/:id/reset-queue', verifyToken, requireRole('admin', 'nurses', 'nurse', 'doctor', 'doctors', 'triage', 'pharmacy'), resetQueue);

module.exports = router;
