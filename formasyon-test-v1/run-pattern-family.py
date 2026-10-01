from __future__ import annotations
import json, os, pathlib
from datetime import datetime, timezone
import numpy as np
import pandas as pd
from scipy.ndimage import maximum_filter1d, minimum_filter1d

ROOT=pathlib.Path(r"C:\Users\TANSEL\Desktop\NightResearch-20261001")
CACHE=ROOT/"research"/"full-reset-20261001"/"cache-6m"
OUT=ROOT/"formasyon-test-v1"
OUT.mkdir(parents=True,exist_ok=True)

COST=.0014
STRESS=.0015
MONTHS=["2026-04","2026-05","2026-06","2026-07","2026-08","2026-09"]
M3=MONTHS[-3:]
TFS=["5m","15m"]
LEFT=3; RIGHT=3; WIN=LEFT+RIGHT+1
BREAKOUT_LOOK=24; MIN_SPAN=8; MAX_SPAN=180
PRICE_TOL=.035; ATR_TOL=1.5

PATTERNS=[
 "head_shoulders","inverse_head_shoulders",
 "double_top","double_bottom","triple_top","triple_bottom",
 "bull_flag","bear_flag","bull_pennant","bear_pennant",
 "ascending_triangle","descending_triangle",
 "sym_triangle_long","sym_triangle_short",
 "rising_wedge","falling_wedge",
 "rectangle_long","rectangle_short",
 "cup_handle","inverse_cup_handle"
]

def atr14(h,l,c):
 tr=np.empty(len(c),float);tr[0]=h[0]-l[0]
 tr[1:]=np.maximum(h[1:]-l[1:],np.maximum(np.abs(h[1:]-c[:-1]),np.abs(l[1:]-c[:-1])))
 return pd.Series(tr).rolling(14,min_periods=14).mean().to_numpy()

def pivots(h,l,c):
 atr=atr14(h,l,c)
 maxf=maximum_filter1d(h,size=WIN,mode="nearest"); minf=minimum_filter1d(l,size=WIN,mode="nearest")
 ph=(h>=maxf-1e-12); pl=(l<=minf+1e-12)
 ph[:LEFT]=False;ph[-RIGHT:]=False;pl[:LEFT]=False;pl[-RIGHT:]=False
 rng=maxf-minf
 ph &= rng>=np.nan_to_num(atr,nan=np.inf)*.55
 pl &= rng>=np.nan_to_num(atr,nan=np.inf)*.55
 raw=[]
 for i in range(len(c)):
  if ph[i]:raw.append([i,float(h[i]),"H"])
  if pl[i]:raw.append([i,float(l[i]),"L"])
 raw.sort(key=lambda x:(x[0],0 if x[2]=="L" else 1))
 out=[]
 for p in raw:
  if out and p[2]==out[-1][2]:
   if (p[2]=="H" and p[1]>=out[-1][1]) or (p[2]=="L" and p[1]<=out[-1][1]):out[-1]=p
  else:out.append(p)
 return out,atr

def near(a,b,av):
 return abs(a-b)<=max((abs(a)+abs(b))*.5*PRICE_TOL,ATR_TOL*av)

def line(p1,p2,x):
 if p2[0]==p1[0]:return p2[1]
 return p1[1]+(p2[1]-p1[1])*(x-p1[0])/(p2[0]-p1[0])

def fit(points):
 x=np.array([p[0] for p in points],float);y=np.array([p[1] for p in points],float)
 a,b=np.polyfit(x,y,1);return float(a),float(b)

def breakout(df,d,last,level,stop,target,maxhold):
 o=df.o.to_numpy(float);h=df.h.to_numpy(float);l=df.l.to_numpy(float);c=df.c.to_numpy(float);t=df.t.to_numpy(np.int64)
 bi=None;start=min(last+1,len(c)-2);end=min(len(c)-2,last+BREAKOUT_LOOK)
 for i in range(start,end+1):
  lv=level(i);lp=level(i-1)
  if d==1 and c[i]>lv and c[i-1]<=lp:bi=i;break
  if d==-1 and c[i]<lv and c[i-1]>=lp:bi=i;break
 if bi is None:return None
 ei=bi+1;ep=float(o[ei]);et=int(t[ei])
 st=float(stop(ei) if callable(stop) else stop);tg=float(target(ep,ei) if callable(target) else target)
 if d==1 and not(st<ep<tg):return None
 if d==-1 and not(tg<ep<st):return None
 lastbar=min(len(c)-1,ei+maxhold)
 for j in range(ei,lastbar+1):
  hs=(l[j]<=st) if d==1 else (h[j]>=st)
  ht=(h[j]>=tg) if d==1 else (l[j]<=tg)
  if hs:return (et,int(t[j]),ep,st,d,"STOP")
  if ht:return (et,int(t[j]),ep,tg,d,"TARGET")
 return (et,int(t[lastbar]),ep,float(c[lastbar]),d,"TIME")

