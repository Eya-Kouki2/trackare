const express = require('express');
const verifyToken = require('../middleware/verifyToken');
const {
    createTriageSession,
    getActiveSessions,
    getSessionByToken,
    getSessionById,
    attendToken,
    linkPatient,
    completeConsultation,
    deleteSession,
} = require('../controllers/triageSessionController');

const router = express.Router();

// 1. Create session (Accessible by Kiosk and Staff)
router.post('/', createTriageSession);

// 2. Get active sessions queue
router.get('/active', verifyToken, getActiveSessions);

// 3. Find session by token
router.get('/by-token/:token', verifyToken, getSessionByToken);

// 4. Get session by ID (For patient waiting status check)
router.get('/:id', getSessionById);

// 5. Attend token (Doctor starts consultation)
router.post('/:id/attend', verifyToken, attendToken);

// 6. Link CIN (Existing or New Patient)
router.post('/:id/link-patient', verifyToken, linkPatient);

// 7. Complete consultation and trigger Final Discharge
router.post('/:id/complete', verifyToken, completeConsultation);

// 8. Delete / cancel session from queue
router.delete('/:id', verifyToken, deleteSession);

module.exports = router;
