import { replay } from './replay.js';
import type { Candle, CanonicalFeatureVector, Direction, FeatureRow, GateStatus, StudyWindow } from './types.js';

export interface TakerOneMinuteRow extends Candle { takerBuyVolume: number; }
export interface OpenInterestFiveMinuteRow { timestamp: number; openInterest: number; openInterestValue: number; }
export interface SonarScalpV4Config {
  minTriggerScore: number;
  minTakerImbalance: number;
  minRelativeVolume: number;
  maxOpposingContext: number;
  cooldownBars: number;
}
export interface SonarScalpV4Event {
  index: number; timestamp: number; direction: Direction; triggerScore: number;
  takerImbalance: number; oiDelta: number; contextScore: number; strength: number;
}
export interface ExitProfile { name: string; takeProfit: number; stopLoss: number; maxHoldBars: number; }
export interface SonarScalpV4Outcome extends SonarScalpV4Event {
  entryIndex: number; exitIndex: number; exitReason: 'TP'|'SL'|'TIME';
  entryPrice: number; exitPrice: number; grossReturn: number; netReturn: number; mae: number; mfe: number;
}
export interface SonarScalpV4Stats {
  sampleCount: number; hitRate: number; grossExpectancy: number; expectancy: number; profitFactor: number;
  averageWin: number; averageLoss: number; averageMae: number; averageMfe: number;
  tpRate: number; slRate: number; timeRate: number;
}
export interface SonarScalpV4CostRun {
  costScenario: string; feeRate: number; slippageRate: number; selectedProfile: ExitProfile;
  train: SonarScalpV4Stats; validation: SonarScalpV4Stats; holdout: SonarScalpV4Stats;
  status: GateStatus; reasons: string[];
}
export interface SonarScalpV4Report {
  oneMinuteCount: number; fiveMinuteCount: number; oiCount: number; eventCount: number;
  config: SonarScalpV4Config; profileCandidates: ExitProfile[]; runs: SonarScalpV4CostRun[];
  decision: { status: GateStatus; passedRuns: number; totalRuns: number; reasons: string[] };
  replay: { oneMinute: string; fiveMinute: string };
}

const DEFAULT_CONFIG: SonarScalpV4Config = {
  minTriggerScore: 0.20, minTakerImbalance: 0.12, minRelativeVolume: 0.90,
  maxOpposingContext: 0.25, cooldownBars: 2,
};
const EXIT_PROFILES: ExitProfile[] = [
  { name: 'tight', takeProfit: 0.0020, stopLoss: 0.0012, maxHoldBars: 5 },
  { name: 'medium', takeProfit: 0.0030, stopLoss: 0.0018, maxHoldBars: 8 },
  { name: 'wide', takeProfit: 0.0040, stopLoss: 0.0025, maxHoldBars: 12 },
];
const COSTS = [
  { name: 'base', feeRate: 0.0004, slippageRate: 0.0001 },
  { name: 'stress', feeRate: 0.0005, slippageRate: 0.0003 },
] as const;

