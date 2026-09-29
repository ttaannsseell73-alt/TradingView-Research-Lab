import fs from 'node:fs';
import path from 'node:path';

const boardPath=process.argv[2];
const marketPath=process.argv[3];
const policyPath=process.argv[4]??'research/tradability_policy.json';
const outDir=process.argv[5]??'artifacts/execution-watchlist';
if(!boardPath||!marketPath){
  console.error('Usage: node scripts/build-execution-watchlist.mjs CROSS_BOARD.json MARKET_SNAPSHOT.json [POLICY.json] [OUT_DIR]');
  process.exit(2);
}
const board=JSON.parse(fs.readFileSync(boardPath,'utf8'));
const market=JSON.parse(fs.readFileSync(marketPath,'utf8'));
const policy=JSON.parse(fs.readFileSync(policyPath,'utf8'));
const bySymbol=new Map((market.contracts??[]).map(x=>[x.symbol,x]));

const minDepth=x=>Math.min(Number(x.bidDepth10bps??0),Number(x.askDepth10bps??0));
const selectedTestnet=board.mode==='BINANCE_USDM_TESTNET';
function classifyDetail(x){
  const q=Number(x.quoteVolume24h??0),s=Number(x.spreadBps??Infinity),d=minDepth(x),oi=Number(x.openInterestNotional??0);
  const hardReasons=[];
  if(s>policy.hardBlock.maxSpreadBps) hardReasons.push('SPREAD_HARD');
  if(q<policy.hardBlock.minQuoteVolume24h) hardReasons.push('QUOTE_VOLUME_HARD');
  if(d<policy.hardBlock.minSideDepth10bps) hardReasons.push('MIN_DEPTH_10BPS');
  if(oi<policy.hardBlock.minOpenInterestNotional) hardReasons.push('OPEN_INTEREST_HARD');

  // Demo-10 uses a fixed small notional and performs an authoritative,
  // direction-specific live depth check immediately before submitting an IOC.
  // Therefore generic min(bid,ask) 10-bps depth alone is advisory here.
  const nonDepthHard=hardReasons.filter(x=>x!=='MIN_DEPTH_10BPS');
  if(nonDepthHard.length || (!selectedTestnet && hardReasons.length)) {
    return {status:'BLOCK',reasons:hardReasons};
  }

  const strong=q>=policy.strong.minQuoteVolume24h&&s<=policy.strong.maxSpreadBps&&
    d>=policy.strong.minSideDepth10bps&&oi>=policy.strong.minOpenInterestNotional;
  if(strong) return {status:'STRONG',reasons:hardReasons};

  const tradeable=q>=policy.tradeable.minQuoteVolume24h&&s<=policy.tradeable.maxSpreadBps&&
    d>=policy.tradeable.minSideDepth10bps&&oi>=policy.tradeable.minOpenInterestNotional;
  return {status:tradeable?'TRADEABLE':'REVIEW',reasons:hardReasons};
}
const classify=x=>classifyDetail(x).status;
const rank={STRONG:3,TRADEABLE:2,REVIEW:1,BLOCK:0};
function compare(a,b){
  const ca=classify(a),cb=classify(b);
  return rank[cb]-rank[ca]||
    minDepth(b)-minDepth(a)||
    Number(b.quoteVolume24h??0)-Number(a.quoteVolume24h??0)||
    Number(a.spreadBps??Infinity)-Number(b.spreadBps??Infinity);
}

