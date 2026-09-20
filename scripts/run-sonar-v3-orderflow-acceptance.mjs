import fs from 'node:fs';
import process from 'node:process';
import {
  inspectCandleQuality,
  parseCandleCsv,
  parseSonarOrderflowCsv,
  runSonarOrderflowRobustness,
} from '../dist/index.js';

const onePath = process.argv[2] ?? 'BTCUSDT-1m-50000.csv';
const fivePath = process.argv[3] ?? 'BTCUSDT-5m-50000.csv';
const orderflowPath = process.argv[4] ?? 'BTCUSDT-sonar-orderflow-5m.csv';
const output = process.argv[5] ?? 'SONAR_SCALP_V3_ORDERFLOW_ACCEPTANCE.json';

const one = parseCandleCsv(fs.readFileSync(onePath, 'utf8'));
const five = parseCandleCsv(fs.readFileSync(fivePath, 'utf8'));
const orderflow = parseSonarOrderflowCsv(fs.readFileSync(orderflowPath, 'utf8'));
const quality = { oneMinute: inspectCandleQuality(one), fiveMinute: inspectCandleQuality(five) };

let result;
if (!quality.oneMinute.pass || !quality.fiveMinute.pass) {
  result = { strategy: 'SONAR_SCALP_V3_ORDERFLOW', status: 'DATA_QUALITY_FAIL', quality, robustness: null };
} else {
  const robustness = runSonarOrderflowRobustness(one, five, orderflow);
  result = {
    strategy: 'SONAR_SCALP_V3_ORDERFLOW',
    status: robustness.decision.status === 'PASS' ? 'PROMOTION_CANDIDATE' : 'NO_PROMOTABLE_SETUP',
    quality,
    robustness,
  };
}

fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({
  strategy: result.strategy,
  status: result.status,
  orderflowRows: result.robustness?.orderflowCount ?? 0,
  overlap1m: result.robustness?.overlapOneMinuteCount ?? 0,
  events: result.robustness?.eventCount ?? 0,
  decision: result.robustness?.decision ?? null,
}, null, 2));
