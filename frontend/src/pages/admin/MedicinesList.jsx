import { useState, useEffect, useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import PageHeader from "../../components/admin/PageHeader";
import api from "../../api/axios";
import {
  FaSearch, FaPills, FaCalendarAlt, FaEdit,
  FaTrash, FaCheck, FaTimes, FaSpinner,
  FaCheckCircle, FaTimesCircle, FaExclamationTriangle,
  FaArrowLeft, FaFilter, FaPlus
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
  if (!status) return { color: "text-slate-500", bg: "bg-slate-50", border: "border-slate-200", bar: "bg-slate-400", icon: <FaExclamationTriangle className="text-slate-400" />, label: "Unknown" };
  if (status.includes("APPROVED")) return STATUS_META["APPROVED (IN STOCK)"];
  if (status.includes("INVALID") || status.includes("NO DATE")) return STATUS_META["REJECTED (INVALID/NO DATE)"];
  if (status.includes("EXPIRED")) return STATUS_META["REJECTED (EXPIRED)"];
  if (status.includes("MANUAL")) return { color: "text-amber-700", bg: "bg-amber-50", border: "border-amber-200", bar: "bg-amber-400", icon: <FaExclamationTriangle className="text-amber-500" />, label: "Review" };
  return { color: "text-slate-500", bg: "bg-slate-50", border: "border-slate-200", bar: "bg-slate-300", icon: <FaExclamationTriangle className="text-slate-400" />, label: "Unknown" };
};

export default function MedicinesList() {
  const location = useLocation();
  const isNurse = location.pathname.startsWith("/nurse");
  const basePath = isNurse ? "/nurse" : "/admin";

  const [inventory, setInventory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [error, setError] = useState(null);

  // Row Edit state
  const [editingStockId, setEditingStockId] = useState(null);
  const [stockEditForm, setStockEditForm] = useState({ drug_name: "", strength: "", quantity: 1, expiry_date: "" });
  const [savingStock, setSavingStock] = useState(false);

  // Group / Card Header Edit state
  const [editingGroupName, setEditingGroupName] = useState(null);
  const [groupNewName, setGroupNewName] = useState("");
  const [savingGroup, setSavingGroup] = useState(false);

  const fetchInventory = async () => {
    try {
      setLoading(true);
      const { data } = await api.get("/api/pharmacy");
      setInventory(data.medications || []);
    } catch (err) {
      console.error("Failed to load medicines:", err);
      setError("Failed to fetch medicines inventory.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInventory();
  }, []);

  // ── Row Edit / Delete Handlers ──
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

  // ── Group Header Handlers ──
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

  // ── Filter & Search Logic ──
  const filteredInventory = useMemo(() => {
    const q = search.trim().toLowerCase();
    return inventory.filter((item) => {
      const nameMatch = (item.drug_name || "").toLowerCase().includes(q);
      const strengthMatch = (item.strength || "").toLowerCase().includes(q);
      const expiryMatch = (item.expiry_date || "").toLowerCase().includes(q);
      const statusMatch = (item.inventory_status || "").toLowerCase().includes(q);

      const matchesSearch = !q || nameMatch || strengthMatch || expiryMatch || statusMatch;

      if (!matchesSearch) return false;

      if (statusFilter === "ALL") return true;
      if (statusFilter === "EXPIRED") {
        return (
          item.inventory_status?.includes("EXPIRED") ||
          item.inventory_status?.includes("INVALID") ||
          item.inventory_status?.includes("NO DATE")
        );
      }
      const meta = getMeta(item.inventory_status);
      return meta.label.toUpperCase() === statusFilter;
    });
  }, [inventory, search, statusFilter]);

  // Group filtered inventory by Drug Name
  const groupedInventory = useMemo(() => {
    return filteredInventory.reduce((acc, curr) => {
      const key = (curr.drug_name || "UNKNOWN").trim().toUpperCase();
      if (!acc[key]) acc[key] = [];
      acc[key].push(curr);
      return acc;
    }, {});
  }, [filteredInventory]);

  const totalMedicinesCount = Object.keys(
    inventory.reduce((acc, curr) => {
      const key = (curr.drug_name || "UNKNOWN").trim().toUpperCase();
      acc[key] = true;
      return acc;
    }, {})
  ).length;

  const totalUnitsCount = inventory.reduce((sum, item) => sum + (item.quantity || 1), 0);
  const approvedCount = inventory.filter((item) => item.inventory_status?.includes("APPROVED")).length;
  const expiredCount = inventory.filter((item) =>
    item.inventory_status?.includes("EXPIRED") ||
    item.inventory_status?.includes("INVALID") ||
    item.inventory_status?.includes("NO DATE")
  ).length;

  return (
    <div className="w-full animate-fade-in space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <PageHeader
          title="Medicines Directory"
          description="Complete pharmaceutical stock catalog with live search, batch management & editing"
        />
        <div className="flex items-center gap-3 self-start sm:self-auto">
          <Link
            to={`${basePath}/pharmacy`}
            className="flex items-center gap-2 px-4 py-2.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-xl text-xs font-bold shadow-sm transition-all"
          >
            <FaArrowLeft className="text-[10px]" /> Back to Scanner
          </Link>
        </div>
      </div>

      {/* ── KPI Summary Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Unique Medicines", value: totalMedicinesCount, icon: <FaPills />, color: "text-health-blue", bg: "bg-blue-50" },
          { label: "Total Units in Stock", value: totalUnitsCount, icon: <FaPills />, color: "text-indigo-600", bg: "bg-indigo-50" },
          { label: "Approved Batches", value: approvedCount, icon: <FaCheckCircle />, color: "text-emerald-600", bg: "bg-emerald-50" },
          { label: "Expired / Issues", value: expiredCount, icon: <FaTimesCircle />, color: "text-red-600", bg: "bg-red-50" },
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

      {/* ── Search Bar & Filter Controls ── */}
      <div className="admin-card p-4 rounded-2xl flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
        {/* Search Bar */}
        <div className="relative flex-1">
          <FaSearch className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 text-sm" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by drug name, strength (e.g. 500 MG), expiry (01/2030), or status..."
            className="w-full pl-10 pr-10 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:bg-white focus:outline-none focus:ring-2 focus:ring-health-blue/20 focus:border-health-blue transition-all"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400 hover:text-slate-600"
            >
              <FaTimes />
            </button>
          )}
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mr-1 flex items-center gap-1">
            <FaFilter className="text-[9px]" /> Status:
          </span>
          {["ALL", "APPROVED", "EXPIRED", "REVIEW"].map((f) => (
            <button
              key={f}
              onClick={() => setStatusFilter(f)}
              className={`text-xs px-3 py-1.5 rounded-lg font-bold transition-all ${
                statusFilter === f
                  ? "bg-gradient-to-r from-[#03045e] to-[#0096c7] text-white shadow-sm"
                  : "bg-white text-slate-600 hover:bg-slate-100 border border-slate-200"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-2xl text-xs font-bold text-red-700 flex items-center gap-2">
          <FaTimesCircle className="shrink-0 text-red-500 text-sm" />
          <span>{error}</span>
        </div>
      )}

      {/* ── Medicine Cards List ── */}
      {loading ? (
        <div className="admin-card py-20 flex flex-col items-center justify-center gap-3 text-slate-400">
          <FaSpinner className="text-3xl text-health-blue animate-spin" />
          <p className="text-sm font-semibold">Loading medicines inventory...</p>
        </div>
      ) : Object.keys(groupedInventory).length === 0 ? (
        <div className="admin-card py-20 flex flex-col items-center justify-center text-center p-6">
          <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-300 text-2xl mb-3">
            <FaSearch />
          </div>
          <h4 className="text-base font-bold text-slate-700">No medicines found</h4>
          <p className="text-xs text-slate-400 mt-1 max-w-sm">
            {search
              ? `No stock records match "${search}". Try checking for spelling or clear your search.`
              : "No medications currently in the database. Use the Pharmacy Scanner to scan and upload packages."}
          </p>
          {search && (
            <button
              onClick={() => { setSearch(""); setStatusFilter("ALL"); }}
              className="mt-4 px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-colors"
            >
              Clear Filters
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          {Object.entries(groupedInventory).map(([drugName, items]) => {
            const totalUnits = items.reduce((sum, item) => sum + (item.quantity || 1), 0);
            const isEditingGroup = editingGroupName === drugName;

            return (
              <div key={drugName} className="admin-card rounded-2xl overflow-hidden shadow-sm border border-slate-200/80">
                {/* Card Header with Unit Summary and Actions */}
                <div className="bg-slate-50 px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
                  <div className="flex items-center gap-2.5 flex-1">
                    {isEditingGroup ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={groupNewName}
                          onChange={(e) => setGroupNewName(e.target.value)}
                          className="px-3 py-1 text-sm border border-health-blue rounded-lg font-black uppercase focus:outline-none"
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
                        <span className="text-xs bg-health-blue text-white font-bold px-2.5 py-0.5 rounded-full shadow-sm">
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

                {/* Table of Batches */}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-white border-b border-slate-100">
                        <th className="text-left text-[10px] font-black uppercase tracking-widest text-slate-400 px-5 py-3">Strength</th>
                        <th className="text-left text-[10px] font-black uppercase tracking-widest text-slate-400 px-5 py-3">Quantity</th>
                        <th className="text-left text-[10px] font-black uppercase tracking-widest text-slate-400 px-5 py-3">Expiry</th>
                        <th className="text-left text-[10px] font-black uppercase tracking-widest text-slate-400 px-5 py-3">Status</th>
                        <th className="text-left text-[10px] font-black uppercase tracking-widest text-slate-400 px-5 py-3">Scanned On</th>
                        <th className="text-right text-[10px] font-black uppercase tracking-widest text-slate-400 px-5 py-3">Actions</th>
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
                          <tr key={item._id || idx} className="border-b border-slate-50 hover:bg-slate-50/80 transition-colors">
                            {/* Strength & Drug edit */}
                            <td className="px-5 py-3">
                              {isEditing ? (
                                <div className="space-y-1">
                                  <label className="text-[9px] font-bold text-slate-400 uppercase">Drug & Strength</label>
                                  <div className="flex items-center gap-1.5">
                                    <input
                                      type="text"
                                      value={stockEditForm.drug_name}
                                      onChange={(e) => setStockEditForm((f) => ({ ...f, drug_name: e.target.value }))}
                                      className="w-28 px-2 py-1 text-xs border border-health-blue rounded font-bold uppercase focus:outline-none"
                                    />
                                    <input
                                      type="text"
                                      value={stockEditForm.strength}
                                      onChange={(e) => setStockEditForm((f) => ({ ...f, strength: e.target.value }))}
                                      className="w-20 px-2 py-1 text-xs border border-health-blue rounded font-mono font-bold uppercase focus:outline-none"
                                    />
                                  </div>
                                </div>
                              ) : (
                                <span className="px-2 py-1 bg-slate-100 text-slate-600 rounded-md text-xs font-mono font-bold">{item.strength}</span>
                              )}
                            </td>

                            {/* Quantity */}
                            <td className="px-5 py-3">
                              {isEditing ? (
                                <div className="space-y-1">
                                  <label className="text-[9px] font-bold text-slate-400 uppercase">Qty</label>
                                  <input
                                    type="number"
                                    min="0"
                                    value={stockEditForm.quantity}
                                    onChange={(e) => setStockEditForm((f) => ({ ...f, quantity: parseInt(e.target.value, 10) || 0 }))}
                                    className="w-16 px-2 py-1 text-xs border border-health-blue rounded font-bold focus:outline-none block"
                                  />
                                </div>
                              ) : (
                                <div className="flex items-center gap-1">
                                  <button onClick={() => updateStockQtyDirect(item, -1)} className="w-5 h-5 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center text-[10px] font-bold transition-colors">−</button>
                                  <span className="px-2 py-0.5 bg-health-blue/10 text-health-blue rounded-md text-xs font-bold min-w-[24px] text-center">{item.quantity || 1}</span>
                                  <button onClick={() => updateStockQtyDirect(item, 1)} className="w-5 h-5 rounded bg-slate-100 hover:bg-slate-200 text-slate-600 flex items-center justify-center text-[10px] font-bold transition-colors">+</button>
                                </div>
                              )}
                            </td>

                            {/* Expiry */}
                            <td className="px-5 py-3">
                              {isEditing ? (
                                <div className="space-y-1">
                                  <label className="text-[9px] font-bold text-slate-400 uppercase">Expiry</label>
                                  <input
                                    type="text"
                                    value={stockEditForm.expiry_date}
                                    onChange={(e) => setStockEditForm((f) => ({ ...f, expiry_date: e.target.value }))}
                                    placeholder="MM/YYYY"
                                    className="w-24 px-2 py-1 text-xs border border-health-blue rounded font-bold focus:outline-none block"
                                  />
                                </div>
                              ) : (
                                <div className="flex items-center gap-1.5">
                                  <FaCalendarAlt className={`text-[11px] ${isExpired ? "text-red-400" : "text-slate-400"}`} />
                                  <span className={`text-xs font-bold ${isExpired ? "text-red-600" : "text-slate-600"}`}>{item.expiry_date}</span>
                                </div>
                              )}
                            </td>

                            {/* Status */}
                            <td className="px-5 py-3">
                              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[10px] font-bold border ${meta.color} ${meta.bg} ${meta.border}`}>
                                {meta.icon}
                                {isReview ? "Review" : meta.label}
                              </span>
                            </td>

                            {/* Scanned Date */}
                            <td className="px-5 py-3">
                              <span className="text-[11px] text-slate-400 font-medium">
                                {scanDate ? new Date(scanDate).toLocaleDateString() : new Date().toLocaleDateString()}
                              </span>
                            </td>

                            {/* Actions */}
                            <td className="px-5 py-3 text-right">
                              {isEditing ? (
                                <div className="flex items-center justify-end gap-1.5">
                                  <button
                                    disabled={savingStock}
                                    onClick={() => saveEditStock(item._id)}
                                    title="Save Changes"
                                    className="w-7 h-7 rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 flex items-center justify-center transition-colors shadow-sm disabled:opacity-50"
                                  >
                                    {savingStock ? <FaSpinner className="animate-spin text-xs" /> : <FaCheck className="text-xs" />}
                                  </button>
                                  <button
                                    onClick={cancelEditStock}
                                    title="Cancel"
                                    className="w-7 h-7 rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200 flex items-center justify-center transition-colors"
                                  >
                                    <FaTimes className="text-xs" />
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center justify-end gap-1.5">
                                  <button
                                    onClick={() => startEditStock(item)}
                                    title="Edit Medicine"
                                    className="w-7 h-7 rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 flex items-center justify-center transition-colors"
                                  >
                                    <FaEdit className="text-xs" />
                                  </button>
                                  <button
                                    onClick={() => deleteStock(item._id, item.drug_name)}
                                    title="Delete Medicine"
                                    className="w-7 h-7 rounded-lg bg-red-50 text-red-500 hover:bg-red-100 flex items-center justify-center transition-colors"
                                  >
                                    <FaTrash className="text-xs" />
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
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
