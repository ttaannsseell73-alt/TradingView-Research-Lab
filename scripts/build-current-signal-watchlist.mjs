import fs from 'node:fs';
import path from 'node:path';
import { evaluateCurrentSignals } from '../research/strategy_engine_v2.mjs';

const boardPath=process.argv[2];
const executionPath=process.argv[3];
const candlesDir=process.argv[4];
const outDir=process.argv[5]??'artifacts/current-signal';
if(!boardPath||!executionPath||!candlesDir){
  console.error('Usage: node scripts/build-current-signal-watchlist.mjs CROSS_BOARD.json EXECUTION_WATCHLIST.json CANDLES_DIR [OUT_DIR]');
  process.exit(2);
}

const board=JSON.parse(fs.readFileSync(boardPath,'utf8'));
const execution=JSON.parse(fs.readFileSync(executionPath,'utf8'));
const manifestPath=path.join(candlesDir,'manifest.json');
const manifest=fs.existsSync(manifestPath)?JSON.parse(fs.readFileSync(manifestPath,'utf8')):{snapshotAtMs:Date.now(),series:[]};
const intervalMs={ '5m':300000, '1h':3600000, '4h':14400000, '1d':86400000 };
const byUnder=new Map((board.deploymentCandidates??board.managementWatchlist??[]).map(x=>[x.underlying,x]));
const rank={STRONG:3,TRADEABLE:2,REVIEW:1,BLOCK:0,NO_MARKET_SNAPSHOT:-1};

function readCandles(symbol,timeframe){
  const p=path.join(candlesDir,`${symbol}__${timeframe}.json`);
  if(!fs.existsSync(p)) return null;
  const doc=JSON.parse(fs.readFileSync(p,'utf8'));
  return {doc,candles:doc.candles??[]};
}
function evidenceFlags(combo){
  const f=[];
  if(Number(combo.trades??0)<10) f.push('THIN_SAMPLE');
  if(Number(combo.pf??0)>8) f.push('EXTREME_PF');
  if(Number(combo.dd??0)>0.45) f.push('HIGH_DD');
  if(Number(combo.net??0)>5) f.push('EXTREME_COMPOUNDING');
  return f;
}
function actionStatus(execStatus,sig,flags){
  if(execStatus==='BLOCK'||execStatus==='NO_MARKET_SNAPSHOT') return 'BLOCKED';
  if(!sig||sig.direction==='FLAT') return 'FLAT';
  if(execStatus==='REVIEW') return 'OBSERVE_ONLY';
  if(flags.length) return 'EVIDENCE_REVIEW';
  if(sig.signalAgeBars===0) return 'FRESH_ENTRY';
  if(sig.signalAgeBars!=null&&sig.signalAgeBars<=2) return 'RECENT_SIGNAL';
  return 'ACTIVE_TREND';
}

const rows=[];
for(const ex of execution.candidates??[]){
  const candidate=byUnder.get(ex.underlying);
  if(!candidate) continue;
  const combos=[...(candidate.bestClean??[])];
  const seen=new Set();
  for(const combo of combos){
    const strategy=combo.strategy;
    const timeframe=combo.timeframe;
    const key=`${strategy}::${timeframe}`;
    if(seen.has(key)) continue;
    seen.add(key);
    const executionContract=ex.executionContract;
    if(!executionContract||!intervalMs[timeframe]) continue;

    const series=readCandles(executionContract,timeframe);
    if(!series||series.candles.length<20){
      rows.push({
        underlying:ex.underlying,
        executionContract,
        executionStatus:ex.executionStatus,
        evidenceContract:combo.contract,
        strategy,timeframe,
        status:'NO_CANDLES',
        evidence:{net:combo.net,pf:combo.pf,dd:combo.dd,trades:combo.trades}
      });
      continue;
    }

    const asOf=Number(series.doc.snapshotAtMs??manifest.snapshotAtMs??Date.now());
    const signal=evaluateCurrentSignals(series.candles,{
      asOf,
      intervalMs:intervalMs[timeframe],
      strategyIds:[strategy]
    })[0]??null;
    const flags=evidenceFlags(combo);
    const currentBar=series.doc.currentBar??null;
    const signalIndex=signal?.lastSignalTime==null
      ?-1
      :series.candles.findIndex(b=>Number(b.t)===Number(signal.lastSignalTime));
    const closedEntryBar=signalIndex>=0&&signalIndex+1<series.candles.length
      ?series.candles[signalIndex+1]
      :null;
    const openEntryBar=signalIndex===series.candles.length-1&&
      currentBar&&Number(currentBar.t)===Number(signal.lastClosedBarTime)+intervalMs[timeframe]
      ?currentBar
      :null;
    const canonicalEntryBar=closedEntryBar??openEntryBar;
    const canonicalEntryReady=Boolean(
      canonicalEntryBar&&
      Number.isFinite(Number(canonicalEntryBar.t))&&
      Number.isFinite(Number(canonicalEntryBar.o))
    );
    rows.push({
      underlying:ex.underlying,
      executionContract,
      executionStatus:ex.executionStatus,
      evidenceContract:combo.contract,
      contractTransfer:combo.contract!==executionContract,
      strategy,timeframe,
      status:actionStatus(ex.executionStatus,signal,flags),
      evidenceFlags:flags,
      directionConflict:false,
      direction:signal?.direction??'UNKNOWN',
      action:signal?.action??'UNKNOWN',
      fresh:signal?.fresh??false,
      signalAgeBars:signal?.signalAgeBars??null,
      lastSignalTime:signal?.lastSignalTime??null,
      lastClosedBarTime:signal?.lastClosedBarTime??null,
      barsUsed:signal?.barsUsed??0,
      canonicalEntryPrice:canonicalEntryReady?Number(canonicalEntryBar.o):null,
      canonicalEntryTime:canonicalEntryReady?Number(canonicalEntryBar.t):null,
      nextBarOpen:signal?.fresh&&canonicalEntryReady?Number(canonicalEntryBar.o):null,
      nextBarOpenTime:signal?.fresh&&canonicalEntryReady?Number(canonicalEntryBar.t):null,
      evidence:{net:combo.net,pf:combo.pf,dd:combo.dd,trades:combo.trades},
      market:ex.market??null
    });
  }
}

