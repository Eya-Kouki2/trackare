import { useState, useRef, useCallback, useEffect } from "react";
import PageHeader from "../../components/admin/PageHeader";
import api from "../../api/axios";
import {
  FaUpload, FaSpinner, FaCheckCircle,
  FaTimesCircle, FaExclamationTriangle, FaSearch,
  FaTrash, FaFlask, FaCalendarAlt, FaPills, FaClipboardList,
} from "react-icons/fa";

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
  if (!status) return { color: "text-slate-500", bg: "bg-slate-50", border: "border-slate-200", bar: "bg-slate-400", icon: <FaExclamationTriangle className="text-slate-400" />, label: status || "Unknown" };
  for (const key of Object.keys(STATUS_META)) {
    if (status.includes(key.replace(/\(.*?\)/, "").trim()) || status === key) return { ...STATUS_META[key], label: status.includes("MANUAL") ? "Review" : STATUS_META[key]?.label };
  }
  if (status.includes("MANUAL")) return { color: "text-amber-700", bg: "bg-amber-50", border: "border-amber-200", bar: "bg-amber-400", icon: <FaExclamationTriangle className="text-amber-500" />, label: "Review" };
  return { color: "text-slate-500", bg: "bg-slate-50", border: "border-slate-200", bar: "bg-slate-300", icon: <FaExclamationTriangle className="text-slate-400" />, label: "Unknown" };
};

const formatDate = () => new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

