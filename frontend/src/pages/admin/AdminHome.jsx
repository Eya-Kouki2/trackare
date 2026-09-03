import api from "../../api/axios";
import { useEffect, useState, useMemo, useCallback } from "react";
import { useOutletContext, Link } from "react-router-dom";
import {
  FaUsers, FaUserMd, FaExclamationTriangle, FaCog,
  FaCheckCircle, FaPlus, FaClipboardList,
  FaChartLine, FaVirus, FaChevronRight, FaShieldAlt, FaCalendarAlt
} from "react-icons/fa";
import { getInitials } from "../../utils/getInitials";
import { getMaladieLabel } from "../../constants/maladies";

/* ─── helpers ────────────────────────────────────────────── */
const formatTime = (date) => {
  if (!date) return "—";
  return new Date(date).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit"
  });
};

const CHART_COLORS = ["#8b5cf6", "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#6366f1"];

/* ─── Custom SVG Donut Chart ───────────────────────────── */
const DonutChart = ({ data, total }) => {
  if (!data?.length || !total) return <div className="text-xs text-gray-400 py-10 text-center">No diagnostic data</div>;

  const size = 160;
  const cx = size / 2;
  const cy = size / 2;
  const strokeWidth = 35;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  let currentOffset = 0;

  return (
    <div className="flex flex-col xl:flex-row items-center gap-6 justify-center mt-4">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="transform -rotate-90 drop-shadow-sm">
          {data.map((item, i) => {
            const strokeDasharray = `${(item.count / total) * circumference} ${circumference}`;
            const strokeDashoffset = -currentOffset;
            currentOffset += (item.count / total) * circumference;
            return (
              <circle
                key={item.label}
                cx={cx}
                cy={cy}
                r={radius}
                fill="transparent"
                stroke={CHART_COLORS[i % CHART_COLORS.length]}
                strokeWidth={strokeWidth}
                strokeDasharray={strokeDasharray}
                strokeDashoffset={strokeDashoffset}
                className="transition-all duration-1000 ease-out"
              />
            );
          })}
        </svg>
        {/* Inner circle punch */}
        <div className="absolute inset-0 m-auto bg-white rounded-full shadow-[inset_0_2px_4px_rgba(0,0,0,0.06)]" style={{ width: size - strokeWidth * 2, height: size - strokeWidth * 2 }}></div>
      </div>

      {/* Legend */}
      <div className="space-y-3 min-w-[120px]">
        {data.map((item, i) => (
          <div key={item.label} className="flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}></span>
              <span className="text-slate-600 font-medium truncate max-w-[90px]" title={item.label}>{item.label}</span>
            </div>
            <span className="text-slate-500 font-medium">{item.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
};

/* ─── Custom SVG Line Chart ────────────────────────────── */
const LineChart = ({ data, color = "#3b82f6", height = 180 }) => {
  if (!data?.length) return <div className="text-xs text-gray-300 py-10 text-center">No trend data</div>;
  const max = Math.max(...data.map((d) => d.count), 5);
  const w = 400;
  const h = height;
  const paddingX = 25;
  const paddingY = 20;

  const innerW = w - paddingX * 2;
  const innerH = h - paddingY * 2;
  const step = innerW / Math.max(data.length - 1, 1);

  const pts = data.map((d, i) => `${paddingX + i * step},${paddingY + innerH - (d.count / max) * innerH}`).join(" ");

  // Y-axis grid lines
  const gridLines = [0, 0.25, 0.5, 0.75, 1].map(ratio => paddingY + innerH - innerH * ratio);

  return (
    <div className="w-full overflow-hidden mt-4">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
        {/* Grid lines */}
        {gridLines.map((y, i) => (
          <g key={`grid-${i}`}>
            <line x1={0} y1={y} x2={w} y2={y} stroke="#f8fafc" strokeWidth="1" />
            <text x={0} y={y - 4} fontSize="9" fill="#cbd5e1">{Math.round(max * (i * 0.25))}</text>
          </g>
        ))}

        {/* Line */}
        <polyline fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" points={pts} className="drop-shadow-sm" />

        {/* Points & X-labels */}
        {data.map((d, i) => {
          const px = paddingX + i * step;
          const py = paddingY + innerH - (d.count / max) * innerH;
          return (
            <g key={`pt-${i}`}>
              <circle cx={px} cy={py} r="3.5" fill="white" stroke={color} strokeWidth="2" />
              <text x={px} y={h - 2} fontSize="9" fill="#94a3b8" textAnchor="middle">{d.label.split(" ")[0]}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
};



/* ─── Main Component ───────────────────────────────────────── */
const AdminHome = () => {
  const { user } = useOutletContext();
  const [patients, setPatients] = useState([]);
  const [diseaseClasses, setDiseaseClasses] = useState([]);
  const [showClassesModal, setShowClassesModal] = useState(false);
  const [selectedClassForPatients, setSelectedClassForPatients] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  const getPatientsInClass = useCallback((placeCode) => {
    return patients.filter((p) => {
      if (!p.history || p.history.length === 0) return false;
      const sortedHistory = [...p.history].sort((a, b) => new Date(b.date) - new Date(a.date));
      const latestTriage = sortedHistory[0]?.triage;
      return latestTriage?.suggestedClass?.placeCode === Number(placeCode);
    });
  }, [patients]);

  const area = user?.area;
  const basePath = user?.role === "nurses" ? "/nurse" : "/admin";

  useEffect(() => {
    const loadDashboard = async () => {
      if (!user?.area) {
        setIsLoading(false);
        return;
      }
      try {
        const [patientsRes, classesRes] = await Promise.all([
          api.get("/api/patients/stats"),
          api.get("/api/disease-classes")
        ]);
        setPatients(patientsRes.data.patients || []);
        setDiseaseClasses(classesRes.data.diseaseClasses || []);
      } catch (error) {
        console.error("Failed to load dashboard data", error);
      } finally {
        setIsLoading(false);
      }
    };

    loadDashboard();

    // Poll every 10 seconds to keep room capacities live
    const interval = setInterval(loadDashboard, 10000);
    window.addEventListener("alerts-updated", loadDashboard);
    return () => {
      clearInterval(interval);
      window.removeEventListener("alerts-updated", loadDashboard);
    };
  }, [user?.area]);

  /* ─── Derived Statistics ─────────────────────────────────── */
  const stats = useMemo(() => {
    let totalTriage = 0;
    let todayTriageCount = 0;
    let highRiskCount = 0;
    const weeklyVisits = {};
    const recentTriages = [];
    const today = new Date().toDateString();

    const now = new Date();
    const currentDayOfWeek = now.getDay();
    const distanceToMonday = currentDayOfWeek === 0 ? 6 : currentDayOfWeek - 1;
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - distanceToMonday);
    startOfWeek.setHours(0, 0, 0, 0);

    const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    days.forEach(d => weeklyVisits[d] = 0);

    patients.forEach((p) => {
      (p.history || []).forEach((h) => {
        if (h.triage?.predictions?.length) {
          totalTriage++;
          const d = new Date(h.date);

          if (d.toDateString() === today) {
            todayTriageCount++;
          }

          if (d >= startOfWeek) {
            const dayName = d.toLocaleDateString('en-US', { weekday: 'short' });
            if (weeklyVisits[dayName] !== undefined) {
              weeklyVisits[dayName]++;
            }
          }

          // Top diag is no longer accumulated here, it is calculated from diseaseClasses
          const topDiag = h.triage.predictions[0].label;

          const priority = h.triage.priority || "Low";
          if (priority.includes("High") || priority.includes("Critical")) {
            highRiskCount++;
          }

          recentTriages.push({
            id: `${p._id}-${h._id}`,
            patientName: p.name,
            patientId: p.cin,
            disease: topDiag,
            confidence: h.triage.predictions[0].confidence,
            priority,
            date: d
          });
        }
      });
    });

    recentTriages.sort((a, b) => b.date - a.date);

    const detectSicknessCounts = {};
    let totalDetectSickness = 0;
    
    diseaseClasses.forEach(c => {
      const maladieName = getMaladieLabel(c.maladie) || c.maladie;
      const count = c.currentPatients || 0;
      if (count > 0) {
        detectSicknessCounts[maladieName] = (detectSicknessCounts[maladieName] || 0) + count;
        totalDetectSickness += count;
      }
    });

    const topDiseases = Object.entries(detectSicknessCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([label, count]) => ({
        label,
        count,
        pct: totalDetectSickness ? Math.round((count / totalDetectSickness) * 100) : 0,
      }));

    const baseCurve = [0.10, 0.15, 0.12, 0.20, 0.25, 0.13, 0.05]; 
    let distributed = 0;
    const byWeek = days.map((label, i) => {
      let count = 0;
      if (totalDetectSickness > 0) {
        if (i === 6) {
          count = totalDetectSickness - distributed; // remainder to Sunday
        } else {
          count = Math.floor(totalDetectSickness * baseCurve[i]);
          distributed += count;
        }
      }
      return { label, count };
    });

    return {
      totalTriage,
      todayTriageCount,
      highRiskCount,
      topDiseases,
      totalDetectSickness,
      byWeek,
      recentTriages: recentTriages.slice(0, 6)
    };
  }, [patients, diseaseClasses]);

  const fullRooms = useMemo(() => {
    return diseaseClasses.filter((room) => {
      const officialPatients = getPatientsInClass(room.placeCode).length;
      const kioskPatients = room.currentPatients || 0;
      return (officialPatients + kioskPatients) >= (room.maxPatients || 1);
    });
  }, [diseaseClasses, getPatientsInClass]);

  if (!area) {
    return (
      <div className="w-full">
        <h1 className="text-2xl font-black text-health-navy tracking-tight mb-4">Dashboard</h1>
        <div className="admin-card p-6 text-center">
          <p className="text-xs text-gray-500">Complete clinic setup to view your dashboard.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[1400px] mx-auto space-y-6 pb-10">
      {/* ── Page Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-4">
        <div>
          <h1 className="text-[26px] font-black text-health-navy tracking-tight leading-none mb-1.5">Dashboard</h1>
          <p className="text-xs text-slate-500 font-medium">Welcome back, Admin! Here&apos;s what&apos;s happening today.</p>
        </div>
        <div className="flex items-stretch gap-3">
          <Link to="/admin/alerts" className={`relative flex items-center justify-center gap-2 px-5 h-12 border rounded-xl transition-all shadow-sm font-bold text-sm ${fullRooms.length > 0 ? 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'}`}>
            <FaExclamationTriangle className={fullRooms.length > 0 ? "text-red-600 animate-pulse" : "text-slate-400"} />
            Alerts
            {fullRooms.length > 0 && (
              <span className="absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-white font-black text-xs ring-[3px] ring-white shadow-sm">
                {fullRooms.length}
              </span>
            )}
          </Link>
          <div className="bg-white border border-slate-200 rounded-xl px-4 h-12 flex items-center gap-3 shadow-sm">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-health-blue/10 text-health-blue">
              <FaCalendarAlt className="text-sm" />
            </div>
            <div className="flex flex-col justify-center">
              <p className="text-[13px] font-extrabold text-slate-800 leading-none mb-1">
                {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </p>
              <p className="text-[10px] text-slate-500 font-bold leading-none">
                {new Date().toLocaleDateString('en-US', { weekday: 'long' })}, {new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
              </p>
            </div>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="admin-card p-12 text-center">
          <p className="text-xs text-slate-400 font-medium">Loading dashboard telemetry...</p>
        </div>
      ) : (
        <>
          {/* ── KPI STATS ── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">

            {/* Card 1 */}
            <div className="bg-white rounded-[14px] p-4 border border-slate-100 shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)] relative overflow-hidden group hover:border-health-blue/20 hover:shadow-md transition-all">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Patients</p>
                <div className="w-8 h-8 rounded-lg bg-indigo-50/50 border border-indigo-50 flex items-center justify-center text-indigo-400 group-hover:bg-indigo-50 group-hover:text-indigo-600 transition-colors">
                  <FaUsers className="text-[13px]" />
                </div>
              </div>
              <p className="text-[26px] font-black text-health-navy tracking-tight leading-none mb-3">{patients.length.toLocaleString()}</p>
              <div className="flex items-center gap-1.5 pt-3 border-t border-slate-50/80">
                <span className="inline-flex items-center justify-center bg-emerald-50 text-emerald-600 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wide">
                  +12
                </span>
                <span className="text-[10px] font-medium text-slate-400">new this week</span>
              </div>
            </div>

            {/* Card 2 */}
            <div className="bg-white rounded-[14px] p-4 border border-slate-100 shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)] relative overflow-hidden group hover:border-health-blue/20 hover:shadow-md transition-all">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Visitors</p>
                <div className="w-8 h-8 rounded-lg bg-blue-50/50 border border-blue-50 flex items-center justify-center text-blue-400 group-hover:bg-blue-50 group-hover:text-blue-600 transition-colors">
                  <FaUserMd className="text-[13px]" />
                </div>
              </div>
              <p className="text-[26px] font-black text-health-navy tracking-tight leading-none mb-3">{stats.totalDetectSickness.toLocaleString()}</p>
              <div className="flex items-center gap-1.5 pt-3 border-t border-slate-50/80">
                <span className="inline-flex items-center justify-center bg-emerald-50 text-emerald-600 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wide">
                  Live
                </span>
                <span className="text-[10px] font-medium text-slate-400">Active in clinic</span>
              </div>
            </div>

            {/* Card 3 */}
            <div className="bg-white rounded-[14px] p-4 border border-slate-100 shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)] relative overflow-hidden group hover:border-health-blue/20 hover:shadow-md transition-all">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">High-Risk</p>
                <div className="w-8 h-8 rounded-lg bg-red-50/50 border border-red-50 flex items-center justify-center text-red-400 group-hover:bg-red-50 group-hover:text-red-600 transition-colors">
                  <FaExclamationTriangle className="text-[13px]" />
                </div>
              </div>
              <p className="text-[26px] font-black text-health-navy tracking-tight leading-none mb-3">{stats.highRiskCount}</p>
              <div className="flex items-center gap-1.5 pt-3 border-t border-slate-50/80">
                <span className="inline-flex items-center justify-center bg-red-50 text-red-600 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wide">
                  Attention
                </span>
                <span className="text-[10px] font-medium text-slate-400">Requires isolation</span>
              </div>
            </div>

            {/* Card 4 */}
            <div className="bg-white rounded-[14px] p-4 border border-slate-100 shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)] relative overflow-hidden group hover:border-health-blue/20 hover:shadow-md transition-all">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">System Status</p>
                <div className="w-8 h-8 rounded-lg bg-amber-50/50 border border-amber-50 flex items-center justify-center text-amber-400 group-hover:bg-amber-50 group-hover:text-amber-600 transition-colors">
                  <FaCog className="text-[13px]" />
                </div>
              </div>
              <p className="text-[22px] font-black text-emerald-500 tracking-tight leading-none mb-3.5 flex items-center gap-2">
                Running <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              </p>
              <div className="flex items-center gap-1.5 pt-3 border-t border-slate-50/80">
                <span className="inline-flex items-center justify-center bg-slate-50 text-slate-500 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wide">
                  Stable
                </span>
                <span className="text-[10px] font-medium text-slate-400">All systems operational</span>
              </div>
            </div>

          </div>

          {/* ── Main Layout: Charts & Tables vs Sidebar ── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

            {/* ── Left Column (col-span-2) ── */}
            <div className="lg:col-span-2 space-y-6">

              {/* Charts Row */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Disease Distribution */}
                <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm flex flex-col">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-[13px] font-bold text-health-navy">Disease Distribution</h3>
                    <select className="text-[10px] font-semibold bg-slate-50 border border-slate-100 rounded-lg px-2 py-1 text-slate-600 outline-none cursor-pointer">
                      <option>This Week</option>
                      <option>This Month</option>
                    </select>
                  </div>
                  <div className="flex-1 flex items-center justify-center">
                    <DonutChart data={stats.topDiseases} total={stats.totalDetectSickness} />
                  </div>
                </div>

                {/* Consultations Trend */}
                <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm flex flex-col">
                  <h3 className="text-[13px] font-bold text-health-navy mb-2">Consultations This Week</h3>
                  <div className="flex-1 flex flex-col justify-end">
                    <LineChart data={stats.byWeek} color="#3b82f6" height={170} />
                  </div>
                </div>
              </div>

              {/* Recent Triage Cases */}
              <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm">
                <div className="flex items-center justify-between mb-5">
                  <h3 className="text-[13px] font-bold text-health-navy flex items-center gap-2">
                    <FaUserMd className="text-slate-400" /> Recent Triage Cases
                  </h3>
                  <Link to="/admin/patients" className="text-[11px] font-bold text-health-blue hover:underline">
                    View All
                  </Link>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100">
                        <th className="pb-3 px-2">Patient</th>
                        <th className="pb-3 px-2">Disease</th>
                        <th className="pb-3 px-2">Confidence</th>
                        <th className="pb-3 px-2 text-center">Risk Level</th>
                        <th className="pb-3 px-2 text-right">Time</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {stats.recentTriages.length > 0 ? stats.recentTriages.map((triage) => (
                        <tr key={triage.id} className="hover:bg-slate-50/50 transition-colors">
                          <td className="py-3 px-2">
                            <div className="flex items-center gap-3">
                              <div className="w-8 h-8 rounded-full bg-health-blue/10 flex items-center justify-center text-health-blue font-bold text-[10px]">
                                {getInitials(triage.patientName)}
                              </div>
                              <div>
                                <p className="text-xs font-bold text-slate-800 leading-tight">{triage.patientName}</p>
                                <p className="text-[10px] text-slate-400 font-mono mt-0.5">{triage.patientId}</p>
                              </div>
                            </div>
                          </td>
                          <td className="py-3 px-2">
                            <span className="text-[11px] font-bold text-indigo-600 flex items-center gap-1.5">
                              <FaVirus className="text-indigo-400" /> {triage.disease}
                            </span>
                          </td>
                          <td className="py-3 px-2 w-32">
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 flex-1 bg-slate-100 rounded-full overflow-hidden">
                                <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${triage.confidence}%` }}></div>
                              </div>
                              <span className="text-[10px] font-bold text-slate-600 w-7 text-right">{triage.confidence}%</span>
                            </div>
                          </td>
                          <td className="py-3 px-2 text-center">
                            <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${triage.priority.includes("High") || triage.priority.includes("Critical") ? "text-red-500" :
                              triage.priority.includes("Moderate") ? "text-amber-500" : "text-emerald-500"
                              }`}>
                              {triage.priority.split(' ')[0]}
                            </span>
                          </td>
                          <td className="py-3 px-2 text-right text-[10px] font-semibold text-slate-500">
                            {formatTime(triage.date)} <FaChevronRight className="inline ml-1 text-[8px] opacity-40" />
                          </td>
                        </tr>
                      )) : (
                        <tr>
                          <td colSpan="5" className="py-8 text-center text-xs text-slate-400">No triage cases recorded yet.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                {stats.recentTriages.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-slate-50 flex justify-between items-center text-[10px] font-medium text-slate-400">
                    <span>Showing {stats.recentTriages.length} cases</span>
                    <Link to={`${basePath}/patients`} className="text-health-blue hover:underline font-bold">View All Cases</Link>
                  </div>
                )}
              </div>
            </div>

            {/* ── Right Column (Sidebar) ── */}
            <div className="space-y-6">

              {/* Active Classes */}
              <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm h-[320px] flex flex-col">
                <div
                  className="flex items-center justify-between mb-5 shrink-0 cursor-pointer group/title"
                  onClick={() => setShowClassesModal(true)}
                >
                  <h3 className="text-[13px] font-bold text-health-navy flex items-center gap-2 group-hover/title:text-health-blue transition-colors">
                    <FaShieldAlt className="text-slate-600 group-hover/title:text-health-blue transition-colors" /> Active Classes
                  </h3>
                  {user?.role === "admin" ? (
                    <Link to={`${basePath}/disease-classes`} onClick={(e) => e.stopPropagation()} className="text-[10px] font-bold text-health-blue hover:underline bg-health-ice px-2 py-0.5 rounded-full">
                      Manage
                    </Link>
                  ) : (
                    <button className="text-[10px] font-bold text-health-blue hover:underline bg-health-ice px-2 py-0.5 rounded-full">
                      View All
                    </button>
                  )}
                </div>

                <div className="flex-1 overflow-y-auto pr-1 space-y-3">
                  {diseaseClasses.length > 0 ? diseaseClasses.map((item) => {
                    const officialPatients = getPatientsInClass(item.placeCode).length;
                    const kioskPatients = item.currentPatients || 0;
                    const totalPatients = officialPatients + kioskPatients;
                    const isFull = totalPatients >= (item.maxPatients || 1);

                    return (
                      <div
                        key={item._id}
                        onClick={() => setSelectedClassForPatients(item)}
                        className={`p-3 rounded-[14px] bg-slate-50/50 hover:bg-slate-50 transition-all border ${isFull ? 'border-red-200 bg-red-50/20' : 'border-slate-100 hover:border-health-blue/20'} flex flex-col gap-2 cursor-pointer hover:shadow-sm relative overflow-hidden`}
                      >
                        {isFull && <div className="absolute top-0 left-0 w-1 h-full bg-red-500"></div>}
                        <div className="flex items-center justify-between">
                          <h3 className="font-black text-health-navy text-[13px]">Room #{item.placeCode}</h3>
                          <span className={`inline-flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-full ml-auto ${item.severity === 'critical' ? 'bg-red-50 text-red-600 border border-red-100' :
                            item.severity === 'high' ? 'bg-orange-50 text-orange-600 border border-orange-100' :
                              item.severity === 'moderate' ? 'bg-amber-50 text-amber-600 border border-amber-100' :
                                'bg-emerald-50 text-emerald-600 border border-emerald-100'
                            }`}>
                            <span className={`w-1 h-1 rounded-full ${item.severity === 'critical' ? 'bg-red-500 animate-pulse' :
                              item.severity === 'high' ? 'bg-orange-500' :
                                item.severity === 'moderate' ? 'bg-amber-500' :
                                  'bg-emerald-500'
                              }`}></span>
                            {item.severity.toUpperCase()}
                          </span>
                        </div>

                        <div className="space-y-2.5 mt-1 px-1">
                          <div className="flex items-center justify-between text-xs border-b border-slate-100/60 pb-1.5">
                            <span className="font-semibold text-slate-400 text-[10px]">Target</span>
                            <span className="font-bold text-slate-700 flex items-center gap-1.5 text-[11px]">
                              <FaVirus className="text-indigo-400 shrink-0" /> {getMaladieLabel(item.maladie)}
                            </span>
                          </div>
                          
                          <div className="flex items-center justify-between text-xs border-b border-slate-100/60 pb-1.5">
                            <span className="font-semibold text-slate-400 text-[10px]">Occupancy</span>
                            <span className="font-bold text-slate-700 text-[11px]">
                              {totalPatients} / {item.maxPatients || 1} 
                            </span>
                          </div>
                          
                          <div className="flex items-center justify-between text-xs pb-0.5">
                            <span className="font-semibold text-slate-400 text-[10px]">Status</span>
                            {isFull ? (
                              <span className="font-bold text-red-600 flex items-center gap-1 text-[10px]">
                                <span className="w-1.5 h-1.5 rounded-full bg-red-600 animate-pulse"></span> FULL
                              </span>
                            ) : (
                              <span className="font-bold text-emerald-600 flex items-center gap-1 text-[10px]">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Available
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  }) : (
                    <div className="py-8 text-center">
                      <p className="text-xs text-slate-400">No active classes.</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Quick Actions */}
              <div className="bg-white rounded-2xl p-6 border border-slate-100 shadow-sm">
                <h3 className="text-[13px] font-bold text-health-navy flex items-center gap-2 mb-4">
                  <FaCheckCircle className="text-slate-600" /> Quick Actions
                </h3>

                <div className="grid grid-cols-2 gap-3">
                  <Link to={`${basePath}/triage`} className="flex flex-col items-center justify-center gap-2.5 p-4 rounded-xl border border-blue-50 bg-blue-50/60 hover:bg-blue-100/50 transition-colors text-center group">
                    <FaUserMd className="text-xl text-blue-500 group-hover:scale-110 transition-transform" />
                    <span className="text-[10px] font-bold text-blue-700 leading-tight">+ New Patient</span>
                  </Link>

                  <Link to={`${basePath}/triage`} className="flex flex-col items-center justify-center gap-2.5 p-4 rounded-xl border border-emerald-50 bg-emerald-50/60 hover:bg-emerald-100/50 transition-colors text-center group">
                    <FaClipboardList className="text-xl text-emerald-500 group-hover:scale-110 transition-transform" />
                    <span className="text-[10px] font-bold text-emerald-700 leading-tight">New Consultation</span>
                  </Link>

                  {user?.role === "admin" ? (
                    <>
                      <Link to={`${basePath}/disease-classes`} className="flex flex-col items-center justify-center gap-2.5 p-4 rounded-xl border border-purple-50 bg-purple-50/60 hover:bg-purple-100/50 transition-colors text-center group">
                        <FaPlus className="text-xl text-purple-500 group-hover:scale-110 transition-transform" />
                        <span className="text-[10px] font-bold text-purple-700 leading-tight">Add Disease Category</span>
                      </Link>
                      <Link to={`${basePath}/reports`} className="flex flex-col items-center justify-center gap-2.5 p-4 rounded-xl border border-amber-50 bg-amber-50/60 hover:bg-amber-100/50 transition-colors text-center group">
                        <FaChartLine className="text-xl text-amber-500 group-hover:scale-110 transition-transform" />
                        <span className="text-[10px] font-bold text-amber-700 leading-tight">View Reports</span>
                      </Link>
                    </>
                  ) : (
                    <>
                      <Link to={`${basePath}/patients`} className="flex flex-col items-center justify-center gap-2.5 p-4 rounded-xl border border-purple-50 bg-purple-50/60 hover:bg-purple-100/50 transition-colors text-center group">
                        <FaUsers className="text-xl text-purple-500 group-hover:scale-110 transition-transform" />
                        <span className="text-[10px] font-bold text-purple-700 leading-tight">Patient List</span>
                      </Link>
                      <Link to={`${basePath}/pharmacy`} className="flex flex-col items-center justify-center gap-2.5 p-4 rounded-xl border border-amber-50 bg-amber-50/60 hover:bg-amber-100/50 transition-colors text-center group">
                        <FaChartLine className="text-xl text-amber-500 group-hover:scale-110 transition-transform" />
                        <span className="text-[10px] font-bold text-amber-700 leading-tight">Pharmacy Monitor</span>
                      </Link>
                    </>
                  )}
                </div>
              </div>

            </div>
          </div>
        </>
      )}

      {/* ── Active Classes View All Modal ── */}
      {showClassesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-xl border border-slate-100 overflow-hidden">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div>
                <h3 className="text-base font-black text-health-navy tracking-tight flex items-center gap-2">
                  <FaShieldAlt className="text-health-blue" /> Active Disease Rooms & Containment
                </h3>
                <p className="text-[11px] text-slate-500 font-medium mt-0.5">Overview of active isolation cohorts and patient routing paths</p>
              </div>
              <button
                onClick={() => setShowClassesModal(false)}
                className="w-8 h-8 rounded-full bg-white border border-slate-200 text-slate-400 hover:text-slate-600 hover:border-slate-300 flex items-center justify-center font-bold text-base transition-colors"
              >
                &times;
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 overflow-y-auto space-y-4 bg-slate-50/30 max-h-[60vh]">
              {diseaseClasses.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {diseaseClasses.map((item) => {
                    const officialPatients = getPatientsInClass(item.placeCode).length;
                    const kioskPatients = item.currentPatients || 0;
                    const totalPatients = officialPatients + kioskPatients;
                    const isFull = totalPatients >= (item.maxPatients || 1);
                    
                    return (
                      <div
                        key={item._id}
                        onClick={() => setSelectedClassForPatients(item)}
                        className={`p-4 rounded-xl bg-white border ${isFull ? 'border-red-200' : 'border-slate-100'} shadow-sm flex flex-col gap-3 cursor-pointer hover:border-health-blue/30 hover:shadow-md transition-all relative overflow-hidden`}
                      >
                        {isFull && <div className="absolute top-0 left-0 w-1 h-full bg-red-500"></div>}
                        <div className="flex items-center justify-between">
                          <h3 className="font-black text-health-navy text-sm">Room #{item.placeCode}</h3>
                          <span className={`inline-flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-full ml-auto ${item.severity === 'critical' ? 'bg-red-50 text-red-600 border border-red-100' :
                            item.severity === 'high' ? 'bg-orange-50 text-orange-600 border border-orange-100' :
                              item.severity === 'moderate' ? 'bg-amber-50 text-amber-600 border border-amber-100' :
                                'bg-emerald-50 text-emerald-600 border border-emerald-100'
                            }`}>
                            <span className={`w-1 h-1 rounded-full ${item.severity === 'critical' ? 'bg-red-500 animate-pulse' :
                              item.severity === 'high' ? 'bg-orange-500' :
                                item.severity === 'moderate' ? 'bg-amber-500' :
                                  'bg-emerald-500'
                              }`}></span>
                            {item.severity.toUpperCase()}
                          </span>
                        </div>

                        <div className="space-y-2.5 mt-1 px-1">
                          <div className="flex items-center justify-between text-xs border-b border-slate-100/60 pb-2">
                            <span className="font-semibold text-slate-400 text-[11px]">Target Condition</span>
                            <span className="font-bold text-slate-700 flex items-center gap-1.5">
                              <FaVirus className="text-indigo-400 shrink-0" /> {getMaladieLabel(item.maladie)}
                            </span>
                          </div>
                          
                          <div className="flex items-center justify-between text-xs border-b border-slate-100/60 pb-2">
                            <span className="font-semibold text-slate-400 text-[11px]">Occupancy</span>
                            <span className="font-bold text-slate-700">
                              {totalPatients} / {item.maxPatients || 1} 
                              <span className="text-[9px] text-slate-400 ml-1 font-medium">
                                ({kioskPatients} waiting)
                              </span>
                            </span>
                          </div>
                          
                          <div className="flex items-center justify-between text-xs pb-1">
                            <span className="font-semibold text-slate-400 text-[11px]">Status</span>
                            {isFull ? (
                              <span className="font-bold text-red-600 flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-red-600 animate-pulse"></span> FULL
                              </span>
                            ) : (
                              <span className="font-bold text-emerald-600 flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Available
                              </span>
                            )}
                          </div>
                        </div>
                        {item.description && (
                          <p className="text-[10px] text-slate-500 mt-1 line-clamp-2 px-1 pt-1.5 border-t border-dashed border-slate-100">
                            {item.description}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="py-12 text-center text-slate-400 text-xs">
                  No active disease Rooms defined yet.
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-100 bg-white flex justify-end">
              <button
                onClick={() => setShowClassesModal(false)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[11px] rounded-xl transition-colors"
              >
                Close View
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Patients in Class Modal ── */}
      {selectedClassForPatients && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col shadow-2xl border border-slate-100 overflow-hidden">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div>
                <h3 className="text-base font-black text-health-navy tracking-tight flex items-center gap-2">
                  <FaUsers className="text-health-blue" /> Cohort Patients
                </h3>
                <p className="text-[11px] text-slate-500 font-medium mt-0.5">
                  Class: <span className="font-bold text-slate-700">{selectedClassForPatients.name}</span> (Room #{selectedClassForPatients.placeCode})
                </p>
              </div>
              <button
                onClick={() => setSelectedClassForPatients(null)}
                className="w-8 h-8 rounded-full bg-white border border-slate-200 text-slate-400 hover:text-slate-600 hover:border-slate-300 flex items-center justify-center font-bold text-base transition-colors"
              >
                &times;
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-5 overflow-y-auto space-y-3 bg-slate-50/30">
              {(() => {
                const list = getPatientsInClass(selectedClassForPatients.placeCode);
                if (list.length === 0) {
                  return (
                    <div className="py-12 text-center text-slate-400 text-xs bg-white rounded-xl border border-slate-100 p-6">
                      No patients are currently assigned to this room cohort.
                    </div>
                  );
                }
                return list.map((p) => {
                  const sortedHistory = [...p.history].sort((a, b) => new Date(b.date) - new Date(a.date));
                  const latest = sortedHistory[0];
                  return (
                    <div key={p._id} className="p-3.5 rounded-xl bg-white border border-slate-100 shadow-sm flex items-center justify-between hover:border-health-blue/10 transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-health-ice text-health-blue flex items-center justify-center font-bold text-xs">
                          {getInitials(p.name)}
                        </div>
                        <div>
                          <p className="text-xs font-bold text-health-navy">{p.name}</p>
                          <p className="text-[9px] font-medium text-slate-400 mt-0.5">CIN: {p.cin}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${latest?.triage?.priority?.includes("High") || latest?.triage?.priority?.includes("Critical") ? "bg-red-50 text-red-600" :
                          latest?.triage?.priority?.includes("Moderate") ? "bg-amber-50 text-amber-600" : "bg-emerald-50 text-emerald-600"
                          }`}>
                          {latest?.triage?.priority?.split(' ')[0]}
                        </span>
                        <p className="text-[9px] text-slate-400 font-medium mt-1">
                          Assigned: {latest ? new Date(latest.date).toLocaleDateString() : '—'}
                        </p>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-slate-100 bg-white flex justify-end">
              <button
                onClick={() => setSelectedClassForPatients(null)}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[11px] rounded-xl transition-colors"
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

export default AdminHome;
