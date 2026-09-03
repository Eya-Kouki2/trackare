import api from "../../api/axios";
import { useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import { FaEdit, FaPlus, FaTimes, FaTrash } from "react-icons/fa";
import { MALADIES, getMaladieLabel } from "../../constants/maladies";
import PageHeader from "../../components/admin/PageHeader";

const SEVERITY_OPTIONS = [
  { value: "low", label: "Low", badge: "badge-low", dot: "bg-emerald-400", bar: "#10b981" },
  { value: "moderate", label: "Moderate", badge: "badge-moderate", dot: "bg-amber-400", bar: "#f59e0b" },
  { value: "high", label: "High", badge: "badge-high", dot: "bg-orange-400", bar: "#f97316" },
  { value: "critical", label: "Critical", badge: "badge-critical", dot: "bg-red-500", bar: "#ef4444" },
];

const emptyForm = {
  placeCode: "",
  description: "",
  severity: "moderate",
  maladie: "",
  maxPatients: 1,
};

const getSeverityMeta = (severity) =>
  SEVERITY_OPTIONS.find((o) => o.value === severity) || SEVERITY_OPTIONS[1];

const DiseaseClasses = () => {
  const { user } = useOutletContext();
  const [classes, setClasses] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [errorMessage, setErrorMessage] = useState(null);

  const loadClasses = async () => {
    try {
      const response = await api.get("/api/disease-classes");
      setClasses(response.data.diseaseClasses);
    } catch (error) {
      console.error("Failed to load disease Rooms", error);
      if (error.response?.status === 503) {
        setErrorMessage(error.response.data.message);
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (user?.area) loadClasses();
    else setIsLoading(false);
  }, [user?.area]);

  const stats = useMemo(() => {
    const counts = { low: 0, moderate: 0, high: 0, critical: 0 };
    classes.forEach((item) => { counts[item.severity] = (counts[item.severity] || 0) + 1; });
    return counts;
  }, [classes]);

  const resetForm = () => { setForm(emptyForm); setEditingId(null); setShowForm(false); setErrorMessage(null); };
  const openCreateForm = () => { setForm(emptyForm); setEditingId(null); setShowForm(true); setErrorMessage(null); };
  const openEditForm = (item) => {
    setForm({ placeCode: item.placeCode ?? "", description: item.description || "", severity: item.severity, maladie: item.maladie || "", maxPatients: item.maxPatients || 1 });
    setEditingId(item._id); setShowForm(true); setErrorMessage(null);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setErrorMessage(null);
    if (!form.maladie) { setErrorMessage("Please choose a maladie."); return; }
    if (form.placeCode !== "" && (Number(form.placeCode) < 1 || Number(form.placeCode) > 200)) {
      setErrorMessage("Place code must be between 1 and 200."); return;
    }
    if (form.placeCode !== "") {
      const placeCode = Number(form.placeCode);
      if (classes.some((item) => Number(item.placeCode) === placeCode && item._id !== editingId)) {
        setErrorMessage(`Place code ${placeCode} is already in use.`); return;
      }
    }
    try {
      setIsSaving(true);
      const payload = { 
        ...form, 
        placeCode: form.placeCode === "" ? undefined : Number(form.placeCode),
        maxPatients: form.maxPatients ? Number(form.maxPatients) : 1
      };
      if (editingId) await api.put(`/api/disease-classes/${editingId}`, payload);
      else await api.post("/api/disease-classes", payload);
      await loadClasses();
      resetForm();
    } catch (error) {
      setErrorMessage(error.response?.status === 503 ? error.response.data.message : error.response?.data?.message || "Failed to save room.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this room?")) return;
    try {
      await api.delete(`/api/disease-classes/${id}`);
      setClasses((prev) => prev.filter((item) => item._id !== id));
      if (editingId === id) resetForm();
    } catch (error) {
      setErrorMessage(error.response?.data?.message || "Failed to delete room.");
    }
  };

  const adjustQueue = async (id, action) => {
    try {
      if (action === 'increment') await api.post(`/api/disease-classes/${id}/increment`);
      else if (action === 'decrement') await api.post(`/api/disease-classes/${id}/decrement`);
      else if (action === 'reset') await api.post(`/api/disease-classes/${id}/reset-queue`);
      await loadClasses();
      window.dispatchEvent(new Event("alerts-updated"));
    } catch (error) {
      setErrorMessage(error.response?.data?.message || `Failed to ${action} queue.`);
    }
  };

  if (!user?.area) {
    return (
      <div className="w-full">
        <PageHeader title="Disease Rooms" description="Monitor and manage disease rooms" />
        <div className="admin-card p-10 text-center">
          <p className="text-2xl mb-2">🦠</p>
          <p className="text-xs text-slate-500 font-medium">Complete clinic setup to manage disease Rooms.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full animate-fade-in">
      <PageHeader
        title="Disease Rooms"
        description={`Classifications for ${user.area.name}`}
        actions={
          <button type="button" onClick={openCreateForm} className="btn-primary">
            <FaPlus className="text-[10px]" /> Add room
          </button>
        }
      />

      {/* ── KPI bar ── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-6">
        <div className="admin-card px-4 py-4">
          <p className="section-header mb-1">Total</p>
          <p className="text-2xl font-bold text-health-navy">{classes.length}</p>
          <p className="text-[10px] text-slate-400 mt-0.5">disease rooms</p>
        </div>
        {SEVERITY_OPTIONS.map(({ value, label, dot }) => (
          <div key={value} className="admin-card px-4 py-4">
            <p className="section-header mb-1">{label}</p>
            <div className="flex items-center gap-2 mt-1">
              <span className={`w-2 h-2 rounded-full ${dot}`} />
              <p className="text-2xl font-bold text-health-navy">{stats[value] || 0}</p>
            </div>
          </div>
        ))}
      </div>

      {errorMessage && !showForm && (
        <div className="admin-card border-red-100 bg-red-50 p-4 mb-4">
          <p className="text-xs text-red-600 font-medium">{errorMessage}</p>
        </div>
      )}

      {/* ── Form panel ── */}
      {showForm && (
        <div className="admin-card p-5 sm:p-6 mb-6 border-health-blue/20">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-base font-bold text-health-navy">
                {editingId ? "Edit Room" : "New Room"}
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">Fill in the classification details below.</p>
            </div>
            <button type="button" onClick={resetForm} className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
              <FaTimes />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="auth-label" htmlFor="dc-code">Place code <span className="text-slate-400 normal-case font-normal">(optional, 1–200)</span></label>
              <input id="dc-code" type="number" min={1} max={200} value={form.placeCode} onChange={(e) => setForm((p) => ({ ...p, placeCode: e.target.value }))} placeholder="Auto-assigned if empty" className="auth-input" />
            </div>
            <div>
              <label className="auth-label" htmlFor="dc-max">Max Patients</label>
              <input id="dc-max" type="number" min={1} value={form.maxPatients} onChange={(e) => setForm((p) => ({ ...p, maxPatients: e.target.value }))} className="auth-input" />
            </div>
            <div>
              <label className="auth-label" htmlFor="dc-severity">Severity</label>
              <select id="dc-severity" value={form.severity} onChange={(e) => setForm((p) => ({ ...p, severity: e.target.value }))} className="auth-input">
                {SEVERITY_OPTIONS.map(({ value, label }) => (<option key={value} value={value}>{label}</option>))}
              </select>
            </div>
            <div>
              <label className="auth-label" htmlFor="dc-maladie">Sickness</label>
              <select id="dc-maladie" value={form.maladie} onChange={(e) => setForm((p) => ({ ...p, maladie: e.target.value }))} className="auth-input">
                <option value="">Choose a maladie</option>
                {MALADIES.map(({ value, label }) => (<option key={value} value={value}>{label}</option>))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="auth-label" htmlFor="dc-desc">Description</label>
              <textarea id="dc-desc" value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} placeholder="Brief notes about this classification..." rows={3} className="auth-input resize-none" />
            </div>
            {errorMessage && <p className="sm:col-span-2 text-xs text-red-500 font-medium">{errorMessage}</p>}
            <div className="sm:col-span-2 flex gap-2 pt-1">
              <button type="submit" disabled={isSaving} className="btn-primary">
                {isSaving ? "Saving…" : editingId ? "Update Room" : "Create Room"}
              </button>
              <button type="button" onClick={resetForm} className="btn-outline">Cancel</button>
            </div>
          </form>
        </div>
      )}

      {/* ── Class list ── */}
      {isLoading ? (
        <div className="admin-card p-10 text-center">
          <div className="w-6 h-6 border-2 border-health-blue border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          <p className="text-xs text-slate-400">Loading disease rooms</p>
        </div>
      ) : classes.length === 0 ? (
        <div className="admin-card p-12 text-center">
          <p className="text-4xl mb-3">🦠</p>
          <p className="text-sm font-bold text-health-navy">No disease rooms yet</p>
          <p className="text-xs text-slate-500 mt-1 mb-5">Create classifications to organize triage and monitoring workflows.</p>
          <button type="button" onClick={openCreateForm} className="btn-primary mx-auto">
            <FaPlus className="text-[10px]" /> Add your first room
          </button>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {classes.map((item) => {
            const sev = getSeverityMeta(item.severity);
            return (
              <div key={item._id} className="admin-card overflow-hidden flex flex-col hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-200">
                {/* Top strip for severity color */}
                <div className="h-1 w-full" style={{ background: sev.bar }} />

                <div className="p-5 flex-1 flex flex-col">
                  {/* Header: Title and Actions */}
                  <div className="flex items-start justify-between gap-3 mb-4">
                    <h3 className="text-base font-bold text-health-navy break-words leading-tight flex-1">
                      {getMaladieLabel(item.maladie)}
                      <span className="ml-2 text-xs font-semibold text-slate-400">Class {item.classNumber || 1}</span>
                    </h3>
                    <div className="flex items-center gap-1 shrink-0 bg-slate-50 rounded-lg p-0.5">
                      <button type="button" onClick={() => openEditForm(item)} className="w-7 h-7 rounded-md flex items-center justify-center text-slate-400 hover:text-health-blue hover:bg-white hover:shadow-sm transition-all" aria-label={`Edit Room ${item.placeCode}`}>
                        <FaEdit className="text-[11px]" />
                      </button>
                      <button type="button" onClick={() => handleDelete(item._id)} className="w-7 h-7 rounded-md flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-white hover:shadow-sm transition-all" aria-label={`Delete Room ${item.placeCode}`}>
                        <FaTrash className="text-[11px]" />
                      </button>
                    </div>
                  </div>

                  {/* Prominent Place Code & Severity */}
                  <div className="flex items-center justify-between bg-slate-50/80 rounded-xl p-3.5 border border-slate-100 mb-4">
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 mb-0.5">Room</p>
                      <code className="text-xl font-mono font-black text-health-blue">#{item.placeCode}</code>
                    </div>
                    <div className="text-right">
                      <span className={`inline-flex ${sev.badge} px-2.5 py-1 text-[11px] shadow-sm`}>{sev.label}</span>
                    </div>
                  </div>

                  {/* Details */}
                  {item.maladie && (
                    <p className="text-xs text-slate-600 mb-2.5 flex items-center gap-1.5 bg-slate-50/50 p-2 rounded-lg border border-slate-50">
                      <span className="w-2 h-2 rounded-full shadow-sm" style={{ background: sev.bar }} />
                      <span className="font-bold text-slate-800">Condition:</span>
                      <span className="font-bold" style={{ color: sev.bar }}>{getMaladieLabel(item.maladie)}</span>
                    </p>
                  )}
                  {item.maxPatients && (
                    <div className="mb-2.5">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-bold text-slate-500">Capacity</span>
                        <span className={`text-[10px] font-black ${
                          item.currentPatients >= item.maxPatients ? 'text-red-500' : 'text-health-blue'
                        }`}>
                          {item.currentPatients || 0} / {item.maxPatients}
                        </span>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            item.currentPatients >= item.maxPatients ? 'bg-red-400' :
                            item.currentPatients >= item.maxPatients * 0.75 ? 'bg-amber-400' : 'bg-emerald-400'
                          }`}
                          style={{ width: `${Math.min(((item.currentPatients || 0) / item.maxPatients) * 100, 100)}%` }}
                        />
                      </div>
                      {item.currentPatients >= item.maxPatients && (
                        <p className="text-[9px] text-red-500 font-bold mt-1">⚠ Room at full capacity</p>
                      )}
                    </div>
                  )}
                  {item.description && (
                    <p className="text-xs text-slate-500 leading-relaxed flex-1 mb-3">{item.description}</p>
                  )}

                  {/* Kiosk Queue Controls */}
                  <div className="mt-auto pt-3 border-t border-slate-100 flex items-center justify-between">
                    <div className="flex flex-col">
                      <span className="text-[9px] font-bold uppercase text-slate-400">Waiting Queue (Kiosk)</span>
                      <span className="text-[13px] font-black text-health-navy">{item.currentPatients || 0} patients</span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button type="button" onClick={() => adjustQueue(item._id, 'decrement')} disabled={!item.currentPatients || item.currentPatients === 0} className="w-7 h-7 rounded-md bg-slate-100 text-slate-500 flex items-center justify-center hover:bg-slate-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed" title="Decrease Queue">
                        <span className="text-lg font-bold leading-none -mt-1">-</span>
                      </button>
                      <button type="button" onClick={() => adjustQueue(item._id, 'increment')} disabled={(item.currentPatients || 0) >= (item.maxPatients || 1)} className="w-7 h-7 rounded-md bg-slate-100 text-slate-500 flex items-center justify-center hover:bg-slate-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed" title={(item.currentPatients || 0) >= (item.maxPatients || 1) ? 'Room at maximum capacity' : 'Increase Queue'}>
                        <span className="text-lg font-bold leading-none -mt-0.5">+</span>
                      </button>
                      <button type="button" onClick={() => adjustQueue(item._id, 'reset')} disabled={!item.currentPatients || item.currentPatients === 0} className="px-2 h-7 rounded-md bg-red-50 text-red-600 text-[9px] font-black tracking-wider hover:bg-red-100 transition-colors uppercase disabled:opacity-50 disabled:cursor-not-allowed" title="Reset to 0">
                        Reset
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default DiseaseClasses;
