import fs from 'node:fs';
import path from 'node:path';

function readNdjson(file){
  if(!fs.existsSync(file)) return [];
  const raw=fs.readFileSync(file,'utf8').trim();
  if(!raw) return [];
  return raw.split(/\r?\n/u).filter(Boolean).map(line=>JSON.parse(line));
}
function esc(v){
  const s=v==null?'':String(v);
  return /[",\r\n]/u.test(s)?'"'+s.replaceAll('"','""')+'"':s;
}
const outDir=path.resolve(process.argv[2]??'artifacts/nearpass-2y-baseline');
const seedFile=path.resolve(process.argv[3]??'research/nearpass-8of9-seeds.json');
const seeds=JSON.parse(fs.readFileSync(seedFile,'utf8')).seeds;

const results=[];
const monthly=[];
const failures=[];
for(const name of fs.readdirSync(outDir)){
  const file=path.join(outDir,name);
  if(/^results-.*\.ndjson$/u.test(name)) results.push(...readNdjson(file));
  else if(/^monthly-.*\.ndjson$/u.test(name)) monthly.push(...readNdjson(file));
  else if(/^failures-.*\.ndjson$/u.test(name)) failures.push(...readNdjson(file));
}
const rmap=new Map(results.map(r=>[[r.symbol,r.timeframe,r.id].join('|'),r]));
const fmap=new Map(failures.map(r=>[[r.symbol,r.timeframe].join('|'),r]));
const rows=[];
for(const seed of seeds){
  const key=[seed.symbol,seed.timeframe,seed.strategyId].join('|');
  const result=rmap.get(key);
  const failure=fmap.get([seed.symbol,seed.timeframe].join('|'));
  if(!result){
    let status='NO_RESULT';
    if(failure?.reason==='TOO_SHORT_HISTORY') status='SHORT_HISTORY';
    else if(failure?.reason==='PARTIAL_LIFETIME_COVERAGE') status='DATA_GAP';
    else if(failure?.reason==='ERROR') status='ERROR';
    rows.push({...seed,status,historyDays:failure?.historyDays??0,coverage:failure?.coverage??0,eligibleMonths:0,passMonths:0,passRatio:0,reason:failure?.reason??null});
    continue;
  }
  const months=monthly.filter(m=>
    m.symbol===seed.symbol&&m.timeframe===seed.timeframe&&m.id===seed.strategyId
  ).filter(m=>{
    const a=Date.parse(m.start),b=Date.parse(m.end);
    const days=Number.isFinite(a)&&Number.isFinite(b)?(b-a)/86400000:0;
    return days>=20 && Number(m.coverage??0)>=0.98;
  });
  const eligibleMonths=months.length;
  const passMonths=months.filter(m=>m.pass).length;
  const failedMonths=months.filter(m=>!m.pass).map(m=>m.month);
  let status='FULL_HISTORY';
  if(Number(result.historyDays)<540) status='SHORTER_LISTING_HISTORY';
  if(Number(result.historyDays)<180) status='YOUNG_COIN';
  const consistency=eligibleMonths
    ? (passMonths===eligibleMonths?'ALL_MONTHS_PASS'
      : passMonths===eligibleMonths-1?'ONE_MONTH_SHORT'
      : passMonths/eligibleMonths>=0.8?'GE80PCT'
      :'BELOW80PCT')
    :'NO_ELIGIBLE_MONTHS';
  rows.push({
    ...seed,
    status,
    consistency,
    firstBar:result.firstBar,
    lastBar:result.lastBar,
    historyDays:result.historyDays,
    coverage:result.coverage,
    eligibleMonths,
    passMonths,
    passRatio:eligibleMonths?passMonths/eligibleMonths:0,
    failedMonths,
    trades:result.n,
    winRate:result.wr,
    net:result.net,
    stressNet:result.net15,
    pf:result.pf,
    dd:result.dd,
    expectancy:result.exp,
    pass:result.pass,
  });
}
rows.sort((a,b)=>
  Number(b.passRatio??-1)-Number(a.passRatio??-1)
  || Number(b.net??-Infinity)-Number(a.net??-Infinity)
);
const summary={
  schemaVersion:1,
  test:'nearpass-8of9-2y-baseline',
  sourceSeedCount:seeds.length,
  requestedPeriod:'2024-09-28/2026-09-28',
  lifetimeAware:true,
  newCoinPolicy:'first available bar is effective start; <30d SHORT_HISTORY, shorter listings are not FAIL',
  monthEligibility:'>=20 day window and >=98% coverage',
  counts:{
    rows:rows.length,
    fullHistory:rows.filter(r=>r.status==='FULL_HISTORY').length,
    shorterListingHistory:rows.filter(r=>r.status==='SHORTER_LISTING_HISTORY').length,
    youngCoin:rows.filter(r=>r.status==='YOUNG_COIN').length,
    shortHistory:rows.filter(r=>r.status==='SHORT_HISTORY').length,
    dataGap:rows.filter(r=>r.status==='DATA_GAP').length,
    error:rows.filter(r=>r.status==='ERROR').length,
    allMonthsPass:rows.filter(r=>r.consistency==='ALL_MONTHS_PASS').length,
    oneMonthShort:rows.filter(r=>r.consistency==='ONE_MONTH_SHORT').length,
    ge80pct:rows.filter(r=>r.consistency==='GE80PCT').length,
  },
  rows
};
fs.writeFileSync(path.join(outDir,'nearpass-2y-seed-baseline.json'),JSON.stringify(summary,null,2)+'\n','utf8');
const fields=['symbol','timeframe','strategyId','status','consistency','firstBar','historyDays','coverage','eligibleMonths','passMonths','passRatio','failedMonths','trades','winRate','net','stressNet','pf','dd','expectancy','pass','sourceNet','sourcePF','sourceDD','sourceFailMonth'];
const csv=[fields.join(',')];
for(const r of rows) csv.push(fields.map(k=>esc(Array.isArray(r[k])?r[k].join(';'):r[k])).join(','));
fs.writeFileSync(path.join(outDir,'nearpass-2y-seed-baseline.csv'),csv.join('\n')+'\n','utf8');
console.log(JSON.stringify({
  status:'NEARPASS_2Y_BASELINE_READY',
  counts:summary.counts,
  top:rows.slice(0,10).map(r=>({symbol:r.symbol,timeframe:r.timeframe,strategyId:r.strategyId,status:r.status,passMonths:r.passMonths,eligibleMonths:r.eligibleMonths,net:r.net,pf:r.pf,dd:r.dd}))
}));
