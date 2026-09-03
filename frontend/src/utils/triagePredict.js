import { getMaladieLabel } from "../constants/maladies";

const SYMPTOM_RULES = [
  { keywords: ["fever", "fièvre", "cough", "toux", "fatigue", "body ache"], maladie: "grippe", weight: 3 },
  { keywords: ["fever", "fièvre", "cough", "toux", "loss of taste", "loss of smell", "shortness of breath", "breathing difficulty"], maladie: "covid19", weight: 3 },
  { keywords: ["cough", "toux", "night sweats", "weight loss", "blood"], maladie: "tuberculose", weight: 4 },
  { keywords: ["wheezing", "shortness of breath", "breathing difficulty", "chest tightness", "asthma"], maladie: "asthme", weight: 4 },
  { keywords: ["thirst", "frequent urination", "blurred vision", "diabète"], maladie: "diabete", weight: 4 },
  { keywords: ["headache", "high blood pressure", "dizziness", "hypertension"], maladie: "hypertension", weight: 3 },
  { keywords: ["fever", "fièvre", "chills", "sweating", "paludisme"], maladie: "paludisme", weight: 4 },
  { keywords: ["fever", "fièvre", "rash", "joint pain", "dengue"], maladie: "dengue", weight: 4 },
  { keywords: ["vomiting", "diarrhea", "diarrhée", "nausea", "stomach"], maladie: "gastroenterite", weight: 4 },
  { keywords: ["cough", "toux", "fever", "fièvre", "sore throat", "respiratory", "breathing difficulty"], maladie: "infection_respiratoire", weight: 3 },
  { keywords: ["burning urination", "frequent urination", "pelvic pain"], maladie: "infection_urinaire", weight: 4 },
  { keywords: ["jaundice", "yellow eyes", "abdominal pain", "hepatitis"], maladie: "hepatite", weight: 3 },
  { keywords: ["severe pain", "anemia", "fatigue", "drepanocytose"], maladie: "drepanocytose", weight: 3 },
  { keywords: ["stiff neck", "fever", "fièvre", "headache", "confusion"], maladie: "meningite", weight: 5 },
  { keywords: ["fever", "fièvre", "rash", "red eyes", "rougeole"], maladie: "rougeole", weight: 4 },
  { keywords: ["itchy rash", "blisters", "varicelle"], maladie: "varicelle", weight: 4 },
  { keywords: ["sore throat", "fever", "fièvre", "neck swelling"], maladie: "diphterie", weight: 4 },
  { keywords: ["fever", "fièvre", "abdominal pain", "constipation", "typhoïde"], maladie: "typhoide", weight: 3 },
  { keywords: ["severe diarrhea", "dehydration", "vomiting"], maladie: "cholera", weight: 5 },
  { keywords: ["rash", "fever", "fièvre", "swollen lymph nodes", "blisters", "lesions", "mpox"], maladie: "mpox", weight: 4 },
];

const normalize = (text) => text.toLowerCase().trim();

export const COMMON_SYMPTOMS = [
  "Fever",
  "Cough",
  "Rash",
  "Vomiting",
  "Diarrhea",
  "Chest Pain",
  "Fatigue",
  "Headache",
  "Breathing Difficulty",
  "Loss of Smell",
  "Swollen Lymph Nodes",
  "Blisters / Lesions",
];

export const buildTriageContext = (vitals = {}, duration = "", notes = "") => {
  const parts = [];
  if (vitals.temperature?.trim()) parts.push(`temperature ${vitals.temperature}`);
  if (vitals.pulse?.trim()) parts.push(`pulse ${vitals.pulse}`);
  if (vitals.bloodPressure?.trim()) parts.push(`blood pressure ${vitals.bloodPressure}`);
  if (vitals.weight?.trim()) parts.push(`weight ${vitals.weight}`);
  if (vitals.height?.trim()) parts.push(`height ${vitals.height}`);
  if (duration?.trim()) parts.push(`duration ${duration}`);
  if (notes?.trim()) parts.push(notes.trim());
  return parts.join(" ");
};

