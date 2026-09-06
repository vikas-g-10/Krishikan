/**
 * MOCK DATA — presentation only.
 *
 * This file exists solely so the KRISHI-NEXUS shell can render realistic
 * content. Nothing here talks to a backend, API, or AI service. When the real
 * backend is connected later, replace these exports with data fetched in route
 * loaders / hooks and delete this file. Types below are the contract the UI
 * expects, so keeping them stable makes the swap mechanical.
 */

export type StatusLevel = "good" | "watch" | "alert";

export type Farmer = {
  name: string;
  village: string;
  district: string;
  state: string;
  landHolding: string;
  irrigation: string;
};

export type CropCycle = {
  crop: string;
  variety: string;
  season: string;
  sownOn: string;
  stage: string;
  stageProgress: number;
  daysAfterSowing: number;
  expectedHarvest: string;
};

export type WeatherSummary = {
  condition: string;
  temperatureC: number;
  feelsLikeC: number;
  humidityPct: number;
  windKph: number;
  rainChancePct: number;
  advisory: string;
  status: StatusLevel;
  forecast: { day: string; condition: string; highC: number; lowC: number; rainPct: number }[];
};

export type SoilReading = {
  label: string;
  value: string;
  detail: string;
  status: StatusLevel;
  progress: number;
};

export type AiDecision = {
  id: string;
  title: string;
  category: "Irrigation" | "Nutrition" | "Pest & Disease" | "Market" | "Sowing";
  recommendation: string;
  rationale: string[];
  confidence: number;
  issuedAt: string;
  status: StatusLevel;
  window: string;
};

export const farmer: Farmer = {
  name: "Vikas Yadav",
  village: "Kolar",
  district: "Kolar",
  state: "Karnataka",
  landHolding: "1 acre",
  irrigation: "Not specified (demo)",
};

export const cropCycle: CropCycle = {
  crop: "Tomato",
  variety: "Arka Vikas",
  season: "Kharif 2026",
  sownOn: "1 Jul 2026",
  stage: "Flowering",
  stageProgress: 55,
  daysAfterSowing: 67,
  expectedHarvest: "15 Oct 2026",
};

export const weather: WeatherSummary = {
  condition: "Overcast with showers, 18 mm rain in last 24h",
  temperatureC: 26,
  feelsLikeC: 29,
  humidityPct: 88,
  windKph: 10,
  rainChancePct: 80,
  advisory: "Hold any foliar spray — more rain expected in the next 48 hours.",
  status: "watch",
  forecast: [
    { day: "Mon", condition: "Showers", highC: 27, lowC: 20, rainPct: 85 },
    { day: "Tue", condition: "Showers", highC: 27, lowC: 20, rainPct: 75 },
    { day: "Wed", condition: "Cloudy", highC: 28, lowC: 20, rainPct: 40 },
    { day: "Thu", condition: "Partly sunny", highC: 30, lowC: 21, rainPct: 20 },
    { day: "Fri", condition: "Sunny", highC: 31, lowC: 21, rainPct: 10 },
  ],
};

export const soilReadings: SoilReading[] = [
  { label: "Soil moisture", value: "74%", detail: "Above target for flowering — waterlogging risk", status: "alert", progress: 74 },
  { label: "Nitrogen (N)", value: "Medium", detail: "Within target range for flowering", status: "good", progress: 58 },
  { label: "Phosphorus (P)", value: "Medium", detail: "Within target range", status: "good", progress: 64 },
  { label: "Potassium (K)", value: "Medium", detail: "Within target range", status: "good", progress: 60 },
  { label: "Soil pH", value: "6.4", detail: "Slightly acidic — suitable for tomato", status: "good", progress: 70 },
  { label: "Leaf spotting", value: "Detected", detail: "Perception signal on lower leaves — not a confirmed diagnosis", status: "alert", progress: 81 },
];

export const aiDecisions: AiDecision[] = [
  {
    id: "KN-DEMO-KOLAR-TOM-001",
    title: "Wait for a safe weather window before spraying",
    category: "Pest & Disease",
    recommendation:
      "Hold the bio-fungicide foliar spray and re-assess once rainfall stops and the canopy is dry.",
    rationale: [
      "Leaf spotting detected on lower leaves (perception signal, 81%).",
      "Humidity 88% with 18 mm rain in the last 24 hours.",
      "Safety engine blocked spraying — rain would wash off the application.",
      "DEMO / SEEDED economics: ₹4,200 expected loss vs ₹800 intervention cost.",
    ],
    confidence: 86,
    issuedAt: "Today, 07:10",
    status: "alert",
    window: "Re-assess within 48 hours",
  },
  {
    id: "KN-DEMO-KOLAR-TOM-002",
    title: "Improve field drainage in the tomato block",
    category: "Irrigation",
    recommendation: "Clear furrow outlets so standing water drains; skip irrigation entirely.",
    rationale: [
      "Soil moisture at 74% is well above the flowering target.",
      "More rain expected over the next 48 hours.",
    ],
    confidence: 90,
    issuedAt: "Today, 06:35",
    status: "watch",
    window: "Act today",
  },
  {
    id: "KN-DEMO-KOLAR-TOM-003",
    title: "Hold calcium spray until canopy is dry",
    category: "Nutrition",
    recommendation: "Plan a calcium nitrate foliar spray for the first dry morning after the rain spell.",
    rationale: [
      "Flowering stage is the key window for fruit-set nutrition.",
      "Wet canopy reduces uptake and raises disease spread risk.",
    ],
    confidence: 78,
    issuedAt: "Yesterday, 16:40",
    status: "watch",
    window: "Next dry window",
  },
  {
    id: "KN-DEMO-KOLAR-TOM-004",
    title: "Stagger tomato harvest for better price realisation",
    category: "Market",
    recommendation: "Plan graded picking in two lots; Kolar mandi arrivals are heavy mid-month.",
    rationale: [
      "DEMO / SEEDED market data: modal price trending up week on week.",
      "Grading reduces rejection at the mandi.",
    ],
    confidence: 70,
    issuedAt: "30 Aug 2026",
    status: "good",
    window: "Review weekly",
  },
];

export const fieldPlots = [
  { name: "Block A", area: "0.6 acre", crop: "Tomato — Arka Vikas", status: "alert" as StatusLevel, note: "Leaf spotting observed on lower leaves" },
  { name: "Block B", area: "0.4 acre", crop: "Tomato — Arka Vikas", status: "watch" as StatusLevel, note: "Standing water near furrow outlets" },
];

export const statusLabel: Record<StatusLevel, string> = {
  good: "On track",
  watch: "Watch",
  alert: "Action needed",
};
