import fs from 'node:fs';
import path from 'node:path';
import { updateShadowState } from './build-shadow-journal.mjs';

const previousPath=process.argv[2];
const reconciliationPath=process.argv[3];
const outDir=process.argv[4]??'artifacts/shadow-reconciliation';
if(!previousPath||!reconciliationPath){
  console.error('Usage: node scripts/apply-shadow-reconciliation.mjs PREVIOUS_STATE.json RECONCILIATION.json [OUT_DIR]');
  process.exit(2);
}

const previous=JSON.parse(fs.readFileSync(previousPath,'utf8'));
const rec=JSON.parse(fs.readFileSync(reconciliationPath,'utf8'));
if(rec.schemaVersion!==1) throw new Error('Unsupported reconciliation schema');
if(!Number.isFinite(Number(rec.observedAtMs))) throw new Error('observedAtMs is required');

const rows=(rec.marks??[]).map(x=>({
  underlying:x.underlying,
  executionContract:x.executionContract,
  executionStatus:x.executionStatus??'TRADEABLE',
  strategy:x.strategy??null,
  timeframe:x.timeframe??null,
  status:'ACTIVE_TREND',
  direction:x.direction??'UNKNOWN',
  evidenceFlags:[],
  directionConflict:false,
  market:{mid:Number(x.markPrice),last:Number(x.markPrice)}
}));

const paperIntents=(rec.reversals??[]).map(x=>({
  underlying:x.underlying,
  executionContract:x.executionContract,
  direction:x.newDirection,
  executionStatus:x.executionStatus??'TRADEABLE',
  supportCount:Number(x.supportCount??1),
  leadStrategy:x.strategy,
  leadTimeframe:x.timeframe,
  signalTime:Number(x.signalTime),
  entryPrice:Number(x.entryPrice),
  entryTime:Number(x.entryTime),
  entryReady:true,
  source:'MANUAL_RECONCILIATION',
  supportingSignals:[{
    strategy:x.strategy,
    timeframe:x.timeframe,
    signalTime:Number(x.signalTime),
    evidence:x.evidence??null,
    contractTransfer:false
  }],
  market:{mid:Number(x.markPrice),last:Number(x.markPrice)}
}));

const current={
  snapshotAtMs:Number(rec.observedAtMs),
  dataAvailable:true,
  paperIntents,
  recentSignalCandidates:[],
  rows
};

const state=updateShadowState(current,previous);
state.lastReconciliation={
  observedAtMs:Number(rec.observedAtMs),
  source:rec.source??'manual',
  note:rec.note??null,
  reversals:(rec.reversals??[]).length,
  marks:(rec.marks??[]).length
};

fs.mkdirSync(outDir,{recursive:true});
fs.writeFileSync(path.join(outDir,'SHADOW_STATE.json'),JSON.stringify(state,null,2)+'\n');
fs.writeFileSync(path.join(outDir,'RECONCILIATION_APPLIED.json'),JSON.stringify(rec,null,2)+'\n');
console.log(JSON.stringify({
  summary:state.summary,
  reconciliation:state.lastReconciliation,
  open:state.positions.map(p=>({
    underlying:p.underlying,direction:p.direction,entryPrice:p.entryPrice,
    markPrice:p.markPrice??null,netIfClosed:p.unrealizedNetIfClosed??null,
    pnlRef:p.unrealizedPnlPerReferenceNotional??null,source:p.intentSource
  })),
  latestClosed:[...state.closedTrades].slice(-10).map(t=>({
    underlying:t.underlying,direction:t.direction,exitPrice:t.exitPrice,
    exitReason:t.exitReason,netReturn:t.netReturn,pnlRef:t.pnlPerReferenceNotional
  }))
}));
