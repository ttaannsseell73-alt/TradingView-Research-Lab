import fs from 'node:fs';
import path from 'node:path';

const root=process.argv[2]??'artifacts/all-timeframes';
const outDir=process.argv[3]??'artifacts/cross-timeframe';

function walk(dir,out=[]){
  for(const ent of fs.readdirSync(dir,{withFileTypes:true})){
    const p=path.join(dir,ent.name);
    if(ent.isDirectory()) walk(p,out);
    else if(/^STRATEGY_SELECTOR_90D_(1H|4H|1D|5M)\.json$/.test(ent.name)) out.push(p);
  }
  return out;
}
const files=walk(root);
if(files.length<4) throw new Error(`Expected 4 timeframe result files, found ${files.length}`);

const docs=files.map(file=>JSON.parse(fs.readFileSync(file,'utf8')));
const rows=docs.flatMap(d=>(d.rows??[]).map(r=>({...r,timeframe:r.timeframe??d.timeframe})));
const tfOrder={'5m':0,'1h':1,'4h':2,'1d':3};
const minTrades={'5m':30,'1h':20,'4h':10,'1d':3};
const median=xs=>{
  if(!xs.length) return 0;
  const a=[...xs].sort((x,y)=>x-y),m=Math.floor(a.length/2);
  return a.length%2?a[m]:(a[m-1]+a[m])/2;
};
const unique=xs=>[...new Set(xs)];
const reviewFlags=r=>{
  const f=[];
  if(r.n<(r.minTradesRequired??minTrades[r.timeframe]??20)) f.push('LOW_SAMPLE');
  if(!r.pass) f.push('NOT_EVIDENCE_PASS');
  if(r.dd>0.45) f.push('HIGH_DD');
  if(r.net>5) f.push('EXTREME_COMPOUNDING');
  if(r.pf>8) f.push('EXTREME_PF');
  if(r.posseg<2) f.push('UNSTABLE_SEGMENTS');
  if((r.coverage??1)<0.95) f.push('PARTIAL_COVERAGE');
  return f;
};
const rankable=r=>{
  const floor=Math.min(5,r.minTradesRequired??minTrades[r.timeframe]??20);
  return r.n>=floor&&r.net>0&&r.exp>0&&r.pf>1&&r.net15>0;
};

const normalized=rows.map(r=>({...r,reviewFlags:reviewFlags(r),rankable:rankable(r)}));
const candidates=normalized.filter(r=>r.rankable);
const evidence=normalized.filter(r=>r.pass);

// Preserve profitability-first Top 5 for every strategy x timeframe.
const groupMap=new Map();
for(const r of candidates){
  const k=`${r.id}::${r.timeframe}`;
  if(!groupMap.has(k)) groupMap.set(k,[]);
  groupMap.get(k).push(r);
}
const top5ByStrategyTimeframe=[...groupMap.entries()].map(([key,xs])=>{
  const [strategy,timeframe]=key.split('::');
  return {
    strategy,timeframe,
    top5:[...xs].sort((a,b)=>b.net-a.net).slice(0,5).map(r=>({
      symbol:r.symbol,net:r.net,pf:r.pf,dd:r.dd,trades:r.n,
      evidencePass:r.pass,positiveSegments:r.posseg,reviewFlags:r.reviewFlags
    }))
  };
}).sort((a,b)=>(tfOrder[a.timeframe]-tfOrder[b.timeframe])||a.strategy.localeCompare(b.strategy));

