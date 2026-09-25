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
function actionStatus(execStatus,sig,evidenceContract,executionContract){
  if(execStatus==='BLOCK'||execStatus==='NO_MARKET_SNAPSHOT') return 'BLOCKED';
  if(!sig||sig.direction==='FLAT') return 'FLAT';
  if(execStatus==='REVIEW') return 'OBSERVE_ONLY';
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
    rows.push({
      underlying:ex.underlying,
      executionContract,
      executionStatus:ex.executionStatus,
      evidenceContract:combo.contract,
      contractTransfer:combo.contract!==executionContract,
      strategy,timeframe,
      status:actionStatus(ex.executionStatus,signal,combo.contract,executionContract),
      direction:signal?.direction??'UNKNOWN',
      action:signal?.action??'UNKNOWN',
      fresh:signal?.fresh??false,
      signalAgeBars:signal?.signalAgeBars??null,
      lastSignalTime:signal?.lastSignalTime??null,
      lastClosedBarTime:signal?.lastClosedBarTime??null,
      barsUsed:signal?.barsUsed??0,
      evidence:{net:combo.net,pf:combo.pf,dd:combo.dd,trades:combo.trades},
      market:ex.market??null
    });
  }
}

rows.sort((a,b)=>
  (b.status==='FRESH_ENTRY')-(a.status==='FRESH_ENTRY')||
  (b.status==='RECENT_SIGNAL')-(a.status==='RECENT_SIGNAL')||
  (rank[b.executionStatus]??-9)-(rank[a.executionStatus]??-9)||
  (b.evidence?.net??-Infinity)-(a.evidence?.net??-Infinity)
);

const freshEntryCandidates=rows.filter(x=>x.status==='FRESH_ENTRY');
const recentSignalCandidates=rows.filter(x=>x.status==='RECENT_SIGNAL');
const activeWatch=rows.filter(x=>['FRESH_ENTRY','RECENT_SIGNAL','ACTIVE_TREND','OBSERVE_ONLY'].includes(x.status)&&x.direction!=='FLAT');
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
    paper:'FRESH_ENTRY on STRONG/TRADEABLE contracts is the paper-entry queue; no real orders are placed'
  },
  counts:{
    evaluated:rows.length,
    freshEntry:freshEntryCandidates.length,
    recentSignal:recentSignalCandidates.length,
    active:activeWatch.length,
    flat:flat.length,
    missingCandles:rows.filter(x=>x.status==='NO_CANDLES').length
  },
  freshEntryCandidates,
  recentSignalCandidates,
  activeWatch,
  rows
};

fs.mkdirSync(outDir,{recursive:true});
fs.writeFileSync(path.join(outDir,'CURRENT_SIGNAL_WATCHLIST.json'),JSON.stringify(out,null,2)+'\n');

const pc=x=>x==null?'':(100*Number(x)).toFixed(2)+'%';
const lines=[
  '# Current Signal / Paper Shadow Watchlist','',
  'Closed-candle only. FRESH_ENTRY means the strategy changed direction on the latest confirmed candle. No real orders are placed.','',
  '## Fresh paper entries','',
  '| Underlying | Contract | Strategy | TF | Dir | Exec | Net | PF | DD | Contract transfer |',
  '|---|---|---|---|---|---|---:|---:|---:|---|'
];
for(const x of freshEntryCandidates){
  lines.push(`| ${x.underlying} | ${x.executionContract} | ${x.strategy} | ${x.timeframe} | ${x.direction} | ${x.executionStatus} | ${pc(x.evidence.net)} | ${Number(x.evidence.pf).toFixed(2)} | ${pc(x.evidence.dd)} | ${x.contractTransfer?'YES':'NO'} |`);
}
lines.push('','## Active / recent watch','',
  '| Underlying | Contract | Strategy | TF | Dir | Age bars | State | Exec |',
  '|---|---|---|---|---|---:|---|---|');
for(const x of activeWatch.slice(0,80)){
  lines.push(`| ${x.underlying} | ${x.executionContract} | ${x.strategy} | ${x.timeframe} | ${x.direction} | ${x.signalAgeBars??''} | ${x.status} | ${x.executionStatus} |`);
}
fs.writeFileSync(path.join(outDir,'CURRENT_SIGNAL_WATCHLIST.md'),lines.join('\n')+'\n');

console.log(JSON.stringify(out.counts));
