import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { createHmac } from 'crypto';
import { DeploymentMode, RateLimitGovernor } from './CanonicalLive';

export interface BinanceAdapterOptions {
  baseUrl?: string;
  apiKey?: string;
  apiSecret?: string;
  mode?: DeploymentMode;
  governor?: RateLimitGovernor;
}

export interface BinanceKline {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  closeTime: number;
}

export class BinanceUsdmAdapter {
  private http: AxiosInstance;
  private apiKey?: string;
  private apiSecret?: string;
  private mode: DeploymentMode;
  private clockOffsetMs = 0;
  private governor?: RateLimitGovernor;

  constructor(opts: BinanceAdapterOptions = {}) {
    this.http = axios.create({
      baseURL: opts.baseUrl ?? 'https://fapi.binance.com',
      timeout: 15_000,
      headers: { 'User-Agent': 'Canonical-Q-LiveBot/1.0' },
    });
    this.apiKey = opts.apiKey;
    this.apiSecret = opts.apiSecret;
    this.mode = opts.mode ?? 'SHADOW';
    this.governor = opts.governor;
  }

  private observe(response: AxiosResponse): void {
    this.governor?.observeHeaders(response.headers as Record<string, unknown>);
  }

  private async publicGet<T = any>(path: string, config: any = {}): Promise<AxiosResponse<T>> {
    let lastError: any;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await this.http.get<T>(path, config);
        this.observe(response);
        return response;
      } catch (error: any) {
        lastError = error;
        const status = Number(error?.response?.status ?? 0);
        const retryable = (!status || status >= 500) && attempt < 3;
        if (!retryable) throw error;
        await new Promise(resolve => setTimeout(resolve, attempt * 300));
      }
    }
    throw lastError;
  }

  private assertWriteAllowed(): void {
    if (this.mode === 'SHADOW' || this.mode === 'HALTED') {
      throw new Error('EXCHANGE_WRITE_BLOCKED_IN_' + this.mode);
    }
    if (!this.apiKey || !this.apiSecret) throw new Error('BINANCE_SIGNED_CREDENTIALS_REQUIRED');
    if (this.mode === 'CANARY' && process.env.LIVEBOT_CANARY_APPROVED !== 'YES') {
      throw new Error('CANARY_EXPLICIT_APPROVAL_REQUIRED');
    }
    if (
      this.mode === 'LIVE' &&
      (process.env.LIVEBOT_LIVE_APPROVED !== 'YES' || process.env.LIVEBOT_SECOND_APPROVAL !== 'YES')
    ) {
      throw new Error('LIVE_DOUBLE_APPROVAL_REQUIRED');
    }
  }

  private signedParams(params: Record<string, string | number | boolean | undefined>): string {
    if (!this.apiSecret) throw new Error('BINANCE_API_SECRET_REQUIRED');
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) p.set(k, String(v));
    }
    p.set('timestamp', String(Date.now() + this.clockOffsetMs));
    p.set('recvWindow', p.get('recvWindow') ?? '5000');
    const query = p.toString();
    const signature = createHmac('sha256', this.apiSecret).update(query).digest('hex');
    return query + '&signature=' + signature;
  }

  private async signed<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    params: Record<string, string | number | boolean | undefined> = {}
  ): Promise<T> {
    if (!this.apiKey || !this.apiSecret) throw new Error('BINANCE_SIGNED_CREDENTIALS_REQUIRED');
    if (this.governor && !this.governor.canWrite() && method !== 'GET') throw new Error('RATE_LIMIT_GOVERNOR_BLOCKED');

    const maxAttempts = method === 'GET' ? 3 : 1;
    let lastError: any;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const query = this.signedParams(params);
      try {
        const response = await this.http.request<T>({
          method,
          url: path + '?' + query,
          headers: { 'X-MBX-APIKEY': this.apiKey },
        });
        this.observe(response);
        return response.data;
      } catch (error: any) {
        lastError = error;
        const status = Number(error?.response?.status ?? 0);
        const retryAfter = Number(error?.response?.headers?.['retry-after'] ?? 1);
        if (status === 429 || status === 418) this.governor?.noteHttpLimit(status, retryAfter);

        const retryableRead =
          method === 'GET' &&
          attempt < maxAttempts &&
          status !== 418 &&
          status !== 429 &&
          (!status || status >= 500);
        if (!retryableRead) throw error;
        await new Promise(resolve => setTimeout(resolve, attempt * 300));
      }
    }
    throw lastError;
  }

  async serverTime(): Promise<number> {
    const response = await this.publicGet<{ serverTime: number }>('/fapi/v1/time');
    this.clockOffsetMs = response.data.serverTime - Date.now();
    return response.data.serverTime;
  }

  async exchangeInfo(): Promise<any> {
    const response = await this.publicGet('/fapi/v1/exchangeInfo');
    return response.data;
  }

  async klines(symbol: string, interval = '15m', limit = 500): Promise<BinanceKline[]> {
    const response = await this.publicGet<any[]>('/fapi/v1/klines', {
      params: { symbol, interval, limit },
    });
    return response.data.map(k => ({
      t: Number(k[0]),
      o: Number(k[1]),
      h: Number(k[2]),
      l: Number(k[3]),
      c: Number(k[4]),
      v: Number(k[5]),
      closeTime: Number(k[6]),
    }));
  }

  async klinesRange(
    symbol: string,
    interval: string,
    startTime: number,
    endTime: number,
    limit = 1500
  ): Promise<BinanceKline[]> {
    const out: BinanceKline[] = [];
    let cursor = startTime;
    while (cursor < endTime) {
      const response = await this.publicGet<any[]>('/fapi/v1/klines', {
        params: { symbol, interval, startTime: cursor, endTime, limit },
      });
      if (!response.data.length) break;
      const batch = response.data.map(k => ({
        t: Number(k[0]),
        o: Number(k[1]),
        h: Number(k[2]),
        l: Number(k[3]),
        c: Number(k[4]),
        v: Number(k[5]),
        closeTime: Number(k[6]),
      }));
      out.push(...batch);
      const next = batch[batch.length - 1].t + 1;
      if (next <= cursor) throw new Error('KLINE_PAGINATION_STALLED');
      cursor = next;
      if (batch.length < limit) break;
    }
    return out;
  }

  async depth(symbol: string, limit = 20): Promise<any> {
    const response = await this.publicGet('/fapi/v1/depth', { params: { symbol, limit } });
    return response.data;
  }

  async getAccount(): Promise<any> {
    return this.signed('GET', '/fapi/v3/account');
  }

  async getBalance(): Promise<any> {
    return this.signed('GET', '/fapi/v3/balance');
  }

  async getMarkPrice(symbol: string): Promise<number> {
    const response = await this.publicGet('/fapi/v1/premiumIndex', { params: { symbol } });
    const value = Number((response.data as any)?.markPrice);
    if (!(value > 0)) throw new Error('INVALID_MARK_PRICE');
    return value;
  }

  async getPositionMode(): Promise<'ONE_WAY' | 'HEDGE'> {
    const data: any = await this.signed('GET', '/fapi/v1/positionSide/dual');
    return data.dualSidePosition ? 'HEDGE' : 'ONE_WAY';
  }

  async getAccountConfig(): Promise<any> {
    return this.signed('GET', '/fapi/v1/accountConfig');
  }

  async getSymbolConfig(symbol: string): Promise<any> {
    return this.signed('GET', '/fapi/v1/symbolConfig', { symbol });
  }

  async setMarginType(symbol: string, marginType: 'ISOLATED' | 'CROSSED'): Promise<any> {
    this.assertWriteAllowed();
    return this.signed('POST', '/fapi/v1/marginType', { symbol, marginType });
  }

  async setLeverage(symbol: string, leverage: number): Promise<any> {
    this.assertWriteAllowed();
    return this.signed('POST', '/fapi/v1/leverage', { symbol, leverage });
  }

  async getPositionRisk(symbol: string): Promise<any> {
    return this.signed('GET', '/fapi/v3/positionRisk', { symbol });
  }

  async getOrderByClientId(symbol: string, clientOrderId: string): Promise<any | null> {
    try {
      return await this.signed('GET', '/fapi/v1/order', {
        symbol,
        origClientOrderId: clientOrderId,
      });
    } catch (error: any) {
      const code = Number(error?.response?.data?.code);
      if (code === -2013) return null;
      throw error;
    }
  }

  async getAlgoOrder(clientAlgoId: string): Promise<any | null> {
    try {
      return await this.signed('GET', '/fapi/v1/algoOrder', { clientAlgoId });
    } catch (error: any) {
      const code = Number(error?.response?.data?.code);
      if (code === -2013 || code === -2011) return null;
      throw error;
    }
  }

  async getOpenOrders(symbol: string): Promise<any> {
    return this.signed('GET', '/fapi/v1/openOrders', { symbol });
  }

  async getAllOrders(symbol: string, limit = 1000): Promise<any> {
    return this.signed('GET', '/fapi/v1/allOrders', { symbol, limit });
  }

  async getOpenAlgoOrders(symbol: string): Promise<any> {
    return this.signed('GET', '/fapi/v1/openAlgoOrders', { symbol });
  }

  async placeIocLimit(params: {
    symbol: string;
    side: 'BUY' | 'SELL';
    quantity: string;
    price: string;
    clientOrderId: string;
    reduceOnly?: boolean;
  }): Promise<any> {
    this.assertWriteAllowed();
    return this.signed('POST', '/fapi/v1/order', {
      symbol: params.symbol,
      side: params.side,
      positionSide: 'BOTH',
      type: 'LIMIT',
      timeInForce: 'IOC',
      quantity: params.quantity,
      price: params.price,
      newClientOrderId: params.clientOrderId,
      reduceOnly: params.reduceOnly ?? false,
      newOrderRespType: 'RESULT',
    });
  }

  async cancelOrder(symbol: string, clientOrderId: string): Promise<any> {
    this.assertWriteAllowed();
    return this.signed('DELETE', '/fapi/v1/order', {
      symbol,
      origClientOrderId: clientOrderId,
    });
  }

  async cancelAlgoOrder(clientAlgoId: string): Promise<any> {
    this.assertWriteAllowed();
    return this.signed('DELETE', '/fapi/v1/algoOrder', { clientAlgoId });
  }

  async closePositionMarket(params: {
    symbol: string;
    side: 'BUY' | 'SELL';
    quantity: string;
    clientOrderId: string;
  }): Promise<any> {
    this.assertWriteAllowed();
    return this.signed('POST', '/fapi/v1/order', {
      symbol: params.symbol,
      side: params.side,
      positionSide: 'BOTH',
      type: 'MARKET',
      quantity: params.quantity,
      newClientOrderId: params.clientOrderId,
      reduceOnly: true,
      newOrderRespType: 'RESULT',
    });
  }

  async placeCatastrophicStop(params: {
    symbol: string;
    side: 'BUY' | 'SELL';
    triggerPrice: string;
    clientAlgoId: string;
  }): Promise<any> {
    this.assertWriteAllowed();
    return this.signed('POST', '/fapi/v1/algoOrder', {
      algoType: 'CONDITIONAL',
      symbol: params.symbol,
      side: params.side,
      positionSide: 'BOTH',
      type: 'STOP_MARKET',
      triggerPrice: params.triggerPrice,
      workingType: 'MARK_PRICE',
      closePosition: true,
      clientAlgoId: params.clientAlgoId,
    });
  }
}
