import fs from 'node:fs';
import path from 'node:path';
import { STRATEGIES, evaluateStrategies } from '../research/strategy_engine_v2.mjs';

const TF_MS = {'1m':60000,'5m':300000,'15m':900000,'1h':3600000,'4h':14400000};
const MIN_TRADES = {'1m':50,'5m':30,'15m':25,'1h':20,'4h':10};

function parseCsv(file){
  const raw=fs.readFileSync(file,'utf8').trim();
  if(!raw) return [];
  const lines=raw.split(/\r?\n/);
  return lines.slice(1).map(line=>{
    const [t,o,h,l,c,v]=line.split(',').map(Number);
    return {t,o,h,l,c,v};
  }).filter(b=>[b.t,b.o,b.h,b.l,b.c,b.v].every(Number.isFinite));
}

function stableMetric(row){
  const keys=['id','n','wr','net','pf','dd','exp','sh','posseg','net15','net6','longTrades','longWinRate','longNet','longPF','longDD','shortTrades','shortWinRate','shortNet','shortPF','shortDD','pass'];
  return Object.fromEntries(keys.map(k=>[k,row[k]]));
}

function equalNumber(a,b,tol=1e-12){
  if(Number.isNaN(a)&&Number.isNaN(b)) return true;
  if(!Number.isFinite(a)||!Number.isFinite(b)) return a===b;
  return Math.abs(a-b)<=tol*Math.max(1,Math.abs(a),Math.abs(b));
}

function deepMetricEqual(a,b){
  const ka=Object.keys(a);
  if(ka.length!==Object.keys(b).length) return false;
  for(const k of ka){
    if(typeof a[k]==='number' || typeof b[k]==='number'){
      if(!equalNumber(Number(a[k]),Number(b[k]))) return false;
    }else if(a[k]!==b[k]) return false;
  }
  return true;
}

const OLD10=[
  'sr_pivot_bounce','sr_pivot_breakout','sr_break_retest','sr_wick_rejection',
  'sr_liquidity_sweep','sr_range_edge','sr_prior_day_sweep','sr_level_flip',
  'sr_compression_breakout','sr_volume_breakout'
];

const SR25=[
  'sr25_fractal_cluster_rejection','sr25_confirmed_pivot_breakout','sr25_breakout_retest',
  'sr25_role_reversal_flip','sr25_wick_confirmed_zone','sr25_liquidity_sweep_reclaim',
  'sr25_liquidity_absorption','sr25_previous_day_sweep','sr25_week_month_sweep','sr25_lsob',
  'sr25_impulse_ob_retest','sr25_fvg_first_touch','sr25_inverse_fvg','sr25_pdh_fvg_mss',
  'sr25_supply_demand_retest','sr25_kernel_supply_demand','sr25_camarilla_h3_l3',
  'sr25_camarilla_h4_l4','sr25_narrow_cpr_breakout','sr25_poc_mean_reversion',
  'sr25_value_area_80','sr25_naked_poc_revisit','sr25_swing_anchored_vwap',
  'sr25_trendline_breakout','sr25_donchian_breakout'
];
const SR35=[...OLD10,...SR25];

const root=path.resolve(process.env.RESEARCH_CSV_DIR ?? 'artifacts/sr25-2026-full/csv');
const outDir=path.resolve(process.env.AUDIT_OUT_DIR ?? 'artifacts/sr35-integrity');
fs.mkdirSync(outDir,{recursive:true});

const start=Date.parse(process.env.AUDIT_START ?? '2026-01-01T00:00:00Z');
const end=Date.parse(process.env.AUDIT_END ?? '2026-09-20T00:00:00Z');
const cost=0.0014,stressCost=0.0015,lowCost=0.0006;

const targetCombos=[
  ['QUSDT','sr_prior_day_sweep'],
  ['QUSDT','sr_liquidity_sweep'],
  ['QUSDT','sr_range_edge'],
  ['QUSDT','sr_wick_rejection'],
  ['QUSDT','sr25_previous_day_sweep'],
  ['QUSDT','sr25_liquidity_sweep_reclaim'],
  ['QUSDT','sr25_liquidity_absorption'],
  ['FHEUSDT','sr_break_retest'],
  ['PIPPINUSDT','sr_volume_breakout'],
  ['TANSSIUSDT','sr_range_edge'],
  ['TLMUSDT','sr25_camarilla_h3_l3'],
  ['GUAUSDT','sr25_trendline_breakout'],
  ['GPSUSDT','sr25_liquidity_sweep_reclaim']
];

