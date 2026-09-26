import fs from 'node:fs';
import path from 'node:path';

const root = process.argv[2] ?? 'artifacts/downloaded';
const out = process.argv[3] ?? 'artifacts/hybrid-research/combined.json';

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = [];
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) files.push(...walk(full));
    else if (/result-.*\.json$/.test(name)) files.push(full);
  }
  return files;
}

const files = walk(root).sort();
const docs = files.map((file) => JSON.parse(fs.readFileSync(file, 'utf8')));
const results = docs.flatMap((doc) => doc.results ?? []);
const failures = docs.flatMap((doc) => doc.failures ?? []);
results.sort((a, b) =>
  Number(b.pass) - Number(a.pass)
  || Number(b.net ?? -Infinity) - Number(a.net ?? -Infinity)
  || Number(b.pf ?? -Infinity) - Number(a.pf ?? -Infinity)
  || String(a.symbol).localeCompare(String(b.symbol))
  || String(a.id).localeCompare(String(b.id))
);

const merged = {
  schemaVersion: 1,
  sources: files,
  backends: [...new Set(docs.map((doc) => doc.backend))].sort(),
  combinations: results.length,
  passing: results.filter((row) => row.pass).length,
  failures,
  results,
};

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(merged, null, 2) + '\n');
console.log(JSON.stringify({
  output: out,
  sources: files.length,
  combinations: merged.combinations,
  passing: merged.passing,
  failures: failures.length,
}));
