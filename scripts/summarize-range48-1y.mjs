import fs from 'node:fs';
import path from 'node:path';

const outDir=path.resolve(process.env.RESEARCH_OUT_DIR ?? 'artifacts/range48-1y-15m');
const checkpointDirs=fs.existsSync(outDir)
  ? fs.readdirSync(outDir)
      .filter(name=>/^checkpoints-\d+-of-\d+$/u.test(name))
      .sort()
      .map(name=>path.join(outDir,name))
  : [];

function esc(v){
  if(v==null) return '';
  const s=String(v);
  return /[",\r\n]/u.test(s)?'"'+s.replace(/"/g,'""')+'"':s;
}

const rows=[];
for(const checkpointDir of checkpointDirs){
  for(const name of fs.readdirSync(checkpointDir).filter(x=>/^task-\d{6}\.json$/u.test(x)).sort()){
    const cp=JSON.parse(fs.readFileSync(path.join(checkpointDir,name),'utf8'));
    for(const r of cp.results??[]){
      const months=(cp.monthlyResults??[]).filter(m=>m.id===r.id);
      const eligible=months.length;
      const pass=months.filter(m=>m.pass).length;
      const positive=months.filter(m=>Number(m.net)>0).length;
      const stressPositive=months.filter(m=>Number(m.net15)>0).length;
      const monthly=months.map(m=>({
        month:m.month,
        pass:Boolean(m.pass),
        n:m.n,
        pf:m.pf,
        net:m.net,
        net15:m.net15,
        dd:m.dd
      }));
      rows.push({...r,eligibleMonths:eligible,passMonths:pass,positiveMonths:positive,stressPositiveMonths:stressPositive,monthly});
    }
  }
}

rows.sort((a,b)=>
  Number(b.passMonths)-Number(a.passMonths)
  || Number(b.stressPositiveMonths)-Number(a.stressPositiveMonths)
  || Number(b.pf??-Infinity)-Number(a.pf??-Infinity)
  || Number(b.net15??-Infinity)-Number(a.net15??-Infinity)
  || Number(a.dd??Infinity)-Number(b.dd??Infinity)
);

const full12=rows.filter(r=>r.eligibleMonths>=12);
const top=full12.filter(r=>r.passMonths>=10);
const columns=['symbol','timeframe','id','passMonths','eligibleMonths','positiveMonths','stressPositiveMonths','n','wr','pf','net','net15','dd','exp','coverage','historyDays','firstBar','lastBar'];
const lines=[columns.join(',')];
for(const r of top) lines.push(columns.map(c=>esc(r[c])).join(','));
fs.writeFileSync(path.join(outDir,'range48-1y-top-12m.csv'),lines.join('\n')+'\n','utf8');

const summary={
  schemaVersion:1,
  strategy:'swp_range48_reclaim',
  timeframe:'15m',
  totalSymbols:rows.length,
  full12MonthSymbols:full12.length,
  pass12of12:full12.filter(r=>r.passMonths===12).length,
  pass11of12:full12.filter(r=>r.passMonths===11).length,
  pass10of12:full12.filter(r=>r.passMonths===10).length,
  topCandidates:top.slice(0,200)
};
fs.writeFileSync(path.join(outDir,'range48-1y-summary.json'),JSON.stringify(summary,null,2)+'\n','utf8');
console.log(JSON.stringify({
  totalSymbols:summary.totalSymbols,
  full12MonthSymbols:summary.full12MonthSymbols,
  pass12of12:summary.pass12of12,
  pass11of12:summary.pass11of12,
  pass10of12:summary.pass10of12,
  top:summary.topCandidates.slice(0,20).map(x=>({symbol:x.symbol,passMonths:x.passMonths,pf:x.pf,net:x.net,dd:x.dd,n:x.n}))
},null,2));
