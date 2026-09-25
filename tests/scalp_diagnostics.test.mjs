import test from "node:test";
import assert from "node:assert/strict";

import { summarizeScalpTrades } from "../research/scalp_replay.mjs";
import {
  SCALP_COST_PROFILES,
  SCALP_EXIT_PROFILES,
} from "../research/scalp_diagnostics.mjs";

test("scalp summary exposes gross edge, MFE, MAE and holding duration", () => {
  const s = summarizeScalpTrades([
    { netRoePct: 0.4, grossRoePct: 1.0, mfeGrossRoePct: 1.8, maeGrossRoePct: -0.5, holdingBars: 3 },
    { netRoePct: -0.8, grossRoePct: -0.2, mfeGrossRoePct: 0.7, maeGrossRoePct: -1.3, holdingBars: 5 },
  ]);

  assert.equal(s.trades, 2);
  assert.ok(Math.abs(s.netExpectancyPct + 0.2) < 1e-12);
  assert.ok(Math.abs(s.grossExpectancyPct - 0.4) < 1e-12);
  assert.equal(s.avgMfeGrossRoePct, 1.25);
  assert.equal(s.avgMaeGrossRoePct, -0.9);
  assert.equal(s.avgHoldingBars, 4);
});

test("diagnostic matrix profiles remain explicit and bounded", () => {
  assert.deepEqual(SCALP_COST_PROFILES.map(x => x.id), ["lean", "base", "stress"]);
  assert.deepEqual(SCALP_EXIT_PROFILES.map(x => x.id), ["fast", "balanced", "wide_v1"]);
});
