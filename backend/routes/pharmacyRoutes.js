const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const Medication = require('../models/Medication');
const Encounter = require('../models/encounterModel');
const Patient = require('../models/patientModel');
const verifyToken = require('../middleware/verifyToken');
const router = express.Router();

// Enforce authentication & obtain req.userAreaId on all pharmacy routes
router.use(verifyToken);
router.use((req, res, next) => {
    if (!req.userAreaId) {
        return res.status(400).json({ success: false, message: 'No area linked to this account' });
    }
    next();
});

/* ── Expiry Date Parser for FEFO Sorting ─────────────────── */
const parseExpiryTimestamp = (expiryStr) => {
    if (!expiryStr || typeof expiryStr !== 'string') return Infinity;
    const clean = expiryStr.trim().toUpperCase();
    if (clean === 'UNKNOWN' || clean === 'NO DATE' || clean === 'INVALID') return Infinity;

    // Try standard ISO / full date parsing first
    const directDate = new Date(clean);
    if (!isNaN(directDate.getTime())) {
        return directDate.getTime();
    }

    // Try MM/YY or MM/YYYY format
    const slashMatch = clean.match(/^(\d{1,2})\/(\d{2,4})$/);
    if (slashMatch) {
        const month = parseInt(slashMatch[1], 10) - 1;
        let year = parseInt(slashMatch[2], 10);
        if (year < 100) year += 2000;
        return new Date(year, month + 1, 0).getTime(); // End of month
    }

    // Try Mon-YYYY or Month YYYY (e.g. SEP 2026, OCT 26)
    const monthNames = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    for (let i = 0; i < monthNames.length; i++) {
        if (clean.includes(monthNames[i])) {
            const yrMatch = clean.match(/(\d{2,4})/);
            if (yrMatch) {
                let yr = parseInt(yrMatch[1], 10);
                if (yr < 100) yr += 2000;
                return new Date(yr, i + 1, 0).getTime();
            }
        }
    }

    return Infinity;
};

/* ── GET /api/pharmacy/dispensing-queue ─ Get all encounters with prescriptions & live stock status ── */
router.get('/dispensing-queue', async (req, res) => {
    try {
        const { status, search } = req.query;

        // Fetch all encounters that have at least 1 prescription item within this hospital area
        const encounters = await Encounter.find({
            areaId: req.userAreaId,
            'consultation.prescriptions.0': { $exists: true }
        })
            .populate('patientId', 'cin name gender phone bloodType dateOfBirth address')
            .populate('triageSessionId', 'tokenNumber prediction priority status')
            .populate('consultation.attendedBy', 'name email role')
            .sort({ startedAt: -1 });

        // Fetch current live medications for stock calculation in this hospital area
        const allMeds = await Medication.find({ areaId: req.userAreaId });

        // Build a normalized stock lookup map by drug_name
        const stockMap = {};
        allMeds.forEach(m => {
            const key = (m.drug_name || '').trim().toUpperCase();
            if (!stockMap[key]) {
                stockMap[key] = {
                    totalUnits: 0,
                    batches: []
                };
            }
            stockMap[key].totalUnits += (m.quantity || 0);
            stockMap[key].batches.push({
                id: m._id,
                strength: m.strength,
                quantity: m.quantity,
                expiry_date: m.expiry_date,
                inventory_status: m.inventory_status
            });
        });

        // Enrich encounter prescriptions with live stock and partial fulfillment data
        const enriched = encounters.map(enc => {
            const encObj = enc.toObject();
            const prescriptions = (encObj.consultation?.prescriptions || []).map(p => {
                const drugKey = (p.drug_name || '').trim().toUpperCase();
                const stockInfo = stockMap[drugKey] || { totalUnits: 0, batches: [] };
                
                const totalQty = Math.max(1, p.quantity || 1);
                const dispensedQty = p.dispensedQuantity !== undefined ? p.dispensedQuantity : (p.dispensed ? totalQty : 0);
                const remainingQty = Math.max(0, totalQty - dispensedQty);
                const isFullyDispensed = remainingQty === 0;

                return {
                    ...p,
                    quantity: totalQty,
                    dispensedQuantity: dispensedQty,
                    remainingQuantity: remainingQty,
                    dispensed: isFullyDispensed,
                    availableStock: stockInfo.totalUnits,
                    isSufficient: stockInfo.totalUnits >= remainingQty,
                    batches: stockInfo.batches
                };
            });

            const allDispensed = prescriptions.length > 0 && prescriptions.every(p => p.dispensed);
            const hasPending = prescriptions.some(p => !p.dispensed);

            return {
                ...encObj,
                consultation: {
                    ...encObj.consultation,
                    prescriptions
                },
                dispenseSummary: {
                    allDispensed,
                    hasPending,
                    totalItems: prescriptions.length,
                    dispensedItems: prescriptions.filter(p => p.dispensed).length,
                    totalPrescribedQty: prescriptions.reduce((sum, p) => sum + p.quantity, 0),
                    totalDispensedQty: prescriptions.reduce((sum, p) => sum + p.dispensedQuantity, 0),
                    totalRemainingQty: prescriptions.reduce((sum, p) => sum + p.remainingQuantity, 0)
                }
            };
        });

        // Compute KPIs
        let pendingCount = 0;
        let dispensedCount = 0;
        let lowStockCount = 0;
        const uniquePatientIds = new Set();

        enriched.forEach(e => {
            if (e.patientId?._id) uniquePatientIds.add(String(e.patientId._id));
            if (e.dispenseSummary.hasPending) pendingCount++;
            if (e.dispenseSummary.allDispensed) dispensedCount++;

            (e.consultation?.prescriptions || []).forEach(p => {
                if (!p.dispensed && !p.isSufficient) {
                    lowStockCount++;
                }
            });
        });

        // Filter based on query params if provided
        let filtered = enriched;
        if (status === 'pending') {
            filtered = filtered.filter(e => e.dispenseSummary.hasPending);
        } else if (status === 'dispensed') {
            filtered = filtered.filter(e => e.dispenseSummary.allDispensed);
        }

        if (search && search.trim()) {
            const q = search.trim().toLowerCase();
            filtered = filtered.filter(e => {
                const token = (e.tokenNumber || '').toLowerCase();
                const cin = (e.patientId?.cin || '').toLowerCase();
                const name = (e.patientId?.name || '').toLowerCase();
                const drugs = (e.consultation?.prescriptions || []).map(p => (p.drug_name || '').toLowerCase()).join(' ');
                return token.includes(q) || cin.includes(q) || name.includes(q) || drugs.includes(q);
            });
        }

        res.json({
            success: true,
            encounters: filtered,
            kpis: {
                pendingCount,
                dispensedCount,
                totalEncounters: enriched.length,
                totalPatients: uniquePatientIds.size,
                lowStockCount
            }
        });
    } catch (err) {
        console.error("Failed to fetch dispensing queue:", err);
        res.status(500).json({ error: "Failed to fetch dispensing queue" });
    }
});

