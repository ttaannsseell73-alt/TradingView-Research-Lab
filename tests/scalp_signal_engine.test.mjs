import test from "node:test";
import assert from "node:assert/strict";

import {
  detectBreakoutRetest,
  detectCompressionExpansion,
  detectLiquiditySweepReclaim,
  structuralBias5m,
} from "../research/scalp_signal_engine.mjs";

function bar(i, {
  o = 100,
  h = 100.2,
  l = 99.8,
  c = 100,
  v = 100,
} = {}) {
  return { t: i * 60_000, o, h, l, c, v };
}

test("5m structural bias identifies upward range shift", () => {
  const older = Array.from({ length: 6 }, (_, i) => ({
    t: i * 300_000, o: 100, h: 101 + i * 0.02, l: 99 + i * 0.02, c: 100.5, v: 100,
  }));
  const recent = Array.from({ length: 6 }, (_, i) => ({
    t: (i + 6) * 300_000, o: 101, h: 102 + i * 0.02, l: 100 + i * 0.02, c: 101.5, v: 100,
  }));
  assert.equal(structuralBias5m([...older, ...recent]), "LONG");
});

test("liquidity sweep reclaim detects lower sweep and close back above level", () => {
  const c = Array.from({ length: 25 }, (_, i) => bar(i));
  c[24] = bar(24, { o: 99.95, h: 100.1, l: 99.35, c: 99.92, v: 140 });
  const sig = detectLiquiditySweepReclaim(c, 24, { volumeMultiplier: 1.0 });
  assert.equal(sig?.direction, "LONG");
  assert.equal(sig?.setup, "liquidity_sweep_reclaim");
});

test("breakout retest requires breakout then reclaim of the broken level", () => {
  const c = Array.from({ length: 30 }, (_, i) => bar(i, { h: 100.2, l: 99.8, c: 100 }));
  c[28] = bar(28, { o: 100.1, h: 100.8, l: 100.0, c: 100.7, v: 140 });
  c[29] = bar(29, { o: 100.25, h: 100.75, l: 100.15, c: 100.6, v: 130 });
  const sig = detectBreakoutRetest(c, 29);
  assert.equal(sig?.direction, "LONG");
  assert.equal(sig?.setup, "breakout_retest");
});

test("compression expansion detects break from a tight box", () => {
  const c = [];
  for (let i = 0; i < 24; i++) c.push(bar(i, { h: 101, l: 99, c: 100 }));
  for (let i = 24; i < 32; i++) c.push(bar(i, { h: 100.2, l: 99.8, c: 100 }));
  c.push(bar(32, { o: 100, h: 101.2, l: 99.95, c: 101.0, v: 180 }));
  const sig = detectCompressionExpansion(c, 32);
  assert.equal(sig?.direction, "LONG");
  assert.equal(sig?.setup, "compression_expansion");
});
