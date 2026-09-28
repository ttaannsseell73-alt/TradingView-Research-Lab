import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { SWEEP_STRATEGIES } from '../../research/sweep_strategies.mjs';

const [csvPath, botRoot] = process.argv.slice(2);
if (!csvPath || !botRoot) {
  throw new Error('Usage: node q-range48-parity.mjs <candles.csv> <botRoot>');
}

const lines = fs.readFileSync(csvPath, 'utf8').trim().split(/\r?\n/);
const header = lines[0].split(',');
const idx = Object.fromEntries(header.map((x,i)=>[x.trim(),i]));
const pick=(parts,name)=>Number(parts[idx[name]]);
const candles = lines.slice(1).map(line=>{
  const p=line.split(',');
  return {t:pick(p,'t'),o:pick(p,'o'),h:pick(p,'h'),l:pick(p,'l'),c:pick(p,'c'),v:pick(p,'v')};
}).filter(b=>Object.values(b).every(Number.isFinite));

const canonical = SWEEP_STRATEGIES.find(x=>x.id==='swp_range48_reclaim');
if (!canonical) throw new Error('Research Range48 strategy missing');

const require = createRequire(import.meta.url);
const live = require(path.join(path.resolve(botRoot),'dist','live','CanonicalLive.js'));
const liveStrategy = new live.Range48Strategy();

const researchSignals = canonical.signal(candles);
const liveSignals = liveStrategy.signals(candles);
if (researchSignals.length !== liveSignals.length) throw new Error('Signal length mismatch');

const mismatches=[];
for(let i=0;i<researchSignals.length;i++){
  if(researchSignals[i]!==liveSignals[i]){
    mismatches.push({i,t:candles[i]?.t,research:researchSignals[i],live:liveSignals[i]});
    if(mismatches.length>=20) break;
  }
}
const report={
  strategy:'swp_range48_reclaim',
  researchVersion:canonical.version,
  liveVersion:live.Range48Strategy.version,
  candles:candles.length,
  mismatchCount:mismatches.length,
  mismatchSample:mismatches,
  signalCountResearch:researchSignals.filter(x=>x!==0).length,
  signalCountLive:liveSignals.filter(x=>x!==0).length,
};
console.log(JSON.stringify(report,null,2));
if(mismatches.length) process.exit(2);
