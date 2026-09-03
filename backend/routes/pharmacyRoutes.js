const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const Medication = require('../models/Medication');
const router = express.Router();

/* ── GET /api/pharmacy ─ Get all medications in inventory ── */
router.get('/', async (req, res) => {
    try {
        const meds = await Medication.find().sort({ createdAt: -1 });
        res.json({ medications: meds });
    } catch (err) {
        console.error("Failed to fetch inventory:", err);
        res.status(500).json({ error: "Failed to fetch inventory" });
    }
});

/* ── POST /api/pharmacy/accept ─ Batch save accepted scans to inventory ── */
router.post('/accept', async (req, res) => {
    try {
        const { medications } = req.body;
        if (!medications || !Array.isArray(medications)) {
            return res.status(400).json({ error: "Invalid payload format" });
        }
        
        const bulkOps = medications.map(m => {
            const filter = {
                drug_name: m.drug_name || "UNKNOWN",
                strength: m.strength || "N/A",
                expiry_date: m.expiry_date || "UNKNOWN",
                inventory_status: m.inventory_status || "UNKNOWN",
            };
            return {
                updateOne: {
                    filter: filter,
                    update: { 
                        $inc: { quantity: m.quantity || 1 },
                        $setOnInsert: filter // Set these fields if it's a new insert
                    },
                    upsert: true
                }
            };
        });
        
        await Medication.bulkWrite(bulkOps);
        res.json({ success: true, count: medications.length });
    } catch (err) {
        console.error("Failed to accept medications:", err);
        res.status(500).json({ error: "Failed to save to inventory" });
    }
});

/* ── Multer: store uploaded images in backend/ml/uploads/ ── */
const uploadDir = path.join(__dirname, '..', 'ml', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname) || '.jpg';
        cb(null, `scan_${Date.now()}${ext}`);
    },
});
const upload = multer({
    storage,
    fileFilter: (_req, file, cb) => {
        if (file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new Error('Only image files are accepted'));
    },
    limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB cap
});

/* ── POST /api/pharmacy/scan ─ Accept an image, run ai_pipeline ── */
router.post('/scan', upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No image file uploaded' });

    const imagePath = req.file.path;
    const scriptPath = path.join(__dirname, '..', 'ml', 'pharmacy_scan.py');
    const pythonProcess = spawn('python', [scriptPath, imagePath], {
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
    });

    let dataString = '';
    let errorString = '';

    pythonProcess.stdout.on('data', (data) => { dataString += data.toString(); });
    pythonProcess.stderr.on('data', (data) => { errorString += data.toString(); });

    pythonProcess.on('close', (code) => {
        // Clean up the temp uploaded file
        try { fs.unlinkSync(imagePath); } catch (_) {}

        if (code !== 0) {
            console.error(`Pharmacy scan failed (code ${code}):`, errorString);
            return res.status(500).json({ error: 'Scan pipeline failed', detail: errorString });
        }
        try {
            // Find the last JSON object in the stdout string
            const jsonStart = dataString.indexOf('{');
            if (jsonStart === -1) {
                console.error('No JSON object found in pharmacy scan output:', dataString);
                return res.status(500).json({ error: 'No JSON output from scan model', raw: dataString });
            }
            const jsonStr = dataString.substring(jsonStart);
            const result = JSON.parse(jsonStr);
            
            if (result.error) return res.status(500).json({ error: result.error });
            
            console.log("\n====== [Pharmacy AI Scan Completed] ======");
            console.log(JSON.stringify(result, null, 2));
            console.log("==========================================");

            // NOTE: We no longer auto-save here. The frontend will call /accept.
            res.json(result);
        } catch (e) {
            console.error('Failed to parse pharmacy scan output:', dataString);
            res.status(500).json({ error: 'Invalid output from scan model', raw: dataString });
        }
    });
});

module.exports = router;
