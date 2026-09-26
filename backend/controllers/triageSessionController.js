const TriageSession = require('../models/triageSessionModel');
const Encounter = require('../models/encounterModel');
const DiseaseClass = require('../models/diseaseClassModel');
const Patient = require('../models/patientModel');
const Area = require('../models/areaModel');
const User = require('../models/userModel');
const { getNextDailyToken, autoAssignWaitingPatients } = require('../services/queueService');
const { broadcastEvent } = require('../utils/broadcaster');

/**
 * 1. POST /api/triage-sessions
 * Creates a new TriageSession + Encounter (active) at Kiosk arrival.
 */
const createTriageSession = async (req, res) => {
    try {
        const {
            areaId: rawAreaId,
            symptoms = [],
            vitals = {},
            prediction = {}, // { maladie, label, confidence }
            priority = 'GREEN',
        } = req.body;

        let normalizedPriority = 'GREEN';
        if (typeof priority === 'string' && priority.trim()) {
            normalizedPriority = priority.trim().toUpperCase();
        } else if (priority && typeof priority === 'object') {
            const raw = (priority.level || priority.label || '').toString().toUpperCase();
            if (raw.includes('HIGH') || raw.includes('CRITICAL') || raw.includes('RED')) normalizedPriority = 'RED';
            else if (raw.includes('MODERATE') || raw.includes('YELLOW') || raw.includes('ORANGE')) normalizedPriority = 'YELLOW';
            else if (raw.includes('LOW') || raw.includes('GREEN')) normalizedPriority = 'GREEN';
            else normalizedPriority = 'GREEN';
        }

        let areaId = rawAreaId?._id || rawAreaId || req.user?.area?._id || req.user?.area || req.userAreaId;
        if (!areaId) {
            let firstArea = await Area.findOne({ isActive: true });
            if (!firstArea) {
                firstArea = await Area.create({ name: 'Main Clinic Area', isActive: true });
            }
            areaId = firstArea._id;
        }

        // 1. Generate atomic daily token (001, 002, ...)
        const { tokenNumber } = await getNextDailyToken(areaId);
        const encounterNumber = `ENC-${tokenNumber}`;

        const maladieKey = (prediction.maladie || 'autre').toLowerCase();

        // 2. Check room capacity across ALL classes/rooms configured for this sickness
        const maladieRegex = new RegExp(`^${maladieKey.replace(/tuber.*/i, 'tuber.*').replace(/aid.*|cid.*/i, '(aids|cida)')}$`, 'i');

        const matchingRooms = await DiseaseClass.find({
            areaId,
            maladie: maladieRegex,
            isActive: true,
        }).sort({ placeCode: 1 });

        let assignedRoom = null;
        for (const room of matchingRooms) {
            if ((room.currentPatients || 0) < (room.maxPatients || 1)) {
                assignedRoom = room;
                break;
            }
        }

        let sessionStatus = 'assigned';
        const roomHistory = [];

        if (assignedRoom) {
            // Room available: increment occupancy
            assignedRoom.currentPatients = (assignedRoom.currentPatients || 0) + 1;
            await assignedRoom.save();

            roomHistory.push({
                roomId: assignedRoom._id,
                roomName: `Room ${assignedRoom.placeCode}`,
                placeCode: assignedRoom.placeCode,
                enteredAt: new Date(),
            });
        } else {
            // All rooms full: enter waiting queue
            sessionStatus = 'waiting_room';
            roomHistory.push({
                roomName: 'Waiting Buffer',
                enteredAt: new Date(),
            });

            // Broadcast real-time capacity overflow alert
            await broadcastEvent('CAPACITY_OVERFLOW_ALERT', {
                tokenNumber,
                maladie: maladieKey,
                label: prediction.label || maladieKey,
                message: `All rooms full for ${prediction.label || maladieKey}. Token #${tokenNumber} added to waiting queue.`,
            });
        }

        // 3. Create Encounter (starts as 'active', patientId is null initially)
        const encounter = await Encounter.create({
            encounterNumber,
            tokenNumber,
            patientId: null,
            areaId,
            status: 'active',
            startedAt: new Date(),
            roomHistory,
            triageData: {
                symptoms,
                vitals,
                aiPrediction: prediction,
                priority: normalizedPriority,
                suggestedClass: assignedRoom ? {
                    name: `Room ${assignedRoom.placeCode}`,
                    placeCode: assignedRoom.placeCode,
                    diseaseClassId: assignedRoom._id,
                } : null,
            },
        });

        // 4. Create TriageSession
        const session = await TriageSession.create({
            tokenNumber,
            encounterId: encounter._id,
            areaId,
            symptoms,
            vitals,
            prediction,
            priority: normalizedPriority,
            assignedRoom: assignedRoom ? assignedRoom._id : null,
            suggestedClass: assignedRoom ? {
                name: `Room ${assignedRoom.placeCode}`,
                placeCode: assignedRoom.placeCode,
                diseaseClassId: assignedRoom._id,
            } : null,
            status: sessionStatus,
            createdBy: req.user ? req.user._id : null,
        });

        // Link encounter to session
        encounter.triageSessionId = session._id;
        await encounter.save();

        // Broadcast token created
        await broadcastEvent('TOKEN_CREATED', {
            tokenNumber,
            sessionId: session._id,
            encounterId: encounter._id,
            status: sessionStatus,
            maladie: maladieKey,
            room: assignedRoom ? `Room ${assignedRoom.placeCode}` : 'Waiting Buffer',
        });

        res.status(201).json({
            success: true,
            tokenNumber,
            encounterNumber,
            sessionId: session._id,
            encounterId: encounter._id,
            status: sessionStatus,
            assignedRoom: assignedRoom ? {
                _id: assignedRoom._id,
                placeCode: assignedRoom.placeCode,
                name: `Room ${assignedRoom.placeCode}`,
            } : null,
            prediction,
            priority: normalizedPriority,
        });
    } catch (err) {
        console.error('[createTriageSession Error]', err);
        res.status(500).json({ error: 'Failed to create triage session' });
    }
};

