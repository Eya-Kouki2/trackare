import api from "../../api/axios";
import { useEffect, useState, useRef, useCallback } from "react";
import { useOutletContext } from "react-router-dom";
import { getPriorityFromPrediction } from "../../utils/triagePredict";
import { getMaladieLabel } from "../../constants/maladies";
import {
  FaExpand, FaCompress, FaPlus, FaMinus,
  FaRedo, FaCheckCircle, FaTimesCircle,
  FaMicrophone, FaMicrophoneSlash,
} from "react-icons/fa";

/* ─── 25 diagnostic questions ───────────────────────────────────
   Each question carries:
     • key    – internal ID
     • label  – sentence shown to the patient/nurse
     • keywords – strings fed into predictMaladies / notes
   Note: predictMaladies does keyword matching on free text,
   so the keywords arrays here mirror the SYMPTOM_RULES in
   triagePredict.js (fever, cough, chills, sweating, …).
───────────────────────────────────────────────────────────────── */
const QUESTIONS = [
  { key: "chills",                label: "Are you experiencing chills?",                        keywords: ["chills"] },
  { key: "joint_pain",            label: "Do you have joint pain?",                             keywords: ["joint pain", "rash"] },
  { key: "muscle_wasting",        label: "Have you noticed muscle wasting or loss?",            keywords: ["fatigue"] },
  { key: "vomiting",              label: "Have you been vomiting?",                             keywords: ["vomiting"] },
  { key: "fatigue",               label: "Are you feeling unusual fatigue?",                    keywords: ["fatigue"] },
  { key: "weight_loss",           label: "Have you had unexplained weight loss?",               keywords: ["weight loss"] },
  { key: "patches_in_throat",     label: "Do you have patches or soreness in your throat?",    keywords: ["sore throat"] },
  { key: "cough",                 label: "Do you have a cough?",                                keywords: ["cough"] },
  { key: "high_fever",            label: "Do you have a high fever (≥ 38.5 °C)?",              keywords: ["fever"] },
  { key: "breathlessness",        label: "Are you experiencing breathlessness?",                keywords: ["breathing difficulty", "shortness of breath"] },
  { key: "sweating",              label: "Are you sweating excessively?",                       keywords: ["sweating", "night sweats"] },
  { key: "headache",              label: "Do you have a headache?",                             keywords: ["headache"] },
  { key: "nausea",                label: "Are you feeling nauseous?",                           keywords: ["nausea"] },
  { key: "loss_of_appetite",      label: "Have you lost your appetite?",                       keywords: ["fatigue"] },
  { key: "diarrhoea",             label: "Do you have diarrhoea?",                              keywords: ["diarrhea", "severe diarrhea"] },
  { key: "mild_fever",            label: "Do you have a mild fever (37–38.5 °C)?",             keywords: ["fever"] },
  { key: "yellowing_of_eyes",     label: "Have you noticed yellowing of the eyes (jaundice)?", keywords: ["jaundice", "yellow eyes"] },
  { key: "swelled_lymph_nodes",   label: "Do you have swollen lymph nodes?",                   keywords: ["swollen lymph nodes"] },
  { key: "malaise",               label: "Do you feel a general sense of malaise or unwell?",  keywords: ["fatigue"] },
  { key: "phlegm",                label: "Are you producing phlegm or mucus?",                 keywords: ["cough"] },
  { key: "chest_pain",            label: "Do you have chest pain or tightness?",               keywords: ["chest tightness"] },
  { key: "dizziness",             label: "Are you experiencing dizziness?",                    keywords: ["dizziness"] },
  { key: "extra_marital_contacts",label: "Have you had unprotected sexual contacts recently?", keywords: ["rash", "blisters", "lesions"] },
  { key: "muscle_pain",           label: "Do you have muscle pain or body aches?",             keywords: ["body ache"] },
  { key: "blood_in_sputum",       label: "Have you noticed blood in your sputum?",             keywords: ["blood", "blood in sputum"] },
];

/* Pretty label from key */
const fmt = (key) => key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/* ══════════════════════════════════════════════════════════════ */

