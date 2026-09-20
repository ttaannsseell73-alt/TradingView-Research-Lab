import fs from 'node:fs';
import process from 'node:process';
import { inspectCandleQuality, parseCandleCsv, runSonarScalpV2Robustness } from '../dist/index.js';

const onePath = process.argv[2] ?? 'BTCUSDT-1m-50000.csv';
const fivePath = process.argv[3] ?? 'BTCUSDT-5m-50000.csv';
const output = process.argv[4] ?? 'SONAR_SCALP_V2_ACCEPTANCE.json';

const one = parseCandleCsv(fs.readFileSync(onePath, 'utf8'));
const five = parseCandleCsv(fs.readFileSync(fivePath, 'utf8'));
const quality = { oneMinute: inspectCandleQuality(one), fiveMinute: inspectCandleQuality(five) };

let result;
if (!quality.oneMinute.pass || !quality.fiveMinute.pass) {
  result = { strategy: 'SONAR_SCALP_V2_REGIME', status: 'DATA_QUALITY_FAIL', quality, robustness: null, promotable: [] };
} else {
  const robustness = runSonarScalpV2Robustness(one, five);
  result = {
    strategy: 'SONAR_SCALP_V2_REGIME',
    status: robustness.promotable.length ? 'PROMOTION_CANDIDATE' : 'NO_PROMOTABLE_SETUP',
    quality,
    robustness,
    promotable: robustness.promotable,
  };
}

fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({
  strategy: result.strategy,
  status: result.status,
  events: result.robustness?.eventCount ?? 0,
  eventCountBySetup: result.robustness?.eventCountBySetup ?? null,
  decisions: result.robustness?.decisions ?? null,
  promotable: result.promotable,
}, null, 2));
console.log(`${output} written.`);
