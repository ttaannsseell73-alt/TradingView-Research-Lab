import {
  SCALP_SETUPS,
  detectScalpSetups,
} from "./scalp_signal_engine.mjs";
import {
  classifyScalpCandidate,
  estimateRoundTripCostRoePct,
} from "./scalp_gate.mjs";

function grossRoePct(entry, price, side, leverage) {
  const raw = side === "LONG"
    ? (price - entry) / entry
    : (entry - price) / entry;
  return raw * leverage * 100;
}

function priceForGrossRoe(entry, grossRoePctValue, side, leverage) {
  const move = grossRoePctValue / (100 * leverage);
  return side === "LONG"
    ? entry * (1 + move)
    : entry * (1 - move);
}

function summarize(trades) {
  if (!trades.length) {
    return {
      trades: 0,
      netExpectancyPct: 0,
      profitFactor: 0,
      netPct: 0,
      maxDrawdownPct: 0,
      winRate: 0,
    };
  }

  let wins = 0;
  let pos = 0;
  let neg = 0;
  let equity = 1;
  let peak = 1;
  let dd = 0;
  let sum = 0;

  for (const t of trades) {
    const r = Number(t.netRoePct);
    sum += r;
    if (r > 0) {
      wins++;
      pos += r;
    } else if (r < 0) {
      neg += r;
    }

    equity *= Math.max(1e-9, 1 + r / 100);
    peak = Math.max(peak, equity);
    dd = Math.max(dd, 1 - equity / peak);
  }

  return {
    trades: trades.length,
    netExpectancyPct: sum / trades.length,
    profitFactor: neg < 0 ? pos / Math.abs(neg) : pos > 0 ? 999 : 0,
    netPct: (equity - 1) * 100,
    maxDrawdownPct: dd * 100,
    winRate: wins / trades.length,
  };
}

function splitByTime(trades) {
  if (!trades.length) return { train: [], validation: [], holdout: [] };
  const ordered = [...trades].sort((a, b) => a.entryTime - b.entryTime);
  const start = ordered[0].entryTime;
  const end = Math.max(start + 1, ordered.at(-1).entryTime);
  const w = end - start;
  const t1 = start + w * 0.60;
  const t2 = start + w * 0.80;
  return {
    train: ordered.filter(t => t.entryTime <= t1),
    validation: ordered.filter(t => t.entryTime > t1 && t.entryTime <= t2),
    holdout: ordered.filter(t => t.entryTime > t2),
  };
}

function simulateExit(candles, entryIndex, side, {
  leverage,
  estimatedCostRoePct,
  activationNetRoePct,
  hardRealiseNetRoePct,
  stopNetRoePct,
  maxGivebackFraction,
  minGivebackPctPoints,
  maxHoldBars,
}) {
  const entry = Number(candles[entryIndex].o);
  let peakGross = -Infinity;
  let exitIndex = Math.min(candles.length - 1, entryIndex + maxHoldBars - 1);
  let exitPrice = Number(candles[exitIndex].c);
  let reason = "TIME_EXIT";

  const stopGross = stopNetRoePct + estimatedCostRoePct;
  const hardGross = hardRealiseNetRoePct + estimatedCostRoePct;
  const stopPrice = priceForGrossRoe(entry, stopGross, side, leverage);
  const hardPrice = priceForGrossRoe(entry, hardGross, side, leverage);

  for (let j = entryIndex; j <= exitIndex; j++) {
    const b = candles[j];
    const favorablePrice = side === "LONG" ? Number(b.h) : Number(b.l);
    const adversePrice = side === "LONG" ? Number(b.l) : Number(b.h);

    const previousPeakGross = peakGross;
    const previousPeakNet = previousPeakGross - estimatedCostRoePct;

    let trailingPrice = null;
    if (Number.isFinite(previousPeakNet) && previousPeakNet >= activationNetRoePct) {
      const giveback = Math.max(
        minGivebackPctPoints,
        previousPeakNet * maxGivebackFraction,
      );
      const trailingNet = previousPeakNet - giveback;
      const trailingGross = trailingNet + estimatedCostRoePct;
      trailingPrice = priceForGrossRoe(entry, trailingGross, side, leverage);
    }

    const stopTouched = side === "LONG"
      ? adversePrice <= stopPrice
      : adversePrice >= stopPrice;
    const hardTouched = side === "LONG"
      ? favorablePrice >= hardPrice
      : favorablePrice <= hardPrice;
    const trailingTouched = trailingPrice == null
      ? false
      : side === "LONG"
        ? adversePrice <= trailingPrice
        : adversePrice >= trailingPrice;

    // Conservative OHLC ordering: if conflicting levels are touched in one bar,
    // use the less favorable exit.
    if (stopTouched) {
      exitIndex = j;
      exitPrice = stopPrice;
      reason = "STOP";
      break;
    }
    if (trailingTouched) {
      exitIndex = j;
      exitPrice = trailingPrice;
      reason = "TRAILING_PROFIT";
      break;
    }
    if (hardTouched) {
      exitIndex = j;
      exitPrice = hardPrice;
      reason = "HARD_PROFIT";
      break;
    }

    peakGross = Math.max(
      peakGross,
      grossRoePct(entry, favorablePrice, side, leverage),
    );
  }

  const gross = grossRoePct(entry, exitPrice, side, leverage);
  return {
    entryPrice: entry,
    exitPrice,
    exitIndex,
    grossRoePct: gross,
    netRoePct: gross - estimatedCostRoePct,
    exitReason: reason,
  };
}

