'use strict';

import fs from 'node:fs/promises';

const HISTORY_FILE='keno-history.json';
const ARCHIVE_FILE='internal-forecast-archive.json';
const MARKER_FILE='marker-base.json';
const VERSION='HYBRID-7.0-ROAD-MARKERS';

const CURRENT_SCHEDULE=[
'00:02','00:17','00:32','01:02','01:17','01:32','02:02','02:17','02:32','03:02','03:32',
'04:02','04:17','04:32','05:02','05:17','05:32','06:02','06:17','06:32','07:02','07:32',
'08:02','08:17','08:32','09:02','09:17','09:32','10:02','10:17','10:32','11:02','11:32',
'12:02','12:17','12:32','13:02','13:17','13:32','14:02','14:17','14:32','15:02','15:32',
'16:02','16:17','16:32','17:02','17:17','17:32','18:02','18:17','18:32','19:02','19:32',
'20:02','20:17','20:32','21:02','21:17','21:32','22:02','22:17','22:32','23:02','23:32'
];

function flatten(v,out=[]){
  if(Array.isArray(v)){for(const x of v) flatten(x,out); return out;}
  if(v&&typeof v==='object'){
    const draw=Number(v.draw), column=Number(v.column);
    if(Number.isFinite(draw)&&Number.isInteger(column)&&column>=1&&column<=10){
      const balls=Array.isArray(v.balls)?v.balls.slice(0,20).map(Number).filter(n=>Number.isInteger(n)&&n>=1&&n<=80):[];
      out.push({draw,column,date:String(v.date||''),time:String(v.time||''),balls}); return out;
    }
    for(const x of Object.values(v)) if(x&&typeof x==='object') flatten(x,out);
  }
  return out;
}
async function readJson(file,fallback){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch{return fallback;}}
function clamp(x,lo,hi){return Math.max(lo,Math.min(hi,x));}
function dateParts(value){
  const raw=String(value||'').trim(); let m=raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(m)return{y:+m[1],mo:+m[2],d:+m[3]};
  m=raw.match(/^(\d{2})[.\-/](\d{2})[.\-/](\d{2}|\d{4})$/); if(!m)return null;
  return{y:+(m[3].length===2?'20'+m[3]:m[3]),mo:+m[2],d:+m[1]};
}
function formatRu(p){return p?`${String(p.d).padStart(2,'0')}.${String(p.mo).padStart(2,'0')}.${p.y}`:'';}
function addDays(p,n){const d=new Date(Date.UTC(p.y,p.mo-1,p.d+n));return{y:d.getUTCFullYear(),mo:d.getUTCMonth()+1,d:d.getUTCDate()};}
function inferNextTarget(draws){
  const latest=draws.at(-1); if(!latest)return{draw:null,time:'—',date:''};
  const tm=String(latest.time||'').match(/(\d{1,2}):(\d{2})/), dp=dateParts(latest.date);
  if(!tm||!dp)return{draw:latest.draw+1,time:'—',date:''};
  const cur=+tm[1]*60 + +tm[2];
  const mins=CURRENT_SCHEDULE.map(t=>{const[h,m]=t.split(':').map(Number);return h*60+m;});
  let i=mins.findIndex(x=>x>cur), target=dp; if(i<0){i=0;target=addDays(dp,1);}
  return{draw:latest.draw+1,time:CURRENT_SCHEDULE[i],date:formatRu(target)};
}

