import fs from 'node:fs'; import process from 'node:process';
const symbol=(process.argv[2]??'BTCUSDT').toUpperCase(),target=Number(process.argv[3]??42000),output=process.argv[4]??`${symbol}-1m-taker-${target}.csv`;
const rows=new Map();let endTime=Date.now();
while(rows.size<target){const limit=Math.min(1500,target-rows.size),p=new URLSearchParams({symbol,interval:'1m',limit:String(limit),endTime:String(endTime)});
 const r=await fetch(`https://fapi.binance.com/fapi/v1/klines?${p}`);if(!r.ok)throw new Error(`HTTP ${r.status}: ${await r.text()}`);const page=await r.json();if(!Array.isArray(page)||!page.length)break;
 for(const x of page)rows.set(Number(x[0]),[x[0],x[1],x[2],x[3],x[4],x[5],x[9]]);endTime=Number(page[0][0])-1;if(page.length<limit)break;}
const out=[...rows.values()].sort((a,b)=>Number(a[0])-Number(b[0])).slice(-target);if(out.length<1000)throw new Error('Too few rows');
fs.writeFileSync(output,['timestamp,open,high,low,close,volume,takerBuyVolume',...out.map(x=>x.join(','))].join('\n')+'\n');console.log(JSON.stringify({symbol,candles:out.length,output},null,2));