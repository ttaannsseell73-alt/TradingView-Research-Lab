import fs from 'node:fs';
import process from 'node:process';
import { parseCandleCsv, inspectCandleQuality, runSonarScalpRobustness } from '../dist/index.js';

const onePath = process.argv[2] ?? 'BTCUSDT-1m-50000.csv';
const fivePath = process.argv[3] ?? 'BTCUSDT-5m-50000.csv';
const output = process.argv[4] ?? 'SONAR_SCALP_ACCEPTANCE.json';

const one = parseCandleCsv(fs.readFileSync(onePath, 'utf8'));
const five = parseCandleCsv(fs.readFileSync(fivePath, 'utf8'));
const quality = { oneMinute: inspectCandleQuality(one), fiveMinute: inspectCandleQuality(five) };

let result;
if (!quality.oneMinute.pass || !quality.fiveMinute.pass) {
  result = { strategy: 'SONAR_SCALP_V1', status: 'DATA_QUALITY_FAIL', quality, robustness: null };
} else {
  const robustness = runSonarScalpRobustness(one, five);
  result = {
    strategy: 'SONAR_SCALP_V1',
    status: robustness.decision.status === 'PASS' ? 'PROMOTION_CANDIDATE' : 'NO_PROMOTABLE_SETUP',
    quality,
    robustness,
  };
}

fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({
  strategy: result.strategy,
  status: result.status,
  events: result.robustness?.eventCount ?? 0,
  decision: result.robustness?.decision ?? null,
}, null, 2));
console.log(`${output} written.`);