function stateVector(balls){
  const c=Array(10).fill(0); for(const n of balls)c[(n-1)%10]++;
  return c.map(x=>Math.min(4,x));
}
function pairList(){const out=[];for(let a=0;a<80;a++)for(let b=a+1;b<80;b++)out.push([a,b]);return out;}
const PAIRS=pairList();
const PAIR_INDEX=Array.from({length:80},()=>Array(80).fill(-1));
PAIRS.forEach(([a,b],i)=>{PAIR_INDEX[a][b]=i;PAIR_INDEX[b][a]=i;});
function zscores(a){
  const m=a.reduce((s,x)=>s+x,0)/a.length;
  const sd=Math.sqrt(a.reduce((s,x)=>s+(x-m)*(x-m),0)/a.length)||1;
  return a.map(x=>(x-m)/sd);
}
function sortNums(a){return [...a].sort((x,y)=>x-y);}
function roadKey(seq,H,kind){
  const s=seq.slice(-H); const last=s.at(-1)??2, prev=s.at(-2)??2;
  if(kind==='short')return s.slice(-4).join(',');
  const counts=[0,0,0,0,0]; for(const v of s)counts[v]++;
  const age=(target)=>{for(let i=0;i<s.length;i++)if(s[s.length-1-i]===target)return i;return H;};
  const bin=(x,edges)=>{let i=0;while(i<edges.length&&x>=edges[i])i++;return i;};
  const d=s.slice(-6); let up=0,down=0;for(let i=1;i<d.length;i++){if(d[i]>d[i-1])up++;else if(d[i]<d[i-1])down++;}
  if(kind==='mid')return [last,prev,bin(counts[4],[2,4,7]),bin(counts[0],[1,3,5]),bin(age(4),[2,5,10,20]),up-down].join(',');
  return [last,bin(counts[4],[4,7,11,16]),bin(counts[0],[2,5,9,14]),bin(age(4),[3,8,16,30,50]),bin(age(0),[3,8,16,30,50]),Math.sign(up-down)].join(',');
}
function roadScores(base,draws){
  const withBalls=draws.filter(d=>d.balls.length===20); if(withBalls.length<66)return null;
  const paths=Array.from({length:10},()=>[]);
  for(const d of withBalls){const sv=stateVector(d.balls);for(let c=0;c<10;c++)paths[c].push(sv[c]);}
  const scores=Array(10).fill(0),details=Array.from({length:10},()=>({}));
  for(let c=0;c<10;c++){
    for(const kind of ['short','mid','long']){
      const g=base.group?.[kind]; if(!g)continue;
      const key=roadKey(paths[c],Number(g.h),kind);
      const [n,h]=g.pool?.[key]||[0,0], [ns,hs]=g.specific?.[c]?.[key]||[0,0];
      const pp=n?(h+10)/(n+100):.1, ps=ns?(hs+5)/(ns+50):.1;
      const rel=Math.min(1,n/500), rels=Math.min(1,ns/120);
      const p=.1 + rel*(pp-.1)*.65 + rels*(ps-.1)*.35;
      const w=kind==='short'?1.2:(kind==='mid'?.9:.7);
      scores[c]+=w*(p-.1);
      details[c][kind]={p,n,ns,key};
    }
  }
  return{scores,details,paths};
}
function numericScores(base,currentBalls){
  const scale=Number(base.scale)||100000, ids=currentBalls.map(n=>n-1).filter(n=>n>=0&&n<80);
  if(ids.length!==20)return null;
  const target=Array(80).fill(0);
  for(let y=0;y<80;y++){
    const singles=ids.map(x=>(base.singleDelta?.[x]?.[y]||0)/scale).sort((a,b)=>a-b);
    let s=singles.slice(-5).reduce((a,b)=>a+b,0)/5 + .35*(singles.slice(0,3).reduce((a,b)=>a+b,0)/3);
    const pvals=[];
    for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++){
      const pi=PAIR_INDEX[ids[i]][ids[j]]; if(pi>=0)pvals.push((base.pairDelta?.[pi]?.[y]||0)/scale);
    }
    pvals.sort((a,b)=>a-b);
    s+=1.6*(pvals.slice(-8).reduce((a,b)=>a+b,0)/8)+.25*(pvals.slice(0,4).reduce((a,b)=>a+b,0)/4);
    target[y]=s;
  }
  const col=Array(10).fill(0);
  for(let c=0;c<10;c++){
    const vals=[];for(let y=c;y<80;y+=10)vals.push(target[y]);vals.sort((a,b)=>a-b);
    col[c]=vals.slice(-4).reduce((a,b)=>a+b,0)/4 + .3*(vals.reduce((a,b)=>a+b,0)/vals.length);
  }
  return{scores:col,target};
}
function buildModel(base,draws){
  const latest=draws.at(-1), numeric=numericScores(base,latest?.balls||[]), road=roadScores(base,draws);
  if(!numeric||!road)throw new Error('Для HYBRID-7.0 нужны 20 чисел и минимум 66 тиражей с числами');
  const zn=zscores(numeric.scores), zr=zscores(road.scores);
  const numOrder=[...Array(10).keys()].sort((a,b)=>zn[b]-zn[a]||a-b), numRank=Array(10);
  numOrder.forEach((c,i)=>numRank[c]=i+1);
  const selector=base.validation?.selector||{};
  const alpha=Number(selector.groupBoostAlpha??.4), threshold=Number(selector.groupZThreshold??.5), maxRank=Number(selector.maxNumericRankForBoost??6);
  const combined=zn.map((v,c)=>v + ((zr[c]>=threshold&&numRank[c]<=maxRank)?alpha*zr[c]:0));
  const order=[...Array(10).keys()].sort((a,b)=>combined[b]-combined[a]||a-b);
  const picks=order.slice(0,3).map(c=>c+1);
  const reserves=numOrder.filter(c=>!order.slice(0,3).includes(c)).slice(0,2).map(c=>c+1);
  const packages=order.map(c=>{
    const det=road.details[c];
    const boost=zr[c]>=threshold&&numRank[c]<=maxRank;
    return{
      col:c+1,score:combined[c],numberZ:zn[c],roadZ:zr[c],numberRank:numRank[c],boost,
      groupNow:road.paths[c].at(-1),
      short:det.short?.p??.1,mid:det.mid?.p??.1,long:det.long?.p??.1,
      shortKey:det.short?.key||'',midKey:det.mid?.key||'',longKey:det.long?.key||''
    };
  });
  const reasons={};
  for(const p of packages.slice(0,5)){
    const roadText=`дорожки 10/20/66: ${(p.short*100).toFixed(1)} / ${(p.mid*100).toFixed(1)} / ${(p.long*100).toFixed(1)}%`;
    reasons[p.col]=`${roadText}; числовой ранг ${p.numberRank}${p.boost?'; подтверждён движением групп':''}`;
  }
  const v=base.validation||{};
  const summary=`10 независимых дорожек по группам 0/1/2/3/4+ + маркеры число/пара→следующее число. Locked holdout: TOP-1 ${((v.top1||0)*100).toFixed(2)}%, TOP-3 ${((v.top3||0)*100).toFixed(2)}%, TOP-5 ${((v.top5||0)*100).toFixed(2)}% на ${v.tests||0} слепых шагах. Случайный ориентир: 10/30/50%.`;
  return{picks,reserves,reasons,packages,summary,validation:v};
}
function settle(archive,draws){
  const byDraw=new Map(draws.map(d=>[Number(d.draw),d]));
  for(const rec of archive){
    if((rec?.provider||'')!=='internal')continue;
    const actual=byDraw.get(Number(rec.targetDraw)); if(!actual)continue;
    rec.settled=true;rec.actualDraw=actual.draw;rec.actualColumn=actual.column;rec.actualTime=actual.time||'';rec.actualDate=actual.date||'';
    const p=Array.isArray(rec.picks)?rec.picks.indexOf(actual.column):-1, r=Array.isArray(rec.reserves)?rec.reserves.indexOf(actual.column):-1;
    rec.result=p===0?'TOP1':p>0?'TOP3':r>=0?'RESERVE':'MISS';
    if(!rec.targetDate)rec.targetDate=actual.date||'';if(!rec.targetTime||rec.targetTime==='—')rec.targetTime=String(actual.time||'').slice(0,5);
  }
}

