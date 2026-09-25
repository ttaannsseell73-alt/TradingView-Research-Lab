import { STRATEGIES } from "./strategy_engine_v2.mjs";
import { structuralBias5m } from "./scalp_signal_engine.mjs";
import { summarizeScalpTrades } from "./scalp_replay.mjs";
import { classifyScalpCandidate, estimateRoundTripCostRoePct } from "./scalp_gate.mjs";

function grossRoePct(entry, price, side, leverage) {
  const raw = side === "LONG" ? (price - entry) / entry : (entry - price) / entry;
  return raw * leverage * 100;
}

function priceForGrossRoe(entry, roe, side, leverage) {
  const move = roe / (100 * leverage);
  return side === "LONG" ? entry * (1 + move) : entry * (1 - move);
}

function simulateExit(candles, entryIndex, side, cfg) {
  const entry = Number(candles[entryIndex].o);
  let peakGross = -Infinity;
  let mfe = -Infinity;
  let mae = Infinity;
  let exitIndex = Math.min(candles.length - 1, entryIndex + cfg.maxHoldBars - 1);
  let exitPrice = Number(candles[exitIndex].c);
  let exitReason = "TIME_EXIT";
  const stopGross = cfg.stopNetRoePct + cfg.estimatedCostRoePct;
  const hardGross = cfg.hardRealiseNetRoePct + cfg.estimatedCostRoePct;
  const stopPrice = priceForGrossRoe(entry, stopGross, side, cfg.leverage);
  const hardPrice = priceForGrossRoe(entry, hardGross, side, cfg.leverage);

  for (let j = entryIndex; j <= exitIndex; j++) {
    const b = candles[j];
    const favorablePrice = side === "LONG" ? Number(b.h) : Number(b.l);
    const adversePrice = side === "LONG" ? Number(b.l) : Number(b.h);
    const favorableGross = grossRoePct(entry, favorablePrice, side, cfg.leverage);
    const adverseGross = grossRoePct(entry, adversePrice, side, cfg.leverage);
    mfe = Math.max(mfe, favorableGross);
    mae = Math.min(mae, adverseGross);

    const prevPeakNet = peakGross - cfg.estimatedCostRoePct;
    let trailingPrice = null;
    if (Number.isFinite(prevPeakNet) && prevPeakNet >= cfg.activationNetRoePct) {
      const giveback = Math.max(cfg.minGivebackPctPoints, prevPeakNet * cfg.maxGivebackFraction);
      trailingPrice = priceForGrossRoe(
        entry,
        prevPeakNet - giveback + cfg.estimatedCostRoePct,
        side,
        cfg.leverage,
      );
    }

    const stopTouched = side === "LONG" ? adversePrice <= stopPrice : adversePrice >= stopPrice;
    const hardTouched = side === "LONG" ? favorablePrice >= hardPrice : favorablePrice <= hardPrice;
    const trailTouched = trailingPrice == null
      ? false
      : side === "LONG" ? adversePrice <= trailingPrice : adversePrice >= trailingPrice;

    if (stopTouched) {
      exitIndex = j;
      exitPrice = stopPrice;
      exitReason = "STOP";
      break;
    }
    if (trailTouched) {
      exitIndex = j;
      exitPrice = trailingPrice;
      exitReason = "TRAILING_PROFIT";
      break;
    }
    if (hardTouched) {
      exitIndex = j;
      exitPrice = hardPrice;
      exitReason = "HARD_PROFIT";
      break;
    }
    peakGross = Math.max(peakGross, favorableGross);
  }

  const gross = grossRoePct(entry, exitPrice, side, cfg.leverage);
  return {
    entryPrice: entry,
    exitPrice,
    exitIndex,
    grossRoePct: gross,
    netRoePct: gross - cfg.estimatedCostRoePct,
    mfeGrossRoePct: Number.isFinite(mfe) ? mfe : gross,
    maeGrossRoePct: Number.isFinite(mae) ? mae : gross,
    holdingBars: exitIndex - entryIndex + 1,
    exitReason,
  };
}

export function splitScalpTrades(trades) {
  if (!trades.length) return { train: [], validation: [], holdout: [] };
  const ordered = [...trades].sort((a, b) => a.entryTime - b.entryTime);
  const start = ordered[0].entryTime;
  const end = Math.max(start + 1, ordered.at(-1).entryTime);
  const width = end - start;
  const t1 = start + width * 0.60;
  const t2 = start + width * 0.80;
  return {
    train: ordered.filter(t => t.entryTime <= t1),
    validation: ordered.filter(t => t.entryTime > t1 && t.entryTime <= t2),
    holdout: ordered.filter(t => t.entryTime > t2),
  };
}

export function summarizeCandidateTrades(trades) {
  const split = splitScalpTrades(trades);
  const all = summarizeScalpTrades(trades);
  const train = summarizeScalpTrades(split.train);
  const validation = summarizeScalpTrades(split.validation);
  const holdout = summarizeScalpTrades(split.holdout);
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
  return { all, train, validation, holdout, candidate };
}

export function replayStrategyAsScalp({
  candles1m,
  candles5m,
  strategyId,
  leverage = 5,
  feePctPerSide = 0.04,
  slippagePctPerSide = 0.02,
  activationNetRoePct = 0.6,
  hardRealiseNetRoePct = 2.5,
  stopNetRoePct = -1.6,
  maxGivebackFraction = 0.33,
  minGivebackPctPoints = 0.25,
  maxHoldBars = 8,
  requireContextAlignment = true,
}) {
  const strategy = STRATEGIES.find(s => s.id === strategyId);
  if (!strategy) throw new Error("Unknown strategy adapter: " + strategyId);
  const raw = strategy.signal(candles1m);
  const estimatedCostRoePct = estimateRoundTripCostRoePct({
    leverage,
    feePctPerSide,
    slippagePctPerSide,
  });
  const cfg = {
    leverage,
    estimatedCostRoePct,
    activationNetRoePct,
    hardRealiseNetRoePct,
    stopNetRoePct,
    maxGivebackFraction,
    minGivebackPctPoints,
    maxHoldBars,
  };

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
      p5 += 1;
    }

    let direction = null;
    if ((strategy.mode ?? "REVERSAL") === "TARGET_POSITION") {
      const prev = [-1, 0, 1].includes(raw[i - 1]) ? raw[i - 1] : 0;
      const cur = [-1, 0, 1].includes(raw[i]) ? raw[i] : 0;
      if (cur !== prev && cur !== 0) direction = cur > 0 ? "LONG" : "SHORT";
    } else if (raw[i] === 1 || raw[i] === -1) {
      direction = raw[i] > 0 ? "LONG" : "SHORT";
    }
    if (!direction) continue;

    const contextBias = structuralBias5m(closed5m);
    const contextAligned = contextBias === "NEUTRAL" || contextBias === direction;
    if (requireContextAlignment && !contextAligned) continue;

    const entryIndex = i + 1;
    const sim = simulateExit(candles1m, entryIndex, direction, cfg);
    trades.push({
      setup: strategy.id,
      side: direction,
      contextBias,
      contextAligned,
      reversal: false,
      signalTime: Number(candles1m[i].t),
      entryTime: Number(candles1m[entryIndex].t),
      exitTime: Number(candles1m[sim.exitIndex].t),
      ...sim,
    });
    nextFreeIndex = sim.exitIndex + 1;
  }

  return {
    strategyId,
    sourceType: "TV_KIVANC_ADAPTER",
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
    ...summarizeCandidateTrades(trades),
    trades,
  };
}
