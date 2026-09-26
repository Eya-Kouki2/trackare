import api from "../../api/axios";
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useOutletContext, useNavigate } from "react-router-dom";
import {
  FaUserCheck, FaUserPlus, FaSearch, FaStethoscope, FaClipboardList,
  FaCheckCircle, FaTimesCircle, FaNotesMedical, FaPills, FaHistory,
  FaPlus, FaTrash, FaEdit, FaChevronRight, FaTimes, FaHospitalUser,
  FaFilter, FaCalendarAlt, FaIdCard, FaCheck, FaExclamationTriangle,
  FaArrowLeft
} from "react-icons/fa";
import PageHeader from "../../components/admin/PageHeader";
import VisitHistoryList from "../../components/admin/VisitHistoryList";

const GENDER_LABELS = { male: "Male", female: "Female", other: "Other" };

/* ── 25 Diagnostic Questions from Kiosk ── */
const DIAGNOSTIC_QUESTIONS = [
  { key: "chills",                 label: "Experiencing chills",                     keywords: ["chills"] },
  { key: "joint_pain",             label: "Joint pain or rash",                     keywords: ["joint pain", "rash"] },
  { key: "muscle_wasting",         label: "Muscle wasting / loss",                  keywords: ["fatigue"] },
  { key: "vomiting",               label: "Vomiting",                               keywords: ["vomiting"] },
  { key: "fatigue",                label: "Unusual fatigue",                        keywords: ["fatigue"] },
  { key: "weight_loss",            label: "Unexplained weight loss",                keywords: ["weight loss"] },
  { key: "patches_in_throat",      label: "Patches / soreness in throat",           keywords: ["sore throat"] },
  { key: "cough",                  label: "Persistent cough",                       keywords: ["cough"] },
  { key: "high_fever",             label: "High fever (≥ 38.5 °C)",                 keywords: ["fever"] },
  { key: "breathlessness",         label: "Breathlessness / shortness of breath",   keywords: ["breathing difficulty", "shortness of breath"] },
  { key: "sweating",               label: "Excessive sweating / night sweats",      keywords: ["sweating", "night sweats"] },
  { key: "headache",               label: "Severe headache",                        keywords: ["headache"] },
  { key: "nausea",                 label: "Nausea",                                 keywords: ["nausea"] },
  { key: "loss_of_appetite",       label: "Loss of appetite",                       keywords: ["fatigue"] },
  { key: "diarrhoea",              label: "Diarrhoea",                              keywords: ["diarrhea", "severe diarrhea"] },
  { key: "mild_fever",             label: "Mild fever (37–38.5 °C)",                keywords: ["fever"] },
  { key: "yellowing_of_eyes",      label: "Yellowing of eyes / jaundice",           keywords: ["jaundice", "yellow eyes"] },
  { key: "swelled_lymph_nodes",    label: "Swollen lymph nodes",                    keywords: ["swollen lymph nodes"] },
  { key: "malaise",                label: "General malaise or unwell feeling",      keywords: ["fatigue"] },
  { key: "phlegm",                 label: "Phlegm or mucus production",             keywords: ["cough"] },
  { key: "chest_pain",             label: "Chest pain or tightness",                keywords: ["chest tightness"] },
  { key: "dizziness",              label: "Dizziness",                              keywords: ["dizziness"] },
  { key: "extra_marital_contacts", label: "Unprotected contact / blister lesions",   keywords: ["rash", "blisters", "lesions"] },
  { key: "muscle_pain",            label: "Muscle pain or body aches",              keywords: ["body ache"] },
  { key: "blood_in_sputum",        label: "Blood in sputum",                        keywords: ["blood", "blood in sputum"] },
];

const emptyPatientForm = {
  cin: "",
  name: "",
  dateOfBirth: "",
  gender: "other",
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

const calcAge = (dateOfBirth) => {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;
  const diff = Date.now() - dob.getTime();
  return Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000));
};

const priorityBadge = (priority) => {
  const p = (priority || "").toUpperCase();
  if (p.includes("RED") || p.includes("HIGH") || p.includes("CRITICAL")) {
    return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wide uppercase bg-rose-50 text-rose-700 border border-rose-200">RED</span>;
  }
  if (p.includes("YELLOW") || p.includes("ORANGE") || p.includes("MODERATE")) {
    return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wide uppercase bg-amber-50 text-amber-700 border border-amber-200">YELLOW</span>;
  }
  return <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wide uppercase bg-emerald-50 text-emerald-700 border border-emerald-200">GREEN</span>;
};

const statusBadge = (status) => {
  const s = (status || "").toLowerCase();
  if (s === "completed") {
    return <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-700 border border-slate-200"><span className="w-1.5 h-1.5 rounded-full bg-slate-500" /> Completed</span>;
  }
  if (s === "in_consultation") {
    return <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200"><span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" /> In Consultation</span>;
  }
  return <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200"><span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" /> Waiting</span>;
};

const diseaseTagClass = (disease, isSelected) => {
  if (isSelected) return "bg-white/20 text-white font-black";
  const d = (disease || "").toLowerCase();
  if (d.includes("malaria")) return "bg-amber-50 text-amber-700 border border-amber-200/80";
  if (d.includes("tuberculo")) return "bg-teal-50 text-teal-700 border border-teal-200/80";
  if (d.includes("cida") || d.includes("hiv")) return "bg-purple-50 text-purple-700 border border-purple-200/80";
  return "bg-slate-100 text-slate-600 border border-slate-200";
};

