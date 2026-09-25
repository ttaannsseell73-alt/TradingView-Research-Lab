import {
  replayScalpSetup,
  summarizeScalpTrades,
} from "./scalp_replay.mjs";
import { SCALP_SETUPS } from "./scalp_signal_engine.mjs";

export const SCALP_COST_PROFILES = [
  {
    id: "lean",
    feePctPerSide: 0.02,
    slippagePctPerSide: 0.01,
    note: "Research-only lean execution assumption; not an exchange fee claim.",
  },
  {
    id: "base",
    feePctPerSide: 0.04,
    slippagePctPerSide: 0.02,
    note: "Canonical v1 research assumption.",
  },
  {
    id: "stress",
    feePctPerSide: 0.05,
    slippagePctPerSide: 0.04,
    note: "Adverse execution stress assumption.",
  },
];

export const SCALP_EXIT_PROFILES = [
  {
    id: "fast",
    activationNetRoePct: 0.4,
    hardRealiseNetRoePct: 1.5,
    stopNetRoePct: -1.2,
    maxGivebackFraction: 0.30,
    minGivebackPctPoints: 0.20,
    maxHoldBars: 5,
  },
  {
    id: "balanced",
    activationNetRoePct: 0.6,
    hardRealiseNetRoePct: 2.5,
    stopNetRoePct: -1.6,
    maxGivebackFraction: 0.33,
    minGivebackPctPoints: 0.25,
    maxHoldBars: 8,
  },
  {
    id: "wide_v1",
    activationNetRoePct: 1.0,
    hardRealiseNetRoePct: 5.0,
    stopNetRoePct: -2.5,
    maxGivebackFraction: 0.35,
    minGivebackPctPoints: 0.35,
    maxHoldBars: 12,
  },
];

function sideStats(trades) {
  return {
    LONG: summarizeScalpTrades(trades.filter(t => t.side === "LONG")),
    SHORT: summarizeScalpTrades(trades.filter(t => t.side === "SHORT")),
  };
}

function eventStats(trades) {
  const bos = trades.filter(t => t.eventType === "BOS");
  const choch = trades.filter(t => t.eventType === "CHOCH");
  return {
    BOS: summarizeScalpTrades(bos),
    CHOCH: summarizeScalpTrades(choch),
  };
}

function alignmentStats(trades) {
  return {
    aligned: summarizeScalpTrades(trades.filter(t => t.contextAligned === true)),
    reversal: summarizeScalpTrades(trades.filter(t => t.reversal === true)),
    other: summarizeScalpTrades(
      trades.filter(t => t.contextAligned !== true && t.reversal !== true),
    ),
  };
}

export function buildScalpDiagnosticMatrix({
  candles1m,
  candles5m,
  leverage = 5,
  setupIds = SCALP_SETUPS,
  requireContextAlignment = true,
} = {}) {
  const rows = [];

  for (const setupId of setupIds) {
    for (const cost of SCALP_COST_PROFILES) {
      for (const exit of SCALP_EXIT_PROFILES) {
        const result = replayScalpSetup({
          candles1m,
          candles5m,
          setupId,
          leverage,
          feePctPerSide: cost.feePctPerSide,
          slippagePctPerSide: cost.slippagePctPerSide,
          requireContextAlignment,
          ...exit,
        });

        rows.push({
          setupId,
          costProfile: cost.id,
          exitProfile: exit.id,
          config: result.config,
          all: result.all,
          train: result.train,
          validation: result.validation,
          holdout: result.holdout,
          side: sideStats(result.trades),
          eventType: setupId === "bos_choch" ? eventStats(result.trades) : null,
          alignment: alignmentStats(result.trades),
          diagnosticFlags: [
            result.all.grossExpectancyPct > 0 ? "GROSS_EDGE_POSITIVE" : "GROSS_EDGE_NEGATIVE",
            result.all.netExpectancyPct > 0 ? "NET_EDGE_POSITIVE" : "NET_EDGE_NEGATIVE",
            result.holdout.netPct > 0 ? "HOLDOUT_POSITIVE" : "HOLDOUT_NEGATIVE",
            result.all.avgMfeGrossRoePct > 0 ? "HAS_FAVORABLE_EXCURSION" : "NO_FAVORABLE_EXCURSION",
          ],
        });
      }
    }
  }

  const diagnosticRanking = [...rows]
    .sort((a, b) =>
      Number(b.holdout.netPct) - Number(a.holdout.netPct) ||
      Number(b.validation.netPct) - Number(a.validation.netPct) ||
      Number(b.all.grossExpectancyPct) - Number(a.all.grossExpectancyPct)
    )
    .map((r, i) => ({
      rank: i + 1,
      setupId: r.setupId,
      costProfile: r.costProfile,
      exitProfile: r.exitProfile,
      trades: r.all.trades,
      grossExpectancyPct: r.all.grossExpectancyPct,
      netExpectancyPct: r.all.netExpectancyPct,
      avgMfeGrossRoePct: r.all.avgMfeGrossRoePct,
      avgMaeGrossRoePct: r.all.avgMaeGrossRoePct,
      avgHoldingBars: r.all.avgHoldingBars,
      validationNetPct: r.validation.netPct,
      validationPF: r.validation.profitFactor,
      holdoutNetPct: r.holdout.netPct,
      holdoutPF: r.holdout.profitFactor,
      flags: r.diagnosticFlags,
    }));

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    semantics: {
      purpose: "diagnostic matrix only; never auto-promote the best row",
      grossEdge: "exit gross ROE before estimated round-trip fee/slippage",
      mfe: "maximum favorable gross ROE excursion observed before exit",
      mae: "maximum adverse gross ROE excursion observed before exit",
      subgrouping: "LONG/SHORT and BOS/CHOCH are reported separately to expose asymmetric edge",
    },
    costProfiles: SCALP_COST_PROFILES,
    exitProfiles: SCALP_EXIT_PROFILES,
    rows,
    diagnosticRanking,
  };
}