def detect(df):
 h=df.h.to_numpy(float);l=df.l.to_numpy(float);c=df.c.to_numpy(float)
 pv,atr=pivots(h,l,c);cand={p:[] for p in PATTERNS}
 def add(p,tr):
  if tr is not None:cand[p].append(tr)
 # doubles
 for k in range(2,len(pv)):
  a,b,d=pv[k-2:k+1];span=d[0]-a[0]
  if not(MIN_SPAN<=span<=MAX_SPAN):continue
  av=float(np.nanmean(atr[max(0,a[0]):d[0]+1]))
  if not np.isfinite(av) or av<=0:continue
  ty=[a[2],b[2],d[2]]
  if ty==["H","L","H"] and near(a[1],d[1],av) and min(a[1],d[1])-b[1]>=1.5*av:
   neck=b[1];ht=(a[1]+d[1])*.5-neck
   add("double_top",breakout(df,-1,d[0],lambda i,n=neck:n,max(a[1],d[1])+.25*av,lambda ep,i,h=ht:ep-h,int(max(12,span*2))))
  if ty==["L","H","L"] and near(a[1],d[1],av) and b[1]-max(a[1],d[1])>=1.5*av:
   neck=b[1];ht=neck-(a[1]+d[1])*.5
   add("double_bottom",breakout(df,1,d[0],lambda i,n=neck:n,min(a[1],d[1])-.25*av,lambda ep,i,h=ht:ep+h,int(max(12,span*2))))
 # H&S, triples, cups
 for k in range(4,len(pv)):
  p=pv[k-4:k+1];ty=[x[2] for x in p];span=p[-1][0]-p[0][0]
  if not(MIN_SPAN<=span<=MAX_SPAN):continue
  av=float(np.nanmean(atr[max(0,p[0][0]):p[-1][0]+1]))
  if not np.isfinite(av) or av<=0:continue
  if ty==["H","L","H","L","H"]:
   h1,l1,hd,l2,h2=p;neck=lambda i,a=l1,b=l2:line(a,b,i);nh=neck(hd[0])
   if hd[1]>max(h1[1],h2[1])+.8*av and near(h1[1],h2[1],av) and abs(l1[1]-l2[1])<=2*av:
    ht=hd[1]-nh;add("head_shoulders",breakout(df,-1,h2[0],neck,h2[1]+.35*av,lambda ep,i,h=ht:ep-h,int(max(16,span*2))))
   if near(h1[1],hd[1],av) and near(hd[1],h2[1],av) and min(h1[1],hd[1],h2[1])-max(l1[1],l2[1])>=1.2*av:
    n=max(l1[1],l2[1]);ht=np.mean([h1[1],hd[1],h2[1]])-n
    add("triple_top",breakout(df,-1,h2[0],lambda i,n=n:n,max(h1[1],hd[1],h2[1])+.25*av,lambda ep,i,h=ht:ep-h,int(max(16,span*2))))
   rim1,bot,rim2,handle,_=p;depth=(rim1[1]+rim2[1])*.5-bot[1];cupspan=rim2[0]-rim1[0]
   if cupspan>=12 and near(rim1[1],rim2[1],av) and depth>=2*av and handle[1]>bot[1]+.45*depth and handle[0]-rim2[0]<=max(12,cupspan*.6):
    rim=(rim1[1]+rim2[1])*.5
    add("cup_handle",breakout(df,1,p[-1][0],lambda i,r=rim:r,handle[1]-.25*av,lambda ep,i,d=depth:ep+d,int(max(20,span*2))))
  if ty==["L","H","L","H","L"]:
   l1,h1,hd,h2,l2=p;neck=lambda i,a=h1,b=h2:line(a,b,i);nh=neck(hd[0])
   if hd[1]<min(l1[1],l2[1])-.8*av and near(l1[1],l2[1],av) and abs(h1[1]-h2[1])<=2*av:
    ht=nh-hd[1];add("inverse_head_shoulders",breakout(df,1,l2[0],neck,l2[1]-.35*av,lambda ep,i,h=ht:ep+h,int(max(16,span*2))))
   if near(l1[1],hd[1],av) and near(hd[1],l2[1],av) and min(h1[1],h2[1])-max(l1[1],hd[1],l2[1])>=1.2*av:
    n=min(h1[1],h2[1]);ht=n-np.mean([l1[1],hd[1],l2[1]])
    add("triple_bottom",breakout(df,1,l2[0],lambda i,n=n:n,min(l1[1],hd[1],l2[1])-.25*av,lambda ep,i,h=ht:ep+h,int(max(16,span*2))))
   rim1,top,rim2,handle,_=p;depth=top[1]-(rim1[1]+rim2[1])*.5;cupspan=rim2[0]-rim1[0]
   if cupspan>=12 and near(rim1[1],rim2[1],av) and depth>=2*av and handle[1]<top[1]-.45*depth and handle[0]-rim2[0]<=max(12,cupspan*.6):
    rim=(rim1[1]+rim2[1])*.5
    add("inverse_cup_handle",breakout(df,-1,p[-1][0],lambda i,r=rim:r,handle[1]+.25*av,lambda ep,i,d=depth:ep-d,int(max(20,span*2))))
 # triangles/wedges/flags/rectangles
 for k in range(5,len(pv)):
  p=pv[k-5:k+1];span=p[-1][0]-p[0][0]
  if not(10<=span<=MAX_SPAN):continue
  av=float(np.nanmean(atr[max(0,p[0][0]):p[-1][0]+1]))
  highs=[x for x in p if x[2]=="H"][-3:];lows=[x for x in p if x[2]=="L"][-3:]
  if len(highs)<3 or len(lows)<3 or not np.isfinite(av) or av<=0:continue
  sh,bh=fit(highs);sl,bl=fit(lows);x0=p[0][0];x1=p[-1][0]
  u0=sh*x0+bh;d0=sl*x0+bl;u1=sh*x1+bh;d1=sl*x1+bl
  w0=u0-d0;w1=u1-d1
  if w0<=0 or w1<=0:continue
  flat=max(av/max(span,1)*.22,1e-12);up=lambda i,a=sh,b=bh:a*i+b;dn=lambda i,a=sl,b=bl:a*i+b;ht=max(w0,w1)
  if abs(sh)<=flat and sl>flat and w1<w0*.85:add("ascending_triangle",breakout(df,1,p[-1][0],up,lambda i:dn(i)-.2*av,lambda ep,i,h=ht:ep+h,int(max(16,span*1.5))))
  if abs(sl)<=flat and sh<-flat and w1<w0*.85:add("descending_triangle",breakout(df,-1,p[-1][0],dn,lambda i:up(i)+.2*av,lambda ep,i,h=ht:ep-h,int(max(16,span*1.5))))
  if sh<-flat and sl>flat and w1<w0*.72:
   add("sym_triangle_long",breakout(df,1,p[-1][0],up,lambda i:dn(i)-.2*av,lambda ep,i,h=ht:ep+h,int(max(16,span*1.5))))
   add("sym_triangle_short",breakout(df,-1,p[-1][0],dn,lambda i:up(i)+.2*av,lambda ep,i,h=ht:ep-h,int(max(16,span*1.5))))
  if sh>flat and sl>flat and sl>sh*1.15 and w1<w0*.82:add("rising_wedge",breakout(df,-1,p[-1][0],dn,lambda i:up(i)+.2*av,lambda ep,i,h=ht:ep-h,int(max(16,span*1.5))))
  if sh<-flat and sl<-flat and sh<sl*1.15 and w1<w0*.82:add("falling_wedge",breakout(df,1,p[-1][0],up,lambda i:dn(i)-.2*av,lambda ep,i,h=ht:ep+h,int(max(16,span*1.5))))
  if abs(sh)<=flat and abs(sl)<=flat and w1>1.5*av:
   add("rectangle_long",breakout(df,1,p[-1][0],up,lambda i:dn(i)-.2*av,lambda ep,i,h=ht:ep+h,int(max(16,span*1.5))))
   add("rectangle_short",breakout(df,-1,p[-1][0],dn,lambda i:up(i)+.2*av,lambda ep,i,h=ht:ep-h,int(max(16,span*1.5))))
  pole0=max(0,p[0][0]-max(8,int(span*.7)));pu=c[p[0][0]]-c[pole0];pdn=c[pole0]-c[p[0][0]]
  if pu>=3*av:
   if sh<=0 and sl<=0 and w1>=w0*.65:add("bull_flag",breakout(df,1,p[-1][0],up,lambda i:dn(i)-.2*av,lambda ep,i,pole=pu:ep+pole,int(max(12,span))))
   if sh<0 and sl>0 and w1<w0*.72:add("bull_pennant",breakout(df,1,p[-1][0],up,lambda i:dn(i)-.2*av,lambda ep,i,pole=pu:ep+pole,int(max(12,span))))
  if pdn>=3*av:
   if sh>=0 and sl>=0 and w1>=w0*.65:add("bear_flag",breakout(df,-1,p[-1][0],dn,lambda i:up(i)+.2*av,lambda ep,i,pole=pdn:ep-pole,int(max(12,span))))
   if sh<0 and sl>0 and w1<w0*.72:add("bear_pennant",breakout(df,-1,p[-1][0],dn,lambda i:up(i)+.2*av,lambda ep,i,pole=pdn:ep-pole,int(max(12,span))))
 out={}
 for pat,ts in cand.items():
  ts=sorted(ts,key=lambda x:x[0]);keep=[];last=-1
  for tr in ts:
   if tr[0]>last:keep.append(tr);last=tr[1]
  out[pat]=keep
 return out

