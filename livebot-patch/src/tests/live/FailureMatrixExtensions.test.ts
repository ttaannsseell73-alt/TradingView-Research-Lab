import { describe, expect, it, vi } from 'vitest';
import {
  Candle,
  CandleBarrier,
  InFlightRegistry,
  Range48Strategy,
  RateLimitGovernor,
} from '../../live/CanonicalLive';
import {
  CanonicalReconciler,
  classifyUserDataEvent,
} from '../../live/ExecutionSafety';

function candles(n=300): Candle[] {
  const out:Candle[]=[];
  let p=100;
  for(let i=0;i<n;i++){
    const drift=((i%11)-5)*0.03;
    const o=p;
    const c=p+drift;
    out.push({t:i*900_000,o,h:Math.max(o,c)+0.4,l:Math.min(o,c)-0.4,c,v:100+i});
    p=c;
  }
  return out;
}

describe('Canonical Failure Matrix extensions F26-F30', () => {
  it('F26 stale market data => NO_ENTRY barrier', () => {
    const c=candles(100);
    const now=(102*900_000)+5_000;
    expect(new CandleBarrier(900_000,3_000,64).validate(c,now).reason).toBe('STALE_DATA');
  });

  it('F27 in-flight UNKNOWN is resolved by clientOrderId after quiescence without duplicate', async () => {
    const adapter:any={
      getOrderByClientId:vi.fn().mockResolvedValue({clientOrderId:'cid',status:'FILLED'}),
      getOpenOrders:vi.fn().mockResolvedValue([]),
      getOpenAlgoOrders:vi.fn().mockResolvedValue([]),
      getPositionRisk:vi.fn().mockResolvedValue([{symbol:'QUSDT',positionAmt:'0'}]),
    };
    const journal:any={
      unresolvedOutbox:vi.fn().mockResolvedValue([{outboxId:'o1',intentId:'cid',status:'PROCESSING',payload:{}}]),
      markOutboxUnknownResolved:vi.fn().mockResolvedValue(undefined),
      knownIntentIds:vi.fn().mockResolvedValue(['cid']),
      knownProtectionIds:vi.fn().mockResolvedValue([]),
      expectedNetPosition:vi.fn().mockResolvedValue(0),
      recordPositionSnapshot:vi.fn().mockResolvedValue(undefined),
      appendEvent:vi.fn().mockResolvedValue(undefined),
    };
    const inflight=new InFlightRegistry();
    inflight.markSent('cid',Date.now()-5);
    const r=await new CanonicalReconciler(adapter,journal,inflight,1).reconcile('QUSDT');
    expect(r.ok).toBe(true);
    expect(journal.markOutboxUnknownResolved).toHaveBeenCalledTimes(1);
    expect(adapter.getOrderByClientId).toHaveBeenCalledTimes(1);
  });

  it('F28 proactive rate governor blocks at exhausted counter / 429', () => {
    const g=new RateLimitGovernor();
    g.configureLimits({weight1m:100,order10s:10,order1m:100});
    g.observeHeaders({'x-mbx-used-weight-1m':'10','x-mbx-order-count-10s':'10','x-mbx-order-count-1m':'10'});
    expect(g.canWrite()).toBe(false);
    const g2=new RateLimitGovernor();
    g2.noteHttpLimit(429,1);
    expect(g2.canWrite()).toBe(false);
  });

  it('F29 funding event is classified distinctly from external/manual activity', () => {
    expect(classifyUserDataEvent({e:'ACCOUNT_UPDATE',a:{m:'FUNDING_FEE'}})).toBe('FUNDING_FEE');
    expect(classifyUserDataEvent({e:'ACCOUNT_UPDATE',a:{m:'ORDER'}})).toBe('ORDER');
  });

  it('F30 restart rebuild from identical pinned history is bit-for-bit signal deterministic', () => {
    const source=candles(1000);
    source[300]={...source[300],l:source[300].l-4,c:source[300].o};
    source[700]={...source[700],h:source[700].h+4,c:source[700].o};
    const serialized=JSON.parse(JSON.stringify(source)) as Candle[];
    const a=new Range48Strategy().signals(source);
    const b=new Range48Strategy().signals(serialized);
    expect(b).toEqual(a);
  });
});
