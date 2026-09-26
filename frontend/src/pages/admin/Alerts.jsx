import { useEffect, useState, useMemo, useCallback } from "react";
import { useOutletContext } from "react-router-dom";
import { Link } from "react-router-dom";
import api from "../../api/axios";
import { FaExclamationTriangle, FaCheck, FaPlus, FaBell } from "react-icons/fa";
import PageHeader from "../../components/admin/PageHeader";
import { getMaladieLabel } from "../../constants/maladies";

/* ── Helper: read noRoomAlerts from localStorage ──────────────────── */
const readNoRoomAlerts = () => {
  try {
    return JSON.parse(localStorage.getItem("noRoomAlerts") || "[]");
  } catch {
    return [];
  }
};

const Alerts = () => {
  const { user } = useOutletContext();
  const isAdmin = user?.role === "admin";
  const basePath = isAdmin ? "/admin" : "/nurse";
  const [diseaseClasses, setDiseaseClasses] = useState([]);
  const [patients, setPatients] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [noRoomAlerts, setNoRoomAlerts] = useState(readNoRoomAlerts);
  const [waitingTokens, setWaitingTokens] = useState([]);

  /* ── Core data loader ─────────────────────────────────────────────── */
  const loadData = useCallback(async () => {
    if (!user?.area) return;
    const areaId = user.area?._id || user.area;
    try {
      const [patientsRes, classesRes, sessionsRes] = await Promise.all([
        api.get("/api/patients/stats"),
        api.get("/api/disease-classes"),
        api
          .get(`/api/triage-sessions/active?areaId=${areaId}`)
          .catch(() => ({ data: { sessions: [] } })),
      ]);
      setPatients(patientsRes.data.patients || []);
      setDiseaseClasses(classesRes.data.diseaseClasses || []);

      const allActive = sessionsRes.data?.sessions || [];
      const waiting = allActive.filter((s) => s.status === "waiting_room");
      setWaitingTokens(waiting);

      // Also refresh localStorage alerts, auto-purging any that now have configured rooms
      const rawStored = readNoRoomAlerts();
      const validStored = rawStored.filter((alert) => {
        return !(classesRes.data.diseaseClasses || []).some(
          (c) => (c.maladie || "").toLowerCase() === (alert.maladie || "").toLowerCase()
        );
      });
      if (validStored.length !== rawStored.length) {
        localStorage.setItem("noRoomAlerts", JSON.stringify(validStored));
      }
      setNoRoomAlerts(validStored);
    } catch (error) {
      console.error("Failed to load alerts data", error);
    } finally {
      setIsLoading(false);
    }
  }, [user?.area]);

  /* ── Polling + window event listener ─────────────────────────────── */
  useEffect(() => {
    loadData();
    // Poll every 5s for faster feedback
    const intervalId = setInterval(loadData, 5000);

    const onAlertsUpdated = () => {
      loadData();
      setNoRoomAlerts(readNoRoomAlerts());
    };
    window.addEventListener("alerts-updated", onAlertsUpdated);

    return () => {
      clearInterval(intervalId);
      window.removeEventListener("alerts-updated", onAlertsUpdated);
    };
  }, [loadData]);

  /* ── SSE listener for real-time cross-browser notifications ──────── */
  useEffect(() => {
    if (!user?.area) return;

    const isDev =
      window.location.hostname === "localhost" ||
      window.location.hostname === "127.0.0.1";
    const sseUrl = isDev
      ? "http://localhost:5000/api/result/stream"
      : "/api/result/stream";

    const sse = new EventSource(sseUrl);

    sse.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        // Refresh on any patient queue change event
        if (
          data.type === "CAPACITY_OVERFLOW_ALERT" ||
          data.type === "TOKEN_CREATED" ||
          data.type === "WAITING_PATIENT_ASSIGNED" ||
          data.type === "CONSULTATION_COMPLETED"
        ) {
          loadData();
        }
      } catch (err) {
        console.error("SSE parse error in Alerts:", err);
      }
    };

    return () => sse.close();
  }, [user?.area, loadData]);

  /* ── Helpers ──────────────────────────────────────────────────────── */
  const getPatientsInClass = useCallback(
    (placeCode) => {
      return patients.filter((p) => {
        if (!p.history || p.history.length === 0) return false;
        const sortedHistory = [...p.history].sort(
          (a, b) => new Date(b.date) - new Date(a.date)
        );
        const latestTriage = sortedHistory[0]?.triage;
        return latestTriage?.suggestedClass?.placeCode === Number(placeCode);
      });
    },
    [patients]
  );

  // Group rooms by sickness and ONLY trigger alert when ALL rooms for that sickness are full
  const overflowSicknesses = useMemo(() => {
    const sicknessMap = {};
    diseaseClasses.forEach((room) => {
      if (!room.maladie) return;
      const key = room.maladie.toLowerCase();
      if (!sicknessMap[key]) {
        sicknessMap[key] = [];
      }
      sicknessMap[key].push(room);
    });

    const result = [];
    Object.keys(sicknessMap).forEach((maladieKey) => {
      const rooms = sicknessMap[maladieKey];
      if (!rooms || rooms.length === 0) return;

      // Check if EVERY SINGLE ROOM for this sickness is full (and actively occupied)
      const allRoomsFull = rooms.every((r) => {
        const kioskPatients = r.currentPatients || 0;
        return kioskPatients > 0 && kioskPatients >= (r.maxPatients || 1);
      });

      if (allRoomsFull) {
        result.push({
          maladie: maladieKey,
          label: getMaladieLabel(maladieKey),
          totalRooms: rooms.length,
          totalCapacity: rooms.reduce((sum, r) => sum + (r.maxPatients || 1), 0),
          totalPatients: rooms.reduce((sum, r) => sum + (r.currentPatients || 0), 0),
        });
      }
    });

    return result;
  }, [diseaseClasses, getPatientsInClass]);

  const handleDismissNoRoom = (alertId) => {
    const stored = readNoRoomAlerts();
    const updated = stored.filter((a) => a.id !== alertId);
    localStorage.setItem("noRoomAlerts", JSON.stringify(updated));
    setNoRoomAlerts(updated);
    window.dispatchEvent(new Event("alerts-updated"));
  };

  const totalAlerts =
    overflowSicknesses.length + noRoomAlerts.length + waitingTokens.length;

  if (!user?.area) return null;

  return (
    <div className="w-full animate-fade-in">
      <PageHeader
        title="Alerts"
        description="Manage active room capacity alerts and waiting patient queue"
      />

      {isLoading ? (
        <div className="flex justify-center p-12">
          <div className="w-8 h-8 border-4 border-health-blue border-t-transparent rounded-full animate-spin" />
        </div>
      ) : totalAlerts === 0 ? (
        <div className="admin-card p-12 text-center flex flex-col items-center">
          <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-500 flex items-center justify-center mb-4">
            <FaCheck className="text-2xl" />
          </div>
          <h3 className="text-xl font-bold text-slate-800 mb-2">
            No Active Alerts
          </h3>
          <p className="text-slate-500">
            All rooms are currently operating within capacity limits with no
            holding tokens.
          </p>
        </div>
      ) : (
        <div className="space-y-4">

          {/* ── Active Waiting Tokens (Critical Queue Alerts) ── */}
          {waitingTokens.map((session) => (
            <div
              key={session._id}
              className="admin-card bg-amber-50 border-2 border-amber-400 p-6 flex flex-col md:flex-row items-start md:items-center justify-between shadow-md"
            >
              <div className="flex items-center gap-5">
                {/* Pulsing bell icon */}
                <div className="relative w-14 h-14 flex items-center justify-center shrink-0">
                  <div className="absolute inset-0 rounded-2xl bg-amber-300 animate-ping opacity-40" />
                  <div className="relative w-14 h-14 rounded-2xl bg-amber-100 text-amber-600 flex items-center justify-center text-2xl z-10">
                    <FaBell />
                  </div>
                </div>

                <div>
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <span className="text-lg font-black text-amber-900">
                      🚨 Token #{session.tokenNumber} — Waiting for Room
                    </span>
                    <span className="text-xs bg-amber-300 text-amber-900 font-bold px-2.5 py-0.5 rounded-full uppercase tracking-wide">
                      {session.prediction?.label || "General Sickness"}
                    </span>
                  </div>
                  <p className="text-sm text-slate-600 leading-relaxed">
                    All rooms for{" "}
                    <strong>
                      {session.prediction?.label || "this condition"}
                    </strong>{" "}
                    are full.{" "}
                    <span className="text-amber-700 font-semibold">
                      Add a new room/class
                    </span>{" "}
                    or finish an ongoing consultation to auto-assign this
                    patient.
                  </p>
                  <p className="text-xs text-slate-400 mt-1">
                    Arrived:{" "}
                    {new Date(session.createdAt).toLocaleTimeString()}
                  </p>
                </div>
              </div>

              <div className="mt-4 md:mt-0 flex items-center gap-3 shrink-0">
                {isAdmin ? (
                  <Link
                    to="/admin/disease-classes"
                    className="flex items-center gap-2 px-5 py-2.5 bg-amber-600 text-white hover:bg-amber-700 rounded-xl font-bold transition-colors text-sm shadow"
                  >
                    <FaPlus /> Add Class / Room
                  </Link>
                ) : (
                  <Link
                    to={`${basePath}/patients`}
                    className="flex items-center gap-2 px-5 py-2.5 bg-amber-600 text-white hover:bg-amber-700 rounded-xl font-bold transition-colors text-sm shadow"
                  >
                    View Patients
                  </Link>
                )}
                <Link
                  to={`${basePath}/triage`}
                  className="px-4 py-2.5 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-xl font-bold transition-colors text-sm"
                >
                  Open Triage
                </Link>
              </div>
            </div>
          ))}

          {/* ── No-room-available alerts (localStorage fallback) ── */}
          {noRoomAlerts.map((alert) => (
            <div
              key={alert.id}
              className="admin-card bg-white border-2 border-orange-300 p-6 flex flex-col md:flex-row items-start md:items-center justify-between shadow-md"
            >
              <div className="flex items-center gap-5">
                <div className="w-12 h-12 rounded-2xl bg-orange-100 text-orange-500 flex items-center justify-center shrink-0">
                  <FaExclamationTriangle className="text-2xl animate-pulse" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-orange-700">
                    All Rooms Full — {getMaladieLabel(alert.maladie)}
                  </h3>
                  <p className="text-sm text-slate-500 mt-0.5">
                    A patient with{" "}
                    <strong>{getMaladieLabel(alert.maladie)}</strong> could not
                    be assigned to any room. Please add a new class for this
                    sickness.
                  </p>
                </div>
              </div>
              <div className="mt-4 md:mt-0 flex items-center gap-3 shrink-0">
                {isAdmin && (
                  <Link
                    to="/admin/disease-classes"
                    className="flex items-center gap-2 px-5 py-2.5 bg-orange-500 text-white hover:bg-orange-600 rounded-xl font-bold transition-colors text-sm"
                  >
                    <FaPlus /> Add Class
                  </Link>
                )}
                <button
                  onClick={() => handleDismissNoRoom(alert.id)}
                  className="px-5 py-2.5 bg-slate-100 text-slate-600 hover:bg-slate-200 rounded-xl font-bold transition-colors flex items-center gap-2 text-sm"
                >
                  <FaCheck /> Done
                </button>
              </div>
            </div>
          ))}

          {/* ── Sickness-level All-Rooms-Full Alerts ── */}
          {overflowSicknesses.map((item) => (
            <div
              key={item.maladie}
              className="admin-card bg-red-50 border-2 border-red-300 p-6 flex flex-col md:flex-row items-start md:items-center justify-between shadow-md"
            >
              <div className="flex items-center gap-5">
                <div className="w-14 h-14 rounded-2xl bg-red-100 text-red-600 flex items-center justify-center shrink-0 border border-red-200">
                  <FaExclamationTriangle className="text-3xl animate-pulse" />
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-xl font-black text-red-900">
                      🚨 ALL ROOMS FULL: {item.label}
                    </h3>
                    <span className="text-xs bg-red-200 text-red-900 font-extrabold px-3 py-1 rounded-full uppercase tracking-wider">
                      {item.totalRooms} / {item.totalRooms} Rooms Occupied
                    </span>
                  </div>
                  <p className="text-sm text-slate-600 leading-relaxed">
                    Every room configured for <strong>{item.label}</strong> is at 100% capacity ({item.totalPatients} / {item.totalCapacity} total capacity).
                    <span className="text-red-700 font-bold ml-1">
                      {isAdmin ? "Add a new class / room for " + item.label + " to accommodate incoming patients." : "Please notify the administrator to allocate another room for " + item.label + "."}
                    </span>
                  </p>
                </div>
              </div>
              <div className="mt-4 md:mt-0 flex items-center gap-3 shrink-0">
                {isAdmin ? (
                  <Link
                    to="/admin/disease-classes"
                    className="flex items-center gap-2 px-5 py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold transition-colors text-sm shadow-md"
                  >
                    <FaPlus /> Add Class / Room
                  </Link>
                ) : (
                  <Link
                    to={`${basePath}/patients`}
                    className="flex items-center gap-2 px-5 py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold transition-colors text-sm shadow-md"
                  >
                    View Patients
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Alerts;