const history=JSON.parse(await fs.readFile(HISTORY_FILE,'utf8'));
const markerBase=JSON.parse(await fs.readFile(MARKER_FILE,'utf8'));
const draws=flatten(history).sort((a,b)=>a.draw-b.draw).filter((d,i,a)=>i===a.length-1||d.draw!==a[i+1].draw);
if(draws.length<500)throw new Error(`Недостаточно истории: ${draws.length}`);
let archive=await readJson(ARCHIVE_FILE,[]); archive=Array.isArray(archive)?archive.filter(r=>(r?.provider||'')==='internal'):[]; settle(archive,draws);
const latest=draws.at(-1); let current=archive.find(r=>Number(r.baseDraw)===Number(latest.draw)&&String(r.version||'')===VERSION);
if(!current){
  const target=inferNextTarget(draws),model=buildModel(markerBase,draws);
  current={
    id:`internal-${latest.draw}-${Date.now()}`,provider:'internal',auto:true,version:VERSION,createdAt:new Date().toISOString(),
    baseDraw:latest.draw,targetDraw:target.draw,targetTime:target.time,targetDate:target.date,
    officialSchedule:CURRENT_SCHEDULE,scheduleSource:'current official KENO 4M schedule',
    picks:model.picks,reserves:model.reserves,reasons:model.reasons,confidence:'экспериментальный',summary:model.summary,
    packages:model.packages,validation:model.validation,markerBaseVersion:markerBase.version,markerBaseThrough:markerBase.trainedThroughDraw,
    settled:false,actualDraw:null,actualColumn:null,actualTime:'',actualDate:'',result:null
  };
  archive.push(current);
}
const byBase=new Map();for(const rec of archive)byBase.set(Number(rec.baseDraw),rec);
const final=[...byBase.values()].sort((a,b)=>Number(a.targetDraw||0)-Number(b.targetDraw||0)).slice(-500);
await fs.writeFile(ARCHIVE_FILE,JSON.stringify(final,null,2)+'\n','utf8');
console.log(`INTERNAL ${VERSION} · база №${latest.draw} · прогноз №${current.targetDraw} · TOP-3 ${(current.picks||[]).join(',')} · РЕЗЕРВ ${(current.reserves||[]).join(',')}`);
