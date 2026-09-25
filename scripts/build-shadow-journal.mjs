import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_REFERENCE_NOTIONAL=1000;
const DEFAULT_ROUND_TRIP_COST=0.0014;

const finite=x=>Number.isFinite(Number(x));
const pxOfMarket=m=>{
  if(finite(m?.mid)) return Number(m.mid);
  if(finite(m?.last)) return Number(m.last);
  if(finite(m?.bid)&&finite(m?.ask)) return (Number(m.bid)+Number(m.ask))/2;
  return null;
};
const sideNum=d=>d==='LONG'?1:d==='SHORT'?-1:0;
const grossReturn=(direction,entry,exit)=>{
  const s=sideNum(direction);
  if(!s||!finite(entry)||!finite(exit)||Number(entry)<=0) return 0;
  return s===1?Number(exit)/Number(entry)-1:Number(entry)/Number(exit)-1;
};
const round=x=>Number(Number(x).toFixed(10));

export function updateShadowState(current,previous=null,{
  referenceNotional=DEFAULT_REFERENCE_NOTIONAL,
  roundTripCost=DEFAULT_ROUND_TRIP_COST
}={}){
  const nowMs=Number(current?.snapshotAtMs??Date.now());
  const prev=previous&&previous.schemaVersion===1?structuredClone(previous):{
    schemaVersion:1,
    createdAt:new Date(nowMs).toISOString(),
    referenceNotional,
    modeledRoundTripCost:roundTripCost,
    positions:[],
    closedTrades:[],
    events:[]
  };
  prev.referenceNotional=Number(prev.referenceNotional??referenceNotional);
  prev.modeledRoundTripCost=Number(prev.modeledRoundTripCost??roundTripCost);

  const rows=current?.rows??[];
  const intents=current?.paperIntents??[];
  const marketByUnderlying=new Map();
  const execStatusByUnderlying=new Map();
  for(const r of rows){
    if(r?.underlying&&r?.market&&!marketByUnderlying.has(r.underlying)) marketByUnderlying.set(r.underlying,r.market);
    if(r?.underlying&&r?.executionStatus&&!execStatusByUnderlying.has(r.underlying)) execStatusByUnderlying.set(r.underlying,r.executionStatus);
  }
  for(const i of intents){
    if(i?.underlying&&i?.market) marketByUnderlying.set(i.underlying,i.market);
    if(i?.underlying&&i?.executionStatus) execStatusByUnderlying.set(i.underlying,i.executionStatus);
  }
  const intentByUnderlying=new Map(intents.filter(x=>x?.underlying).map(x=>[x.underlying,x]));
  const rowsByKey=new Map(rows.map(r=>[`${r.underlying}::${r.strategy}::${r.timeframe}`,r]));

  const events=[];
  const closed=[...(prev.closedTrades??[])];
  const positions=[];
  const handled=new Set();

  function closePosition(pos,exitPrice,exitTime,reason){
    const gross=grossReturn(pos.direction,pos.entryPrice,exitPrice);
    const net=gross-prev.modeledRoundTripCost;
    const trade={
      ...pos,
      exitPrice:Number(exitPrice),
      exitTime:Number(exitTime),
      exitReason:reason,
      grossReturn:round(gross),
      netReturn:round(net),
      pnlPerReferenceNotional:round(net*prev.referenceNotional)
    };
    delete trade.markPrice;
    delete trade.unrealizedGrossReturn;
    delete trade.unrealizedNetIfClosed;
    delete trade.unrealizedPnlPerReferenceNotional;
    closed.push(trade);
    events.push({
      type:'CLOSE',
      at:Number(exitTime),
      underlying:pos.underlying,
      direction:pos.direction,
      price:Number(exitPrice),
      reason,
      netReturn:trade.netReturn
    });
  }

  function openFromIntent(intent){
    if(!finite(intent?.entryPrice)||!finite(intent?.entryTime)||!['LONG','SHORT'].includes(intent?.direction)) return null;
    const p={
      tradeId:`${intent.underlying}-${intent.entryTime}-${intent.direction}`,
      underlying:intent.underlying,
      executionContract:intent.executionContract,
      direction:intent.direction,
      entryPrice:Number(intent.entryPrice),
      entryTime:Number(intent.entryTime),
      signalTime:Number(intent.signalTime??intent.entryTime),
      executionStatus:intent.executionStatus,
      supportCount:Number(intent.supportCount??1),
      leadStrategy:intent.leadStrategy,
      leadTimeframe:intent.leadTimeframe,
      supportingSignals:intent.supportingSignals??[],
      modeledRoundTripCost:prev.modeledRoundTripCost
    };
    events.push({
      type:'OPEN',
      at:p.entryTime,
      underlying:p.underlying,
      direction:p.direction,
      price:p.entryPrice,
      supportCount:p.supportCount,
      leadStrategy:p.leadStrategy,
      leadTimeframe:p.leadTimeframe
    });
    return p;
  }

  for(const pos of prev.positions??[]){
    const intent=intentByUnderlying.get(pos.underlying);
    const market=marketByUnderlying.get(pos.underlying);
    const mark=pxOfMarket(market);
    const execStatus=execStatusByUnderlying.get(pos.underlying)??pos.executionStatus;
    const leadRow=rowsByKey.get(`${pos.underlying}::${pos.leadStrategy}::${pos.leadTimeframe}`);
    const flatExit=leadRow?.fresh&&leadRow?.action==='EXIT_TO_FLAT'&&finite(leadRow?.nextBarOpen)&&finite(leadRow?.nextBarOpenTime);

    if(intent&&intent.direction!==pos.direction&&finite(intent.entryPrice)&&finite(intent.entryTime)){
      closePosition(pos,intent.entryPrice,intent.entryTime,'REVERSE_SIGNAL');
      const np=openFromIntent(intent);
      if(np) positions.push(np);
      handled.add(pos.underlying);
      continue;
    }
    if(flatExit){
      closePosition(pos,leadRow.nextBarOpen,leadRow.nextBarOpenTime,'TARGET_FLAT');
      handled.add(pos.underlying);
      continue;
    }
    if(execStatus==='BLOCK'&&finite(mark)){
      closePosition(pos,mark,nowMs,'TRADABILITY_BLOCK');
      handled.add(pos.underlying);
      continue;
    }

    const updated={...pos,executionStatus:execStatus};
    if(intent&&intent.direction===pos.direction){
      updated.supportCount=Number(intent.supportCount??updated.supportCount??1);
      updated.supportingSignals=intent.supportingSignals??updated.supportingSignals??[];
    }
    if(finite(mark)){
      const gross=grossReturn(updated.direction,updated.entryPrice,mark);
      const net=gross-prev.modeledRoundTripCost;
      updated.markPrice=Number(mark);
      updated.markTime=nowMs;
      updated.unrealizedGrossReturn=round(gross);
      updated.unrealizedNetIfClosed=round(net);
      updated.unrealizedPnlPerReferenceNotional=round(net*prev.referenceNotional);
    }
    positions.push(updated);
    handled.add(pos.underlying);
  }

  for(const intent of intents){
    if(handled.has(intent.underlying)) continue;
    const np=openFromIntent(intent);
    if(!np) continue;
    const mark=pxOfMarket(marketByUnderlying.get(intent.underlying));
    if(finite(mark)){
      const gross=grossReturn(np.direction,np.entryPrice,mark);
      const net=gross-prev.modeledRoundTripCost;
      np.markPrice=Number(mark);
      np.markTime=nowMs;
      np.unrealizedGrossReturn=round(gross);
      np.unrealizedNetIfClosed=round(net);
      np.unrealizedPnlPerReferenceNotional=round(net*prev.referenceNotional);
    }
    positions.push(np);
  }

  const closedTrades=closed.slice(-1000);
  const allEvents=[...(prev.events??[]),...events].slice(-1000);
  const realized=closedTrades.map(x=>Number(x.netReturn??0));
  const unrealized=positions.map(x=>Number(x.unrealizedNetIfClosed??0));
  const summary={
    openPositions:positions.length,
    closedTrades:closedTrades.length,
    wins:realized.filter(x=>x>0).length,
    losses:realized.filter(x=>x<0).length,
    winRate:realized.length?round(realized.filter(x=>x>0).length/realized.length):0,
    realizedNetReturnSum:round(realized.reduce((a,b)=>a+b,0)),
    realizedPnlPerReferenceNotionalSum:round(closedTrades.reduce((a,x)=>a+Number(x.pnlPerReferenceNotional??0),0)),
    unrealizedNetReturnSum:round(unrealized.reduce((a,b)=>a+b,0)),
    unrealizedPnlPerReferenceNotionalSum:round(positions.reduce((a,x)=>a+Number(x.unrealizedPnlPerReferenceNotional??0),0))
  };
  return {
    schemaVersion:1,
    createdAt:prev.createdAt??new Date(nowMs).toISOString(),
    updatedAt:new Date(nowMs).toISOString(),
    snapshotAtMs:nowMs,
    referenceNotional:prev.referenceNotional,
    modeledRoundTripCost:prev.modeledRoundTripCost,
    semantics:{
      capital:'Reference notional is normalized per independent paper trade; it is not a live allocation recommendation.',
      entry:'Fresh eligible signal enters at the actual next-bar open captured from Binance Futures.',
      mark:'Open positions are marked at current futures mid/last price.',
      exit:'Opposite eligible fresh intent reverses; target-position lead strategy can exit to flat; hard tradability block forces paper exit.',
      cost:'Net returns subtract the same modeled round-trip cost used by the research baseline.'
    },
    summary,
    positions,
    closedTrades,
    events:allEvents
  };
}

