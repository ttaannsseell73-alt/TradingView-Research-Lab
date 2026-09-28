import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PineTS } from 'pinets';

const dir=path.resolve(process.env.RECOVERY_VARIANT_DIR || process.argv[2] || '.');
const metaFile=path.join(dir,'recovery-meta.json');
if(!fs.existsSync(metaFile)) throw new Error('recovery-meta.json missing');
const meta=JSON.parse(fs.readFileSync(metaFile,'utf8'));
if(!Array.isArray(meta.variants)||meta.variants.length===0){
  fs.writeFileSync(path.join(dir,'selection.json'),JSON.stringify({status:'RECOVERY_NO_VARIANT'},null,2)+'\n');
  process.exit(0);
}

const root=process.env.FREQTRADE_FUTURES_ROOT;
const python=process.env.DATAHUB_PYTHON || 'python';
const cache=path.resolve(process.env.RECOVERY_CSV_CACHE || 'C:/actions-runner-datahub/exact-source-csv-cache-2026');
fs.mkdirSync(cache,{recursive:true});
const csv=path.join(cache,'BTCUSDT-15m.csv');
if(!fs.existsSync(csv)||fs.statSync(csv).size<64){
  const run=spawnSync(python,[
    path.resolve('scripts/export-freqtrade-feather.py'),
    '--root',root,'--symbol','BTCUSDT','--timeframe','15m',
    '--start','2026-01-01T00:00:00Z','--end','2026-09-20T00:00:00Z',
    '--output',csv
  ],{encoding:'utf8',maxBuffer:64*1024*1024});
  if(run.status!==0) throw new Error('smoke data export failed: '+(run.stderr||run.stdout||''));
}
function parseCsv(file){
  const lines=fs.readFileSync(file,'utf8').trim().split(/\r?\n/);
  const rows=[];
  for(let i=Math.max(1,lines.length-5000);i<lines.length;i++){
    const p=lines[i].split(','); if(p.length<6) continue;
    const [t,o,h,l,c,v]=p.slice(0,6).map(Number);
    if([t,o,h,l,c,v].every(Number.isFinite)) rows.push({openTime:t,open:o,high:h,low:l,close:c,volume:v});
  }
  return rows;
}
const candles=parseCsv(csv);
const attempts=[];
let selected=null;
for(const variant of meta.variants){
  const file=path.join(dir,variant.file);
  if(!fs.existsSync(file)) continue;
  const source=fs.readFileSync(file,'utf8');
  try{
    const pine=new PineTS(candles);
    const ctx=await pine.run(source);
    const hasStrategy=!!ctx?.strategy;
    const trades=Array.isArray(ctx?.strategy?.closedtrades)?ctx.strategy.closedtrades.length:0;
    attempts.push({type:variant.type,file:variant.file,status:hasStrategy?'RUNNABLE_STRATEGY':'RUNNABLE_NOT_STRATEGY',smokeTrades:trades});
    if(hasStrategy){
      selected={...variant,smokeTrades:trades};
      fs.copyFileSync(file,path.join(dir,'selected.pine'));
      break;
    }
  }catch(error){
    attempts.push({type:variant.type,file:variant.file,status:'RUNTIME_FAIL',error:String(error?.message||error).slice(0,2000)});
  }
}
const selection=selected
  ? {status:'RECOVERY_SELECTED',selected,attempts}
  : {status:'RECOVERY_RUNTIME_UNRESOLVED',attempts};
fs.writeFileSync(path.join(dir,'selection.json'),JSON.stringify(selection,null,2)+'\n','utf8');
if(selected){
  process.stdout.write(JSON.stringify({status:'RECOVERY_SELECTED',type:selected.type,smokeTrades:selected.smokeTrades})+'\n');
}else{
  process.stdout.write(JSON.stringify({status:'RECOVERY_RUNTIME_UNRESOLVED',attempts})+'\n');
}
