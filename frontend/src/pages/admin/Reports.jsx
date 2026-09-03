import api from "../../api/axios";
import { useEffect, useMemo, useState, useCallback } from "react";
import { useOutletContext } from "react-router-dom";
import {
  FaFileCsv, FaFilePdf, FaFilter, FaSync, FaChartBar,
} from "react-icons/fa";
import PageHeader from "../../components/admin/PageHeader";

/* ─── tiny helpers ───────────────────────────────────────── */
const fmtDate = (d) => {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
};
const fmtDateTime = (d) => {
  if (!d) return "—";
  return new Date(d).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
};
const calcAge = (dob) => {
  if (!dob) return null;
  const diff = Date.now() - new Date(dob).getTime();
  return Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000));
};
const toCSVRow = (cells) =>
  cells.map((c) => {
    const v = c == null ? "" : String(c);
    return v.includes(",") || v.includes('"') || v.includes("\n") ? `"${v.replace(/"/g, '""')}"` : v;
  }).join(",");

const downloadCSV = (filename, headers, rows) => {
  const csv = [toCSVRow(headers), ...rows.map(toCSVRow)].join("\n");
  const a = Object.assign(document.createElement("a"), {
    href: URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" })),
    download: filename,
  });
  a.click();
  URL.revokeObjectURL(a.href);
};

const GENDER_LABELS = { male: "Male", female: "Female", other: "Other" };
const ROLE_LABELS   = { admin: "Administrator", nurses: "Nurse", triage: "Triage", pharmacy: "Pharmacy" };

/* ─── Donut ring (pure SVG) ──────────────────────────────── */
const DonutRing = ({ pct, color = "#0077b6", size = 64, stroke = 8 }) => {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (pct / 100) * circ;
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#f1f5f9" strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
        style={{ transition: "stroke-dasharray 0.6s ease" }} />
    </svg>
  );
};

/* ─── Horizontal ranked bar ──────────────────────────────── */
const RankedBar = ({ rank, label, count, pct, max, color = "#0077b6", badge }) => (
  <div className="flex items-center gap-3 py-1.5">
    <span className="text-[10px] font-bold text-gray-300 w-4 shrink-0 text-right">{rank}</span>
    <div className="flex-1 min-w-0">
      <div className="flex items-center justify-between mb-0.5">
        <span className="text-[11px] font-medium text-gray-700 truncate max-w-[55%]" title={label}>{label}</span>
        <div className="flex items-center gap-1.5 shrink-0 ml-1">
          {badge && (
            <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded border ${badge}`}>{count}</span>
          )}
          {!badge && <span className="text-[11px] font-semibold text-health-navy">{count}</span>}
          {pct != null && <span className="text-[10px] text-gray-400">{pct}%</span>}
        </div>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${(count / max) * 100}%`, background: color }}
        />
      </div>
    </div>
  </div>
);

