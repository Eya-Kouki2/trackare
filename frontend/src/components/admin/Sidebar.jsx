import { useState, useEffect } from "react";
import { NavLink } from "react-router-dom";
import { FaCopy, FaCheck, FaSignOutAlt } from "react-icons/fa";
import api from "../../api/axios";
import brandLogo from "../../assets/logo11.png";

const ALL_NAV_ITEMS = [
  { key: "dashboard", label: "Dashboard", icon: "📊", end: true, adminOnly: false },
  { key: "patients", label: "Patients", icon: "👥", adminOnly: false },
  { key: "detect-sickness", label: "Detect sickness", icon: "🧬", adminOnly: false },
  { key: "pharmacy", label: "Pharmacy Monitor", icon: "💊", adminOnly: false },
  { key: "dispensing", label: "Dispensing Queue", icon: "🧾", adminOnly: false },
  { key: "disease-classes", label: "Disease Rooms", icon: "🏥", adminOnly: true },
  { key: "alerts", label: "Alerts", icon: "🚨", adminOnly: false },
  { key: "staff", label: "Hospital Staff", icon: "🩺", adminOnly: true },
  { key: "reports", label: "Reports", icon: "📜", adminOnly: true },
  { key: "profile", label: "Profile", icon: "👤", adminOnly: false },
];

