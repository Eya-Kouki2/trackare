import { useEffect, useState, useMemo } from "react";
import api from "../../api/axios";
import { getInitials } from "../../utils/getInitials";
import {
  FaUserNurse,
  FaUserMd,
  FaSearch,
  FaSync,
  FaFilter,
  FaCheckCircle,
  FaTimesCircle,
  FaClock,
  FaDoorOpen,
  FaEdit,
  FaTimes,
  FaCheck,
  FaSpinner,
  FaHospitalUser,
} from "react-icons/fa";

/* ─── Role configuration ──────────────────────────────────── */
const ROLE_CONFIG = {
  doctor: {
    label: "Doctor",
    icon: "👨‍⚕️",
    bg: "bg-teal-50",
    text: "text-teal-700",
    border: "border-teal-200",
    badgeBg: "bg-teal-100/70",
  },
  nurses: {
    label: "Nurse",
    icon: "🩺",
    bg: "bg-blue-50",
    text: "text-blue-700",
    border: "border-blue-200",
    badgeBg: "bg-blue-100/70",
  },
  triage: {
    label: "Triage",
    icon: "🖥️",
    bg: "bg-violet-50",
    text: "text-violet-700",
    border: "border-violet-200",
    badgeBg: "bg-violet-100/70",
  },
  pharmacy: {
    label: "Pharmacy",
    icon: "💊",
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    border: "border-emerald-200",
    badgeBg: "bg-emerald-100/70",
  },
};

const normalizeRole = (role) => {
  if (role === "doctors" || role === "doctor") return "doctor";
  if (role === "nurse" || role === "nurses") return "nurses";
  if (role === "triage") return "triage";
  if (role === "pharmacy") return "pharmacy";
  return "nurses";
};

/* ─── Helpers ─────────────────────────────────────────────── */
const formatLastLogin = (date) => {
  if (!date) return "Never";
  const d = new Date(date);
  const now = new Date();
  const diffMs = now - d;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHr / 24);
  if (diffMin < 2) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
};

const isRecentlyActive = (date) => {
  if (!date) return false;
  return new Date() - new Date(date) < 15 * 60 * 1000;
};

/* ─── Avatar ──────────────────────────────────────────────── */
const Avatar = ({ name, picture, role }) => {
  const normRole = normalizeRole(role);
  const cfg = ROLE_CONFIG[normRole] || ROLE_CONFIG.nurses;
  if (picture) {
    return (
      <img
        src={picture}
        alt={name}
        className="w-12 h-12 rounded-2xl object-cover shadow-sm border border-slate-100"
      />
    );
  }
  return (
    <div
      className={`w-12 h-12 rounded-2xl flex items-center justify-center font-bold text-sm shadow-sm border ${cfg.bg} ${cfg.text} ${cfg.border}`}
    >
      {getInitials(name)}
    </div>
  );
};