const source=board.deploymentCandidates??board.managementWatchlist??[];
const rows=[];
for(const candidate of source){
  const contracts=(candidate.contracts??[]).map(s=>bySymbol.get(s)).filter(Boolean);
  if(!contracts.length){
    const fallbackContract=(candidate.contracts??[])[0]??null;
    rows.push({
      ...candidate,
      executionStatus:'NO_MARKET_SNAPSHOT',
      executionContract:fallbackContract,
      market:null,
      alternativeContracts:[]
    });
    continue;
  }
  contracts.sort(compare);
  const chosen=contracts[0];
  const detail=classifyDetail(chosen);
  rows.push({
    ...candidate,
    executionStatus:detail.status,
    executionReasons:detail.reasons,
    executionContract:chosen.symbol,
    market:{
      last:Number(chosen.last??NaN),
      bid:Number(chosen.bid??NaN),
      ask:Number(chosen.ask??NaN),
      mid:Number.isFinite(Number(chosen.bid))&&Number.isFinite(Number(chosen.ask))
        ?(Number(chosen.bid)+Number(chosen.ask))/2
        :Number(chosen.last??NaN),
      quoteVolume24h:Number(chosen.quoteVolume24h??0),
      trades24h:Number(chosen.trades24h??0),
      spreadBps:Number(chosen.spreadBps??Infinity),
      minDepth10bps:minDepth(chosen),
      bidDepth10bps:Number(chosen.bidDepth10bps??0),
      askDepth10bps:Number(chosen.askDepth10bps??0),
      bidDepth25bps:Number(chosen.bidDepth25bps??0),
      askDepth25bps:Number(chosen.askDepth25bps??0),
      openInterestNotional:Number(chosen.openInterestNotional??0)
    },
    alternativeContracts:contracts.slice(1).map(x=>({symbol:x.symbol,status:classify(x)}))
  });
}
rows.sort((a,b)=>rank[b.executionStatus]-rank[a.executionStatus]||
  (b.cleanCombinations??0)-(a.cleanCombinations??0)||
  (b.bestEvidenceNet??-Infinity)-(a.bestEvidenceNet??-Infinity));

const out={
  schemaVersion:1,
  generatedAt:new Date().toISOString(),
  marketSnapshotAt:market.snapshotAt??null,
  marketDataAvailable:market.dataAvailable!==false&&(market.contracts??[]).length>0,
  marketAllFailed:Boolean(market.allFailed),
  policy:policyPath,
  counts:{
    candidates:rows.length,
    strong:rows.filter(x=>x.executionStatus==='STRONG').length,
    tradeable:rows.filter(x=>x.executionStatus==='TRADEABLE').length,
    review:rows.filter(x=>x.executionStatus==='REVIEW').length,
    block:rows.filter(x=>x.executionStatus==='BLOCK').length,
    missing:rows.filter(x=>x.executionStatus==='NO_MARKET_SNAPSHOT').length
  },
  candidates:rows
};
fs.mkdirSync(outDir,{recursive:true});
fs.writeFileSync(path.join(outDir,'EXECUTION_WATCHLIST.json'),JSON.stringify(out,null,2)+'\n');

const pc=x=>x==null?'':(100*x).toFixed(2)+'%';
const m=x=>Number.isFinite(Number(x))?(Number(x)/1e6).toFixed(2)+'M':'';
const lines=['# Execution Watchlist','',
  'Research rank is preserved; this layer only checks whether the selected futures contract is practically tradable.','',
  '| Underlying | Contract | Status | Clean | Best net | Median DD | 24h quote vol | Spread | 10bps min depth | OI notional |',
  '|---|---|---|---:|---:|---:|---:|---:|---:|---:|'];
for(const x of rows){
  lines.push(`| ${x.underlying??x.symbol} | ${x.executionContract??''} | ${x.executionStatus} | ${x.cleanCombinations??''} | ${pc(x.bestEvidenceNet)} | ${pc(x.medianEvidenceDD)} | ${m(x.market?.quoteVolume24h)} | ${Number.isFinite(x.market?.spreadBps)?x.market.spreadBps.toFixed(2)+' bps':''} | ${m(x.market?.minDepth10bps)} | ${m(x.market?.openInterestNotional)} |`);
}
fs.writeFileSync(path.join(outDir,'EXECUTION_WATCHLIST.md'),lines.join('\n')+'\n');
console.log(JSON.stringify(out.counts));
