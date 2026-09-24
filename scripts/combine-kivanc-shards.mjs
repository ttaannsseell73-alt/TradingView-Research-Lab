import fs from 'node:fs';
import path from 'node:path';

const inDir = process.argv[2] ?? 'artifacts/kivanc-shards';
const outDir = process.argv[3] ?? 'artifacts/kivanc-final';
const files = fs.readdirSync(inDir).filter(x => /^results-shard-\d+\.json$/.test(x)).sort((a,b)=>Number(a.match(/\d+/)[0])-Number(b.match(/\d+/)[0]));
if (!files.length) throw new Error('No shard result files found');
const rows = [], failures = [];
for (const file of files) {
  const d = JSON.parse(fs.readFileSync(path.join(inDir,file),'utf8'));
  rows.push(...d.results); failures.push(...d.failures);
}
const ids = ['pmax','alphatrend','ott','tott','mavilimw'];
const median = xs => { if (!xs.length) return 0; const a=[...xs].sort((x,y)=>x-y); const m=Math.floor(a.length/2); return a.length%2?a[m]:(a[m-1]+a[m])/2; };
const summary = ids.map(id => {
  const x=rows.filter(r=>r.id===id), p=x.filter(r=>r.pass);
  return {strategy:id, tested:x.length, pass:p.length, passRate:x.length?p.length/x.length:0,
    positive:x.filter(r=>r.net>0).length, positiveRate:x.length?x.filter(r=>r.net>0).length/x.length:0,
    medianNet:median(x.map(r=>r.net)), medianPF:median(x.map(r=>r.pf)), medianDD:median(x.map(r=>r.dd)),
    medianTrades:median(x.map(r=>r.n))};
});
const top=rows.filter(r=>r.pass).sort((a,b)=>b.net-a.net).slice(0,100);
const bySymbol = new Map();
for (const r of rows) {
  if (!r.pass) continue;
  const a=bySymbol.get(r.symbol)??[]; a.push(r); bySymbol.set(r.symbol,a);
}
const multi=[...bySymbol.entries()].map(([symbol,x])=>({symbol,passingStrategies:x.length,strategies:x.map(r=>r.id),bestNet:Math.max(...x.map(r=>r.net))})).sort((a,b)=>b.passingStrategies-a.passingStrategies||b.bestNet-a.bestNet);
const final={schemaVersion:1,generatedAt:new Date().toISOString(),window:{start:'2026-06-24T00:00:00Z',end:'2026-09-24T00:00:00Z'},timeframe:'1h',
  execution:{signal:'closed candle',entry:'next bar open',roundTripCost:0.0014,stressCost:0.0015,lowCostSensitivity:0.0006,funding:'excluded'},
  universeSnapshot:565,testedSymbols:new Set(rows.map(r=>r.symbol)).size,failedOrPartialSymbols:new Set(failures.map(f=>f.symbol)).size,
  combinations:rows.length,summary,top,multiStrategySymbols:multi,failures,rows};
fs.mkdirSync(outDir,{recursive:true});
fs.writeFileSync(path.join(outDir,'KIVANC_TOP5_90D_1H.json'),JSON.stringify(final,null,2)+'\n');
const head=['symbol','strategy','candles','trades','winRate','netReturn','profitFactor','maxDrawdown','expectancy','tradeSharpe','positiveSegments','netAt15bps','netAt6bps','pass'];
const esc=v=>{const s=String(v??'');return /[,"\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s};
const csv=[head.join(',')];
for(const r of [...rows].sort((a,b)=>b.net-a.net)) csv.push([r.symbol,r.id,r.candles,r.n,r.wr,r.net,r.pf,r.dd,r.exp,r.sh,r.posseg,r.net15,r.net6,r.pass].map(esc).join(','));
fs.writeFileSync(path.join(outDir,'leaderboard.csv'),csv.join('\n')+'\n');
const pc=x=>(100*x).toFixed(2)+'%', nn=x=>Number.isFinite(x)?x.toFixed(2):'∞';
const md=['# Kıvanç Top-5 — Binance USDⓈ-M Futures — 90 gün / 1h','',
'**Pencere:** 2026-06-24 → 2026-09-24 UTC  ',
'**Sinyal:** kapanmış mum → bir sonraki mum açılışı  ',
'**Canonical round-trip maliyet:** 14 bps; stres kontrolü: 15 bps; duyarlılık: 6 bps  ',
'**Funding:** hariç','',
'## Strateji özeti','',
'| Strateji | Test | PASS | PASS oranı | Net pozitif | Medyan net | Medyan PF | Medyan DD | Medyan işlem |',
'|---|---:|---:|---:|---:|---:|---:|---:|---:|'];
for(const s of summary) md.push(`| ${s.strategy} | ${s.tested} | ${s.pass} | ${pc(s.passRate)} | ${s.positive} | ${pc(s.medianNet)} | ${nn(s.medianPF)} | ${pc(s.medianDD)} | ${nn(s.medianTrades)} |`);
md.push('','## En güçlü 30 PASS kombinasyonu','',
'| # | Coin | Strateji | İşlem | Win | Net | PF | Max DD | Pozitif alt dönem | 15 bps net |',
'|---:|---|---|---:|---:|---:|---:|---:|---:|---:|');
top.slice(0,30).forEach((r,i)=>md.push(`| ${i+1} | ${r.symbol} | ${r.id} | ${r.n} | ${pc(r.wr)} | ${pc(r.net)} | ${nn(r.pf)} | ${pc(r.dd)} | ${r.posseg}/3 | ${pc(r.net15)} |`));
md.push('','PASS: ≥20 işlem, 14 bps sonrası net>0 ve expectancy>0, PF>1.05, 3 kronolojik alt dönemin en az 2’si pozitif ve 15 bps stres maliyetinde de net>0.');
fs.writeFileSync(path.join(outDir,'SUMMARY.md'),md.join('\n')+'\n');
console.log(JSON.stringify({files:files.length,testedSymbols:final.testedSymbols,failedOrPartial:final.failedOrPartialSymbols,summary,top:top.slice(0,10),multi:multi.slice(0,10)},null,2));
