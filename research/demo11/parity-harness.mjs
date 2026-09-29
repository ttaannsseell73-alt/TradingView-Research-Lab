import { createStrategyState, stepStrategy } from './strategy-core.mjs';
import { createSignalJournal, makeAtomicStrategyCommit, applyAtomicStrategyCommit } from './signal-journal.mjs';
import { canonicalJson, sha256 } from './contracts.mjs';

function readonlyRuntimeConsume(event){
  // Serialization boundary only. This consumer has no exchange/order capability.
  return Object.freeze(JSON.parse(canonicalJson(event)));
}

export function runTripleEventParity({config,candles}){
  let researchState=createStrategyState(config);
  let runtimeState=createStrategyState(config);
  let shadowJournal=createSignalJournal(researchState);

  const research=[];
  const shadow=[];
  const runtime=[];

  for(const candle of candles){
    const rr=stepStrategy(researchState,candle);
    if(rr.gap) throw new Error('RESEARCH_DATA_GAP');
    const env=makeAtomicStrategyCommit({previousState:researchState,nextState:rr.state,event:rr.event});
    researchState=rr.state;
    shadowJournal=applyAtomicStrategyCommit(shadowJournal,env);

    const rt=stepStrategy(runtimeState,candle);
    if(rt.gap) throw new Error('RUNTIME_DATA_GAP');
    runtimeState=rt.state;

    if(Boolean(rr.event)!==Boolean(rt.event)) throw new Error('EVENT_PRESENCE_MISMATCH');
    if(rr.event&&rt.event&&rr.event.event_id!==rt.event.event_id) throw new Error('EVENT_ID_MISMATCH');

    if(rr.event){
      research.push(sha256(rr.event));
      shadow.push(sha256(shadowJournal.events.at(-1)));
      runtime.push(sha256(readonlyRuntimeConsume(rt.event)));
    }
  }

  return Object.freeze({
    research:Object.freeze(research),
    shadow:Object.freeze(shadow),
    runtime:Object.freeze(runtime),
    research_state_hash:researchState.state_hash,
    runtime_state_hash:runtimeState.state_hash,
  });
}