/* ─── Sparkline (mini SVG line) ──────────────────────────── */
const Sparkline = ({ data, color = "#0077b6", height = 48 }) => {
  if (!data?.length) return null;
  const max = Math.max(...data.map((d) => d.count), 1);
  const w = 400;
  const h = height;
  const step = w / Math.max(data.length - 1, 1);
  const pts = data.map((d, i) => `${i * step},${h - (d.count / max) * (h - 6) - 3}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
      <polyline fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" points={pts} />
      {data.map((d, i) => (
        <circle key={i} cx={i * step} cy={h - (d.count / max) * (h - 6) - 3} r="3" fill={color} />
      ))}
    </svg>
  );
};

/* ─── KPI metric card ────────────────────────────────────── */
const MetricCard = ({ label, value, sub, trend, color = "#0077b6", icon }) => (
  <div className="admin-card p-4 flex flex-col justify-between min-h-[88px]">
    <div className="flex items-start justify-between">
      <p className="text-[10px] text-gray-400 uppercase tracking-widest font-medium">{label}</p>
      {icon && <span className="text-base opacity-40">{icon}</span>}
    </div>
    <div>
      <p className="text-2xl font-bold mt-1" style={{ color }}>{value}</p>
      <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>
      {trend != null && (
        <span className={`text-[10px] font-semibold ${trend >= 0 ? "text-emerald-600" : "text-red-500"}`}>
          {trend >= 0 ? "▲" : "▼"} {Math.abs(trend)}% vs last period
        </span>
      )}
    </div>
  </div>
);

/* ─── Priority badge ─────────────────────────────────────── */
const PRIORITY_STYLES = {
  "High priority":      { bar: "#ef4444", badge: "bg-red-50 text-red-700 border-red-200" },
  "Moderate priority":  { bar: "#f59e0b", badge: "bg-amber-50 text-amber-700 border-amber-200" },
  "Low priority":       { bar: "#10b981", badge: "bg-emerald-50 text-emerald-700 border-emerald-200" },
};



/* ─── report type configs ─────────────────────────────────── */
const REPORT_TYPES = [
  { id: "patients",  label: "Patient List",     icon: "🏥", desc: "Demographics + visit counts" },
  { id: "stats",     label: "Disease & Symptom Statistics", icon: "📊", desc: "Top diagnoses, symptoms, priorities" },
  { id: "visits",    label: "Visit History",    icon: "📋", desc: "All triage visits with predictions" },
  { id: "staff",     label: "Staff Activity",   icon: "👥", desc: "Staff roles & login activity" },
];

/* ══════════════════════════════════════════════════════════ */
const Reports = () => {
  const { user } = useOutletContext();

  const [reportType,  setReportType]  = useState("patients");
  const [patients,    setPatients]    = useState([]);   // list endpoint (no history)
  const [fullPts,     setFullPts]     = useState([]);   // stats endpoint (with history)
  const [staff,       setStaff]       = useState([]);
  const [isLoading,   setIsLoading]   = useState(false);
  const [error,       setError]       = useState(null);
  const [dateFrom,    setDateFrom]    = useState("");
  const [dateTo,      setDateTo]      = useState("");
  const [search,      setSearch]      = useState("");
  const [isPrinting,  setIsPrinting]  = useState(false);

  /* ── load ── */
  const loadData = useCallback(async () => {
    if (!user?.area) return;
    setIsLoading(true);
    setError(null);
    try {
      const [pRes, fpRes, sRes] = await Promise.all([
        api.get("/api/patients"),
        api.get("/api/patients/stats"),
        api.get("/api/areas/staff"),
      ]);
      setPatients(pRes.data.patients   || []);
      setFullPts(fpRes.data.patients   || []);
      setStaff(sRes.data.staff         || []);
    } catch (e) {
      setError(e.response?.data?.message || "Failed to load data.");
    } finally {
      setIsLoading(false);
    }
  }, [user?.area]);

  useEffect(() => { loadData(); }, [loadData]);

  /* ── date-range helper ── */
  const inRange = useCallback((dateStr) => {
    if (!dateStr) return true;
    const d = new Date(dateStr);
    if (dateFrom && d < new Date(dateFrom)) return false;
    if (dateTo   && d > new Date(dateTo + "T23:59:59")) return false;
    return true;
  }, [dateFrom, dateTo]);

  /* ── derived: patient list rows ── */
  const patientRows = useMemo(() => {
    const q = search.toLowerCase();
    return patients.filter((p) => {
      const matchDate = inRange(p.createdAt);
      const matchQ = !q || p.name?.toLowerCase().includes(q) || p.cin?.toLowerCase().includes(q);
      return matchDate && matchQ;
    }).map((p) => [
      p.cin,
      p.name,
      GENDER_LABELS[p.gender] || p.gender || "—",
      calcAge(p.dateOfBirth) ?? "—",
      p.bloodType || "—",
      p.phone || "—",
      p.address || "—",
      p.historyCount ?? 0,
      fmtDate(p.lastVisit),
      fmtDate(p.createdAt),
    ]);
  }, [patients, search, inRange]);

  /* ── derived: visit rows ── */
  const visitRows = useMemo(() => {
    const q = search.toLowerCase();
    const out = [];
    fullPts.forEach((p) => {
      (p.history || []).forEach((h) => {
        if (!inRange(h.date)) return;
        const matchQ =
          !q ||
          p.name?.toLowerCase().includes(q) ||
          p.cin?.toLowerCase().includes(q) ||
          h.title?.toLowerCase().includes(q) ||
          (h.triage?.symptoms || []).join(" ").toLowerCase().includes(q);
        if (!matchQ) return;
        out.push([
          fmtDateTime(h.date),
          p.cin, p.name,
          h.type,
          h.title,
          (h.triage?.symptoms || []).join(", ") || "—",
          [
            h.triage?.vitals?.temperature && `Temp ${h.triage.vitals.temperature}`,
            h.triage?.vitals?.pulse        && `Pulse ${h.triage.vitals.pulse}`,
            h.triage?.vitals?.bloodPressure && `BP ${h.triage.vitals.bloodPressure}`,
          ].filter(Boolean).join(", ") || "—",
          h.triage?.predictions?.[0]
            ? `${h.triage.predictions[0].label} (${h.triage.predictions[0].confidence}%)`
            : h.notes || "—",
          h.triage?.priority || "—",
        ]);
      });
    });
    return out.sort((a, b) => new Date(b[0]) - new Date(a[0]));
  }, [fullPts, search, inRange]);

  /* ── derived: staff rows ── */
  const staffRows = useMemo(() => {
    const q = search.toLowerCase();
    return staff.filter((s) => {
      const matchDate = inRange(s.lastLogin);
      const matchQ = !q || s.name?.toLowerCase().includes(q) || s.email?.toLowerCase().includes(q);
      return matchDate && matchQ;
    }).map((s) => [
      s.name, s.email,
      ROLE_LABELS[s.role] || s.role,
      s.isVerified ? "Yes" : "No",
      fmtDateTime(s.lastLogin),
      fmtDate(s.createdAt),
    ]);
  }, [staff, search, inRange]);

  /* ── derived: STATISTICS ── */
  const stats = useMemo(() => {
    const filtered = fullPts.filter((p) => inRange(p.createdAt));

    const allVisits = [];
    const triageVisits = [];
    filtered.forEach((p) => {
      (p.history || []).forEach((h) => {
        if (!inRange(h.date)) return;
        allVisits.push({ p, h });
        if (h.triage?.predictions?.length) triageVisits.push({ p, h });
      });
    });

    const countMap = (arr) => arr.reduce((m, v) => { m[v] = (m[v] || 0) + 1; return m; }, {});
    const rank = (obj) =>
      Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count }));

    /* --- diseases --- */
    const diseaseArr = triageVisits.flatMap(({ h }) =>
      h.triage.predictions.slice(0, 1).map((p) => p.label)
    );
    const diseaseFull = rank(countMap(diseaseArr)).map((d, i) => ({
      ...d,
      pct: triageVisits.length ? Math.round((d.count / triageVisits.length) * 100) : 0,
      rank: i + 1,
    }));

    /* --- symptoms --- */
    const symptomArr = triageVisits.flatMap(({ h }) => h.triage.symptoms || []);
    const totalTriageWithSx = triageVisits.filter((v) => v.h.triage.symptoms?.length).length;
    const symptomFull = rank(countMap(symptomArr)).map((s, i) => ({
      ...s,
      pct: totalTriageWithSx ? Math.round((s.count / totalTriageWithSx) * 100) : 0,
      rank: i + 1,
    }));

    /* --- priorities --- */
    const priorityArr = triageVisits
      .map(({ h }) => h.triage?.priority)
      .filter(Boolean);
    const priorityFull = rank(countMap(priorityArr));
    const totalWithPriority = priorityArr.length;

    /* --- confidence distribution --- */
    const confBuckets = { "≥ 75% (High)": 0, "50–74% (Moderate)": 0, "< 50% (Low)": 0 };
    triageVisits.forEach(({ h }) => {
      const c = h.triage.predictions[0]?.confidence ?? 0;
      if (c >= 75) confBuckets["≥ 75% (High)"]++;
      else if (c >= 50) confBuckets["50–74% (Moderate)"]++;
      else confBuckets["< 50% (Low)"]++;
    });
    const byConfidence = Object.entries(confBuckets).map(([label, count]) => ({ label, count }));

    /* --- symptom co-occurrence (which 2 symptoms appear together most) --- */
    const coMap = {};
    triageVisits.forEach(({ h }) => {
      const sx = (h.triage.symptoms || []).slice(0, 5);
      for (let i = 0; i < sx.length; i++) {
        for (let j = i + 1; j < sx.length; j++) {
          const key = [sx[i], sx[j]].sort().join(" + ");
          coMap[key] = (coMap[key] || 0) + 1;
        }
      }
    });
    const topCoOccurrence = Object.entries(coMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([label, count]) => ({ label, count }));

    /* --- vitals averages --- */
    const vitalNums = { temp: [], pulse: [], systolic: [] };
    triageVisits.forEach(({ h }) => {
      const v = h.triage.vitals;
      const t = parseFloat(v?.temperature);
      const p = parseFloat(v?.pulse);
      const bp = v?.bloodPressure?.split("/")?.[0];
      const s = parseFloat(bp);
      if (!isNaN(t) && t > 30 && t < 45) vitalNums.temp.push(t);
      if (!isNaN(p) && p > 30 && p < 250) vitalNums.pulse.push(p);
      if (!isNaN(s) && s > 50 && s < 250) vitalNums.systolic.push(s);
    });
    const avg = (arr) => arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) : "—";

    /* --- gender --- */
    const byGender = rank(countMap(filtered.map((p) => GENDER_LABELS[p.gender] || "Unknown")));

    /* --- blood type --- */
    const byBlood = rank(countMap(filtered.filter((p) => p.bloodType).map((p) => p.bloodType)));

    /* --- age groups --- */
    const ageBuckets = { "0–17": 0, "18–35": 0, "36–60": 0, "60+": 0, Unknown: 0 };
    filtered.forEach((p) => {
      const age = calcAge(p.dateOfBirth);
      if (age == null) ageBuckets.Unknown++;
      else if (age < 18) ageBuckets["0–17"]++;
      else if (age < 36) ageBuckets["18–35"]++;
      else if (age < 61) ageBuckets["36–60"]++;
      else ageBuckets["60+"]++;
    });
    const byAge = Object.entries(ageBuckets).map(([label, count]) => ({ label, count }));

    /* --- monthly trend --- */
    const monthly = {};
    allVisits.forEach(({ h }) => {
      const key = new Date(h.date).toLocaleDateString(undefined, { month: "short", year: "2-digit" });
      monthly[key] = (monthly[key] || 0) + 1;
    });
    const byMonth = Object.entries(monthly).map(([label, count]) => ({ label, count }));

    /* --- disease-symptom relationship (top disease → its most common symptoms) --- */
    const diseaseSxMap = {};
    triageVisits.forEach(({ h }) => {
      const d = h.triage.predictions[0]?.label;
      if (!d) return;
      if (!diseaseSxMap[d]) diseaseSxMap[d] = {};
      (h.triage.symptoms || []).forEach((s) => {
        diseaseSxMap[d][s] = (diseaseSxMap[d][s] || 0) + 1;
      });
    });
    const diseaseSymptomProfile = diseaseFull.slice(0, 5).map((d) => ({
      disease: d.label,
      count: d.count,
      topSymptoms: Object.entries(diseaseSxMap[d.label] || {})
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([s]) => s),
    }));

    return {
      totalPatients: filtered.length,
      totalVisits: allVisits.length,
      totalTriageVisits: triageVisits.length,
      avgVisits: filtered.length ? (allVisits.length / filtered.length).toFixed(1) : "—",
      avgTemp: avg(vitalNums.temp),
      avgPulse: avg(vitalNums.pulse),
      avgSystolic: avg(vitalNums.systolic),
      diseaseFull,
      symptomFull,
      priorityFull,
      totalWithPriority,
      byConfidence,
      topCoOccurrence,
      byGender,
      byBlood,
      byAge,
      byMonth,
      diseaseSymptomProfile,
    };
  }, [fullPts, inRange]);

  /* ── stats CSV export ── */
  const handleStatsCSV = () => {
    const sections = [
      { title: "Top Diagnoses", headers: ["Rank", "Disease", "Cases", "% of Triage Visits"], rows: stats.diseaseFull.map((d) => [d.rank, d.label, d.count, d.pct + "%"]) },
      { title: "Top Symptoms",  headers: ["Rank", "Symptom", "Count", "% of Triage Visits"], rows: stats.symptomFull.map((s) => [s.rank, s.label, s.count, s.pct + "%"]) },
      { title: "Triage Priority Distribution", headers: ["Priority", "Count", "% of Triage Visits"], rows: stats.priorityFull.map((p) => [p.label, p.count, stats.totalWithPriority ? Math.round(p.count / stats.totalWithPriority * 100) + "%" : "—"]) },
      { title: "Symptom Co-occurrence",  headers: ["Symptom Pair", "Cases"], rows: stats.topCoOccurrence.map((c) => [c.label, c.count]) },
      { title: "By Gender",    headers: ["Gender", "Count"],        rows: stats.byGender.map((g) => [g.label, g.count]) },
      { title: "By Blood Type",headers: ["Blood Type", "Count"],    rows: stats.byBlood.map((b) => [b.label, b.count]) },
      { title: "By Age Group", headers: ["Age Group", "Count"],     rows: stats.byAge.map((a) => [a.label, a.count]) },
      { title: "Disease-Symptom Profile", headers: ["Disease", "Cases", "Top Symptoms"], rows: stats.diseaseSymptomProfile.map((d) => [d.disease, d.count, d.topSymptoms.join(", ")]) },
    ];
    const lines = [
      `Clinical Statistics Report — ${user.area.name}`,
      `Generated: ${new Date().toLocaleString()}`,
      `Patients: ${stats.totalPatients} | Total Visits: ${stats.totalVisits} | Triage Visits: ${stats.totalTriageVisits} | Avg visits/patient: ${stats.avgVisits}`,
      `Avg Temp: ${stats.avgTemp}°C | Avg Pulse: ${stats.avgPulse} bpm | Avg Systolic BP: ${stats.avgSystolic} mmHg`,
      "",
    ];
    sections.forEach(({ title, headers, rows }) => {
      lines.push(title);
      lines.push(toCSVRow(headers));
      rows.forEach((r) => lines.push(toCSVRow(r.map(String))));
      lines.push("");
    });
    const a = Object.assign(document.createElement("a"), {
      href: URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" })),
      download: `clinical-statistics-${new Date().toISOString().slice(0, 10)}.csv`,
    });
    a.click();
    URL.revokeObjectURL(a.href);
  };

  /* ── config per report type ── */
  const CONFIG = {
    patients: { headers: ["CIN", "Name", "Gender", "Age", "Blood Type", "Phone", "Address", "Visits", "Last Visit", "Registered"], rows: patientRows },
    visits:   { headers: ["Date", "CIN", "Patient Name", "Type", "Title", "Symptoms", "Vitals", "Top Prediction", "Priority"],      rows: visitRows },
    staff:    { headers: ["Name", "Email", "Role", "Verified", "Last Login", "Joined"],                                               rows: staffRows },
    stats:    { headers: [], rows: [] },
  };
  const cfg         = CONFIG[reportType] || CONFIG.patients;
  const currentType = REPORT_TYPES.find((t) => t.id === reportType);

  const handleCSV = () => {
    if (reportType === "stats") { handleStatsCSV(); return; }
    downloadCSV(`${reportType}-report-${new Date().toISOString().slice(0, 10)}.csv`, cfg.headers, cfg.rows);
  };

  const handlePDF = () => {
    setIsPrinting(true);
    setTimeout(() => { window.print(); setIsPrinting(false); }, 100);
  };

  /* ── early return: no area ── */
  if (!user?.area) {
    return (
      <div className="w-full">
        <PageHeader title="Reports" description="Export and download clinic reports" />
        <div className="admin-card p-6 text-center">
          <p className="text-xs text-gray-500">Complete clinic setup to generate reports.</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #report-print-area, #report-print-area * { visibility: visible !important; }
          #report-print-area { position: fixed; inset: 0; padding: 24px; font-family: sans-serif; font-size: 11px; color: #1a1a2e; }
          #report-print-area table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
          #report-print-area th { background: #f0f9ff; padding: 6px 8px; text-align: left; border-bottom: 1px solid #bae6fd; font-size: 10px; text-transform: uppercase; }
          #report-print-area td { padding: 5px 8px; border-bottom: 1px solid #f1f5f9; }
          #report-print-area .no-print { display: none !important; }
          #report-print-area h2 { font-size: 13px; font-weight: 700; margin: 12px 0 6px; color: #1a1a2e; }
        }
      `}</style>

      <div className="w-full max-w-6xl" id="report-print-area">
        {/* ── Header ── */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6 no-print">
          <PageHeader title="Reports" description={`Export data for ${user.area.name}`} />
          <div className="flex flex-wrap gap-2 self-start">
            <button type="button" onClick={loadData} disabled={isLoading}
              className="btn-outline disabled:opacity-50">
              <FaSync className={`text-[10px] ${isLoading ? "animate-spin" : ""}`} /> Refresh
            </button>
            <button type="button" onClick={handleCSV}
              disabled={reportType !== "stats" && cfg.rows.length === 0}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-xl bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-40 shadow-sm shadow-emerald-500/20 transition-all">
              <FaFileCsv /> Export CSV
            </button>
            <button type="button" onClick={handlePDF}
              disabled={(reportType !== "stats" && cfg.rows.length === 0) || isPrinting}
              className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-2 rounded-xl bg-gradient-to-r from-health-navy to-health-blue text-white hover:from-health-navy hover:to-health-cyan disabled:opacity-40 shadow-md shadow-health-navy/20 transition-all">
              <FaFilePdf /> {isPrinting ? "Preparing…" : "Export PDF"}
            </button>
          </div>
        </div>

        {/* ── Print header ── */}
        <div className="hidden print:block mb-4">
          <h1 className="text-lg font-bold text-health-navy">{currentType?.label}</h1>
          <p className="text-xs text-gray-500">Clinic: {user.area.name} · Generated: {new Date().toLocaleString()}
            {dateFrom && ` · From: ${dateFrom}`}{dateTo && ` · To: ${dateTo}`}</p>
        </div>

        {/* ── Report type selector ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5 no-print">
          {REPORT_TYPES.map((type) => (
            <button key={type.id} type="button"
              onClick={() => { setReportType(type.id); setSearch(""); }}
              className={`admin-card p-4 text-left transition-all duration-200 ${
                reportType === type.id
                  ? "border-health-blue bg-gradient-to-br from-health-ice/40 to-white ring-2 ring-health-blue/20 shadow-card-hover -translate-y-0.5"
                  : "hover:border-health-blue/30 hover:bg-health-ice/10 hover:-translate-y-0.5 hover:shadow-card-hover"
              }`}>
              <span className="text-2xl block mb-2">{type.icon}</span>
              <p className={`text-xs font-bold ${reportType === type.id ? "text-health-blue" : "text-health-navy"}`}>{type.label}</p>
              <p className="text-[10px] text-slate-400 mt-0.5 leading-relaxed">{type.desc}</p>
            </button>
          ))}
        </div>

        {/* ── Filters ── */}
        <div className="admin-card p-5 mb-5 no-print">
          <div className="flex items-center gap-2 mb-4">
            <FaFilter className="text-health-blue text-[11px]" />
            <span className="text-xs font-bold text-health-navy">Filters</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {reportType !== "stats" && (
              <div>
                <label className="auth-label" htmlFor="rep-search">Search</label>
                <input id="rep-search" value={search} onChange={(e) => setSearch(e.target.value)}
                  placeholder={reportType === "patients" ? "Name or CIN…" : reportType === "visits" ? "Name, CIN or symptom…" : "Name or email…"}
                  className="auth-input" />
              </div>
            )}
            <div>
              <label className="auth-label" htmlFor="rep-from">Date from</label>
              <input id="rep-from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="auth-input" />
            </div>
            <div>
              <label className="auth-label" htmlFor="rep-to">Date to</label>
              <input id="rep-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="auth-input" />
            </div>
          </div>
          {(dateFrom || dateTo || search) && (
            <button type="button" onClick={() => { setDateFrom(""); setDateTo(""); setSearch(""); }}
              className="mt-3 text-[11px] font-semibold text-health-blue hover:text-health-navy transition-colors">Clear filters</button>
          )}
        </div>

        {/* ── Error ── */}
        {error && <div className="admin-card p-4 mb-4 border-red-200 bg-red-50 no-print"><p className="text-xs text-red-600">{error}</p></div>}

        {isLoading ? (
          <div className="admin-card p-12 text-center"><p className="text-xs text-gray-400">Loading report data…</p></div>
        ) : reportType === "stats" ? (
          /* ════════════════════════════════════════════════════
             CLINICAL STATISTICS DASHBOARD
          ════════════════════════════════════════════════════ */
          <div className="space-y-4">

            {/* ── Section label ── */}
            <div className="flex items-center gap-2">
              <div className="h-px flex-1 bg-gray-100" />
              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest px-2">Overview</span>
              <div className="h-px flex-1 bg-gray-100" />
            </div>

            {/* ── KPI row ── */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <MetricCard label="Patients" value={stats.totalPatients} sub="registered" icon="🧑‍⚕️" color="#0077b6" />
              <MetricCard label="Total Visits" value={stats.totalVisits} sub="all history entries" icon="📋" color="#00b4d8" />
              <MetricCard label="Triage Visits" value={stats.totalTriageVisits} sub="with AI prediction" icon="🧬" color="#0096c7" />
              <MetricCard label="Avg Visits" value={stats.avgVisits} sub="per patient" icon="📈" color="#0077b6" />
              <MetricCard label="Avg Temp" value={stats.avgTemp !== "—" ? `${stats.avgTemp}°C` : "—"} sub="across triage visits" icon="🌡️" color="#ef4444" />
              <MetricCard label="Avg Pulse" value={stats.avgPulse !== "—" ? `${stats.avgPulse} bpm` : "—"} sub="across triage visits" icon="❤️" color="#f43f5e" />
            </div>

            {stats.totalTriageVisits === 0 ? (
              <div className="admin-card p-10 text-center">
                <p className="text-sm font-semibold text-gray-400">No triage data yet</p>
                <p className="text-xs text-gray-300 mt-1">Complete some Smart Triage visits to populate this dashboard.</p>
              </div>
            ) : (
              <>
                {/* ── Section: Epidemiology ── */}
                <div className="flex items-center gap-2 pt-2">
                  <div className="h-px flex-1 bg-gray-100" />
                  <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest px-2">Epidemiology</span>
                  <div className="h-px flex-1 bg-gray-100" />
                </div>

                <div className="grid lg:grid-cols-2 gap-4">
                  {/* Top Diagnoses */}
                  <div className="admin-card p-5">
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <h2 className="text-xs font-bold text-health-navy uppercase tracking-wide">Top Diagnoses</h2>
                        <p className="text-[10px] text-gray-400 mt-0.5">AI-predicted, ranked by frequency</p>
                      </div>
                      <span className="text-[10px] font-semibold text-health-blue bg-health-ice/60 px-2 py-1 rounded-md">
                        {stats.diseaseFull.length} diseases
                      </span>
                    </div>
                    {stats.diseaseFull.length === 0
                      ? <p className="text-xs text-gray-400">No predictions recorded.</p>
                      : (
                        <div className="divide-y divide-gray-50">
                          {stats.diseaseFull.slice(0, 8).map((d) => (
                            <RankedBar key={d.label} rank={d.rank} label={d.label}
                              count={d.count} pct={d.pct}
                              max={stats.diseaseFull[0].count}
                              color={d.rank === 1 ? "#ef4444" : d.rank <= 3 ? "#f59e0b" : "#0077b6"}
                              badge={
                                d.rank === 1 ? "bg-red-50 text-red-700 border-red-200" :
                                d.rank <= 3  ? "bg-amber-50 text-amber-700 border-amber-200" :
                                               "bg-blue-50 text-blue-700 border-blue-100"
                              }
                            />
                          ))}
                        </div>
                      )
                    }
                  </div>

                  {/* Top Symptoms */}
                  <div className="admin-card p-5">
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <h2 className="text-xs font-bold text-health-navy uppercase tracking-wide">Most Reported Symptoms</h2>
                        <p className="text-[10px] text-gray-400 mt-0.5">Across all triage visits</p>
                      </div>
                      <span className="text-[10px] font-semibold text-health-blue bg-health-ice/60 px-2 py-1 rounded-md">
                        {stats.symptomFull.length} unique
                      </span>
                    </div>
                    {stats.symptomFull.length === 0
                      ? <p className="text-xs text-gray-400">No symptoms recorded.</p>
                      : (
                        <div className="divide-y divide-gray-50">
                          {stats.symptomFull.slice(0, 8).map((s) => (
                            <RankedBar key={s.label} rank={s.rank} label={s.label}
                              count={s.count} pct={s.pct}
                              max={stats.symptomFull[0].count}
                              color="#0096c7"
                            />
                          ))}
                        </div>
                      )
                    }
                  </div>
                </div>

                {/* ── Disease-Symptom Profile Table ── */}
                {stats.diseaseSymptomProfile.length > 0 && (
                  <div className="admin-card p-5">
                    <h2 className="text-xs font-bold text-health-navy uppercase tracking-wide mb-1">Disease–Symptom Profile</h2>
                    <p className="text-[10px] text-gray-400 mb-4">Most common symptoms associated with each top diagnosis</p>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs text-left">
                        <thead>
                          <tr className="border-b border-gray-100">
                            <th className="pb-2 pr-4 font-semibold text-[10px] text-gray-400 uppercase tracking-wide">Diagnosis</th>
                            <th className="pb-2 pr-4 font-semibold text-[10px] text-gray-400 uppercase tracking-wide">Cases</th>
                            <th className="pb-2 font-semibold text-[10px] text-gray-400 uppercase tracking-wide">Associated Symptoms</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50">
                          {stats.diseaseSymptomProfile.map((d, i) => (
                            <tr key={d.disease} className="hover:bg-gray-50/60">
                              <td className="py-2 pr-4">
                                <div className="flex items-center gap-2">
                                  <span className={`w-5 h-5 rounded-full text-[9px] font-bold flex items-center justify-center text-white ${i === 0 ? "bg-red-400" : i <= 2 ? "bg-amber-400" : "bg-health-blue"}`}>{i + 1}</span>
                                  <span className="font-semibold text-health-navy">{d.disease}</span>
                                </div>
                              </td>
                              <td className="py-2 pr-4 font-semibold text-health-blue">{d.count}</td>
                              <td className="py-2">
                                <div className="flex flex-wrap gap-1">
                                  {d.topSymptoms.length > 0
                                    ? d.topSymptoms.map((s) => (
                                      <span key={s} className="text-[10px] px-2 py-0.5 rounded-full bg-health-ice/60 text-health-navy border border-health-blue/10">{s}</span>
                                    ))
                                    : <span className="text-[10px] text-gray-400">—</span>
                                  }
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* ── Section: Patient Demographics ── */}
                <div className="flex items-center gap-2 pt-2">
                  <div className="h-px flex-1 bg-gray-100" />
                  <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest px-2">Patient Demographics</span>
                  <div className="h-px flex-1 bg-gray-100" />
                </div>

                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {/* Gender donut */}
                  <div className="admin-card p-5">
                    <h2 className="text-xs font-bold text-health-navy uppercase tracking-wide mb-4">Gender Distribution</h2>
                    <div className="flex items-center gap-4">
                      <div className="relative shrink-0">
                        <DonutRing
                          pct={stats.byGender.length ? Math.round((stats.byGender[0]?.count / stats.totalPatients) * 100) : 0}
                          color="#0077b6" size={72} stroke={10}
                        />
                        <div className="absolute inset-0 flex items-center justify-center">
                          <span className="text-xs font-bold text-health-navy">
                            {stats.byGender.length ? Math.round((stats.byGender[0]?.count / stats.totalPatients) * 100) : 0}%
                          </span>
                        </div>
                      </div>
                      <ul className="space-y-1.5 text-xs">
                        {stats.byGender.map((g, i) => (
                          <li key={g.label} className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: i === 0 ? "#0077b6" : i === 1 ? "#00b4d8" : "#94a3b8" }} />
                            <span className="text-gray-600">{g.label}</span>
                            <span className="font-semibold text-health-navy ml-auto">{g.count}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  {/* Age groups */}
                  <div className="admin-card p-5">
                    <h2 className="text-xs font-bold text-health-navy uppercase tracking-wide mb-4">Age Groups</h2>
                    <div className="space-y-0">
                      {stats.byAge.filter((a) => a.count > 0).map((a) => (
                        <RankedBar key={a.label} rank="" label={a.label}
                          count={a.count}
                          pct={stats.totalPatients ? Math.round(a.count / stats.totalPatients * 100) : 0}
                          max={Math.max(...stats.byAge.map((x) => x.count), 1)}
                          color="#0096c7"
                        />
                      ))}
                    </div>
                  </div>

                  {/* Blood types */}
                  <div className="admin-card p-5">
                    <h2 className="text-xs font-bold text-health-navy uppercase tracking-wide mb-4">Blood Types</h2>
                    {stats.byBlood.length === 0
                      ? <p className="text-xs text-gray-400">No blood type data recorded.</p>
                      : (
                        <div className="space-y-0">
                          {stats.byBlood.map((b, i) => (
                            <RankedBar key={b.label} rank={i + 1} label={b.label}
                              count={b.count}
                              pct={stats.totalPatients ? Math.round(b.count / stats.totalPatients * 100) : 0}
                              max={stats.byBlood[0].count}
                              color="#dc2626"
                            />
                          ))}
                        </div>
                      )
                    }
                  </div>
                </div>

                {/* ── Section: Triage Outcomes ── */}
                <div className="flex items-center gap-2 pt-2">
                  <div className="h-px flex-1 bg-gray-100" />
                  <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest px-2">Triage Outcomes</span>
                  <div className="h-px flex-1 bg-gray-100" />
                </div>

                <div className="grid sm:grid-cols-2 gap-4">
                  {/* Priority distribution */}
                  <div className="admin-card p-5">
                    <h2 className="text-xs font-bold text-health-navy uppercase tracking-wide mb-1">Priority Distribution</h2>
                    <p className="text-[10px] text-gray-400 mb-4">Based on AI confidence scores at triage</p>
                    {stats.priorityFull.length === 0
                      ? <p className="text-xs text-gray-400">No priority data recorded.</p>
                      : (
                        <div className="space-y-3">
                          {stats.priorityFull.map((p) => {
                            const style = PRIORITY_STYLES[p.label] || { bar: "#94a3b8", badge: "bg-gray-100 text-gray-600 border-gray-200" };
                            const pct = stats.totalWithPriority ? Math.round(p.count / stats.totalWithPriority * 100) : 0;
                            return (
                              <div key={p.label}>
                                <div className="flex items-center justify-between text-[11px] mb-1">
                                  <span className={`font-semibold px-2 py-0.5 rounded border text-[10px] ${style.badge}`}>{p.label}</span>
                                  <span className="font-semibold text-health-navy">{p.count} <span className="text-gray-400 font-normal">({pct}%)</span></span>
                                </div>
                                <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                                  <div className="h-full rounded-full transition-all duration-500"
                                    style={{ width: `${pct}%`, background: style.bar }} />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )
                    }
                  </div>

                  {/* Symptom co-occurrence */}
                  <div className="admin-card p-5">
                    <h2 className="text-xs font-bold text-health-navy uppercase tracking-wide mb-1">Symptom Co-occurrence</h2>
                    <p className="text-[10px] text-gray-400 mb-4">Symptom pairs most frequently reported together</p>
                    {stats.topCoOccurrence.length === 0
                      ? <p className="text-xs text-gray-400">Not enough data for co-occurrence analysis.</p>
                      : (
                        <div className="space-y-2">
                          {stats.topCoOccurrence.map((c, i) => (
                            <div key={c.label} className="flex items-center gap-3 py-1">
                              <span className="text-[10px] font-bold text-gray-300 w-4 text-right shrink-0">{i + 1}</span>
                              <div className="flex-1 min-w-0">
                                <div className="flex flex-wrap gap-1 mb-1">
                                  {c.label.split(" + ").map((s) => (
                                    <span key={s} className="text-[10px] px-1.5 py-0.5 rounded bg-health-ice/60 text-health-navy border border-health-blue/10">{s}</span>
                                  ))}
                                </div>
                                <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                  <div className="h-full rounded-full bg-gradient-to-r from-health-blue to-health-cyan"
                                    style={{ width: `${(c.count / (stats.topCoOccurrence[0]?.count || 1)) * 100}%` }} />
                                </div>
                              </div>
                              <span className="text-[11px] font-semibold text-health-navy shrink-0">{c.count}</span>
                            </div>
                          ))}
                        </div>
                      )
                    }
                  </div>
                </div>

                {/* ── Monthly Visit Trend ── */}
                {stats.byMonth.length > 0 && (
                  <>
                    <div className="flex items-center gap-2 pt-2">
                      <div className="h-px flex-1 bg-gray-100" />
                      <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-widest px-2">Visit Trend</span>
                      <div className="h-px flex-1 bg-gray-100" />
                    </div>

                    <div className="admin-card p-5">
                      <div className="flex items-start justify-between mb-4">
                        <div>
                          <h2 className="text-xs font-bold text-health-navy uppercase tracking-wide">Monthly Visit Volume</h2>
                          <p className="text-[10px] text-gray-400 mt-0.5">All visit types over time</p>
                        </div>
                        <span className="text-[10px] font-semibold text-gray-400">
                          Peak: <span className="text-health-navy font-bold">
                            {Math.max(...stats.byMonth.map((m) => m.count))} visits
                          </span>
                        </span>
                      </div>
                      <Sparkline data={stats.byMonth} color="#0077b6" height={56} />
                      <div className="flex justify-between mt-1">
                        {stats.byMonth.length > 1 && (
                          <>
                            <span className="text-[9px] text-gray-400">{stats.byMonth[0]?.label}</span>
                            <span className="text-[9px] text-gray-400">{stats.byMonth[stats.byMonth.length - 1]?.label}</span>
                          </>
                        )}
                      </div>
                      {/* month labels every 3 */}
                      <div className="grid mt-2" style={{ gridTemplateColumns: `repeat(${Math.min(stats.byMonth.length, 12)}, 1fr)` }}>
                        {stats.byMonth.slice(-12).map((m) => (
                          <div key={m.label} className="text-center">
                            <p className="text-[9px] text-gray-400 truncate">{m.label}</p>
                            <p className="text-[10px] font-semibold text-health-navy">{m.count}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </>
            )}

            {/* stats table exports (visible in print) */}
            {[
              { title: "Top Diagnoses", headers: ["Disease", "Cases", "%"], rows: stats.diseaseFull.slice(0, 10).map((d) => [d.label, d.count, d.pct + "%"]) },
              { title: "Top Symptoms",  headers: ["Symptom", "Count", "%"],  rows: stats.symptomFull.slice(0, 10).map((s) => [s.label, s.count, s.pct + "%"]) },
            ].map(({ title, headers, rows }) => (
              <div key={title} className="hidden print:block">
                <h2>{title}</h2>
                <table>
                  <thead><tr>{headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
                  <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
                </table>
              </div>
            ))}
          </div>
        ) : (
          /* ════════════════════════════════════════════════════
             TABLE VIEW
          ════════════════════════════════════════════════════ */
          <>
            {/* summary bar */}
            {cfg.rows.length > 0 && (
              <div className="flex flex-wrap gap-3 mb-4">
                <div className="admin-card px-4 py-2.5 flex items-center gap-2">
                  <FaChartBar className="text-health-blue text-xs" />
                  <span className="text-xs font-semibold text-health-navy">{cfg.rows.length} records</span>
                </div>
                {reportType === "patients" && (
                  <>
                    <div className="admin-card px-4 py-2.5 text-xs text-gray-600">
                      Total visits: <span className="font-semibold text-health-navy">
                        {patientRows.reduce((s, r) => s + (typeof r[7] === "number" ? r[7] : 0), 0)}
                      </span>
                    </div>
                  </>
                )}
              </div>
            )}

            <div className="admin-card overflow-hidden">
              {cfg.rows.length === 0 ? (
                <p className="text-xs text-gray-400 p-8 text-center">No data found for the current filters.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50/80">
                        <th className="px-4 py-3 font-semibold text-gray-400 text-[10px] uppercase tracking-wide w-8">#</th>
                        {cfg.headers.map((h) => (
                          <th key={h} className="px-4 py-3 font-semibold text-gray-400 text-[10px] uppercase tracking-wide whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {cfg.rows.map((row, ri) => (
                        <tr key={ri} className="hover:bg-health-ice/20 transition-colors">
                          <td className="px-4 py-2.5 text-gray-300 font-mono text-[10px]">{ri + 1}</td>
                          {row.map((cell, ci) => (
                            <td key={ci}
                              className={`px-4 py-2.5 max-w-[200px] truncate ${
                                ci === 0 ? "font-mono font-semibold text-health-blue"
                                : ci === 1 ? "font-semibold text-health-navy"
                                : "text-gray-600"
                              }`}
                              title={String(cell)}>
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {cfg.rows.length > 0 && (
              <p className="text-[11px] text-gray-400 mt-3 no-print">
                {cfg.rows.length} record{cfg.rows.length !== 1 ? "s" : ""} ·{" "}
                Use <span className="font-semibold">Export CSV</span> for Excel/Sheets or{" "}
                <span className="font-semibold">Export PDF</span> to save/print.
              </p>
            )}
          </>
        )}
      </div>
    </>
  );
};

export default Reports;
