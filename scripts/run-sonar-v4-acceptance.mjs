import fs from 'node:fs'; import process from 'node:process';
import {inspectCandleQuality,parseCandleCsv,parseOpenInterestFiveMinuteCsv,parseTakerOneMinuteCsv,runSonarScalpV4Robustness} from '../dist/index.js';
const [takerPath,fivePath,oiPath,output='SONAR_SCALP_V4_ACCEPTANCE.json']=process.argv.slice(2);if(!takerPath||!fivePath||!oiPath)throw new Error('paths required');
const one=parseTakerOneMinuteCsv(fs.readFileSync(takerPath,'utf8')),five=parseCandleCsv(fs.readFileSync(fivePath,'utf8')),oi=parseOpenInterestFiveMinuteCsv(fs.readFileSync(oiPath,'utf8'));
const quality={oneMinute:inspectCandleQuality(one),fiveMinute:inspectCandleQuality(five)};let result;
if(!quality.oneMinute.pass||!quality.fiveMinute.pass)result={strategy:'SONAR_SCALP_V4_TAKER1M',status:'DATA_QUALITY_FAIL',quality,robustness:null};
else{const robustness=runSonarScalpV4Robustness(one,five,oi);result={strategy:'SONAR_SCALP_V4_TAKER1M',status:robustness.decision.status==='PASS'?'PROMOTION_CANDIDATE':'NO_PROMOTABLE_SETUP',quality,robustness};}
fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({strategy:result.strategy,status:result.status,events:result.robustness?.eventCount??0,decision:result.robustness?.decision??null,
profiles:result.robustness?.runs?.map(r=>({cost:r.costScenario,profile:r.selectedProfile.name,train:r.train.expectancy,validation:r.validation.expectancy,holdout:r.holdout.expectancy}))??[]},null,2));