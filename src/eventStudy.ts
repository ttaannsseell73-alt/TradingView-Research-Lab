import type {
  Candle,
  EventOutcome,
  EventStudyConfig,
  SetupEvent,
  SetupKind,
  SetupStats,
  StudyWindow,
} from './types.js';

const DEFAULT_CONFIG: EventStudyConfig = {
  horizonBars: 12,
  feeRate: 0.0004,
  slippageRate: 0.0001,
};

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function signedReturn(entry: number, price: number, direction: 1 | -1): number {
  return direction * (price - entry) / entry;
}

export function evaluateEvents(
  candles: Candle[],
  events: SetupEvent[],
  config: Partial<EventStudyConfig> = {},
  window?: StudyWindow,
): EventOutcome[] {
  const settings = { ...DEFAULT_CONFIG, ...config };
  if (!Number.isInteger(settings.horizonBars) || settings.horizonBars < 1) throw new Error('horizonBars must be >= 1');
  if (settings.feeRate < 0 || settings.slippageRate < 0) throw new Error('cost rates must be non-negative');
  const start = window?.startIndex ?? 0;
  const end = window?.endIndexExclusive ?? candles.length;
  const roundTripCost = 2 * (settings.feeRate + settings.slippageRate);
  const outcomes: EventOutcome[] = [];

  for (const event of events) {
    const exitIndex = event.index + settings.horizonBars;
    if (event.index < start || event.index >= end || exitIndex >= end || exitIndex >= candles.length) continue;
    const entryCandle = candles[event.index];
    const exitCandle = candles[exitIndex];
    if (!entryCandle || !exitCandle || entryCandle.close <= 0) continue;

    const path = candles.slice(event.index + 1, exitIndex + 1);
    const pathReturns = path.flatMap((candle) => [
      signedReturn(entryCandle.close, candle.high, event.direction),
      signedReturn(entryCandle.close, candle.low, event.direction),
    ]);
    const grossReturn = signedReturn(entryCandle.close, exitCandle.close, event.direction);
    outcomes.push({
      ...event,
      entryPrice: entryCandle.close,
      exitPrice: exitCandle.close,
      grossReturn,
      netReturn: grossReturn - roundTripCost,
      mae: pathReturns.length ? Math.min(...pathReturns) : 0,
      mfe: pathReturns.length ? Math.max(...pathReturns) : 0,
    });
  }
  return outcomes;
}

export function summarizeOutcomes(outcomes: EventOutcome[], setup: SetupKind): SetupStats {
  const selected = outcomes.filter((outcome) => outcome.kind === setup);
  const winners = selected.filter((outcome) => outcome.netReturn > 0).map((outcome) => outcome.netReturn);
  const losers = selected.filter((outcome) => outcome.netReturn <= 0).map((outcome) => outcome.netReturn);
  const grossExpectancy = mean(selected.map((outcome) => outcome.grossReturn));
  return {
    setup,
    sampleCount: selected.length,
    hitRate: selected.length ? winners.length / selected.length : 0,
    grossExpectancy,
    expectancy: mean(selected.map((outcome) => outcome.netReturn)),
    breakEvenRoundTripCost: Math.max(0, grossExpectancy),
    averageWin: mean(winners),
    averageLoss: mean(losers),
    averageMae: mean(selected.map((outcome) => outcome.mae)),
    averageMfe: mean(selected.map((outcome) => outcome.mfe)),
  };
}

export function summarizeAll(outcomes: EventOutcome[]): SetupStats[] {
  return (['breakout', 'liquidity_sweep_reclaim', 'compression_release'] as const).map((setup) =>
    summarizeOutcomes(outcomes, setup),
  );
}