export function replayScalpSetup({
  candles1m,
  candles5m,
  setupId,
  leverage = 5,
  feePctPerSide = 0.04,
  slippagePctPerSide = 0.02,
  activationNetRoePct = 1.0,
  hardRealiseNetRoePct = 5.0,
  stopNetRoePct = -2.5,
  maxGivebackFraction = 0.35,
  minGivebackPctPoints = 0.35,
  maxHoldBars = 12,
  requireContextAlignment = true,
}) {
  if (!SCALP_SETUPS.includes(setupId)) {
    throw new Error(`Unknown scalp setup: ${setupId}`);
  }

  const estimatedCostRoePct = estimateRoundTripCostRoePct({
    leverage,
    feePctPerSide,
    slippagePctPerSide,
  });

  const trades = [];
  let nextFreeIndex = 0;
  let p5 = 0;
  const closed5m = [];

  for (let i = 40; i < candles1m.length - 1; i++) {
    if (i < nextFreeIndex) continue;
    const signalCloseTime = Number(candles1m[i].t) + 60_000;

    while (
      p5 < candles5m.length &&
      Number(candles5m[p5].t) + 300_000 <= signalCloseTime
    ) {
      closed5m.push(candles5m[p5]);
      p5++;
    }

    const signals = detectScalpSetups(candles1m, i, closed5m, {
      requireContextAlignment,
    });
    const signal = signals.find(x => x.setup === setupId && x.eligible);
    if (!signal) continue;

    const entryIndex = i + 1;
    const sim = simulateExit(candles1m, entryIndex, signal.direction, {
      leverage,
      estimatedCostRoePct,
      activationNetRoePct,
      hardRealiseNetRoePct,
      stopNetRoePct,
      maxGivebackFraction,
      minGivebackPctPoints,
      maxHoldBars,
    });

    trades.push({
      setup: setupId,
      side: signal.direction,
      contextBias: signal.contextBias,
      reversal: signal.reversal,
      signalTime: signal.signalTime,
      entryTime: Number(candles1m[entryIndex].t),
      exitTime: Number(candles1m[sim.exitIndex].t),
      ...sim,
    });
    nextFreeIndex = sim.exitIndex + 1;
  }

  const split = splitByTime(trades);
  const train = summarize(split.train);
  const validation = summarize(split.validation);
  const holdout = summarize(split.holdout);
  const all = summarize(trades);

  const candidate = classifyScalpCandidate({
    trades: all.trades,
    netExpectancyPct: all.netExpectancyPct,
    validationPF: validation.profitFactor,
    holdoutPF: holdout.profitFactor,
    holdoutNetPct: holdout.netPct,
    maxDrawdownPct: all.maxDrawdownPct,
    stressedCostPositive: holdout.netPct > 0 && holdout.profitFactor >= 1.05,
    robustnessPassRate: [train, validation, holdout]
      .filter(x => x.netPct > 0 && x.profitFactor > 1).length / 3,
  });

  return {
    setupId,
    config: {
      leverage,
      feePctPerSide,
      slippagePctPerSide,
      estimatedCostRoePct,
      activationNetRoePct,
      hardRealiseNetRoePct,
      stopNetRoePct,
      maxGivebackFraction,
      minGivebackPctPoints,
      maxHoldBars,
      requireContextAlignment,
    },
    all,
    train,
    validation,
    holdout,
    candidate,
    trades,
  };
}

export function replayScalpSuite(args) {
  return SCALP_SETUPS.map(setupId => replayScalpSetup({ ...args, setupId }));
}