export default function Patients() {
  const { user } = useOutletContext();
  const navigate = useNavigate();

  /* ── View Mode: "consultation" (Doctor Queue) vs "directory" (All Patients) ── */
  const [viewMode, setViewMode] = useState("consultation");

  /* ── Doctor Room Selection & Queue ── */
  const [diseaseClasses, setDiseaseClasses] = useState([]);
  const [selectedRoomId, setSelectedRoomId] = useState("all");
  const [activeSessions, setActiveSessions] = useState([]);
  const [isLoadingQueue, setIsLoadingQueue] = useState(true);
  const [roomsCollapsed, setRoomsCollapsed] = useState(false);

  /* ── Active Consultation Desk State ── */
  const [selectedSession, setSelectedSession] = useState(null);
  const [patientForm, setPatientForm] = useState(emptyPatientForm);
  const [cinQuery, setCinQuery] = useState("");
  const [cinSuggestions, setCinSuggestions] = useState([]);
  const [showCinDropdown, setShowCinDropdown] = useState(false);
  const [isExistingPatient, setIsExistingPatient] = useState(false);
  const [existingPatientRecord, setExistingPatientRecord] = useState(null);
  const [pastEncounters, setPastEncounters] = useState([]);

  /* ── Clinical Evaluation ── */
  const [checkedSymptoms, setCheckedSymptoms] = useState({});
  const [vitals, setVitals] = useState(emptyVitals);
  const [confirmedDiagnosis, setConfirmedDiagnosis] = useState("");
  const [clinicalNotes, setClinicalNotes] = useState("");
  const [prescriptions, setPrescriptions] = useState([]);
  const [availableMeds, setAvailableMeds] = useState([]);
  const [isSavingConsultation, setIsSavingConsultation] = useState(false);
  const [deletingSessionId, setDeletingSessionId] = useState(null);
  const [consultationSuccess, setConsultationSuccess] = useState(null);
  const [consultationError, setConsultationError] = useState(null);

  /* ── All Patients Directory State ── */
  const [patients, setPatients] = useState([]);
  const [isLoadingPatients, setIsLoadingPatients] = useState(false);
  const [patientSearch, setPatientSearch] = useState("");
  const [classFilter, setClassFilter] = useState("all");
  const [directoryPatientModal, setDirectoryPatientModal] = useState(null);
  const [isLoadingPatientDetails, setIsLoadingPatientDetails] = useState(false);

  /* ── Add / Edit Patient Modal in Directory ── */
  const [showAddPatientModal, setShowAddPatientModal] = useState(false);
  const [addPatientForm, setAddPatientForm] = useState(emptyPatientForm);
  const [isCreatingPatient, setIsCreatingPatient] = useState(false);
  const [addPatientError, setAddPatientError] = useState(null);

  /* ─────────────────────────────────────────────────────────────
     1. Load Disease Rooms & Pharmacy Meds
  ───────────────────────────────────────────────────────────── */
  const loadRooms = useCallback(async () => {
    try {
      const res = await api.get("/api/disease-classes");
      setDiseaseClasses(res.data.diseaseClasses || []);
    } catch (err) {
      console.error("Failed to load disease rooms:", err);
    }
  }, []);

  const loadPharmacy = useCallback(async () => {
    try {
      const res = await api.get("/api/pharmacy");
      setAvailableMeds(res.data.medications || []);
    } catch {
      // Non-blocking
    }
  }, []);

  /* ─────────────────────────────────────────────────────────────
     2. Load Active Sessions Queue (Live Polling + SSE)
  ───────────────────────────────────────────────────────────── */
  const loadActiveQueue = useCallback(async () => {
    if (!user?.area) return;
    try {
      const areaId = user.area?._id || user.area;
      const res = await api.get(`/api/triage-sessions/active?areaId=${areaId}`);
      if (res.data.success) {
        setActiveSessions(res.data.sessions || []);
      }
    } catch (err) {
      console.error("Failed to load active queue:", err);
    } finally {
      setIsLoadingQueue(false);
    }
  }, [user?.area]);

  /* ─────────────────────────────────────────────────────────────
     3. Load All Patients Directory
  ───────────────────────────────────────────────────────────── */
  const loadPatientsDirectory = useCallback(async () => {
    setIsLoadingPatients(true);
    try {
      const res = await api.get("/api/patients");
      setPatients(res.data.patients || []);
    } catch (err) {
      console.error("Failed to load patients directory:", err);
    } finally {
      setIsLoadingPatients(false);
    }
  }, []);

  useEffect(() => {
    loadRooms();
    loadPharmacy();
    loadActiveQueue();
    loadPatientsDirectory();

    const interval = setInterval(loadActiveQueue, 2500);
    window.addEventListener("alerts-updated", loadActiveQueue);

    // SSE Stream for real-time queue sync
    const isDev = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
    const sseUrl = isDev ? "http://localhost:5000/api/result/stream" : "/api/result/stream";
    const sse = new EventSource(sseUrl);

    sse.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (
          data.type === "TOKEN_CREATED" ||
          data.type === "WAITING_PATIENT_ASSIGNED" ||
          data.type === "TOKEN_ATTENDED" ||
          data.type === "CONSULTATION_COMPLETED"
        ) {
          loadActiveQueue();
          loadRooms();
        }
      } catch (err) {
        console.error("SSE parse error:", err);
      }
    };

    return () => {
      clearInterval(interval);
      window.removeEventListener("alerts-updated", loadActiveQueue);
      sse.close();
    };
  }, [loadRooms, loadPharmacy, loadActiveQueue, loadPatientsDirectory]);

  /* ─────────────────────────────────────────────────────────────
     4. Filter Queue by Selected Room
  ───────────────────────────────────────────────────────────── */
  const filteredQueue = useMemo(() => {
    if (selectedRoomId === "all") return activeSessions;
    return activeSessions.filter((s) => {
      if (!s.assignedRoom) return false;
      const roomId = s.assignedRoom._id || s.assignedRoom;
      return String(roomId) === String(selectedRoomId);
    });
  }, [activeSessions, selectedRoomId]);

  /* ─────────────────────────────────────────────────────────────
     5. Select a Patient / Token to Attend
  ───────────────────────────────────────────────────────────── */
  const handleSelectToken = async (session) => {
    setSelectedSession(session);
    setConsultationSuccess(null);
    setConsultationError(null);
    setShowCinDropdown(false);

    // Initialize symptoms checklist from session reported symptoms
    const initialChecked = {};
    const reported = session.symptoms || [];
    DIAGNOSTIC_QUESTIONS.forEach((q) => {
      const isYes = reported.some((s) => {
        const str = String(s).toLowerCase();
        return str === q.key.toLowerCase() ||
               str === q.label.toLowerCase() ||
               (q.keywords && q.keywords.some((kw) => str.includes(kw.toLowerCase())));
      });
      initialChecked[q.key] = isYes;
    });
    setCheckedSymptoms(initialChecked);

    // Initialize vitals & diagnosis
    setVitals({
      temperature: session.vitals?.temperature || "",
      pulse: session.vitals?.pulse || "",
      bloodPressure: session.vitals?.bloodPressure || "",
      weight: session.vitals?.weight || "",
      height: session.vitals?.height || "",
    });
    const encounter = session.encounterId;
    const consultation = encounter && typeof encounter === "object" ? encounter.consultation : null;

    setConfirmedDiagnosis(consultation?.confirmedDiagnosis || session.prediction?.label || "");
    setClinicalNotes(consultation?.clinicalNotes || "");
    setPrescriptions(consultation?.prescriptions || []);

    // Check if encounter already linked to a patient
    if (encounter && typeof encounter === "object" && encounter.patientId) {
      const p = encounter.patientId;
      setPatientForm({
        cin: p.cin || "",
        name: p.name || "",
        dateOfBirth: toInputDate(p.dateOfBirth),
        gender: p.gender || "other",
        phone: p.phone || "",
        bloodType: p.bloodType || "",
        address: p.address || "",
      });
      setCinQuery(p.cin || "");
      setIsExistingPatient(true);
      setExistingPatientRecord(p);
      loadPatientHistory(p._id);
    } else {
      setPatientForm(emptyPatientForm);
      setCinQuery("");
      setIsExistingPatient(false);
      setExistingPatientRecord(null);
      setPastEncounters([]);
    }

    // Mark attended on backend if not already completed / in consultation
    if (session.status !== "completed" && session.status !== "in_consultation") {
      try {
        await api.post(`/api/triage-sessions/${session._id}/attend`);
        setSelectedSession((prev) => (prev ? { ...prev, status: "in_consultation" } : null));
        setActiveSessions((prev) =>
          prev.map((s) => (s._id === session._id ? { ...s, status: "in_consultation" } : s))
        );
        loadActiveQueue();
      } catch (err) {
        console.error("Failed to mark session attended:", err);
      }
    }
  };

  /* ─────────────────────────────────────────────────────────────
     6. CIN Autocomplete Search & Auto-Fill
  ───────────────────────────────────────────────────────────── */
  const handleCinInputChange = (value) => {
    const val = value.toUpperCase();
    setCinQuery(val);
    setPatientForm((prev) => ({ ...prev, cin: val }));

    if (!val.trim()) {
      setCinSuggestions([]);
      setShowCinDropdown(false);
      setIsExistingPatient(false);
      setExistingPatientRecord(null);
      setPastEncounters([]);
      return;
    }

    // Search local patients list or direct match
    const matches = patients.filter((p) => p.cin && p.cin.toUpperCase().includes(val));
    setCinSuggestions(matches.slice(0, 5));
    setShowCinDropdown(matches.length > 0);

    // Exact match auto-fill
    const exact = patients.find((p) => p.cin && p.cin.toUpperCase() === val);
    if (exact) {
      autoFillPatient(exact);
    } else {
      setIsExistingPatient(false);
      setExistingPatientRecord(null);
      setPastEncounters([]);
    }
  };

  const autoFillPatient = (patient) => {
    setPatientForm({
      cin: patient.cin || "",
      name: patient.name || "",
      dateOfBirth: toInputDate(patient.dateOfBirth),
      gender: patient.gender || "other",
      phone: patient.phone || "",
      bloodType: patient.bloodType || "",
      address: patient.address || "",
    });
    setCinQuery(patient.cin || "");
    setIsExistingPatient(true);
    setExistingPatientRecord(patient);
    setShowCinDropdown(false);
    loadPatientHistory(patient._id);
  };

  const loadPatientHistory = async (patientId) => {
    try {
      const res = await api.get(`/api/patients/${patientId}`);
      if (res.data.patient) {
        setExistingPatientRecord(res.data.patient);
      }
    } catch (err) {
      console.error("Failed to load patient history:", err);
    }
  };

  /* ── Prescriptions helpers ── */
  const addPrescriptionRow = () => {
    const firstMed = availableMeds[0];
    setPrescriptions((prev) => [
      ...prev,
      {
        drug_name: firstMed?.drug_name || "",
        strength: firstMed?.strength && firstMed.strength !== "N/A" ? firstMed.strength : "",
        quantity: 1,
        instructions: "1 tab 3x daily after meals",
      },
    ]);
  };

  const removePrescriptionRow = (idx) => {
    setPrescriptions((prev) => prev.filter((_, i) => i !== idx));
  };

  const updatePrescriptionRow = (idx, field, val) => {
    setPrescriptions((prev) => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], [field]: val };
      // Auto-fill strength when a pharmacy drug is selected
      if (field === "drug_name") {
        const matched = availableMeds.find((m) => m.drug_name === val);
        if (matched) {
          if (matched.strength && matched.strength !== "N/A") {
            updated[idx].strength = matched.strength;
          }
        }
      }
      return updated;
    });
  };

  /* ─────────────────────────────────────────────────────────────
     7. Finish & Complete Consultation
  ───────────────────────────────────────────────────────────── */
  const handleFinishConsultation = async () => {
    if (!selectedSession) return;
    if (!patientForm.cin.trim()) {
      setConsultationError("Patient CIN is required to finalize consultation.");
      return;
    }

    setIsSavingConsultation(true);
    setConsultationError(null);

    try {
      // 1. Link / Create Patient
      await api.post(`/api/triage-sessions/${selectedSession._id}/link-patient`, {
        cin: patientForm.cin.trim(),
        name: patientForm.name.trim() || `Patient ${patientForm.cin.trim()}`,
        dateOfBirth: patientForm.dateOfBirth || null,
        gender: patientForm.gender || "other",
        phone: patientForm.phone || "",
        bloodType: patientForm.bloodType || "",
        address: patientForm.address || "",
      });

      const isEdit = selectedSession.status === "completed";

      // 2. Complete Consultation / Save updates
      await api.post(`/api/triage-sessions/${selectedSession._id}/complete`, {
        confirmedDiagnosis: confirmedDiagnosis || selectedSession.prediction?.label || "Consultation Completed",
        clinicalNotes: clinicalNotes.trim(),
        prescriptions,
      });

      setConsultationSuccess(
        isEdit
          ? `Consultation changes for Token #${selectedSession.tokenNumber} updated & saved!`
          : `Consultation for Token #${selectedSession.tokenNumber} completed successfully!`
      );
      setSelectedSession(null);
      setPatientForm(emptyPatientForm);
      setCinQuery("");
      setIsExistingPatient(false);
      setExistingPatientRecord(null);
      setPastEncounters([]);

      // Refresh Queue, Rooms, and Patients directory
      await Promise.all([loadActiveQueue(), loadRooms(), loadPatientsDirectory()]);
    } catch (err) {
      console.error("Consultation finish failed:", err);
      setConsultationError(err.response?.data?.error || "Failed to finish consultation.");
    } finally {
      setIsSavingConsultation(false);
    }
  };

  /* ─────────────────────────────────────────────────────────────
     8. Directory Patient Filtering
  ───────────────────────────────────────────────────────────── */
  const filteredDirectoryPatients = useMemo(() => {
    return patients.filter((p) => {
      // Search
      const q = patientSearch.toLowerCase().trim();
      const matchSearch =
        !q ||
        (p.name && p.name.toLowerCase().includes(q)) ||
        (p.cin && p.cin.toLowerCase().includes(q)) ||
        (p.phone && p.phone.toLowerCase().includes(q));

      if (!matchSearch) return false;

      // Class Filter
      if (classFilter === "all") return true;
      const latestHistory = (p.history || [])[p.history?.length - 1];
      const diseaseMatch =
        (latestHistory?.title && latestHistory.title.toLowerCase().includes(classFilter.toLowerCase())) ||
        (latestHistory?.triage?.predictions || []).some((pred) => pred.maladie?.toLowerCase().includes(classFilter.toLowerCase()));

      return diseaseMatch;
    });
  }, [patients, patientSearch, classFilter]);

  /* ─────────────────────────────────────────────────────────────
     9. Add Patient Manually in Directory
  ───────────────────────────────────────────────────────────── */
  const handleCreatePatientManual = async (e) => {
    e.preventDefault();
    if (!addPatientForm.cin.trim() || !addPatientForm.name.trim()) {
      setAddPatientError("CIN and Full Name are required.");
      return;
    }
    setIsCreatingPatient(true);
    setAddPatientError(null);
    try {
      await api.post("/api/patients", addPatientForm);
      setShowAddPatientModal(false);
      setAddPatientForm(emptyPatientForm);
      await loadPatientsDirectory();
    } catch (err) {
      setAddPatientError(err.response?.data?.message || "Failed to create patient.");
    } finally {
      setIsCreatingPatient(false);
    }
  };

  /* ─────────────────────────────────────────────────────────────
     10. Delete / Cancel Session from Room Queue
  ───────────────────────────────────────────────────────────── */
  const handleDeleteSession = async (session) => {
    if (!session?._id) return;
    const confirmDelete = window.confirm(
      `Are you sure you want to remove Token #${session.tokenNumber} from the queue?`
    );
    if (!confirmDelete) return;

    try {
      setDeletingSessionId(session._id);
      await api.delete(`/api/triage-sessions/${session._id}`);
      setActiveSessions((prev) => prev.filter((s) => s._id !== session._id));
      if (selectedSession?._id === session._id) {
        setSelectedSession(null);
      }
      setConsultationSuccess(`Token #${session.tokenNumber} was removed from the queue.`);
      setTimeout(() => setConsultationSuccess(null), 4000);
      window.dispatchEvent(new Event("alerts-updated"));
    } catch (err) {
      console.error("Failed to delete session", err);
      alert(err.response?.data?.error || "Failed to remove token from queue");
    } finally {
      setDeletingSessionId(null);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* ── Page Header with View Switcher ── */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-100 shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 bg-health-blue/10 text-health-blue rounded-xl text-lg">🩺</span>
            <div>
              <h1 className="text-xl font-black text-health-navy tracking-tight">Doctor Consultation & Patients</h1>
              <p className="text-xs text-slate-500 font-medium">
                Real-time room queues, triage review, auto-fill identification, and clinical evaluations.
              </p>
            </div>
          </div>
        </div>

        {/* Mode Switcher Tabs */}
        <div className="flex items-center gap-2 bg-slate-100 p-1.5 rounded-xl border border-slate-200">
          <button
            type="button"
            onClick={() => setViewMode("consultation")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
              viewMode === "consultation"
                ? "bg-white text-health-navy shadow-sm"
                : "text-slate-600 hover:text-health-navy"
            }`}
          >
            <FaStethoscope className="text-health-blue" />
            <span>Consultation Queue</span>
          </button>
          <button
            type="button"
            onClick={() => setViewMode("directory")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all ${
              viewMode === "directory"
                ? "bg-white text-health-navy shadow-sm"
                : "text-slate-600 hover:text-health-navy"
            }`}
          >
            <FaClipboardList className="text-health-blue" />
            <span>Patient Directory</span>
          </button>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          VIEW MODE 1: DOCTOR CONSULTATION & ROOM QUEUE
      ───────────────────────────────────────────────────────────── */}
      {viewMode === "consultation" && (
        <div className="space-y-6">
          {/* ── Success Alert ── */}
          {consultationSuccess && (
            <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center justify-between gap-3 text-emerald-800 text-xs font-bold animate-fade-in">
              <div className="flex items-center gap-2">
                <FaCheckCircle className="text-base text-emerald-600" />
                <span>{consultationSuccess}</span>
              </div>
              <button onClick={() => setConsultationSuccess(null)} className="text-emerald-500 hover:text-emerald-700">
                <FaTimes />
              </button>
            </div>
          )}

          {/* ── CASE A: NO PATIENT SELECTED -> SHOW FULL WIDTH ROOM QUEUE ── */}
          {!selectedSession ? (
            <div className="space-y-6 animate-fade-in">
              {/* ── Unified Live Room Queue & Room Switcher Card ── */}
              <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                {/* Header with Title and Live Stats */}
                <div className="px-6 sm:px-8 pt-8 pb-6 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-white">
                  <div className="flex items-center gap-3.5">
                    <span className="p-3 bg-emerald-50 text-emerald-600 rounded-2xl text-lg">
                      <FaStethoscope />
                    </span>
                    <div>
                      <div className="flex items-center gap-2.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                        <h2 className="text-base font-black text-health-navy tracking-tight">Live Consultation &amp; Room Queue</h2>
                      </div>
                      <p className="text-xs text-slate-400 font-medium mt-1">
                        Real-time triage stream. Select a room to filter or click a patient to open their consultation desk.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 self-start md:self-auto">
                    <div className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 border border-slate-200/80 rounded-xl text-xs font-semibold text-slate-600">
                      <span>Total Active:</span>
                      <strong className="text-health-navy font-black">{activeSessions.length}</strong>
                    </div>
                    <div className="flex items-center gap-1.5 px-3 py-1.5 bg-health-blue/10 border border-health-blue/20 rounded-xl text-xs font-semibold text-health-blue">
                      <span>Filtered:</span>
                      <strong className="font-black">{filteredQueue.length}</strong>
                    </div>
                    {/* Collapse / Expand Room Tiles Toggle */}
                    <button
                      type="button"
                      onClick={() => setRoomsCollapsed((c) => !c)}
                      title={roomsCollapsed ? "Show room tiles" : "Hide room tiles"}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-xl text-xs font-bold text-slate-600 transition-all"
                    >
                      <span className={`transition-transform duration-300 ${roomsCollapsed ? "rotate-180" : ""}`}>⌃</span>
                      {roomsCollapsed ? "Expand" : "Collapse"}
                    </button>
                  </div>
                </div>

                {/* Modern Doctor Room Tiles Grid — collapsible */}
                <div
                  className={`overflow-hidden transition-all duration-300 ease-in-out ${
                    roomsCollapsed ? "max-h-0 opacity-0" : "max-h-[600px] opacity-100"
                  }`}
                >
                <div className="p-4 sm:p-5 bg-slate-50/40 border-b border-slate-100">
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                    {/* All Rooms Tile */}
                    <button
                      type="button"
                      onClick={() => setSelectedRoomId("all")}
                      className={`p-3.5 rounded-2xl text-left transition-all border flex flex-col justify-between ${
                        selectedRoomId === "all"
                          ? "bg-gradient-to-br from-health-blue to-[#0284c7] text-white border-health-blue shadow-lg shadow-health-blue/25 scale-[1.02]"
                          : "bg-white hover:bg-slate-50 text-slate-700 border-slate-200/90 hover:border-slate-300 shadow-2xs"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className={`px-2 py-0.5 rounded-md text-[9px] font-black tracking-wider uppercase ${
                          selectedRoomId === "all" ? "bg-white/20 text-white" : "bg-slate-100 text-slate-600"
                        }`}>
                          OVERVIEW
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-black transition-all ${
                          selectedRoomId === "all" ? "bg-white text-health-blue shadow-xs" : "bg-slate-100 text-slate-500"
                        }`}>
                          {activeSessions.length}
                        </span>
                      </div>
                      <div className="mt-2">
                        <div className="text-xs font-black">All Rooms</div>
                        <div className={`text-[10px] font-medium mt-0.5 truncate ${selectedRoomId === "all" ? "text-sky-100" : "text-slate-400"}`}>
                          {activeSessions.length} Total Patient{activeSessions.length !== 1 ? "s" : ""}
                        </div>
                      </div>
                    </button>

                    {/* Individual Room Tiles */}
                    {diseaseClasses.map((room) => {
                      const roomCount = activeSessions.filter(
                        (s) => s.assignedRoom && String(s.assignedRoom._id || s.assignedRoom) === String(room._id)
                      ).length;
                      const isSelected = String(selectedRoomId) === String(room._id);

                      return (
                        <button
                          key={room._id}
                          type="button"
                          onClick={() => setSelectedRoomId(room._id)}
                          className={`p-3.5 rounded-2xl text-left transition-all border flex flex-col justify-between ${
                            isSelected
                              ? "bg-gradient-to-br from-health-blue to-[#0284c7] text-white border-health-blue shadow-lg shadow-health-blue/25 scale-[1.02]"
                              : "bg-white hover:bg-slate-50 text-slate-700 border-slate-200/90 hover:border-slate-300 shadow-2xs"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className={`px-2 py-0.5 rounded-md text-[9px] font-black tracking-wider uppercase truncate ${diseaseTagClass(room.maladie, isSelected)}`}>
                              {room.maladie?.toUpperCase() || "GENERAL"}
                            </span>
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-black transition-all ${
                              isSelected
                                ? "bg-white text-health-blue shadow-xs"
                                : roomCount > 0
                                ? "bg-health-blue text-white shadow-xs"
                                : "bg-slate-100 text-slate-400"
                            }`}>
                              {roomCount}
                            </span>
                          </div>
                          <div className="mt-2">
                            <div className="text-xs font-black">Room {room.placeCode}</div>
                            {room.doctorId?.name && (
                              <div className={`text-[10px] font-bold truncate flex items-center gap-1 ${isSelected ? "text-sky-100" : "text-teal-700"}`}>
                                👨‍⚕️ Dr. {room.doctorId.name}
                              </div>
                            )}
                            <div className={`text-[10px] font-medium mt-0.5 truncate ${isSelected ? "text-sky-100" : "text-slate-400"}`}>
                              {roomCount > 0 ? `${roomCount} waiting` : "Empty / Available"}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
                </div>{/* end collapsible */}

                {filteredQueue.length === 0 ? (
                  <div className="p-12 text-center text-slate-400">
                    <span className="text-4xl block mb-2">🎉</span>
                    <p className="text-sm font-bold text-slate-600">No patients currently waiting in this room</p>
                    <p className="text-xs text-slate-400 mt-1">New arrivals from the diagnostic kiosk will appear here instantly.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-100 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                          <th className="py-3.5 px-4 w-12 text-center">#</th>
                          <th className="py-3.5 px-4">Token</th>
                          <th className="py-3.5 px-4">CIN</th>
                          <th className="py-3.5 px-4">Patient Name</th>
                          <th className="py-3.5 px-4">Priority</th>
                          <th className="py-3.5 px-4">Status</th>
                          <th className="py-3.5 px-4">Predicted Sickness</th>
                          <th className="py-3.5 px-4">Assigned Room & Doctor</th>
                          <th className="py-3.5 px-4 text-right">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredQueue.map((session, idx) => {
                          const isSelected = selectedSession?._id === session._id;
                          const patient = session.encounterId?.patientId;
                          const cin = patient?.cin || "—";
                          const patientName = patient?.name || "—";
                          const isCompleted = session.status === "completed";
                          const roomDoc = session.assignedRoom?.doctorId;

                          return (
                            <tr
                              key={session._id}
                              onClick={() => handleSelectToken(session)}
                              className={`cursor-pointer transition-all ${
                                isSelected
                                  ? "bg-health-blue/10 font-medium"
                                  : isCompleted
                                  ? "bg-slate-50/40 hover:bg-slate-50/80"
                                  : "hover:bg-slate-50/80"
                              }`}
                            >
                              <td className="py-4 px-4 text-center font-bold text-slate-400">
                                {idx + 1}
                              </td>
                              <td className="py-4 px-4">
                                <span className="inline-flex items-center gap-1.5 font-black text-sm text-health-navy">
                                  <span>🎫</span> #{session.tokenNumber}
                                </span>
                              </td>
                              <td className="py-4 px-4 font-bold text-slate-700">
                                {cin !== "—" ? (
                                  <span className="px-2.5 py-1 bg-slate-100 text-health-navy rounded-lg font-mono text-xs border border-slate-200">
                                    {cin}
                                  </span>
                                ) : (
                                  <span className="text-slate-400 font-normal">—</span>
                                )}
                              </td>
                              <td className="py-4 px-4 font-bold text-slate-800">
                                {patientName !== "—" ? (
                                  <span>{patientName}</span>
                                ) : (
                                  <span className="text-slate-400 font-normal italic">—</span>
                                )}
                              </td>
                              <td className="py-4 px-4">
                                {priorityBadge(session.priority)}
                              </td>
                              <td className="py-4 px-4">
                                {statusBadge(session.status)}
                              </td>
                              <td className="py-4 px-4 font-bold text-slate-700">
                                {session.prediction?.label || "General Assessment"}
                                {session.prediction?.confidence && (
                                  <span className="ml-1.5 text-[10px] font-normal text-slate-400">
                                    ({session.prediction.confidence}%)
                                  </span>
                                )}
                              </td>
                              <td className="py-4 px-4 text-slate-600 font-medium">
                                {session.assignedRoom?.placeCode ? (
                                  <div>
                                    <span className="font-bold text-slate-800">Room #{session.assignedRoom.placeCode}</span>
                                    {roomDoc?.name ? (
                                      <span className="block text-[10px] font-bold text-teal-700">
                                        👨‍⚕️ Dr. {roomDoc.name}
                                      </span>
                                    ) : null}
                                  </div>
                                ) : (
                                  <span className="text-slate-400">Waiting Buffer</span>
                                )}
                              </td>
                              <td className="py-4 px-4 text-right">
                                <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                                  <button
                                    type="button"
                                    onClick={() => handleSelectToken(session)}
                                    className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                                      isSelected
                                        ? "bg-health-blue text-white shadow-sm"
                                        : isCompleted
                                        ? "bg-slate-100 text-slate-700 hover:bg-slate-200 border border-slate-200"
                                        : "bg-health-blue/10 text-health-blue hover:bg-health-blue hover:text-white"
                                    }`}
                                  >
                                    {isSelected ? "Active Desk" : isCompleted ? "✏️ Edit" : "🩺 Attend"}
                                  </button>

                                  <button
                                    type="button"
                                    onClick={() => handleDeleteSession(session)}
                                    disabled={deletingSessionId === session._id}
                                    className="p-2 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 border border-transparent hover:border-rose-200 transition-all disabled:opacity-50"
                                    title={`Delete Token #${session.tokenNumber}`}
                                  >
                                    <FaTrash className="text-xs" />
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
          ) : (
            /* ── CASE B: PATIENT SELECTED -> SHOW FULL SCREEN CONSULTATION DESK ── */
            <div className="space-y-6 animate-fade-in">
              {/* Top Navigation Bar */}
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setSelectedSession(null)}
                  className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 hover:bg-slate-50 shadow-xs transition-all"
                >
                  <FaArrowLeft className="text-xs text-health-blue" />
                  <span>Back to Room Queue</span>
                </button>

                <div className="text-xs font-bold text-slate-500 flex items-center gap-2">
                  <span>Room: <span className="text-health-navy font-black">{selectedSession.assignedRoom?.placeCode ? `Room ${selectedSession.assignedRoom.placeCode}` : "Waiting Buffer"}</span></span>
                  {selectedSession.assignedRoom?.doctorId?.name && (
                    <span className="text-[11px] font-bold text-teal-700 bg-teal-50 px-2.5 py-0.5 rounded-full border border-teal-200">
                      👨‍⚕️ Dr. {selectedSession.assignedRoom.doctorId.name}
                    </span>
                  )}
                </div>
              </div>

              {/* Consultation Desk Form (Full Screen / Full Width) */}
              <div className="bg-white rounded-2xl border border-slate-100 shadow-xl p-6 sm:p-8 space-y-6">
                {/* Desk Header */}
                <div className="flex items-center justify-between border-b border-slate-100 pb-4">
                  <div className="flex items-center gap-3">
                    <div className="p-3 bg-health-blue/10 text-health-blue rounded-2xl text-2xl">🩺</div>
                    <div>
                      <div className="flex items-center gap-2.5">
                        <h2 className="text-lg font-black text-health-navy">
                          Consultation Desk — Token #{selectedSession.tokenNumber}
                        </h2>
                        {priorityBadge(selectedSession.priority)}
                        {statusBadge(selectedSession.status)}
                      </div>
                      <p className="text-xs text-slate-500 font-medium mt-0.5">
                        {selectedSession.assignedRoom?.placeCode
                          ? `Assigned to Room ${selectedSession.assignedRoom.placeCode} (${selectedSession.assignedRoom.maladie?.toUpperCase()})`
                          : "Waiting Buffer"}
                        {selectedSession.assignedRoom?.doctorId?.name
                          ? ` — Attending: Dr. ${selectedSession.assignedRoom.doctorId.name}`
                          : ""}
                      </p>
                    </div>
                  </div>

                  <button
                    onClick={() => setSelectedSession(null)}
                    className="text-slate-400 hover:text-slate-600 p-2 rounded-xl hover:bg-slate-100 transition-all"
                    title="Close Desk"
                  >
                    <FaTimes className="text-lg" />
                  </button>
                </div>

                {consultationError && (
                  <div className="p-4 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 font-bold flex items-center gap-2">
                    <FaExclamationTriangle className="text-rose-500 shrink-0" />
                    <span>{consultationError}</span>
                  </div>
                )}

                {/* ── Step 1: Patient CIN & Demographics ── */}
                <div className="space-y-4 bg-slate-50/60 p-5 rounded-2xl border border-slate-100">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-black uppercase tracking-wider text-health-navy flex items-center gap-1.5">
                      <FaIdCard className="text-health-blue" />
                      <span>1. Patient Identification (CIN)</span>
                    </h3>
                    {isExistingPatient ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">
                        <FaCheckCircle className="text-xs" /> Existing Patient
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800">
                        <FaUserPlus className="text-xs" /> New Patient Registration
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {/* CIN Search with Autocomplete Dropdown */}
                    <div className="relative">
                      <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                        National CIN Number *
                      </label>
                      <div className="relative">
                        <input
                          type="text"
                          value={cinQuery}
                          onChange={(e) => handleCinInputChange(e.target.value)}
                          onFocus={() => {
                            if (cinSuggestions.length > 0) setShowCinDropdown(true);
                          }}
                          placeholder="Type CIN (e.g. 12345678)..."
                          className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-health-blue"
                        />
                        <FaSearch className="absolute right-3.5 top-3 text-slate-400 text-xs" />
                      </div>

                      {/* Autocomplete Dropdown */}
                      {showCinDropdown && cinSuggestions.length > 0 && (
                        <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-xl z-30 max-h-48 overflow-y-auto divide-y divide-slate-100">
                          {cinSuggestions.map((s) => (
                            <button
                              key={s._id}
                              type="button"
                              onClick={() => autoFillPatient(s)}
                              className="w-full text-left px-3.5 py-2.5 text-xs hover:bg-health-blue/10 flex items-center justify-between transition-all"
                            >
                              <div>
                                <span className="font-bold text-health-navy">{s.cin}</span>
                                <span className="text-slate-500 ml-2">{s.name}</span>
                              </div>
                              <span className="text-[10px] text-slate-400">{s.phone || "No phone"}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Full Name */}
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                        Full Name *
                      </label>
                      <input
                        type="text"
                        value={patientForm.name}
                        onChange={(e) => setPatientForm({ ...patientForm, name: e.target.value })}
                        placeholder="Patient Full Name"
                        className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-health-blue"
                      />
                    </div>

                    {/* Date of Birth */}
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                        Date of Birth {patientForm.dateOfBirth && `(${calcAge(patientForm.dateOfBirth)} yrs)`}
                      </label>
                      <input
                        type="date"
                        value={patientForm.dateOfBirth}
                        onChange={(e) => setPatientForm({ ...patientForm, dateOfBirth: e.target.value })}
                        className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-health-blue"
                      />
                    </div>

                    {/* Gender */}
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                        Gender
                      </label>
                      <select
                        value={patientForm.gender}
                        onChange={(e) => setPatientForm({ ...patientForm, gender: e.target.value })}
                        className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-health-blue"
                      >
                        <option value="male">Male</option>
                        <option value="female">Female</option>
                        <option value="other">Other</option>
                      </select>
                    </div>

                    {/* Phone Number */}
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                        Phone Number
                      </label>
                      <input
                        type="text"
                        value={patientForm.phone}
                        onChange={(e) => setPatientForm({ ...patientForm, phone: e.target.value })}
                        placeholder="+216 XX XXX XXX"
                        className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-health-blue"
                      />
                    </div>

                    {/* Blood Type */}
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                        Blood Type
                      </label>
                      <input
                        type="text"
                        value={patientForm.bloodType}
                        onChange={(e) => setPatientForm({ ...patientForm, bloodType: e.target.value })}
                        placeholder="e.g. O+, A+, B-"
                        className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-health-blue"
                      />
                    </div>
                  </div>
                </div>

                {/* ── Patient Past History (Displayed if Existing Patient) ── */}
                {isExistingPatient && (
                  <div className="space-y-3 bg-amber-50/50 p-5 rounded-2xl border border-amber-200/80 shadow-xs animate-fade-in">
                    <div className="flex items-center justify-between border-b border-amber-200/60 pb-2.5">
                      <div className="flex items-center gap-2">
                        <span className="p-2 bg-amber-100 text-amber-800 rounded-xl text-xs font-bold">
                          <FaHistory />
                        </span>
                        <div>
                          <h3 className="text-xs font-black uppercase tracking-wider text-amber-900">
                            Patient Past Medical &amp; Consultation History
                          </h3>
                          <p className="text-[11px] text-amber-800/80 font-medium">
                            Previous visits, diagnosed diseases, symptoms, and medical notes on record.
                          </p>
                        </div>
                      </div>
                      <span className="px-3 py-1 bg-amber-100 text-amber-900 rounded-xl text-xs font-extrabold border border-amber-200">
                        {existingPatientRecord?.history?.length || 0} Previous Visit(s)
                      </span>
                    </div>

                    {existingPatientRecord?.history && existingPatientRecord.history.length > 0 ? (
                      <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
                        <VisitHistoryList history={existingPatientRecord.history} onEdit={null} />
                      </div>
                    ) : (
                      <div className="p-4 text-center text-xs text-amber-800/80 bg-white/70 rounded-xl border border-amber-100 italic">
                        No previous consultation visits recorded in this clinic archive yet.
                      </div>
                    )}
                  </div>
                )}

                {/* ── Step 2: 25-Question Kiosk Triage Checklist ── */}
                <div className="space-y-3 bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                    <div>
                      <h3 className="text-xs font-black uppercase tracking-wider text-health-navy flex items-center gap-1.5">
                        <FaCheckCircle className="text-emerald-500" />
                        <span>2. Kiosk Triage Questionnaire Checklist</span>
                      </h3>
                      <p className="text-[11px] text-slate-500">
                        Questions where the patient answered &quot;YES&quot; at the kiosk are highlighted and checked.
                      </p>
                    </div>

                    <span className="px-3 py-1 bg-emerald-50 text-emerald-700 rounded-xl text-xs font-bold border border-emerald-200">
                      {Object.values(checkedSymptoms).filter(Boolean).length} / {DIAGNOSTIC_QUESTIONS.length} Symptoms Reported
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-64 overflow-y-auto pr-1">
                    {DIAGNOSTIC_QUESTIONS.map((q) => {
                      const isChecked = Boolean(checkedSymptoms[q.key]);
                      return (
                        <label
                          key={q.key}
                          className={`flex items-start gap-2.5 p-3 rounded-xl border text-xs cursor-pointer transition-all ${
                            isChecked
                              ? "bg-emerald-50/80 border-emerald-300 text-emerald-950 font-bold shadow-xs"
                              : "bg-slate-50/50 border-slate-200 text-slate-600 hover:bg-slate-100/50"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) =>
                              setCheckedSymptoms({ ...checkedSymptoms, [q.key]: e.target.checked })
                            }
                            className="mt-0.5 rounded text-emerald-600 focus:ring-emerald-500 h-4 w-4"
                          />
                          <div className="flex-1 leading-tight">
                            <span className="block">{q.label}</span>
                            {isChecked && (
                              <span className="inline-block mt-0.5 text-[10px] font-extrabold uppercase text-emerald-700">
                                ✓ Yes reported
                              </span>
                            )}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* ── Step 3: Clinical Findings & Medication Prescriptions ── */}
                <div className="space-y-4 bg-slate-50/60 p-5 rounded-2xl border border-slate-100">
                  <h3 className="text-xs font-black uppercase tracking-wider text-health-navy flex items-center gap-1.5">
                    <FaNotesMedical className="text-health-blue" />
                    <span>3. Clinical Findings &amp; Confirmed Diagnosis</span>
                  </h3>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* AI Prediction summary */}
                    <div className="p-3.5 bg-white border border-slate-200 rounded-xl text-xs space-y-1">
                      <span className="text-[10px] font-bold text-slate-400 uppercase">AI Kiosk Prediction</span>
                        <div className="font-bold text-health-navy text-sm">
                        {selectedSession.prediction?.label || "General Assessment"}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Confidence: <span className="font-bold">{selectedSession.prediction?.confidence || 95}%</span> | Priority: {selectedSession.priority}
                      </div>
                    </div>

                    {/* Confirmed Diagnosis Input */}
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                        Doctor Confirmed Diagnosis *
                      </label>
                      <input
                        type="text"
                        value={confirmedDiagnosis}
                        onChange={(e) => setConfirmedDiagnosis(e.target.value)}
                        placeholder="e.g. Tuberculosis Active Stage 1"
                        className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-health-blue"
                      />
                    </div>
                  </div>

                  {/* Clinical Notes */}
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">
                      Clinical &amp; Consultation Notes
                    </label>
                    <textarea
                      rows={3}
                      value={clinicalNotes}
                      onChange={(e) => setClinicalNotes(e.target.value)}
                      placeholder="Add clinical observations, recommendations, follow-up instructions..."
                      className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-medium text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-health-blue"
                    />
                  </div>

                  {/* Medication Prescriptions Builder */}
                  <div className="space-y-2.5 pt-2 border-t border-slate-200/80">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-bold text-slate-600 uppercase flex items-center gap-1.5">
                        <FaPills className="text-purple-500" /> Prescribe Medications
                      </label>
                      <button
                        type="button"
                        onClick={addPrescriptionRow}
                        className="flex items-center gap-1 px-3 py-1.5 bg-purple-50 text-purple-700 hover:bg-purple-100 rounded-xl text-xs font-bold transition-all"
                      >
                        <FaPlus className="text-[10px]" /> Add Drug
                      </button>
                    </div>

                    {prescriptions.length === 0 ? (
                      <p className="text-[11px] text-slate-400 italic">No medications prescribed yet for this visit.</p>
                    ) : (
                      <div className="space-y-2">
                        {prescriptions.map((p, idx) => (
                          <div key={idx} className="flex flex-col gap-2 bg-white p-3 rounded-xl border border-slate-200 text-xs">
                            {/* Row 1: Drug + Strength + Qty + Delete */}
                            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">

                              {/* Drug Name — from pharmacy inventory */}
                              <div className="flex-1 min-w-0">
                                {availableMeds.length > 0 && (
                                  <select
                                    value={p._isCustom ? "__custom__" : p.drug_name}
                                    onChange={(e) => {
                                      const val = e.target.value;
                                      if (val === "__custom__") {
                                        updatePrescriptionRow(idx, "_isCustom", true);
                                        updatePrescriptionRow(idx, "drug_name", "");
                                      } else {
                                        updatePrescriptionRow(idx, "_isCustom", false);
                                        updatePrescriptionRow(idx, "drug_name", val);
                                      }
                                    }}
                                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-purple-300"
                                  >
                                    {availableMeds.map((m) => {
                                      const name = m.drug_name || "Unnamed Drug";
                                      const strength = m.strength && m.strength !== "N/A" ? m.strength : "";
                                      const stock = m.quantity ?? 0;
                                      return (
                                        <option key={m._id} value={name}>
                                          {stock <= 5 ? "⚠️ " : ""}{name}{strength ? ` (${strength})` : ""} — {stock} in stock
                                        </option>
                                      );
                                    })}
                                    <option value="__custom__">✏️ Custom Drug (not in pharmacy)...</option>
                                  </select>
                                )}
                                {/* Free-text input when no inventory OR custom selected */}
                                {(availableMeds.length === 0 || p._isCustom) && (
                                  <input
                                    type="text"
                                    value={p.drug_name}
                                    onChange={(e) => updatePrescriptionRow(idx, "drug_name", e.target.value)}
                                    placeholder="Type drug name..."
                                    className="w-full px-3 py-2 bg-purple-50 border border-purple-300 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-purple-300 mt-1"
                                  />
                                )}
                              </div>

                              {/* Strength — auto-filled from pharmacy */}
                              <input
                                type="text"
                                value={p.strength || ""}
                                onChange={(e) => updatePrescriptionRow(idx, "strength", e.target.value)}
                                placeholder="Strength (500mg)"
                                className="w-full sm:w-28 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-purple-300"
                              />

                              {/* Quantity */}
                              <input
                                type="number"
                                min="1"
                                value={p.quantity}
                                onChange={(e) => updatePrescriptionRow(idx, "quantity", Number(e.target.value))}
                                className="w-full sm:w-16 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs text-center font-bold focus:outline-none focus:ring-2 focus:ring-purple-300"
                              />

                              <button
                                type="button"
                                onClick={() => removePrescriptionRow(idx)}
                                className="text-rose-400 hover:text-rose-600 p-2 flex-shrink-0"
                                title="Remove Drug"
                              >
                                <FaTrash className="text-xs" />
                              </button>
                            </div>

                            {/* Row 2: Instructions */}
                            <input
                              type="text"
                              value={p.instructions}
                              onChange={(e) => updatePrescriptionRow(idx, "instructions", e.target.value)}
                              placeholder="Directions (e.g. 1 tab 3x/day after meals)"
                              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-purple-300"
                            />

                            {/* Stock status */}
                            {(() => {
                              const med = availableMeds.find(m => m.drug_name === p.drug_name);
                              if (!med) return null;
                              if (med.quantity === 0) return (
                                <p className="text-[10px] text-rose-500 font-bold">🚫 Out of stock — not available in pharmacy</p>
                              );
                              if (med.quantity <= 5) return (
                                <p className="text-[10px] text-amber-600 font-bold">⚠️ Low stock — only {med.quantity} units left</p>
                              );
                              return (
                                <p className="text-[10px] text-emerald-600">✅ {med.quantity} units available in pharmacy</p>
                              );
                            })()}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* ── Action Footer ── */}
                <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setSelectedSession(null)}
                    className="px-5 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50"
                  >
                    Cancel
                  </button>

                  <button
                    type="button"
                    disabled={isSavingConsultation}
                    onClick={handleFinishConsultation}
                    className="flex items-center gap-2 px-7 py-2.5 bg-health-blue hover:bg-health-sky text-white rounded-xl text-xs font-extrabold shadow-md shadow-health-blue/20 transition-all disabled:opacity-50"
                  >
                    {isSavingConsultation ? (
                      <>
                        <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                        <span>{selectedSession.status === "completed" ? "Saving Changes..." : "Saving & Discharging..."}</span>
                      </>
                    ) : selectedSession.status === "completed" ? (
                      <>
                        <FaCheck className="text-xs" />
                        <span>💾 Save &amp; Update Changes</span>
                      </>
                    ) : (
                      <>
                        <FaCheck className="text-xs" />
                        <span>Complete Consultation &amp; Discharge</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          VIEW MODE 2: ALL PATIENTS DIRECTORY (FILTERED BY CLASS)
      ───────────────────────────────────────────────────────────── */}
      {viewMode === "directory" && (
        <div className="space-y-6">
          {/* ── Search & Disease Class Filters Bar ── */}
          <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="relative w-full md:w-80">
              <input
                type="text"
                value={patientSearch}
                onChange={(e) => setPatientSearch(e.target.value)}
                placeholder="Search by CIN, Name, Phone..."
                className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-health-blue"
              />
              <FaSearch className="absolute left-3 top-2.5 text-slate-400 text-xs" />
            </div>

            {/* Disease Class Filter Dropdown */}
            <div className="flex items-center gap-2 w-full md:w-auto">
              <span className="text-xs font-bold text-slate-500 uppercase">Filter Class:</span>
              <select
                value={classFilter}
                onChange={(e) => setClassFilter(e.target.value)}
                className="px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-health-blue"
              >
                <option value="all">All Sickness Classes ({patients.length})</option>
                <option value="tuber">Tuberculosis</option>
                <option value="malaria">Malaria</option>
                <option value="cida">HIV / AIDS</option>
                <option value="general">General / Other</option>
              </select>
            </div>
          </div>

          {/* ── Patients Table ── */}
          <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-xs font-black uppercase tracking-wider text-slate-700">Patient Database</h2>
              <span className="text-xs font-bold text-slate-400">
                {filteredDirectoryPatients.length} record(s) found
              </span>
            </div>

            {isLoadingPatients ? (
              <div className="p-12 text-center text-slate-400">
                <span className="w-8 h-8 border-2 border-health-blue border-t-transparent rounded-full animate-spin inline-block mb-2" />
                <p className="text-xs font-bold">Loading patient records...</p>
              </div>
            ) : filteredDirectoryPatients.length === 0 ? (
              <div className="p-12 text-center text-slate-400">
                <p className="text-sm font-bold text-slate-600">No patients match your search criteria</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-100 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      <th className="py-3 px-4">CIN</th>
                      <th className="py-3 px-4">Patient Name</th>
                      <th className="py-3 px-4">Age / Gender</th>
                      <th className="py-3 px-4">Phone</th>
                      <th className="py-3 px-4">Blood Type</th>
                      <th className="py-3 px-4">Visits Count</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredDirectoryPatients.map((patient) => {
                      const age = calcAge(patient.dateOfBirth);
                      const visitsCount = patient.history?.length || 0;

                      return (
                        <tr
                          key={patient._id}
                          className="hover:bg-slate-50/80 transition-all cursor-pointer"
                          onClick={() => setDirectoryPatientModal(patient)}
                        >
                          <td className="py-3.5 px-4 font-black text-health-navy">
                            {patient.cin}
                          </td>
                          <td className="py-3.5 px-4 font-bold text-slate-800">
                            {patient.name}
                          </td>
                          <td className="py-3.5 px-4 text-slate-600">
                            {age !== null ? `${age} yrs` : "—"} / {GENDER_LABELS[patient.gender] || "Other"}
                          </td>
                          <td className="py-3.5 px-4 text-slate-600 font-medium">
                            {patient.phone || "—"}
                          </td>
                          <td className="py-3.5 px-4">
                            {patient.bloodType ? (
                              <span className="px-2 py-0.5 bg-rose-50 text-rose-700 rounded-md font-bold text-[11px] border border-rose-200">
                                {patient.bloodType}
                              </span>
                            ) : "—"}
                          </td>
                          <td className="py-3.5 px-4 font-bold text-health-blue">
                            {visitsCount} visit(s)
                          </td>
                          <td className="py-3.5 px-4 text-right">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setDirectoryPatientModal(patient);
                              }}
                              className="px-3 py-1.5 bg-slate-100 text-slate-700 hover:bg-health-blue hover:text-white rounded-xl text-xs font-bold transition-all"
                            >
                              View History
                            </button>
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
      )}

      {/* ── Modal: Patient Full History in Directory ── */}
      {directoryPatientModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full p-6 space-y-6 shadow-2xl border border-slate-100 max-h-[90vh] overflow-y-auto animate-scale-in">
            <div className="flex items-start justify-between border-b border-slate-100 pb-4">
              <div>
                <span className="px-2.5 py-0.5 bg-health-blue/10 text-health-blue rounded-full text-xs font-bold">
                  CIN: {directoryPatientModal.cin}
                </span>
                <h2 className="text-lg font-black text-health-navy mt-1">{directoryPatientModal.name}</h2>
                <p className="text-xs text-slate-500">
                  {GENDER_LABELS[directoryPatientModal.gender] || "Other"} | {calcAge(directoryPatientModal.dateOfBirth) || "—"} years old | Phone: {directoryPatientModal.phone || "None"}
                </p>
              </div>

              <button
                onClick={() => setDirectoryPatientModal(null)}
                className="text-slate-400 hover:text-slate-600 p-1.5"
              >
                <FaTimes className="text-base" />
              </button>
            </div>

            {/* Medical History List */}
            <div className="space-y-3">
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                <FaHistory className="text-health-blue" />
                <span>Consultation & Medical Records ({directoryPatientModal.history?.length || 0})</span>
              </h3>

              <div className="space-y-2">
                <VisitHistoryList history={directoryPatientModal.history || []} onEdit={null} />
              </div>
            </div>

            <div className="flex justify-end pt-4 border-t border-slate-100">
              <button
                onClick={() => setDirectoryPatientModal(null)}
                className="px-5 py-2 bg-slate-100 text-slate-700 rounded-xl text-xs font-bold hover:bg-slate-200"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal: Add Patient Manually ── */}
      {showAddPatientModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-5 shadow-2xl border border-slate-100 animate-scale-in">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h2 className="text-base font-black text-health-navy flex items-center gap-2">
                <FaUserPlus className="text-health-blue" />
                <span>Register New Patient</span>
              </h2>
              <button onClick={() => setShowAddPatientModal(false)} className="text-slate-400 hover:text-slate-600">
                <FaTimes />
              </button>
            </div>

            {addPatientError && (
              <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs text-rose-800 font-bold">
                {addPatientError}
              </div>
            )}

            <form onSubmit={handleCreatePatientManual} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">CIN Number *</label>
                  <input
                    type="text"
                    required
                    value={addPatientForm.cin}
                    onChange={(e) => setAddPatientForm({ ...addPatientForm, cin: e.target.value.toUpperCase() })}
                    placeholder="CIN"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">Full Name *</label>
                  <input
                    type="text"
                    required
                    value={addPatientForm.name}
                    onChange={(e) => setAddPatientForm({ ...addPatientForm, name: e.target.value })}
                    placeholder="Full Name"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">Date of Birth</label>
                  <input
                    type="date"
                    value={addPatientForm.dateOfBirth}
                    onChange={(e) => setAddPatientForm({ ...addPatientForm, dateOfBirth: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">Gender</label>
                  <select
                    value={addPatientForm.gender}
                    onChange={(e) => setAddPatientForm({ ...addPatientForm, gender: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                  >
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">Phone</label>
                  <input
                    type="text"
                    value={addPatientForm.phone}
                    onChange={(e) => setAddPatientForm({ ...addPatientForm, phone: e.target.value })}
                    placeholder="+216 XX XXX XXX"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 uppercase mb-1">Blood Type</label>
                  <input
                    type="text"
                    value={addPatientForm.bloodType}
                    onChange={(e) => setAddPatientForm({ ...addPatientForm, bloodType: e.target.value })}
                    placeholder="e.g. A+"
                    className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setShowAddPatientModal(false)}
                  className="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl text-xs font-bold hover:bg-slate-200"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreatingPatient}
                  className="px-5 py-2 bg-health-blue text-white rounded-xl text-xs font-bold hover:bg-health-sky transition-all"
                >
                  {isCreatingPatient ? "Creating..." : "Save Patient"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
