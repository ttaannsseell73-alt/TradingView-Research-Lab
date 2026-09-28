import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve('.github/workflows');
const files = fs.readdirSync(dir).filter((name) => /\.ya?ml$/i.test(name)).sort();
const forbidden = [
  { re: /\bnode\s+scripts\/run-datahub-plan-checkpointed\.mjs\b/, reason: 'direct checkpointed runner bypasses turbo wrapper' },
  { re: /\bnode\s+scripts\/run-pinets-exact-strategy\.mjs\b/, reason: 'direct exact Pine runner bypasses turbo wrapper' },
  { re: /\bnode\s+scripts\/run-pinets-recovered-strategy\.mjs\b/, reason: 'direct recovery Pine runner bypasses turbo wrapper' },
  { re: /scripts\/export-freqtrade-feather\.py\b/, reason: 'legacy one-task exporter is forbidden in workflows; use batch exporter/cache' },
];

const failures = [];
for (const name of files) {
  const text = fs.readFileSync(path.join(dir, name), 'utf8');
  for (const rule of forbidden) {
    if (rule.re.test(text)) failures.push({ file: name, reason: rule.reason });
  }

  // Self-hosted jobs must not call the old generic runner directly.
  const lines = text.split(/\r?\n/);
  let inSelfHostedJob = false;
  let jobIndent = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const m = /^(\s+)([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (m && m[1].length === 2) {
      inSelfHostedJob = false;
      jobIndent = m[1].length;
    }
    if (/runs-on:\s*\[self-hosted/i.test(line)) inSelfHostedJob = true;
    if (inSelfHostedJob && /\bnode\s+scripts\/run-datahub-plan\.mjs\b/.test(line)) {
      failures.push({ file: name, line: i + 1, reason: 'self-hosted job uses generic old runner instead of turbo parallel runner' });
    }
  }
}

if (failures.length) {
  console.error(JSON.stringify({ status: 'TURBO_GUARD_FAIL', failures }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ status: 'TURBO_GUARD_PASS', workflows: files.length }));
