import { STRATEGIES } from '../strategy_engine_v2.mjs';
import { canonicalJson, makeSignalEvent, sha256 } from './contracts.mjs';
import { strategyMetadata } from './strategy-metadata.mjs';

const VALID_TARGETS=new Set([-1,0,1]);

function findStrategy(strategyId){
  const strategy=STRATEGIES.find(x=>x.id===strategyId);
  if(!strategy) throw new Error(`UNKNOWN_STRATEGY_${strategyId}`);
  return strategy;
}

function normalizeCandle(c){
  const out={t:Number(c?.t),o:Number(c?.o),h:Number(c?.h),l:Number(c?.l),c:Number(c?.c),v:Number(c?.v)};
  if(!Object.values(out).every(Number.isFinite)) throw new Error('INVALID_CANDLE');
  if(!(out.h>=out.l)) throw new Error('INVALID_CANDLE_RANGE');
  return Object.freeze(out);
}

function transitionOf(before,after){
  if(before===0&&after===1) return 'FLAT→LONG';
  if(before===0&&after===-1) return 'FLAT→SHORT';
  if(before===1&&after===0) return 'LONG→FLAT';
  if(before===-1&&after===0) return 'SHORT→FLAT';
  if(before===1&&after===-1) return 'LONG→SHORT';
  if(before===-1&&after===1) return 'SHORT→LONG';
  throw new Error(`INVALID_TRANSITION_${before}_${after}`);
}

function sideOf(position){
  return position===1?'LONG':position===-1?'SHORT':'FLAT';
}

function computeStateHash(state){
  return sha256({
    symbol:state.symbol,
    timeframe:state.timeframe,
    interval_ms:state.interval_ms,
    strategy_id:state.strategy_id,
    strategy_version:state.strategy_version,
    mode:state.mode,
    cursor_open_ts:state.cursor_open_ts,
    target_position:state.target_position,
    last_raw_signal_open_ts:state.last_raw_signal_open_ts,
    last_transition_open_ts:state.last_transition_open_ts,
    history_hash:state.history_hash,
  });
}

function freezeState(state){
  const frozen={...state,candles:Object.freeze([...state.candles])};
  frozen.state_hash=computeStateHash(frozen);
  return Object.freeze(frozen);
}

export function createStrategyState({symbol,timeframe,intervalMs,strategyId}){
  if(!Number.isFinite(Number(intervalMs))||Number(intervalMs)<=0) throw new Error('INVALID_INTERVAL_MS');
  const strategy=findStrategy(strategyId);
  const meta=strategyMetadata(strategyId);
  return freezeState({
    schema_version:1,
    symbol:String(symbol),
    timeframe:String(timeframe),
    interval_ms:Number(intervalMs),
    strategy_id:strategy.id,
    strategy_version:strategy.version,
    mode:strategy.mode??'REVERSAL',
    convergence:meta.convergence,
    warmup_bars:meta.warmup_bars,
    anchor:meta.anchor,
    cursor_open_ts:null,
    target_position:0,
    last_raw_signal_open_ts:null,
    last_transition_open_ts:null,
    last_event_id:null,
    history_hash:sha256([]),
    candles:[],
  });
}

export function stepStrategy(state,candleInput){
  const candle=normalizeCandle(candleInput);
  if(state.cursor_open_ts!==null){
    if(candle.t===state.cursor_open_ts){
      const last=state.candles.at(-1);
      if(last&&canonicalJson(last)===canonicalJson(candle)){
        return Object.freeze({state,event:null,duplicate:true,gap:null});
      }
      throw new Error('CANDLE_MUTATION_CONFLICT');
    }
    if(candle.t<state.cursor_open_ts) throw new Error('OUT_OF_ORDER_CANDLE');
    const expected=state.cursor_open_ts+state.interval_ms;
    if(candle.t!==expected){
      return Object.freeze({
        state,
        event:null,
        duplicate:false,
        gap:Object.freeze({expected_open_ts:expected,received_open_ts:candle.t}),
      });
    }
  }

  const strategy=findStrategy(state.strategy_id);
  const candles=[...state.candles,candle];
  const raw=strategy.signal(candles);
  const currentRaw=Number(raw.at(-1)??0);
  const before=state.target_position;
  let after=before;
  let rawSignalOpenTs=state.last_raw_signal_open_ts;

  if((strategy.mode??'REVERSAL')==='TARGET_POSITION'){
    if(VALID_TARGETS.has(currentRaw)){
      after=currentRaw;
      if(candles.length===1||Number(raw.at(-2)??0)!==currentRaw) rawSignalOpenTs=candle.t;
    }
  } else if(currentRaw===1||currentRaw===-1){
    after=currentRaw;
    rawSignalOpenTs=candle.t;
  }

  const historyHash=sha256(candles);
  let event=null;
  if(after!==before){
    event=makeSignalEvent({
      symbol:state.symbol,
      timeframe:state.timeframe,
      strategyId:state.strategy_id,
      strategyVersion:state.strategy_version,
      candleCloseTs:candle.t+state.interval_ms,
      transition:transitionOf(before,after),
      side:sideOf(after),
      stateBefore:before,
      stateAfter:after,
      inputsHash:historyHash,
    });
  }

  const next=freezeState({
    ...state,
    cursor_open_ts:candle.t,
    target_position:after,
    last_raw_signal_open_ts:rawSignalOpenTs,
    last_transition_open_ts:event?candle.t:state.last_transition_open_ts,
    last_event_id:event?.event_id??state.last_event_id,
    history_hash:historyHash,
    candles,
  });

  return Object.freeze({state:next,event,duplicate:false,gap:null});
}

export function replayStrategy(config,candles){
  let state=createStrategyState(config);
  const events=[];
  for(const candle of candles){
    const result=stepStrategy(state,candle);
    if(result.gap) throw new Error(`DATA_GAP_${result.gap.expected_open_ts}_${result.gap.received_open_ts}`);
    state=result.state;
    if(result.event) events.push(result.event);
  }
  return Object.freeze({state,events:Object.freeze(events)});
}

export function signalSnapshot(state){
  const barsSinceRaw=state.last_raw_signal_open_ts===null||state.cursor_open_ts===null
    ?null
    :Math.round((state.cursor_open_ts-state.last_raw_signal_open_ts)/state.interval_ms);
  const barsSinceTransition=state.last_transition_open_ts===null||state.cursor_open_ts===null
    ?null
    :Math.round((state.cursor_open_ts-state.last_transition_open_ts)/state.interval_ms);
  return Object.freeze({
    direction:sideOf(state.target_position),
    targetPosition:state.target_position,
    rawFresh:barsSinceRaw===0,
    rawSignalAgeBars:barsSinceRaw,
    transitionFresh:barsSinceTransition===0,
    transitionAgeBars:barsSinceTransition,
    lastClosedBarTime:state.cursor_open_ts,
    stateHash:state.state_hash,
  });
}
