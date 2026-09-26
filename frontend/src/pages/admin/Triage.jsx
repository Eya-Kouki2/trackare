import api from "../../api/axios";
import { useEffect, useMemo, useState, useCallback } from "react";
import { useOutletContext, useNavigate } from "react-router-dom";
import {
  FaTimes, FaSearch, FaUserPlus, FaCheckCircle,
  FaPills, FaNotesMedical, FaClock, FaCalendarAlt,
  FaStethoscope, FaHistory, FaCheck, FaPlus, FaTrash
} from "react-icons/fa";
import { COMMON_SYMPTOMS } from "../../utils/triagePredict";

const emptyVitals = {
  temperature: "",
  pulse: "",
  bloodPressure: "",
  weight: "",
  height: "",
};

const emptyPatientForm = {
  cin: "",
  name: "",
  dateOfBirth: "",
  gender: "other",
  phone: "",
  bloodType: "",
  address: "",
};

const toInputDate = (date) => {
  if (!date) return "";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().split("T")[0];
};

const Section = ({ title, icon, badge, children }) => (
  <div className="admin-card overflow-hidden">
    <div
      className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between"
      style={{ background: "linear-gradient(90deg,#f8fafc,#f1f5f9)" }}
    >
      <div className="flex items-center gap-2.5">
        {icon && <span className="text-base">{icon}</span>}
        <h2 className="text-[11px] font-bold uppercase tracking-[0.1em] text-slate-700">{title}</h2>
      </div>
      {badge && <div>{badge}</div>}
    </div>
    <div className="p-5 sm:p-6">{children}</div>
  </div>
);