def stats(ts,cost):
 rs=[];mm={m:[] for m in MONTHS}
 for et,xt,ep,xp,d,_ in ts:
  gross=(xp/ep-1) if d==1 else (ep/xp-1);r=gross-cost;rs.append(r)
  m=datetime.fromtimestamp(xt/1000,tz=timezone.utc).strftime("%Y-%m")
  if m in mm:mm[m].append(r)
 eq=peak=1.;dd=gp=0.;gl=0.;w=0
 for r in rs:
  if r>0:w+=1;gp+=r
  elif r<0:gl+=r
  eq=max(1e-9,eq*(1+r));peak=max(peak,eq);dd=max(dd,1-eq/peak)
 monthly={}
 for m,xs in mm.items():
  me=1.
  for r in xs:me=max(1e-9,me*(1+r))
  a=sum(x for x in xs if x>0);b=sum(x for x in xs if x<0)
  monthly[m]={"n":len(xs),"net":me-1,"pf":a/abs(b) if b<0 else (999 if a>0 else 0),"exp":float(np.mean(xs)) if xs else 0}
 return {"n":len(rs),"net":eq-1,"pf":gp/abs(gl) if gl<0 else (999 if gp>0 else 0),"dd":dd,"exp":float(np.mean(rs)) if rs else 0,"wr":w/len(rs) if rs else 0,"monthly":monthly}

