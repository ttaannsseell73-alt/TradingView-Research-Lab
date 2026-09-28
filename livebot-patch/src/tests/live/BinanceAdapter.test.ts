import { describe, expect, it } from 'vitest';
import { BinanceUsdmAdapter } from '../../live/BinanceUsdmAdapter';

describe('Binance USD-M adapter safety', () => {
  it('SHADOW mode cannot place normal orders', async () => {
    const a=new BinanceUsdmAdapter({mode:'SHADOW'});
    await expect(a.placeIocLimit({
      symbol:'QUSDT',side:'BUY',quantity:'1',price:'1',clientOrderId:'shadow-block'
    })).rejects.toThrow('EXCHANGE_WRITE_BLOCKED_IN_SHADOW');
  });

  it('SHADOW mode cannot place catastrophic stops', async () => {
    const a=new BinanceUsdmAdapter({mode:'SHADOW'});
    await expect(a.placeCatastrophicStop({
      symbol:'QUSDT',side:'SELL',triggerPrice:'1',clientAlgoId:'shadow-stop'
    })).rejects.toThrow('EXCHANGE_WRITE_BLOCKED_IN_SHADOW');
  });
});