export default function Triage() {
  const { user } = useOutletContext();
  const navigate = useNavigate();

  // Active Tokens Queue
  const [activeSessions, setActiveSessions] = useState([]);
  const [selectedToken, setSelectedToken] = useState(null);
  const [currentSession, setCurrentSession] = useState(null);
  const [currentEncounter, setCurrentEncounter] = useState(null);

  // Patient & CIN Search
  const [cinQuery, setCinQuery] = useState("");
  const [cinSuggestions, setCinSuggestions] = useState([]);
  const [showCinDropdown, setShowCinDropdown] = useState(false);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [isNewPatient, setIsNewPatient] = useState(false);
  const [patientForm, setPatientForm] = useState(emptyPatientForm);
  const [pastEncounters, setPastEncounters] = useState([]);

  // Clinical & Triage state
  const [selectedSymptoms, setSelectedSymptoms] = useState([]);
  const [vitals, setVitals] = useState(emptyVitals);
  const [confirmedDiagnosis, setConfirmedDiagnosis] = useState("");
  const [clinicalNotes, setClinicalNotes] = useState("");
  const [prescriptions, setPrescriptions] = useState([]);
  const [availableMeds, setAvailableMeds] = useState([]);

  // UI state
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);
  const [consultationCompleted, setConsultationCompleted] = useState(false);

  // 1. Fetch Active Sessions Queue
  const fetchActiveQueue = useCallback(async () => {
    if (!user?.area) return;
    try {
      const areaId = user.area?._id || user.area;
      const { data } = await api.get(`/api/triage-sessions/active?areaId=${areaId}`);
      if (data.success) {
        setActiveSessions(data.sessions || []);
      }
    } catch (err) {
      console.error("Failed to load active queue:", err);
    }
  }, [user?.area]);

  // 2. Fetch Pharmacy Medications for prescription builder
  const fetchMedications = useCallback(async () => {
    try {
      const { data } = await api.get("/api/pharmacy");
      setAvailableMeds(data.medications || []);
    } catch {
      // Non-blocking
    }
  }, []);

  useEffect(() => {
    fetchActiveQueue();
    fetchMedications();

    // Fast poll every 2s
    const interval = setInterval(fetchActiveQueue, 2000);
    window.addEventListener("alerts-updated", fetchActiveQueue);

    // SSE listener for instant cross-browser queue updates
    const isDev = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
    const sseUrl = isDev ? "http://localhost:5000/api/result/stream" : "/api/result/stream";
    const sse = new EventSource(sseUrl);

    sse.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (
          data.type === "TOKEN_CREATED" ||
          data.type === "WAITING_PATIENT_ASSIGNED" ||
          data.type === "CAPACITY_OVERFLOW_ALERT" ||
          data.type === "CONSULTATION_COMPLETED"
        ) {
          fetchActiveQueue();
        }
      } catch (err) {
        console.error("SSE parse error in Triage queue:", err);
      }
    };

    return () => {
      clearInterval(interval);
      window.removeEventListener("alerts-updated", fetchActiveQueue);
      sse.close();
    };
  }, [fetchActiveQueue, fetchMedications]);

  // 3. Search CIN Autocomplete
  useEffect(() => {
    const query = cinQuery.trim();
    if (!query) {
      setCinSuggestions([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const { data } = await api.get(`/api/patients/search?query=${encodeURIComponent(query)}`);
        setCinSuggestions(data.patients || []);
      } catch (err) {
        console.error("CIN search error:", err);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [cinQuery]);

  // 4. Select Token from Queue
  const handleSelectToken = async (session) => {
    setErrorMessage(null);
    setMessage(null);
    setConsultationCompleted(false);
    setSelectedToken(session.tokenNumber);

    try {
      // Mark token as in_consultation
      await api.post(`/api/triage-sessions/${session._id}/attend`);
      
      // Fetch full session details
      const areaId = user.area?._id || user.area;
      const { data } = await api.get(`/api/triage-sessions/by-token/${session.tokenNumber}?areaId=${areaId}`);
      const s = data.session;
      setCurrentSession(s);
      setCurrentEncounter(s.encounterId);

      // Pre-populate AI Triage data
      setSelectedSymptoms(s.symptoms || []);
      setVitals(s.vitals || emptyVitals);
      setConfirmedDiagnosis(s.prediction?.label || "");
      setClinicalNotes("");
      setPrescriptions([]);

      // If patient was already linked
      if (s.encounterId?.patientId) {
        const p = s.encounterId.patientId;
        setSelectedPatient(p);
        setPatientForm({
          cin: p.cin || "",
          name: p.name || "",
          dateOfBirth: toInputDate(p.dateOfBirth),
          gender: p.gender || "other",
          phone: p.phone || "",
          bloodType: p.bloodType || "",
          address: p.address || "",
        });
        setIsNewPatient(false);
        setCinQuery(p.cin);

        // Load past encounters
        const encRes = await api.get(`/api/patients/by-cin/${p.cin}`);
        setPastEncounters((encRes.data.encounters || []).filter(e => e._id !== s.encounterId._id));
      } else {
        // Reset patient form
        setSelectedPatient(null);
        setIsNewPatient(false);
        setPatientForm(emptyPatientForm);
        setCinQuery("");
        setPastEncounters([]);
      }

      fetchActiveQueue();
    } catch (err) {
      console.error("Error selecting token:", err);
      setErrorMessage("Failed to load session for Token #" + session.tokenNumber);
    }
  };

  // 5. Link Existing Patient
  const handleSelectExistingPatient = async (patient) => {
    setSelectedPatient(patient);
    setIsNewPatient(false);
    setCinQuery(patient.cin);
    setShowCinDropdown(false);
    setPatientForm({
      cin: patient.cin || "",
      name: patient.name || "",
      dateOfBirth: toInputDate(patient.dateOfBirth),
      gender: patient.gender || "other",
      phone: patient.phone || "",
      bloodType: patient.bloodType || "",
      address: patient.address || "",
    });

    if (currentSession) {
      try {
        const { data } = await api.post(`/api/triage-sessions/${currentSession._id}/link-patient`, {
          cin: patient.cin,
        });
        setPastEncounters(data.pastEncounters || []);
        setCurrentEncounter(data.currentEncounter);
        setMessage(`Linked Encounter to patient ${patient.name} (${patient.cin})`);
      } catch (err) {
        setErrorMessage("Failed to link patient: " + (err.response?.data?.error || err.message));
      }
    }
  };

  // 6. Handle New Patient Registration & Linking
  const handleRegisterNewPatient = async () => {
    if (!patientForm.cin || !patientForm.name) {
      setErrorMessage("CIN and Patient Name are required.");
      return;
    }
    if (!currentSession) {
      setErrorMessage("Please select a Token first.");
      return;
    }

    try {
      setIsSaving(true);
      setErrorMessage(null);
      const { data } = await api.post(`/api/triage-sessions/${currentSession._id}/link-patient`, patientForm);
      setSelectedPatient(data.patient);
      setIsNewPatient(false);
      setPastEncounters(data.pastEncounters || []);
      setCurrentEncounter(data.currentEncounter);
      setMessage(`New patient profile created and linked to Token #${currentSession.tokenNumber}`);
    } catch (err) {
      setErrorMessage("Failed to register patient: " + (err.response?.data?.error || err.message));
    } finally {
      setIsSaving(false);
    }
  };

  // 7. Prescription Builder Handlers
  const addPrescriptionRow = () => {
    setPrescriptions((prev) => [
      ...prev,
      { drug_name: availableMeds[0]?.drug_name || "", strength: availableMeds[0]?.strength || "", quantity: 1, instructions: "" },
    ]);
  };

  const updatePrescriptionRow = (index, field, value) => {
    setPrescriptions((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  };

  const removePrescriptionRow = (index) => {
    setPrescriptions((prev) => prev.filter((_, i) => i !== index));
  };

  // 8. FINAL DISCHARGE: Finish Consultation
  const handleFinishConsultation = async () => {
    if (!currentSession) {
      setErrorMessage("No active token session selected.");
      return;
    }
    if (!selectedPatient) {
      setErrorMessage("Please link or register a Patient CIN before finishing consultation.");
      return;
    }

    try {
      setIsSaving(true);
      setErrorMessage(null);

      await api.post(`/api/triage-sessions/${currentSession._id}/complete`, {
        confirmedDiagnosis,
        clinicalNotes,
        prescriptions,
      });

      setConsultationCompleted(true);
      setMessage(`Encounter for Token #${currentSession.tokenNumber} successfully completed and patient discharged!`);
      
      // Refresh queues and clear active token
      fetchActiveQueue();
      setTimeout(() => {
        setSelectedToken(null);
        setCurrentSession(null);
        setCurrentEncounter(null);
        setSelectedPatient(null);
        setPatientForm(emptyPatientForm);
        setCinQuery("");
        setPastEncounters([]);
        setConsultationCompleted(false);
        setMessage(null);
      }, 3500);

    } catch (err) {
      setErrorMessage("Failed to complete consultation: " + (err.response?.data?.error || err.message));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="w-full max-w-5xl mx-auto space-y-6 animate-fade-in pb-16">
      
      {/* ── HEADER BANNER ── */}
      <div className="admin-card p-6 rounded-3xl" style={{ background: "linear-gradient(135deg,#03045e,#0077b6)" }}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-white/15 border border-white/20 flex items-center justify-center text-3xl shrink-0">
              🩺
            </div>
            <div>
              <h1 className="text-xl font-black text-white">Clinical Triage &amp; Consultation</h1>
              <p className="text-xs text-cyan-100 mt-0.5">
                Token-based patient care, AI diagnosis review, e-Prescriptions &amp; final discharge
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-cyan-200 bg-white/10 px-3 py-1.5 rounded-xl border border-white/20">
              {activeSessions.length} Active in Queue
            </span>
          </div>
        </div>
      </div>

      {/* ── ACTIVE TOKEN QUEUE BAR ── */}
      <div className="admin-card p-5 rounded-2xl">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-black uppercase tracking-wider text-slate-400 flex items-center gap-2">
            <FaClock className="text-health-blue" /> Live Patient Tokens Queue
          </span>
          <button onClick={fetchActiveQueue} className="text-xs text-health-blue hover:underline font-bold">
            Refresh Queue
          </button>
        </div>

        {activeSessions.length === 0 ? (
          <div className="py-6 text-center text-slate-400 text-xs font-semibold">
            No active tokens in queue. Run a test at the AI Kiosk or Detect Sickness screen.
          </div>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-2 pt-1 scrollbar-thin">
            {activeSessions.map((s) => {
              const isSelected = selectedToken === s.tokenNumber;
              const isWaiting = s.status === "waiting_room";
              return (
                <button
                  key={s._id}
                  onClick={() => handleSelectToken(s)}
                  className={`shrink-0 text-left p-3.5 rounded-2xl border-2 transition-all min-w-[170px] ${
                    isSelected
                      ? "border-health-blue bg-blue-50 shadow-md scale-105"
                      : isWaiting
                      ? "border-amber-200 bg-amber-50/60 hover:border-amber-300"
                      : "border-slate-100 bg-white hover:border-health-blue/40 shadow-sm"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-lg font-black text-[#03045e]">#{s.tokenNumber}</span>
                    <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${
                      s.priority === 'RED' || s.priority === 'HIGH' ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'
                    }`}>
                      {s.priority || 'NORMAL'}
                    </span>
                  </div>
                  <p className="text-xs font-bold text-slate-700 mt-1 capitalize truncate">
                    {s.prediction?.label || 'General Sickness'}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-1 flex items-center gap-1 font-medium">
                    {isWaiting ? "⏳ Waiting Buffer" : `🚪 ${s.suggestedClass?.name || 'Assigned Room'}`}
                  </p>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── NOTIFICATIONS ── */}
      {errorMessage && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-2xl text-sm font-semibold flex items-center gap-2">
          <FaTimes className="shrink-0" /> {errorMessage}
        </div>
      )}
      {message && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-2xl text-sm font-semibold flex items-center gap-2">
          <FaCheckCircle className="shrink-0 text-emerald-500" /> {message}
        </div>
      )}

      {/* ── MAIN CONSULTATION WORKSPACE ── */}
      {currentSession ? (
        <div className="space-y-6">

          {/* 1. AI TRIAGE SUMMARY BANNER */}
          <Section
            title={`Token #${currentSession.tokenNumber} — AI Triage Screening`}
            icon="🤖"
            badge={
              <span className="text-xs font-black uppercase tracking-wider px-3 py-1 rounded-full bg-cyan-100 text-cyan-800">
                Encounter {currentEncounter?.encounterNumber || `ENC-${currentSession.tokenNumber}`}
              </span>
            }
          >
            <div className="grid md:grid-cols-3 gap-6">
              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Predicted Disease</span>
                <p className="text-xl font-black text-[#03045e] mt-1 capitalize">
                  {currentSession.prediction?.label || 'Unknown'}
                </p>
                <p className="text-xs text-[#0077b6] font-bold mt-0.5">
                  {currentSession.prediction?.confidence || 95}% AI Model Confidence
                </p>
              </div>

              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Reported Symptoms ({currentSession.symptoms?.length || 0})</span>
                <div className="flex flex-wrap gap-1.5 mt-2 max-h-24 overflow-y-auto">
                  {currentSession.symptoms?.length > 0 ? (
                    currentSession.symptoms.map((sym) => (
                      <span key={sym} className="text-[10px] bg-white border border-slate-200 text-slate-700 px-2 py-0.5 rounded-md font-semibold">
                        {sym.replace(/_/g, " ")}
                      </span>
                    ))
                  ) : (
                    <span className="text-xs text-slate-400 italic">No symptoms flagged</span>
                  )}
                </div>
              </div>

              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Assigned Ward / Room</span>
                <p className="text-xl font-black text-[#0077b6] mt-1">
                  {currentSession.suggestedClass?.name || "Waiting for Capacity"}
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Priority: <strong className="text-red-600">{currentSession.priority || "NORMAL"}</strong>
                </p>
              </div>
            </div>
          </Section>

          {/* 2. PATIENT IDENTIFICATION & HISTORY */}
          <Section title="Patient Identification (CIN)" icon="👤">
            <div className="space-y-4">
              
              {/* CIN Search Bar */}
              <div className="relative">
                <label className="auth-label" htmlFor="cinSearch">National ID / CIN Search</label>
                <div className="relative">
                  <input
                    id="cinSearch"
                    value={cinQuery}
                    onChange={(e) => {
                      setCinQuery(e.target.value.toUpperCase());
                      setShowCinDropdown(true);
                      if (!e.target.value) setSelectedPatient(null);
                    }}
                    onFocus={() => setShowCinDropdown(true)}
                    placeholder="Search patient by CIN (e.g. 09876543)..."
                    className="auth-input uppercase font-mono pl-9"
                    autoComplete="off"
                  />
                  <FaSearch className="absolute left-3 top-3.5 text-slate-400 text-sm" />
                </div>

                {/* Autocomplete Dropdown */}
                {showCinDropdown && cinSuggestions.length > 0 && !selectedPatient && (
                  <ul className="absolute z-20 left-0 right-0 mt-1 border border-slate-200 rounded-xl overflow-hidden bg-white shadow-xl max-h-56 overflow-y-auto">
                    {cinSuggestions.map((p) => (
                      <li key={p._id}>
                        <button
                          type="button"
                          onMouseDown={() => handleSelectExistingPatient(p)}
                          className="w-full text-left px-4 py-3 hover:bg-blue-50 text-xs border-b border-slate-100 last:border-0 flex items-center justify-between"
                        >
                          <div>
                            <span className="font-mono font-bold text-health-blue">{p.cin}</span>
                            <span className="text-slate-800 font-bold ml-3">{p.name}</span>
                          </div>
                          <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full font-bold">
                            Select Patient
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Patient Found vs New Patient Form */}
              {selectedPatient ? (
                <div className="p-4 bg-emerald-50/70 border border-emerald-200 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-base font-black text-emerald-800">{selectedPatient.name}</span>
                      <span className="text-xs bg-emerald-200/80 text-emerald-800 font-mono font-bold px-2 py-0.5 rounded-md">
                        {selectedPatient.cin}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      Gender: <strong className="capitalize">{selectedPatient.gender || "N/A"}</strong> • Phone: {selectedPatient.phone || "None"} • Blood: {selectedPatient.bloodType || "Unknown"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedPatient(null);
                      setCinQuery("");
                      setPastEncounters([]);
                    }}
                    className="text-xs text-slate-500 hover:text-red-500 font-bold transition-colors"
                  >
                    Change Patient
                  </button>
                </div>
              ) : (
                <div className="p-5 bg-slate-50 border border-slate-200 rounded-2xl space-y-4">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold text-slate-700">
                      {cinQuery ? "No existing record found — Register as New Patient" : "Enter Patient Details"}
                    </p>
                    <span className="text-[10px] text-indigo-600 font-bold bg-indigo-50 px-2.5 py-1 rounded-full">
                      New Patient Profile
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="auth-label">CIN</label>
                      <input
                        value={patientForm.cin}
                        onChange={(e) => setPatientForm({ ...patientForm, cin: e.target.value.toUpperCase() })}
                        className="auth-input uppercase font-mono"
                        placeholder="CIN..."
                      />
                    </div>
                    <div>
                      <label className="auth-label">Full Name</label>
                      <input
                        value={patientForm.name}
                        onChange={(e) => setPatientForm({ ...patientForm, name: e.target.value })}
                        className="auth-input"
                        placeholder="John Doe"
                      />
                    </div>
                    <div>
                      <label className="auth-label">Phone</label>
                      <input
                        value={patientForm.phone}
                        onChange={(e) => setPatientForm({ ...patientForm, phone: e.target.value })}
                        className="auth-input"
                        placeholder="+216 ..."
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="auth-label">Gender</label>
                      <select
                        value={patientForm.gender}
                        onChange={(e) => setPatientForm({ ...patientForm, gender: e.target.value })}
                        className="auth-input"
                      >
                        <option value="male">Male</option>
                        <option value="female">Female</option>
                        <option value="other">Other</option>
                      </select>
                    </div>
                    <div>
                      <label className="auth-label">Date of Birth</label>
                      <input
                        type="date"
                        value={patientForm.dateOfBirth}
                        onChange={(e) => setPatientForm({ ...patientForm, dateOfBirth: e.target.value })}
                        className="auth-input"
                      />
                    </div>
                    <div>
                      <label className="auth-label">Blood Type</label>
                      <input
                        value={patientForm.bloodType}
                        onChange={(e) => setPatientForm({ ...patientForm, bloodType: e.target.value })}
                        className="auth-input"
                        placeholder="e.g. O+"
                      />
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleRegisterNewPatient}
                    disabled={isSaving || !patientForm.cin || !patientForm.name}
                    className="btn-primary text-xs flex items-center gap-2"
                  >
                    <FaUserPlus /> Save &amp; Link Patient
                  </button>
                </div>
              )}

              {/* Past Encounters / Medical History Timeline */}
              {pastEncounters.length > 0 && (
                <div className="border-t border-slate-100 pt-4 mt-2">
                  <span className="text-xs font-black uppercase tracking-wider text-slate-500 flex items-center gap-2 mb-3">
                    <FaHistory className="text-health-blue" /> Previous Medical History ({pastEncounters.length} past visits)
                  </span>
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {pastEncounters.map((enc) => (
                      <div key={enc._id} className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-xs flex items-start justify-between gap-4">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-800">
                              {enc.consultation?.confirmedDiagnosis || enc.triageData?.aiPrediction?.label || "General Consultation"}
                            </span>
                            <span className="text-[10px] bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full font-bold">
                              {enc.status}
                            </span>
                          </div>
                          {enc.consultation?.clinicalNotes && (
                            <p className="text-slate-500 text-[11px] mt-1 italic">"{enc.consultation.clinicalNotes}"</p>
                          )}
                          {enc.consultation?.prescriptions?.length > 0 && (
                            <p className="text-indigo-600 text-[10px] mt-1 font-semibold">
                              Rx: {enc.consultation.prescriptions.map(p => p.drug_name).join(", ")}
                            </p>
                          )}
                        </div>
                        <span className="text-[10px] text-slate-400 shrink-0 font-medium">
                          {new Date(enc.startedAt).toLocaleDateString()}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            </div>
          </Section>

          {/* 3. CLINICAL NOTES & CONFIRMED DIAGNOSIS */}
          <Section title="Clinical Consultation & Examination" icon="🩺">
            <div className="space-y-4">
              
              {/* Confirmed Diagnosis Input */}
              <div>
                <label className="auth-label" htmlFor="diagnosis">Confirmed Diagnosis</label>
                <input
                  id="diagnosis"
                  value={confirmedDiagnosis}
                  onChange={(e) => setConfirmedDiagnosis(e.target.value)}
                  placeholder="Doctor confirmed diagnosis..."
                  className="auth-input font-bold text-slate-800"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  Pre-filled with AI prediction ({currentSession.prediction?.label || "N/A"}). Doctor can edit or confirm.
                </p>
              </div>

              {/* Vitals */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <div>
                  <label className="auth-label">Temp</label>
                  <input
                    value={vitals.temperature}
                    onChange={(e) => setVitals({ ...vitals, temperature: e.target.value })}
                    placeholder="38.5°C"
                    className="auth-input text-xs"
                  />
                </div>
                <div>
                  <label className="auth-label">Pulse</label>
                  <input
                    value={vitals.pulse}
                    onChange={(e) => setVitals({ ...vitals, pulse: e.target.value })}
                    placeholder="78 bpm"
                    className="auth-input text-xs"
                  />
                </div>
                <div>
                  <label className="auth-label">BP</label>
                  <input
                    value={vitals.bloodPressure}
                    onChange={(e) => setVitals({ ...vitals, bloodPressure: e.target.value })}
                    placeholder="120/80"
                    className="auth-input text-xs"
                  />
                </div>
                <div>
                  <label className="auth-label">Weight</label>
                  <input
                    value={vitals.weight}
                    onChange={(e) => setVitals({ ...vitals, weight: e.target.value })}
                    placeholder="70 kg"
                    className="auth-input text-xs"
                  />
                </div>
                <div>
                  <label className="auth-label">Height</label>
                  <input
                    value={vitals.height}
                    onChange={(e) => setVitals({ ...vitals, height: e.target.value })}
                    placeholder="175 cm"
                    className="auth-input text-xs"
                  />
                </div>
              </div>

              {/* Clinical Notes Textarea */}
              <div>
                <label className="auth-label" htmlFor="clinicalNotes">Clinical Examination Notes</label>
                <textarea
                  id="clinicalNotes"
                  value={clinicalNotes}
                  onChange={(e) => setClinicalNotes(e.target.value)}
                  rows={3}
                  placeholder="Enter doctor's examination findings, observations, and treatment plan..."
                  className="auth-input resize-none"
                />
              </div>

            </div>
          </Section>

          {/* 4. E-PRESCRIPTION BUILDER */}
          <Section
            title="e-Prescription (Pharmacy Linked)"
            icon="💊"
            badge={
              <button
                type="button"
                onClick={addPrescriptionRow}
                className="text-xs px-3 py-1 bg-health-blue/10 text-health-blue hover:bg-health-blue/20 rounded-lg font-bold flex items-center gap-1 transition-colors"
              >
                <FaPlus className="text-[9px]" /> Add Drug
              </button>
            }
          >
            <div className="space-y-3">
              {prescriptions.length === 0 ? (
                <div className="py-6 text-center text-slate-400 text-xs">
                  No medications prescribed yet. Click "+ Add Drug" to write an electronic prescription.
                </div>
              ) : (
                prescriptions.map((row, idx) => (
                  <div key={idx} className="p-3 bg-slate-50 border border-slate-200 rounded-xl grid grid-cols-1 sm:grid-cols-12 gap-3 items-center">
                    <div className="sm:col-span-4">
                      <label className="text-[10px] font-bold text-slate-400 uppercase">Medication</label>
                      <input
                        value={row.drug_name}
                        onChange={(e) => updatePrescriptionRow(idx, "drug_name", e.target.value)}
                        placeholder="Drug name (e.g. Amoxicillin)..."
                        className="auth-input text-xs"
                        list="pharmacy-med-list"
                      />
                      <datalist id="pharmacy-med-list">
                        {availableMeds.map((m) => (
                          <option key={m._id} value={m.drug_name} />
                        ))}
                      </datalist>
                    </div>

                    <div className="sm:col-span-2">
                      <label className="text-[10px] font-bold text-slate-400 uppercase">Strength</label>
                      <input
                        value={row.strength}
                        onChange={(e) => updatePrescriptionRow(idx, "strength", e.target.value)}
                        placeholder="500mg"
                        className="auth-input text-xs"
                      />
                    </div>

                    <div className="sm:col-span-2">
                      <label className="text-[10px] font-bold text-slate-400 uppercase">Qty</label>
                      <input
                        type="number"
                        min="1"
                        value={row.quantity}
                        onChange={(e) => updatePrescriptionRow(idx, "quantity", Number(e.target.value))}
                        className="auth-input text-xs"
                      />
                    </div>

                    <div className="sm:col-span-3">
                      <label className="text-[10px] font-bold text-slate-400 uppercase">Instructions</label>
                      <input
                        value={row.instructions}
                        onChange={(e) => updatePrescriptionRow(idx, "instructions", e.target.value)}
                        placeholder="1 tab twice daily"
                        className="auth-input text-xs"
                      />
                    </div>

                    <div className="sm:col-span-1 flex justify-end mt-4 sm:mt-0">
                      <button
                        type="button"
                        onClick={() => removePrescriptionRow(idx)}
                        className="text-slate-400 hover:text-red-500 p-2 rounded-lg transition-colors"
                      >
                        <FaTrash className="text-xs" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </Section>

          {/* 5. ACTIONS: FINISH CONSULTATION (FINAL DISCHARGE) */}
          <div className="admin-card p-6 flex flex-col sm:flex-row items-center justify-between gap-4 bg-gradient-to-r from-slate-50 to-blue-50 border border-blue-100 rounded-3xl">
            <div>
              <p className="text-sm font-black text-slate-800">Complete Consultation &amp; Discharge</p>
              <p className="text-xs text-slate-500 mt-0.5">
                Saves encounter to patient record, transmits prescription to pharmacy, and frees room capacity for next waiting patient.
              </p>
            </div>

            <button
              type="button"
              onClick={handleFinishConsultation}
              disabled={isSaving || !selectedPatient}
              className="px-8 py-4 bg-gradient-to-r from-[#03045e] to-[#0096c7] text-white font-black text-sm rounded-2xl shadow-lg hover:shadow-xl hover:-translate-y-0.5 transition-all flex items-center gap-2 disabled:opacity-50"
            >
              <FaCheckCircle className="text-base text-cyan-300" />
              {isSaving ? "Finalizing Discharge..." : "Finish Consultation"}
            </button>
          </div>

        </div>
      ) : (
        /* Empty Workspace Prompt */
        <div className="admin-card p-12 text-center flex flex-col items-center justify-center space-y-4 rounded-3xl">
          <div className="w-16 h-16 rounded-full bg-blue-50 text-health-blue flex items-center justify-center text-2xl">
            🩺
          </div>
          <div>
            <h3 className="text-lg font-black text-slate-800">No Patient Token Selected</h3>
            <p className="text-xs text-slate-400 max-w-sm mx-auto mt-1">
              Select an active token from the queue above to begin consultation, link patient record, and write e-prescriptions.
            </p>
          </div>
        </div>
      )}

    </div>
  );
}