export default function PharmacyMonitor() {
  const [scanning, setScanning] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  
  // Persist pending scans in localStorage
  const [results, setResults] = useState(() => {
    try {
      const saved = localStorage.getItem("pharmacyPendingScans");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [filter, setFilter] = useState("ALL");
  const [inventory, setInventory] = useState([]);
  const fileRef = useRef(null);

  // Keep localStorage synced whenever results change
  useEffect(() => {
    localStorage.setItem("pharmacyPendingScans", JSON.stringify(results));
  }, [results]);

  const fetchInventory = async () => {
    try {
      const { data } = await api.get("/api/pharmacy");
      setInventory(data.medications || []);
    } catch (err) {
      console.error("Failed to load inventory:", err);
    }
  };

  useEffect(() => {
    fetchInventory();
  }, []);

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
        timeout: 120000, // 2-min timeout — OCR is slow
      });

      setResults((prev) => {
        const existingIdx = prev.findIndex(
          (p) =>
            p.drug_name === data.drug_name &&
            p.strength === data.strength &&
            p.expiry_date === data.expiry_date
        );

        if (existingIdx !== -1) {
          // If exists, increment quantity
          const updated = [...prev];
          updated[existingIdx] = {
            ...updated[existingIdx],
            quantity: (updated[existingIdx].quantity || 1) + 1,
            scanned_at: formatDate(), // Update time to latest scan
          };
          return updated;
        }

        // If new, add with quantity 1
        return [
          {
            id: Date.now(),
            ...data,
            quantity: 1,
            scanned_at: formatDate(),
            file_name: file.name,
          },
          ...prev,
        ];
      });
      // NOTE: We no longer auto-fetch inventory here since they aren't saved yet.
    } catch (err) {
      const msg = err.response?.data?.error || err.response?.data?.detail || err.message || "Scan failed";
      setError(msg);
    } finally {
      setScanning(false);
      // Reset the file input so the same or any new image can be uploaded immediately
      // without the user needing to refresh the page first.
      if (fileRef.current) fileRef.current.value = "";
    }
  }, []);

  const handleFile = (file) => {
    if (!file?.type?.startsWith("image/")) { setError("Please upload an image file (JPG, PNG, etc.)"); return; }
    runScan(file);
  };

  const acceptAll = async () => {
    if (results.length === 0) return;
    try {
      await api.post("/api/pharmacy/accept", { medications: results });
      clearAll();
      fetchInventory();
    } catch {
      setError("Failed to accept medications.");
    }
  };

  const acceptRow = async (row) => {
    try {
      await api.post("/api/pharmacy/accept", { medications: [row] });
      clearRow(row.id);
      fetchInventory();
    } catch {
      setError(`Failed to accept ${row.drug_name}`);
    }
  };

  const onInputChange = (e) => handleFile(e.target.files?.[0]);
  const onDrop = (e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer.files?.[0]); };
  const onDragOver = (e) => { e.preventDefault(); setDragOver(true); };
  const onDragLeave = () => setDragOver(false);

  const clearRow = (id) => setResults((prev) => prev.filter((r) => r.id !== id));
  const clearAll = () => { setResults([]); setPreview(null); };

  const filtered = filter === "ALL" ? results : results.filter((r) => {
    const m = getMeta(r.inventory_status);
    return m.label.toUpperCase() === filter;
  });

  const counts = {
    total: results.length,
    approved: results.filter((r) => r.inventory_status?.includes("APPROVED")).length,
    expired: results.filter((r) => r.inventory_status?.includes("EXPIRED")).length,
    review: results.filter((r) => r.inventory_status?.includes("MANUAL")).length,
  };

  const groupedInventory = inventory.reduce((acc, curr) => {
    const key = curr.drug_name || "UNKNOWN";
    if (!acc[key]) acc[key] = [];
    acc[key].push(curr);
    return acc;
  }, {});

  return (
    <div className="w-full animate-fade-in space-y-6">
      <PageHeader
        title="Pharmacy Monitor"
        description="AI-powered medicine package scanner — detect drug identity, strength & expiry"
      />

      {/* ── KPI Bar ── */}
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
        {/* ── Left: Upload Panel ── */}
        <div className="lg:col-span-2 space-y-4">

          {/* Drop Zone */}
          <div
            className={`admin-card rounded-2xl border-2 border-dashed transition-all cursor-pointer flex flex-col items-center justify-center gap-4 p-10 text-center select-none
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
                  <p className="text-xs text-slate-400 mt-1">OCR pipeline running — this may take 30–60 s</p>
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-2 px-6 py-4 bg-gradient-to-r from-[#03045e] to-[#0096c7] text-white rounded-xl text-lg font-bold shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all">
                  <FaUpload /> Upload & Scan
                </div>
              </>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4 animate-fade-in">
              <FaTimesCircle className="text-red-500 mt-0.5 shrink-0" />
              <p className="text-sm text-red-700 font-medium">{error}</p>
            </div>
          )}

          {/* Preview */}
          {preview && (
            <div className="admin-card p-3 rounded-2xl overflow-hidden">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2 px-1">Last Scanned Image</p>
              <img
                src={preview}
                alt="Scanned medicine"
                className="w-full rounded-xl object-contain max-h-60 bg-slate-100"
              />
            </div>
          )}
        </div>

        {/* ── Right: Results Table ── */}
        <div className="lg:col-span-3 admin-card rounded-2xl overflow-hidden flex flex-col">
          {/* Table Header */}
          <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <FaClipboardList className="text-health-blue" />
              <span className="font-bold text-slate-700">Scan Results</span>
              <span className="text-xs bg-slate-100 text-slate-500 font-bold px-2 py-0.5 rounded-full">{results.length}</span>
            </div>
            <div className="flex items-center gap-2">
              {/* Filter */}
              <select
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 font-semibold text-slate-600 bg-white focus:outline-none focus:ring-2 focus:ring-health-blue/20"
              >
                <option value="ALL">All</option>
                <option value="APPROVED">Approved</option>
                <option value="EXPIRED">Expired</option>
                <option value="REVIEW">Review</option>
              </select>
              {results.length > 0 && (
                <>
                  <button onClick={acceptAll} className="text-xs px-3 py-1.5 bg-emerald-50 text-emerald-600 hover:bg-emerald-100 rounded-lg font-bold transition-colors flex items-center gap-1">
                    <FaCheckCircle className="text-[9px]" /> Accept All
                  </button>
                  <button onClick={clearAll} className="text-xs px-3 py-1.5 bg-red-50 text-red-600 hover:bg-red-100 rounded-lg font-bold transition-colors flex items-center gap-1">
                    <FaTrash className="text-[9px]" /> Reject All
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Table */}
          {filtered.length === 0 ? (
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
                    {["Drug Name", "Strength", "Qty", "Expiry", "Status", "Time", ""].map((h) => (
                      <th key={h} className="text-left text-[10px] font-black uppercase tracking-widest text-slate-400 px-4 py-3 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((row, idx) => {
                    const meta = getMeta(row.inventory_status);
                    const isExpired = row.inventory_status?.includes("EXPIRED");
                    const isReview = row.inventory_status?.includes("MANUAL");
                    return (
                      <tr
                        key={row.id}
                        className={`border-b border-slate-50 hover:bg-slate-50/70 transition-colors ${idx === 0 ? "animate-fade-in" : ""}`}
                      >
                        {/* Drug Name */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#03045e] to-[#0096c7] flex items-center justify-center shrink-0">
                              <FaPills className="text-white text-[10px]" />
                            </div>
                            <span className="font-bold text-slate-800 truncate max-w-[120px]">{row.drug_name}</span>
                          </div>
                        </td>

                        {/* Strength */}
                        <td className="px-4 py-3">
                          <span className="px-2 py-1 bg-slate-100 text-slate-600 rounded-md text-xs font-mono font-bold">{row.strength}</span>
                        </td>

                        {/* Quantity */}
                        <td className="px-4 py-3">
                          <span className="px-2 py-1 bg-health-blue/10 text-health-blue rounded-md text-xs font-bold">{row.quantity || 1}</span>
                        </td>

                        {/* Expiry */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <FaCalendarAlt className={`text-[11px] ${isExpired ? "text-red-400" : "text-slate-400"}`} />
                            <span className={`text-xs font-bold ${isExpired ? "text-red-600" : "text-slate-600"}`}>{row.expiry_date}</span>
                          </div>
                        </td>

                        {/* Status */}
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold border ${meta.color} ${meta.bg} ${meta.border}`}>
                            {meta.icon}
                            {isReview ? "Review" : meta.label}
                          </span>
                        </td>

                        {/* Time */}
                        <td className="px-4 py-3">
                          <span className="text-xs text-slate-400 font-medium">{row.scanned_at}</span>
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <button onClick={() => acceptRow(row)} title="Accept into Inventory" className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 flex items-center justify-center transition-colors">
                              <FaCheckCircle className="text-[10px]" />
                            </button>
                            <button onClick={() => clearRow(row.id)} title="Discard Scan" className="w-7 h-7 rounded-lg bg-slate-100 text-slate-400 hover:bg-red-50 hover:text-red-500 flex items-center justify-center transition-colors">
                              <FaTrash className="text-[10px]" />
                            </button>
                          </div>
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

      {/* ── Stock Inventory (Grouped) ── */}
      <div className="admin-card rounded-2xl overflow-hidden mt-6">
        <div className="px-5 py-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center text-indigo-600">
              <FaPills />
            </div>
            <h3 className="font-bold text-slate-800">Stock Inventory</h3>
            <span className="text-xs bg-slate-200 text-slate-600 font-bold px-2 py-0.5 rounded-full">{inventory.length} items</span>
          </div>
        </div>
        
        {Object.keys(groupedInventory).length === 0 ? (
          <div className="py-12 text-center text-slate-400 font-semibold">No medications in stock</div>
        ) : (
          <div className="p-5 space-y-6">
            {Object.entries(groupedInventory).map(([drugName, items]) => (
              <div key={drugName} className="border border-slate-200 rounded-xl overflow-hidden">
                <div className="bg-slate-50 px-4 py-3 border-b border-slate-200 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <h4 className="font-black text-slate-800 text-lg">{drugName}</h4>
                    <span className="text-xs bg-health-blue text-white font-bold px-2 py-0.5 rounded-full">
                      {items.reduce((sum, item) => sum + (item.quantity || 1), 0)} units
                    </span>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-white border-b border-slate-100">
                        <th className="text-left text-[10px] font-black uppercase tracking-widest text-slate-400 px-4 py-2">Strength</th>
                        <th className="text-left text-[10px] font-black uppercase tracking-widest text-slate-400 px-4 py-2">Quantity</th>
                        <th className="text-left text-[10px] font-black uppercase tracking-widest text-slate-400 px-4 py-2">Expiry</th>
                        <th className="text-left text-[10px] font-black uppercase tracking-widest text-slate-400 px-4 py-2">Status</th>
                        <th className="text-left text-[10px] font-black uppercase tracking-widest text-slate-400 px-4 py-2">Scanned On</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => {
                        const meta = getMeta(item.inventory_status);
                        const isExpired = item.inventory_status?.includes("EXPIRED");
                        const isReview = item.inventory_status?.includes("MANUAL");
                        return (
                          <tr key={item._id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                            <td className="px-4 py-2">
                              <span className="px-2 py-1 bg-slate-100 text-slate-600 rounded-md text-xs font-mono font-bold">{item.strength}</span>
                            </td>
                            <td className="px-4 py-2">
                              <span className="px-2 py-1 bg-health-blue/10 text-health-blue rounded-md text-xs font-bold">{item.quantity || 1}</span>
                            </td>
                            <td className="px-4 py-2">
                              <div className="flex items-center gap-1.5">
                                <FaCalendarAlt className={`text-[11px] ${isExpired ? "text-red-400" : "text-slate-400"}`} />
                                <span className={`text-xs font-bold ${isExpired ? "text-red-600" : "text-slate-600"}`}>{item.expiry_date}</span>
                              </div>
                            </td>
                            <td className="px-4 py-2">
                              <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-bold border ${meta.color} ${meta.bg} ${meta.border}`}>
                                {meta.icon}
                                {isReview ? "Review" : meta.label}
                              </span>
                            </td>
                            <td className="px-4 py-2">
                              <span className="text-[11px] text-slate-400 font-medium">
                                {new Date(item.scannedAt).toLocaleDateString()}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Legend ── */}
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
