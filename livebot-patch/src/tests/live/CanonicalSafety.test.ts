import { describe, expect, it, vi } from 'vitest';
import {
  AccountContractVerifier,
  classifyUserDataEvent,
  normalizeOrderToRules,
  parseSymbolRules,
  ProtectionManager,
  CanonicalExecutionWriter,
  CanonicalReconciler,
} from '../../live/ExecutionSafety';
import { InFlightRegistry, RateLimitGovernor } from '../../live/CanonicalLive';

describe('Canonical live safety extensions', () => {
  it('parses and normalizes Binance symbol filters', () => {
    const info={symbols:[{symbol:'QUSDT',status:'TRADING',filters:[
      {filterType:'PRICE_FILTER',tickSize:'0.001',minPrice:'0.001',maxPrice:'1000'},
      {filterType:'LOT_SIZE',stepSize:'0.1',minQty:'0.1',maxQty:'100000'},
      {filterType:'MIN_NOTIONAL',notional:'5'},
      {filterType:'PERCENT_PRICE',multiplierUp:'1.2',multiplierDown:'0.8'}
    ]}]};
    const rules=parseSymbolRules(info,'QUSDT');
    const x=normalizeOrderToRules(rules,1.23456,10.29,1.2);
    expect(x.price).toBe(1.234);
    expect(x.quantity).toBe(10.2);
    expect(x.notional).toBeGreaterThan(5);
  });

  it('rejects price outside PERCENT_PRICE band', () => {
    const rules:any={symbol:'QUSDT',status:'TRADING',tickSize:.001,minPrice:.001,maxPrice:1000,stepSize:.1,minQty:.1,maxQty:100000,minNotional:5,percentMultiplierUp:1.1,percentMultiplierDown:.9};
    expect(()=>normalizeOrderToRules(rules,1.2,10,1)).toThrow('PRICE_ABOVE_PERCENT_BAND');
  });

  it('account contract accepts ONE-WAY + ISOLATED + single-asset + TRADING', async () => {
    const adapter:any={
      getPositionMode:vi.fn().mockResolvedValue('ONE_WAY'),
      getAccountConfig:vi.fn().mockResolvedValue({multiAssetsMargin:false}),
      getSymbolConfig:vi.fn().mockResolvedValue([{symbol:'QUSDT',marginType:'ISOLATED',leverage:1}]),
      exchangeInfo:vi.fn().mockResolvedValue({symbols:[{symbol:'QUSDT',status:'TRADING'}]})
    };
    const r=await new AccountContractVerifier(adapter).verify('QUSDT',1);
    expect(r.ok).toBe(true);
  });

  it('account contract fail-closes on hedge/cross/multi-asset mismatch', async () => {
    const adapter:any={
      getPositionMode:vi.fn().mockResolvedValue('HEDGE'),
      getAccountConfig:vi.fn().mockResolvedValue({multiAssetsMargin:true}),
      getSymbolConfig:vi.fn().mockResolvedValue([{symbol:'QUSDT',marginType:'CROSSED',leverage:5}]),
      exchangeInfo:vi.fn().mockResolvedValue({symbols:[{symbol:'QUSDT',status:'TRADING'}]})
    };
    const r=await new AccountContractVerifier(adapter).verify('QUSDT',1);
    expect(r.ok).toBe(false);
    expect(r.reasons).toEqual(expect.arrayContaining([
      'POSITION_MODE_NOT_ONE_WAY','MARGIN_NOT_ISOLATED','MULTI_ASSETS_MUST_BE_OFF','LEVERAGE_MISMATCH'
    ]));
  });

  it('DB failure prevents an entry from ever reaching the adapter', async () => {
    const adapter:any={placeIocLimit:vi.fn()};
    const journal:any={persistIntentAndOutbox:vi.fn().mockRejectedValue(new Error('db down'))};
    const leader:any={assertHeld:vi.fn().mockReturnValue(7)};
    const g=new RateLimitGovernor();
    const writer=new CanonicalExecutionWriter(adapter,journal,leader,g,new InFlightRegistry());
    await expect(writer.persistEntry({
      deploymentId:'q',candleOpenTime:1,action:'LONG',quantity:'1',price:'1',systemMode:'RUNNING'
    })).rejects.toThrow('db down');
    expect(adapter.placeIocLimit).not.toHaveBeenCalled();
  });

  it('non-leader cannot persist executable entry', async () => {
    const adapter:any={placeIocLimit:vi.fn()};
    const journal:any={persistIntentAndOutbox:vi.fn()};
    const leader:any={assertHeld:vi.fn(()=>{throw new Error('EXECUTION_WRITER_NOT_LEADER')})};
    const writer=new CanonicalExecutionWriter(adapter,journal,leader,new RateLimitGovernor(),new InFlightRegistry());
    await expect(writer.persistEntry({
      deploymentId:'q',candleOpenTime:1,action:'LONG',quantity:'1',price:'1',systemMode:'RUNNING'
    })).rejects.toThrow('EXECUTION_WRITER_NOT_LEADER');
    expect(journal.persistIntentAndOutbox).not.toHaveBeenCalled();
  });

  it('submit error stays UNKNOWN/in-flight and outbox is not marked done', async () => {
    const adapter:any={placeIocLimit:vi.fn().mockRejectedValue(new Error('timeout'))};
    const journal:any={
      claimOutbox:vi.fn().mockResolvedValue([{outboxId:'o1',intentId:'cid',payload:{
        kind:'ENTRY_IOC',symbol:'QUSDT',side:'BUY',quantity:'1',price:'1',clientOrderId:'cid',
        reduceOnly:false,candleOpenTime:1,fencingGeneration:7
      }}]),
      appendEvent:vi.fn().mockResolvedValue(undefined),
      markOutboxDone:vi.fn()
    };
    const leader:any={assertHeld:vi.fn().mockReturnValue(7)};
    const inflight=new InFlightRegistry();
    const writer=new CanonicalExecutionWriter(adapter,journal,leader,new RateLimitGovernor(),inflight);
    expect(await writer.dispatchPending()).toBe(0);
    expect(inflight.pendingIds()).toEqual(['cid']);
    expect(journal.markOutboxDone).not.toHaveBeenCalled();
    expect(journal.appendEvent).toHaveBeenCalledWith('ORDER_SUBMIT_UNKNOWN','cid',expect.anything());
  });

  it('protection failure records OPEN_UNPROTECTED and throws', async () => {
    const adapter:any={placeCatastrophicStop:vi.fn().mockRejectedValue(new Error('stop rejected'))};
    const journal:any={appendEvent:vi.fn().mockResolvedValue(undefined)};
    const leader:any={assertHeld:vi.fn().mockReturnValue(1)};
    const p=new ProtectionManager(adapter,journal,leader);
    await expect(p.ensureCatastrophicStop({
      symbol:'QUSDT',positionSide:'LONG',triggerPrice:'0.9',positionIdentity:'pos-1'
    })).rejects.toThrow('stop rejected');
    expect(journal.appendEvent).toHaveBeenCalledWith('OPEN_UNPROTECTED','pos-1',expect.anything());
  });

  it('classifies funding, ADL and liquidation separately', () => {
    expect(classifyUserDataEvent({e:'ACCOUNT_UPDATE',a:{m:'FUNDING_FEE'}})).toBe('FUNDING_FEE');
    expect(classifyUserDataEvent({e:'ACCOUNT_UPDATE',a:{m:'ADL'}})).toBe('ADL');
    expect(classifyUserDataEvent({e:'MARGIN_CALL'})).toBe('LIQUIDATION');
  });

  it('reconciler halts on foreign order', async () => {
    const adapter:any={
      getOpenOrders:vi.fn().mockResolvedValue([{clientOrderId:'manual'}]),
      getOpenAlgoOrders:vi.fn().mockResolvedValue([]),
      getPositionRisk:vi.fn().mockResolvedValue([{symbol:'QUSDT',positionAmt:'0'}]),
      getOrderByClientId:vi.fn()
    };
    const journal:any={
      unresolvedOutbox:vi.fn().mockResolvedValue([]),
      knownIntentIds:vi.fn().mockResolvedValue([]),
      knownProtectionIds:vi.fn().mockResolvedValue([]),
      expectedNetPosition:vi.fn().mockResolvedValue(0),
      recordPositionSnapshot:vi.fn(),
      appendEvent:vi.fn()
    };
    const r=await new CanonicalReconciler(adapter,journal,new InFlightRegistry(),0).reconcile('QUSDT');
    expect(r.halt).toBe(true);
  });

  it('reconciler halts on position mismatch', async () => {
    const adapter:any={
      getOpenOrders:vi.fn().mockResolvedValue([]),
      getOpenAlgoOrders:vi.fn().mockResolvedValue([]),
      getPositionRisk:vi.fn().mockResolvedValue([{symbol:'QUSDT',positionAmt:'3'}]),
      getOrderByClientId:vi.fn()
    };
    const journal:any={
      unresolvedOutbox:vi.fn().mockResolvedValue([]),
      knownIntentIds:vi.fn().mockResolvedValue([]),
      knownProtectionIds:vi.fn().mockResolvedValue([]),
      expectedNetPosition:vi.fn().mockResolvedValue(0),
      recordPositionSnapshot:vi.fn(),
      appendEvent:vi.fn()
    };
    const r=await new CanonicalReconciler(adapter,journal,new InFlightRegistry(),0).reconcile('QUSDT');
    expect(r.halt).toBe(true);
  });
});