const mean=(v:number[])=>v.length?v.reduce((a,b)=>a+b,0)/v.length:0;
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
function contextScore(f: CanonicalFeatureVector): number {
  return clamp(f.ExternalStructure*0.5+f.InternalStructure*0.3+f.TrendRangeScore*0.2,-1,1);
}
function triggerScore(f: CanonicalFeatureVector): number {
  const c:number[]=[];
  if(f.RetestQuality!==0)c.push(f.RetestQuality);
  if(f.CHOCHStrength!==0)c.push(f.CHOCHStrength);
  if(f.BOSStrength!==0)c.push(f.BOSStrength);
  if(f.SweepDepth!==0&&f.ReclaimQuality!==0&&Math.sign(f.SweepDepth)===Math.sign(f.ReclaimQuality)){
    c.push(Math.sign(f.ReclaimQuality)*(Math.abs(f.ReclaimQuality)*0.65+Math.abs(f.SweepDepth)*0.35));
  }
  return c.sort((a,b)=>Math.abs(b)-Math.abs(a))[0]??0;
}
function inferIntervalMs(c:Candle[]):number{
  if(c.length<2)throw new Error('At least two candles required');
  const counts=new Map<number,number>();
  for(let i=1;i<c.length;i++){const a=c[i-1],b=c[i];if(!a||!b)continue;const d=b.timestamp-a.timestamp;if(d>0)counts.set(d,(counts.get(d)??0)+1);}
  return [...counts.entries()].sort((a,b)=>b[1]-a[1]||a[0]-b[0])[0]?.[0]??0;
}
function latestClosedIndex(ts:number,oneMs:number,five:Candle[],fiveMs:number):number{
  const close=ts+oneMs;let lo=0,hi=five.length-1,ans=-1;
  while(lo<=hi){const m=Math.floor((lo+hi)/2),c=five[m];if(!c)break;if(c.timestamp+fiveMs<=close){ans=m;lo=m+1;}else hi=m-1;}return ans;
}

export function parseTakerOneMinuteCsv(text:string):TakerOneMinuteRow[]{
  const lines=text.trim().split(/\r?\n/);if(!lines.length)return[];
  const h=lines[0]?.split(',')??[];const m=new Map(h.map((n,i)=>[n,i] as const));
  const col=(n:string)=>{const x=m.get(n);if(x===undefined)throw new Error('Missing taker 1m column: '+n);return x;};
  return lines.slice(1).filter(Boolean).map(line=>{const p=line.split(',');
    const r:TakerOneMinuteRow={timestamp:Number(p[col('timestamp')]),open:Number(p[col('open')]),high:Number(p[col('high')]),
      low:Number(p[col('low')]),close:Number(p[col('close')]),volume:Number(p[col('volume')]),
      takerBuyVolume:Number(p[col('takerBuyVolume')]),closed:true};
    if(!Number.isFinite(r.timestamp+r.open+r.high+r.low+r.close+r.volume+r.takerBuyVolume))throw new Error('Invalid taker row');
    if(r.takerBuyVolume<0||r.takerBuyVolume>r.volume+1e-9)throw new Error('Invalid taker buy volume');return r;});
}
export function parseOpenInterestFiveMinuteCsv(text:string):OpenInterestFiveMinuteRow[]{
  const lines=text.trim().split(/\r?\n/);if(!lines.length)return[];
  const h=lines[0]?.split(',')??[];const m=new Map(h.map((n,i)=>[n,i] as const));
  const col=(n:string)=>{const x=m.get(n);if(x===undefined)throw new Error('Missing OI column: '+n);return x;};
  return lines.slice(1).filter(Boolean).map(line=>{const p=line.split(',');
    const r={timestamp:Number(p[col('timestamp')]),openInterest:Number(p[col('openInterest')]),openInterestValue:Number(p[col('openInterestValue')])};
    if(Object.values(r).some(x=>!Number.isFinite(x)))throw new Error('Invalid OI row');return r;});
}