/* ── POST /api/pharmacy/dispense ─ Dispense prescriptions (supports full or partial quantity & FEFO stock deduction) ── */
router.post('/dispense', async (req, res) => {
    try {
        const { encounterId, prescriptionItemId, quantityToDispense, dispenseAll = false } = req.body;

        if (!encounterId) {
            return res.status(400).json({ error: "encounterId is required" });
        }

        const encounter = await Encounter.findOne({ _id: encounterId, areaId: req.userAreaId }).populate('patientId', 'cin name');
        if (!encounter) {
            return res.status(404).json({ error: "Encounter not found" });
        }

        if (!encounter.consultation?.prescriptions || encounter.consultation.prescriptions.length === 0) {
            return res.status(400).json({ error: "No prescriptions found in encounter" });
        }

        const dispensedItemsReport = [];

        for (let item of encounter.consultation.prescriptions) {
            const isTarget = dispenseAll || (prescriptionItemId && String(item._id) === String(prescriptionItemId));
            
            const currentTotal = Math.max(1, item.quantity || 1);
            const currentDispensed = item.dispensedQuantity !== undefined ? item.dispensedQuantity : (item.dispensed ? currentTotal : 0);
            const currentRemaining = Math.max(0, currentTotal - currentDispensed);

            if (isTarget && currentRemaining > 0) {
                const drugNameTrimmed = (item.drug_name || '').trim();
                
                // Determine how many units to dispense now
                let qtyToGive = currentRemaining;
                if (quantityToDispense !== undefined && !dispenseAll) {
                    qtyToGive = Math.min(currentRemaining, Math.max(1, parseInt(quantityToDispense, 10) || 1));
                }

                // Find matching medications in stock for this area
                const matchingMeds = await Medication.find({
                    areaId: req.userAreaId,
                    drug_name: { $regex: new RegExp(`^${drugNameTrimmed}$`, 'i') },
                    quantity: { $gt: 0 }
                });

                // Sort batches by FEFO (earliest expiry first)
                matchingMeds.sort((a, b) => {
                    const timeA = parseExpiryTimestamp(a.expiry_date);
                    const timeB = parseExpiryTimestamp(b.expiry_date);
                    return timeA - timeB;
                });

                let remainingToDeduct = qtyToGive;
                let actuallyDeducted = 0;
                let deductedFromBatches = [];

                for (let med of matchingMeds) {
                    if (remainingToDeduct <= 0) break;

                    const avail = med.quantity || 0;
                    if (avail > remainingToDeduct) {
                        med.quantity -= remainingToDeduct;
                        actuallyDeducted += remainingToDeduct;
                        deductedFromBatches.push({ batchId: med._id, deducted: remainingToDeduct, expiry: med.expiry_date });
                        await med.save();
                        remainingToDeduct = 0;
                    } else {
                        // Takes entire batch
                        deductedFromBatches.push({ batchId: med._id, deducted: avail, expiry: med.expiry_date });
                        actuallyDeducted += avail;
                        remainingToDeduct -= avail;
                        await Medication.findOneAndDelete({ _id: med._id, areaId: req.userAreaId });
                    }
                }

                // Update item's dispensed count
                const newDispensedTotal = currentDispensed + actuallyDeducted;
                item.dispensedQuantity = newDispensedTotal;
                item.dispensed = newDispensedTotal >= currentTotal;
                if (item.dispensed || actuallyDeducted > 0) {
                    item.dispensedAt = new Date();
                }

                dispensedItemsReport.push({
                    prescriptionId: item._id,
                    drug_name: item.drug_name,
                    strength: item.strength,
                    requestedToDispense: qtyToGive,
                    actuallyDeducted,
                    totalDispensed: newDispensedTotal,
                    prescribedQuantity: currentTotal,
                    remainingQuantity: Math.max(0, currentTotal - newDispensedTotal),
                    isFullyDispensed: newDispensedTotal >= currentTotal,
                    deductedBatches: deductedFromBatches
                });
            }
        }

        await encounter.save();

        res.json({
            success: true,
            message: `Successfully processed medication dispensation for ${encounter.patientId?.name || 'Patient'} (Token #${encounter.tokenNumber})`,
            dispensedItems: dispensedItemsReport,
            encounter
        });
    } catch (err) {
        console.error("Failed to dispense prescription:", err);
        res.status(500).json({ error: "Failed to dispense prescription" });
    }
});

