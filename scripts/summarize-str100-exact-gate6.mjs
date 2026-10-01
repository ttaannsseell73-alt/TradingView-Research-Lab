import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(process.argv[2]??'research/full-reset-20261001');
const outRoot=path.join(root,'str100-exact-gate6');
const months6=['2026-04','2026-05','2026-06','2026-07','2026-08','2026-09'];
const months3=['2026-07','2026-08','2026-09'];
const rows=[];
const strategyStatus=[];

if(fs.existsSync(outRoot)){
  for(const d of fs.readdirSync(outRoot,{withFileTypes:true}).filter(x=>x.isDirectory())){
    const dir=path.join(outRoot,d.name);
    const taskFile=path.join(dir,'task-results.ndjson');
    const summaryFile=path.join(dir,'summary.json');
    const skipFile=path.join(dir,'runtime-skip.json');
    const status={key:d.name,complete:fs.existsSync(summaryFile),runtimeSkip:fs.existsSync(skipFile),tasks:0,errors:0,pass3:0,pass6:0};
    if(fs.existsSync(taskFile)){
      for(const line of fs.readFileSync(taskFile,'utf8').split(/\r?\n/).filter(Boolean)){
        const r=JSON.parse(line);
        status.tasks++;
        if(r.status==='ERROR') status.errors++;
        if(r.status!=='OK') continue;
        const by=Object.fromEntries((r.monthly??[]).map(m=>[m.month,m]));
        const complete3=months3.every(m=>by[m]);
        const complete6=months6.every(m=>by[m]);
        const pass3=complete3&&months3.every(m=>by[m].pass===true);
        const pass6=complete6&&months6.every(m=>by[m].pass===true)&&r.full?.pass===true;
        if(pass3)status.pass3++;
        if(pass6)status.pass6++;
        rows.push({strategyKey:d.name,symbol:r.symbol,timeframe:r.timeframe,pass3,pass6,
          trades:r.full?.trades,winRate:r.full?.winRate,netPct:r.full?.netPct,profitFactor:r.full?.profitFactor,
          maxDrawdownPct:r.full?.maxDrawdownPct,passMonths:r.passMonths,positiveMonths:r.positiveMonths,monthly:r.monthly});
      }
    }
    strategyStatus.push(status);
  }
}
const p3=rows.filter(r=>r.pass3);
const p6=rows.filter(r=>r.pass6);
const sort=(a,b)=>Number(b.netPct??-Infinity)-Number(a.netPct??-Infinity)||Number(b.profitFactor??-Infinity)-Number(a.profitFactor??-Infinity);
p3.sort(sort);p6.sort(sort);
const esc=v=>{const s=v==null?'':String(v);return /[",\r\n]/u.test(s)?'"'+s.replaceAll('"','""')+'"':s;};
const cols=['strategyKey','symbol','timeframe','trades','winRate','netPct','profitFactor','maxDrawdownPct','passMonths','positiveMonths'];
function csv(file,data){const out=[cols.join(',')];for(const r of data)out.push(cols.map(k=>esc(r[k])).join(','));fs.writeFileSync(path.join(root,file),out.join('\n')+'\n','utf8');}
csv('STR100_EXACT_3M_PASS.csv',p3);csv('STR100_EXACT_6M_PASS.csv',p6);
const summary={generatedAt:new Date().toISOString(),strategies:strategyStatus.length,completeStrategies:strategyStatus.filter(x=>x.complete).length,
  runtimeSkippedStrategies:strategyStatus.filter(x=>x.runtimeSkip).length,totalOkRows:rows.length,pass3:p3.length,pass6:p6.length,
  strategyStatus:strategyStatus.sort((a,b)=>b.pass6-a.pass6||b.pass3-a.pass3||a.key.localeCompare(b.key)),
  top6:p6.slice(0,100)};
fs.writeFileSync(path.join(root,'STR100_EXACT_GATE6_SUMMARY.json'),JSON.stringify(summary,null,2)+'\n','utf8');
console.log(JSON.stringify({strategies:summary.strategies,complete:summary.completeStrategies,runtimeSkip:summary.runtimeSkippedStrategies,totalOkRows:summary.totalOkRows,pass3:summary.pass3,pass6:summary.pass6}));