const bySymbol=new Map();
for(const r of candidates){
  if(!bySymbol.has(r.symbol)) bySymbol.set(r.symbol,[]);
  bySymbol.get(r.symbol).push(r);
}
const coinMatrix=[...bySymbol.entries()].map(([symbol,xs])=>{
  const ev=xs.filter(x=>x.pass);
  const families=unique(ev.map(x=>x.family));
  const strategies=unique(ev.map(x=>x.id));
  const timeframes=unique(ev.map(x=>x.timeframe)).sort((a,b)=>tfOrder[a]-tfOrder[b]);
  const clean=ev.filter(x=>x.dd<=0.40&&x.pf>=1.20&&x.net>0.10);
  return {
    symbol,
    evidenceCombinations:ev.length,
    evidenceTimeframes:timeframes,
    evidenceTimeframeCount:timeframes.length,
    evidenceStrategies:strategies,
    evidenceStrategyCount:strategies.length,
    evidenceFamilies:families,
    evidenceFamilyCount:families.length,
    cleanCombinations:clean.length,
    bestNet:Math.max(...xs.map(x=>x.net)),
    bestEvidenceNet:ev.length?Math.max(...ev.map(x=>x.net)):null,
    medianEvidenceNet:ev.length?median(ev.map(x=>x.net)):null,
    medianEvidenceDD:ev.length?median(ev.map(x=>x.dd)):null,
    maxEvidenceDD:ev.length?Math.max(...ev.map(x=>x.dd)):null,
    bestClean:clean.length?[...clean].sort((a,b)=>b.net-a.net).slice(0,5).map(r=>({
      strategy:r.id,timeframe:r.timeframe,net:r.net,pf:r.pf,dd:r.dd,trades:r.n
    })):[],
    allTop:[...xs].sort((a,b)=>b.net-a.net).slice(0,8).map(r=>({
      strategy:r.id,timeframe:r.timeframe,net:r.net,pf:r.pf,dd:r.dd,trades:r.n,
      evidencePass:r.pass,reviewFlags:r.reviewFlags
    }))
  };
});

// Management view: breadth first, then clean combinations, then profit.
// This is secondary to the pure profitability Top-5.
coinMatrix.sort((a,b)=>
  b.evidenceTimeframeCount-a.evidenceTimeframeCount||
  b.evidenceFamilyCount-a.evidenceFamilyCount||
  b.cleanCombinations-a.cleanCombinations||
  (b.bestEvidenceNet??-Infinity)-(a.bestEvidenceNet??-Infinity)
);

const managementWatchlist=coinMatrix.filter(x=>
  x.evidenceTimeframeCount>=2&&
  x.evidenceFamilyCount>=2&&
  x.cleanCombinations>=2
).slice(0,50);

const deploymentCandidates=coinMatrix.filter(x=>
  x.evidenceTimeframeCount>=3&&
  x.evidenceFamilyCount>=2&&
  x.cleanCombinations>=4&&
  x.medianEvidenceDD!=null&&x.medianEvidenceDD<=0.35
).sort((a,b)=>
  b.cleanCombinations-a.cleanCombinations||
  b.evidenceTimeframeCount-a.evidenceTimeframeCount||
  b.evidenceFamilyCount-a.evidenceFamilyCount||
  (b.bestEvidenceNet??-Infinity)-(a.bestEvidenceNet??-Infinity)
).slice(0,50);

const highProfitReview=[...candidates]
  .filter(r=>r.reviewFlags.length)
  .sort((a,b)=>b.net-a.net)
  .slice(0,100)
  .map(r=>({
    symbol:r.symbol,strategy:r.id,timeframe:r.timeframe,net:r.net,pf:r.pf,dd:r.dd,
    trades:r.n,evidencePass:r.pass,reviewFlags:r.reviewFlags
  }));

const timeframeSummary=docs.map(d=>({
  timeframe:d.timeframe,
  testedSymbols:d.testedSymbols,
  combinations:d.combinations,
  evidencePasses:(d.rows??[]).filter(r=>r.pass).length,
  strategies:(d.summary??[]).map(s=>({
    strategy:s.strategy,pass:s.pass,passRate:s.passRate,medianNet:s.medianNet,
    medianPF:s.medianPF,medianDD:s.medianDD,medianTrades:s.medianTrades
  }))
})).sort((a,b)=>tfOrder[a.timeframe]-tfOrder[b.timeframe]);

const out={
  schemaVersion:1,
  generatedAt:new Date().toISOString(),
  sourceWindow:docs[0]?.window,
  philosophy:{
    primary:'Profitability-first Top-5 remains the canonical opportunity ranking.',
    secondary:'Management watchlist rewards evidence across multiple timeframes and independent strategy families.',
    execution:'Backtest evidence only; live entry still requires current signal and execution/risk checks.'
  },
  counts:{
    sourceFiles:files.length,
    combinations:normalized.length,
    rankable:candidates.length,
    evidencePass:evidence.length,
    symbols:unique(normalized.map(r=>r.symbol)).length
  },
  timeframeSummary,
  top5ByStrategyTimeframe,
  managementWatchlist,
  deploymentCandidates,
  highProfitReview,
  coinMatrix
};