/* ── PUT /api/pharmacy/prescription/:encounterId/:prescriptionId ─ Edit a prescribed medication row ── */
router.put('/prescription/:encounterId/:prescriptionId', async (req, res) => {
    try {
        const { encounterId, prescriptionId } = req.params;
        const { drug_name, strength, quantity, instructions } = req.body;

        const encounter = await Encounter.findOne({ _id: encounterId, areaId: req.userAreaId });
        if (!encounter) return res.status(404).json({ error: "Encounter not found" });

        const item = encounter.consultation?.prescriptions?.id(prescriptionId);
        if (!item) return res.status(404).json({ error: "Prescription item not found" });

        if (drug_name !== undefined) item.drug_name = String(drug_name).trim().toUpperCase();
        if (strength !== undefined) item.strength = String(strength).trim().toUpperCase();
        if (quantity !== undefined) {
            item.quantity = Math.max(1, parseInt(quantity, 10) || 1);
            if ((item.dispensedQuantity || 0) >= item.quantity) {
                item.dispensed = true;
            } else {
                item.dispensed = false;
            }
        }
        if (instructions !== undefined) item.instructions = String(instructions).trim();

        await encounter.save();
        res.json({ success: true, item, encounter });
    } catch (err) {
        console.error("Failed to update prescription item:", err);
        res.status(500).json({ error: "Failed to update prescription" });
    }
});

/* ── DELETE /api/pharmacy/prescription/:encounterId/:prescriptionId ─ Delete a prescribed medication ── */
router.delete('/prescription/:encounterId/:prescriptionId', async (req, res) => {
    try {
        const { encounterId, prescriptionId } = req.params;

        const encounter = await Encounter.findOne({ _id: encounterId, areaId: req.userAreaId });
        if (!encounter) return res.status(404).json({ error: "Encounter not found" });

        encounter.consultation.prescriptions = encounter.consultation.prescriptions.filter(
            p => String(p._id) !== String(prescriptionId)
        );

        await encounter.save();
        res.json({ success: true, message: "Prescription item removed", encounter });
    } catch (err) {
        console.error("Failed to delete prescription item:", err);
        res.status(500).json({ error: "Failed to delete prescription item" });
    }
});

