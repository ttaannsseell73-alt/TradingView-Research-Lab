export const DEMO11_STRATEGY_METADATA = Object.freeze({
  sr25_trendline_breakout: Object.freeze({ warmup_bars: 100, convergence: 'ANCHORED', anchor: 'DATASET_START' }),
  sr25_fvg_first_touch: Object.freeze({ warmup_bars: 50, convergence: 'ANCHORED', anchor: 'DATASET_START' }),
  sr_liquidity_sweep: Object.freeze({ warmup_bars: 40, convergence: 'BOUNDED_WINDOW', anchor: null }),
  sr25_poc_mean_reversion: Object.freeze({ warmup_bars: 80, convergence: 'ANCHORED', anchor: 'UTC_SESSION' }),
  sr25_camarilla_h3_l3: Object.freeze({ warmup_bars: 80, convergence: 'ANCHORED', anchor: 'PREVIOUS_UTC_DAY' }),
  sr_range_edge: Object.freeze({ warmup_bars: 80, convergence: 'BOUNDED_WINDOW', anchor: null }),
  sr25_impulse_ob_retest: Object.freeze({ warmup_bars: 60, convergence: 'BOUNDED_WINDOW', anchor: null }),
});

export function strategyMetadata(strategyId){
  return DEMO11_STRATEGY_METADATA[strategyId] ?? Object.freeze({
    warmup_bars: 100,
    convergence: 'ANCHORED',
    anchor: 'DATASET_START',
  });
}