const determinism=[];
let deterministicFailures=0;
for(const [symbol,id] of targetCombos){
  for(const tf of Object.keys(TF_MS)){
    const file=path.join(root,symbol+'-'+tf+'.csv');
    if(!fs.existsSync(file)){
      deterministicFailures++;
      determinism.push({symbol,timeframe:tf,id,status:'MISSING_CSV'});
      continue;
    }
    const candles=parseCsv(file);
    const usable=candles.filter(b=>b.t>=start&&b.t<end);
    if(!usable.length){
      deterministicFailures++;
      determinism.push({symbol,timeframe:tf,id,status:'NO_DATA'});
      continue;
    }
    const effectiveStart=Math.max(start,usable[0].t);
    const opts={cost,stressCost,lowCost,minTrades:MIN_TRADES[tf],start:effectiveStart,end,strategyIds:[id]};
    const a=stableMetric(evaluateStrategies(usable,opts)[0]);
    const b=stableMetric(evaluateStrategies(usable,opts)[0]);
    const ok=deepMetricEqual(a,b);
    if(!ok) deterministicFailures++;
    determinism.push({symbol,timeframe:tf,id,status:ok?'PASS':'FAIL',first:a,second:b});
  }
}

const byId=new Map(STRATEGIES.map(s=>[s.id,s]));
const causality=[];
let causalityFailures=0;
for(const symbol of ['QUSDT','FHEUSDT']){
  const file=path.join(root,symbol+'-15m.csv');
  if(!fs.existsSync(file)){
    causalityFailures++;
    causality.push({symbol,timeframe:'15m',status:'MISSING_CSV'});
    continue;
  }
  const candles=parseCsv(file).filter(b=>b.t>=start&&b.t<end);
  for(const id of SR35){
    const strategy=byId.get(id);
    if(!strategy){
      causality.push({symbol,id,status:'MISSING_STRATEGY'});
      causalityFailures++;
      continue;
    }
    const full=strategy.signal(candles);
    const cuts=[0.12,0.25,0.40,0.55,0.70,0.85,0.97]
      .map(x=>Math.max(100,Math.min(candles.length-1,Math.floor(candles.length*x))));
    let mismatch=null;
    for(const cut of cuts){
      const prefixCandles=candles.slice(0,cut+1);
      const prefix=strategy.signal(prefixCandles);
      const upto=Math.min(prefix.length,full.length,cut+1);
      for(let i=0;i<upto;i++){
        const a=Number(full[i]??0),b=Number(prefix[i]??0);
        if(a!==b){
          mismatch={cut,index:i,full:a,prefix:b,time:candles[i]?.t??null};
          break;
        }
      }
      if(mismatch) break;
    }
    const ok=!mismatch;
    if(!ok) causalityFailures++;
    causality.push({symbol,timeframe:'15m',id,status:ok?'PASS':'FAIL',mismatch});
  }
}

const report={
  schemaVersion:1,
  audit:'SR35 integrity',
  sr35Count:SR35.length,
  old10Count:OLD10.length,
  new25Count:SR25.length,
  deterministicRepeat:{
    checked:determinism.filter(x=>x.status==='PASS'||x.status==='FAIL').length,
    failures:deterministicFailures,
    status:deterministicFailures===0?'PASS':'FAIL',
    note:'Same CSV + same parameters must reproduce the same metrics, including 1m/5m/15m/1h/4h on known strong systems.'
  },
  causalPrefixAudit:{
    checked:causality.filter(x=>x.status==='PASS'||x.status==='FAIL').length,
    failures:causalityFailures,
    status:causalityFailures===0?'PASS':'FAIL',
    note:'For sampled cut points, historical signals from a full run must exactly match signals recomputed using only data available up to that cut. Any mismatch indicates future-data leakage.'
  },
  executionModel:'Signals are executed at the NEXT candle open by backtest(), preventing same-bar close execution.',
  selectionBiasWarning:'Passing this audit rules out detected deterministic/future-data leakage in tested paths; it does not remove multiple-testing/selection bias. Monthly 9/9 and 8/9 consistency plus later holdout/paper validation remain required.',
  determinism,
  causality
};

const out=path.join(outDir,'sr35-integrity.json');
fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n','utf8');
console.log(JSON.stringify({
  out,
  sr35Count:SR35.length,
  deterministicRepeat:report.deterministicRepeat,
  causalPrefixAudit:report.causalPrefixAudit
}));

if(deterministicFailures||causalityFailures) process.exitCode=1;