/**
 * 2. GET /api/triage-sessions/active
 * Retrieves all active sessions (waiting_room, assigned, in_consultation)
 */
const getActiveSessions = async (req, res) => {
    try {
        const { areaId } = req.query;
        const query = {
            status: { $in: ['waiting_room', 'assigned', 'in_consultation', 'completed'] },
        };
        if (areaId) query.areaId = areaId;

        const sessions = await TriageSession.find(query)
            .populate({
                path: 'assignedRoom',
                populate: { path: 'doctorId', select: 'name email role profilePicture' }
            })
            .populate({
                path: 'encounterId',
                populate: { path: 'patientId' }
            })
            .sort({ createdAt: -1 });

        res.json({ success: true, sessions });
    } catch (err) {
        console.error('[getActiveSessions Error]', err);
        res.status(500).json({ error: 'Failed to load active sessions' });
    }
};

/**
 * 3. GET /api/triage-sessions/by-token/:token
 * Look up session + encounter by token number
 */
const getSessionByToken = async (req, res) => {
    try {
        const { token } = req.params;
        const { areaId } = req.query;

        const query = { tokenNumber: token.padStart(3, '0') };
        if (areaId) query.areaId = areaId;

        const session = await TriageSession.findOne(query)
            .sort({ createdAt: -1 })
            .populate({
                path: 'assignedRoom',
                populate: { path: 'doctorId', select: 'name email role profilePicture' }
            })
            .populate({
                path: 'encounterId',
                populate: { path: 'patientId' },
            });

        if (!session) {
            return res.status(404).json({ error: `No active session found for Token #${token}` });
        }

        res.json({ success: true, session });
    } catch (err) {
        console.error('[getSessionByToken Error]', err);
        res.status(500).json({ error: 'Failed to find session by token' });
    }
};

/**
 * Get single session by ID (for patient waiting status polling)
 */
const getSessionById = async (req, res) => {
    try {
        const { id } = req.params;
        const session = await TriageSession.findById(id).populate({
            path: 'assignedRoom',
            populate: { path: 'doctorId', select: 'name email role profilePicture' }
        });
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }
        res.json({ success: true, session });
    } catch (err) {
        console.error('[getSessionById Error]', err);
        res.status(500).json({ error: 'Failed to fetch session' });
    }
};

/**
 * 4. POST /api/triage-sessions/:id/attend
 * Doctor clicks "Attend" on token -> status becomes 'in_consultation'
 */
const attendToken = async (req, res) => {
    try {
        const { id } = req.params;
        const session = await TriageSession.findById(id);
        if (!session) return res.status(404).json({ error: 'Session not found' });

        session.status = 'in_consultation';
        await session.save();

        if (session.encounterId) {
            await Encounter.findByIdAndUpdate(session.encounterId, {
                'consultation.attendedBy': req.user ? req.user._id : null,
                'consultation.attendedAt': new Date(),
            });
        }

        await broadcastEvent('TOKEN_ATTENDED', {
            tokenNumber: session.tokenNumber,
            sessionId: session._id,
        });

        res.json({ success: true, session });
    } catch (err) {
        console.error('[attendToken Error]', err);
        res.status(500).json({ error: 'Failed to mark session in consultation' });
    }
};

