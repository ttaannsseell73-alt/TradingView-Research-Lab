import { BinanceUsdmAdapter } from '../live/BinanceUsdmAdapter';
import { QShadowRuntime } from '../live/QShadowRuntime';
import { RateLimitGovernor } from '../live/CanonicalLive';

async function tryBase(baseUrl: string) {
  const governor = new RateLimitGovernor();
  const adapter = new BinanceUsdmAdapter({ baseUrl, mode: 'SHADOW', governor });
  const runtime = new QShadowRuntime(adapter, governor);
  return runtime.runOnce();
}

async function main() {
  const configured = process.env.BINANCE_PUBLIC_FUTURES_URL?.trim();
  const bases = configured
    ? [configured]
    : [
        'https://fapi.binance.com',
        'https://fapi1.binance.com',
        'https://fapi2.binance.com',
        'https://fapi3.binance.com',
        'https://fapi4.binance.com',
      ];

  const failures: string[] = [];
  for (const base of bases) {
    try {
      const report = await tryBase(base);
      QShadowRuntime.writeReport(report);
      console.log(JSON.stringify({ baseUrl: base, ...report }, null, 2));
      return;
    } catch (error: any) {
      failures.push(base + ': ' + String(error?.message ?? error));
    }
  }
  throw new Error('All Binance public Futures hosts failed: ' + failures.join(' | '));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
