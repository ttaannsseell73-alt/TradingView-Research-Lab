import test from "node:test";
import assert from "node:assert/strict";

import {
  EXECUTABLE_SCALP_SYSTEMS,
  DISCOVERED_SYSTEMS,
  executableSystemIds,
} from "../research/scalp_universe_registry.mjs";

test("scalp universe registry contains all currently executable native and adapter systems", () => {
  const ids = executableSystemIds();
  assert.equal(ids.length, 15);
  assert.equal(new Set(ids).size, ids.length);

  for (const id of [
    "liquidity_sweep_reclaim",
    "breakout_retest",
    "compression_expansion",
    "bos_choch",
    "pmax",
    "alphatrend",
    "ott",
    "tott",
    "mavilimw",
    "ssl_hybrid_flip",
    "ssl_hybrid_qqe_flip",
    "ut_bot_quantnomad",
    "chandelier_zlsma",
    "squeeze_momentum",
    "qqe_ssl_wae",
  ]) {
    assert.ok(ids.includes(id), id);
  }

  assert.ok(
    DISCOVERED_SYSTEMS.length > EXECUTABLE_SCALP_SYSTEMS.length,
  );
});
