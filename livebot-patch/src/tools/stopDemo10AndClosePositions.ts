import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { RateLimitGovernor } from '../live/CanonicalLive';
import { BinanceUsdmAdapter } from '../live/BinanceUsdmAdapter';

dotenv.config();

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function safeId(symbol: string, suffix: string): string {
  const raw = `d10stop-${symbol}-${Date.now()}-${suffix}`;
  return raw.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 36);
}

async function main(): Promise<void> {
  const testnetUrl = process.env.BINANCE_FUTURES_URL?.trim() ?? '';
  const apiKey = process.env.BINANCE_API_KEY?.trim() ?? '';
  const apiSecret = process.env.BINANCE_API_SECRET?.trim() ?? '';
  const cohortPath = process.env.DEMO10_COHORT_PATH?.trim() ?? 'research/demo_cohort_10.json';

  if (!apiKey || !apiSecret) throw new Error('DEMO10_TESTNET_CREDENTIALS_MISSING');
  const host = new URL(testnetUrl).hostname.toLowerCase();
  if (host !== 'testnet.binancefuture.com') {
    throw new Error(`REFUSE_NON_TESTNET_HOST_${host}`);
  }
  if (process.env.LIVEBOT_CANARY_APPROVED !== 'YES') {
    throw new Error('TESTNET_CLOSE_APPROVAL_MISSING');
  }

  const cohort = JSON.parse(fs.readFileSync(cohortPath, 'utf8'));
  const symbols = Array.from(new Set<string>(
    (cohort.deploymentCandidates ?? [])
      .flatMap((x: any) => Array.isArray(x.contracts) ? x.contracts : [])
      .map((x: unknown) => String(x))
      .filter(Boolean)
  )).sort();

  const adapter = new BinanceUsdmAdapter({
    baseUrl: testnetUrl,
    apiKey,
    apiSecret,
    mode: 'CANARY',
    governor: new RateLimitGovernor(),
  });

  await adapter.serverTime();

  const report: any = {
    generatedAt: new Date().toISOString(),
    execution: 'BINANCE_USDM_TESTNET',
    productionOrders: false,
    scope: 'DEMO10_COHORT_SYMBOLS_ONLY',
    symbols: [],
  };

  for (const symbol of symbols) {
    const row: any = { symbol, cancelledRegular: [], cancelledAlgo: [], close: null };
    report.symbols.push(row);

    try {
      const openRegular = await adapter.getOpenOrders(symbol);
      for (const order of Array.isArray(openRegular) ? openRegular : []) {
        const clientOrderId = String(order?.clientOrderId ?? order?.origClientOrderId ?? '');
        if (!clientOrderId) continue;
        try {
          await adapter.cancelOrder(symbol, clientOrderId);
          row.cancelledRegular.push(clientOrderId);
        } catch (error: any) {
          const code = Number(error?.response?.data?.code);
          if (code !== -2011 && code !== -2013) throw error;
        }
      }

      const rawPosition = await adapter.getPositionRisk(symbol);
      const rows = Array.isArray(rawPosition) ? rawPosition : [rawPosition];
      const pos = rows.find((x: any) => x?.symbol === symbol) ?? rows[0] ?? {};
      const amount = Number(pos?.positionAmt ?? 0);
      row.before = {
        positionAmt: amount,
        entryPrice: Number(pos?.entryPrice ?? 0),
        markPrice: Number(pos?.markPrice ?? 0),
      };

      if (Number.isFinite(amount) && Math.abs(amount) > 1e-12) {
        const side: 'BUY' | 'SELL' = amount > 0 ? 'SELL' : 'BUY';
        const close = await adapter.closePositionMarket({
          symbol,
          side,
          quantity: String(Math.abs(amount)),
          clientOrderId: safeId(symbol, 'close'),
        });
        row.close = {
          side,
          status: close?.status ?? null,
          executedQty: close?.executedQty ?? null,
          orderId: close?.orderId ?? null,
        };
        await sleep(350);
      }

      const openAlgo = await adapter.getOpenAlgoOrders(symbol);
      for (const order of Array.isArray(openAlgo) ? openAlgo : []) {
        const id = String(order?.clientAlgoId ?? order?.algoId ?? '');
        if (!id) continue;
        try {
          await adapter.cancelAlgoOrder(id);
          row.cancelledAlgo.push(id);
        } catch (error: any) {
          const code = Number(error?.response?.data?.code);
          if (code !== -2011 && code !== -2013) throw error;
        }
      }

      const verifyRaw = await adapter.getPositionRisk(symbol);
      const verifyRows = Array.isArray(verifyRaw) ? verifyRaw : [verifyRaw];
      const verify = verifyRows.find((x: any) => x?.symbol === symbol) ?? verifyRows[0] ?? {};
      row.after = {
        positionAmt: Number(verify?.positionAmt ?? 0),
        entryPrice: Number(verify?.entryPrice ?? 0),
        markPrice: Number(verify?.markPrice ?? 0),
      };

      const remainingRegular = await adapter.getOpenOrders(symbol);
      const remainingAlgo = await adapter.getOpenAlgoOrders(symbol);
      row.remainingRegularOrders = Array.isArray(remainingRegular) ? remainingRegular.length : 0;
      row.remainingAlgoOrders = Array.isArray(remainingAlgo) ? remainingAlgo.length : 0;
    } catch (error: any) {
      const code = Number(error?.response?.data?.code);
      // TESTNET can omit some real-market contracts. Treat unavailable contract as non-actionable.
      if (code === -1121 || code === -4108) {
        row.unavailableOnTestnet = true;
        row.error = String(error?.response?.data?.msg ?? error?.message ?? error);
        continue;
      }
      row.error = String(error?.stack ?? error?.message ?? error);
      throw error;
    }
  }

  const nonFlat = report.symbols.filter((x: any) =>
    x.after && Number.isFinite(Number(x.after.positionAmt)) && Math.abs(Number(x.after.positionAmt)) > 1e-12
  );
  const remainingOrders = report.symbols.filter((x: any) =>
    Number(x.remainingRegularOrders ?? 0) > 0 || Number(x.remainingAlgoOrders ?? 0) > 0
  );

  report.summary = {
    cohortSymbols: symbols.length,
    closedPositions: report.symbols.filter((x: any) => x.close).length,
    nonFlatAfter: nonFlat.map((x: any) => x.symbol),
    symbolsWithRemainingOrders: remainingOrders.map((x: any) => x.symbol),
  };
  report.result = nonFlat.length || remainingOrders.length ? 'FAIL_NOT_FLAT' : 'ALL_DEMO10_TESTNET_FLAT';

  const outDir = path.join(process.cwd(), 'artifacts');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'demo10-stop-final.json'),
    JSON.stringify(report, null, 2) + '\n',
    'utf8'
  );
  console.log(JSON.stringify(report, null, 2));

  if (report.result !== 'ALL_DEMO10_TESTNET_FLAT') process.exit(2);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