def passes(b,s):
 mp={}
 for m in MONTHS:
  a=b["monthly"][m];z=s["monthly"][m]
  mp[m]=bool(a["n"]>=10 and a["net"]>0 and a["pf"]>1.05 and a["exp"]>0 and z["net"]>0)
 return mp

def main():
 sc=int(os.environ.get("PATTERN_SHARD_COUNT","1"));si=int(os.environ.get("PATTERN_SHARD_INDEX","0"))
 od=OUT/(f"shard{si}" if sc>1 else "all");od.mkdir(exist_ok=True)
 files=[]
 for tf in TFS:files+=sorted(CACHE.glob(f"*-{tf}.csv"))
 files=[f for i,f in enumerate(files) if i%sc==si]
 rows=[];errs=[]
 for n,f in enumerate(files,1):
  tf=f.stem.rsplit("-",1)[-1];sym=f.stem[:-(len(tf)+1)]
  try:
   df=pd.read_csv(f);det=detect(df)
   for pat in PATTERNS:
    b=stats(det[pat],COST);s=stats(det[pat],STRESS);mp=passes(b,s)
    rows.append({"symbol":sym,"timeframe":tf,"strategy":pat,"base":b,"stress":s,"pass3":all(mp[m] for m in M3),"pass6":all(mp[m] for m in MONTHS),"monthlyPass":mp})
  except Exception as e:errs.append({"file":f.name,"error":repr(e)})
  if n%25==0 or n==len(files):print(json.dumps({"shard":si,"progress":f"{n}/{len(files)}","rows":len(rows),"errors":len(errs)}),flush=True)
 p3=[r for r in rows if r["pass3"]];p6=[r for r in rows if r["pass6"]]
 by={p:{"pass3":sum(r["pass3"] for r in rows if r["strategy"]==p),"pass6":sum(r["pass6"] for r in rows if r["strategy"]==p)} for p in PATTERNS}
 sm={"shard":si,"files":len(files),"rows":len(rows),"errors":len(errs),"pass3":len(p3),"pass6":len(p6),"byStrategy":by}
 for name,obj in [("SUMMARY.json",sm),("PASS3.json",p3),("PASS6.json",p6),("ERRORS.json",errs)]:(od/name).write_text(json.dumps(obj,indent=2),encoding="utf-8")
 print(json.dumps(sm),flush=True)
if __name__=="__main__":main()
