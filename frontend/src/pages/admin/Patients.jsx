import api from "../../api/axios";
import { useEffect, useState, useCallback } from "react";
import { useOutletContext, useNavigate } from "react-router-dom";
import { FaEdit, FaPlus, FaTimes, FaTrash } from "react-icons/fa";
import PageHeader from "../../components/admin/PageHeader";
import VisitHistoryList from "../../components/admin/VisitHistoryList";

const GENDER_LABELS = { male: "Male", female: "Female", other: "Other" };

const HISTORY_TYPES = [
  { value: "visit", label: "Visit" },
  { value: "diagnosis", label: "Diagnosis" },
  { value: "treatment", label: "Treatment" },
  { value: "note", label: "Note" },
];

const emptyPatientEditForm = {
  cin: "",
  name: "",
  dateOfBirth: "",
  gender: "",
  phone: "",
  bloodType: "",
  address: "",
};

const emptyVitals = {
  temperature: "",
  pulse: "",
  bloodPressure: "",
  weight: "",
  height: "",
};

const emptyForm = {
  cin: "",
  name: "",
  dateOfBirth: "",
  gender: "",
  phone: "",
  bloodType: "",
  address: "",
  initialNote: "",
};

const emptyHistoryForm = {
  type: "visit",
  title: "",
  notes: "",
  date: "",
};

const formatDate = (date) => {
  if (!date) return "—";
  return new Date(date).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
};

const toInputDate = (date) => {
  if (!date) return "";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().split("T")[0];
};

const toDateTimeLocal = (date) => {
  if (!date) return "";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const patientToEditForm = (patient) => ({
  cin: patient.cin || "",
  name: patient.name || "",
  dateOfBirth: toInputDate(patient.dateOfBirth),
  gender: patient.gender || "",
  phone: patient.phone || "",
  bloodType: patient.bloodType || "",
  address: patient.address || "",
});

const historyEntryToEditForm = (entry) => {
  const hasVitals = Object.values(entry.triage?.vitals || {}).some(v => v && v.trim() !== '');
  const hasTriage = Boolean(
    entry.triage?.symptoms?.length ||
    entry.triage?.predictions?.length ||
    hasVitals
  );
  return {
    _id: entry._id,
    isTriage: hasTriage,
    type: entry.type || "visit",
    title: entry.title || "",
    notes: entry.notes || "",
    date: hasTriage ? toDateTimeLocal(entry.date) : toInputDate(entry.date),
    symptomsText: (entry.triage?.symptoms || []).join(", "),
    duration: entry.triage?.duration || "",
    additionalNotes: entry.triage?.additionalNotes || "",
    vitals: {
      temperature: entry.triage?.vitals?.temperature || "",
      pulse: entry.triage?.vitals?.pulse || "",
      bloodPressure: entry.triage?.vitals?.bloodPressure || "",
      weight: entry.triage?.vitals?.weight || "",
      height: entry.triage?.vitals?.height || "",
    },
    predictions: entry.triage?.predictions || [],
    priority: entry.triage?.priority || "",
    suggestedClass: entry.triage?.suggestedClass || null,
  };
};

const calcAge = (dateOfBirth) => {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;
  const diff = Date.now() - dob.getTime();
  return Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000));
};

