import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { RateLimitGovernor } from '../live/CanonicalLive';
import { BinanceUsdmAdapter } from '../live/BinanceUsdmAdapter';
import {
  buildShutdownVerdict,
  deterministicShutdownClientOrderId,
  errorCode,
  errorMessage,
  isBenignCancelError,
  isUnavailableSymbolError,
  symbolSnapshotFromGlobal,
} from '../../scripts/demo11-shutdown-policy.mjs';

dotenv.config();

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const testnetUrl = process.env.BINANCE_FUTURES_URL?.trim() ?? '';
  const apiKey = process.env.BINANCE_API_KEY?.trim() ?? '';
  const apiSecret = process.env.BINANCE_API_SECRET?.trim() ?? '';
  const cohortPath = process.env.DEMO11_COHORT_PATH?.trim() ?? 'research/demo_cohort_10.json';

  if (!apiKey || !apiSecret) throw new Error('DEMO11_TESTNET_CREDENTIALS_MISSING');
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
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    execution: 'BINANCE_USDM_TESTNET',
    productionOrders: false,
    scope: 'DEMO11_COHORT_SYMBOLS_ONLY',
    symbols: [],
    reconciliationPasses: [],
  };

  // Operation phase is deliberately best-effort. A failure for one symbol must
  // never prevent later cohort symbols from being attempted.
  for (const symbol of symbols) {
    const row: any = {
      symbol,
      cancelledRegular: [],
      cancelledAlgo: [],
      close: null,
      operationErrors: [],
      unavailableOnTestnet: false,
    };
    report.symbols.push(row);

    let openRegular: any[] = [];
    try {
      const raw = await adapter.getOpenOrders(symbol);
      openRegular = Array.isArray(raw) ? raw : [];
    } catch (error: any) {
      row.operationErrors.push({ step: 'READ_REGULAR', code: errorCode(error), message: errorMessage(error) });
      if (isUnavailableSymbolError(error)) row.unavailableOnTestnet = true;
    }

    for (const order of openRegular) {
      const clientOrderId = String(order?.clientOrderId ?? order?.origClientOrderId ?? '');
      if (!clientOrderId) continue;
      try {
        await adapter.cancelOrder(symbol, clientOrderId);
        row.cancelledRegular.push(clientOrderId);
      } catch (error: any) {
        if (!isBenignCancelError(error)) {
          row.operationErrors.push({ step: 'CANCEL_REGULAR', code: errorCode(error), message: errorMessage(error) });
          if (isUnavailableSymbolError(error)) row.unavailableOnTestnet = true;
        }
      }
    }

    try {
      const rawPosition = await adapter.getPositionRisk(symbol);
      const rows = Array.isArray(rawPosition) ? rawPosition : [rawPosition];
      const pos = rows.find((x: any) => x?.symbol === symbol) ?? rows[0] ?? {};
      const rawAmount = String(pos?.positionAmt ?? '0');
      const amount = Number(rawAmount);
      row.before = {
        positionAmt: amount,
        entryPrice: Number(pos?.entryPrice ?? 0),
        markPrice: Number(pos?.markPrice ?? 0),
      };

      if (Number.isFinite(amount) && Math.abs(amount) > 1e-12) {
        const side: 'BUY' | 'SELL' = amount > 0 ? 'SELL' : 'BUY';
        try {
          const close = await adapter.closePositionMarket({
            symbol,
            side,
            quantity: String(Math.abs(amount)),
            clientOrderId: deterministicShutdownClientOrderId(symbol, rawAmount),
          });
          row.close = {
            side,
            status: close?.status ?? null,
            executedQty: close?.executedQty ?? null,
            orderId: close?.orderId ?? null,
          };
          await sleep(350);
        } catch (error: any) {
          row.operationErrors.push({ step: 'CLOSE_POSITION', code: errorCode(error), message: errorMessage(error) });
          if (isUnavailableSymbolError(error)) row.unavailableOnTestnet = true;
        }
      }
    } catch (error: any) {
      row.operationErrors.push({ step: 'READ_POSITION', code: errorCode(error), message: errorMessage(error) });
      if (isUnavailableSymbolError(error)) row.unavailableOnTestnet = true;
    }

    let openAlgo: any[] = [];
    try {
      const raw = await adapter.getOpenAlgoOrders(symbol);
      openAlgo = Array.isArray(raw) ? raw : [];
    } catch (error: any) {
      row.operationErrors.push({ step: 'READ_ALGO', code: errorCode(error), message: errorMessage(error) });
      if (isUnavailableSymbolError(error)) row.unavailableOnTestnet = true;
    }

    for (const order of openAlgo) {
      const id = String(order?.clientAlgoId ?? order?.algoId ?? '');
      if (!id) continue;
      try {
        await adapter.cancelAlgoOrder(id);
        row.cancelledAlgo.push(id);
      } catch (error: any) {
        if (!isBenignCancelError(error)) {
          row.operationErrors.push({ step: 'CANCEL_ALGO', code: errorCode(error), message: errorMessage(error) });
          if (isUnavailableSymbolError(error)) row.unavailableOnTestnet = true;
        }
      }
    }
  }

  // Final truth comes from two account-wide reads. This is intentionally
  // independent of symbol-specific endpoints so a closed contract cannot hide
  // a remaining position or order behind -4141.
  for (let passIndex = 0; passIndex < 2; passIndex++) {
    if (passIndex) await sleep(500);
    const pass: any = { at: new Date().toISOString(), ok: false, symbols: {} };
    const reads = await Promise.allSettled([
      adapter.getAccount(),
      adapter.getOpenOrders(undefined as any),
      adapter.getOpenAlgoOrders(undefined as any),
    ]);

    const failures = reads
      .map((x, i) => x.status === 'rejected'
        ? { source: ['ACCOUNT', 'OPEN_ORDERS', 'OPEN_ALGO_ORDERS'][i], message: errorMessage((x as PromiseRejectedResult).reason), code: errorCode((x as PromiseRejectedResult).reason) }
        : null)
      .filter(Boolean);
    pass.errors = failures;

    if (!failures.length) {
      const account = (reads[0] as PromiseFulfilledResult<any>).value;
      const regularOrders = (reads[1] as PromiseFulfilledResult<any>).value;
      const algoOrders = (reads[2] as PromiseFulfilledResult<any>).value;
      pass.ok = true;
      for (const symbol of symbols) {
        pass.symbols[symbol] = symbolSnapshotFromGlobal({
          symbol,
          account,
          regularOrders,
          algoOrders,
        });
      }
    }

    report.reconciliationPasses.push(pass);
  }

  for (const row of report.symbols) {
    const passes = report.reconciliationPasses.map((p: any) => {
      if (!p.ok) return { ok: false };
      return { ok: true, ...(p.symbols[row.symbol] ?? {}) };
    });
    row.reconciliation = passes;
    row.final = buildShutdownVerdict({
      symbol: row.symbol,
      unavailable: row.unavailableOnTestnet,
      passes,
    });
  }

  const unresolved = report.symbols
    .filter((x: any) => x.final?.status === 'CRITICAL_UNRESOLVED')
    .map((x: any) => ({ symbol: x.symbol, reason: x.final?.reason ?? 'UNKNOWN' }));

  report.summary = {
    cohortSymbols: symbols.length,
    attemptedSymbols: report.symbols.length,
    closedPositions: report.symbols.filter((x: any) => x.close).length,
    verifiedFlat: report.symbols.filter((x: any) => ['FLAT', 'SKIPPED_UNAVAILABLE_VERIFIED_FLAT'].includes(x.final?.status)).length,
    unresolved,
  };
  report.result = unresolved.length ? 'FAIL_CRITICAL_UNRESOLVED' : 'ALL_DEMO11_TESTNET_FLAT';

  const outDir = path.join(process.cwd(), 'artifacts');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, 'demo11-stop-final.json'),
    JSON.stringify(report, null, 2) + '\n',
    'utf8'
  );
  console.log(JSON.stringify(report, null, 2));

  if (report.result !== 'ALL_DEMO11_TESTNET_FLAT') process.exit(2);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
