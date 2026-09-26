import { useState, useEffect, useCallback } from "react";
import { Link, useLocation } from "react-router-dom";
import PageHeader from "../../components/admin/PageHeader";
import api from "../../api/axios";
import {
  FaSearch, FaPills, FaCheckCircle, FaTimesCircle,
  FaExclamationTriangle, FaClock, FaArrowLeft, FaSpinner,
  FaSync, FaCheck, FaTimes, FaEdit, FaTrash, FaPlus,
  FaChevronDown, FaChevronUp, FaClipboardCheck, FaHospitalUser,
  FaPrescriptionBottleAlt
} from "react-icons/fa";

export default function DispensingQueue() {
  const location = useLocation();
  const isNurse = location.pathname.startsWith("/nurse");
  const basePath = isNurse ? "/nurse" : "/admin";

  const [encounters, setEncounters] = useState([]);
  const [kpis, setKpis] = useState({
    pendingCount: 0,
    dispensedCount: 0,
    totalEncounters: 0,
    totalPatients: 0,
    lowStockCount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all"); // "all" | "pending" | "dispensed"
  
  // Expanded patient encounter row ID
  const [expandedEncounterId, setExpandedEncounterId] = useState(null);

  // Per-item custom dispense quantity inputs: { [prescriptionItemId]: number }
  const [dispenseQtyInputs, setDispenseQtyInputs] = useState({});

  // Edit item state: { [prescriptionItemId]: { drug_name, strength, quantity, instructions } }
  const [editingItemId, setEditingItemId] = useState(null);
  const [editItemForm, setEditItemForm] = useState({ drug_name: "", strength: "", quantity: 1, instructions: "" });
  const [savingEdit, setSavingEdit] = useState(false);

  // Add new drug to encounter state
  const [addingToEncounterId, setAddingToEncounterId] = useState(null);
  const [newDrugForm, setNewDrugForm] = useState({ drug_name: "", strength: "", quantity: 1, instructions: "" });
  const [savingNewDrug, setSavingNewDrug] = useState(false);

  // Loading states
  const [actionLoading, setActionLoading] = useState(null);
  const [toastMessage, setToastMessage] = useState(null);

  const showToast = (msg, isError = false) => {
    setToastMessage({ text: msg, isError });
    setTimeout(() => setToastMessage(null), 4000);
  };

  const fetchQueue = useCallback(async () => {
    try {
      setLoading(true);
      const { data } = await api.get("/api/pharmacy/dispensing-queue", {
        params: { status: statusFilter, search: search.trim() || undefined }
      });
      if (data.success) {
        setEncounters(data.encounters || []);
        if (data.kpis) setKpis(data.kpis);
      }
    } catch (err) {
      console.error("Failed to load dispensing queue:", err);
      showToast("Failed to fetch dispensing queue", true);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchQueue();
    }, 200);
    return () => clearTimeout(timer);
  }, [fetchQueue]);

  // Toggle row expansion
  const toggleExpand = (id) => {
    setExpandedEncounterId((prev) => (prev === id ? null : id));
  };

  // Dispense Action (Custom quantity or All)
  const handleDispenseItem = async (encounterId, item, patientName, token) => {
    const qtyToGive = dispenseQtyInputs[item._id] !== undefined
      ? parseInt(dispenseQtyInputs[item._id], 10)
      : item.remainingQuantity;

    if (!qtyToGive || qtyToGive <= 0) {
      showToast("Please enter a valid quantity to give.", true);
      return;
    }

    try {
      setActionLoading(`dispense-${item._id}`);
      const { data } = await api.post("/api/pharmacy/dispense", {
        encounterId,
        prescriptionItemId: item._id,
        quantityToDispense: qtyToGive,
        dispenseAll: false
      });

      if (data.success) {
        showToast(`✅ Given ${qtyToGive}x ${item.drug_name} to ${patientName} (Token #${token}) — Stock inventory deducted!`);
        // Reset local input
        setDispenseQtyInputs((prev) => {
          const next = { ...prev };
          delete next[item._id];
          return next;
        });
        fetchQueue();
      }
    } catch (err) {
      console.error("Dispense error:", err);
      showToast(err.response?.data?.error || "Failed to dispense medication", true);
    } finally {
      setActionLoading(null);
    }
  };

  // Dispense All remaining items in encounter
  const handleDispenseAll = async (encounterId, patientName, token) => {
    try {
      setActionLoading(`dispenseAll-${encounterId}`);
      const { data } = await api.post("/api/pharmacy/dispense", {
        encounterId,
        dispenseAll: true
      });

      if (data.success) {
        showToast(`✅ All remaining medications dispensed for ${patientName} (Token #${token})`);
        fetchQueue();
      }
    } catch (err) {
      console.error("Dispense All error:", err);
      showToast(err.response?.data?.error || "Failed to dispense all items", true);
    } finally {
      setActionLoading(null);
    }
  };

  // Start editing a prescribed item
  const startEditItem = (item) => {
    setEditingItemId(item._id);
    setEditItemForm({
      drug_name: item.drug_name,
      strength: item.strength || "",
      quantity: item.quantity || 1,
      instructions: item.instructions || ""
    });
  };

  const cancelEditItem = () => {
    setEditingItemId(null);
  };

  const saveEditItem = async (encounterId, prescriptionId) => {
    try {
      setSavingEdit(true);
      const { data } = await api.put(`/api/pharmacy/prescription/${encounterId}/${prescriptionId}`, editItemForm);
      if (data.success) {
        showToast("✅ Medication details updated");
        setEditingItemId(null);
        fetchQueue();
      }
    } catch (err) {
      console.error("Failed to update prescription item:", err);
      showToast("Failed to save changes", true);
    } finally {
      setSavingEdit(false);
    }
  };

  // Delete a prescribed item
  const deleteItem = async (encounterId, prescriptionId, drugName) => {
    if (!window.confirm(`Are you sure you want to remove ${drugName || "this medication"} from this prescription?`)) return;
    try {
      setActionLoading(`delete-${prescriptionId}`);
      const { data } = await api.delete(`/api/pharmacy/prescription/${encounterId}/${prescriptionId}`);
      if (data.success) {
        showToast(`🗑️ ${drugName} removed from prescription`);
        fetchQueue();
      }
    } catch (err) {
      console.error("Failed to delete item:", err);
      showToast("Failed to remove medication", true);
    } finally {
      setActionLoading(null);
    }
  };

  // Add a new medication row to encounter
  const saveNewDrug = async (encounterId) => {
    if (!newDrugForm.drug_name.trim()) {
      showToast("Please enter drug name", true);
      return;
    }
    try {
      setSavingNewDrug(true);
      const { data } = await api.post(`/api/pharmacy/prescription/${encounterId}`, newDrugForm);
      if (data.success) {
        showToast("✅ Added new medication to prescription");
        setAddingToEncounterId(null);
        setNewDrugForm({ drug_name: "", strength: "", quantity: 1, instructions: "" });
        fetchQueue();
      }
    } catch (err) {
      console.error("Failed to add prescription item:", err);
      showToast("Failed to add medication", true);
    } finally {
      setSavingNewDrug(false);
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* ── Toast Notification ── */}
      {toastMessage && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-5 py-3.5 rounded-2xl shadow-xl text-white text-xs sm:text-sm font-bold flex items-center gap-3 transition-all animate-bounce ${
            toastMessage.isError ? "bg-red-600 shadow-red-500/30" : "bg-emerald-600 shadow-emerald-500/30"
          }`}
        >
          {toastMessage.isError ? <FaTimesCircle className="text-base" /> : <FaCheckCircle className="text-base" />}
          <span>{toastMessage.text}</span>
        </div>
      )}

      {/* ── Page Header ── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <PageHeader
          title="Medication Dispensing Queue"
          subtitle="Click any patient row to review medicines, give exact quantities & auto-deduct stock"
          icon="💊"
        />

        <div className="flex items-center gap-2">
          <Link
            to={`${basePath}/pharmacy`}
            className="flex items-center gap-2 px-3.5 py-2 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-xl text-xs font-bold transition-all shadow-xs"
          >
            <FaArrowLeft className="text-[11px]" />
            <span>Pharmacy Monitor</span>
          </Link>
          <Link
            to={`${basePath}/medicines`}
            className="flex items-center gap-2 px-3.5 py-2 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-xl text-xs font-bold transition-all shadow-xs"
          >
            <FaPills className="text-[11px] text-health-blue" />
            <span>Full Catalog</span>
          </Link>
        </div>
      </div>

      {/* ── KPI Summary Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="admin-card p-4 flex items-center gap-3.5 border-l-4 border-amber-500">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-500 text-lg">
            <FaClock />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Pending Patients</p>
            <p className="text-xl font-black text-slate-800">{kpis.pendingCount}</p>
          </div>
        </div>

        <div className="admin-card p-4 flex items-center gap-3.5 border-l-4 border-emerald-500">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-500 text-lg">
            <FaClipboardCheck />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Completed</p>
            <p className="text-xl font-black text-slate-800">{kpis.dispensedCount}</p>
          </div>
        </div>

        <div className="admin-card p-4 flex items-center gap-3.5 border-l-4 border-rose-500">
          <div className="w-10 h-10 rounded-xl bg-rose-500/10 flex items-center justify-center text-rose-500 text-lg">
            <FaExclamationTriangle />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Stock Shortages</p>
            <p className="text-xl font-black text-slate-800">{kpis.lowStockCount}</p>
          </div>
        </div>

        <div className="admin-card p-4 flex items-center gap-3.5 border-l-4 border-cyan-500">
          <div className="w-10 h-10 rounded-xl bg-cyan-500/10 flex items-center justify-center text-cyan-600 text-lg">
            <FaHospitalUser />
          </div>
          <div>
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Total Patients</p>
            <p className="text-xl font-black text-slate-800">{kpis.totalPatients}</p>
          </div>
        </div>
      </div>

      {/* ── Search and Filter Controls ── */}
      <div className="admin-card p-4 flex flex-col md:flex-row items-center justify-between gap-4">
        <div className="relative flex-1 w-full">
          <FaSearch className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-xs" />
          <input
            type="text"
            placeholder="Search by Patient Name, CIN, Token #, or Medicine..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:outline-none focus:border-health-blue transition-all"
          />
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto overflow-x-auto pb-1 md:pb-0">
          {[
            { id: "all", label: "All Patients", count: kpis.totalEncounters },
            { id: "pending", label: "Pending Dispense", count: kpis.pendingCount },
            { id: "dispensed", label: "Completed", count: kpis.dispensedCount },
          ].map((tab) => {
            const active = statusFilter === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setStatusFilter(tab.id)}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold transition-all shrink-0 flex items-center gap-1.5 border ${
                  active
                    ? "bg-[#03045e] text-white border-[#03045e] shadow-sm"
                    : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                }`}
              >
                <span>{tab.label}</span>
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600 font-bold"}`}>
                  {tab.count}
                </span>
              </button>
            );
          })}

          <button
            onClick={fetchQueue}
            title="Refresh Queue"
            disabled={loading}
            className="p-2.5 rounded-xl border border-slate-200 bg-white text-slate-500 hover:text-slate-800 hover:bg-slate-50 transition-colors shadow-xs shrink-0"
          >
            <FaSync className={`text-xs ${loading ? "animate-spin text-health-blue" : ""}`} />
          </button>
        </div>
      </div>

      {/* ── Patient List (Clean Row Lines + Expandable Details) ── */}
      {loading ? (
        <div className="admin-card p-12 text-center text-slate-400">
          <FaSpinner className="animate-spin text-2xl mx-auto mb-2 text-health-blue" />
          <p className="text-xs font-bold">Loading dispensing queue...</p>
        </div>
      ) : encounters.length === 0 ? (
        <div className="admin-card p-12 text-center text-slate-400">
          <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-3 text-lg">
            <FaPrescriptionBottleAlt />
          </div>
          <p className="text-sm font-bold text-slate-600">No prescriptions found</p>
          <p className="text-xs text-slate-400 mt-1">
            {search ? "No matching patients found for your search." : "When doctors prescribe medicines in consultation, patients will appear in this list."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {encounters.map((enc) => {
            const patient = enc.patientId;
            const patientDisplayName = patient?.name || "Patient";
            const patientCin = patient?.cin || "N/A";
            const prescriptions = enc.consultation?.prescriptions || [];
            const isExpanded = expandedEncounterId === enc._id;
            const hasPending = enc.dispenseSummary?.hasPending;
            const isAllDispensed = enc.dispenseSummary?.allDispensed;

            return (
              <div
                key={enc._id}
                className={`admin-card rounded-2xl overflow-hidden border transition-all ${
                  isExpanded ? "ring-2 ring-health-blue/30 border-health-blue shadow-md" : "border-slate-200/90 hover:border-slate-300"
                }`}
              >
                {/* ── Patient Header Row Line (Click to expand) ── */}
                <div
                  onClick={() => toggleExpand(enc._id)}
                  className={`px-5 py-3.5 flex flex-wrap items-center justify-between gap-3 cursor-pointer select-none transition-colors ${
                    isExpanded ? "bg-blue-50/40" : "hover:bg-slate-50/70"
                  }`}
                >
                  <div className="flex items-center gap-4 flex-wrap">
                    {/* Token Badge */}
                    <div className="px-3 py-1 bg-[#03045e] text-white rounded-lg text-center shadow-xs flex items-center gap-1.5">
                      <span className="text-[10px] uppercase font-black tracking-widest text-cyan-200">Token</span>
                      <span className="text-sm font-black">{enc.tokenNumber || "—"}</span>
                    </div>

                    {/* Patient Name & CIN */}
                    <div className="flex items-center gap-2">
                      <span className="font-extrabold text-slate-800 text-sm sm:text-base">{patientDisplayName}</span>
                      <span className="px-2 py-0.5 bg-slate-100 text-slate-600 text-[11px] font-mono font-bold rounded-md border border-slate-200">
                        CIN: {patientCin}
                      </span>
                    </div>

                    {/* Medicines Summary Pill Tags */}
                    <div className="hidden sm:flex items-center gap-1.5 flex-wrap">
                      {prescriptions.map((p, idx) => (
                        <span
                          key={idx}
                          className={`px-2.5 py-0.5 rounded-lg text-xs font-bold flex items-center gap-1 border ${
                            p.dispensed
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : p.dispensedQuantity > 0
                              ? "bg-amber-50 text-amber-800 border-amber-200"
                              : "bg-slate-100 text-slate-700 border-slate-200"
                          }`}
                        >
                          <span>{p.drug_name}</span>
                          <span className="text-[10px] opacity-75">
                            ({p.dispensedQuantity > 0 ? `${p.dispensedQuantity}/${p.quantity}` : `×${p.quantity}`})
                          </span>
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Right side: Status & Expand Chevron */}
                  <div className="flex items-center gap-3">
                    {isAllDispensed ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-700">
                        <FaCheckCircle className="text-emerald-500 text-[11px]" />
                        <span>All Given</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800">
                        <FaClock className="text-amber-600 text-[11px]" />
                        <span>{enc.dispenseSummary?.totalRemainingQty} units pending</span>
                      </span>
                    )}

                    <div className="w-7 h-7 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center text-xs">
                      {isExpanded ? <FaChevronUp /> : <FaChevronDown />}
                    </div>
                  </div>
                </div>

                {/* ── Expanded Medicines Side-by-Side Grid ── */}
                {isExpanded && (
                  <div className="p-5 border-t border-slate-100 bg-slate-50/50 space-y-4 animate-fade-in">
                    
                    {/* Context info bar */}
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 px-1">
                      <div>
                        <span>Diagnosis: <strong className="text-slate-700">{enc.consultation?.confirmedDiagnosis || enc.triageData?.aiPrediction?.label || "General Consultation"}</strong></span>
                        {enc.consultation?.clinicalNotes && (
                          <span className="ml-2 italic">"{enc.consultation.clinicalNotes}"</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {hasPending && (
                          <button
                            disabled={actionLoading === `dispenseAll-${enc._id}`}
                            onClick={() => handleDispenseAll(enc._id, patientDisplayName, enc.tokenNumber)}
                            className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-xs flex items-center gap-1.5 transition-all disabled:opacity-50"
                          >
                            {actionLoading === `dispenseAll-${enc._id}` ? <FaSpinner className="animate-spin text-xs" /> : <FaClipboardCheck className="text-xs" />}
                            <span>Dispense All Remaining</span>
                          </button>
                        )}
                        <button
                          onClick={() => setAddingToEncounterId((prev) => (prev === enc._id ? null : enc._id))}
                          className="px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-bold flex items-center gap-1 transition-colors"
                        >
                          <FaPlus className="text-[10px] text-health-blue" />
                          <span>Add Medicine</span>
                        </button>
                      </div>
                    </div>

                    {/* Inline Add Medicine Form */}
                    {addingToEncounterId === enc._id && (
                      <div className="p-4 bg-white rounded-xl border border-health-blue shadow-xs flex flex-wrap items-center gap-3">
                        <input
                          type="text"
                          placeholder="Medicine Name (e.g. NOSPASM)"
                          value={newDrugForm.drug_name}
                          onChange={(e) => setNewDrugForm({ ...newDrugForm, drug_name: e.target.value })}
                          className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg font-bold uppercase focus:outline-none focus:border-health-blue w-44"
                        />
                        <input
                          type="text"
                          placeholder="Strength (e.g. 80mg)"
                          value={newDrugForm.strength}
                          onChange={(e) => setNewDrugForm({ ...newDrugForm, strength: e.target.value })}
                          className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg font-mono text-xs focus:outline-none focus:border-health-blue w-28"
                        />
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] font-bold text-slate-400">Qty:</span>
                          <input
                            type="number"
                            min="1"
                            value={newDrugForm.quantity}
                            onChange={(e) => setNewDrugForm({ ...newDrugForm, quantity: e.target.value })}
                            className="w-16 px-2 py-1.5 text-xs border border-slate-200 rounded-lg font-bold focus:outline-none focus:border-health-blue"
                          />
                        </div>
                        <input
                          type="text"
                          placeholder="Dosage Instructions..."
                          value={newDrugForm.instructions}
                          onChange={(e) => setNewDrugForm({ ...newDrugForm, instructions: e.target.value })}
                          className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg focus:outline-none focus:border-health-blue flex-1 min-w-[160px]"
                        />
                        <button
                          disabled={savingNewDrug}
                          onClick={() => saveNewDrug(enc._id)}
                          className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shadow-xs transition-colors flex items-center gap-1"
                        >
                          {savingNewDrug ? <FaSpinner className="animate-spin text-xs" /> : <FaCheck className="text-xs" />}
                          <span>Save</span>
                        </button>
                        <button
                          onClick={() => setAddingToEncounterId(null)}
                          className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-xs font-bold transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    )}

                    {/* ── Medicines Cards Beside Each Other (Responsive Grid) ── */}
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
                      {prescriptions.map((item) => {
                        const isEditingThis = editingItemId === item._id;
                        const isItemLoading = actionLoading === `dispense-${item._id}`;
                        const isDeleteLoading = actionLoading === `delete-${item._id}`;
                        const totalPrescribed = item.quantity || 1;
                        const given = item.dispensedQuantity || 0;
                        const remaining = item.remainingQuantity !== undefined ? item.remainingQuantity : (item.dispensed ? 0 : totalPrescribed);
                        const isFullyGiven = remaining === 0;
                        const availStock = item.availableStock || 0;

                        // Default input quantity is remaining
                        const customGiveQty = dispenseQtyInputs[item._id] !== undefined
                          ? dispenseQtyInputs[item._id]
                          : remaining;

                        return (
                          <div
                            key={item._id}
                            className={`bg-white rounded-xl p-4 border transition-all flex flex-col justify-between gap-3 shadow-xs ${
                              isFullyGiven
                                ? "border-emerald-200/70 bg-emerald-50/20"
                                : remaining < totalPrescribed
                                ? "border-amber-200 bg-amber-50/10"
                                : "border-slate-200"
                            }`}
                          >
                            {/* Medicine Title & Quick Actions (Edit/Delete) */}
                            <div>
                              {isEditingThis ? (
                                <div className="space-y-2 pb-2 border-b border-slate-100">
                                  <input
                                    type="text"
                                    value={editItemForm.drug_name}
                                    onChange={(e) => setEditItemForm({ ...editItemForm, drug_name: e.target.value })}
                                    className="w-full px-2 py-1 text-xs border border-health-blue rounded font-bold uppercase"
                                    placeholder="Drug Name"
                                  />
                                  <div className="flex items-center gap-2">
                                    <input
                                      type="text"
                                      value={editItemForm.strength}
                                      onChange={(e) => setEditItemForm({ ...editItemForm, strength: e.target.value })}
                                      className="w-24 px-2 py-1 text-xs border border-health-blue rounded font-mono"
                                      placeholder="Strength"
                                    />
                                    <input
                                      type="number"
                                      min="1"
                                      value={editItemForm.quantity}
                                      onChange={(e) => setEditItemForm({ ...editItemForm, quantity: e.target.value })}
                                      className="w-20 px-2 py-1 text-xs border border-health-blue rounded font-bold"
                                      placeholder="Total Qty"
                                    />
                                  </div>
                                  <input
                                    type="text"
                                    value={editItemForm.instructions}
                                    onChange={(e) => setEditItemForm({ ...editItemForm, instructions: e.target.value })}
                                    className="w-full px-2 py-1 text-xs border border-health-blue rounded"
                                    placeholder="Instructions"
                                  />
                                  <div className="flex items-center gap-2 pt-1">
                                    <button
                                      disabled={savingEdit}
                                      onClick={() => saveEditItem(enc._id, item._id)}
                                      className="px-2.5 py-1 bg-emerald-500 text-white rounded text-xs font-bold flex items-center gap-1"
                                    >
                                      {savingEdit ? <FaSpinner className="animate-spin text-xs" /> : <FaCheck className="text-xs" />} Save
                                    </button>
                                    <button
                                      onClick={cancelEditItem}
                                      className="px-2.5 py-1 bg-slate-100 text-slate-600 rounded text-xs font-bold"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div>
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="flex items-center gap-2">
                                      <div className="w-7 h-7 rounded-lg bg-blue-50 text-health-blue flex items-center justify-center shrink-0">
                                        <FaPills className="text-xs" />
                                      </div>
                                      <div>
                                        <h5 className="font-extrabold text-slate-800 text-sm leading-tight">{item.drug_name}</h5>
                                        <span className="text-[10px] font-mono font-bold text-slate-500">{item.strength || "N/A"}</span>
                                      </div>
                                    </div>

                                    {/* Edit / Delete Row Buttons */}
                                    <div className="flex items-center gap-1">
                                      <button
                                        onClick={() => startEditItem(item)}
                                        title="Edit Medicine / Prescribed Quantity"
                                        className="w-6 h-6 rounded-md bg-slate-100 hover:bg-blue-50 hover:text-health-blue text-slate-400 flex items-center justify-center transition-colors"
                                      >
                                        <FaEdit className="text-[10px]" />
                                      </button>
                                      <button
                                        disabled={isDeleteLoading}
                                        onClick={() => deleteItem(enc._id, item._id, item.drug_name)}
                                        title="Delete Medicine"
                                        className="w-6 h-6 rounded-md bg-slate-100 hover:bg-red-50 hover:text-red-500 text-slate-400 flex items-center justify-center transition-colors disabled:opacity-50"
                                      >
                                        {isDeleteLoading ? <FaSpinner className="animate-spin text-[10px]" /> : <FaTrash className="text-[10px]" />}
                                      </button>
                                    </div>
                                  </div>

                                  {item.instructions && (
                                    <p className="text-[11px] text-slate-500 italic mt-1.5 pl-9">
                                      "{item.instructions}"
                                    </p>
                                  )}
                                </div>
                              )}

                              {/* Quantity Breakdown & Progress */}
                              <div className="mt-3 pt-2.5 border-t border-slate-100 space-y-2">
                                <div className="flex items-center justify-between text-xs">
                                  <span className="text-slate-500 font-medium">Prescribed by Doctor:</span>
                                  <span className="font-bold text-slate-800">{totalPrescribed} units</span>
                                </div>

                                <div className="flex items-center justify-between text-xs">
                                  <span className="text-slate-500 font-medium">Already Given:</span>
                                  <span className="font-bold text-emerald-600">{given} units</span>
                                </div>

                                <div className="flex items-center justify-between text-xs">
                                  <span className="text-slate-500 font-medium">Remaining to Give:</span>
                                  <span className={`font-black ${remaining > 0 ? "text-amber-700" : "text-slate-400"}`}>
                                    {remaining} units
                                  </span>
                                </div>

                                {/* Stock status badge */}
                                <div className="flex items-center justify-between text-[11px] pt-1">
                                  <span className="text-slate-400 font-medium">Stock in Pharmacy:</span>
                                  {availStock >= remaining ? (
                                    <span className="text-emerald-700 font-bold flex items-center gap-1">
                                      <FaCheckCircle className="text-[10px]" /> {availStock} in stock
                                    </span>
                                  ) : availStock > 0 ? (
                                    <span className="text-amber-700 font-bold flex items-center gap-1">
                                      <FaExclamationTriangle className="text-[10px]" /> Low ({availStock} avail)
                                    </span>
                                  ) : (
                                    <span className="text-red-600 font-bold flex items-center gap-1">
                                      <FaTimesCircle className="text-[10px]" /> 0 avail
                                    </span>
                                  )}
                                </div>
                              </div>
                            </div>

                            {/* ── Give / Dispense Action Section ── */}
                            <div className="mt-2 pt-2.5 border-t border-slate-100">
                              {isFullyGiven ? (
                                <div className="w-full py-2 bg-emerald-100/70 text-emerald-800 rounded-xl text-xs font-bold text-center flex items-center justify-center gap-1.5">
                                  <FaCheckCircle className="text-emerald-600" />
                                  <span>Complete ({totalPrescribed}/{totalPrescribed} Given)</span>
                                </div>
                              ) : (
                                <div className="space-y-2">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-[11px] font-bold text-slate-500">Give Now:</span>
                                    <div className="flex items-center gap-1">
                                      <button
                                        onClick={() => {
                                          const cur = parseInt(customGiveQty, 10) || 1;
                                          if (cur > 1) {
                                            setDispenseQtyInputs((prev) => ({ ...prev, [item._id]: cur - 1 }));
                                          }
                                        }}
                                        className="w-6 h-6 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs flex items-center justify-center transition-colors"
                                      >
                                        −
                                      </button>
                                      <input
                                        type="number"
                                        min="1"
                                        max={remaining}
                                        value={customGiveQty}
                                        onChange={(e) => {
                                          const val = Math.min(remaining, Math.max(1, parseInt(e.target.value, 10) || 1));
                                          setDispenseQtyInputs((prev) => ({ ...prev, [item._id]: val }));
                                        }}
                                        className="w-12 text-center py-1 bg-slate-50 border border-slate-200 rounded font-bold text-xs focus:outline-none focus:border-health-blue"
                                      />
                                      <button
                                        onClick={() => {
                                          const cur = parseInt(customGiveQty, 10) || 1;
                                          if (cur < remaining) {
                                            setDispenseQtyInputs((prev) => ({ ...prev, [item._id]: cur + 1 }));
                                          }
                                        }}
                                        className="w-6 h-6 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs flex items-center justify-center transition-colors"
                                      >
                                        +
                                      </button>
                                    </div>
                                  </div>

                                  <button
                                    disabled={isItemLoading}
                                    onClick={() => handleDispenseItem(enc._id, item, patientDisplayName, enc.tokenNumber)}
                                    className="w-full py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-xl text-xs font-extrabold shadow-xs hover:shadow transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 active:scale-[0.98]"
                                  >
                                    {isItemLoading ? <FaSpinner className="animate-spin text-xs" /> : <FaCheck className="text-xs" />}
                                    <span>
                                      Give {customGiveQty} {customGiveQty === 1 ? "unit" : "units"} & Deduct Stock
                                    </span>
                                  </button>

                                  {customGiveQty < remaining && (
                                    <p className="text-[10px] text-amber-700 font-semibold text-center">
                                      ⚠️ {remaining - customGiveQty} unit(s) will stay pending in the list for later.
                                    </p>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
