import api from "../../api/axios";
import { useEffect, useState, useRef, useCallback } from "react";
import { useOutletContext } from "react-router-dom";
import { getPriorityFromPrediction } from "../../utils/triagePredict";
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
    
    // Find all rooms matching the sickness
    const matchingRooms = currentDiseaseClasses.filter((c) => c.maladie === maladieKey);

    // Helper: compute total occupancy for a room (official + kiosk queue)
    const getTotalOccupancy = (room) => {
      const officialCount = currentPatients.filter((p) => {
        if (!p.history || p.history.length === 0) return false;
        const sortedHistory = [...p.history].sort((a, b) => new Date(b.date) - new Date(a.date));
        return sortedHistory[0]?.triage?.suggestedClass?.placeCode === Number(room.placeCode);
      }).length;
      return officialCount + (room.currentPatients || 0);
    };

    // Find the FIRST room with available capacity
    let matched = null;
    for (const room of matchingRooms) {
      if (getTotalOccupancy(room) < (room.maxPatients || 1)) {
        matched = room;
        break;
      }
    }

    // All rooms full if we found matching rooms but none had capacity
    const allFull = matchingRooms.length > 0 && matched === null;

    // If all rooms full, store a dashboard alert in localStorage
    if (allFull && maladieKey !== "autre") {
      const noRoomAlerts = JSON.parse(localStorage.getItem("noRoomAlerts") || "[]");
      const alreadyExists = noRoomAlerts.some((a) => a.maladie === maladieKey);
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

    setAllRoomsFull(allFull && maladieKey !== "autre");

    setResults({ predictions: preds, priority, matchedClass: matched, yesKeys: reportedSymptoms });
    setView("results");

    // Only increment if we found an available room (never overfill)
    if (matched) {
      try {
        await api.post(`/api/disease-classes/${matched._id}/increment`);
        window.dispatchEvent(new Event("alerts-updated"));
      } catch (err) {
        console.error("Failed to increment room count:", err);
      }
    }
  }, [diseaseClasses]);

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

      } catch (err) {
        console.error("Error parsing Kiosk SSE data", err);
      }
    };

    return () => {
      sse.close();
    };
  }, [processPrediction]);

  const restart = () => {
    isSubmittingRef.current = false;
    setAllRoomsFull(false);
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
          <div className="flex flex-col gap-8 mt-4 animate-fade-in pb-12">
            
            {/* 1. PREDICTION CARD */}
            <div className="bg-white rounded-3xl border-2 border-slate-100 shadow-sm overflow-hidden p-8 sm:p-12">
              <div className="flex items-center justify-between mb-6">
                <span className="text-3xl sm:text-4xl font-black text-[#03045e]">
                  🥇 {results.predictions[0].label}
                </span>
                <span className="text-3xl sm:text-4xl font-black text-[#0077b6]">
                  {results.predictions[0].confidence}%
                </span>
              </div>
              
              <div className="w-full bg-slate-100 rounded-full h-6 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-1000 ease-out"
                  style={{
                    width: `${results.predictions[0].confidence}%`,
                    background: "linear-gradient(90deg,#03045e,#0096c7)",
                  }}
                />
              </div>
            </div>

            {/* 2. ROOM SUGGESTION CARD */}
            <div className="bg-white rounded-3xl border-2 border-slate-100 shadow-sm overflow-hidden flex flex-col relative h-full">
              <div className="absolute top-0 left-0 right-0 h-3" style={{ background: "linear-gradient(90deg,#03045e,#0096c7)" }} />
              
              <div className="p-8 sm:p-12 text-center flex-1 flex flex-col justify-center mt-4">
                {results.matchedClass ? (
                  <div className="space-y-6">
                    <p className="text-xl sm:text-2xl font-bold uppercase tracking-widest text-slate-400">
                      Proceed to Room
                    </p>
                    <p className="text-7xl sm:text-9xl font-black text-[#0077b6] drop-shadow-sm">
                      #{results.matchedClass.placeCode}
                    </p>
                    <p className="text-2xl font-bold text-slate-600 mt-6">
                      {results.matchedClass.maladie ? `${results.matchedClass.maladie.charAt(0).toUpperCase() + results.matchedClass.maladie.slice(1)} — Class ${results.matchedClass.classNumber || 1}` : `Room ${results.matchedClass.placeCode}`}
                    </p>
                  </div>
                ) : allRoomsFull ? (
                  <div className="space-y-6">
                    <span className="text-6xl sm:text-8xl">🚫</span>
                    <p className="text-3xl sm:text-4xl font-black text-red-500 drop-shadow-sm">
                      No Room Available
                    </p>
                    <p className="text-base text-slate-500 leading-relaxed">
                      All rooms for this condition are currently at full capacity.
                    </p>
                    <div className="inline-flex items-center gap-2 bg-yellow-50 border border-yellow-200 text-yellow-700 rounded-xl px-5 py-3 text-sm font-semibold mt-4">
                      🔔 Admin has been notified to add a new room
                    </div>
                  </div>
                ) : (
                  <div className="space-y-6">
                    <span className="text-6xl sm:text-8xl">🔍</span>
                    <p className="text-2xl font-bold text-slate-400 leading-relaxed">
                      No quarantine room is mapped to this condition.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* RESTART BUTTON */}
            <button onClick={restart}
              className="mt-4 mx-auto btn-outline flex items-center justify-center gap-3 text-2xl font-bold py-6 px-12 rounded-2xl hover:bg-slate-50 transition-colors">
              <FaRedo /> Start New Assessment
            </button>

          </div>
        )}

      </div>
    </div>
  );
};

export default DetectSickness;