/* ── POST /api/pharmacy/prescription/:encounterId ─ Add a new prescribed medication to patient encounter ── */
router.post('/prescription/:encounterId', async (req, res) => {
    try {
        const { encounterId } = req.params;
        const { drug_name, strength, quantity, instructions } = req.body;

        if (!drug_name) return res.status(400).json({ error: "Drug name is required" });

        const encounter = await Encounter.findOne({ _id: encounterId, areaId: req.userAreaId });
        if (!encounter) return res.status(404).json({ error: "Encounter not found" });

        if (!encounter.consultation) encounter.consultation = {};
        if (!encounter.consultation.prescriptions) encounter.consultation.prescriptions = [];

        encounter.consultation.prescriptions.push({
            drug_name: String(drug_name).trim().toUpperCase(),
            strength: String(strength || "N/A").trim().toUpperCase(),
            quantity: Math.max(1, parseInt(quantity, 10) || 1),
            dispensedQuantity: 0,
            instructions: String(instructions || "").trim(),
            dispensed: false
        });

        await encounter.save();
        res.json({ success: true, message: "New prescription added to encounter", encounter });
    } catch (err) {
        console.error("Failed to add prescription item:", err);
        res.status(500).json({ error: "Failed to add prescription item" });
    }
});

/* ── GET /api/pharmacy ─ Get all medications in inventory for current hospital area ── */
router.get('/', async (req, res) => {
    try {
        const meds = await Medication.find({ areaId: req.userAreaId }).sort({ createdAt: -1 });
        res.json({ medications: meds });
    } catch (err) {
        console.error("Failed to fetch inventory:", err);
        res.status(500).json({ error: "Failed to fetch inventory" });
    }
});