/* ─── Edit Staff Role & Room Modal ────────────────────────── */
const EditStaffModal = ({ member, rooms, onClose, onSave }) => {
  const [selectedRole, setSelectedRole] = useState(normalizeRole(member.role));
  const [selectedRoom, setSelectedRoom] = useState(
    member.assignedRoom?._id || member.assignedRoom || ""
  );
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState(null);

  const handleSave = async () => {
    setSaving(true);
    setModalError(null);
    try {
      const payload = {
        role: selectedRole,
        assignedRoom: selectedRole === "doctor" ? selectedRoom || null : null,
      };
      const res = await api.put(`/api/auth/staff/${member._id}/role`, payload);
      onSave(res.data.staff);
      onClose();
    } catch (err) {
      setModalError(err.response?.data?.message || "Failed to update staff member.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4 animate-fadeIn">
      <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl border border-slate-100 overflow-hidden transform transition-all">
        {/* Header */}
        <div className="p-6 pb-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-health-blue/10 text-health-blue flex items-center justify-center text-lg">
              <FaHospitalUser />
            </div>
            <div>
              <h3 className="font-bold text-slate-800 text-base">Assign Role & Room</h3>
              <p className="text-xs text-slate-400 truncate max-w-56">{member.name}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <FaTimes />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-5">
          {modalError && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-600 flex items-center gap-2">
              <FaTimesCircle className="shrink-0" />
              <span>{modalError}</span>
            </div>
          )}

          {/* Role selector */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
              Select Role
            </label>
            <div className="grid grid-cols-2 gap-2.5">
              {Object.entries(ROLE_CONFIG).map(([key, cfg]) => {
                const isSelected = selectedRole === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSelectedRole(key)}
                    className={`flex items-center gap-2.5 p-3 rounded-2xl border text-left transition-all cursor-pointer ${
                      isSelected
                        ? `${cfg.bg} ${cfg.border} ring-2 ring-health-blue/30 shadow-sm`
                        : "border-slate-200 hover:border-slate-300 bg-white"
                    }`}
                  >
                    <span className="text-xl">{cfg.icon}</span>
                    <div>
                      <p
                        className={`text-xs font-bold ${
                          isSelected ? cfg.text : "text-slate-700"
                        }`}
                      >
                        {cfg.label}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Doctor Assigned Room (visible when role is doctor) */}
          {selectedRole === "doctor" && (
            <div className="p-4 bg-teal-50/60 border border-teal-200/80 rounded-2xl space-y-2 animate-fadeIn">
              <label className="flex items-center gap-1.5 text-xs font-bold text-teal-900 uppercase tracking-wider">
                <FaDoorOpen className="text-teal-600" />
                Assign Room for Doctor
              </label>
              <p className="text-[11px] text-teal-700/80">
                Choose the consultation / disease room this doctor attends:
              </p>

              {rooms.length === 0 ? (
                <div className="p-3 bg-white/80 rounded-xl text-xs text-amber-700 border border-amber-200">
                  ⚠️ No disease class rooms configured yet. Create rooms in the Disease Classes tab.
                </div>
              ) : (
                <select
                  value={selectedRoom}
                  onChange={(e) => setSelectedRoom(e.target.value)}
                  className="w-full px-3 py-2.5 text-xs font-semibold bg-white border border-teal-300 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-teal-500 transition-all shadow-sm"
                >
                  <option value="">-- No Room (General / Roaming) --</option>
                  {rooms.map((room) => (
                    <option key={room._id} value={room._id}>
                      Room {room.placeCode} — {room.maladie} {room.description ? `(${room.description})` : ""}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-5 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 bg-white border border-slate-200 rounded-xl hover:bg-slate-100 transition-all"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="btn-primary px-5 py-2 text-xs flex items-center gap-2"
          >
            {saving ? (
              <>
                <FaSpinner className="animate-spin text-xs" />
                Saving…
              </>
            ) : (
              <>
                <FaCheck className="text-xs" />
                Save Changes
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

/* ─── Staff Card ──────────────────────────────────────────── */
const StaffCard = ({ member, rooms, onEditClick }) => {
  const normRole = normalizeRole(member.role);
  const cfg = ROLE_CONFIG[normRole] || ROLE_CONFIG.nurses;
  const active = isRecentlyActive(member.lastLogin);
  const isDoctor = normRole === "doctor";

  // Resolve room details if doctor
  const assignedRoomObj =
    typeof member.assignedRoom === "object" && member.assignedRoom
      ? member.assignedRoom
      : rooms.find((r) => r._id === member.assignedRoom);

  return (
    <div className="admin-card p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:shadow-md transition-all duration-200 group">
      <div className="flex items-start gap-3.5 min-w-0">
        <div className="relative shrink-0">
          <Avatar name={member.name} picture={member.profilePicture} role={normRole} />
          <span
            className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-white shadow-sm ${
              active ? "bg-emerald-400 animate-pulse" : "bg-slate-300"
            }`}
            title={active ? "Active recently" : "Offline"}
          />
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-bold text-slate-800 truncate">{member.name}</p>
            <span
              className={`inline-flex items-center gap-1 text-[11px] font-bold px-2.5 py-0.5 rounded-full border ${cfg.bg} ${cfg.text} ${cfg.border}`}
            >
              <span>{cfg.icon}</span>
              {cfg.label}
            </span>
          </div>
          <p className="text-xs text-slate-400 truncate mt-0.5">{member.email}</p>

          <div className="flex items-center gap-3 mt-2 flex-wrap text-[11px]">
            <span className="flex items-center gap-1">
              {member.isVerified ? (
                <>
                  <FaCheckCircle className="text-emerald-500" />
                  <span className="text-emerald-600 font-semibold">Verified</span>
                </>
              ) : (
                <>
                  <FaTimesCircle className="text-amber-500" />
                  <span className="text-amber-600 font-semibold">Pending verification</span>
                </>
              )}
            </span>
            <span className="text-slate-300">·</span>
            <span className="flex items-center gap-1 text-slate-400">
              <FaClock className="text-slate-300" />
              Last seen:{" "}
              <span className="font-semibold text-slate-600">
                {formatLastLogin(member.lastLogin)}
              </span>
            </span>
          </div>
        </div>
      </div>

      {/* Right Column: Room badge (for doctors) & Edit Action */}
      <div className="flex items-center gap-3 self-end sm:self-center shrink-0">
        {isDoctor && (
          <div
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all ${
              assignedRoomObj
                ? "bg-teal-50 border-teal-200 text-teal-800 shadow-sm"
                : "bg-amber-50 border-amber-200 text-amber-700"
            }`}
          >
            <FaDoorOpen className={assignedRoomObj ? "text-teal-600 text-sm" : "text-amber-500 text-sm"} />
            <div>
              {assignedRoomObj ? (
                <span>
                  Room <strong className="font-bold text-teal-900">{assignedRoomObj.placeCode}</strong> ·{" "}
                  <span className="text-teal-700">{assignedRoomObj.maladie}</span>
                </span>
              ) : (
                <span className="italic">No room assigned</span>
              )}
            </div>
          </div>
        )}

        <button
          onClick={() => onEditClick(member)}
          className="btn-outline text-xs px-3 py-1.5 flex items-center gap-1.5 text-slate-600 hover:text-health-blue hover:border-health-blue/40 transition-colors"
          title="Change role or assign room"
        >
          <FaEdit className="text-xs" />
          <span>Edit Role</span>
        </button>
      </div>
    </div>
  );
};

/* ─── Role KPI Pill ───────────────────────────────────────── */
const KpiPill = ({ role, count, activeCount }) => {
  const cfg = ROLE_CONFIG[role];
  if (!cfg) return null;
  return (
    <div className="admin-card p-4 flex items-center gap-3.5">
      <div
        className={`w-11 h-11 rounded-2xl flex items-center justify-center text-2xl ${cfg.bg} border ${cfg.border} shrink-0`}
      >
        {cfg.icon}
      </div>
      <div className="min-w-0">
        <p className={`text-xl font-bold ${cfg.text}`}>{count}</p>
        <p className="text-xs text-slate-400 font-medium truncate">{cfg.label}s</p>
      </div>
      {activeCount > 0 && (
        <span className="ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-100 shrink-0">
          {activeCount} online
        </span>
      )}
    </div>
  );
};

/* ─── Main Page ────────────────────────────────────────────── */
const StaffList = () => {
  const [staff, setStaff] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [area, setArea] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [successToast, setSuccessToast] = useState(null);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [refreshing, setRefreshing] = useState(false);
  const [editingMember, setEditingMember] = useState(null);

  const fetchStaff = async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    setError(null);
    try {
      const res = await api.get("/api/auth/staff");
      setStaff(res.data.staff || []);
      setRooms(res.data.rooms || []);
      setArea(res.data.area || null);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to load staff list.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchStaff();
    const interval = setInterval(() => fetchStaff(true), 30000);
    return () => clearInterval(interval);
  }, []);

  const handleMemberUpdated = (updatedMember) => {
    setStaff((prev) =>
      prev.map((m) => (m._id === updatedMember._id ? updatedMember : m))
    );
    setSuccessToast(`Updated ${updatedMember.name}'s role to ${ROLE_CONFIG[normalizeRole(updatedMember.role)]?.label || updatedMember.role}!`);
    setTimeout(() => setSuccessToast(null), 4000);
  };

  const filtered = useMemo(() => {
    return staff.filter((m) => {
      const norm = normalizeRole(m.role);
      const matchRole = roleFilter === "all" || norm === roleFilter;
      const matchSearch =
        !search ||
        m.name.toLowerCase().includes(search.toLowerCase()) ||
        m.email.toLowerCase().includes(search.toLowerCase());
      return matchRole && matchSearch;
    });
  }, [staff, search, roleFilter]);

  const counts = useMemo(() => {
    const result = {};
    ["doctor", "nurses", "triage", "pharmacy"].forEach((r) => {
      const group = staff.filter((m) => normalizeRole(m.role) === r);
      result[r] = {
        total: group.length,
        active: group.filter((m) => isRecentlyActive(m.lastLogin)).length,
      };
    });
    return result;
  }, [staff]);

  const totalActive = staff.filter((m) => isRecentlyActive(m.lastLogin)).length;

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <div className="h-8 w-48 bg-slate-100 rounded-xl animate-pulse" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-20 bg-slate-100 rounded-2xl animate-pulse" />
          ))}
        </div>
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 bg-slate-100 rounded-2xl animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 space-y-5">
      {/* ── Page Header ─────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <FaHospitalUser className="text-health-blue text-2xl" />
            <h1 className="text-xl font-bold text-slate-800">Hospital Staff Management</h1>
            {totalActive > 0 && (
              <span className="text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-100 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse inline-block" />
                {totalActive} online
              </span>
            )}
          </div>
          {area && (
            <p className="text-sm text-slate-400">
              <span className="font-semibold text-slate-600">{area.name}</span>
              <span className="mx-1.5 text-slate-300">·</span>
              Area Code: <code className="font-mono text-xs text-health-blue font-bold">{area.code}</code>
            </p>
          )}
        </div>
        <button
          id="staff-refresh-btn"
          onClick={() => fetchStaff(true)}
          disabled={refreshing}
          className="btn-outline flex items-center gap-2 text-xs"
        >
          <FaSync className={refreshing ? "animate-spin text-xs" : "text-xs"} />
          Refresh
        </button>
      </div>

      {/* ── Toast Feedback ──────────────────────────── */}
      {successToast && (
        <div className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-2xl text-xs font-semibold flex items-center gap-2 animate-fadeIn shadow-sm">
          <FaCheckCircle className="text-emerald-500 text-sm shrink-0" />
          <span>{successToast}</span>
        </div>
      )}

      {error && (
        <div className="p-4 bg-red-50 border border-red-100 rounded-2xl text-sm text-red-600 flex items-center gap-2">
          <FaTimesCircle className="shrink-0" />
          {error}
        </div>
      )}

      {/* ── KPI Cards (Doctors, Nurses, Triage, Pharmacy) ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {["doctor", "nurses", "triage", "pharmacy"].map((role) => (
          <KpiPill
            key={role}
            role={role}
            count={counts[role]?.total || 0}
            activeCount={counts[role]?.active || 0}
          />
        ))}
      </div>

      {/* ── Search & Role Filters ───────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-48 max-w-md">
          <FaSearch className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-300 text-xs" />
          <input
            id="staff-search-input"
            type="text"
            placeholder="Search staff by name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-xs sm:text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-health-blue/20 focus:border-health-blue transition-all bg-white"
          />
        </div>
        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl overflow-x-auto max-w-full">
          {[
            { key: "all", label: "All Staff" },
            { key: "doctor", label: "👨‍⚕️ Doctors" },
            { key: "nurses", label: "🩺 Nurses" },
            { key: "triage", label: "🖥️ Triage" },
            { key: "pharmacy", label: "💊 Pharmacy" },
          ].map(({ key, label }) => (
            <button
              key={key}
              id={`staff-filter-${key}`}
              onClick={() => setRoleFilter(key)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all duration-150 cursor-pointer whitespace-nowrap ${
                roleFilter === key
                  ? "bg-white text-health-blue shadow-sm"
                  : "text-slate-500 hover:text-slate-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Staff List ──────────────────────────────── */}
      {filtered.length === 0 ? (
        <div className="admin-card p-12 text-center">
          <FaFilter className="text-slate-200 text-4xl mx-auto mb-3" />
          <p className="text-sm font-bold text-slate-500">No staff members found</p>
          <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
            {search || roleFilter !== "all"
              ? "No staff matches the active search filter. Try clearing the search or filter."
              : "No staff has joined this hospital area yet. Share your area code with doctors, nurses, triage, and pharmacy users."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs text-slate-400 font-medium px-1">
            <span>
              Showing <strong className="text-slate-700">{filtered.length}</strong> of {staff.length} staff
            </span>
            <span>💡 Click <strong>Edit Role</strong> to assign roles and doctor rooms</span>
          </div>

          {filtered.map((member) => (
            <StaffCard
              key={member._id}
              member={member}
              rooms={rooms}
              onEditClick={(m) => setEditingMember(m)}
            />
          ))}
        </div>
      )}

      {/* ── Role & Room Edit Modal ─────────────────── */}
      {editingMember && (
        <EditStaffModal
          member={editingMember}
          rooms={rooms}
          onClose={() => setEditingMember(null)}
          onSave={handleMemberUpdated}
        />
      )}
    </div>
  );
};

export default StaffList;
