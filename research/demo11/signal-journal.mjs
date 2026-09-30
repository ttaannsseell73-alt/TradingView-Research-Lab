import { canonicalJson, sha256 } from './contracts.mjs';

function freezeDoc(doc){
  return Object.freeze({
    ...doc,
    events:Object.freeze([...(doc.events??[])]),
    commits:Object.freeze([...(doc.commits??[])]),
  });
}

export function createSignalJournal(initialState){
  if(!initialState?.state_hash) throw new Error('INITIAL_STATE_HASH_REQUIRED');
  return freezeDoc({
    schema_version:1,
    head_state:initialState,
    events:[],
    commits:[],
  });
}

export function makeAtomicStrategyCommit({previousState,nextState,event=null}){
  if(!previousState?.state_hash||!nextState?.state_hash) throw new Error('STATE_HASH_REQUIRED');
  const envelope={
    from_state_hash:previousState.state_hash,
    to_state_hash:nextState.state_hash,
    cursor_open_ts:nextState.cursor_open_ts,
    next_state:nextState,
    event:event??null,
  };
  return Object.freeze({
    ...envelope,
    commit_id:'sc_'+sha256({
      from_state_hash:envelope.from_state_hash,
      to_state_hash:envelope.to_state_hash,
      cursor_open_ts:envelope.cursor_open_ts,
      event_id:event?.event_id??null,
    }).slice(0,32),
  });
}

export function applyAtomicStrategyCommit(journal,envelope){
  const existingCommit=(journal.commits??[]).find(x=>x.commit_id===envelope.commit_id);
  if(existingCommit){
    if(canonicalJson(existingCommit)!==canonicalJson({
      commit_id:envelope.commit_id,
      from_state_hash:envelope.from_state_hash,
      to_state_hash:envelope.to_state_hash,
      cursor_open_ts:envelope.cursor_open_ts,
      event_id:envelope.event?.event_id??null,
    })) throw new Error('COMMIT_ID_CONFLICT');
    return journal;
  }

  if(journal.head_state?.state_hash!==envelope.from_state_hash) throw new Error('JOURNAL_HEAD_MISMATCH');

  let events=[...(journal.events??[])];
  if(envelope.event){
    const prior=events.find(x=>x.event_id===envelope.event.event_id);
    if(prior&&canonicalJson(prior)!==canonicalJson(envelope.event)) throw new Error('SIGNAL_EVENT_ID_CONFLICT');
    if(!prior) events.push(envelope.event);
  }

  const compactCommit=Object.freeze({
    commit_id:envelope.commit_id,
    from_state_hash:envelope.from_state_hash,
    to_state_hash:envelope.to_state_hash,
    cursor_open_ts:envelope.cursor_open_ts,
    event_id:envelope.event?.event_id??null,
  });

  return freezeDoc({
    ...journal,
    head_state:envelope.next_state,
    events,
    commits:[...(journal.commits??[]),compactCommit],
  });
}
