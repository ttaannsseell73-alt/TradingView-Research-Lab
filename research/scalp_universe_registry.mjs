import { SCALP_SETUPS } from "./scalp_signal_engine.mjs";
import { STRATEGIES } from "./strategy_engine_v2.mjs";

export const EXECUTABLE_SCALP_SYSTEMS = [
  ...SCALP_SETUPS.map(id => ({
    id,
    sourceType: "PA_NATIVE",
    runtime: "scalp_replay",
    status: "EXECUTABLE",
  })),
  ...STRATEGIES.map(s => ({
    id: s.id,
    name: s.name,
    family: s.family,
    sourceType: "TV_KIVANC_ADAPTER",
    runtime: "strategy_engine_v2",
    status: "EXECUTABLE",
  })),
];

export const DISCOVERED_SYSTEMS = [
  ...EXECUTABLE_SCALP_SYSTEMS,
  { id: "hftbacktest", sourceType: "EXECUTION_FRAMEWORK", status: "POST_EDGE_VALIDATION", note: "Tick/latency/queue execution validation; not a signal strategy." },
  { id: "freqtrade", sourceType: "CONTROL_FRAMEWORK", status: "REFERENCE_ONLY", note: "Backtest/dry-run control harness; not a unique signal strategy." },
  { id: "360_crypto_eye", sourceType: "EXTERNAL_BOT", status: "PENDING_RULE_ADAPTER" },
  { id: "jodi96_trader", sourceType: "ORDERFLOW_FEATURE_SOURCE", status: "PENDING_FEATURE_ADAPTER" },
  { id: "scalp_py", sourceType: "EXTERNAL_SCALP_STRATEGY", status: "PENDING_RULE_ADAPTER" },
  { id: "scalping_simple", sourceType: "EXTERNAL_SCALP_STRATEGY", status: "PENDING_RULE_ADAPTER" },
  { id: "ultra_fast", sourceType: "EXTERNAL_SCALP_STRATEGY", status: "PENDING_RULE_ADAPTER" },
  { id: "tradingview_scalp_signal_bot", sourceType: "TRADINGVIEW_STRATEGY", status: "PENDING_RULE_ADAPTER" },
  { id: "elaris_fast_scalp_pro", sourceType: "TRADINGVIEW_STRATEGY", status: "PENDING_RULE_ADAPTER" },
  { id: "liquidity_sweep_sniper", sourceType: "TRADINGVIEW_STRATEGY", status: "MAPPED_TO_NATIVE_SWEEP", mappedTo: "liquidity_sweep_reclaim" },
  { id: "nautilus_l2", sourceType: "EXECUTION_FRAMEWORK", status: "POST_EDGE_VALIDATION" },
  { id: "diffquant", sourceType: "ML_CHALLENGER", status: "PENDING_MODEL_ADAPTER" },
  { id: "d3qn_binance_futures", sourceType: "RL_CHALLENGER", status: "PENDING_MODEL_ADAPTER" },
  { id: "tlob_orderflow", sourceType: "ORDERBOOK_MODEL", status: "PENDING_MODEL_ADAPTER" },
  { id: "kronos", sourceType: "ML_CHALLENGER", status: "PENDING_MODEL_ADAPTER" },
  { id: "lightgbm_ev", sourceType: "QUANT_FILTER", status: "PENDING_MODEL_ADAPTER" },
  { id: "legacy_execution_pass_scalp_pool", sourceType: "LEGACY_EVIDENCE_POOL", status: "PENDING_EVIDENCE_IMPORT", note: "Previously identified PASS scalp setups require exact strategy IDs before they can truthfully be marked rescanned." },
];

export function executableSystemIds() {
  return EXECUTABLE_SCALP_SYSTEMS.map(x => x.id);
}
