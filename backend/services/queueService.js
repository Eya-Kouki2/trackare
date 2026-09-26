const DailyCounter = require('../models/dailyCounterModel');
const TriageSession = require('../models/triageSessionModel');
const Encounter = require('../models/encounterModel');
const DiseaseClass = require('../models/diseaseClassModel');
const { broadcastEvent } = require('../utils/broadcaster');

/**
 * Generates an atomic 3-digit daily token (001, 002, ...)
 * Resets automatically at 00:00 every day based on dateString.
 */
const getNextDailyToken = async (areaId) => {
    const today = new Date();
    const dateString = today.toISOString().split('T')[0]; // YYYY-MM-DD

    const normalizedAreaId = areaId ? areaId.toString() : 'default_area';

    const counter = await DailyCounter.findOneAndUpdate(
        { dateString, areaId: normalizedAreaId },
        { $inc: { sequence: 1 } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const tokenNumber = String(counter.sequence).padStart(3, '0');
    return { tokenNumber, dateString };
};

/**
 * Automatically checks and promotes waiting patients to newly freed or newly created rooms.
 */
const autoAssignWaitingPatients = async (areaId, maladie = null) => {
    try {
        const roomQuery = { isActive: true };
        if (areaId) roomQuery.areaId = areaId;
        if (maladie) {
            roomQuery.maladie = maladie.toLowerCase();
        }

        let availableRooms = await DiseaseClass.find(roomQuery).sort({ placeCode: 1 });
        let roomsWithCapacity = availableRooms.filter(r => (r.currentPatients || 0) < (r.maxPatients || 1));

        if (roomsWithCapacity.length === 0) {
            return [];
        }

        const sessionQuery = {
            status: 'waiting_room',
        };
        if (maladie) {
            sessionQuery['prediction.maladie'] = new RegExp(`^${maladie}$`, 'i');
        }

        let waitingSessions = await TriageSession.find({ ...sessionQuery, ...(areaId ? { areaId } : {}) })
            .sort({ createdAt: 1 })
            .limit(roomsWithCapacity.length);

        if (waitingSessions.length === 0) {
            waitingSessions = await TriageSession.find(sessionQuery)
                .sort({ createdAt: 1 })
                .limit(roomsWithCapacity.length);
        }

        const assignedResults = [];

        for (const session of waitingSessions) {
            // Find first room with remaining capacity
            const targetRoom = roomsWithCapacity.find(r => (r.currentPatients || 0) < (r.maxPatients || 1));
            if (!targetRoom) break;

            // Increment room
            targetRoom.currentPatients = (targetRoom.currentPatients || 0) + 1;
            await targetRoom.save();

            // Update session
            session.assignedRoom = targetRoom._id;
            session.suggestedClass = {
                name: `Room ${targetRoom.placeCode}`,
                placeCode: targetRoom.placeCode,
                diseaseClassId: targetRoom._id,
            };
            session.status = 'assigned';
            await session.save();

            // Update encounter room history
            const encounter = await Encounter.findById(session.encounterId);
            if (encounter) {
                // Close previous room history entry if any
                if (encounter.roomHistory && encounter.roomHistory.length > 0) {
                    const lastEntry = encounter.roomHistory[encounter.roomHistory.length - 1];
                    if (!lastEntry.leftAt) {
                        lastEntry.leftAt = new Date();
                    }
                }
                encounter.roomHistory.push({
                    roomId: targetRoom._id,
                    roomName: `Room ${targetRoom.placeCode}`,
                    placeCode: targetRoom.placeCode,
                    enteredAt: new Date(),
                });
                await encounter.save();
            }

            assignedResults.push({
                tokenNumber: session.tokenNumber,
                sessionId: session._id,
                encounterId: session.encounterId,
                room: {
                    id: targetRoom._id,
                    placeCode: targetRoom.placeCode,
                    name: `Room ${targetRoom.placeCode}`,
                },
            });

            // Broadcast real-time promotion event
            await broadcastEvent('WAITING_PATIENT_ASSIGNED', {
                tokenNumber: session.tokenNumber,
                sessionId: session._id,
                roomName: `Room ${targetRoom.placeCode}`,
                placeCode: targetRoom.placeCode,
                maladie: session.prediction?.maladie,
            });
        }

        return assignedResults;
    } catch (err) {
        console.error('[queueService.autoAssignWaitingPatients Error]', err);
        return [];
    }
};

module.exports = {
    getNextDailyToken,
    autoAssignWaitingPatients,
};
