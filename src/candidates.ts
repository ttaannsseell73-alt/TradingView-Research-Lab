export type CandidateDisposition = 'MAPPED' | 'REFERENCE_ONLY' | 'EXCLUDED';

export interface ResearchCandidate {
  name: string;
  author: string;
  sourceUrl: string;
  disposition: CandidateDisposition;
  reason: string;
  canonicalFeatures: string[];
}

export const KIVANC_CANDIDATES: readonly ResearchCandidate[] = [
  {
    name: 'Squeeze Momentum Indicator Version2',
    author: 'KivancOzbilgic / LazyBear lineage',
    sourceUrl: 'https://www.tradingview.com/script/NVzKGYFJ/',
    disposition: 'MAPPED',
    reason: 'Compression/release concept is useful; implementation remains original and price-action-first.',
    canonicalFeatures: ['CompressionDepth', 'CompressionDuration', 'ExpansionVelocity'],
  },
  {
    name: 'HIGH and LOW Optimized Trend Tracker (HOTT/LOTT)',
    author: 'KivancOzbilgic / Anil Ozeksi lineage',
    sourceUrl: 'https://www.tradingview.com/scripts/kivancozbilgic/',
    disposition: 'MAPPED',
    reason: 'Flat-zone and high/low boundary ideas map cleanly to range boundaries and breakout displacement.',
    canonicalFeatures: ['RangeBoundary', 'BreakoutDisplacement', 'BOSStrength'],
  },
  {
    name: 'AlphaTrend',
    author: 'KivancOzbilgic',
    sourceUrl: 'https://www.tradingview.com/script/o50NYLAZ-AlphaTrend/',
    disposition: 'MAPPED',
    reason: 'Trend/range dead-zone and dynamic support-resistance ideas are retained without importing CCI/MFI/ATR signal logic.',
    canonicalFeatures: ['TrendRangeScore', 'RangeBoundary', 'RetestQuality'],
  },
  {
    name: 'Optimized Trend Tracker (OTT)',
    author: 'KivancOzbilgic / Anil Ozeksi lineage',
    sourceUrl: 'https://www.tradingview.com/script/zVhoDQME/',
    disposition: 'REFERENCE_ONLY',
    reason: 'Useful benchmark for trend state, but moving-average tracker logic is not promoted into the price-action core.',
    canonicalFeatures: ['TrendRangeScore'],
  },
  {
    name: 'Follow Line',
    author: 'KivancOzbilgic',
    sourceUrl: 'https://www.tradingview.com/scripts/kivancozbilgic/',
    disposition: 'REFERENCE_ONLY',
    reason: 'Volatility-aware trailing behavior is relevant to future risk/exit research, not the canonical entry feature set.',
    canonicalFeatures: [],
  },
  {
    name: 'ST0P',
    author: 'KivancOzbilgic',
    sourceUrl: 'https://www.tradingview.com/script/DhvZsTJQ/',
    disposition: 'REFERENCE_ONLY',
    reason: 'Trailing-stop concept belongs to risk/execution research and is deliberately separated from signal generation.',
    canonicalFeatures: [],
  },
  {
    name: 'TKE Indicator',
    author: 'KivancOzbilgic / Yasar Erdinc lineage',
    sourceUrl: 'https://www.tradingview.com/script/Pcbvo0zG/',
    disposition: 'EXCLUDED',
    reason: 'Composite classical oscillator stack conflicts with the locked price-action-first policy.',
    canonicalFeatures: [],
  },
  {
    name: 'MACD ReLoaded',
    author: 'KivancOzbilgic',
    sourceUrl: 'https://www.tradingview.com/scripts/kivancozbilgic/',
    disposition: 'EXCLUDED',
    reason: 'MACD-family signal logic is intentionally outside the canonical decision core.',
    canonicalFeatures: [],
  },
  {
    name: 'MavilimW',
    author: 'KivancOzbilgic',
    sourceUrl: 'https://www.tradingview.com/script/IAssyObN-MavilimW/',
    disposition: 'EXCLUDED',
    reason: 'Long-term smoothed moving-average support/resistance is not aligned with the short-horizon price-action research lane.',
    canonicalFeatures: [],
  },
] as const;