const DetectSickness = () => {
  const { user } = useOutletContext();
  const [diseaseClasses, setDiseaseClasses] = useState([]);

  /* view: "welcome" | "quiz" | "results" */
  const [view,    setView]    = useState("welcome");
  const [current, setCurrent] = useState(0);
  const [answers, setAnswers] = useState({});
  const [results, setResults] = useState(null);
  const [sliding, setSliding] = useState(false);   // animation flag
  const isSubmittingRef = useRef(false);            // prevents double-increment
  const [allRoomsFull, setAllRoomsFull] = useState(false); // all matching rooms full
  const [sessionId, setSessionId] = useState(null);        // backend triage session id
  const [tokenNumber, setTokenNumber] = useState(null);    // backend atomic token number (e.g. 001)
  const [assignedRoomLive, setAssignedRoomLive] = useState(null); // room assigned via SSE
  const [voiceMode, setVoiceMode] = useState(false);       // voice recognition active
  const [listening, setListening] = useState(false);       // mic currently listening
  const [voiceStatus, setVoiceStatus] = useState("");      // feedback text
  const [voiceSelected, setVoiceSelected] = useState(null); // null | true | false
  const recognizerRef = useRef(null);
  const answerRef = useRef(null); // store latest answer fn for use inside event handlers

  /* fullscreen / zoom */
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [zoom,         setZoom]         = useState(110);

  useEffect(() => {
    if (!user?.area) return;
    api.get("/api/disease-classes")
      .then((r) => setDiseaseClasses(r.data.diseaseClasses || []))
      .catch(() => {});
  }, [user?.area]);

  /* Esc key exits fullscreen */
  useEffect(() => {
    const onFsChange = () => { if (!document.fullscreenElement) setIsFullscreen(false); };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  const toggleFullscreen = () => {
    if (!isFullscreen) {
      document.documentElement.requestFullscreen?.().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.();
      setIsFullscreen(false);
    }
  };

  /* ── Voice Recognition helpers ───────────────────────────────── */
  const stopVoice = useCallback(() => {
    recognizerRef.current?.stop();
    recognizerRef.current?.abort();
    recognizerRef.current = null;
    setListening(false);
    setVoiceStatus("");
  }, []);

  const listenOnce = useCallback((onAnswer) => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setVoiceStatus("❌ Browser doesn't support voice recognition");
      return;
    }
    const rec = new SpeechRecognition();
    rec.lang = "fr-FR";
    rec.interimResults = false;
    rec.maxAlternatives = 3;
    recognizerRef.current = rec;
    setListening(true);
    setVoiceStatus("🎙️ Listening… say \"Oui\" or \"Non\"");

    rec.onresult = (event) => {
      setListening(false);
      const texts = Array.from(event.results[0]).map(a => a.transcript.toLowerCase().trim());
      const combined = texts.join(" ");
      console.log("[Voice]", combined);
      if (/\b(oui|ouais|yes|yeah|si)\b/.test(combined)) {
        setVoiceStatus("✅ Heard: YES");
        setVoiceSelected(true);
        setTimeout(() => { setVoiceSelected(null); onAnswer(true); }, 600);
      } else if (/\b(non|no|nope|nan)\b/.test(combined)) {
        setVoiceStatus("❌ Heard: NO");
        setVoiceSelected(false);
        setTimeout(() => { setVoiceSelected(null); onAnswer(false); }, 600);
      } else {
        setVoiceStatus(`❓ Didn't catch that. Say "Oui" or "Non"`);
        // retry after a short pause
        setTimeout(() => listenOnce(onAnswer), 1000);
      }
    };

    rec.onerror = (e) => {
      setListening(false);
      if (e.error === "no-speech") {
        setVoiceStatus(`❓ No speech detected. Try again.`);
        setTimeout(() => listenOnce(onAnswer), 800);
      } else {
        setVoiceStatus(`⚠️ Error: ${e.error}`);
      }
    };

    rec.start();
  }, []);

  const stopVoiceMode = useCallback(() => {
    stopVoice();
    setVoiceMode(false);
  }, [stopVoice]);

  // When view changes to quiz with voiceMode, start listening
  useEffect(() => {
    if (view === "quiz" && voiceMode) {
      const timer = setTimeout(() => listenOnce((val) => answerRef.current?.(val)), 600);
      return () => clearTimeout(timer);
    }
    if (view !== "quiz") stopVoice();
  }, [view, current, voiceMode, listenOnce, stopVoice]);

  // Keep answerRef in sync
  useEffect(() => {
    answerRef.current = answer;
  });

  /* ── Process Prediction (Shared by manual form & kiosk) ─────── */
  const processPrediction = useCallback(async (mlPrediction, confidenceMap = null, reportedSymptoms = []) => {
    let maladieKey = "autre";
    let confidence = 100;
    let label = "Safe / No Disease Detected";

    if (mlPrediction !== "safe") {
        const ML_MALADIE_MAP = {
          "AIDS": "cida",
          "Malaria": "malaria",
          "Tuberculosis": "tuberculos"
        };
        maladieKey = ML_MALADIE_MAP[mlPrediction] || mlPrediction.toLowerCase();
        if (confidenceMap && confidenceMap[mlPrediction]) {
          confidence = Math.round(confidenceMap[mlPrediction] * 100);
        } else {
          confidence = 95;
        }
        label = mlPrediction;
    }

    let currentDiseaseClasses = diseaseClasses;
    let currentPatients = [];
    try {
      const [classesRes, patientsRes] = await Promise.all([
        api.get("/api/disease-classes"),
        api.get("/api/patients/stats")
      ]);
      currentDiseaseClasses = classesRes.data.diseaseClasses || [];
      currentPatients = patientsRes.data.patients || [];
      setDiseaseClasses(currentDiseaseClasses);
    } catch (err) {
      console.error("Failed to fetch latest data", err);
    }

    const preds = [{ maladie: maladieKey, label: label, confidence: confidence }];
    const priority = getPriorityFromPrediction(confidence);
    
    // Helper for robust sickness string matching
    const isMaladieMatch = (m1, m2) => {
      if (!m1 || !m2) return false;
      const s1 = String(m1).toLowerCase().trim();
      const s2 = String(m2).toLowerCase().trim();
      if (s1 === s2) return true;
      if ((s1.includes("tuber") && s2.includes("tuber")) ||
          (s1.includes("aid") && s2.includes("cid")) ||
          (s1.includes("cid") && s2.includes("aid"))) {
        return true;
      }
      return false;
    };

    // Find all rooms matching the diagnosed sickness
    const matchingRooms = currentDiseaseClasses.filter((c) => isMaladieMatch(c.maladie, maladieKey));

    // Search for ANY matching room that still has available capacity
    let matched = null;
    for (const room of matchingRooms) {
      const roomCapacity = room.maxPatients || 1;
      const currentOccupancy = room.currentPatients || 0;
      if (currentOccupancy < roomCapacity) {
        matched = room;
        break;
      }
    }

    // Only set unavailable if EVERY room for this sickness is completely full (or 0 rooms exist)
    const isRoomUnavailable = matched === null && maladieKey !== "autre";

    // If all rooms for this sickness are full, store a dashboard alert
    if (isRoomUnavailable) {
      const noRoomAlerts = JSON.parse(localStorage.getItem("noRoomAlerts") || "[]");
      const alreadyExists = noRoomAlerts.some((a) => isMaladieMatch(a.maladie, maladieKey));
      if (!alreadyExists) {
        noRoomAlerts.push({
          id: Date.now(),
          maladie: maladieKey,
          label: label,
          createdAt: new Date().toISOString(),
        });
        localStorage.setItem("noRoomAlerts", JSON.stringify(noRoomAlerts));
      }
      window.dispatchEvent(new Event("alerts-updated"));
    }

    setAllRoomsFull(isRoomUnavailable);

    setResults({ predictions: preds, priority, matchedClass: matched, yesKeys: reportedSymptoms });
    setView("results");

    // Create session in backend for Doctor queue
    // The backend handles room increment atomically — do NOT call /increment separately
    try {
      const sessionRes = await api.post("/api/triage-sessions", {
        areaId: user?.area?._id || user?.area,
        symptoms: reportedSymptoms,
        prediction: { maladie: maladieKey, label, confidence },
        priority: priority?.level ? (priority.level === 'high' ? 'RED' : priority.level === 'moderate' ? 'YELLOW' : 'GREEN') : 'GREEN',
      });
      if (sessionRes.data?.sessionId) {
        setSessionId(sessionRes.data.sessionId);
      }
      if (sessionRes.data?.tokenNumber) {
        setTokenNumber(sessionRes.data.tokenNumber);
      }
      // Trigger alerts panel refresh
      window.dispatchEvent(new Event("alerts-updated"));
    } catch (err) {
      console.error("Failed to create triage session:", err);
    }
  }, [diseaseClasses, user?.area]);

  /* ── Answer a question (yes = true, no = false) ─────────────── */
  const answer = async (value) => {
    if (sliding) return;
    const key     = QUESTIONS[current].key;
    const updated = { ...answers, [key]: value };
    setAnswers(updated);

    if (current < QUESTIONS.length - 1) {
      setSliding(true);
      setTimeout(() => {
        setCurrent((c) => c + 1);
        setSliding(false);
      }, 220);
    } else {
      /* All done → compute using Python ML model */
      if (isSubmittingRef.current) return;   // guard against double-fire
      isSubmittingRef.current = true;
      setView("analyzing");
      try {
        const features = QUESTIONS.map(q => updated[q.key] ? 1 : 0);
        const [res] = await Promise.all([
          api.post("/api/ml/predict", { features }),
          new Promise((r) => setTimeout(r, 2500))
        ]);
        const mlPrediction = res.data.prediction; // 'AIDS', 'Malaria', 'Tuberculosis', 'safe'
        const yesKeys = Object.keys(updated).filter((k) => updated[k]);
        
        await processPrediction(mlPrediction, null, yesKeys);

      } catch (err) {
        console.error("ML prediction error:", err);
        alert("Failed to run the diagnostic model. Please ensure the backend ML service is running.");
        setView("quiz");
      } finally {
        isSubmittingRef.current = false;
      }
    }
  };

  /* ── Kiosk SSE Listener ──────────────────────────────────────── */
  useEffect(() => {
    const isDev = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
    const sseUrl = isDev ? "http://localhost:5000/api/result/stream" : "/api/result/stream";
    
    const sse = new EventSource(sseUrl);
    
    sse.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);

        // ── Live question/answer progress from kiosk ──────────────
        if (data.type === 'KIOSK_PROGRESS' && data.payload !== undefined) {
          const { questionIndex, answer } = data.payload;

          // Switch to quiz view if not already there
          setView("quiz");

          // Jump to the correct question on screen
          setCurrent(questionIndex);

          // Flash the selected button (green = oui, red = non)
          setVoiceSelected(answer ? true : false);

          // After 700ms flash: register answer and advance
          setTimeout(() => {
            setVoiceSelected(null);
            setAnswers(prev => ({
              ...prev,
              [QUESTIONS[questionIndex]?.key]: answer,
            }));
            // If not the last question, advance to next
            if (questionIndex < QUESTIONS.length - 1) {
              setSliding(true);
              setTimeout(() => {
                setCurrent(questionIndex + 1);
                setSliding(false);
              }, 220);
            }
          }, 700);
        }

        // ── Final result from kiosk ───────────────────────────────
        if (data.type === 'KIOSK_RESULT' && data.payload) {
          console.log("Received Kiosk Result:", data.payload);
          setView("analyzing");
          await new Promise((r) => setTimeout(r, 2500));
          const { prediction, confidence, symptoms_reported } = data.payload;
          await processPrediction(prediction, confidence, symptoms_reported || []);
        }

        // ── Patient promoted from waiting to an assigned room ─────
        if (data.type === 'WAITING_PATIENT_ASSIGNED' && data.payload) {
          setAssignedRoomLive({
            placeCode: data.payload.placeCode,
            name: data.payload.roomName,
            maladie: data.payload.maladie,
          });
          setAllRoomsFull(false);
        }

      } catch (err) {
        console.error("Error parsing Kiosk SSE data", err);
      }
    };

    return () => {
      sse.close();
    };
  }, [processPrediction]);

  /* ── Fallback Polling for Waiting Patient ─────────────────────── */
  useEffect(() => {
    if (!allRoomsFull) return;
    const maladieKey = results?.predictions?.[0]?.maladie;

    const pollStatus = async () => {
      try {
        // 1. Check if session was updated in backend
        if (sessionId) {
          const sessionRes = await api.get(`/api/triage-sessions/${sessionId}`);
          const sess = sessionRes.data?.session;
          if (sess) {
            if (sess.tokenNumber) setTokenNumber(sess.tokenNumber);
            if (sess.status === "assigned" || sess.assignedRoom || sess.suggestedClass) {
              const room = sess.assignedRoom || sess.suggestedClass;
              if (room?.placeCode) {
                setAssignedRoomLive({
                  placeCode: room.placeCode,
                  name: room.name || `Room ${room.placeCode}`,
                  maladie: sess.prediction?.maladie || maladieKey,
                });
                setAllRoomsFull(false);
                return;
              }
            }
          }
        }

        // 2. Check if a new room was added for this sickness
        if (maladieKey) {
          const classesRes = await api.get("/api/disease-classes");
          const diseaseClassesList = classesRes.data?.diseaseClasses || [];
          const matchingAvailableRoom = diseaseClassesList.find(
            (c) => (c.maladie === maladieKey || c.maladie?.toLowerCase() === maladieKey?.toLowerCase()) &&
                   ((c.currentPatients || 0) < (c.maxPatients || 1))
          );

          if (matchingAvailableRoom) {
            setAssignedRoomLive({
              placeCode: matchingAvailableRoom.placeCode,
              name: matchingAvailableRoom.description ? matchingAvailableRoom.description : `Room ${matchingAvailableRoom.placeCode}`,
              maladie: matchingAvailableRoom.maladie,
            });
            setAllRoomsFull(false);
          }
        }
      } catch (err) {
        console.error("Error polling session waiting status:", err);
      }
    };

    pollStatus();
    const interval = setInterval(pollStatus, 1500);

    return () => clearInterval(interval);
  }, [allRoomsFull, sessionId, results]);

  const restart = () => {
    isSubmittingRef.current = false;
    setAllRoomsFull(false);
    setSessionId(null);
    setTokenNumber(null);
    setAssignedRoomLive(null);
    setAnswers({});
    setCurrent(0);
    setResults(null);
    setView("welcome");
  };

  /* ── Progress ────────────────────────────────────────────────── */
  const progress = Math.round((current / QUESTIONS.length) * 100);

  /* ── Layout ─────────────────────────────────────────────────── */
  const wrapperClass = isFullscreen
    ? "fixed inset-0 z-50 bg-slate-50 overflow-y-auto"
    : "w-full";
  const innerClass = isFullscreen
    ? "w-full px-6 py-6 space-y-4 min-h-screen"
    : "max-w-5xl mx-auto space-y-4 animate-fade-in";

  /* ═══════════════════════════════════════════════════════════ */
  return (
    <div className={wrapperClass}>
      <div className={innerClass} style={{ fontSize: `${zoom}%` }}>

        {/* ── Shared Header ─────────────────────────────────── */}
        <div
          className="rounded-2xl p-5 sm:p-6 shadow-sm"
          style={{ background: "linear-gradient(135deg,#03045e,#0077b6)" }}
        >
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-2xl bg-white/15 border border-white/20 flex items-center justify-center shrink-0">
                <span className="text-2xl">🧬</span>
              </div>
              <div>
                <h1 className="text-lg font-bold text-white">Detect Sickness</h1>
                <p className="text-xs text-blue-200/80 mt-0.5">
                  Symptom evaluation · {QUESTIONS.length} questions · instant results
                </p>
              </div>
            </div>

            {/* Controls */}
            <div className="flex items-center gap-2 shrink-0">
              <div className="flex items-center bg-white/10 border border-white/20 rounded-xl overflow-hidden">
                <button onClick={() => setZoom((z) => Math.max(z - 10, 70))} disabled={zoom <= 70}
                  className="px-2.5 py-1.5 text-white/80 hover:bg-white/20 transition-colors disabled:opacity-40 text-xs">
                  <FaMinus />
                </button>
                <span className="px-2.5 text-[11px] font-bold text-white/90 select-none">{zoom}%</span>
                <button onClick={() => setZoom((z) => Math.min(z + 10, 150))} disabled={zoom >= 150}
                  className="px-2.5 py-1.5 text-white/80 hover:bg-white/20 transition-colors disabled:opacity-40 text-xs">
                  <FaPlus />
                </button>
              </div>
              <button onClick={toggleFullscreen}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/10 border border-white/20 text-white/90 hover:bg-white/20 transition-colors text-[11px] font-semibold">
                {isFullscreen ? <FaCompress className="text-xs" /> : <FaExpand className="text-xs" />}
                {isFullscreen ? "Exit" : "Fullscreen"}
              </button>
            </div>
          </div>
        </div>

        {/* ══ WELCOME ══════════════════════════════════════════ */}
        {view === "welcome" && (
          <div className="flex flex-col items-center justify-center py-10">
            <div className="w-full max-w-xl bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              {/* top strip */}
              <div className="h-1.5 w-full" style={{ background: "linear-gradient(90deg,#03045e,#0096c7)" }} />

              <div className="px-10 py-12 text-center space-y-6">
                <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-[#03045e] to-[#0096c7] flex items-center justify-center mx-auto shadow-lg">
                  <span className="text-4xl">🩺</span>
                </div>

                <div>
                  <h2 className="text-2xl font-black text-[#03045e] mb-2">Welcome</h2>
                  <p className="text-sm text-slate-500 leading-relaxed">
                    This tool walks you through <strong className="text-slate-700">{QUESTIONS.length} clinical questions</strong>.
                    Answer <strong className="text-emerald-600">Yes</strong> or <strong className="text-red-500">No</strong> for each symptom —
                    at the end you&apos;ll receive a diagnostic assessment and a suggested room if applicable.
                  </p>
                </div>

                {/* Quick preview of symptoms */}
                <div className="flex flex-wrap gap-1.5 justify-center">
                  {QUESTIONS.slice(0, 8).map((q) => (
                    <span key={q.key} className="text-[10px] px-2.5 py-1 rounded-full bg-slate-50 border border-slate-200 text-slate-500 font-medium">
                      {fmt(q.key)}
                    </span>
                  ))}
                  <span className="text-[10px] px-2.5 py-1 rounded-full bg-slate-50 border border-dashed border-slate-300 text-slate-400">
                    +{QUESTIONS.length - 8} more…
                  </span>
                </div>

                <button
                  onClick={() => { setVoiceMode(false); setView("quiz"); }}
                  className="btn-primary w-full py-3.5 text-sm font-bold rounded-xl"
                >
                  Start Assessment →
                </button>
                <button
                  onClick={() => { setVoiceMode(true); setView("quiz"); }}
                  className="w-full py-3.5 text-sm font-bold rounded-xl flex items-center justify-center gap-2 border-2 border-[#0077b6] text-[#0077b6] hover:bg-[#0077b6]/5 transition-colors"
                >
                  <FaMicrophone /> Start with Voice (Oui / Non)
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ══ QUIZ ═════════════════════════════════════════════ */}
        {view === "quiz" && (
          <div className="flex flex-col gap-4 mt-6" style={{ minHeight: "calc(100vh - 200px)" }}>

            {/* Progress */}
            <div className="w-full shrink-0">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-semibold text-slate-400">
                  Question {current + 1} <span className="text-slate-300">/ {QUESTIONS.length}</span>
                </span>
                <span className="text-[11px] font-bold text-[#0077b6]">{progress}%</span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{
                    width: `${progress}%`,
                    background: "linear-gradient(90deg,#03045e,#0096c7)",
                  }}
                />
              </div>
            </div>

            {/* Question card — grows to fill remaining height */}
            <div
              className="flex flex-col flex-1 w-full bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden transition-all duration-220"
              style={{ opacity: sliding ? 0 : 1, transform: sliding ? "translateY(10px)" : "translateY(0)" }}
            >
              {/* Coloured accent */}
              <div className="h-1.5 w-full shrink-0" style={{ background: "linear-gradient(90deg,#03045e,#0096c7)" }} />

              <div className="px-6 py-3.5 border-b border-slate-100 flex items-center justify-between shrink-0"
                style={{ background: "linear-gradient(90deg,#f8fafc,#f1f5f9)" }}>
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Symptom Check</span>
                <div className="flex items-center gap-3">
                  {voiceMode && (
                    <div className={`flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-full border ${
                      listening
                        ? "bg-red-50 border-red-200 text-red-600 animate-pulse"
                        : "bg-slate-100 border-slate-200 text-slate-500"
                    }`}>
                      {listening ? <FaMicrophone className="text-red-500" /> : <FaMicrophoneSlash />}
                      {voiceStatus || "Voice Mode"}
                    </div>
                  )}
                  {voiceMode && (
                    <button onClick={stopVoiceMode} className="text-[10px] text-slate-400 hover:text-red-500 transition-colors">
                      Stop Voice
                    </button>
                  )}
                  <span className="text-[10px] font-bold text-slate-300">{current + 1} / {QUESTIONS.length}</span>
                </div>
              </div>

              {/* Question area — grows to push buttons down */}
              <div className="flex-1 flex flex-col items-center justify-center px-10 py-12 text-center gap-8">
                {/* Symptom badge */}
                <span className="inline-block text-sm font-bold uppercase tracking-widest text-indigo-500 bg-indigo-50 border border-indigo-100 px-5 py-2 rounded-full">
                  {fmt(QUESTIONS[current].key)}
                </span>

                {/* Question */}
                <h2 className="text-4xl sm:text-5xl font-black text-[#03045e] leading-snug mx-auto">
                  {QUESTIONS[current].label}
                </h2>
              </div>

              {/* Yes / No — full-width split, anchored at bottom */}
              <div className="flex border-t-2 border-slate-100 shrink-0" style={{ minHeight: "220px" }}>
                {/* NO */}
                <button
                  onClick={() => answer(false)}
                  className={`group flex-1 flex flex-col items-center justify-center gap-5 py-12 border-r-2 transition-all duration-150 ${
                    voiceSelected === false
                      ? "bg-red-100 border-red-400 scale-[0.98]"
                      : "bg-white hover:bg-red-50 border-slate-100 hover:border-red-200 active:scale-[0.98]"
                  }`}
                >
                  <FaTimesCircle className={`text-7xl transition-colors duration-150 ${
                    voiceSelected === false ? "text-red-500" : "text-slate-200 group-hover:text-red-400"
                  }`} />
                  <span className={`text-3xl font-black tracking-wide transition-colors duration-150 ${
                    voiceSelected === false ? "text-red-600" : "text-slate-300 group-hover:text-red-500"
                  }`}>
                    Non
                  </span>
                </button>

                {/* YES */}
                <button
                  onClick={() => answer(true)}
                  className={`group flex-1 flex flex-col items-center justify-center gap-5 py-12 transition-all duration-150 ${
                    voiceSelected === true
                      ? "bg-emerald-100 border-emerald-400 scale-[0.98]"
                      : "bg-white hover:bg-emerald-50 hover:border-emerald-200 active:scale-[0.98]"
                  }`}
                >
                  <FaCheckCircle className={`text-7xl transition-colors duration-150 ${
                    voiceSelected === true ? "text-emerald-500" : "text-slate-200 group-hover:text-emerald-400"
                  }`} />
                  <span className={`text-3xl font-black tracking-wide transition-colors duration-150 ${
                    voiceSelected === true ? "text-emerald-600" : "text-slate-300 group-hover:text-emerald-600"
                  }`}>
                    Oui
                  </span>
                </button>
              </div>
            </div>

            {/* Confirmed symptoms mini list */}
            {Object.keys(answers).some((k) => answers[k]) && (
              <div className="w-full shrink-0">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                  Symptoms confirmed so far
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {Object.keys(answers).filter((k) => answers[k]).map((k) => (
                    <span key={k}
                      className="text-[10px] px-2.5 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 font-semibold flex items-center gap-1">
                      <FaCheckCircle className="text-emerald-400 text-[9px]" />
                      {fmt(k)}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ══ ANALYZING STATE ════════════════════════════════════ */}
        {view === "analyzing" && (
          <div className="flex flex-col items-center justify-center py-20 text-center animate-fade-in h-full flex-1">
            <div className="w-24 h-24 mb-8 relative flex items-center justify-center mx-auto">
              {/* Outer spinning dashed ring */}
              <div className="absolute inset-0 border-4 border-dashed border-[#0096c7] rounded-full animate-[spin_3s_linear_infinite]" />
              {/* Inner fast spinning solid ring */}
              <div className="absolute inset-2 border-4 border-[#03045e] border-t-transparent rounded-full animate-spin" />
              {/* Center icon */}
              <span className="text-3xl relative z-10 animate-pulse">🧠</span>
            </div>
            <h2 className="text-3xl font-black text-[#03045e] mb-3">Analyzing Symptoms</h2>
            <p className="text-slate-500 font-medium max-w-sm mx-auto">Please wait while the AI diagnostic model evaluates the responses...</p>
          </div>
        )}

        {/* ══ RESULTS ══════════════════════════════════════════ */}
        {view === "results" && results && (
          <div className="flex flex-col gap-6 mt-4 animate-fade-in pb-12">
            
            {/* ── UNIFIED TICKET PASS (HERO BOARDING PASS LAYOUT) ── */}
            <div className="bg-white rounded-3xl border-2 border-slate-100 shadow-xl overflow-hidden">
              {/* Top Header Strip */}
              <div 
                className="px-6 sm:px-8 py-4 text-white flex items-center justify-between"
                style={{ background: "linear-gradient(135deg, #03045e, #0077b6)" }}
              >
                <div className="flex items-center gap-2.5">
                  <span className="text-xl">🩺</span>
                  <span className="text-xs sm:text-sm font-bold uppercase tracking-widest text-blue-100">
                    Patient Triage Pass & Room Ticket
                  </span>
                </div>
                <span className={`text-xs font-extrabold px-3.5 py-1 rounded-full border shadow-sm ${
                  assignedRoomLive || results.matchedClass
                    ? "bg-emerald-500/20 border-emerald-300 text-emerald-200"
                    : "bg-amber-500/20 border-amber-300 text-amber-200"
                }`}>
                  {assignedRoomLive || results.matchedClass ? "✓ Room Assigned" : "⏳ In Buffer Queue"}
                </span>
              </div>

              {/* Main Ticket Grid: Token + Room Side-by-Side */}
              <div className="p-6 sm:p-10 grid grid-cols-1 md:grid-cols-2 gap-6 items-center border-b border-slate-100">
                
                {/* Left Side: TOKEN NUMBER */}
                <div className="flex items-center gap-5 bg-gradient-to-br from-indigo-50/80 to-blue-50/40 rounded-2xl p-6 border border-indigo-100 shadow-inner">
                  <div className="w-16 h-16 rounded-2xl bg-indigo-600 text-white flex items-center justify-center text-3xl shrink-0 shadow-md">
                    🎫
                  </div>
                  <div>
                    <p className="text-xs font-extrabold uppercase tracking-widest text-indigo-400 mb-0.5">
                      Your Queue Token
                    </p>
                    <h2 className="text-5xl sm:text-6xl font-black text-[#03045e] tracking-tight">
                      #{tokenNumber || "001"}
                    </h2>
                    <p className="text-xs font-semibold text-indigo-600/90 mt-1">
                      Keep this token number for medical staff
                    </p>
                  </div>
                </div>

                {/* Right Side: ROOM ASSIGNMENT */}
                <div className={`flex items-center gap-5 rounded-2xl p-6 border shadow-inner ${
                  assignedRoomLive || results.matchedClass
                    ? "bg-gradient-to-br from-emerald-50 to-teal-50/40 border-emerald-200"
                    : "bg-gradient-to-br from-amber-50 to-orange-50/40 border-amber-200"
                }`}>
                  <div className={`w-16 h-16 rounded-2xl flex items-center justify-center text-3xl shrink-0 shadow-md ${
                    assignedRoomLive || results.matchedClass
                      ? "bg-emerald-600 text-white"
                      : "bg-amber-500 text-white"
                  }`}>
                    {assignedRoomLive || results.matchedClass ? "📍" : "⏳"}
                  </div>
                  <div>
                    <p className="text-xs font-extrabold uppercase tracking-widest text-slate-400 mb-0.5">
                      {assignedRoomLive || results.matchedClass ? "Proceed to Room" : "Room Assignment"}
                    </p>
                    {assignedRoomLive ? (
                      <>
                        <h2 className="text-5xl sm:text-6xl font-black text-emerald-600 tracking-tight">
                          #{assignedRoomLive.placeCode}
                        </h2>
                        <p className="text-xs font-extrabold text-slate-600 mt-1">
                          {assignedRoomLive.name}
                        </p>
                      </>
                    ) : results.matchedClass ? (
                      <>
                        <h2 className="text-5xl sm:text-6xl font-black text-[#0077b6] tracking-tight">
                          #{results.matchedClass.placeCode}
                        </h2>
                        <p className="text-xs font-extrabold text-slate-600 mt-1">
                          {getMaladieLabel(results.matchedClass.maladie)} — Room #{results.matchedClass.placeCode}
                        </p>
                      </>
                    ) : allRoomsFull ? (
                      <>
                        <h2 className="text-2xl sm:text-3xl font-black text-amber-600 tracking-tight">
                          Please Wait…
                        </h2>
                        <p className="text-xs font-extrabold text-amber-700 mt-1">
                          Admin notified · Assigning room shortly
                        </p>
                      </>
                    ) : (
                      <>
                        <h2 className="text-xl font-bold text-slate-400">
                          Unassigned
                        </h2>
                        <p className="text-xs text-slate-500 mt-1">
                          No room configured for this condition
                        </p>
                      </>
                    )}
                  </div>
                </div>

              </div>

              {/* Diagnostic Evaluation Section Inside Ticket */}
              <div className="p-6 sm:p-10 bg-slate-50/50">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
                  <div className="flex items-center gap-3">
                    <span className="w-11 h-11 rounded-2xl bg-blue-100 text-[#0077b6] flex items-center justify-center text-xl font-bold border border-blue-200">
                      🧬
                    </span>
                    <div>
                      <p className="text-[10px] font-extrabold uppercase tracking-widest text-slate-400">
                        Evaluated Condition
                      </p>
                      <h3 className="text-2xl sm:text-3xl font-black text-[#03045e]">
                        {getMaladieLabel(results.predictions[0].maladie) || results.predictions[0].label}
                      </h3>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs font-extrabold text-slate-400 uppercase tracking-wider">Confidence:</span>
                    <span className="text-2xl sm:text-3xl font-black text-[#0077b6] bg-blue-50 px-4 py-1 rounded-xl border border-blue-200">
                      {results.predictions[0].confidence}%
                    </span>
                  </div>
                </div>

                {/* Confidence progress bar */}
                <div className="w-full bg-slate-200/80 rounded-full h-3.5 overflow-hidden mb-6">
                  <div
                    className="h-full rounded-full transition-all duration-1000 ease-out"
                    style={{
                      width: `${results.predictions[0].confidence}%`,
                      background: "linear-gradient(90deg, #03045e, #0096c7)",
                    }}
                  />
                </div>

                {/* Instructions Box */}
                <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm flex items-center gap-4">
                  <span className="text-3xl shrink-0">💡</span>
                  <div className="text-xs sm:text-sm text-slate-600 leading-relaxed font-medium">
                    <strong>Instructions:</strong> Please proceed to{" "}
                    <span className="font-extrabold text-[#0077b6]">
                      {assignedRoomLive
                        ? `Room #${assignedRoomLive.placeCode}`
                        : results.matchedClass
                        ? `Room #${results.matchedClass.placeCode}`
                        : "the designated waiting area"}
                    </span>{" "}
                    and show your Token <strong className="text-[#03045e] font-black">#{tokenNumber || "001"}</strong> to the attending nurse or doctor.
                  </div>
                </div>
              </div>
            </div>

            {/* RESTART BUTTON */}
            <button
              onClick={restart}
              className="mt-2 mx-auto btn-outline flex items-center justify-center gap-3 text-lg sm:text-xl font-bold py-4 px-10 rounded-2xl hover:bg-slate-50 transition-colors shadow-sm"
            >
              <FaRedo /> Start New Assessment
            </button>

          </div>
        )}

      </div>
    </div>
  );
};

export default DetectSickness;