/**
 * 5. POST /api/triage-sessions/:id/link-patient
 * Identifies patient by CIN:
 *  - If Existing Patient: links to current encounter, returns previous encounter history.
 *  - If New Patient: creates Patient record, links to current encounter.
 */
const linkPatient = async (req, res) => {
    try {
        const { id } = req.params; // triageSessionId
        const { cin, name, dateOfBirth, gender, phone, bloodType, address } = req.body;

        if (!cin) {
            return res.status(400).json({ error: 'CIN is required' });
        }

        const session = await TriageSession.findById(id);
        if (!session) return res.status(404).json({ error: 'Session not found' });

        const encounter = await Encounter.findById(session.encounterId);
        if (!encounter) return res.status(404).json({ error: 'Associated encounter not found' });

        const normalizedCin = cin.trim().toUpperCase();

        // 1. Search existing patient by CIN
        let patient = await Patient.findOne({
            cin: normalizedCin,
            areaId: session.areaId,
            isActive: true,
        });

        let isExisting = true;

        if (!patient) {
            // 2. Create new patient
            isExisting = false;
            let creatorId = req.user ? req.user._id : session.createdBy;
            if (!creatorId) {
                const fallbackUser = await User.findOne({ areaId: session.areaId }) || await User.findOne();
                creatorId = fallbackUser ? fallbackUser._id : null;
            }

            patient = await Patient.create({
                cin: normalizedCin,
                name: name || `Patient ${normalizedCin}`,
                dateOfBirth: dateOfBirth || null,
                gender: gender || 'other',
                phone: phone || '',
                bloodType: bloodType || '',
                address: address || '',
                areaId: session.areaId,
                createdBy: creatorId,
                isActive: true,
            });
        } else {
            // Update any missing demographic details if provided
            if (name && patient.name !== name) patient.name = name;
            if (phone) patient.phone = phone;
            if (bloodType) patient.bloodType = bloodType;
            if (address) patient.address = address;
            await patient.save();
        }

        // 3. Link patient to current Encounter
        encounter.patientId = patient._id;
        await encounter.save();

        // 4. Load past encounters for this patient (excluding current one)
        const pastEncounters = await Encounter.find({
            patientId: patient._id,
            _id: { $ne: encounter._id },
        }).sort({ startedAt: -1 });

        res.json({
            success: true,
            isExisting,
            patient,
            pastEncounters,
            currentEncounter: encounter,
        });
    } catch (err) {
        console.error('[linkPatient Error]', err);
        res.status(500).json({ error: 'Failed to link patient' });
    }
};

/**
 * 6. POST /api/triage-sessions/:id/complete
 * Doctor clicks "Finish Consultation" (FINAL DISCHARGE TRIGGER):
 *  - Encounter: status -> 'discharged', endedAt -> now
 *  - TriageSession: status -> 'completed'
 *  - Patient remains active (isActive: true)
 *  - Room capacity is freed (currentPatients - 1)
 *  - Waiting patients are automatically promoted to the freed room!
 */
