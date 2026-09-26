const express = require('express');
const router = express.Router();
const ScanQueue = require('../models/ScanQueue');
const Medication = require('../models/Medication');
const verifyToken = require('../middleware/verifyToken');

const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || 'iot-internal-key-trackare';

/* ─── INTERNAL: called by pc_server.py when a medicine is detected ─── */
/* No user auth — secured by shared API key header only                  */
router.post('/internal/push', (req, res) => {
    const key = req.headers['x-internal-key'];
    if (key !== INTERNAL_API_KEY) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const {
        drug_name, strength, expiry_date, inventory_status,
        confidence, image_name, verification, source
    } = req.body;

    if (!drug_name) return res.status(400).json({ error: 'drug_name is required' });

    const name = (drug_name || 'UNKNOWN').trim().toUpperCase();
    const str  = (strength || 'N/A').trim().toUpperCase();
    const exp  = (expiry_date || 'UNKNOWN').trim();

    // Upsert: if same drug+strength+expiry already pending → just increment quantity
    ScanQueue.findOneAndUpdate(
        { drug_name: name, strength: str, expiry_date: exp, status: 'pending' },
        {
            $inc: { quantity: 1 },
            $set: {
                inventory_status: inventory_status || 'UNKNOWN',
                confidence: confidence || 'MEDIUM',
                image_name: image_name || '',
                verification: verification || {},
                source: source || 'IoT Live Camera',
                scannedAt: new Date(),
            },
            $setOnInsert: { drug_name: name, strength: str, expiry_date: exp, status: 'pending' }
        },
        { upsert: true, new: true }
    )
    .then(doc => res.json({ success: true, item: doc }))
    .catch(err => {
        console.error('[ScanQueue] Failed to push detection:', err);
        res.status(500).json({ error: 'Failed to save detection' });
    });
});

/* ─── GET /api/scan-queue ─ Fetch all pending items (auth required) ─── */
router.get('/', verifyToken, async (req, res) => {
    try {
        const items = await ScanQueue.find({ status: 'pending' }).sort({ scannedAt: -1 });
        res.json({ success: true, items });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch scan queue' });
    }
});

/* ─── POST /api/scan-queue ─ Add/push single pending item (auth required) ─── */
router.post('/', verifyToken, async (req, res) => {
    try {
        const {
            drug_name, strength, expiry_date, inventory_status,
            confidence, image_name, verification, source, quantity
        } = req.body;

        if (!drug_name) return res.status(400).json({ error: 'drug_name is required' });

        const name = (drug_name || 'UNKNOWN').trim().toUpperCase();
        const str  = (strength || 'N/A').trim().toUpperCase();
        const exp  = (expiry_date || 'UNKNOWN').trim();
        const qty  = Number(quantity) || 1;

        const doc = await ScanQueue.findOneAndUpdate(
            { drug_name: name, strength: str, expiry_date: exp, status: 'pending' },
            {
                $inc: { quantity: qty },
                $set: {
                    inventory_status: inventory_status || 'UNKNOWN',
                    confidence: confidence || 'HIGH',
                    image_name: image_name || '',
                    verification: verification || {},
                    source: source || 'Manual Upload',
                    scannedAt: new Date(),
                },
                $setOnInsert: { drug_name: name, strength: str, expiry_date: exp, status: 'pending' }
            },
            { upsert: true, new: true }
        );
        res.json({ success: true, item: doc });
    } catch (err) {
        console.error('[ScanQueue] Failed to add item:', err);
        res.status(500).json({ error: 'Failed to save scan' });
    }
});

/* ─── POST /api/scan-queue/accept ─ Accept items → save to Medication ─ */
router.post('/accept', verifyToken, async (req, res) => {
    try {
        if (!req.userAreaId) return res.status(400).json({ error: 'No area linked to account' });

        const { ids } = req.body; // array of ScanQueue _ids to accept
        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ error: 'ids array is required' });
        }

        const items = await ScanQueue.find({ _id: { $in: ids }, status: 'pending' });
        if (items.length === 0) return res.json({ success: true, count: 0 });

        // Bulk upsert into Medication collection
        const bulkOps = items.map(m => ({
            updateOne: {
                filter: {
                    areaId: req.userAreaId,
                    drug_name: m.drug_name,
                    strength: m.strength,
                    expiry_date: m.expiry_date,
                    inventory_status: m.inventory_status,
                },
                update: { $inc: { quantity: m.quantity || 1 }, $setOnInsert: { areaId: req.userAreaId, drug_name: m.drug_name, strength: m.strength, expiry_date: m.expiry_date, inventory_status: m.inventory_status } },
                upsert: true,
            }
        }));

        await Medication.bulkWrite(bulkOps);

        // Mark as accepted in queue
        await ScanQueue.updateMany({ _id: { $in: ids } }, { $set: { status: 'accepted', areaId: req.userAreaId } });

        res.json({ success: true, count: items.length });
    } catch (err) {
        console.error('[ScanQueue] Accept failed:', err);
        res.status(500).json({ error: 'Failed to accept items' });
    }
});

/* ─── POST /api/scan-queue/reject ─ Reject (delete) items from queue ── */
router.post('/reject', verifyToken, async (req, res) => {
    try {
        const { ids } = req.body;
        if (!ids || !Array.isArray(ids)) return res.status(400).json({ error: 'ids required' });
        await ScanQueue.deleteMany({ _id: { $in: ids } });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to reject items' });
    }
});

/* ─── DELETE /api/scan-queue/:id ─ Delete single item ─────────────── */
router.delete('/:id', verifyToken, async (req, res) => {
    try {
        await ScanQueue.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to delete item' });
    }
});

/* ─── PATCH /api/scan-queue/:id ─ Update quantity or fields ─────────── */
router.patch('/:id', verifyToken, async (req, res) => {
    try {
        const updated = await ScanQueue.findByIdAndUpdate(
            req.params.id,
            { $set: req.body },
            { new: true }
        );
        res.json({ success: true, item: updated });
    } catch (err) {
        res.status(500).json({ error: 'Failed to update item' });
    }
});

module.exports = router;
