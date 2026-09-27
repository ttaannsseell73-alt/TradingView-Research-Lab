import fs from 'node:fs';
import path from 'node:path';

const outDir=path.resolve(process.env.RESEARCH_OUT_DIR ?? 'artifacts/sr35-12m-heavy');
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
  if(eligible>=9 && passed===eligible) r.robustnessGrade='A_ALL_MONTHS';
  else if(eligible>=9 && passed===eligible-1) r.robustnessGrade='B_ONE_MISS';
  else r.robustnessGrade='REVIEW';
}

const accepted=rows.filter(r=>r.robustnessGrade==='A_ALL_MONTHS'||r.robustnessGrade==='B_ONE_MISS');
accepted.sort((a,b)=>{
  const ga=a.robustnessGrade==='A_ALL_MONTHS'?0:1;
  const gb=b.robustnessGrade==='A_ALL_MONTHS'?0:1;
  return ga-gb
    || Number(b.monthlyPassMonths??0)-Number(a.monthlyPassMonths??0)
    || Number(b.net15??-Infinity)-Number(a.net15??-Infinity)
    || Number(b.pf??-Infinity)-Number(a.pf??-Infinity)
    || Number(b.n??0)-Number(a.n??0);
});

const columns=[
  'robustnessGrade','symbol','timeframe','id','name','version',
  'monthlyPassMonths','monthlyEligibleMonths','monthlyPositiveMonths','monthlyStressPositiveMonths',
  'n','wr','pf','net','net15','net6','dd','exp','sh','posseg',
  'coverage','historyDays','firstBar','lastBar'
];
const lines=[columns.join(',')];
for(const r of accepted) lines.push(columns.map(c=>esc(r[c])).join(','));
const acceptedFile=path.join(outDir,'accepted-all-months-one-miss.csv');
fs.writeFileSync(acceptedFile,lines.join('\n')+'\n','utf8');

const byTf={};
for(const tf of ['1m','5m','15m','1h','4h']){
  const x=accepted.filter(r=>r.timeframe===tf);
  byTf[tf]={
    accepted:x.length,
    allMonths:x.filter(r=>r.robustnessGrade==='A_ALL_MONTHS').length,
    oneMiss:x.filter(r=>r.robustnessGrade==='B_ONE_MISS').length,
  };
}

const summary={
  schemaVersion:1,
  report:'SR35 12M heavy robustness',
  totalCombinations:rows.length,
  accepted:accepted.length,
  allMonths:accepted.filter(r=>r.robustnessGrade==='A_ALL_MONTHS').length,
  oneMiss:accepted.filter(r=>r.robustnessGrade==='B_ONE_MISS').length,
  byTimeframe:byTf,
  topAccepted:accepted.slice(0,200),
  note:'A_ALL_MONTHS = every eligible monthly segment passed with at least 9 eligible months. B_ONE_MISS = exactly one eligible monthly segment failed. This report adapts automatically when the requested window spans 12 or 13 calendar-month segments.'
};
const summaryFile=path.join(outDir,'accepted-summary.json');
fs.writeFileSync(summaryFile,JSON.stringify(summary,null,2)+'\n','utf8');
console.log(JSON.stringify({acceptedFile,summaryFile,...summary}));