const freshDirections=new Map();
for(const x of rows){
  if(x.signalAgeBars!==0||!['LONG','SHORT'].includes(x.direction)) continue;
  if(!freshDirections.has(x.underlying)) freshDirections.set(x.underlying,new Set());
  freshDirections.get(x.underlying).add(x.direction);
}
for(const x of rows){
  const dirs=freshDirections.get(x.underlying);
  if(dirs&&dirs.size>1){
    x.directionConflict=true;
    if(['FRESH_ENTRY','RECENT_SIGNAL'].includes(x.status)) x.status='DIRECTION_CONFLICT';
  }
}

rows.sort((a,b)=>
  (b.status==='FRESH_ENTRY')-(a.status==='FRESH_ENTRY')||
  (b.status==='RECENT_SIGNAL')-(a.status==='RECENT_SIGNAL')||
  (rank[b.executionStatus]??-9)-(rank[a.executionStatus]??-9)||
  (b.evidence?.net??-Infinity)-(a.evidence?.net??-Infinity)
);

const freshSignals=rows.filter(x=>x.signalAgeBars===0&&['LONG','SHORT'].includes(x.direction));
const paperEntryQueue=rows.filter(x=>x.status==='FRESH_ENTRY'&&!x.directionConflict);
const paperIntentMap=new Map();
for(const x of paperEntryQueue){
  if(!paperIntentMap.has(x.underlying)) paperIntentMap.set(x.underlying,[]);
  paperIntentMap.get(x.underlying).push(x);
}
const paperIntents=[...paperIntentMap.entries()].map(([underlying,xs])=>{
  const directions=[...new Set(xs.map(x=>x.direction))];
  if(directions.length!==1) return null;
  const sorted=[...xs].sort((a,b)=>
    (rank[b.executionStatus]??-9)-(rank[a.executionStatus]??-9)||
    Number(b.evidence?.trades??0)-Number(a.evidence?.trades??0)||
    Number(b.evidence?.net??-Infinity)-Number(a.evidence?.net??-Infinity)
  );
  const lead=sorted[0];
  return {
    underlying,
    executionContract:lead.executionContract,
    direction:directions[0],
    executionStatus:lead.executionStatus,
    supportCount:xs.length,
    leadStrategy:lead.strategy,
    leadTimeframe:lead.timeframe,
    signalTime:lead.lastSignalTime,
    entryPrice:lead.canonicalEntryPrice,
    entryTime:lead.canonicalEntryTime,
    entryReady:Number.isFinite(lead.canonicalEntryPrice)&&Number.isFinite(lead.canonicalEntryTime),
    supportingSignals:xs.map(x=>({
      strategy:x.strategy,timeframe:x.timeframe,
      signalTime:x.lastSignalTime,
      canonicalEntryPrice:x.canonicalEntryPrice,
      canonicalEntryTime:x.canonicalEntryTime,
      nextBarOpen:x.nextBarOpen,
      nextBarOpenTime:x.nextBarOpenTime,
      evidence:x.evidence,contractTransfer:x.contractTransfer
    })),
    market:lead.market
  };
}).filter(x=>x&&x.entryReady).sort((a,b)=>
  b.supportCount-a.supportCount||
  (rank[b.executionStatus]??-9)-(rank[a.executionStatus]??-9)||
  Number(b.supportingSignals?.[0]?.evidence?.trades??0)-Number(a.supportingSignals?.[0]?.evidence?.trades??0)
);
const recentSignalCandidates=rows.filter(x=>x.status==='RECENT_SIGNAL');
const reviewSignals=rows.filter(x=>['EVIDENCE_REVIEW','DIRECTION_CONFLICT','OBSERVE_ONLY'].includes(x.status)&&x.direction!=='FLAT');
const activeWatch=rows.filter(x=>['FRESH_ENTRY','RECENT_SIGNAL','ACTIVE_TREND','OBSERVE_ONLY','EVIDENCE_REVIEW','DIRECTION_CONFLICT'].includes(x.status)&&x.direction!=='FLAT');
const flat=rows.filter(x=>x.status==='FLAT');

