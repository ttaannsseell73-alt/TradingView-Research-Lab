import dotenv from 'dotenv';
import path from 'path';
import { BinanceUsdmAdapter } from '../live/BinanceUsdmAdapter';
import { RateLimitGovernor } from '../live/CanonicalLive';

dotenv.config();
dotenv.config({ path: path.join(process.cwd(), '.demo11-testnet.local.env'), override: false });

async function main() {
  const baseUrl=process.env.BINANCE_FUTURES_URL?.trim() || 'https://testnet.binancefuture.com';
  const apiKey=process.env.BINANCE_API_KEY?.trim() || '';
  const apiSecret=process.env.BINANCE_API_SECRET?.trim() || '';
  if(!apiKey||!apiSecret) throw new Error('CREDENTIALS_MISSING');
  if(new URL(baseUrl).hostname.toLowerCase()!=='testnet.binancefuture.com') throw new Error('TESTNET_ONLY');

  const adapter=new BinanceUsdmAdapter({
    baseUrl,apiKey,apiSecret,mode:'CANARY',governor:new RateLimitGovernor()
  });
  const symbols=['GUAUSDT','RIVERUSDT','GPSUSDT','TRADOORUSDT','QUSDT','HANAUSDT','XPINUSDT'];
  const summary:any={generatedAt:new Date().toISOString(),symbols:{},income:[]};
  for(const symbol of symbols){
    const orders=await adapter.getAllOrders(symbol,1000);
    const trades=await (adapter as any).signed('GET','/fapi/v1/userTrades',{symbol,limit:1000});
    const cleanOrders=(Array.isArray(orders)?orders:[]).map((x:any)=>({
      orderId:x.orderId,clientOrderId:x.clientOrderId,side:x.side,type:x.type,status:x.status,
      reduceOnly:x.reduceOnly,executedQty:Number(x.executedQty??0),avgPrice:Number(x.avgPrice??0),
      time:Number(x.time??0),updateTime:Number(x.updateTime??0)
    }));
    const cleanTrades=(Array.isArray(trades)?trades:[]).map((x:any)=>({
      orderId:x.orderId,side:x.side,price:Number(x.price??0),qty:Number(x.qty??0),
      realizedPnl:Number(x.realizedPnl??0),commission:Number(x.commission??0),
      commissionAsset:x.commissionAsset,time:Number(x.time??0),buyer:x.buyer,maker:x.maker
    }));
    summary.symbols[symbol]={
      orders:cleanOrders,
      trades:cleanTrades,
      filledOrders:cleanOrders.filter((x:any)=>x.executedQty>0).length,
      tradeFills:cleanTrades.length,
      realizedPnl:cleanTrades.reduce((s:number,x:any)=>s+x.realizedPnl,0),
      commission:cleanTrades.reduce((s:number,x:any)=>s+x.commission,0),
      d11Orders:cleanOrders.filter((x:any)=>String(x.clientOrderId??'').startsWith('d11')).length,
      nonD11Orders:cleanOrders.filter((x:any)=>!String(x.clientOrderId??'').startsWith('d11')).length,
    };
  }
  const start=Date.parse('2026-09-30T00:00:00Z');
  const income=await (adapter as any).signed('GET','/fapi/v1/income',{startTime:start,limit:1000});
  summary.income=(Array.isArray(income)?income:[]).filter((x:any)=>
    ['REALIZED_PNL','COMMISSION','FUNDING_FEE'].includes(String(x.incomeType??''))
  ).map((x:any)=>({
    symbol:x.symbol,incomeType:x.incomeType,income:Number(x.income??0),asset:x.asset,time:Number(x.time??0),tranId:x.tranId
  }));
  summary.accountRealizedPnl=summary.income.filter((x:any)=>x.incomeType==='REALIZED_PNL').reduce((s:number,x:any)=>s+x.income,0);
  summary.accountCommission=summary.income.filter((x:any)=>x.incomeType==='COMMISSION').reduce((s:number,x:any)=>s+x.income,0);
  console.log(JSON.stringify(summary,null,2));
}
main().catch(e=>{console.error(String(e?.stack??e));process.exit(1);});
