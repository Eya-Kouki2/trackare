import api from "../../api/axios";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useOutletContext } from "react-router-dom";
import {
  FaEdit,
  FaPlus,
  FaTimes,
  FaTrash,
  FaUserMd,
  FaDoorOpen,
  FaUsers,
  FaHospitalUser,
  FaCheckCircle,
} from "react-icons/fa";
import { MALADIES, getMaladieLabel } from "../../constants/maladies";
import PageHeader from "../../components/admin/PageHeader";
import { getInitials } from "../../utils/getInitials";

const emptyForm = {
  placeCode: "",
  description: "",
  maladie: "",
  maxPatients: 1,
  doctorId: "",
};

const DiseaseClasses = () => {
  const { user } = useOutletContext();
  const [classes, setClasses] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [activeSessions, setActiveSessions] = useState([]);
  const [selectedClassForTokens, setSelectedClassForTokens] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [errorMessage, setErrorMessage] = useState(null);

  const loadClasses = async () => {
    try {
      const areaId = user?.area?._id || user?.area;
      const [classesRes, sessionsRes, staffRes] = await Promise.all([
        api.get("/api/disease-classes"),
        api
          .get(`/api/triage-sessions/active${areaId ? `?areaId=${areaId}` : ""}`)
          .catch(() => ({ data: { sessions: [] } })),
        api.get("/api/auth/staff").catch(() => ({ data: { staff: [] } })),
      ]);

      setClasses(classesRes.data.diseaseClasses || []);
      setActiveSessions(sessionsRes.data?.sessions || []);

      const allStaff = staffRes.data?.staff || [];
      const doctorStaff = allStaff.filter(
        (s) => s.role === "doctor" || s.role === "doctors"
      );
      setDoctors(doctorStaff);
    } catch (error) {
      console.error("Failed to load disease Rooms", error);
      if (error.response?.status === 503) {
        setErrorMessage(error.response.data.message);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const getActiveTokensForRoom = useCallback(
    (room) => {
      if (!room) return [];
      return activeSessions.filter((session) => {
        const sessRoom = session.assignedRoom || session.suggestedClass;
        if (!sessRoom) return false;
        const sessRoomId = sessRoom._id || sessRoom.diseaseClassId;
        const sessPlaceCode = sessRoom.placeCode;
        return (
          (sessRoomId && String(sessRoomId) === String(room._id)) ||
          (sessPlaceCode && Number(sessPlaceCode) === Number(room.placeCode))
        );
      });
    },
    [activeSessions]
  );

  useEffect(() => {
    if (!user?.area) {
      setIsLoading(false);
      return;
    }
    loadClasses();

    const handleRefresh = () => loadClasses();
    window.addEventListener("alerts-updated", handleRefresh);
    const interval = setInterval(loadClasses, 3000);

    // SSE listener for instant cross-browser room capacity updates
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
        if (
          data.type === "TOKEN_CREATED" ||
          data.type === "WAITING_PATIENT_ASSIGNED" ||
          data.type === "CAPACITY_OVERFLOW_ALERT" ||
          data.type === "CONSULTATION_COMPLETED"
        ) {
          loadClasses();
        }
      } catch (err) {
        console.error("SSE parse error in DiseaseClasses:", err);
      }
    };

    return () => {
      window.removeEventListener("alerts-updated", handleRefresh);
      clearInterval(interval);
      sse.close();
    };
  }, [user?.area]);

  const stats = useMemo(() => {
    const totalRooms = classes.length;
    const totalCapacity = classes.reduce(
      (sum, c) => sum + (c.maxPatients || 1),
      0
    );
    const activePatients = classes.reduce(
      (sum, c) => sum + (c.currentPatients || 0),
      0
    );
    const roomsWithDoctors = classes.filter((c) => c.doctorId).length;
    return { totalRooms, totalCapacity, activePatients, roomsWithDoctors };
  }, [classes]);

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId(null);
    setShowForm(false);
    setErrorMessage(null);
  };

  const openCreateForm = () => {
    setForm(emptyForm);
    setEditingId(null);
    setShowForm(true);
    setErrorMessage(null);
  };

  const openEditForm = (item) => {
    setForm({
      placeCode: item.placeCode ?? "",
      description: item.description || "",
      maladie: item.maladie || "",
      maxPatients: item.maxPatients || 1,
      doctorId: item.doctorId?._id || item.doctorId || "",
    });
    setEditingId(item._id);
    setShowForm(true);
    setErrorMessage(null);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setErrorMessage(null);
    if (!form.maladie) {
      setErrorMessage("Please choose a maladie.");
      return;
    }
    if (
      form.placeCode !== "" &&
      (Number(form.placeCode) < 1 || Number(form.placeCode) > 200)
    ) {
      setErrorMessage("Place code must be between 1 and 200.");
      return;
    }
    if (form.placeCode !== "") {
      const placeCode = Number(form.placeCode);
      if (
        classes.some(
          (item) =>
            Number(item.placeCode) === placeCode && item._id !== editingId
        )
      ) {
        setErrorMessage(`Place code ${placeCode} is already in use.`);
        return;
      }
    }
    try {
      setIsSaving(true);
      const payload = {
        ...form,
        placeCode: form.placeCode === "" ? undefined : Number(form.placeCode),
        maxPatients: form.maxPatients ? Number(form.maxPatients) : 1,
        doctorId: form.doctorId || null,
      };
      if (editingId)
        await api.put(`/api/disease-classes/${editingId}`, payload);
      else await api.post("/api/disease-classes", payload);
      await loadClasses();
      resetForm();
    } catch (error) {
      setErrorMessage(
        error.response?.status === 503
          ? error.response.data.message
          : error.response?.data?.message || "Failed to save room."
      );
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
      setErrorMessage(
        error.response?.data?.message || "Failed to delete room."
      );
    }
  };

  const adjustQueue = async (id, action) => {
    try {
      if (action === "increment")
        await api.post(`/api/disease-classes/${id}/increment`);
      else if (action === "decrement")
        await api.post(`/api/disease-classes/${id}/decrement`);
      else if (action === "reset")
        await api.post(`/api/disease-classes/${id}/reset-queue`);
      await loadClasses();
      window.dispatchEvent(new Event("alerts-updated"));
    } catch (error) {
      setErrorMessage(
        error.response?.data?.message || `Failed to ${action} queue.`
      );
    }
  };

  if (!user?.area) {
    return (
      <div className="w-full">
        <PageHeader
          title="Disease Rooms"
          description="Monitor and manage disease rooms"
        />
        <div className="admin-card p-10 text-center">
          <p className="text-2xl mb-2">🏥</p>
          <p className="text-xs text-slate-500 font-medium">
            Complete clinic setup to manage disease Rooms.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full animate-fade-in space-y-6">
      <PageHeader
        title="Disease Rooms"
        description={`Classifications and room doctor assignments for ${user.area.name}`}
        actions={
          <button
            type="button"
            onClick={openCreateForm}
            className="btn-primary flex items-center gap-2"
          >
            <FaPlus className="text-xs" /> Add room
          </button>
        }
      />

      {/* ── KPI Summary Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="admin-card p-4 flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-blue-50 text-blue-600 border border-blue-100 flex items-center justify-center text-xl shrink-0">
            <FaDoorOpen />
          </div>
          <div>
            <p className="text-2xl font-bold text-slate-800">
              {stats.totalRooms}
            </p>
            <p className="text-xs text-slate-400 font-medium">Total Rooms</p>
          </div>
        </div>

        <div className="admin-card p-4 flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-teal-50 text-teal-600 border border-teal-100 flex items-center justify-center text-xl shrink-0">
            <FaUserMd />
          </div>
          <div>
            <p className="text-2xl font-bold text-slate-800">
              {stats.roomsWithDoctors}{" "}
              <span className="text-xs text-slate-400 font-normal">
                / {stats.totalRooms}
              </span>
            </p>
            <p className="text-xs text-slate-400 font-medium">Rooms with Doctor</p>
          </div>
        </div>

        <div className="admin-card p-4 flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-indigo-50 text-indigo-600 border border-indigo-100 flex items-center justify-center text-xl shrink-0">
            <FaUsers />
          </div>
          <div>
            <p className="text-2xl font-bold text-slate-800">
              {stats.activePatients}
            </p>
            <p className="text-xs text-slate-400 font-medium">Current Queue</p>
          </div>
        </div>

        <div className="admin-card p-4 flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-emerald-50 text-emerald-600 border border-emerald-100 flex items-center justify-center text-xl shrink-0">
            <FaHospitalUser />
          </div>
          <div>
            <p className="text-2xl font-bold text-slate-800">
              {stats.totalCapacity}
            </p>
            <p className="text-xs text-slate-400 font-medium">Max Bed Capacity</p>
          </div>
        </div>
      </div>

      {errorMessage && !showForm && (
        <div className="admin-card border-red-100 bg-red-50 p-4">
          <p className="text-xs text-red-600 font-medium">{errorMessage}</p>
        </div>
      )}

      {/* ── Form panel (Add / Edit Room) ── */}
      {showForm && (
        <div className="admin-card p-5 sm:p-6 border-health-blue/20 shadow-lg animate-fadeIn">
          <div className="flex items-center justify-between mb-5 border-b border-slate-100 pb-4">
            <div>
              <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
                <FaDoorOpen className="text-health-blue" />
                {editingId ? "Edit Disease Room" : "Add New Disease Room"}
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Configure room details, target condition, and assigned attending doctor.
              </p>
            </div>
            <button
              type="button"
              onClick={resetForm}
              className="w-8 h-8 rounded-xl flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            >
              <FaTimes />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="auth-label" htmlFor="dc-maladie">
                Target Sickness / Condition *
              </label>
              <select
                id="dc-maladie"
                value={form.maladie}
                onChange={(e) =>
                  setForm((p) => ({ ...p, maladie: e.target.value }))
                }
                className="auth-input font-medium"
                required
              >
                <option value="">Choose a condition</option>
                {MALADIES.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="auth-label" htmlFor="dc-doctor">
                Attending Doctor{" "}
                <span className="text-slate-400 normal-case font-normal">
                  (optional)
                </span>
              </label>
              <select
                id="dc-doctor"
                value={form.doctorId}
                onChange={(e) =>
                  setForm((p) => ({ ...p, doctorId: e.target.value }))
                }
                className="auth-input font-medium"
              >
                <option value="">-- No Doctor Assigned (Unassigned) --</option>
                {doctors.map((doc) => (
                  <option key={doc._id} value={doc._id}>
                    👨‍⚕️ {doc.name} ({doc.email})
                  </option>
                ))}
              </select>
              {doctors.length === 0 && (
                <p className="text-[11px] text-amber-600 mt-1">
                  💡 Tip: Set staff roles to "Doctor" in Hospital Staff to assign them to rooms.
                </p>
              )}
            </div>

            <div>
              <label className="auth-label" htmlFor="dc-code">
                Room Place Code{" "}
                <span className="text-slate-400 normal-case font-normal">
                  (optional, 1–200)
                </span>
              </label>
              <input
                id="dc-code"
                type="number"
                min={1}
                max={200}
                value={form.placeCode}
                onChange={(e) =>
                  setForm((p) => ({ ...p, placeCode: e.target.value }))
                }
                placeholder="Auto-assigned if empty"
                className="auth-input font-mono font-semibold"
              />
            </div>

            <div>
              <label className="auth-label" htmlFor="dc-max">
                Max Patient Capacity
              </label>
              <input
                id="dc-max"
                type="number"
                min={1}
                value={form.maxPatients}
                onChange={(e) =>
                  setForm((p) => ({ ...p, maxPatients: e.target.value }))
                }
                className="auth-input font-semibold"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="auth-label" htmlFor="dc-desc">
                Description / Clinical Notes{" "}
                <span className="text-slate-400 normal-case font-normal">
                  (optional)
                </span>
              </label>
              <textarea
                id="dc-desc"
                value={form.description}
                onChange={(e) =>
                  setForm((p) => ({ ...p, description: e.target.value }))
                }
                placeholder="Room location, specialized equipment, or notes..."
                rows={2}
                className="auth-input resize-none"
              />
            </div>

            {errorMessage && (
              <p className="sm:col-span-2 text-xs text-red-500 font-semibold bg-red-50 p-3 rounded-xl border border-red-100">
                {errorMessage}
              </p>
            )}

            <div className="sm:col-span-2 flex gap-3 pt-2">
              <button
                type="submit"
                disabled={isSaving}
                className="btn-primary flex items-center gap-2"
              >
                {isSaving
                  ? "Saving…"
                  : editingId
                  ? "Update Room"
                  : "Create Room"}
              </button>
              <button
                type="button"
                onClick={resetForm}
                className="btn-outline"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Room Cards Grid ── */}
      {isLoading ? (
        <div className="admin-card p-12 text-center">
          <div className="w-8 h-8 border-3 border-health-blue border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-xs text-slate-400 font-medium">
            Loading disease rooms…
          </p>
        </div>
      ) : classes.length === 0 ? (
        <div className="admin-card p-12 text-center">
          <p className="text-4xl mb-3">🏥</p>
          <p className="text-base font-bold text-slate-800">
            No disease rooms configured yet
          </p>
          <p className="text-xs text-slate-400 mt-1 mb-5 max-w-md mx-auto">
            Create disease consultation rooms to organize patient triage, queue routing, and doctor consultations.
          </p>
          <button
            type="button"
            onClick={openCreateForm}
            className="btn-primary mx-auto flex items-center gap-2"
          >
            <FaPlus className="text-xs" /> Add your first room
          </button>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-5">
          {classes.map((item) => {
            const assignedDoctor =
              typeof item.doctorId === "object" && item.doctorId
                ? item.doctorId
                : doctors.find((d) => d._id === item.doctorId);

            return (
              <div
                key={item._id}
                className="admin-card overflow-hidden flex flex-col hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 border-slate-200/80"
              >
                <div className="p-5 flex-1 flex flex-col">
                  {/* Header: Title and Edit/Delete Actions */}
                  <div className="flex items-start justify-between gap-3 mb-3.5">
                    <div>
                      <h3 className="text-base font-bold text-slate-800 break-words leading-tight">
                        {getMaladieLabel(item.maladie)}
                      </h3>
                      <span className="text-xs font-medium text-slate-400">
                        Class {item.classNumber || 1}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 shrink-0 bg-slate-50 rounded-xl p-1 border border-slate-100">
                      <button
                        type="button"
                        onClick={() => openEditForm(item)}
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-health-blue hover:bg-white hover:shadow-xs transition-all"
                        title={`Edit Room ${item.placeCode}`}
                      >
                        <FaEdit className="text-xs" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(item._id)}
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-white hover:shadow-xs transition-all"
                        title={`Delete Room ${item.placeCode}`}
                      >
                        <FaTrash className="text-xs" />
                      </button>
                    </div>
                  </div>

                  {/* Room Number & Capacity Header Card */}
                  <div className="flex items-center justify-between bg-blue-50/50 rounded-2xl p-3.5 border border-blue-100/60 mb-3.5">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-0.5">
                        Room Number
                      </p>
                      <code className="text-2xl font-mono font-black text-health-blue">
                        #{item.placeCode}
                      </code>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 block mb-0.5">
                        Capacity
                      </span>
                      <span
                        className={`text-sm font-black ${
                          item.currentPatients >= item.maxPatients
                            ? "text-red-600"
                            : "text-slate-700"
                        }`}
                      >
                        {item.currentPatients || 0} / {item.maxPatients}
                      </span>
                    </div>
                  </div>

                  {/* Attending Doctor Display */}
                  <div className="mb-3.5 p-3 rounded-2xl border transition-all bg-slate-50/70 border-slate-200/70">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5 flex items-center gap-1.5">
                      <FaUserMd className="text-teal-600 text-xs" />
                      Attending Doctor
                    </p>
                    {assignedDoctor ? (
                      <div className="flex items-center gap-2.5">
                        {assignedDoctor.profilePicture ? (
                          <img
                            src={assignedDoctor.profilePicture}
                            alt={assignedDoctor.name}
                            className="w-8 h-8 rounded-xl object-cover border border-teal-200"
                          />
                        ) : (
                          <div className="w-8 h-8 rounded-xl bg-teal-100 text-teal-800 flex items-center justify-center text-xs font-bold shrink-0">
                            {getInitials(assignedDoctor.name)}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-bold text-slate-800 truncate">
                            {assignedDoctor.name}
                          </p>
                          <p className="text-[11px] text-slate-400 truncate">
                            {assignedDoctor.email}
                          </p>
                        </div>
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-teal-100 text-teal-700 border border-teal-200 shrink-0">
                          Active
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs text-amber-700 font-medium italic">
                          No doctor assigned
                        </span>
                        <button
                          type="button"
                          onClick={() => openEditForm(item)}
                          className="text-[10px] font-bold text-health-blue hover:underline bg-white px-2 py-0.5 rounded-lg border border-slate-200 shadow-xs"
                        >
                          + Assign
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Capacity bar */}
                  {item.maxPatients && (
                    <div className="mb-3">
                      <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            item.currentPatients >= item.maxPatients
                              ? "bg-red-500"
                              : item.currentPatients >=
                                item.maxPatients * 0.75
                              ? "bg-amber-400"
                              : "bg-health-blue"
                          }`}
                          style={{
                            width: `${Math.min(
                              ((item.currentPatients || 0) /
                                item.maxPatients) *
                                100,
                              100
                            )}%`,
                          }}
                        />
                      </div>
                      {item.currentPatients >= item.maxPatients && (
                        <p className="text-[10px] text-red-500 font-bold mt-1">
                          ⚠ Room at maximum capacity
                        </p>
                      )}
                    </div>
                  )}

                  {item.description && (
                    <p className="text-xs text-slate-500 leading-relaxed flex-1 mb-3">
                      {item.description}
                    </p>
                  )}

                  {/* View Cohort Tokens Button */}
                  <button
                    type="button"
                    onClick={() => setSelectedClassForTokens(item)}
                    className="w-full mt-1 py-2 px-3 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200/80 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors shadow-xs cursor-pointer"
                  >
                    🎫 View Patient Tokens ({getActiveTokensForRoom(item).length})
                  </button>

                  {/* Kiosk Queue Controls */}
                  <div className="mt-auto pt-3 border-t border-slate-100 flex items-center justify-between">
                    <div className="flex flex-col">
                      <span className="text-[9px] font-bold uppercase text-slate-400">
                        Waiting Queue (Kiosk)
                      </span>
                      <span className="text-xs font-black text-slate-800">
                        {item.currentPatients || 0} patients
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => adjustQueue(item._id, "decrement")}
                        disabled={
                          !item.currentPatients || item.currentPatients === 0
                        }
                        className="w-7 h-7 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center hover:bg-slate-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        title="Decrease Queue"
                      >
                        <span className="text-base font-bold leading-none -mt-0.5">
                          -
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => adjustQueue(item._id, "increment")}
                        disabled={
                          (item.currentPatients || 0) >=
                          (item.maxPatients || 1)
                        }
                        className="w-7 h-7 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center hover:bg-slate-200 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        title={
                          (item.currentPatients || 0) >=
                          (item.maxPatients || 1)
                            ? "Room at maximum capacity"
                            : "Increase Queue"
                        }
                      >
                        <span className="text-base font-bold leading-none -mt-0.5">
                          +
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => adjustQueue(item._id, "reset")}
                        disabled={
                          !item.currentPatients || item.currentPatients === 0
                        }
                        className="px-2 h-7 rounded-lg bg-red-50 text-red-600 text-[10px] font-bold tracking-wider hover:bg-red-100 transition-colors uppercase disabled:opacity-40 disabled:cursor-not-allowed"
                        title="Reset to 0"
                      >
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

      {/* ── Cohort Tokens Table Modal ── */}
      {selectedClassForTokens && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-3xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl border border-slate-100 overflow-hidden animate-fadeIn">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-gradient-to-r from-health-navy to-health-blue text-white">
              <div>
                <h3 className="text-base font-bold flex items-center gap-2">
                  🎫 Room #{selectedClassForTokens.placeCode} Active Patient Tokens
                </h3>
                <p className="text-xs text-blue-100 font-medium mt-0.5">
                  Condition:{" "}
                  <span className="font-bold">
                    {getMaladieLabel(selectedClassForTokens.maladie)}
                  </span>
                </p>
              </div>
              <button
                onClick={() => setSelectedClassForTokens(null)}
                className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 text-white flex items-center justify-center font-bold text-base transition-colors"
              >
                &times;
              </button>
            </div>

            {/* Table Content */}
            <div className="p-6 overflow-y-auto space-y-4">
              {(() => {
                const tokens = getActiveTokensForRoom(selectedClassForTokens);
                if (tokens.length === 0) {
                  return (
                    <div className="py-12 text-center text-slate-400 text-sm bg-slate-50 rounded-2xl border border-slate-200/80 p-8">
                      <p className="text-3xl mb-2">📋</p>
                      <p className="font-bold text-slate-600">
                        No Active Tokens Assigned
                      </p>
                      <p className="text-xs text-slate-400 mt-1">
                        There are no patient tokens currently assigned to Room #
                        {selectedClassForTokens.placeCode}.
                      </p>
                    </div>
                  );
                }

                return (
                  <div className="overflow-x-auto rounded-2xl border border-slate-200/80 shadow-sm">
                    <table className="w-full text-left border-collapse bg-white">
                      <thead>
                        <tr className="bg-slate-100/80 border-b border-slate-200 text-[10px] font-black uppercase tracking-wider text-slate-500">
                          <th className="p-3.5">#</th>
                          <th className="p-3.5">Token Number</th>
                          <th className="p-3.5">Priority</th>
                          <th className="p-3.5">Status</th>
                          <th className="p-3.5">Time Arrived</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-xs font-medium">
                        {tokens.map((t, idx) => {
                          const priority =
                            t.priority || t.prediction?.priority || "GREEN";
                          const rawStatus = t.status;
                          const statusText =
                            rawStatus === "in_consultation"
                              ? "In Consultation"
                              : rawStatus === "completed"
                              ? "Completed"
                              : "Assigned";

                          return (
                            <tr
                              key={t._id}
                              className="hover:bg-slate-50/80 transition-colors"
                            >
                              <td className="p-3.5 font-bold text-slate-400">
                                {idx + 1}
                              </td>
                              <td className="p-3.5 font-black text-health-blue text-sm">
                                🎫 #{t.tokenNumber}
                              </td>
                              <td className="p-3.5">
                                <span
                                  className={`px-2.5 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider ${
                                    priority === "RED" ||
                                    priority === "CRITICAL" ||
                                    priority === "HIGH"
                                      ? "bg-red-100 text-red-700 border border-red-200"
                                      : priority === "ORANGE" ||
                                        priority === "MODERATE"
                                      ? "bg-amber-100 text-amber-700 border border-amber-200"
                                      : "bg-emerald-100 text-emerald-700 border border-emerald-200"
                                  }`}
                                >
                                  {priority}
                                </span>
                              </td>
                              <td className="p-3.5">
                                <span
                                  className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                                    rawStatus === "in_consultation"
                                      ? "bg-amber-100 text-amber-800"
                                      : rawStatus === "completed"
                                      ? "bg-purple-100 text-purple-800"
                                      : "bg-emerald-100 text-emerald-800"
                                  }`}
                                >
                                  ● {statusText}
                                </span>
                              </td>
                              <td className="p-3.5 text-slate-500 font-semibold">
                                {new Date(t.createdAt).toLocaleTimeString([], {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                );
              })()}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end">
              <button
                onClick={() => setSelectedClassForTokens(null)}
                className="px-5 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs rounded-xl transition-colors cursor-pointer"
              >
                Close List
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DiseaseClasses;
