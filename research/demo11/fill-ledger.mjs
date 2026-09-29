import { canonicalJson, validateLineage } from './contracts.mjs';

function freezeLedger(x){
  return Object.freeze({
    ...x,
    fills:Object.freeze([...(x.fills??[])]),
    incidents:Object.freeze([...(x.incidents??[])]),
    halted_symbols:Object.freeze([...(x.halted_symbols??[])]),
  });
}

export function createFillLedger(){
  return freezeLedger({schema_version:1,fills:[],incidents:[],halted_symbols:[]});
}

export function recordCanonicalFill(ledger,record){
  const symbol=String(record?.symbol??'UNKNOWN');
  const check=validateLineage(record);

  if(!check.ok){
    const incident=Object.freeze({
      type:'ORPHAN_FILL',
      symbol,
      fill_id:record?.fill_id??null,
      errors:Object.freeze([...check.errors]),
    });
    return Object.freeze({
      ledger:freezeLedger({
        ...ledger,
        incidents:[...ledger.incidents,incident],
        halted_symbols:[...new Set([...ledger.halted_symbols,symbol])],
      }),
      status:'ORPHAN_FILL',
      incident,
    });
  }

  const prior=ledger.fills.find(x=>x.fill_id===record.fill_id);
  if(prior){
    if(canonicalJson(prior)!==canonicalJson(record)) throw new Error('FILL_ID_CONFLICT');
    return Object.freeze({ledger,status:'DUPLICATE',incident:null});
  }

  return Object.freeze({
    ledger:freezeLedger({...ledger,fills:[...ledger.fills,Object.freeze({...record})]}),
    status:'RECORDED',
    incident:null,
  });
}
