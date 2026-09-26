import { useState, useRef, useCallback, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import PageHeader from "../../components/admin/PageHeader";
import api from "../../api/axios";
import {
  FaUpload, FaSpinner, FaCheckCircle,
  FaTimesCircle, FaExclamationTriangle, FaSearch,
  FaTrash, FaFlask, FaCalendarAlt, FaPills, FaClipboardList,
  FaEdit, FaCheck, FaTimes, FaArrowRight, FaPrescriptionBottleAlt,
  FaVideo, FaCamera, FaCircle, FaSyncAlt,
  FaChevronLeft, FaChevronRight, FaImages
} from "react-icons/fa";

const IOT_SERVER_URL = import.meta.env.VITE_IOT_SERVER_URL || "http://localhost:9000";

/* ── Status helpers ──────────────────────────────────────── */
const STATUS_META = {
  "APPROVED (IN STOCK)": {
    color: "text-emerald-700", bg: "bg-emerald-50", border: "border-emerald-200",
    bar: "bg-emerald-500", icon: <FaCheckCircle className="text-emerald-500" />, label: "Approved",
  },
  "REJECTED (EXPIRED)": {
    color: "text-red-700", bg: "bg-red-50", border: "border-red-200",
    bar: "bg-red-500", icon: <FaTimesCircle className="text-red-500" />, label: "Expired",
  },
  "REJECTED (INVALID/NO DATE)": {
    color: "text-red-700", bg: "bg-red-50", border: "border-red-200",
    bar: "bg-red-400", icon: <FaTimesCircle className="text-red-500" />, label: "Invalid",
  },
};
const getMeta = (status = "") => {
  if (!status) return { color: "text-slate-500", bg: "bg-slate-50", border: "border-slate-200", bar: "bg-slate-400", icon: <FaExclamationTriangle className="text-slate-400" />, label: "Unknown" };
  if (status.includes("APPROVED")) return STATUS_META["APPROVED (IN STOCK)"];
  if (status.includes("INVALID") || status.includes("NO DATE")) return STATUS_META["REJECTED (INVALID/NO DATE)"];
  if (status.includes("EXPIRED")) return STATUS_META["REJECTED (EXPIRED)"];
  if (status.includes("MANUAL")) return { color: "text-amber-700", bg: "bg-amber-50", border: "border-amber-200", bar: "bg-amber-400", icon: <FaExclamationTriangle className="text-amber-500" />, label: "Review" };
  return { color: "text-slate-500", bg: "bg-slate-50", border: "border-slate-200", bar: "bg-slate-300", icon: <FaExclamationTriangle className="text-slate-400" />, label: "Unknown" };
};

const formatDate = () => new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export default function PharmacyMonitor() {
  const location = useLocation();
  const isNurse = location.pathname.startsWith("/nurse");
  const basePath = isNurse ? "/nurse" : "/admin";

  // Scanner Mode: "iot" (Live Pi/PC Server) vs "upload" (Manual File Upload)
  const [scanMode, setScanMode] = useState("iot");
  const [scanning, setScanning] = useState(false);
  const [iotScanning, setIotScanning] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [iotConnected, setIotConnected] = useState(false);
  const [lastIotDetection, setLastIotDetection] = useState(null);

  // Scan queue: loaded from DB on mount (persisted — survives refresh & multi-user)
  const [results, setResults] = useState([]);

  const [filter, setFilter] = useState("ALL");
  const [inventory, setInventory] = useState([]);
  const [pendingDispenseCount, setPendingDispenseCount] = useState(0);
  const fileRef = useRef(null);

  // Row edit state for Stock Inventory
  const [editingStockId, setEditingStockId] = useState(null);
  const [stockEditForm, setStockEditForm] = useState({ drug_name: "", strength: "", quantity: 1, expiry_date: "" });
  const [savingStock, setSavingStock] = useState(false);

  // Group / Card header edit state (Renaming whole medicine unit group)
  const [editingGroupName, setEditingGroupName] = useState(null);
  const [groupNewName, setGroupNewName] = useState("");
  const [savingGroup, setSavingGroup] = useState(false);

  // Row edit state for Pending Scans
  const [editingPendingId, setEditingPendingId] = useState(null);
  const [pendingEditForm, setPendingEditForm] = useState({ drug_name: "", strength: "", quantity: 1, expiry_date: "" });

  // Sync to localStorage as backup (in addition to DB)
  useEffect(() => {
    localStorage.setItem("pharmacyPendingScans", JSON.stringify(results));
  }, [results]);

  // Load persisted scan queue from DB
  const fetchScanQueue = async () => {
    try {
      const { data } = await api.get("/api/scan-queue");
      if (data.success && Array.isArray(data.items)) {
        setResults(data.items.map(item => ({
          id: item._id,
          _dbId: item._id,
          drug_name: item.drug_name,
          strength: item.strength,
          quantity: item.quantity,
          expiry_date: item.expiry_date,
          inventory_status: item.inventory_status,
          confidence: item.confidence,
          source: item.source || "IoT Live Camera",
          scanned_at: new Date(item.scannedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
          file_name: item.image_name || "camera_feed.jpg",
        })));
      }
    } catch (err) {
      console.warn("Could not load scan queue from DB, using localStorage fallback:", err);
      try {
        const saved = localStorage.getItem("pharmacyPendingScans");
        if (saved) setResults(JSON.parse(saved));
      } catch {}
    }
  };

  const fetchInventory = async () => {
    try {
      const [invRes, queueRes] = await Promise.allSettled([
        api.get("/api/pharmacy"),
        api.get("/api/pharmacy/dispensing-queue")
      ]);

      if (invRes.status === "fulfilled") {
        setInventory(invRes.value.data.medications || []);
      }
      if (queueRes.status === "fulfilled") {
        setPendingDispenseCount(queueRes.value.data.kpis?.pendingCount || 0);
      }
    } catch (err) {
      console.error("Failed to load inventory / queue:", err);
    }
  };

  // Incoming IoT Captures Review Queue (Manual Scan & Skip Workflow)
  const [incomingQueue, setIncomingQueue] = useState([]);
  const [selectedFrameIdx, setSelectedFrameIdx] = useState(0);

  const fetchIncomingQueue = async () => {
    try {
      const res = await fetch(`${IOT_SERVER_URL}/incoming_queue`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && Array.isArray(data.queue)) {
          setIncomingQueue(data.queue);
        }
      }
    } catch {}
  };

  useEffect(() => {
    fetchInventory();
    fetchScanQueue();
    fetchIncomingQueue();
  }, []);

  // ── Real-Time SSE Stream with IoT PC Server (Port 9000) ──
  useEffect(() => {
    let evtSource = null;
    let reconnectTimer = null;

    const connectSSE = () => {
      try {
        evtSource = new EventSource(`${IOT_SERVER_URL}/detection_stream`);

        evtSource.onopen = () => {
          setIotConnected(true);
        };

        evtSource.addEventListener("connected", () => {
          setIotConnected(true);
        });

        // Fired whenever new images arrive in the review queue
        evtSource.addEventListener("incoming_queue_updated", (e) => {
          try {
            const queue = JSON.parse(e.data);
            if (Array.isArray(queue)) {
              setIncomingQueue(queue);
            }
          } catch (err) {
            console.error("Failed to parse incoming queue SSE:", err);
          }
        });

        // Fired whenever AI Pipeline 2 verifies a medicine
        evtSource.addEventListener("medicine_detected", (e) => {
          try {
            const data = JSON.parse(e.data);
            if (data.is_medicine) {
              setLastIotDetection(data);

              setResults((prev) => {
                const drugName = (data.drug_name || "UNKNOWN").trim().toUpperCase();
                const strength = (data.strength || "N/A").trim().toUpperCase();
                const expiryDate = (data.expiry_date || "UNKNOWN").trim();

                const existingIdx = prev.findIndex(
                  (p) =>
                    (p.drug_name || "").trim().toUpperCase() === drugName &&
                    (p.strength || "").trim().toUpperCase() === strength &&
                    (p.expiry_date || "").trim() === expiryDate
                );

                if (existingIdx !== -1) {
                  const updated = [...prev];
                  updated[existingIdx] = {
                    ...updated[existingIdx],
                    quantity: (updated[existingIdx].quantity || 1) + 1,
                    scanned_at: formatDate(),
                    source: "IoT Camera Scan",
                  };
                  return updated;
                }

                return [
                  {
                    id: data.id || Date.now(),
                    ...data,
                    drug_name: drugName,
                    strength: strength,
                    expiry_date: expiryDate,
                    quantity: 1,
                    scanned_at: formatDate(),
                    source: "IoT Camera Scan",
                    file_name: data.image_name || "iot_capture.jpg",
                  },
                  ...prev,
                ];
              });
            }
          } catch (err) {
            console.error("Failed to parse SSE medicine data:", err);
          }
        });

        evtSource.onerror = () => {
          setIotConnected(false);
          if (evtSource) evtSource.close();
          reconnectTimer = setTimeout(connectSSE, 5000);
        };
      } catch (err) {
        setIotConnected(false);
        reconnectTimer = setTimeout(connectSSE, 5000);
      }
    };

    connectSSE();

    return () => {
      if (evtSource) evtSource.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, []);

  // ── Manual Trigger: Run AI Pipeline 2 on Selected IoT Camera Frame ──
  const scanSelectedFrame = async () => {
    const currentItem = incomingQueue[selectedFrameIdx] || incomingQueue[0];
    const filename = currentItem?.filename;

    try {
      setIotScanning(true);
      setError(null);

      const response = await fetch(`${IOT_SERVER_URL}/scan_frame`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Server responded with status ${response.status}`);
      }

      const data = await response.json();

      if (data.detection?.is_medicine) {
        setLastIotDetection(data.detection);
        if (Array.isArray(data.remaining_queue)) {
          setIncomingQueue(data.remaining_queue);
          setSelectedFrameIdx((prev) => Math.min(prev, Math.max(0, data.remaining_queue.length - 1)));
        }
      } else {
        setError(`Frame analyzed: Not verified as a medicine package (${data.detection?.confidence || "Rejected"}).`);
        if (Array.isArray(data.remaining_queue)) {
          setIncomingQueue(data.remaining_queue);
          setSelectedFrameIdx((prev) => Math.min(prev, Math.max(0, data.remaining_queue.length - 1)));
        }
      }
    } catch (err) {
      console.error("IoT Scan Trigger Failed:", err);
      setError(err.message || `IoT Scanner unreachable at ${IOT_SERVER_URL}. Make sure pc_server.py is running.`);
    } finally {
      setIotScanning(false);
    }
  };

  // ── Manual Trigger: Skip / Discard Frame from Queue ──
  const skipSelectedFrame = async () => {
    const currentItem = incomingQueue[selectedFrameIdx] || incomingQueue[0];
    const filename = currentItem?.filename;

    try {
      setError(null);
      const response = await fetch(`${IOT_SERVER_URL}/skip_frame`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename }),
      });
      const data = await response.json();
      if (data.success && Array.isArray(data.remaining_queue)) {
        setIncomingQueue(data.remaining_queue);
        setSelectedFrameIdx((prev) => Math.min(prev, Math.max(0, data.remaining_queue.length - 1)));
      }
    } catch (err) {
      setError("Failed to skip frame");
    }
  };

  // ── Clear All Queued Images ──
  const clearIncomingQueue = async () => {
    try {
      await fetch(`${IOT_SERVER_URL}/clear_queue`, { method: "POST" });
      setIncomingQueue([]);
      setSelectedFrameIdx(0);
    } catch {}
  };

  const triggerIotScan = scanSelectedFrame;

  const runScan = useCallback(async (file) => {
    if (!file) return;
    setError(null);
    setScanning(true);

    const objectUrl = URL.createObjectURL(file);
    setPreview(objectUrl);

    const formData = new FormData();
    formData.append("image", file);

    try {
      const { data } = await api.post("/api/pharmacy/scan", formData, {
        headers: { "Content-Type": "multipart/form-data" },
        timeout: 120000,
      });

        // Persist to MongoDB ScanQueue
        try {
          const queueRes = await api.post("/api/scan-queue", {
            drug_name: drugName,
            strength: strength,
            expiry_date: expiryDate,
            inventory_status: data.inventory_status,
            confidence: data.confidence,
            image_name: file.name,
            source: "Manual Upload",
            quantity: 1,
          });
          var savedDbId = queueRes.data?.item?._id;
        } catch (dbErr) {
          console.warn("Could not save manual scan to DB:", dbErr);
        }

        setResults((prev) => {
          const drugName = (data.drug_name || "UNKNOWN").trim().toUpperCase();
          const strength = (data.strength || "N/A").trim().toUpperCase();
          const expiryDate = (data.expiry_date || "UNKNOWN").trim();

          const existingIdx = prev.findIndex(
            (p) =>
              (p.drug_name || "").trim().toUpperCase() === drugName &&
              (p.strength || "").trim().toUpperCase() === strength &&
              (p.expiry_date || "").trim() === expiryDate
          );

          if (existingIdx !== -1) {
            const updated = [...prev];
            updated[existingIdx] = {
              ...updated[existingIdx],
              quantity: (updated[existingIdx].quantity || 1) + 1,
              _dbId: savedDbId || updated[existingIdx]._dbId,
              scanned_at: formatDate(),
              source: "Manual Upload",
            };
            return updated;
          }

          return [
            {
              id: savedDbId || Date.now(),
              _dbId: savedDbId,
              ...data,
              drug_name: drugName,
              strength: strength,
              expiry_date: expiryDate,
              quantity: 1,
              scanned_at: formatDate(),
              source: "Manual Upload",
              file_name: file.name,
            },
            ...prev,
          ];
        });
      } catch (err) {
        const msg = err.response?.data?.error || err.response?.data?.detail || err.message || "Scan failed";
        setError(msg);
      } finally {
        setScanning(false);
        if (fileRef.current) fileRef.current.value = "";
      }
    },
    []
  );

  const handleFile = (file) => {
    if (!file?.type?.startsWith("image/")) { setError("Please upload an image file (JPG, PNG, etc.)"); return; }
    runScan(file);
  };

  const acceptAll = async () => {
    if (results.length === 0) return;
    try {
      const dbIds = results.filter(r => r._dbId).map(r => r._dbId);
      if (dbIds.length > 0) {
        await api.post("/api/scan-queue/accept", { ids: dbIds });
      } else {
        // fallback: old /api/pharmacy/accept for non-DB items
        await api.post("/api/pharmacy/accept", { medications: results });
      }
      setResults([]);
      localStorage.removeItem("pharmacyPendingScans");
      fetchInventory();
    } catch {
      setError("Failed to accept medications.");
    }
  };

  const acceptRow = async (row) => {
    try {
      if (row._dbId) {
        await api.post("/api/scan-queue/accept", { ids: [row._dbId] });
      } else {
        await api.post("/api/pharmacy/accept", { medications: [row] });
      }
      setResults(prev => prev.filter(r => r.id !== row.id));
      fetchInventory();
    } catch {
      setError(`Failed to accept ${row.drug_name}`);
    }
  };

  const onInputChange = (e) => handleFile(e.target.files?.[0]);
  const onDrop = (e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files?.[0]); };
  const onDragOver = (e) => { e.preventDefault(); setDragOver(true); };
  const onDragLeave = () => setDragOver(false);

  const clearRow = async (id) => {
    const row = results.find(r => r.id === id);
    if (row?._dbId) {
      try {
        await api.delete(`/api/scan-queue/${row._dbId}`);
      } catch (e) {
        console.warn("Failed to delete queue item from DB:", e);
      }
    }
    setResults((prev) => prev.filter((r) => r.id !== id));
  };

  const clearAll = async () => {
    const dbIds = results.filter(r => r._dbId).map(r => r._dbId);
    if (dbIds.length > 0) {
      try {
        await api.post("/api/scan-queue/reject", { ids: dbIds });
      } catch (e) {
        console.warn("Failed to reject queue items in DB:", e);
      }
    }
    setResults([]);
    setPreview(null);
    localStorage.removeItem("pharmacyPendingScans");
  };

  // ── Stock Row Edit Handlers ──
  const startEditStock = (item) => {
    setEditingStockId(item._id);
    setStockEditForm({
      drug_name: item.drug_name || "",
      strength: item.strength || "",
      quantity: item.quantity || 1,
      expiry_date: item.expiry_date || "",
    });
  };

  const cancelEditStock = () => setEditingStockId(null);

  const saveEditStock = async (id) => {
    try {
      setSavingStock(true);
      await api.put(`/api/pharmacy/${id}`, stockEditForm);
      setEditingStockId(null);
      await fetchInventory();
    } catch (err) {
      console.error("Failed to update medication:", err);
      setError("Failed to update medication.");
    } finally {
      setSavingStock(false);
    }
  };

  const deleteStock = async (id, name) => {
    if (!window.confirm(`Are you sure you want to delete ${name || "this item"} from inventory?`)) return;
    try {
      await api.delete(`/api/pharmacy/${id}`);
      await fetchInventory();
    } catch (err) {
      console.error("Failed to delete medication:", err);
      setError("Failed to delete medication.");
    }
  };

  const updateStockQtyDirect = async (item, delta) => {
    const newQty = Math.max(0, (item.quantity || 1) + delta);
    if (newQty === 0) {
      deleteStock(item._id, item.drug_name);
      return;
    }
    try {
      await api.put(`/api/pharmacy/${item._id}`, { quantity: newQty });
      await fetchInventory();
    } catch (err) {
      console.error("Failed to update quantity:", err);
    }
  };

  // ── Stock Group / Unit Card Header Handlers ──
  const startEditGroup = (drugName) => {
    setEditingGroupName(drugName);
    setGroupNewName(drugName);
  };

  const cancelEditGroup = () => {
    setEditingGroupName(null);
    setGroupNewName("");
  };

  const saveEditGroup = async (oldName) => {
    const trimmed = groupNewName.trim().toUpperCase();
    if (!trimmed || trimmed === oldName) {
      setEditingGroupName(null);
      return;
    }
    try {
      setSavingGroup(true);
      await api.put(`/api/pharmacy/group/${encodeURIComponent(oldName)}`, { drug_name: trimmed });
      setEditingGroupName(null);
      await fetchInventory();
    } catch (err) {
      console.error("Failed to rename group:", err);
      setError("Failed to rename medication group.");
    } finally {
      setSavingGroup(false);
    }
  };

  const deleteGroup = async (drugName, totalUnits) => {
    if (!window.confirm(`Are you sure you want to delete all ${totalUnits} units of ${drugName} from inventory?`)) return;
    try {
      await api.delete(`/api/pharmacy/group/${encodeURIComponent(drugName)}`);
      await fetchInventory();
    } catch (err) {
      console.error("Failed to delete group:", err);
      setError("Failed to delete medication group.");
    }
  };

  // ── Pending Scans Edit Handlers (with auto-merge) ──
  const startEditPending = (row) => {
    setEditingPendingId(row.id);
    setPendingEditForm({
      drug_name: row.drug_name || "",
      strength: row.strength || "",
      quantity: row.quantity || 1,
      expiry_date: row.expiry_date || "",
    });
  };

  const cancelEditPending = () => setEditingPendingId(null);

  const saveEditPending = (id) => {
    const updatedDrugName = (pendingEditForm.drug_name || "UNKNOWN").trim().toUpperCase();
    const updatedStrength = (pendingEditForm.strength || "N/A").trim().toUpperCase();
    const updatedExpiry = (pendingEditForm.expiry_date || "UNKNOWN").trim();
    const updatedQty = Math.max(1, parseInt(pendingEditForm.quantity, 10) || 1);

    setResults((prev) => {
      const duplicateIdx = prev.findIndex(
        (r) =>
          r.id !== id &&
          (r.drug_name || "").trim().toUpperCase() === updatedDrugName &&
          (r.strength || "").trim().toUpperCase() === updatedStrength &&
          (r.expiry_date || "").trim() === updatedExpiry
      );

      if (duplicateIdx !== -1) {
        const next = prev.filter((r) => r.id !== id);
        const nextIdx = next.findIndex(
          (r) =>
            (r.drug_name || "").trim().toUpperCase() === updatedDrugName &&
            (r.strength || "").trim().toUpperCase() === updatedStrength &&
            (r.expiry_date || "").trim() === updatedExpiry
        );
        if (nextIdx !== -1) {
          next[nextIdx] = {
            ...next[nextIdx],
            quantity: (next[nextIdx].quantity || 1) + updatedQty,
            scanned_at: formatDate(),
          };
        }
        return next;
      }

      return prev.map((r) =>
        r.id === id
          ? {
              ...r,
              drug_name: updatedDrugName,
              strength: updatedStrength,
              quantity: updatedQty,
              expiry_date: updatedExpiry,
            }
          : r
      );
    });
    setEditingPendingId(null);
  };

  const updatePendingQtyDirect = (id, delta) => {
    setResults((prev) =>
      prev.map((r) => {
        if (r.id === id) {
          const newQty = Math.max(1, (r.quantity || 1) + delta);
          return { ...r, quantity: newQty };
        }
        return r;
      })
    );
  };

  const filtered = filter === "ALL" ? results : results.filter((r) => {
    if (filter === "EXPIRED") {
      return (
        r.inventory_status?.includes("EXPIRED") ||
        r.inventory_status?.includes("INVALID") ||
        r.inventory_status?.includes("NO DATE")
      );
    }
    const m = getMeta(r.inventory_status);
    return m.label.toUpperCase() === filter;
  });

  const counts = {
    total: results.length,
    approved: results.filter((r) => r.inventory_status?.includes("APPROVED")).length,
    expired: results.filter((r) =>
      r.inventory_status?.includes("EXPIRED") ||
      r.inventory_status?.includes("INVALID") ||
      r.inventory_status?.includes("NO DATE")
    ).length,
    review: results.filter((r) => r.inventory_status?.includes("MANUAL")).length,
  };

  const groupedInventory = inventory.reduce((acc, curr) => {
    const key = (curr.drug_name || "UNKNOWN").trim().toUpperCase();
    if (!acc[key]) acc[key] = [];
    acc[key].push(curr);
    return acc;
  }, {});

  return (
    <div className="w-full animate-fade-in space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <PageHeader
          title="Pharmacy Monitor"
          description="AI-powered medicine package scanner — detect drug identity, strength & expiry"
        />

        <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
          <Link
            to={`${basePath}/dispensing`}
            className="group inline-flex items-center gap-2.5 px-4 py-2.5 bg-gradient-to-r from-[#03045e] via-[#0077b6] to-[#0096c7] hover:from-[#023e8a] hover:via-[#0096c7] hover:to-[#48cae4] text-white rounded-xl text-xs font-extrabold shadow-sm hover:shadow-md transition-all active:scale-[0.98]"
          >
            <FaPrescriptionBottleAlt className="text-xs text-cyan-200 group-hover:scale-110 transition-transform" />
            <span>Dispensing Queue</span>
            {pendingDispenseCount > 0 ? (
              <span className="px-2 py-0.5 rounded-full bg-amber-400 text-slate-900 font-black text-[10px] shadow-xs animate-pulse">
                {pendingDispenseCount} pending
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded-full bg-white/20 text-white font-bold text-[10px]">
                0
              </span>
            )}
            <FaArrowRight className="text-[10px] text-white/80 group-hover:translate-x-1 transition-transform" />
          </Link>

          <Link
            to={`${basePath}/medicines`}
            className="inline-flex items-center gap-2 px-3.5 py-2.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-xl text-xs font-bold shadow-xs transition-all"
          >
            <FaClipboardList className="text-xs text-health-blue" />
            <span>Full Catalog ({inventory.length})</span>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Scans Today", value: counts.total, icon: <FaFlask />, color: "text-health-blue", bg: "bg-blue-50" },
          { label: "Approved", value: counts.approved, icon: <FaCheckCircle />, color: "text-emerald-600", bg: "bg-emerald-50" },
          { label: "Expired", value: counts.expired, icon: <FaTimesCircle />, color: "text-red-600", bg: "bg-red-50" },
          { label: "Needs Review", value: counts.review, icon: <FaExclamationTriangle />, color: "text-amber-600", bg: "bg-amber-50" },
        ].map(({ label, value, icon, color, bg }) => (
          <div key={label} className="admin-card px-5 py-4 flex items-center gap-4">
            <div className={`w-10 h-10 rounded-xl ${bg} ${color} flex items-center justify-center text-lg shrink-0`}>{icon}</div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</p>
              <p className={`text-3xl font-black ${color}`}>{value}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-5 gap-6">
        <div className="lg:col-span-2 space-y-4">
          {/* Mode Switcher */}
          <div className="flex rounded-xl p-1 bg-slate-100 border border-slate-200">
            <button
              onClick={() => setScanMode("iot")}
              className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-extrabold transition-all ${
                scanMode === "iot"
                  ? "bg-gradient-to-r from-[#03045e] to-[#0096c7] text-white shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <FaImages className="text-xs" />
              <span>Real-Time Detected Images</span>
              {incomingQueue.length > 0 ? (
                <span className="px-1.5 py-0.2 bg-amber-400 text-slate-900 font-black rounded-full text-[10px] animate-pulse">
                  {incomingQueue.length}
                </span>
              ) : (
                <span className={`w-2 h-2 rounded-full ${iotConnected ? "bg-emerald-400 animate-pulse" : "bg-red-400"}`} />
              )}
            </button>
            <button
              onClick={() => setScanMode("upload")}
              className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-extrabold transition-all ${
                scanMode === "upload"
                  ? "bg-gradient-to-r from-[#03045e] to-[#0096c7] text-white shadow-sm"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              <FaUpload className="text-xs" />
              <span>Direct File Scan</span>
            </button>
          </div>

          {/* Real-Time Detected Images Queue — 1-by-1 Analysis Station */}
          {scanMode === "iot" && (
            <div className="admin-card rounded-2xl overflow-hidden border border-slate-200 p-0 shadow-sm">
              {/* Header */}
              <div className="bg-slate-900 px-4 py-3 text-white flex items-center justify-between border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <div className={`w-2.5 h-2.5 rounded-full ${iotConnected ? "bg-emerald-400 animate-pulse" : "bg-red-400"}`} />
                  <span className="text-xs font-bold font-mono tracking-wider">
                    {incomingQueue.length > 0
                      ? `DETECTED IMAGES (${incomingQueue.length} QUEUED)`
                      : iotConnected
                      ? "REAL-TIME RECEIVER ONLINE (PORT 9000)"
                      : "IOT RECEIVER OFFLINE (PORT 9000)"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {incomingQueue.length > 0 && (
                    <button
                      onClick={clearIncomingQueue}
                      className="text-[10px] text-slate-400 hover:text-red-400 transition-colors font-mono underline"
                    >
                      Clear All ({incomingQueue.length})
                    </button>
                  )}
                  <span className="text-[10px] bg-white/10 px-2 py-0.5 rounded font-mono text-cyan-300">
                    AI Pipeline 2
                  </span>
                </div>
              </div>

              {/* Main 1-by-1 Image Frame or Real-Time Listening State */}
              <div className="relative bg-slate-950 aspect-video flex items-center justify-center overflow-hidden select-none">
                {incomingQueue.length > 0 ? (
                  <>
                    {/* Active Image */}
                    <img
                      key={incomingQueue[selectedFrameIdx]?.id || "current"}
                      src={`${IOT_SERVER_URL}${incomingQueue[selectedFrameIdx]?.url || "/image"}`}
                      alt={`Detected Medicine ${selectedFrameIdx + 1}`}
                      className="w-full h-full object-contain"
                      onError={(e) => {
                        e.target.src = `${IOT_SERVER_URL}/image`;
                      }}
                    />

                    {/* Step Navigation Arrows (1 by 1) */}
                    {incomingQueue.length > 1 && (
                      <>
                        <button
                          disabled={selectedFrameIdx === 0}
                          onClick={() => setSelectedFrameIdx((prev) => Math.max(0, prev - 1))}
                          className={`absolute left-2.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-slate-900/80 hover:bg-cyan-600 text-white flex items-center justify-center backdrop-blur-xs border border-white/20 shadow-md transition-all ${
                            selectedFrameIdx === 0 ? "opacity-30 cursor-not-allowed" : "hover:scale-110 active:scale-95"
                          }`}
                          title="Previous Detected Image"
                        >
                          <FaChevronLeft className="text-xs" />
                        </button>

                        <button
                          disabled={selectedFrameIdx >= incomingQueue.length - 1}
                          onClick={() => setSelectedFrameIdx((prev) => Math.min(incomingQueue.length - 1, prev + 1))}
                          className={`absolute right-2.5 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-slate-900/80 hover:bg-cyan-600 text-white flex items-center justify-center backdrop-blur-xs border border-white/20 shadow-md transition-all ${
                            selectedFrameIdx >= incomingQueue.length - 1 ? "opacity-30 cursor-not-allowed" : "hover:scale-110 active:scale-95"
                          }`}
                          title="Next Detected Image"
                        >
                          <FaChevronRight className="text-xs" />
                        </button>
                      </>
                    )}

                    {/* Active Image Badge */}
                    <div className="absolute top-2.5 left-2.5 bg-slate-900/90 backdrop-blur-xs border border-white/20 px-2.5 py-1 rounded-lg text-white text-[11px] font-bold flex items-center gap-2 shadow-sm">
                      <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping" />
                      <span>Photo {selectedFrameIdx + 1} of {incomingQueue.length}</span>
                      {incomingQueue[selectedFrameIdx]?.time && (
                        <span className="text-slate-300 font-mono text-[10px]">
                          ({incomingQueue[selectedFrameIdx].time})
                        </span>
                      )}
                    </div>
                  </>
                ) : (
                  /* Clean Listening / Queue Empty state (No camera error or video stream) */
                  <div className="flex flex-col items-center justify-center p-6 text-center text-slate-400 space-y-3">
                    <div className="relative">
                      <div className="w-14 h-14 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 text-2xl">
                        <FaImages />
                      </div>
                      {iotConnected && (
                        <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-emerald-500"></span>
                        </span>
                      )}
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-200">
                        {iotConnected ? "Listening for Detected Images..." : "IoT Receiver Offline (Port 9000)"}
                      </p>
                      <p className="text-[11px] text-slate-400 mt-1 max-w-xs">
                        {iotConnected
                          ? "Captured medicine photos from camera will queue here in real time to inspect and analyse 1 by 1."
                          : "Run `npm run iot` to start the local receiver and AI pipeline on port 9000."}
                      </p>
                    </div>

                    {/* Quick upload to queue input */}
                    <div className="pt-1">
                      <input
                        type="file"
                        id="iot-queue-file-input"
                        accept="image/*"
                        multiple
                        className="hidden"
                        onChange={async (e) => {
                          const files = Array.from(e.target.files || []);
                          if (!files.length) return;
                          for (const f of files) {
                            const fd = new FormData();
                            fd.append("image", f);
                            try {
                              await fetch(`${IOT_SERVER_URL}/upload`, { method: "POST", body: fd });
                            } catch {}
                          }
                          fetchIncomingQueue();
                          e.target.value = "";
                        }}
                      />
                      <label
                        htmlFor="iot-queue-file-input"
                        className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 text-slate-200 hover:text-white rounded-lg text-xs font-bold transition-all border border-white/10"
                      >
                        <FaUpload className="text-[10px]" />
                        <span>Add Detected Images to Queue</span>
                      </label>
                    </div>
                  </div>
                )}

                {/* AI Scanning Overlay */}
                {iotScanning && (
                  <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-xs flex flex-col items-center justify-center gap-2 text-white animate-fade-in z-20">
                    <FaSpinner className="text-3xl animate-spin text-cyan-400" />
                    <span className="text-xs font-extrabold tracking-wide">
                      Analyzing Photo {selectedFrameIdx + 1} with AI Pipeline 2…
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      Running OCR Layout & Expiry Verification
                    </span>
                  </div>
                )}
              </div>

              {/* Filmstrip / Thumbnail Strip for Reviewing All Detected Images */}
              {incomingQueue.length > 0 && (
                <div className="px-3 py-2 bg-slate-900 border-t border-slate-800 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar flex-1 py-0.5">
                    {incomingQueue.map((item, idx) => (
                      <button
                        key={item.id || idx}
                        onClick={() => setSelectedFrameIdx(idx)}
                        className={`relative shrink-0 w-14 h-11 rounded-lg overflow-hidden border-2 transition-all group ${
                          selectedFrameIdx === idx
                            ? "border-cyan-400 ring-2 ring-cyan-400/30 scale-105 shadow-md"
                            : "border-slate-700 opacity-60 hover:opacity-100 hover:border-slate-400"
                        }`}
                        title={`Select Photo ${idx + 1}`}
                      >
                        <img
                          src={`${IOT_SERVER_URL}${item.url}`}
                          alt={`Detected Frame ${idx + 1}`}
                          className="w-full h-full object-cover"
                        />
                        <span className="absolute bottom-0 right-0 bg-slate-950/90 text-white text-[8px] font-mono px-1">
                          #{idx + 1}
                        </span>
                      </button>
                    ))}
                  </div>

                  {/* Add more to queue button */}
                  <input
                    type="file"
                    id="iot-queue-file-input-strip"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={async (e) => {
                      const files = Array.from(e.target.files || []);
                      if (!files.length) return;
                      for (const f of files) {
                        const fd = new FormData();
                        fd.append("image", f);
                        try {
                          await fetch(`${IOT_SERVER_URL}/upload`, { method: "POST", body: fd });
                        } catch {}
                      }
                      fetchIncomingQueue();
                      e.target.value = "";
                    }}
                  />
                  <label
                    htmlFor="iot-queue-file-input-strip"
                    className="cursor-pointer shrink-0 w-8 h-11 rounded-lg border border-dashed border-slate-700 hover:border-cyan-400 text-slate-400 hover:text-cyan-300 flex items-center justify-center transition-colors text-xs"
                    title="Add more photos to queue"
                  >
                    +
                  </label>
                </div>
              )}

              {/* Action Buttons: Analyze 1 by 1 & Skip */}
              <div className="p-4 bg-slate-50 border-t border-slate-100 flex flex-col gap-3">
                <div className="flex items-center gap-2.5">
                  <button
                    disabled={iotScanning || !iotConnected || incomingQueue.length === 0}
                    onClick={scanSelectedFrame}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-gradient-to-r from-[#03045e] via-[#0077b6] to-[#0096c7] hover:from-[#023e8a] hover:to-[#0077b6] text-white rounded-xl text-xs font-extrabold shadow-sm hover:shadow active:scale-[0.98] transition-all disabled:opacity-50"
                  >
                    {iotScanning ? (
                      <FaSpinner className="animate-spin text-sm" />
                    ) : (
                      <FaCamera className="text-sm" />
                    )}
                    <span>
                      {incomingQueue.length > 0
                        ? `Analyse Photo ${selectedFrameIdx + 1} Now`
                        : "Analyse Current Frame"}
                    </span>
                  </button>

                  {incomingQueue.length > 0 && (
                    <button
                      disabled={iotScanning}
                      onClick={skipSelectedFrame}
                      className="px-4 py-3 bg-white hover:bg-red-50 text-red-600 hover:text-red-700 border border-red-200 hover:border-red-300 rounded-xl text-xs font-extrabold shadow-2xs hover:shadow-xs active:scale-[0.98] transition-all flex items-center justify-center gap-1.5"
                      title="Skip and discard this image"
                    >
                      <FaTimes className="text-xs" />
                      <span>Skip</span>
                    </button>
                  )}
                </div>

                <p className="text-[11px] text-slate-500 text-center">
                  {incomingQueue.length > 0
                    ? `Reviewing photo ${selectedFrameIdx + 1} of ${incomingQueue.length}. Click "Analyse" to verify and save, or "Skip" to discard.`
                    : "No queued photos. Real-time captured images will appear here to analyse 1 by 1."}
                </p>
              </div>

              {/* Latest Verified Medicine Result Card */}
              {lastIotDetection && (
                <div className="p-3.5 bg-emerald-50 border-t border-emerald-200 flex items-start gap-3">
                  <div className="w-7 h-7 rounded-lg bg-emerald-500 text-white flex items-center justify-center shrink-0 mt-0.5">
                    <FaCheckCircle className="text-xs" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[10px] font-black uppercase tracking-wider text-emerald-700">Latest Verified Analysis</span>
                      <span className="text-[10px] text-emerald-600 font-mono">{lastIotDetection.scanned_at}</span>
                    </div>
                    <p className="text-xs font-black text-slate-900 truncate">
                      {lastIotDetection.drug_name} <span className="font-mono text-emerald-700 font-bold">({lastIotDetection.strength})</span>
                    </p>
                    <p className="text-[11px] text-slate-600">
                      Expiry: <span className="font-bold">{lastIotDetection.expiry_date}</span> • {lastIotDetection.inventory_status}
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Manual File Upload Mode */}
          {scanMode === "upload" && (
            <div
              className={`admin-card rounded-2xl border-2 border-dashed transition-all cursor-pointer flex flex-col items-center justify-center gap-4 p-8 text-center select-none
                ${dragOver ? "border-health-blue bg-blue-50 scale-[1.01]" : "border-slate-200 hover:border-health-blue hover:bg-slate-50"}
                ${scanning ? "pointer-events-none opacity-60" : ""}`}
              onDrop={onDrop}
              onDragOver={onDragOver}
              onDragLeave={onDragLeave}
              onClick={() => !scanning && fileRef.current?.click()}
            >
              <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onInputChange} />
              {scanning ? (
                <>
                  <FaSpinner className="text-5xl text-health-blue animate-spin" />
                  <div>
                    <p className="text-lg font-black text-slate-700">Analysing…</p>
                    <p className="text-xs text-slate-400 mt-1">AI Pipeline 2 running layout analysis</p>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-2 px-6 py-4 bg-gradient-to-r from-[#03045e] to-[#0096c7] text-white rounded-xl text-sm font-bold shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all">
                    <FaUpload /> Upload & Scan
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-700">or drop medicine package image here</p>
                    <p className="text-xs text-slate-400 mt-0.5">Supports JPG, PNG, WEBP • Max 15 MB</p>
                  </div>
                </>
              )}
            </div>
          )}

          {preview && scanMode === "upload" && (
            <div className="admin-card p-4 rounded-2xl space-y-2 animate-fade-in">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Scanned Image</span>
                <button onClick={() => setPreview(null)} className="text-xs text-slate-400 hover:text-red-500 font-bold">Clear</button>
              </div>
              <div className="relative rounded-xl overflow-hidden bg-slate-900 aspect-video flex items-center justify-center">
                <img src={preview} alt="Scanned medicine" className="object-contain w-full h-full max-h-52" />
                {scanning && (
                  <div className="absolute inset-0 bg-slate-900/60 flex flex-col items-center justify-center gap-2 text-white">
                    <FaSpinner className="text-3xl animate-spin text-[#0096c7]" />
                    <span className="text-xs font-bold">Scanning text regions…</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {error && (
            <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-xs font-bold text-red-700 flex items-center gap-2">
              <FaTimesCircle className="shrink-0 text-red-500 text-sm" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="lg:col-span-3 admin-card rounded-2xl overflow-hidden flex flex-col">
          <div className="px-5 py-4 border-b border-slate-100 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center text-health-blue">
                <FaClipboardList />
              </div>
              <div>
                <h3 className="font-bold text-slate-800 text-sm">Scanned Queue</h3>
                <p className="text-[10px] text-slate-400">Pending verification before saving to stock</p>
              </div>
              <span className="text-xs bg-slate-200 text-slate-600 font-bold px-2 py-0.5 rounded-full">{filtered.length}</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {["ALL", "APPROVED", "EXPIRED", "REVIEW"].map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`text-xs px-2.5 py-1 rounded-lg font-bold transition-all ${
                    filter === f
                      ? "bg-gradient-to-r from-[#03045e] to-[#0096c7] text-white shadow-sm"
                      : "bg-white text-slate-500 hover:bg-slate-100 border border-slate-200"
                  }`}
                >
                  {f}
                </button>
              ))}
              {results.length > 0 && (
                <>
                  <button onClick={acceptAll} className="text-xs px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold transition-colors flex items-center gap-1 shadow-sm">
                    <FaCheckCircle className="text-[10px]" /> Accept All
                  </button>
                  <button onClick={clearAll} className="text-xs px-3 py-1.5 bg-red-50 text-red-600 hover:bg-red-100 rounded-lg font-bold transition-colors flex items-center gap-1">
                    <FaTrash className="text-[9px]" /> Reject All
                  </button>
                </>
              )}
            </div>
          </div>
          {scanning ? (
            <div className="flex-1 flex flex-col items-center justify-center py-20 px-6 text-center animate-fade-in">
              <div className="relative w-20 h-20 mb-5 flex items-center justify-center">
                <div className="absolute inset-0 rounded-full border-4 border-dashed border-[#0096c7] animate-[spin_4s_linear_infinite]" />
                <div className="absolute inset-2 rounded-full border-4 border-[#03045e] border-t-transparent animate-spin" />
                <span className="text-2xl relative z-10 animate-pulse">💊</span>
              </div>
              <h3 className="text-base font-bold text-slate-800 mb-1">Analyzing Medicine Package...</h3>
              <p className="text-xs text-slate-400 max-w-sm">
                Running OCR layout analysis and verifying expiration date. Results will appear as soon as the model finishes.
              </p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center py-16 text-center">
              <FaSearch className="text-4xl text-slate-200 mb-4" />
              <p className="text-slate-400 font-semibold">No scan results yet</p>
              <p className="text-xs text-slate-300 mt-1">Upload a medicine image to get started</p>
            </div>
          ) : (
            <div className="overflow-x-auto flex-1">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100">
                    {["Drug Name & Source", "Strength", "Qty", "Expiry", "Status", "Time", "Actions"].map((h) => (
                      <th key={h} className={`text-left text-[10px] font-black uppercase tracking-widest text-slate-400 px-4 py-3 whitespace-nowrap ${h === "Actions" ? "text-right" : ""}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row, idx) => {
                    const isEditing = editingPendingId === row.id;
                    const meta = getMeta(row.inventory_status);
                    const isExpired = row.inventory_status?.includes("EXPIRED");
                    const isReview = row.inventory_status?.includes("MANUAL");

                    return (
                      <tr key={row.id} className={`border-b border-slate-50 hover:bg-slate-50/70 transition-colors ${idx === 0 ? "animate-fade-in" : ""}`}>
                        <td className="px-4 py-3">
                          {isEditing ? (
                            <input type="text" value={pendingEditForm.drug_name} onChange={(e) => setPendingEditForm((f) => ({ ...f, drug_name: e.target.value }))} className="w-28 px-2 py-1 text-xs border border-health-blue rounded font-bold uppercase focus:outline-none" />
                          ) : (
                            <div className="flex items-center gap-2">
                              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#03045e] to-[#0096c7] flex items-center justify-center shrink-0">
                                <FaPills className="text-white text-[10px]" />
                              </div>
                              <div>
                                <span className="font-bold text-slate-800 truncate block max-w-[140px]">{row.drug_name}</span>
                                {row.source && (
                                  <span className="text-[9px] font-extrabold text-[#0077b6] tracking-wide uppercase">
                                    {row.source}
                                  </span>
                                )}
                              </div>
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {isEditing ? (
                            <input type="text" value={pendingEditForm.strength} onChange={(e) => setPendingEditForm((f) => ({ ...f, strength: e.target.value }))} className="w-20 px-2 py-1 text-xs border border-health-blue rounded font-mono font-bold uppercase focus:outline-none" />
                          ) : (
                            <span className="px-2 py-1 bg-slate-100 text-slate-600 rounded-md text-xs font-mono font-bold">{row.strength}</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {isEditing ? (
                            <input type="number" min="1" value={pendingEditForm.quantity} onChange={(e) => setPendingEditForm((f) => ({ ...f, quantity: parseInt(e.target.value, 10) || 1 }))} className="w-14 px-2 py-1 text-xs border border-health-blue rounded font-bold focus:outline-none" />
                          ) : (
                            <div className="flex items-center gap-1">
                              <button onClick={() => updatePendingQtyDirect(row.id, -1)} className="w-5 h-5 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center text-[10px] font-bold transition-colors">−</button>
                              <span className="px-2 py-0.5 bg-health-blue/10 text-health-blue rounded-md text-xs font-bold min-w-[24px] text-center">{row.quantity || 1}</span>
                              <button onClick={() => updatePendingQtyDirect(row.id, 1)} className="w-5 h-5 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center text-[10px] font-bold transition-colors">+</button>
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {isEditing ? (
                            <input type="text" value={pendingEditForm.expiry_date} onChange={(e) => setPendingEditForm((f) => ({ ...f, expiry_date: e.target.value }))} placeholder="MM/YYYY" className="w-24 px-2 py-1 text-xs border border-health-blue rounded font-bold focus:outline-none" />
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <FaCalendarAlt className={`text-[11px] ${isExpired ? "text-red-400" : "text-slate-400"}`} />
                              <span className={`text-xs font-bold ${isExpired ? "text-red-600" : "text-slate-600"}`}>{row.expiry_date}</span>
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border ${meta.color} ${meta.bg} ${meta.border}`}>
                            {meta.icon}
                            {isReview ? "Review" : meta.label}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs text-slate-400 font-medium">{row.scanned_at}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {isEditing ? (
                            <div className="flex items-center justify-end gap-1.5">
                              <button onClick={() => saveEditPending(row.id)} title="Save Changes" className="w-7 h-7 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 flex items-center justify-center transition-colors shadow-sm">
                                <FaCheck className="text-xs" />
                              </button>
                              <button onClick={cancelEditPending} title="Cancel" className="w-7 h-7 rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200 flex items-center justify-center transition-colors">
                                <FaTimes className="text-xs" />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-end gap-1.5">
                              <button onClick={() => startEditPending(row)} title="Edit Row" className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 flex items-center justify-center transition-colors">
                                <FaEdit className="text-[10px]" />
                              </button>
                              <button onClick={() => acceptRow(row)} title="Accept into Inventory" className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 flex items-center justify-center transition-colors">
                                <FaCheckCircle className="text-[10px]" />
                              </button>
                              <button onClick={() => clearRow(row.id)} title="Discard Scan" className="w-7 h-7 rounded-lg bg-slate-100 text-slate-400 hover:bg-red-50 hover:text-red-500 flex items-center justify-center transition-colors">
                                <FaTrash className="text-[10px]" />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── Stock Inventory (Last 4 items) ── */}
      <div className="admin-card rounded-2xl overflow-hidden mt-6">
        <div className="px-5 py-4 border-b border-slate-100 bg-slate-50 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500/10 to-blue-500/20 flex items-center justify-center text-health-blue font-bold shadow-xs">
              <FaPills className="text-sm" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-extrabold text-slate-800 text-sm sm:text-base">Stock Inventory</h3>
                <span className="text-[11px] bg-slate-200/80 text-slate-700 font-bold px-2 py-0.5 rounded-full">
                  {inventory.length} units
                </span>
              </div>
              <p className="text-[11px] text-slate-400">Recently scanned & updated medications in stock</p>
            </div>
          </div>

          <Link
            to={`${basePath}/medicines`}
            className="group relative inline-flex items-center gap-2.5 px-4 py-2 rounded-xl bg-gradient-to-r from-[#03045e] via-[#0077b6] to-[#0096c7] hover:from-[#023e8a] hover:via-[#0096c7] hover:to-[#48cae4] text-white text-xs font-extrabold shadow-sm hover:shadow-md hover:shadow-cyan-500/20 active:scale-[0.98] transition-all duration-200 border border-white/10"
          >
            <div className="w-5 h-5 rounded-lg bg-white/15 flex items-center justify-center text-[10px] text-white backdrop-blur-sm group-hover:scale-110 transition-transform">
              <FaSearch />
            </div>
            <span className="tracking-wide">List of Medicines & Search</span>
            <span className="px-2 py-0.5 rounded-md bg-white/20 text-white font-mono text-[10px] font-bold border border-white/20">
              {inventory.length}
            </span>
            <FaArrowRight className="text-[10px] transition-transform duration-200 group-hover:translate-x-1" />
          </Link>
        </div>

        {Object.keys(groupedInventory).length === 0 ? (
          <div className="py-12 text-center text-slate-400 font-semibold">No medications in stock</div>
        ) : (
          <>
            <div className="p-5 space-y-6">
              {Object.entries(groupedInventory).slice(0, 4).map(([drugName, items]) => {
                const totalUnits = items.reduce((sum, item) => sum + (item.quantity || 1), 0);
                const isEditingGroup = editingGroupName === drugName;

                return (
                  <div key={drugName} className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                    {/* Card Header with Group Rename & Delete Actions */}
                    <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex items-center justify-between">
                      <div className="flex items-center gap-2 flex-1">
                        {isEditingGroup ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={groupNewName}
                              onChange={(e) => setGroupNewName(e.target.value)}
                              className="px-2.5 py-1 text-sm border border-health-blue rounded-lg font-black uppercase focus:outline-none"
                              placeholder="Drug Name"
                              autoFocus
                            />
                            <button
                              disabled={savingGroup}
                              onClick={() => saveEditGroup(drugName)}
                              title="Save Drug Name"
                              className="w-7 h-7 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 flex items-center justify-center transition-colors shadow-sm disabled:opacity-50"
                            >
                              {savingGroup ? <FaSpinner className="animate-spin text-xs" /> : <FaCheck className="text-xs" />}
                            </button>
                            <button
                              onClick={cancelEditGroup}
                              title="Cancel"
                              className="w-7 h-7 rounded-lg bg-slate-200 text-slate-600 hover:bg-slate-300 flex items-center justify-center transition-colors"
                            >
                              <FaTimes className="text-xs" />
                            </button>
                          </div>
                        ) : (
                          <>
                            <h4 className="font-black text-slate-800 text-lg">{drugName}</h4>
                            <span className="text-xs bg-health-blue text-white font-bold px-2.5 py-0.5 rounded-full">
                              {totalUnits} units
                            </span>
                          </>
                        )}
                      </div>
                      {!isEditingGroup && (
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => startEditGroup(drugName)}
                            title="Rename Medicine Unit / Card"
                            className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 flex items-center justify-center transition-colors"
                          >
                            <FaEdit className="text-xs" />
                          </button>
                          <button
                            onClick={() => deleteGroup(drugName, totalUnits)}
                            title="Delete All Units of This Medicine"
                            className="w-7 h-7 rounded-lg bg-red-50 text-red-500 hover:bg-red-100 flex items-center justify-center transition-colors"
                          >
                            <FaTrash className="text-xs" />
                          </button>
                        </div>
                      )}
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-white border-b border-slate-100">
                            <th className="text-left text-[10px] font-black uppercase tracking-widest text-slate-400 px-4 py-2.5">Strength</th>
                            <th className="text-left text-[10px] font-black uppercase tracking-widest text-slate-400 px-4 py-2.5">Quantity</th>
                            <th className="text-left text-[10px] font-black uppercase tracking-widest text-slate-400 px-4 py-2.5">Expiry</th>
                            <th className="text-left text-[10px] font-black uppercase tracking-widest text-slate-400 px-4 py-2.5">Status</th>
                            <th className="text-left text-[10px] font-black uppercase tracking-widest text-slate-400 px-4 py-2.5">Scanned On</th>
                            <th className="text-right text-[10px] font-black uppercase tracking-widest text-slate-400 px-4 py-2.5">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((item, idx) => {
                            const isEditing = editingStockId === item._id;
                            const meta = getMeta(item.inventory_status);
                            const isExpired = item.inventory_status?.includes("EXPIRED");
                            const isReview = item.inventory_status?.includes("MANUAL");
                            const scanDate = item.scannedAt || item.createdAt;
                            return (
                              <tr key={item._id || idx} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                                <td className="px-4 py-2.5">
                                  {isEditing ? (
                                    <div className="space-y-1">
                                      <label className="text-[9px] font-bold text-slate-400 uppercase">Drug & Strength</label>
                                      <div className="flex items-center gap-1.5">
                                        <input type="text" value={stockEditForm.drug_name} onChange={(e) => setStockEditForm((f) => ({ ...f, drug_name: e.target.value }))} className="w-28 px-2 py-1 text-xs border border-health-blue rounded font-bold uppercase focus:outline-none" />
                                        <input type="text" value={stockEditForm.strength} onChange={(e) => setStockEditForm((f) => ({ ...f, strength: e.target.value }))} className="w-20 px-2 py-1 text-xs border border-health-blue rounded font-mono font-bold uppercase focus:outline-none" />
                                      </div>
                                    </div>
                                  ) : (
                                    <span className="px-2 py-1 bg-slate-100 text-slate-600 rounded-md text-xs font-mono font-bold">{item.strength}</span>
                                  )}
                                </td>
                                <td className="px-4 py-2.5">
                                  {isEditing ? (
                                    <div className="space-y-1">
                                      <label className="text-[9px] font-bold text-slate-400 uppercase">Qty</label>
                                      <input type="number" min="0" value={stockEditForm.quantity} onChange={(e) => setStockEditForm((f) => ({ ...f, quantity: parseInt(e.target.value, 10) || 0 }))} className="w-16 px-2 py-1 text-xs border border-health-blue rounded font-bold focus:outline-none block" />
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-1">
                                      <button onClick={() => updateStockQtyDirect(item, -1)} className="w-5 h-5 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center text-[10px] font-bold transition-colors">−</button>
                                      <span className="px-2 py-0.5 bg-health-blue/10 text-health-blue rounded-md text-xs font-bold min-w-[24px] text-center">{item.quantity || 1}</span>
                                      <button onClick={() => updateStockQtyDirect(item, 1)} className="w-5 h-5 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center text-[10px] font-bold transition-colors">+</button>
                                    </div>
                                  )}
                                </td>
                                <td className="px-4 py-2.5">
                                  {isEditing ? (
                                    <div className="space-y-1">
                                      <label className="text-[9px] font-bold text-slate-400 uppercase">Expiry</label>
                                      <input type="text" value={stockEditForm.expiry_date} onChange={(e) => setStockEditForm((f) => ({ ...f, expiry_date: e.target.value }))} className="w-24 px-2 py-1 text-xs border border-health-blue rounded font-bold focus:outline-none block" />
                                    </div>
                                  ) : (
                                    <div className="flex items-center gap-1.5">
                                      <FaCalendarAlt className={`text-[11px] ${isExpired ? "text-red-400" : "text-slate-400"}`} />
                                      <span className={`text-xs font-bold ${isExpired ? "text-red-600" : "text-slate-600"}`}>{item.expiry_date}</span>
                                    </div>
                                  )}
                                </td>
                                <td className="px-4 py-2.5">
                                  <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-bold border ${meta.color} ${meta.bg} ${meta.border}`}>
                                    {meta.icon}
                                    {isReview ? "Review" : meta.label}
                                  </span>
                                </td>
                                <td className="px-4 py-2.5">
                                  <span className="text-[11px] text-slate-400 font-medium">{scanDate ? new Date(scanDate).toLocaleDateString() : new Date().toLocaleDateString()}</span>
                                </td>
                                <td className="px-4 py-2.5 text-right">
                                  {isEditing ? (
                                    <div className="flex items-center justify-end gap-1.5">
                                      <button disabled={savingStock} onClick={() => saveEditStock(item._id)} className="w-7 h-7 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 flex items-center justify-center transition-colors shadow-sm disabled:opacity-50">
                                        {savingStock ? <FaSpinner className="animate-spin text-xs" /> : <FaCheck className="text-xs" />}
                                      </button>
                                      <button onClick={cancelEditStock} className="w-7 h-7 rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200 flex items-center justify-center transition-colors"><FaTimes className="text-xs" /></button>
                                    </div>
                                  ) : (
                                    <div className="flex items-center justify-end gap-1.5">
                                      <button onClick={() => startEditStock(item)} className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 flex items-center justify-center transition-colors"><FaEdit className="text-xs" /></button>
                                      <button onClick={() => deleteStock(item._id, item.drug_name)} className="w-7 h-7 rounded-lg bg-red-50 text-red-500 hover:bg-red-100 flex items-center justify-center transition-colors"><FaTrash className="text-xs" /></button>
                                    </div>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>

            {Object.keys(groupedInventory).length > 4 ? (
              <div className="px-6 py-4 bg-gradient-to-r from-slate-50 via-blue-50/40 to-slate-50 border-t border-slate-200/80 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-3 text-center sm:text-left">
                  <div className="w-9 h-9 rounded-xl bg-blue-100 text-health-blue flex items-center justify-center shrink-0">
                    <FaClipboardList className="text-sm" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-slate-800">
                      Showing latest 4 of {Object.keys(groupedInventory).length} medication groups ({inventory.length} total units)
                    </p>
                    <p className="text-[11px] text-slate-500">
                      Access the full interactive directory with real-time search, filtering, and stock management.
                    </p>
                  </div>
                </div>
                <Link
                  to={`${basePath}/medicines`}
                  className="group shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white hover:bg-slate-50 text-slate-800 hover:text-health-blue text-xs font-bold border border-slate-200 hover:border-health-blue/40 shadow-xs hover:shadow transition-all"
                >
                  <FaSearch className="text-health-blue text-xs group-hover:scale-110 transition-transform" />
                  <span>Open Full Directory</span>
                  <FaArrowRight className="text-[10px] text-slate-400 group-hover:text-health-blue group-hover:translate-x-1 transition-all" />
                </Link>
              </div>
            ) : Object.keys(groupedInventory).length > 0 ? (
              <div className="px-6 py-3 bg-slate-50/60 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-slate-500">
                <span>Showing all {Object.keys(groupedInventory).length} medications in stock.</span>
                <Link
                  to={`${basePath}/medicines`}
                  className="group inline-flex items-center gap-1.5 font-bold text-health-blue hover:text-[#03045e] transition-colors"
                >
                  <span>Open full searchable catalog table</span>
                  <FaArrowRight className="text-[9px] group-hover:translate-x-0.5 transition-transform" />
                </Link>
              </div>
            ) : null}
          </>
        )}
      </div>

      <div className="admin-card px-5 py-4 flex flex-wrap items-center gap-6">
        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Status Guide</p>
        {[
          { icon: <FaCheckCircle className="text-emerald-500" />, label: "Approved (In Stock)", desc: "Valid expiry, safe to dispense" },
          { icon: <FaTimesCircle className="text-red-500" />, label: "Rejected (Expired)", desc: "Past expiry date — do not use" },
          { icon: <FaExclamationTriangle className="text-amber-500" />, label: "Manual Review", desc: "Multiple unlabeled dates — verify manually" },
          { icon: <FaTimesCircle className="text-red-400" />, label: "Invalid / No Date", desc: "No parseable date found on package" },
        ].map(({ icon, label, desc }) => (
          <div key={label} className="flex items-center gap-2">
            <span className="text-base">{icon}</span>
            <div>
              <p className="text-xs font-bold text-slate-700">{label}</p>
              <p className="text-[10px] text-slate-400">{desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
