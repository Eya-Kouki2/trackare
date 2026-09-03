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
  { key: "disease-classes", label: "Disease Rooms", icon: "🏥", adminOnly: true },
  { key: "alerts", label: "Alerts", icon: "🚨", adminOnly: true },
  { key: "reports", label: "Reports", icon: "📜", adminOnly: true },
  { key: "profile", label: "Profile", icon: "👤", adminOnly: false },
];

const Sidebar = ({ user, onLogout, role = "admin" }) => {
  const [copied, setCopied] = useState(false);
  const [alertCount, setAlertCount] = useState(0);
  const areaCode = user?.area?.code;
  const base = role === "nurses" ? "/nurse" : "/admin";

  useEffect(() => {
    if (!areaCode) return;
    const fetchAlerts = async () => {
      try {
        const [patientsRes, classesRes] = await Promise.all([
          api.get("/api/patients/stats"),
          api.get("/api/disease-classes")
        ]);
        const patients = patientsRes.data.patients || [];
        const classes = classesRes.data.diseaseClasses || [];
        
        let count = 0;
        classes.forEach(room => {
          const official = patients.filter((p) => {
            if (!p.history || p.history.length === 0) return false;
            const sortedHistory = [...p.history].sort((a, b) => new Date(b.date) - new Date(a.date));
            const latestTriage = sortedHistory[0]?.triage;
            return latestTriage?.suggestedClass?.placeCode === Number(room.placeCode);
          }).length;
          const kiosk = room.currentPatients || 0;
          if (official + kiosk >= (room.maxPatients || 1)) count++;
        });
        setAlertCount(count + (JSON.parse(localStorage.getItem("noRoomAlerts") || "[]")).length);
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
                {role === "nurses" ? "Nurse Portal" : "Clinical Platform"}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Role badge ──────────────────────────── */}
      {role === "nurses" && (
        <div className="mx-3 mt-3 px-3 py-2 rounded-xl bg-white/10 border border-white/15">
          <p className="text-[9px] font-bold uppercase tracking-widest text-blue-200/70">Role</p>
          <p className="text-xs font-bold text-health-cyan mt-0.5">Nurse</p>
        </div>
      )}

      {/* ── Area code badge ────────────────────── */}
      {role === "admin" && areaCode && (
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