const Sidebar = ({ user, onLogout, role = "admin" }) => {
  const [copied, setCopied] = useState(false);
  const [alertCount, setAlertCount] = useState(0);
  const areaCode = user?.area?.code;
  const base = (role === "admin" && user?.role === "admin") ? "/admin" : "/nurse";

  useEffect(() => {
    if (!areaCode) return;
    const fetchAlerts = async () => {
      try {
        const areaId = user?.area?._id || user?.area;
        const [classesRes, sessionsRes] = await Promise.all([
          api.get("/api/disease-classes"),
          api.get(`/api/triage-sessions/active?areaId=${areaId}`).catch(() => ({ data: { sessions: [] } }))
        ]);
        const classes = classesRes.data.diseaseClasses || [];
        const sessions = sessionsRes.data?.sessions || [];
        const waitingTokens = sessions.filter((s) => s.status === "waiting_room");

        // Group rooms by sickness: only alert when ALL rooms for a sickness are at capacity
        const sicknessMap = {};
        classes.forEach((room) => {
          if (!room.maladie) return;
          const key = room.maladie.toLowerCase();
          if (!sicknessMap[key]) sicknessMap[key] = [];
          sicknessMap[key].push(room);
        });

        let overflowCount = 0;
        Object.keys(sicknessMap).forEach((maladieKey) => {
          const rooms = sicknessMap[maladieKey];
          if (!rooms || rooms.length === 0) return;
          const allFull = rooms.every((r) => {
            const active = r.currentPatients || 0;
            return active > 0 && active >= (r.maxPatients || 1);
          });
          if (allFull) overflowCount++;
        });

        // Filter out any stale noRoomAlerts that now have an active room
        const storedNoRoom = JSON.parse(localStorage.getItem("noRoomAlerts") || "[]");
        const activeNoRoom = storedNoRoom.filter((alert) => {
          return !classes.some((c) => (c.maladie || "").toLowerCase() === (alert.maladie || "").toLowerCase());
        });
        if (activeNoRoom.length !== storedNoRoom.length) {
          localStorage.setItem("noRoomAlerts", JSON.stringify(activeNoRoom));
        }

        const total = overflowCount + waitingTokens.length + activeNoRoom.length;
        setAlertCount(total);
      } catch {
        // ignore errors silently
      }
    };
    fetchAlerts();
    const interval = setInterval(fetchAlerts, 10000);
    window.addEventListener("alerts-updated", fetchAlerts);
    return () => {
      clearInterval(interval);
      window.removeEventListener("alerts-updated", fetchAlerts);
    };
  }, [areaCode]);

  const copyCode = () => {
    if (!areaCode) return;
    navigator.clipboard.writeText(areaCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const navItems = ALL_NAV_ITEMS
    .filter((item) => role === "admin" || !item.adminOnly)
    .map((item) => ({
      ...item,
      to: item.key === "dashboard" ? base : `${base}/${item.key}`,
    }));

  return (
    <aside
      className="fixed left-0 top-0 z-30 w-56 h-screen flex flex-col shadow-sidebar"
      style={{ background: "linear-gradient(180deg, #03045e 0%, #023e8a 60%, #0353a4 100%)" }}
    >
      {/* ── Brand ─────────────────────────────── */}
      <div className="px-4 pt-5 pb-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-white flex items-center justify-center shrink-0 shadow-md overflow-hidden p-1">
            <img src={brandLogo} alt="Trackare Logo" className="w-full h-full object-contain" />
          </div>
          <div>
            <p className="text-sm font-bold text-white leading-tight">Trackare</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse-dot shrink-0" />
              <p className="text-[10px] text-blue-200/80 font-medium">
                {user?.role === "admin"
                  ? "Admin Platform"
                  : user?.role === "doctor" || user?.role === "doctors"
                    ? "Doctor Portal"
                    : user?.role === "triage"
                      ? "Triage Portal"
                      : user?.role === "pharmacy"
                        ? "Pharmacy Portal"
                        : "Nurse Portal"}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Role badge ──────────────────────────── */}
      {user?.role !== "admin" && (
        <div className="mx-3 mt-3 px-3 py-2 rounded-xl bg-white/10 border border-white/15">
          <p className="text-[9px] font-bold uppercase tracking-widest text-blue-200/70">Role</p>
          <p className="text-xs font-bold text-health-cyan mt-0.5 capitalize">
            {user?.role === "nurses" ? "Nurse" : user?.role || "Staff"}
          </p>
        </div>
      )}

      {/* ── Area code badge ────────────────────── */}
      {user?.role === "admin" && areaCode && (
        <div className="mx-3 mt-3 px-3 py-2.5 rounded-xl bg-white/10 border border-white/15">
          <p className="text-[9px] font-bold uppercase tracking-widest text-blue-200/70 mb-1">Area Code</p>
          <div className="flex items-center justify-between gap-2">
            <code className="text-xs font-mono font-bold text-health-cyan truncate">{areaCode}</code>
            <button
              type="button"
              onClick={copyCode}
              className="shrink-0 flex items-center gap-1 text-[10px] text-blue-200/80 hover:text-white transition-colors cursor-pointer font-semibold"
            >
              {copied ? <FaCheck className="text-emerald-400" /> : <FaCopy />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}

      {/* ── Nav group label ────────────────────── */}
      <p className="px-4 pt-4 pb-1.5 text-[9px] font-bold uppercase tracking-[0.14em] text-blue-300/50">Navigation</p>

      {/* ── Nav items ─────────────────────────── */}
      <nav className="flex-1 px-2 overflow-y-auto space-y-0.5">
        {navItems.map(({ key, to, label, icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-150 ${isActive
                ? "bg-white/18 text-white shadow-sm border border-white/20"
                : "text-blue-100/75 hover:bg-white/10 hover:text-white"
              }`
            }
          >
            <span className="text-[15px] shrink-0 leading-none w-5 text-center" aria-hidden="true">
              {icon}
            </span>
            <span className="truncate flex-1">{label}</span>
            {key === "alerts" && alertCount > 0 && (
              <span className="flex items-center justify-center w-5 h-5 rounded-full bg-red-500 text-[10px] font-bold text-white shadow-sm">
                {alertCount}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* ── Logout ────────────────────────────── */}
      <div className="px-2 py-3 border-t border-white/10">
        <button
          type="button"
          onClick={onLogout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium text-blue-100/70 hover:bg-red-500/20 hover:text-red-300 cursor-pointer transition-all duration-150"
        >
          <FaSignOutAlt className="text-[13px] shrink-0" />
          <span>Logout</span>
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;