const out={
  schemaVersion:1,
  generatedAt:new Date().toISOString(),
  snapshotAtMs:manifest.snapshotAtMs??null,
  semantics:{
    candle:'confirmed closed candle only',
    execution:'signal on closed candle; next-bar-open remains canonical execution assumption',
    fresh:'signalAgeBars = 0',
    recent:'signalAgeBars <= 2; informational, not equivalent to fresh entry',
    paper:'FRESH_ENTRY requires STRONG/TRADEABLE execution, no evidence review flags and no conflicting fresh direction; no real orders are placed',
    evidenceReview:'THIN_SAMPLE (<10 trades), EXTREME_PF (>8), HIGH_DD (>45%) or EXTREME_COMPOUNDING (>500%) remain visible but are excluded from paper-entry queue',
    directionConflict:'Opposing fresh LONG/SHORT signals on the same underlying are visible but excluded from paper-entry queue'
  },
  counts:{
    evaluated:rows.length,
    freshSignals:freshSignals.length,
    paperEntrySignals:paperEntryQueue.length,
    paperIntents:paperIntents.length,
    recentSignal:recentSignalCandidates.length,
    reviewSignals:reviewSignals.length,
    directionConflicts:rows.filter(x=>x.directionConflict).length,
    active:activeWatch.length,
    flat:flat.length,
    missingCandles:rows.filter(x=>x.status==='NO_CANDLES').length
  },
  paperIntents,
  paperEntryQueue,
  freshSignals,
  recentSignalCandidates,
  reviewSignals,
  activeWatch,
  rows
};

fs.mkdirSync(outDir,{recursive:true});
fs.writeFileSync(path.join(outDir,'CURRENT_SIGNAL_WATCHLIST.json'),JSON.stringify(out,null,2)+'\n');

const pc=x=>x==null?'':(100*Number(x)).toFixed(2)+'%';
const lines=[
  '# Current Signal / Paper Shadow Watchlist','',
  'Closed-candle only. FRESH_ENTRY means the strategy changed direction on the latest confirmed candle. No real orders are placed.','',
  '## Paper position intents','',
  '| Underlying | Contract | Dir | Exec | Support | Lead strategy | Lead TF |',
  '|---|---|---|---|---:|---|---|'
];
for(const x of paperIntents){
  lines.push(`| ${x.underlying} | ${x.executionContract} | ${x.direction} | ${x.executionStatus} | ${x.supportCount} | ${x.leadStrategy} | ${x.leadTimeframe} |`);
}
lines.push('','## Eligible fresh signals','',
  '| Underlying | Contract | Strategy | TF | Dir | Exec | Net | PF | DD | Contract transfer |',
  '|---|---|---|---|---|---|---:|---:|---:|---|');
for(const x of paperEntryQueue){
  lines.push(`| ${x.underlying} | ${x.executionContract} | ${x.strategy} | ${x.timeframe} | ${x.direction} | ${x.executionStatus} | ${pc(x.evidence.net)} | ${Number(x.evidence.pf).toFixed(2)} | ${pc(x.evidence.dd)} | ${x.contractTransfer?'YES':'NO'} |`);
}
lines.push('','## Fresh signals under review','',
  '| Underlying | Contract | Strategy | TF | Dir | State | Evidence flags | Conflict | Exec |',
  '|---|---|---|---|---|---|---|---|---|');
for(const x of freshSignals.filter(x=>x.status!=='FRESH_ENTRY')){
  lines.push(`| ${x.underlying} | ${x.executionContract} | ${x.strategy} | ${x.timeframe} | ${x.direction} | ${x.status} | ${(x.evidenceFlags??[]).join(', ')} | ${x.directionConflict?'YES':'NO'} | ${x.executionStatus} |`);
}
lines.push('','## Active / recent watch','',
  '| Underlying | Contract | Strategy | TF | Dir | Age bars | State | Exec |',
  '|---|---|---|---|---|---:|---|---|');
for(const x of activeWatch.slice(0,80)){
  lines.push(`| ${x.underlying} | ${x.executionContract} | ${x.strategy} | ${x.timeframe} | ${x.direction} | ${x.signalAgeBars??''} | ${x.status} | ${x.executionStatus} |`);
}
fs.writeFileSync(path.join(outDir,'CURRENT_SIGNAL_WATCHLIST.md'),lines.join('\n')+'\n');

console.log(JSON.stringify(out.counts));
