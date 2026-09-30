import fs from 'node:fs';
import path from 'node:path';

const outDir=path.resolve(process.env.RESEARCH_OUT_DIR ?? 'artifacts/fib-ew-1y');
const checkpointDir=path.join(outDir,'checkpoints-0-of-1');

function esc(v){
  if(v==null) return '';
  const s=String(v);
  return /[",\r\n]/u.test(s)?'"'+s.replace(/"/g,'""')+'"':s;
}

const rows=[];
if(fs.existsSync(checkpointDir)){
  for(const name of fs.readdirSync(checkpointDir).filter(x=>/^task-\d{6}\.json$/u.test(x)).sort()){
    const cp=JSON.parse(fs.readFileSync(path.join(checkpointDir,name),'utf8'));
    for(const r of cp.results??[]) rows.push(r);
  }
}

for(const r of rows){
  const eligible=Number(r.monthlyEligibleMonths??0);
  const passed=Number(r.monthlyPassMonths??0);
  if(eligible>=9&&passed===eligible) r.robustnessGrade='A_ALL_MONTHS';
  else if(eligible>=9&&passed===eligible-1) r.robustnessGrade='B_ONE_MISS';
  else if(eligible>=6&&Number(r.net15??0)>0&&Number(r.pf??0)>1.05) r.robustnessGrade='C_POSITIVE_REVIEW';
  else r.robustnessGrade='FAIL_REVIEW';
}

const accepted=rows.filter(r=>r.robustnessGrade!=='FAIL_REVIEW');
accepted.sort((a,b)=>{
  const rank={A_ALL_MONTHS:0,B_ONE_MISS:1,C_POSITIVE_REVIEW:2};
  return (rank[a.robustnessGrade]??9)-(rank[b.robustnessGrade]??9)
    || Number(b.monthlyPassMonths??0)-Number(a.monthlyPassMonths??0)
    || Number(b.net15??-Infinity)-Number(a.net15??-Infinity)
    || Number(b.pf??-Infinity)-Number(a.pf??-Infinity)
    || Number(b.n??0)-Number(a.n??0);
});

const columns=['robustnessGrade','symbol','timeframe','id','name','version','monthlyPassMonths','monthlyEligibleMonths','monthlyPositiveMonths','monthlyStressPositiveMonths','n','wr','pf','net','net15','net6','dd','exp','sh','posseg','longTrades','longNet','longPF','shortTrades','shortNet','shortPF','coverage','historyDays','firstBar','lastBar'];
const lines=[columns.join(',')];
for(const r of accepted) lines.push(columns.map(c=>esc(r[c])).join(','));
fs.writeFileSync(path.join(outDir,'fib-ew-accepted.csv'),lines.join('\n')+'\n','utf8');

const byStrategy={};
for(const r of accepted){
  const x=byStrategy[r.id]??={accepted:0,allMonths:0,oneMiss:0,review:0};
  x.accepted++;
  if(r.robustnessGrade==='A_ALL_MONTHS') x.allMonths++;
  else if(r.robustnessGrade==='B_ONE_MISS') x.oneMiss++;
  else x.review++;
}
const byTimeframe={};
for(const tf of ['5m','15m','1h','4h']) byTimeframe[tf]={accepted:accepted.filter(r=>r.timeframe===tf).length};

const summary={
  schemaVersion:1,
  report:'Fibonacci/Elliott 1Y causal benchmark',
  totalCombinations:rows.length,
  accepted:accepted.length,
  byStrategy,
  byTimeframe,
  topAccepted:accepted.slice(0,250),
  note:'A=all eligible months pass; B=one monthly miss; C=positive stress-cost review only. No model is promoted from this report alone.'
};
fs.writeFileSync(path.join(outDir,'fib-ew-summary.json'),JSON.stringify(summary,null,2)+'\n','utf8');
console.log(JSON.stringify(summary));