export function detectSonarScalpV4EventsFromRows(
  one:TakerOneMinuteRow[], oneRows:FeatureRow[], five:Candle[], fiveRows:FeatureRow[], oiRows:OpenInterestFiveMinuteRow[],
  config:Partial<SonarScalpV4Config>={}
):SonarScalpV4Event[]{
  if(one.length!==oneRows.length||five.length!==fiveRows.length)throw new Error('feature length mismatch');
  const s={...DEFAULT_CONFIG,...config}, oneMs=inferIntervalMs(one), fiveMs=inferIntervalMs(five);
  const oiDelta=new Map<number,number>();
  for(let i=1;i<oiRows.length;i++){const a=oiRows[i-1],b=oiRows[i];if(a&&b&&a.openInterest>0)oiDelta.set(b.timestamp,(b.openInterest-a.openInterest)/a.openInterest);}
  const out:SonarScalpV4Event[]=[];let last=-Infinity;
  for(let i=0;i<one.length;i++){
    if(i-last<=s.cooldownBars)continue;const c=one[i],r=oneRows[i];if(!c||!r||c.volume<=0)continue;
    const fi=latestClosedIndex(c.timestamp,oneMs,five,fiveMs);if(fi<0)continue;
    const fc=five[fi],fr=fiveRows[fi];if(!fc||!fr)continue;const od=oiDelta.get(fc.timestamp);if(od===undefined||od<=0)continue;
    const tr=triggerScore(r.features);if(tr===0||Math.abs(tr)<s.minTriggerScore)continue;
    const dir=(tr>0?1:-1) as Direction;const ti=(2*c.takerBuyVolume-c.volume)/c.volume;
    if(ti*dir<s.minTakerImbalance||r.features.RelativeVolume<s.minRelativeVolume)continue;
    const ctx=contextScore(fr.features);if(ctx*dir<-s.maxOpposingContext)continue;
    out.push({index:i,timestamp:c.timestamp,direction:dir,triggerScore:tr,takerImbalance:ti,oiDelta:od,contextScore:ctx,
      strength:clamp(Math.abs(tr)*(1+Math.abs(ti))*(1+Math.min(0.02,od)*25)*clamp(r.features.RelativeVolume,0.5,2),0,8)});
    last=i;
  }return out;
}
const signed=(entry:number,price:number,d:Direction)=>d*(price-entry)/entry;

