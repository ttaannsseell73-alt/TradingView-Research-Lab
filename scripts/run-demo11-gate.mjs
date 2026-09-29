import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const files=fs.readdirSync('tests')
  .filter(x=>/^demo11_.*\.test\.mjs$/.test(x))
  .sort()
  .map(x=>'tests/'+x);

if(!files.length){
  console.error('No Demo-11 gate tests found.');
  process.exit(2);
}

console.log(JSON.stringify({gate:'demo11',testFiles:files.length,files},null,2));
const result=spawnSync(process.execPath,['--test',...files],{stdio:'inherit'});
if(result.error) throw result.error;
process.exit(result.status??1);