fs.mkdirSync(outDir,{recursive:true});
fs.writeFileSync(path.join(outDir,'CROSS_TIMEFRAME_BOARD.json'),JSON.stringify(out,null,2)+'\n');

const pc=x=>x==null?'':(100*x).toFixed(2)+'%';
const n2=x=>x==null?'':Number(x).toFixed(2);
const lines=[
  '# Cross-Timeframe Opportunity Board','',
  '**Primary:** profitability-first Top-5 by strategy/timeframe.  ',
  '**Secondary:** multi-timeframe + multi-family management watchlist.','',
  '## Timeframe evidence','',
  '| TF | Evidence PASS | Best broad strategy by PASS rate |',
  '|---|---:|---|'
];
for(const t of timeframeSummary){
  const best=[...t.strategies].sort((a,b)=>b.passRate-a.passRate)[0];
  lines.push(`| ${t.timeframe} | ${t.evidencePasses} | ${best?.strategy??''} (${pc(best?.passRate)}) |`);
}
lines.push('','## Management watchlist','',
  '| # | Coin | TF count | Families | Evidence combos | Clean combos | Best evidence net | Median DD |',
  '|---:|---|---:|---:|---:|---:|---:|---:|');
managementWatchlist.slice(0,30).forEach((x,i)=>lines.push(
  `| ${i+1} | ${x.symbol} | ${x.evidenceTimeframeCount} | ${x.evidenceFamilyCount} | ${x.evidenceCombinations} | ${x.cleanCombinations} | ${pc(x.bestEvidenceNet)} | ${pc(x.medianEvidenceDD)} |`
));
lines.push('','## Deployment candidates','',
  '| # | Coin | TF count | Families | Evidence combos | Clean combos | Best evidence net | Median DD |',
  '|---:|---|---:|---:|---:|---:|---:|---:|');
deploymentCandidates.slice(0,30).forEach((x,i)=>lines.push(
  `| ${i+1} | ${x.symbol} | ${x.evidenceTimeframeCount} | ${x.evidenceFamilyCount} | ${x.evidenceCombinations} | ${x.cleanCombinations} | ${pc(x.bestEvidenceNet)} | ${pc(x.medianEvidenceDD)} |`
));
lines.push('','## Highest-profit REVIEW cases','',
  '| # | Coin | Strategy | TF | Net | PF | DD | Trades | Flags |',
  '|---:|---|---|---|---:|---:|---:|---:|---|');
highProfitReview.slice(0,30).forEach((r,i)=>lines.push(
  `| ${i+1} | ${r.symbol} | ${r.strategy} | ${r.timeframe} | ${pc(r.net)} | ${n2(r.pf)} | ${pc(r.dd)} | ${r.trades} | ${r.reviewFlags.join(', ')} |`
));
fs.writeFileSync(path.join(outDir,'CROSS_TIMEFRAME_BOARD.md'),lines.join('\n')+'\n');

console.log(JSON.stringify({
  files:files.length,
  combinations:normalized.length,
  rankable:candidates.length,
  evidencePass:evidence.length,
  deployment:deploymentCandidates.slice(0,20).map(x=>({symbol:x.symbol,tf:x.evidenceTimeframes,families:x.evidenceFamilyCount,evidence:x.evidenceCombinations,clean:x.cleanCombinations,bestNet:x.bestEvidenceNet,medianDD:x.medianEvidenceDD})),
  watchlist:managementWatchlist.slice(0,20).map(x=>({
    symbol:x.symbol,tf:x.evidenceTimeframes,families:x.evidenceFamilyCount,
    evidence:x.evidenceCombinations,clean:x.cleanCombinations,bestNet:x.bestEvidenceNet,
    medianDD:x.medianEvidenceDD
  }))
},null,2));