export function evaluateSonarScalpV4Events(
  candles:TakerOneMinuteRow[],events:SonarScalpV4Event[],profile:ExitProfile,
  cost:{feeRate:number;slippageRate:number},window?:StudyWindow
):SonarScalpV4Outcome[]{
  const rt=2*(cost.feeRate+cost.slippageRate),start=window?.startIndex??0,end=window?.endIndexExclusive??candles.length,out:SonarScalpV4Outcome[]=[];
  for(const e of events){
    const ei=e.index+1;if(e.index<start||ei<start||ei>=end)continue;const entry=candles[ei];if(!entry||entry.open<=0)continue;
    const final=Math.min(ei+profile.maxHoldBars-1,end-1,candles.length-1);if(final<ei)continue;
    const tp=e.direction>0?entry.open*(1+profile.takeProfit):entry.open*(1-profile.takeProfit);
    const sl=e.direction>0?entry.open*(1-profile.stopLoss):entry.open*(1+profile.stopLoss);
    let xi=final,xp=candles[final]?.close??entry.open,reason:'TP'|'SL'|'TIME'='TIME';const path:number[]=[];
    for(let i=ei;i<=final;i++){const b=candles[i];if(!b)continue;path.push(signed(entry.open,b.high,e.direction),signed(entry.open,b.low,e.direction));
      const th=e.direction>0?b.high>=tp:b.low<=tp, sh=e.direction>0?b.low<=sl:b.high>=sl;
      if(th&&sh||sh){xi=i;xp=sl;reason='SL';break;}if(th){xi=i;xp=tp;reason='TP';break;}
    }
    const g=signed(entry.open,xp,e.direction);out.push({...e,entryIndex:ei,exitIndex:xi,exitReason:reason,entryPrice:entry.open,exitPrice:xp,
      grossReturn:g,netReturn:g-rt,mae:path.length?Math.min(...path):0,mfe:path.length?Math.max(...path):0});
  }return out;
}
export function summarizeSonarScalpV4Outcomes(o:SonarScalpV4Outcome[]):SonarScalpV4Stats{
  const w=o.filter(x=>x.netReturn>0).map(x=>x.netReturn),l=o.filter(x=>x.netReturn<=0).map(x=>x.netReturn);
  const sw=w.reduce((a,b)=>a+b,0),sl=Math.abs(l.reduce((a,b)=>a+b,0));
  return {sampleCount:o.length,hitRate:o.length?w.length/o.length:0,grossExpectancy:mean(o.map(x=>x.grossReturn)),expectancy:mean(o.map(x=>x.netReturn)),
    profitFactor:sl>0?sw/sl:sw>0?Number.POSITIVE_INFINITY:0,averageWin:mean(w),averageLoss:mean(l),averageMae:mean(o.map(x=>x.mae)),averageMfe:mean(o.map(x=>x.mfe)),
    tpRate:o.length?o.filter(x=>x.exitReason==='TP').length/o.length:0,slRate:o.length?o.filter(x=>x.exitReason==='SL').length/o.length:0,
    timeRate:o.length?o.filter(x=>x.exitReason==='TIME').length/o.length:0};
}
function windows(n:number){const a=Math.floor(n*0.6),b=Math.floor(n*0.8);return{train:{startIndex:0,endIndexExclusive:a},validation:{startIndex:a,endIndexExclusive:b},holdout:{startIndex:b,endIndexExclusive:n}};}
export function runSonarScalpV4Robustness(one:TakerOneMinuteRow[],five:Candle[],oi:OpenInterestFiveMinuteRow[],options:{signalConfig?:Partial<SonarScalpV4Config>;minimumSamplesPerWindow?:number}={}):SonarScalpV4Report{
  const config={...DEFAULT_CONFIG,...(options.signalConfig??{})},minN=options.minimumSamplesPerWindow??30,oneReplay=replay(one),fiveReplay=replay(five);
  const events=detectSonarScalpV4EventsFromRows(one,oneReplay.rows,five,fiveReplay.rows,oi,config),w=windows(one.length),runs:SonarScalpV4CostRun[]=[];
  for(const cost of COSTS){
    const candidates=EXIT_PROFILES.map(profile=>({profile,stats:summarizeSonarScalpV4Outcomes(evaluateSonarScalpV4Events(one,events,profile,cost,w.train))}))
      .sort((a,b)=>b.stats.expectancy-a.stats.expectancy||b.stats.profitFactor-a.stats.profitFactor);
    const sel=candidates[0];if(!sel)throw new Error('No profile');
    const validation=summarizeSonarScalpV4Outcomes(evaluateSonarScalpV4Events(one,events,sel.profile,cost,w.validation));
    const holdout=summarizeSonarScalpV4Outcomes(evaluateSonarScalpV4Events(one,events,sel.profile,cost,w.holdout));
    const reasons:string[]=[];let status:GateStatus='PASS';
    if(sel.stats.sampleCount<minN||validation.sampleCount<minN||holdout.sampleCount<minN){status='INSUFFICIENT_DATA';reasons.push('minimum sample count not met across train/validation/holdout');}
    else {if(sel.stats.expectancy<=0)reasons.push('train-selected profile has non-positive train net expectancy');if(validation.expectancy<=0)reasons.push('validation net expectancy did not clear zero');
      if(holdout.expectancy<=0)reasons.push('holdout net expectancy did not clear zero');if(validation.profitFactor<=1)reasons.push('validation PF did not clear 1');if(holdout.profitFactor<=1)reasons.push('holdout PF did not clear 1');if(reasons.length)status='REJECT';}
    runs.push({costScenario:cost.name,feeRate:cost.feeRate,slippageRate:cost.slippageRate,selectedProfile:sel.profile,train:sel.stats,validation,holdout,status,reasons});
  }
  const passed=runs.filter(x=>x.status==='PASS').length,reasons:string[]=[];let status:GateStatus='PASS';
  if(runs.some(x=>x.status==='INSUFFICIENT_DATA')){status='INSUFFICIENT_DATA';reasons.push('at least one cost run lacks minimum samples');}
  else if(runs.some(x=>x.status==='REJECT')||passed!==runs.length){status='REJECT';reasons.push('1m-taker Sonar scalp failed at least one cost robustness run');}
  return{oneMinuteCount:one.length,fiveMinuteCount:five.length,oiCount:oi.length,eventCount:events.length,config,profileCandidates:EXIT_PROFILES,runs,
    decision:{status,passedRuns:passed,totalRuns:runs.length,reasons},replay:{oneMinute:oneReplay.signature,fiveMinute:fiveReplay.signature}};
}