function renderMd(state){
  const pc=x=>(100*Number(x??0)).toFixed(2)+'%';
  const money=x=>Number(x??0).toFixed(2);
  const lines=[
    '# Shadow Journal','',
    `Reference notional: ${state.referenceNotional} USDT per independent paper trade. This is a normalized measurement unit, not a capital allocation recommendation.`,'',
    `Open: ${state.summary.openPositions} | Closed: ${state.summary.closedTrades} | Win rate: ${pc(state.summary.winRate)} | Realized normalized PnL: ${money(state.summary.realizedPnlPerReferenceNotionalSum)} | Unrealized normalized PnL: ${money(state.summary.unrealizedPnlPerReferenceNotionalSum)}`,'',
    '## Open positions','',
    '| Underlying | Contract | Dir | Entry | Mark | Net if closed | PnL / ref | Support | Lead |',
    '|---|---|---|---:|---:|---:|---:|---:|---|'
  ];
  for(const p of state.positions){
    lines.push(`| ${p.underlying} | ${p.executionContract} | ${p.direction} | ${p.entryPrice} | ${p.markPrice??''} | ${pc(p.unrealizedNetIfClosed)} | ${money(p.unrealizedPnlPerReferenceNotional)} | ${p.supportCount??1} | ${p.leadStrategy}/${p.leadTimeframe} |`);
  }
  lines.push('','## Closed trades','',
    '| Underlying | Dir | Entry | Exit | Reason | Net | PnL / ref |',
    '|---|---|---:|---:|---|---:|---:|');
  for(const t of [...state.closedTrades].reverse().slice(0,50)){
    lines.push(`| ${t.underlying} | ${t.direction} | ${t.entryPrice} | ${t.exitPrice} | ${t.exitReason} | ${pc(t.netReturn)} | ${money(t.pnlPerReferenceNotional)} |`);
  }
  return lines.join('\n')+'\n';
}

async function main(){
  const currentPath=process.argv[2];
  const previousPath=process.argv[3]&&process.argv[3]!=='-'?process.argv[3]:null;
  const outDir=process.argv[4]??'artifacts/shadow-journal';
  if(!currentPath){
    console.error('Usage: node scripts/build-shadow-journal.mjs CURRENT_SIGNAL.json [PREVIOUS_STATE.json|-] [OUT_DIR]');
    process.exit(2);
  }
  const current=JSON.parse(fs.readFileSync(currentPath,'utf8'));
  const previous=previousPath&&fs.existsSync(previousPath)?JSON.parse(fs.readFileSync(previousPath,'utf8')):null;
  const state=updateShadowState(current,previous);
  fs.mkdirSync(outDir,{recursive:true});
  fs.writeFileSync(path.join(outDir,'SHADOW_STATE.json'),JSON.stringify(state,null,2)+'\n');
  fs.writeFileSync(path.join(outDir,'SHADOW_JOURNAL.md'),renderMd(state));
  console.log(JSON.stringify(state.summary));
}

if(process.argv[1]?.endsWith('build-shadow-journal.mjs')){
  main();
}
