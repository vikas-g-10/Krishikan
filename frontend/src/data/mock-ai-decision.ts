/**
 * MOCK DATA — AI decision pipeline demo scenario.
 *
 * This file contains a single, isolated demo decision trace for the
 * KRISHI-NEXUS tomato scenario (Kolar, Karnataka). It is used only for
 * visual rendering on the /ai-decisions screen and should be replaced
 * with real backend data once the AI pipeline is connected.
 */

export const decisionScenario = {
  farm: {
    location: "Kolar, Karnataka",
    crop: "Tomato",
    variety: "Arka Vikas",
    area: "1 acre",
    growthStage: "Flowering",
  },
  perception: {
    title: "Leaf spots detected",
    confidence: 81,
    note: "Image analysis shows spotting patterns on lower leaves. This is a perception signal, not a confirmed disease diagnosis.",
  },
  fieldContext: {
    humidityPct: 88,
    rainfallLast24hMm: 18,
    soilMoisturePct: 74,
    forecastNote: "More rain expected in the next 48 hours",
  },
  riskEconomics: {
    riskLevel: "High",
    expectedLossINR: 4200,
    interventionCostINR: 800,
    note: "Demo / seeded values for illustration only",
  },
  initialProposal: {
    title: "Biological foliar intervention",
    description: "Apply Trichoderma-based bio-fungicide as a preventive foliar spray.",
    status: "proposed" as const,
  },
  safetyEngine: {
    status: "blocked" as const,
    reason: "Rain/weather condition makes the proposed foliar intervention unsafe at this time.",
  },
  adversarialReview: {
    status: "veto" as const,
    reason:
      "Reviewer challenged the initial proposal because the weather condition undermines the action.",
  },
  replan: {
    cycle: 1,
    note: "System reconsidered the decision given the blocked safety check and reviewer veto.",
  },
  finalDecision: {
    title: "WAIT FOR SAFE WEATHER WINDOW",
    status: "safe" as const,
    description:
      "Delay foliar application until rainfall stops and leaf surfaces dry. Re-check field conditions in 48 hours.",
  },
};
