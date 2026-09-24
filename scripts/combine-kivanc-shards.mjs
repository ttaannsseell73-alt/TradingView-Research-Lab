import fs from 'node:fs';
import path from 'node:path';

const inDir=process.argv[2]??'artifacts/strategy-shards';
const outDir=process.argv[3]??'artifacts/strategy-final';
const timeframe=process.argv[4]??process.env.TIMEFRAME??'1h';
const safeTf=timeframe.toUpperCase().replace(/[^A-Z0-9]/g,'');
const files=fs.readdirSync(inDir).filter(x=>/^results-shard-\d+\.json$/.test(x)).sort((a,b)=>Number(a.match(/\d+/)[0])-Number(b.match(/\d+/)[0]));
if(!files.length) throw new Error('No shard result files found');
const rows=[],failures=[];
for(const file of files){
  const d=JSON.parse(fs.readFileSync(path.join(inDir,file),'utf8'));
  if(d.timeframe&&d.timeframe!==timeframe) throw new Error(`Timeframe mismatch in ${file}: ${d.timeframe} != ${timeframe}`);
  rows.push(...d.results); failures.push(...d.failures);
}
const median=xs=>{if(!xs.length)return 0;const a=[...xs].sort((x,y)=>x-y),m=Math.floor(a.length/2);return a.length%2?a[m]:(a[m-1]+a[m])/2};
const ids=[...new Set(rows.map(r=>r.id))].sort();
const summary=ids.map(id=>{
  const x=rows.filter(r=>r.id===id),p=x.filter(r=>r.pass);
  return {strategy:id,strategyName:x[0]?.name??id,family:x[0]?.family??'unknown',version:x[0]?.version??'unknown',mode:x[0]?.mode??'REVERSAL',
    tested:x.length,pass:p.length,passRate:x.length?p.length/x.length:0,positive:x.filter(r=>r.net>0).length,
    positiveRate:x.length?x.filter(r=>r.net>0).length/x.length:0,medianNet:median(x.map(r=>r.net)),medianPF:median(x.map(r=>r.pf)),
    medianDD:median(x.map(r=>r.dd)),medianTrades:median(x.map(r=>r.n))};
});
const top=rows.filter(r=>r.pass).sort((a,b)=>b.net-a.net).slice(0,100);
const bySymbol=new Map();
for(const r of rows){if(!r.pass)continue;const a=bySymbol.get(r.symbol)??[];a.push(r);bySymbol.set(r.symbol,a);}
const multi=[...bySymbol.entries()].map(([symbol,x])=>({symbol,passingStrategies:x.length,strategies:x.map(r=>r.id),bestNet:Math.max(...x.map(r=>r.net))}))
 .sort((a,b)=>b.passingStrategies-a.passingStrategies||b.bestNet-a.bestNet);
const final={schemaVersion:2,generatedAt:new Date().toISOString(),window:{start:'2026-06-24T00:00:00Z',end:'2026-09-24T00:00:00Z'},timeframe,
 execution:{signal:'confirmed closed candle',entry:'next bar open',modes:['REVERSAL','TARGET_POSITION'],roundTripCost:0.0014,stressCost:0.0015,lowCostSensitivity:0.0006,funding:'excluded'},
 universeSnapshot:565,testedSymbols:new Set(rows.map(r=>r.symbol)).size,failedOrPartialSymbols:new Set(failures.map(f=>f.symbol)).size,
 combinations:rows.length,summary,top,multiStrategySymbols:multi,failures,rows};
fs.mkdirSync(outDir,{recursive:true});
const jsonName=`STRATEGY_SELECTOR_90D_${safeTf}.json`;
fs.writeFileSync(path.join(outDir,jsonName),JSON.stringify(final,null,2)+'\n');
const head=['symbol','strategy','strategyName','family','version','mode','timeframe','candles','rawCandles','trades','winRate','netReturn','profitFactor','maxDrawdown','expectancy','tradeSharpe','positiveSegments','netAt15bps','netAt6bps','pass'];
const esc=v=>{const s=String(v??'');return /[,"\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s};
const csv=[head.join(',')];
for(const r of [...rows].sort((a,b)=>b.net-a.net)) csv.push([r.symbol,r.id,r.name??r.id,r.family??'',r.version??'',r.mode??'REVERSAL',r.timeframe,r.candles,r.rawCandles,r.n,r.wr,r.net,r.pf,r.dd,r.exp,r.sh,r.posseg,r.net15,r.net6,r.pass].map(esc).join(','));
fs.writeFileSync(path.join(outDir,'leaderboard.csv'),csv.join('\n')+'\n');
const pc=x=>(100*x).toFixed(2)+'%',nn=x=>Number.isFinite(x)?x.toFixed(2):'∞';
const md=[`# Strategy Selector — Binance USDⓈ-M Futures — 90 gün / ${timeframe}`,'','**Pencere:** 2026-06-24 → 2026-09-24 UTC  ','**Sinyal:** kapanmış mum → bir sonraki mum açılışı  ','**Canonical round-trip maliyet:** 14 bps; stres: 15 bps; duyarlılık: 6 bps  ','**Funding:** hariç','','## Strateji özeti','',
'| Strateji | Mode | Test | PASS | PASS oranı | Net pozitif | Medyan net | Medyan PF | Medyan DD | Medyan işlem |',
'|---|---|---:|---:|---:|---:|---:|---:|---:|---:|'];
for(const s of summary) md.push(`| ${s.strategyName} (${s.strategy}) | ${s.mode} | ${s.tested} | ${s.pass} | ${pc(s.passRate)} | ${s.positive} | ${pc(s.medianNet)} | ${nn(s.medianPF)} | ${pc(s.medianDD)} | ${nn(s.medianTrades)} |`);
md.push('','## En güçlü 30 PASS kombinasyonu','',
'| # | Coin | Strateji | İşlem | Win | Net | PF | Max DD | Pozitif alt dönem | 15 bps net |',
'|---:|---|---|---:|---:|---:|---:|---:|---:|---:|');
top.slice(0,30).forEach((r,i)=>md.push(`| ${i+1} | ${r.symbol} | ${r.id} | ${r.n} | ${pc(r.wr)} | ${pc(r.net)} | ${nn(r.pf)} | ${pc(r.dd)} | ${r.posseg}/3 | ${pc(r.net15)} |`));
md.push('','PASS: ≥20 işlem, 14 bps sonrası net>0 ve expectancy>0, PF>1.05, en az 2/3 pozitif alt dönem ve 15 bps stres maliyetinde net>0.');
fs.writeFileSync(path.join(outDir,'SUMMARY.md'),md.join('\n')+'\n');
console.log(JSON.stringify({timeframe,files:files.length,testedSymbols:final.testedSymbols,failedOrPartial:final.failedOrPartialSymbols,summary,top:top.slice(0,10),multi:multi.slice(0,10),jsonName},null,2));
