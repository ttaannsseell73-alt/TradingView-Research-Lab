import fs from 'node:fs';
import path from 'node:path';

const outDir=path.resolve(process.env.RESEARCH_OUT_DIR ?? 'artifacts/sr35-2026-full');
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
    for(const r of cp.results??[]) rows.push(r);
  }
}

const accepted=rows.filter(r=>r.monthlyGrade==='A_9_OF_9'||r.monthlyGrade==='B_8_OF_9');
accepted.sort((a,b)=>{
  const ga=a.monthlyGrade==='A_9_OF_9'?0:1;
  const gb=b.monthlyGrade==='A_9_OF_9'?0:1;
  return ga-gb
    || Number(b.net15??-Infinity)-Number(a.net15??-Infinity)
    || Number(b.pf??-Infinity)-Number(a.pf??-Infinity)
    || Number(b.n??0)-Number(a.n??0)
    || Number(a.dd??Infinity)-Number(b.dd??Infinity);
});

const columns=[
  'monthlyGrade','symbol','timeframe','id','name','version',
  'monthlyPassMonths','monthlyEligibleMonths','monthlyPositiveMonths','monthlyStressPositiveMonths',
  'n','wr','pf','net','net15','net6','dd','exp','sh','posseg',
  'coverage','historyDays','firstBar','lastBar'
];
const lines=[columns.join(',')];
for(const r of accepted) lines.push(columns.map(c=>esc(r[c])).join(','));
const acceptedFile=path.join(outDir,'accepted-9of9-8of9.csv');
fs.writeFileSync(acceptedFile,lines.join('\n')+'\n','utf8');

const byTf={};
for(const tf of ['1m','5m','15m','1h','4h']){
  const x=accepted.filter(r=>r.timeframe===tf);
  byTf[tf]={
    accepted:x.length,
    gradeA:x.filter(r=>r.monthlyGrade==='A_9_OF_9').length,
    gradeB:x.filter(r=>r.monthlyGrade==='B_8_OF_9').length,
    old10:x.filter(r=>!String(r.id).startsWith('sr25_')).length,
    new25:x.filter(r=>String(r.id).startsWith('sr25_')).length,
  };
}
const old10=accepted.filter(r=>!String(r.id).startsWith('sr25_'));
const new25=accepted.filter(r=>String(r.id).startsWith('sr25_'));

const summary={
  schemaVersion:1,
  totalCombinations:rows.length,
  accepted:accepted.length,
  gradeA9of9:accepted.filter(r=>r.monthlyGrade==='A_9_OF_9').length,
  gradeB8of9:accepted.filter(r=>r.monthlyGrade==='B_8_OF_9').length,
  old10Accepted:old10.length,
  new25Accepted:new25.length,
  byTimeframe:byTf,
  topAccepted:accepted.slice(0,100),
  note:'A_9_OF_9 is strongest monthly consistency. B_8_OF_9 is accepted. Shorter-history >=80% monthly pass candidates are intentionally not mixed into this mature 9-month acceptance table.'
};
const summaryFile=path.join(outDir,'accepted-summary.json');
fs.writeFileSync(summaryFile,JSON.stringify(summary,null,2)+'\n','utf8');
console.log(JSON.stringify({acceptedFile,summaryFile,...summary}));
