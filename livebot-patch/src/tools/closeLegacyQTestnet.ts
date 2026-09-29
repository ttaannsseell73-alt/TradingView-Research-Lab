import { deterministicClientOrderId, RateLimitGovernor } from '../live/CanonicalLive';
import { BinanceUsdmAdapter } from '../live/BinanceUsdmAdapter';

function positionRow(raw: any, symbol: string): any {
  const rows = Array.isArray(raw) ? raw : [raw];
  return rows.find((x: any) => x?.symbol === symbol) ?? rows[0] ?? {};
}

async function main(): Promise<void> {
  const symbol = 'QUSDT';
  const baseUrl = process.env.BINANCE_FUTURES_URL?.trim() ?? '';
  const apiKey = process.env.BINANCE_API_KEY?.trim() ?? '';
  const apiSecret = process.env.BINANCE_API_SECRET?.trim() ?? '';

  if (!apiKey || !apiSecret) throw new Error('Q_TESTNET_CREDENTIALS_MISSING');
  const host = new URL(baseUrl).hostname.toLowerCase();
  if (host !== 'testnet.binancefuture.com') {
    throw new Error('REFUSE_NON_TESTNET_Q_CLOSE');
  }
  if (process.env.LIVEBOT_CANARY_APPROVED !== 'YES') {
    throw new Error('Q_TESTNET_CLOSE_APPROVAL_MISSING');
  }

  const adapter = new BinanceUsdmAdapter({
    baseUrl,
    apiKey,
    apiSecret,
    mode: 'CANARY',
    governor: new RateLimitGovernor(),
  });

  await adapter.serverTime();
  const before = positionRow(await adapter.getPositionRisk(symbol), symbol);
  const beforeAmt = Number(before.positionAmt ?? 0);
  const result: any = {
    environment: 'BINANCE_USDM_TESTNET',
    symbol,
    before: {
      positionAmt: beforeAmt,
      entryPrice: Number(before.entryPrice ?? 0),
      markPrice: Number(before.markPrice ?? 0),
      unrealizedProfit: Number(before.unRealizedProfit ?? before.unrealizedProfit ?? 0),
    },
    closeOrder: null,
    cancelledOrders: [],
    cancelledAlgoOrders: [],
  };

  if (Math.abs(beforeAmt) > 1e-12) {
    const side: 'BUY' | 'SELL' = beforeAmt > 0 ? 'SELL' : 'BUY';
    const clientOrderId = deterministicClientOrderId({
      deploymentId: 'legacy-q-retire-final',
      symbol,
      candleOpenTime: 0,
      action: side === 'SELL' ? 'EXIT_LONG' : 'EXIT_SHORT',
      generation: 1,
    });
    result.closeOrder = await adapter.closePositionMarket({
      symbol,
      side,
      quantity: String(Math.abs(beforeAmt)),
      clientOrderId,
    });
  }

  await new Promise(resolve => setTimeout(resolve, 500));

  const openOrders = await adapter.getOpenOrders(symbol);
  for (const order of Array.isArray(openOrders) ? openOrders : []) {
    const clientOrderId = String(order?.clientOrderId ?? '');
    if (!clientOrderId) continue;
    try {
      await adapter.cancelOrder(symbol, clientOrderId);
      result.cancelledOrders.push(clientOrderId);
    } catch (error: any) {
      result.cancelledOrders.push({ clientOrderId, error: String(error?.message ?? error) });
    }
  }

  const openAlgo = await adapter.getOpenAlgoOrders(symbol);
  for (const order of Array.isArray(openAlgo) ? openAlgo : []) {
    const clientAlgoId = String(order?.clientAlgoId ?? order?.algoId ?? '');
    if (!clientAlgoId) continue;
    try {
      await adapter.cancelAlgoOrder(clientAlgoId);
      result.cancelledAlgoOrders.push(clientAlgoId);
    } catch (error: any) {
      result.cancelledAlgoOrders.push({ clientAlgoId, error: String(error?.message ?? error) });
    }
  }

  const after = positionRow(await adapter.getPositionRisk(symbol), symbol);
  result.after = {
    positionAmt: Number(after.positionAmt ?? 0),
    entryPrice: Number(after.entryPrice ?? 0),
    markPrice: Number(after.markPrice ?? 0),
    unrealizedProfit: Number(after.unRealizedProfit ?? after.unrealizedProfit ?? 0),
  };
  result.flat = Math.abs(result.after.positionAmt) <= 1e-12;

  console.log(JSON.stringify(result, null, 2));
  if (!result.flat) throw new Error('Q_TESTNET_POSITION_NOT_FLAT');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
