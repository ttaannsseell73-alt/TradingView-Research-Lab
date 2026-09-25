const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function computeGrossRoePct({
  entryPrice,
  currentPrice,
  side,
  leverage = 5,
}) {
  if (!(entryPrice > 0) || !(currentPrice > 0)) {
    throw new Error("entryPrice and currentPrice must be > 0");
  }
  if (!["LONG", "SHORT"].includes(side)) {
    throw new Error("side must be LONG or SHORT");
  }
  if (!(leverage > 0)) {
    throw new Error("leverage must be > 0");
  }

  const rawReturn =
    side === "LONG"
      ? (currentPrice - entryPrice) / entryPrice
      : (entryPrice - currentPrice) / entryPrice;

  return rawReturn * leverage * 100;
}

export function estimateRoundTripCostRoePct({
  leverage = 5,
  feePctPerSide = 0.04,
  slippagePctPerSide = 0.02,
}) {
  if (leverage <= 0) throw new Error("leverage must be > 0");
  if (feePctPerSide < 0 || slippagePctPerSide < 0) {
    throw new Error("cost inputs must be >= 0");
  }

  const roundTripUnderlyingPct =
    2 * (feePctPerSide + slippagePctPerSide);

  return roundTripUnderlyingPct * leverage;
}

export function decideProfitExit({
  grossRoePct,
  peakGrossRoePct,
  estimatedCostRoePct,
  activationNetRoePct = 1.0,
  hardRealiseNetRoePct = 5.0,
  maxGivebackFraction = 0.35,
  minGivebackPctPoints = 0.35,
}) {
  const netRoePct = grossRoePct - estimatedCostRoePct;
  const peakNetRoePct = peakGrossRoePct - estimatedCostRoePct;

  if (netRoePct >= hardRealiseNetRoePct) {
    return {
      action: "REALISE",
      reason: "HARD_PROFIT_TARGET",
      netRoePct,
      peakNetRoePct,
    };
  }

  if (peakNetRoePct < activationNetRoePct) {
    return {
      action: "HOLD",
      reason: "PROFIT_LOCK_NOT_ACTIVE",
      netRoePct,
      peakNetRoePct,
    };
  }

  const allowedGiveback = Math.max(
    minGivebackPctPoints,
    peakNetRoePct * maxGivebackFraction,
  );

  if (netRoePct <= peakNetRoePct - allowedGiveback) {
    return {
      action: "REALISE",
      reason: "TRAILING_PROFIT_GIVEBACK",
      netRoePct,
      peakNetRoePct,
      allowedGiveback,
    };
  }

  return {
    action: "HOLD",
    reason: "PROFIT_LOCK_ACTIVE",
    netRoePct,
    peakNetRoePct,
    allowedGiveback,
  };
}

export function classifyScalpCandidate(metrics) {
  const {
    trades,
    netExpectancyPct,
    validationPF,
    holdoutPF,
    holdoutNetPct,
    maxDrawdownPct,
    stressedCostPositive,
  } = metrics;

  const reasons = [];

  if (trades < 30) reasons.push("TOO_FEW_TRADES");
  if (!(netExpectancyPct > 0)) reasons.push("NON_POSITIVE_EXPECTANCY");
  if (!(validationPF >= 1.15)) reasons.push("WEAK_VALIDATION_PF");
  if (!(holdoutPF >= 1.05)) reasons.push("WEAK_HOLDOUT_PF");
  if (!(holdoutNetPct > 0)) reasons.push("NON_POSITIVE_HOLDOUT");
  if (!(maxDrawdownPct <= 12)) reasons.push("DRAWDOWN_TOO_HIGH");
  if (stressedCostPositive !== true) reasons.push("COST_STRESS_FAIL");

  if (reasons.length > 0) {
    return { status: "REJECT", score: 0, reasons };
  }

  if (trades < 80) {
    return {
      status: "EVIDENCE_REVIEW",
      score: scoreScalpCandidate(metrics),
      reasons: ["THIN_SAMPLE"],
    };
  }

  if (holdoutPF > 4 && trades < 150) {
    return {
      status: "EVIDENCE_REVIEW",
      score: scoreScalpCandidate(metrics),
      reasons: ["EXTREME_PF_THIN_SAMPLE"],
    };
  }

  return {
    status: "PASS",
    score: scoreScalpCandidate(metrics),
    reasons: [],
  };
}

export function scoreScalpCandidate({
  trades,
  netExpectancyPct,
  validationPF,
  holdoutPF,
  maxDrawdownPct,
  robustnessPassRate = 0,
}) {
  const expectancyScore =
    clamp(netExpectancyPct / 0.25, 0, 1) * 30;
  const holdoutScore =
    clamp((holdoutPF - 1) / 1.5, 0, 1) * 25;
  const validationScore =
    clamp((validationPF - 1) / 1.5, 0, 1) * 15;
  const drawdownScore =
    (1 - clamp(maxDrawdownPct / 12, 0, 1)) * 15;
  const robustnessScore =
    clamp(robustnessPassRate, 0, 1) * 10;
  const sampleScore =
    clamp(trades / 300, 0, 1) * 5;

  return Number(
    (
      expectancyScore +
      holdoutScore +
      validationScore +
      drawdownScore +
      robustnessScore +
      sampleScore
    ).toFixed(2),
  );
}
