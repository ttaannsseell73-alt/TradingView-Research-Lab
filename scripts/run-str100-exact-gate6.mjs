import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const repo=path.resolve(process.argv[2]??'.');
const root=path.join(repo,'research','full-reset-20261001');
const matrix=JSON.parse(fs.readFileSync(path.join(root,'str100-source-audit','matrix.json'),'utf8')).include;
const plan=JSON.parse(fs.readFileSync(path.join(root,'plan-algo9-6m.json'),'utf8'));
const symbolsFile=path.join(root,'str100-active248.txt');
fs.writeFileSync(symbolsFile,plan.symbols.join('\n')+'\n','utf8');
const outRoot=path.join(root,'str100-exact-gate6');
fs.mkdirSync(outRoot,{recursive:true});
const maxConcurrent=Math.max(1,Number(process.env.STR100_CONCURRENCY??2));
const baseEnv={
  ...process.env,
  FREQTRADE_FUTURES_ROOT:'C:\\Users\\TANSEL\\Desktop\\SCALPING_LAB\\freqtrade\\user_data\\data\\binance\\futures',
  DATAHUB_PYTHON:'C:\\actions-runner-datahub\\.venv-datahub\\Scripts\\python.exe',
  EXACT_CSV_CACHE:path.join(root,'cache-6m'),
  EXACT_CHECKPOINT_ROOT:'C:\\actions-runner-datahub\\str100-fullreset-checkpoints',
  LOCAL_PARALLEL_SHARDS:'4',
  TURBO_SHARD_TIMEOUT_MS:'900000',
  TURBO_MAX_SHARD_RESTARTS:'20',
  EXACT_ENGINE_REV:'exact-provider-v2-binance-meta-20260929-active248-gate6',
  EXACT_SYMBOL_METADATA:path.join(repo,'research','binance-usdm-symbol-metadata.json'),
  PINE_SOURCE_CACHE:'C:\\actions-runner-datahub\\pine-source-cache',
  EXACT_MIN_COVERAGE:'0.98',
  EXACT_MIN_HISTORY_DAYS:'30',
  EXACT_MONTHLY_MIN_TRADES:'10',
  EXACT_START:'2026-04-01T00:00:00Z',
  EXACT_END:'2026-10-01T00:00:00Z',
  EXACT_SYMBOLS_FILE:symbolsFile,
  EXACT_MIN_UNIVERSE:'200',
  EXACT_TIMEFRAMES:'1m,5m,15m,1h,4h',
  TURBO_PINETS_MODE:'exact'
};
const state={startedAt:new Date().toISOString(),total:matrix.length,completed:0,running:[],results:[]};
const stateFile=path.join(root,'STR100_EXACT_GATE6_STATE.json');
const save=()=>fs.writeFileSync(stateFile,JSON.stringify(state,null,2)+'\n','utf8');

function runOne(x){
  return new Promise(resolve=>{
    const out=path.join(outRoot,x.key);
    fs.mkdirSync(out,{recursive:true});
    const log=fs.openSync(path.join(out,'controller.log'),'a');
    const env={...baseEnv,
      EXACT_KEY:x.key,EXACT_NAME:x.name??'',EXACT_AUTHOR:x.author??'',EXACT_ORIGIN:x.origin??'',
      EXACT_GROUP:x.group??'',EXACT_SCRIPT_ID:x.script_id_part??'',EXACT_SOURCE_SHA256:x.source_sha256,
      EXACT_PINE_VERSION:String(x.pine_version??''),EXACT_URL:x.url??'',EXACT_OUT_DIR:out
    };
    const child=spawn(process.execPath,['scripts/run-pinets-turbo-local.mjs'],{cwd:repo,env,stdio:['ignore',log,log]});
    const startedAt=new Date().toISOString();
    state.running.push({key:x.key,pid:child.pid,startedAt}); save();
    child.on('exit',(code,signal)=>{
      fs.closeSync(log);
      state.running=state.running.filter(r=>r.key!==x.key);
      const result={key:x.key,name:x.name,code,signal,startedAt,finishedAt:new Date().toISOString(),summary:fs.existsSync(path.join(out,'summary.json')),runtimeSkip:fs.existsSync(path.join(out,'runtime-skip.json'))};
      state.results.push(result); state.completed++; save();
      console.log(JSON.stringify({progress:`${state.completed}/${state.total}`,...result}),true);
      resolve(result);
    });
  });
}

let cursor=0;
async function worker(){while(cursor<matrix.length){const x=matrix[cursor++];await runOne(x);}}
save();
await Promise.all(Array.from({length:maxConcurrent},()=>worker()));
state.finishedAt=new Date().toISOString(); save();
console.log(JSON.stringify({status:'DONE',completed:state.completed,total:state.total,failed:state.results.filter(r=>r.code!==0).length,runtimeSkip:state.results.filter(r=>r.runtimeSkip).length}));
