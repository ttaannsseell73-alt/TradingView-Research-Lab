import fs from 'node:fs';
import path from 'node:path';

const root=path.resolve(process.argv[2] ?? 'research/full-reset-20261001');
const families=['algo9','sr35','sweep20','visual28','fib9'];

function countCheckpoints(dir){
  if(!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter(x=>/^checkpoints-\d+-of-\d+$/u.test(x))
    .reduce((n,d)=>n+fs.readdirSync(path.join(dir,d)).filter(x=>/^task-\d{6}\.json$/u.test(x)).length,0);
}
function readJson(file){
  try{return JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/u,''));}catch{return null;}
}
const rows=[];
for(const family of families){
  const plan=readJson(path.join(root,'plan-'+family+'-6m.json'));
  const dir=path.join(root,'out-'+family);
  const expected=plan ? new Set(plan.symbols).size*new Set(plan.timeframes).size : 0;
  const done=countCheckpoints(dir);
  const s=readJson(path.join(dir,'MASTER_STATUS.json'));
  rows.push({
    family, expectedTasks:expected, completedTasks:done,
    progressPct:expected?Number((100*done/expected).toFixed(2)):0,
    complete:Boolean(s),
    tested:s?.tested??null, pass3:s?.pass3??null, pass6:s?.pass6??null,
    failures:s?.taskFailures??null
  });
}
const sep=readJson(path.join(root,'sep30-validation.json'));
const master=readJson(path.join(root,'MASTER_STATUS.json'));
const health=readJson(path.join(root,'coin_health.json'));
const run=readJson(path.join(root,'RUN_STATE.json'));
const status={
  generatedAt:new Date().toISOString(),
  runId:'full-reset-20261001',
  universe:{active:527,eligible6m:503,stage1Tradeable:248},
  sep30:{checkedSeries:sep?.checkedSeries??null,bad:sep?.bad?.length??null},
  families:rows,
  master:master?{tested:master.testedCombinations,pass3:master.pass3,pass6:master.pass6,failures:master.taskFailures}:null,
  health:health?{symbols:Object.keys(health.symbols??{}).length}:null,
  runState:run
};
fs.writeFileSync(path.join(root,'LIVE_STATUS.json'),JSON.stringify(status,null,2)+'\n');
console.log(JSON.stringify(status,null,2));
