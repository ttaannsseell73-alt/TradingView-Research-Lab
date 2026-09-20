import fs from 'node:fs';
import process from 'node:process';
import {
  inspectCandleQuality,
  parseCandleCsv,
  runRobustnessMatrix,
} from '../dist/index.js';

const path = process.argv[2];
const output = process.argv[3] ?? 'research-acceptance.json';

if (!path) {
  console.error('Usage: npm run acceptance -- path/to/candles.csv [output.json]');
  process.exit(2);
}

const candles = parseCandleCsv(fs.readFileSync(path, 'utf8'));
const quality = inspectCandleQuality(candles);
if (!quality.pass) {
  const result = { status: 'DATA_QUALITY_FAIL', quality };
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = 3;
} else {
  const robustness = runRobustnessMatrix(candles);
  const allPass = robustness.decisions.every((decision) => decision.status === 'PASS');
  const result = {
    status: allPass ? 'RESEARCH_GATE_PASS' : 'RESEARCH_GATE_NOT_PASSED',
    quality,
    robustness,
  };
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n', 'utf8');
  console.log(JSON.stringify(result, null, 2));
}
