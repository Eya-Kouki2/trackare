import { useEffect, useState, useMemo, useCallback } from "react";
import { useOutletContext } from "react-router-dom";
import { Link } from "react-router-dom";
import api from "../../api/axios";
import { FaExclamationTriangle, FaCheck, FaPlus } from "react-icons/fa";
import PageHeader from "../../components/admin/PageHeader";
import { getMaladieLabel } from "../../constants/maladies";

const Alerts = () => {
  const { user } = useOutletContext();
  const [diseaseClasses, setDiseaseClasses] = useState([]);
  const [patients, setPatients] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [noRoomAlerts, setNoRoomAlerts] = useState([]);

  const loadNoRoomAlerts = () => {
    const stored = JSON.parse(localStorage.getItem("noRoomAlerts") || "[]");
    setNoRoomAlerts(stored);
  };

  const loadData = useCallback(async () => {
    if (!user?.area) return;
    try {
      const [patientsRes, classesRes] = await Promise.all([
        api.get("/api/patients/stats"),
        api.get("/api/disease-classes")
      ]);
      setPatients(patientsRes.data.patients || []);
      setDiseaseClasses(classesRes.data.diseaseClasses || []);
    } catch (error) {
      console.error("Failed to load alerts data", error);
    } finally {
      setIsLoading(false);
    }
    loadNoRoomAlerts();
  }, [user?.area]);

  useEffect(() => {
    loadData();
    const intervalId = setInterval(loadData, 10000);
    window.addEventListener("alerts-updated", loadData);
    return () => {
      clearInterval(intervalId);
      window.removeEventListener("alerts-updated", loadData);
    };
  }, [loadData]);

  const getPatientsInClass = useCallback((placeCode) => {
    return patients.filter((p) => {
      if (!p.history || p.history.length === 0) return false;
      const sortedHistory = [...p.history].sort((a, b) => new Date(b.date) - new Date(a.date));
      const latestTriage = sortedHistory[0]?.triage;
      return latestTriage?.suggestedClass?.placeCode === Number(placeCode);
    });
  }, [patients]);

  const fullRooms = useMemo(() => {
    return diseaseClasses.filter((room) => {
      const officialPatients = getPatientsInClass(room.placeCode).length;
      const kioskPatients = room.currentPatients || 0;
      return (officialPatients + kioskPatients) >= (room.maxPatients || 1);
    });
  }, [diseaseClasses, getPatientsInClass]);

  const handleDismiss = async (roomId) => {
    try {
      await api.post(`/api/disease-classes/${roomId}/reset-queue`);
      await loadData();
      window.dispatchEvent(new Event("alerts-updated"));
    } catch (err) {
      console.error("Failed to dismiss alert", err);
    }
  };

  const handleDismissNoRoom = (alertId) => {
    const stored = JSON.parse(localStorage.getItem("noRoomAlerts") || "[]");
    const updated = stored.filter((a) => a.id !== alertId);
    localStorage.setItem("noRoomAlerts", JSON.stringify(updated));
    setNoRoomAlerts(updated);
    window.dispatchEvent(new Event("alerts-updated"));
  };

  const totalAlerts = fullRooms.length + noRoomAlerts.length;

  if (!user?.area) return null;

  return (
    <div className="w-full animate-fade-in">
      <PageHeader
        title="Alerts"
        description="Manage active room capacity alerts"
      />

      {isLoading ? (
        <div className="flex justify-center p-12"><div className="w-8 h-8 border-4 border-health-blue border-t-transparent rounded-full animate-spin"></div></div>
      ) : totalAlerts === 0 ? (
        <div className="admin-card p-12 text-center flex flex-col items-center">
          <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-500 flex items-center justify-center mb-4">
            <FaCheck className="text-2xl" />
          </div>
          <h3 className="text-xl font-bold text-slate-800 mb-2">No Active Alerts</h3>
          <p className="text-slate-500">All rooms are currently operating within capacity limits.</p>
        </div>
      ) : (
        <div className="space-y-4">

          {/* ── No-room-available alerts (critical) ── */}
          {noRoomAlerts.map((alert) => (
            <div key={alert.id} className="admin-card bg-white border-2 border-orange-300 p-6 flex flex-col md:flex-row items-start md:items-center justify-between shadow-md">
              <div className="flex items-center gap-5">
                <div className="w-12 h-12 rounded-2xl bg-orange-100 text-orange-500 flex items-center justify-center shrink-0">
                  <FaExclamationTriangle className="text-2xl animate-pulse" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-orange-700">
                    All Rooms Full — {getMaladieLabel(alert.maladie)}
                  </h3>
                  <p className="text-sm text-slate-500 mt-0.5">
                    A patient with <strong>{getMaladieLabel(alert.maladie)}</strong> could not be assigned to any room. Please add a new class for this sickness.
                  </p>
                </div>
              </div>
              <div className="mt-4 md:mt-0 flex items-center gap-3 shrink-0">
                <Link
                  to="/admin/disease-classes"
                  className="flex items-center gap-2 px-5 py-2.5 bg-orange-500 text-white hover:bg-orange-600 rounded-xl font-bold transition-colors text-sm"
                >
                  <FaPlus /> Add Class
                </Link>
                <button
                  onClick={() => handleDismissNoRoom(alert.id)}
                  className="px-5 py-2.5 bg-slate-100 text-slate-600 hover:bg-slate-200 rounded-xl font-bold transition-colors flex items-center gap-2 text-sm"
                >
                  <FaCheck /> Done
                </button>
              </div>
            </div>
          ))}

          {/* ── Full-room alerts ── */}
          {fullRooms.map((room) => {
            const officialPatients = getPatientsInClass(room.placeCode).length;
            const kioskPatients = room.currentPatients || 0;
            const total = officialPatients + kioskPatients;
            return (
              <div key={room._id} className="admin-card bg-white border border-red-200 p-6 flex flex-col md:flex-row items-start md:items-center justify-between shadow-sm hover:shadow-md transition-shadow">
                <div className="flex items-center gap-5">
                  <div className="w-12 h-12 rounded-2xl bg-red-50 text-red-500 flex items-center justify-center shrink-0">
                    <FaExclamationTriangle className="text-2xl animate-pulse" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-slate-800">Room FULL: {getMaladieLabel(room.maladie)} <span className="text-slate-400 text-base font-semibold">Class {room.classNumber || 1}</span></h3>
                    <div className="flex flex-wrap items-center gap-3 mt-1">
                      <span className="px-2 py-1 bg-slate-100 text-slate-600 rounded-md text-xs font-semibold">
                        Capacity: {room.maxPatients}
                      </span>
                      <span className="text-slate-500 text-sm">
                        Current: <strong className="text-red-500">{total}</strong>
                        <span className="text-xs ml-1">(Official: {officialPatients}, Waiting: {kioskPatients})</span>
                      </span>
                    </div>
                  </div>
                </div>
                <div className="mt-4 md:mt-0 flex items-center gap-3 shrink-0">
                  <Link
                    to="/admin/disease-classes"
                    className="flex items-center gap-2 px-5 py-2.5 bg-red-500 text-white hover:bg-red-600 rounded-xl font-bold transition-colors text-sm"
                  >
                    <FaPlus /> Manage Rooms
                  </Link>
                  <button
                    onClick={() => handleDismiss(room._id)}
                    className="px-5 py-2.5 bg-slate-100 text-slate-600 hover:bg-slate-200 rounded-xl font-bold transition-colors flex items-center gap-2 text-sm"
                  >
                    <FaCheck /> Done
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default Alerts;