/* ── POST /api/pharmacy/accept ─ Batch save accepted scans to inventory scoped by areaId ── */
router.post('/accept', async (req, res) => {
    try {
        const { medications } = req.body;
        if (!medications || !Array.isArray(medications)) {
            return res.status(400).json({ error: "Invalid payload format" });
        }

        const bulkOps = medications.map(m => {
            const filter = {
                areaId: req.userAreaId,
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

/* ── PUT /api/pharmacy/:id ─ Update medication details (auto-merge if duplicate exists in this area) ── */
router.put('/:id', async (req, res) => {
    try {
        const currentMed = await Medication.findOne({ _id: req.params.id, areaId: req.userAreaId });
        if (!currentMed) {
            return res.status(404).json({ error: "Medication not found" });
        }

        const { drug_name, quantity, strength, expiry_date, inventory_status } = req.body;
        
        const finalDrugName = drug_name !== undefined ? String(drug_name).trim().toUpperCase() : currentMed.drug_name;
        const finalStrength = strength !== undefined ? String(strength).trim().toUpperCase() : currentMed.strength;
        const finalExpiryDate = expiry_date !== undefined ? String(expiry_date).trim() : currentMed.expiry_date;
        const finalStatus = inventory_status !== undefined ? String(inventory_status).trim() : currentMed.inventory_status;
        const finalQuantity = quantity !== undefined ? Math.max(0, parseInt(quantity, 10) || 0) : currentMed.quantity;

        if (finalQuantity === 0) {
            await Medication.findOneAndDelete({ _id: req.params.id, areaId: req.userAreaId });
            return res.json({ success: true, message: "Medication deleted (quantity 0)" });
        }

        // Check if another medication with the same drug_name, strength, and expiry_date already exists in this hospital area
        const existingDuplicate = await Medication.findOne({
            _id: { $ne: req.params.id },
            areaId: req.userAreaId,
            drug_name: finalDrugName,
            strength: finalStrength,
            expiry_date: finalExpiryDate
        });

        if (existingDuplicate) {
            // MERGE: Add quantity into the existing entry and remove this one
            existingDuplicate.quantity = (existingDuplicate.quantity || 0) + finalQuantity;
            if (finalStatus && finalStatus !== "UNKNOWN") {
                existingDuplicate.inventory_status = finalStatus;
            }
            await existingDuplicate.save();
            await Medication.findOneAndDelete({ _id: req.params.id, areaId: req.userAreaId });

            return res.json({ success: true, merged: true, medication: existingDuplicate });
        }

        // Otherwise update current document
        currentMed.drug_name = finalDrugName;
        currentMed.strength = finalStrength;
        currentMed.expiry_date = finalExpiryDate;
        currentMed.inventory_status = finalStatus;
        currentMed.quantity = finalQuantity;

        await currentMed.save();
        res.json({ success: true, medication: currentMed });
    } catch (err) {
        console.error("Failed to update medication:", err);
        res.status(500).json({ error: "Failed to update medication" });
    }
});

/* ── PUT /api/pharmacy/group/:name ─ Rename entire medicine group & auto-merge within this area ── */
router.put('/group/:name', async (req, res) => {
    try {
        const oldName = decodeURIComponent(req.params.name).trim();
        const newName = (req.body.drug_name || "").trim().toUpperCase();
        if (!newName) {
            return res.status(400).json({ error: "New drug name is required" });
        }

        const items = await Medication.find({
            areaId: req.userAreaId,
            drug_name: { $regex: new RegExp(`^${oldName}$`, 'i') }
        });

        for (const item of items) {
            const existing = await Medication.findOne({
                _id: { $ne: item._id },
                areaId: req.userAreaId,
                drug_name: newName,
                strength: item.strength,
                expiry_date: item.expiry_date
            });

            if (existing) {
                existing.quantity = (existing.quantity || 0) + (item.quantity || 1);
                await existing.save();
                await Medication.findOneAndDelete({ _id: item._id, areaId: req.userAreaId });
            } else {
                item.drug_name = newName;
                await item.save();
            }
        }

        res.json({ success: true, message: `Renamed ${oldName} to ${newName}` });
    } catch (err) {
        console.error("Failed to rename medicine group:", err);
        res.status(500).json({ error: "Failed to rename medicine group" });
    }
});

/* ── DELETE /api/pharmacy/group/:name ─ Delete entire medicine group within this area ── */
router.delete('/group/:name', async (req, res) => {
    try {
        const drugName = decodeURIComponent(req.params.name).trim();
        const result = await Medication.deleteMany({
            areaId: req.userAreaId,
            drug_name: { $regex: new RegExp(`^${drugName}$`, 'i') }
        });
        res.json({ success: true, deletedCount: result.deletedCount });
    } catch (err) {
        console.error("Failed to delete medicine group:", err);
        res.status(500).json({ error: "Failed to delete medicine group" });
    }
});

/* ── DELETE /api/pharmacy/:id ─ Delete single medication from inventory within this area ── */
router.delete('/:id', async (req, res) => {
    try {
        const deletedMed = await Medication.findOneAndDelete({ _id: req.params.id, areaId: req.userAreaId });
        if (!deletedMed) {
            return res.status(404).json({ error: "Medication not found" });
        }
        res.json({ success: true, message: "Medication deleted successfully" });
    } catch (err) {
        console.error("Failed to delete medication:", err);
        res.status(500).json({ error: "Failed to delete medication" });
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
    // Use the venv Python so all packages (EasyOCR, PyTorch, cv2) are guaranteed available
    const pythonBin = path.join(__dirname, '..', 'ml', '.venv', 'Scripts', 'python.exe');

    // 🔍 DEBUG: print the exact command being run
    console.log('\n[DEBUG] Python bin:', pythonBin);
    console.log('[DEBUG] Image path:', imagePath);
    console.log('[DEBUG] Script path:', scriptPath);

    const pythonProcess = spawn(pythonBin, [scriptPath, imagePath], {
        cwd: path.join(__dirname, '..', 'ml'),
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' }
    });

    let dataString = '';
    let errorString = '';

    pythonProcess.stdout.on('data', (data) => { dataString += data.toString(); });
    pythonProcess.stderr.on('data', (data) => { errorString += data.toString(); });

    pythonProcess.on('close', (code) => {
        console.log('[DEBUG] Raw stdout from Python:\n', dataString);

        if (code !== 0) {
            console.error(`Pharmacy scan failed (code ${code}):`, errorString);
            return res.status(500).json({ error: 'Scan pipeline failed', detail: errorString });
        }
        try {
            // Extract only the JSON object — find first '{' and matching last '}'
            const jsonStart = dataString.indexOf('{');
            const jsonEnd = dataString.lastIndexOf('}');
            if (jsonStart === -1 || jsonEnd === -1) {
                console.error('No JSON object found in pharmacy scan output:', dataString);
                return res.status(500).json({ error: 'No JSON output from scan model', raw: dataString });
            }
            const jsonStr = dataString.substring(jsonStart, jsonEnd + 1);
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

        // Clean up AFTER logging
        try { fs.unlinkSync(imagePath); } catch (_) { }
    });
});

module.exports = router;