const Patients = () => {
  const { user } = useOutletContext();
  const navigate = useNavigate();
  const [patients, setPatients] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState(null);

  const [selectedPatient, setSelectedPatient] = useState(null);
  const [isLoadingPatient, setIsLoadingPatient] = useState(false);
  const [historyForm, setHistoryForm] = useState(emptyHistoryForm);
  const [isAddingHistory, setIsAddingHistory] = useState(false);
  const [historyError, setHistoryError] = useState(null);
  const [isEditPatient, setIsEditPatient] = useState(false);
  const [patientEditForm, setPatientEditForm] = useState(emptyPatientEditForm);
  const [isUpdatingPatient, setIsUpdatingPatient] = useState(false);
  const [isDeletingPatient, setIsDeletingPatient] = useState(false);
  const [patientToDelete, setPatientToDelete] = useState(null);
  const [deleteError, setDeleteError] = useState(null);
  const [historyEditForm, setHistoryEditForm] = useState(null);
  const [isUpdatingHistory, setIsUpdatingHistory] = useState(false);

  const loadPatients = async () => {
    try {
      const response = await api.get("/api/patients");
      setPatients(response.data.patients);
    } catch (error) {
      console.error("Failed to load patients", error);
      setErrorMessage(error.response?.data?.message || "Failed to load patients.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (user?.area) loadPatients();
    else setIsLoading(false);
  }, [user?.area]);

  const openPatientHistory = async (patientId) => {
    setIsLoadingPatient(true);
    setSelectedPatient(null);
    setIsEditPatient(false);
    setHistoryEditForm(null);
    setHistoryForm(emptyHistoryForm);
    setHistoryError(null);
    try {
      const response = await api.get(`/api/patients/${patientId}`);
      setSelectedPatient(response.data.patient);
    } catch (error) {
      setErrorMessage(error.response?.data?.message || "Failed to load patient history.");
    } finally {
      setIsLoadingPatient(false);
    }
  };

  const openEditPatient = async (patientId, event) => {
    event?.stopPropagation();
    setIsLoadingPatient(true);
    setSelectedPatient(null);
    setIsEditPatient(true);
    setHistoryEditForm(null);
    setHistoryError(null);
    try {
      const response = await api.get(`/api/patients/${patientId}`);
      const patient = response.data.patient;
      setSelectedPatient(patient);
      setPatientEditForm(patientToEditForm(patient));
    } catch (error) {
      setErrorMessage(error.response?.data?.message || "Failed to load patient.");
    } finally {
      setIsLoadingPatient(false);
    }
  };

  const closeModal = () => {
    setSelectedPatient(null);
    setIsLoadingPatient(false);
    setIsEditPatient(false);
    setPatientEditForm(emptyPatientEditForm);
    setHistoryEditForm(null);
    setHistoryForm(emptyHistoryForm);
    setHistoryError(null);
  };

  const handleUpdatePatient = async (event) => {
    event.preventDefault();
    if (!selectedPatient) return;
    setHistoryError(null);

    if (!patientEditForm.cin.trim() || !patientEditForm.name.trim()) {
      setHistoryError("CIN and name are required.");
      return;
    }

    try {
      setIsUpdatingPatient(true);
      const response = await api.put(`/api/patients/${selectedPatient._id}`, patientEditForm);
      setSelectedPatient(response.data.patient);
      setIsEditPatient(false);
      await loadPatients();
    } catch (error) {
      setHistoryError(error.response?.data?.message || "Failed to update patient.");
    } finally {
      setIsUpdatingPatient(false);
    }
  };

  const requestDeletePatient = (patient, event) => {
    event?.stopPropagation();
    setDeleteError(null);
    setPatientToDelete({
      _id: patient._id,
      name: patient.name,
      cin: patient.cin,
    });
  };

  const cancelDeletePatient = useCallback(() => {
    if (isDeletingPatient) return;
    setPatientToDelete(null);
    setDeleteError(null);
  }, [isDeletingPatient]);

  const confirmDeletePatient = async () => {
    if (!patientToDelete) return;

    try {
      setIsDeletingPatient(true);
      setDeleteError(null);
      await api.delete(`/api/patients/${patientToDelete._id}`);
      if (selectedPatient?._id === patientToDelete._id) closeModal();
      setPatientToDelete(null);
      await loadPatients();
    } catch (error) {
      setDeleteError(error.response?.data?.message || "Failed to delete patient.");
    } finally {
      setIsDeletingPatient(false);
    }
  };

  const startEditHistory = (entry) => {
    setHistoryEditForm(historyEntryToEditForm(entry));
    setHistoryError(null);
  };

  const cancelEditHistory = () => {
    setHistoryEditForm(null);
    setHistoryError(null);
  };

  const handleUpdateHistory = async (event) => {
    event.preventDefault();
    if (!selectedPatient || !historyEditForm) return;
    setHistoryError(null);

    if (!historyEditForm.title.trim()) {
      setHistoryError("Title is required.");
      return;
    }

    const payload = {
      type: historyEditForm.type,
      title: historyEditForm.title,
      notes: historyEditForm.notes,
      date: historyEditForm.date,
    };

    if (historyEditForm.isTriage) {
      payload.triage = {
        vitals: historyEditForm.vitals,
        symptoms: historyEditForm.symptomsText
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        duration: historyEditForm.duration,
        additionalNotes: historyEditForm.additionalNotes,
        predictions: historyEditForm.predictions,
        priority: historyEditForm.priority,
        suggestedClass: historyEditForm.suggestedClass || undefined,
      };
    }

    try {
      setIsUpdatingHistory(true);
      const response = await api.put(
        `/api/patients/${selectedPatient._id}/history/${historyEditForm._id}`,
        payload
      );
      setSelectedPatient(response.data.patient);
      setHistoryEditForm(null);
      await loadPatients();
    } catch (error) {
      setHistoryError(error.response?.data?.message || "Failed to update history entry.");
    } finally {
      setIsUpdatingHistory(false);
    }
  };

  useEffect(() => {
    if (!patientToDelete) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") cancelDeletePatient();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [patientToDelete, cancelDeletePatient]);

  useEffect(() => {
    if (!selectedPatient && !isLoadingPatient) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape" && !patientToDelete) closeModal();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedPatient, isLoadingPatient, patientToDelete]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setErrorMessage(null);

    if (!form.cin.trim() || !form.name.trim()) {
      setErrorMessage("CIN and name are required.");
      return;
    }

    try {
      setIsSaving(true);
      await api.post("/api/patients", form);
      await loadPatients();
      setForm(emptyForm);
      setShowForm(false);
    } catch (error) {
      setErrorMessage(error.response?.data?.message || "Failed to add patient.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddHistory = async (event) => {
    event.preventDefault();
    if (!selectedPatient) return;
    setHistoryError(null);

    if (!historyForm.title.trim()) {
      setHistoryError("Title is required.");
      return;
    }

    try {
      setIsAddingHistory(true);
      const response = await api.post(`/api/patients/${selectedPatient._id}/history`, historyForm);
      setSelectedPatient(response.data.patient);
      setHistoryForm(emptyHistoryForm);
      await loadPatients();
    } catch (error) {
      setHistoryError(error.response?.data?.message || "Failed to add history entry.");
    } finally {
      setIsAddingHistory(false);
    }
  };

  if (!user?.area) {
    return (
      <div className="w-full">
        <PageHeader title="Patients" description="Manage patient records" />
        <div className="admin-card p-6 text-center">
          <p className="text-xs text-gray-500">Complete clinic setup to manage patients.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full animate-fade-in">
      <PageHeader
        title="Patients"
        description="Patient records for your clinic"
        actions={
          <button
            type="button"
            onClick={() => {
              const basePath = user?.role === "nurses" ? "/nurse" : "/admin";
              navigate(`${basePath}/triage`);
            }}
            className="btn-primary"
          >
            <FaPlus className="text-[10px]" /> Add patient
          </button>
        }
      />

      {showForm && (
        <div className="admin-card p-5 sm:p-6 mb-5">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-base font-bold text-health-navy">New Patient</h2>
              <p className="text-xs text-slate-400 mt-0.5">Register a new patient to your clinic.</p>
            </div>
            <button type="button" onClick={() => setShowForm(false)} className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
              <FaTimes />
            </button>
          </div>
          <form onSubmit={handleSubmit} className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="auth-label" htmlFor="cin">CIN</label>
              <input id="cin" value={form.cin} onChange={(e) => setForm((p) => ({ ...p, cin: e.target.value.toUpperCase() }))} className="auth-input uppercase" placeholder="12345678" required />
            </div>
            <div>
              <label className="auth-label" htmlFor="name">Full name</label>
              <input id="name" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} className="auth-input" placeholder="Patient name" required />
            </div>
            <div>
              <label className="auth-label" htmlFor="dateOfBirth">Date of birth</label>
              <input id="dateOfBirth" type="date" value={form.dateOfBirth} onChange={(e) => setForm((p) => ({ ...p, dateOfBirth: e.target.value }))} className="auth-input" />
            </div>
            <div>
              <label className="auth-label" htmlFor="gender">Gender</label>
              <select id="gender" value={form.gender} onChange={(e) => setForm((p) => ({ ...p, gender: e.target.value }))} className="auth-input">
                <option value="">Select</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="auth-label" htmlFor="phone">Phone</label>
              <input id="phone" value={form.phone} onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} className="auth-input" placeholder="+216 ..." />
            </div>
            <div>
              <label className="auth-label" htmlFor="bloodType">Blood type</label>
              <input id="bloodType" value={form.bloodType} onChange={(e) => setForm((p) => ({ ...p, bloodType: e.target.value }))} className="auth-input" placeholder="e.g. O+" />
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <label className="auth-label" htmlFor="address">Address</label>
              <input id="address" value={form.address} onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))} className="auth-input" placeholder="City, street..." />
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <label className="auth-label" htmlFor="initialNote">Initial note <span className="text-slate-400 normal-case font-normal">(optional)</span></label>
              <textarea id="initialNote" value={form.initialNote} onChange={(e) => setForm((p) => ({ ...p, initialNote: e.target.value }))} rows={2} className="auth-input resize-none" placeholder="First visit notes..." />
            </div>
            {errorMessage && <p className="sm:col-span-2 lg:col-span-3 text-xs text-red-500 font-medium">{errorMessage}</p>}
            <div className="sm:col-span-2 lg:col-span-3 flex gap-2 pt-1">
              <button type="submit" disabled={isSaving} className="btn-primary">{isSaving ? "Saving…" : "Add patient"}</button>
              <button type="button" onClick={() => setShowForm(false)} className="btn-outline">Cancel</button>
            </div>
          </form>
        </div>
      )}

      <div className="admin-card overflow-hidden">
        {isLoading ? (
          <div className="p-10 text-center">
            <div className="w-5 h-5 border-2 border-health-blue border-t-transparent rounded-full animate-spin mx-auto mb-2" />
            <p className="text-xs text-slate-400">Loading patients…</p>
          </div>
        ) : patients.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-3xl mb-3">👥</p>
            <p className="text-sm font-bold text-health-navy">No patients yet</p>
            <p className="text-xs text-slate-400 mt-1">Add your first patient using the button above.</p>
          </div>
        ) : (
          <>
            <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
              <p className="text-[11px] text-slate-400 font-medium">{patients.length} patient{patients.length !== 1 ? "s" : ""} — click a row to view visit history</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-100" style={{ background: "linear-gradient(90deg,#f8fafc,#f1f5f9)" }}>
                    <th className="px-4 py-3 section-header">CIN</th>
                    <th className="px-4 py-3 section-header">Name</th>
                    <th className="px-4 py-3 section-header hidden sm:table-cell">Phone</th>
                    <th className="px-4 py-3 section-header hidden md:table-cell">Gender</th>
                    <th className="px-4 py-3 section-header hidden lg:table-cell">Blood</th>
                    <th className="px-4 py-3 section-header hidden md:table-cell">Visits</th>
                    <th className="px-4 py-3 section-header hidden md:table-cell">Last visit</th>
                    <th className="px-4 py-3 section-header text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {patients.map((patient) => {
                    const initials = patient.name?.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "?";
                    return (
                      <tr
                        key={patient._id}
                        onClick={() => openPatientHistory(patient._id)}
                        className="hover:bg-health-ice/20 transition-colors cursor-pointer group"
                      >
                        <td className="px-4 py-3">
                          <code className="font-mono text-health-blue font-bold text-[11px] bg-health-ice/50 px-1.5 py-0.5 rounded">{patient.cin}</code>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-health-blue to-health-cyan flex items-center justify-center shrink-0">
                              <span className="text-[9px] font-bold text-white">{initials}</span>
                            </div>
                            <span className="font-semibold text-health-navy">{patient.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-500 hidden sm:table-cell">{patient.phone || "—"}</td>
                        <td className="px-4 py-3 hidden md:table-cell capitalize">
                          <span className="stat-pill-slate">{GENDER_LABELS[patient.gender] || "—"}</span>
                        </td>
                        <td className="px-4 py-3 hidden lg:table-cell">
                          {patient.bloodType ? <span className="stat-pill-red">{patient.bloodType}</span> : <span className="text-slate-400">—</span>}
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell">
                          <span className="stat-pill-blue">{patient.historyCount ?? 0}</span>
                        </td>
                        <td className="px-4 py-3 text-slate-500 hidden md:table-cell">{formatDate(patient.lastVisit)}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button type="button" onClick={(e) => openEditPatient(patient._id, e)} className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-health-blue hover:bg-health-ice/50 transition-colors" aria-label="Edit patient">
                              <FaEdit className="text-[11px]" />
                            </button>
                            <button type="button" onClick={(e) => requestDeletePatient(patient, e)} disabled={isDeletingPatient} className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 disabled:opacity-40 transition-colors" aria-label="Delete patient">
                              <FaTrash className="text-[11px]" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      {(selectedPatient || isLoadingPatient) && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-health-navy/50 backdrop-blur-sm"
          onClick={closeModal}
        >
          <div
            className="glass-card w-full max-w-xl max-h-[90vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100" style={{ background: "linear-gradient(135deg,#f8fafc,#e8f4fd)" }}>
              <div>
                <h2 className="text-sm font-bold text-health-navy">
                  {selectedPatient ? selectedPatient.name : "Patient history"}
                </h2>
                {selectedPatient && (
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    CIN <code className="font-mono font-bold text-health-blue">{selectedPatient.cin}</code>
                    {selectedPatient.history?.length > 0 && (
                      <span> · <span className="stat-pill-blue inline-flex px-1.5">{selectedPatient.history.length} visit{selectedPatient.history.length !== 1 ? "s" : ""}</span></span>
                    )}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1">
                {selectedPatient && !isEditPatient && !historyEditForm && (
                  <>
                    <button type="button" onClick={() => { setPatientEditForm(patientToEditForm(selectedPatient)); setIsEditPatient(true); }} className="btn-outline text-[11px] py-1.5 px-2.5">Edit patient</button>
                    <button type="button" onClick={() => requestDeletePatient(selectedPatient)} disabled={isDeletingPatient} className="btn-danger text-[11px] py-1.5 px-2.5">Delete</button>
                  </>
                )}
                <button type="button" onClick={closeModal} className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors ml-1" aria-label="Close">
                  <FaTimes className="text-xs" />
                </button>
              </div>
            </div>

            <div className="overflow-y-auto flex-1 p-5">
              {isLoadingPatient ? (
                <p className="text-xs text-gray-400 py-8 text-center">Loading patient history...</p>
              ) : isEditPatient && selectedPatient ? (
                <form onSubmit={handleUpdatePatient} className="space-y-3">
                  <h3 className="text-xs font-semibold text-gray-700">Edit patient</h3>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div>
                      <label className="auth-label" htmlFor="edit-cin">CIN</label>
                      <input
                        id="edit-cin"
                        value={patientEditForm.cin}
                        onChange={(e) => setPatientEditForm((p) => ({ ...p, cin: e.target.value.toUpperCase() }))}
                        className="auth-input uppercase"
                        required
                      />
                    </div>
                    <div>
                      <label className="auth-label" htmlFor="edit-name">Full name</label>
                      <input
                        id="edit-name"
                        value={patientEditForm.name}
                        onChange={(e) => setPatientEditForm((p) => ({ ...p, name: e.target.value }))}
                        className="auth-input"
                        required
                      />
                    </div>
                    <div>
                      <label className="auth-label" htmlFor="edit-dob">Date of birth</label>
                      <input
                        id="edit-dob"
                        type="date"
                        value={patientEditForm.dateOfBirth}
                        onChange={(e) => setPatientEditForm((p) => ({ ...p, dateOfBirth: e.target.value }))}
                        className="auth-input"
                      />
                    </div>
                    <div>
                      <label className="auth-label" htmlFor="edit-gender">Gender</label>
                      <select
                        id="edit-gender"
                        value={patientEditForm.gender}
                        onChange={(e) => setPatientEditForm((p) => ({ ...p, gender: e.target.value }))}
                        className="auth-input"
                      >
                        <option value="">Select</option>
                        <option value="male">Male</option>
                        <option value="female">Female</option>
                        <option value="other">Other</option>
                      </select>
                    </div>
                    <div>
                      <label className="auth-label" htmlFor="edit-phone">Phone</label>
                      <input
                        id="edit-phone"
                        value={patientEditForm.phone}
                        onChange={(e) => setPatientEditForm((p) => ({ ...p, phone: e.target.value }))}
                        className="auth-input"
                      />
                    </div>
                    <div>
                      <label className="auth-label" htmlFor="edit-blood">Blood type</label>
                      <input
                        id="edit-blood"
                        value={patientEditForm.bloodType}
                        onChange={(e) => setPatientEditForm((p) => ({ ...p, bloodType: e.target.value }))}
                        className="auth-input"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="auth-label" htmlFor="edit-address">Address</label>
                      <input
                        id="edit-address"
                        value={patientEditForm.address}
                        onChange={(e) => setPatientEditForm((p) => ({ ...p, address: e.target.value }))}
                        className="auth-input"
                      />
                    </div>
                  </div>
                  {historyError && <p className="text-xs text-red-500">{historyError}</p>}
                  <div className="flex gap-2">
                    <button type="submit" disabled={isUpdatingPatient} className="auth-btn-primary !w-auto px-4 text-xs">
                      {isUpdatingPatient ? "Saving..." : "Save patient"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsEditPatient(false)}
                      className="text-xs font-semibold px-4 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : historyEditForm ? (
                <form onSubmit={handleUpdateHistory} className="space-y-3">
                  <h3 className="text-xs font-semibold text-gray-700">Edit visit / history entry</h3>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div>
                      <label className="auth-label" htmlFor="hist-type">Type</label>
                      <select
                        id="hist-type"
                        value={historyEditForm.type}
                        onChange={(e) => setHistoryEditForm((p) => ({ ...p, type: e.target.value }))}
                        className="auth-input"
                      >
                        {HISTORY_TYPES.map(({ value, label }) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="auth-label" htmlFor="hist-date">
                        {historyEditForm.isTriage ? "Visit date & time" : "Date"}
                      </label>
                      <input
                        id="hist-date"
                        type={historyEditForm.isTriage ? "datetime-local" : "date"}
                        value={historyEditForm.date}
                        onChange={(e) => setHistoryEditForm((p) => ({ ...p, date: e.target.value }))}
                        className="auth-input"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="auth-label" htmlFor="hist-title">Title</label>
                      <input
                        id="hist-title"
                        value={historyEditForm.title}
                        onChange={(e) => setHistoryEditForm((p) => ({ ...p, title: e.target.value }))}
                        className="auth-input"
                        required
                      />
                    </div>
                  </div>

                  {historyEditForm.isTriage && (
                    <>
                      <div className="grid sm:grid-cols-3 gap-2">
                        {Object.keys(emptyVitals).map((key) => (
                          <div key={key}>
                            <label className="auth-label capitalize" htmlFor={`hist-${key}`}>{key.replace(/([A-Z])/g, " $1")}</label>
                            <input
                              id={`hist-${key}`}
                              value={historyEditForm.vitals[key]}
                              onChange={(e) =>
                                setHistoryEditForm((p) => ({
                                  ...p,
                                  vitals: { ...p.vitals, [key]: e.target.value },
                                }))
                              }
                              className="auth-input"
                            />
                          </div>
                        ))}
                      </div>
                      <div>
                        <label className="auth-label" htmlFor="hist-symptoms">Symptoms (comma-separated)</label>
                        <input
                          id="hist-symptoms"
                          value={historyEditForm.symptomsText}
                          onChange={(e) => setHistoryEditForm((p) => ({ ...p, symptomsText: e.target.value }))}
                          className="auth-input"
                          placeholder="Fever, Cough, ..."
                        />
                      </div>
                      <div>
                        <label className="auth-label" htmlFor="hist-duration">Duration</label>
                        <input
                          id="hist-duration"
                          value={historyEditForm.duration}
                          onChange={(e) => setHistoryEditForm((p) => ({ ...p, duration: e.target.value }))}
                          className="auth-input"
                        />
                      </div>
                      <div>
                        <label className="auth-label" htmlFor="hist-add-notes">Additional notes</label>
                        <textarea
                          id="hist-add-notes"
                          value={historyEditForm.additionalNotes}
                          onChange={(e) => setHistoryEditForm((p) => ({ ...p, additionalNotes: e.target.value }))}
                          rows={2}
                          className="auth-input resize-none"
                        />
                      </div>
                      {historyEditForm.predictions?.length > 0 && (
                        <div className="rounded-xl border border-gray-100 bg-gray-50/80 p-3">
                          <p className="text-[10px] font-medium text-gray-600 mb-1">Predictions (read-only)</p>
                          <ul className="space-y-1">
                            {historyEditForm.predictions.map((item, index) => (
                              <li key={`${item.maladie}-${index}`} className="text-[11px] text-health-navy">
                                {item.label} — {item.confidence}%
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </>
                  )}

                  {!historyEditForm.isTriage && (
                    <div>
                      <label className="auth-label" htmlFor="hist-notes">Notes</label>
                      <textarea
                        id="hist-notes"
                        value={historyEditForm.notes}
                        onChange={(e) => setHistoryEditForm((p) => ({ ...p, notes: e.target.value }))}
                        rows={3}
                        className="auth-input resize-none"
                      />
                    </div>
                  )}

                  {historyError && <p className="text-xs text-red-500">{historyError}</p>}
                  <div className="flex gap-2">
                    <button type="submit" disabled={isUpdatingHistory} className="auth-btn-primary !w-auto px-4 text-xs">
                      {isUpdatingHistory ? "Saving..." : "Save changes"}
                    </button>
                    <button
                      type="button"
                      onClick={cancelEditHistory}
                      className="text-xs font-semibold px-4 py-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : selectedPatient && (
                <>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-5 text-[11px]">
                    <div className="admin-card px-3 py-2">
                      <span className="text-gray-400">Age</span>
                      <p className="font-semibold text-health-navy">{calcAge(selectedPatient.dateOfBirth) ?? "—"}</p>
                    </div>
                    <div className="admin-card px-3 py-2">
                      <span className="text-gray-400">Gender</span>
                      <p className="font-semibold text-health-navy capitalize">{GENDER_LABELS[selectedPatient.gender] || "—"}</p>
                    </div>
                    <div className="admin-card px-3 py-2">
                      <span className="text-gray-400">Blood type</span>
                      <p className="font-semibold text-health-navy">{selectedPatient.bloodType || "—"}</p>
                    </div>
                    <div className="admin-card px-3 py-2">
                      <span className="text-gray-400">Phone</span>
                      <p className="font-semibold text-health-navy">{selectedPatient.phone || "—"}</p>
                    </div>
                  </div>

                  <h3 className="text-xs font-semibold text-gray-700 mb-3">Visit history</h3>
                  <VisitHistoryList
                    history={selectedPatient.history}
                    maxHeight="max-h-[50vh]"
                    emptyMessage="No visits yet. Record a visit from Smart Triage."
                    onEdit={startEditHistory}
                  />

                  <details className="border-t border-gray-100 pt-4 mt-5 group">
                    <summary className="text-xs font-semibold text-gray-600 cursor-pointer list-none flex items-center gap-1">
                      <span className="group-open:rotate-90 transition-transform">▸</span>
                      Add manual history entry
                    </summary>
                    <form onSubmit={handleAddHistory} className="mt-3 space-y-3">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="auth-label" htmlFor="historyType">Type</label>
                          <select id="historyType" value={historyForm.type} onChange={(e) => setHistoryForm((p) => ({ ...p, type: e.target.value }))} className="auth-input">
                            {HISTORY_TYPES.map(({ value, label }) => (
                              <option key={value} value={value}>{label}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="auth-label" htmlFor="historyDate">Date</label>
                          <input id="historyDate" type="date" value={historyForm.date} onChange={(e) => setHistoryForm((p) => ({ ...p, date: e.target.value }))} className="auth-input" />
                        </div>
                      </div>
                      <div>
                        <label className="auth-label" htmlFor="historyTitle">Title</label>
                        <input id="historyTitle" value={historyForm.title} onChange={(e) => setHistoryForm((p) => ({ ...p, title: e.target.value }))} className="auth-input" placeholder="e.g. Routine checkup" />
                      </div>
                      <div>
                        <label className="auth-label" htmlFor="historyNotes">Notes</label>
                        <textarea id="historyNotes" value={historyForm.notes} onChange={(e) => setHistoryForm((p) => ({ ...p, notes: e.target.value }))} rows={2} className="auth-input resize-none" placeholder="Details..." />
                      </div>
                      {historyError && <p className="text-xs text-red-500">{historyError}</p>}
                      <button type="submit" disabled={isAddingHistory} className="auth-btn-primary !w-auto px-4 text-xs">
                        {isAddingHistory ? "Adding..." : "Add entry"}
                      </button>
                    </form>
                  </details>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {patientToDelete && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-health-navy/50 backdrop-blur-sm"
          onClick={cancelDeletePatient}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-patient-title"
          >
            <div className="px-6 pt-6 pb-4 text-center">
              <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-50 border border-red-100">
                <FaTrash className="text-lg text-red-500" />
              </div>
              <h3 id="delete-patient-title" className="text-sm font-bold text-health-navy">
                Delete patient?
              </h3>
              <p className="text-xs text-gray-500 mt-2 leading-relaxed">
                This will remove{" "}
                <span className="font-semibold text-health-navy">{patientToDelete.name}</span>
                {" "}(CIN{" "}
                <span className="font-mono text-health-blue">{patientToDelete.cin}</span>
                ) from your clinic list. Visit history will no longer be accessible here.
              </p>
              {deleteError && (
                <p className="text-xs text-red-500 mt-3 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                  {deleteError}
                </p>
              )}
            </div>
            <div className="flex gap-2 px-6 pb-6">
              <button
                type="button"
                onClick={cancelDeletePatient}
                disabled={isDeletingPatient}
                className="flex-1 text-xs font-semibold px-4 py-2.5 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDeletePatient}
                disabled={isDeletingPatient}
                className="flex-1 text-xs font-semibold px-4 py-2.5 rounded-xl bg-gradient-to-r from-red-500 to-red-600 text-white hover:from-red-600 hover:to-red-700 disabled:opacity-50 shadow-sm"
              >
                {isDeletingPatient ? "Deleting..." : "Delete patient"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Patients;
