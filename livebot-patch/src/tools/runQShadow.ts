import { BinanceUsdmAdapter } from '../live/BinanceUsdmAdapter';
import { QShadowRuntime } from '../live/QShadowRuntime';

async function main() {
  const adapter = new BinanceUsdmAdapter({
    baseUrl: process.env.BINANCE_PUBLIC_FUTURES_URL ?? 'https://fapi.binance.com',
    mode: 'SHADOW',
  });
  const runtime = new QShadowRuntime(adapter);
  const report = await runtime.runOnce();
  QShadowRuntime.writeReport(report);
  console.log(JSON.stringify(report, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