export const formatTriageSummary = (vitals = {}, duration = "", selectedSymptoms = [], notes = "") => {
  const lines = [];
  const vitalParts = [
    vitals.temperature?.trim() && `Temperature: ${vitals.temperature}°C`,
    vitals.pulse?.trim() && `Pulse: ${vitals.pulse} bpm`,
    vitals.bloodPressure?.trim() && `Blood pressure: ${vitals.bloodPressure}`,
    vitals.weight?.trim() && `Weight: ${vitals.weight} kg`,
    vitals.height?.trim() && `Height: ${vitals.height} cm`,
  ].filter(Boolean);
  if (vitalParts.length) lines.push(`Vitals: ${vitalParts.join(", ")}`);
  if (selectedSymptoms.length) lines.push(`Symptoms: ${selectedSymptoms.join(", ")}`);
  if (duration?.trim()) lines.push(`Duration: ${duration}`);
  if (notes?.trim()) lines.push(`Notes: ${notes.trim()}`);
  return lines.join("\n");
};

export const buildTriageVisitPayload = ({
  vitals = {},
  symptomDuration = "",
  selectedSymptoms = [],
  symptomNotes = "",
  prediction = [],
  priority = null,
  matchedClass = null,
}) => {
  const summary = formatTriageSummary(vitals, symptomDuration, selectedSymptoms, symptomNotes);
  const top = prediction[0];

  return {
    type: "visit",
    title: top ? `Visit — ${top.label}` : "Smart Triage Visit",
    notes: summary,
    triage: {
      vitals: {
        temperature: vitals.temperature?.trim() || "",
        pulse: vitals.pulse?.trim() || "",
        bloodPressure: vitals.bloodPressure?.trim() || "",
        weight: vitals.weight?.trim() || "",
        height: vitals.height?.trim() || "",
      },
      symptoms: selectedSymptoms,
      duration: symptomDuration?.trim() || "",
      additionalNotes: symptomNotes?.trim() || "",
      predictions: prediction.map((item) => ({
        maladie: item.maladie,
        label: item.label,
        confidence: item.confidence,
      })),
      priority: priority?.label || "",
      suggestedClass: matchedClass
        ? { name: matchedClass.name, placeCode: matchedClass.placeCode }
        : undefined,
    },
  };
};

export const predictMaladies = (selectedSymptoms, extraNotes = "") => {
  const combined = normalize([...selectedSymptoms, extraNotes].join(" "));
  const scores = {};

  SYMPTOM_RULES.forEach((rule) => {
    let matchCount = 0;
    rule.keywords.forEach((keyword) => {
      if (combined.includes(normalize(keyword))) matchCount += 1;
    });
    if (matchCount > 0) {
      scores[rule.maladie] = (scores[rule.maladie] || 0) + matchCount * rule.weight;
    }
  });

  const results = Object.entries(scores)
    .map(([maladie, score]) => {
      const maxPossible = 15;
      const confidence = Math.min(95, Math.round((score / maxPossible) * 100));
      return {
        maladie,
        label: getMaladieLabel(maladie),
        confidence: Math.max(confidence, 25),
        score,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  if (results.length === 0) {
    return [{
      maladie: "autre",
      label: getMaladieLabel("autre"),
      confidence: 40,
      score: 0,
    }];
  }

  return results;
};

export const getPriorityFromPrediction = (topConfidence) => {
  if (topConfidence >= 75) return { level: "high", label: "High priority", badge: "bg-orange-50 text-orange-700 border-orange-100" };
  if (topConfidence >= 50) return { level: "moderate", label: "Moderate priority", badge: "bg-amber-50 text-amber-700 border-amber-100" };
  return { level: "low", label: "Low priority", badge: "bg-emerald-50 text-emerald-700 border-emerald-100" };
};