const completeConsultation = async (req, res) => {
    try {
        const { id } = req.params; // triageSessionId
        const {
            clinicalNotes = '',
            confirmedDiagnosis = '',
            prescriptions = [], // [ { drug_name, strength, quantity, instructions } ]
        } = req.body;

        const session = await TriageSession.findById(id);
        if (!session) return res.status(404).json({ error: 'Session not found' });

        const encounter = await Encounter.findById(session.encounterId);
        if (!encounter) return res.status(404).json({ error: 'Associated encounter not found' });

        const wasAlreadyCompleted = session.status === 'completed' || encounter.status === 'discharged';

        // 1. Update Consultation & Discharge Encounter
        encounter.status = 'discharged';
        if (!encounter.endedAt) {
            encounter.endedAt = new Date();
        }
        encounter.consultation = {
            attendedBy: req.user ? req.user._id : encounter.consultation?.attendedBy || null,
            attendedAt: encounter.consultation?.attendedAt || new Date(),
            clinicalNotes,
            confirmedDiagnosis: confirmedDiagnosis || session.prediction?.label || '',
            prescriptions: prescriptions.map(p => ({
                drug_name: p.drug_name,
                strength: p.strength || 'N/A',
                quantity: p.quantity || 1,
                instructions: p.instructions || '',
            })),
        };

        // Close last room history entry
        if (encounter.roomHistory && encounter.roomHistory.length > 0) {
            const lastEntry = encounter.roomHistory[encounter.roomHistory.length - 1];
            if (!lastEntry.leftAt) {
                lastEntry.leftAt = new Date();
            }
        }
        await encounter.save();

        // 2. Add or update consultation in Patient permanent history
        if (encounter.patientId) {
            const patient = await Patient.findById(encounter.patientId);
            if (patient) {
                const prescriptionSummary = prescriptions.length
                    ? ` | Prescribed: ${prescriptions.map(p => `${p.drug_name} (${p.quantity})`).join(', ')}`
                    : '';
                const updatedNotes = clinicalNotes
                    ? `${clinicalNotes}${prescriptionSummary}`
                    : `Diagnosis: ${confirmedDiagnosis || session.prediction?.label || 'General'}${prescriptionSummary}`;

                if (wasAlreadyCompleted && patient.history && patient.history.length > 0) {
                    // Update latest history record instead of creating duplicate
                    const latest = patient.history[patient.history.length - 1];
                    latest.title = `Consultation — ${confirmedDiagnosis || session.prediction?.label || 'General'}`;
                    latest.notes = updatedNotes;
                } else {
                    patient.history.push({
                        date: new Date(),
                        type: 'visit',
                        title: `Consultation — ${confirmedDiagnosis || session.prediction?.label || 'General'}`,
                        notes: updatedNotes,
                        triage: {
                            vitals: session.vitals || {},
                            symptoms: session.symptoms || [],
                            predictions: session.prediction ? [session.prediction] : [],
                            priority: session.priority || 'GREEN',
                            suggestedClass: session.suggestedClass || undefined,
                        },
                        createdBy: req.user ? req.user._id : null,
                    });
                }
                await patient.save();
            }
        }

        // 3. Mark TriageSession completed
        session.status = 'completed';
        await session.save();

        // 4. Free Room Capacity ONLY on first discharge (not when editing)
        if (!wasAlreadyCompleted && session.assignedRoom) {
            const room = await DiseaseClass.findById(session.assignedRoom);
            if (room && (room.currentPatients || 0) > 0) {
                room.currentPatients = Math.max(0, room.currentPatients - 1);
                await room.save();

                // Auto-assign any waiting patient to this freed room
                await autoAssignWaitingPatients(session.areaId, room.maladie);
            }
        }

        // Broadcast final discharge event
        await broadcastEvent('CONSULTATION_COMPLETED', {
            tokenNumber: session.tokenNumber,
            sessionId: session._id,
            encounterId: encounter._id,
            dischargedAt: encounter.endedAt,
        });

        res.json({
            success: true,
            message: 'Consultation finished and patient discharged successfully',
            encounter,
            session,
        });
    } catch (err) {
        console.error('[completeConsultation Error]', err);
        res.status(500).json({ error: 'Failed to complete consultation and discharge' });
    }
};

/**
 * 7. DELETE /api/triage-sessions/:id
 * Cancels and deletes a triage session from the queue.
 */
const deleteSession = async (req, res) => {
    try {
        const { id } = req.params;
        const session = await TriageSession.findById(id);
        if (!session) {
            return res.status(404).json({ error: 'Triage session not found' });
        }

        // Free room capacity if active and not already completed
        if (session.status !== 'completed' && session.assignedRoom) {
            const room = await DiseaseClass.findById(session.assignedRoom);
            if (room && (room.currentPatients || 0) > 0) {
                room.currentPatients = Math.max(0, room.currentPatients - 1);
                await room.save();

                // Auto-promote any waiting patients
                await autoAssignWaitingPatients(session.areaId, room.maladie);
            }
        }

        // Clean up linked encounter if it exists
        if (session.encounterId) {
            await Encounter.findByIdAndDelete(session.encounterId);
        }

        await TriageSession.findByIdAndDelete(id);

        // Broadcast deletion event for live UI refresh
        await broadcastEvent('CONSULTATION_COMPLETED', {
            deletedSessionId: id,
            tokenNumber: session.tokenNumber,
        });

        res.json({
            success: true,
            message: `Token #${session.tokenNumber} has been deleted from the room queue.`,
        });
    } catch (err) {
        console.error('[deleteSession Error]', err);
        res.status(500).json({ error: 'Failed to delete triage session' });
    }
};

module.exports = {
    createTriageSession,
    getActiveSessions,
    getSessionByToken,
    getSessionById,
    attendToken,
    linkPatient,
    completeConsultation,
    deleteSession,
};
