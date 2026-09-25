import test from "node:test";
import assert from "node:assert/strict";

import {
  classifyScalpCandidate,
  computeGrossRoePct,
  decideProfitExit,
  estimateRoundTripCostRoePct,
} from "../research/scalp_gate.mjs";

test("5x leverage turns a 0.20% long price move into about 1% gross ROE", () => {
  const roe = computeGrossRoePct({
    entryPrice: 100,
    currentPrice: 100.2,
    side: "LONG",
    leverage: 5,
  });

  assert.ok(Math.abs(roe - 1) < 1e-9);
});

test("round-trip fee and slippage are charged against leveraged ROE", () => {
  const cost = estimateRoundTripCostRoePct({
    leverage: 5,
    feePctPerSide: 0.04,
    slippagePctPerSide: 0.02,
  });

  assert.equal(cost, 0.6);
});

test("hard profit threshold realises immediately", () => {
  const result = decideProfitExit({
    grossRoePct: 5.8,
    peakGrossRoePct: 5.8,
    estimatedCostRoePct: 0.6,
  });

  assert.equal(result.action, "REALISE");
  assert.equal(result.reason, "HARD_PROFIT_TARGET");
});

test("profit giveback realises after lock is active", () => {
  const result = decideProfitExit({
    grossRoePct: 1.8,
    peakGrossRoePct: 3.0,
    estimatedCostRoePct: 0.6,
  });

  assert.equal(result.action, "REALISE");
  assert.equal(result.reason, "TRAILING_PROFIT_GIVEBACK");
});

test("candidate with negative holdout evidence is rejected", () => {
  const result = classifyScalpCandidate({
    trades: 200,
    netExpectancyPct: 0.08,
    validationPF: 1.4,
    holdoutPF: 0.95,
    holdoutNetPct: -1.2,
    maxDrawdownPct: 6,
    stressedCostPositive: true,
    robustnessPassRate: 0.8,
  });

  assert.equal(result.status, "REJECT");
  assert.ok(result.reasons.includes("WEAK_HOLDOUT_PF"));
  assert.ok(result.reasons.includes("NON_POSITIVE_HOLDOUT"));
});

test("robust candidate passes after hard gates", () => {
  const result = classifyScalpCandidate({
    trades: 220,
    netExpectancyPct: 0.11,
    validationPF: 1.42,
    holdoutPF: 1.31,
    holdoutNetPct: 7.8,
    maxDrawdownPct: 5.5,
    stressedCostPositive: true,
    robustnessPassRate: 0.84,
  });

  assert.equal(result.status, "PASS");
  assert.ok(result.score > 0);
});

test("thin but otherwise good evidence is held for review", () => {
  const result = classifyScalpCandidate({
    trades: 55,
    netExpectancyPct: 0.12,
    validationPF: 1.5,
    holdoutPF: 1.4,
    holdoutNetPct: 4.1,
    maxDrawdownPct: 4,
    stressedCostPositive: true,
    robustnessPassRate: 0.9,
  });

  assert.equal(result.status, "EVIDENCE_REVIEW");
});
