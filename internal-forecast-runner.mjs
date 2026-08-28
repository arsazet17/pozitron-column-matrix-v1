'use strict';

import fs from 'node:fs/promises';

const HISTORY_FILE='keno-history.json';
const ARCHIVE_FILE='internal-forecast-archive.json';
const VERSION='HYBRID-6.1-SERVER';

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
      out.push({draw,column,date:String(v.date||''),time:String(v.time||'')}); return out;
    }
    for(const x of Object.values(v)) if(x&&typeof x==='object') flatten(x,out);
  }
  return out;
}
async function readJson(file,fallback){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch{return fallback;}}
function clamp(x,lo,hi){return Math.max(lo,Math.min(hi,x));}
function mean(a){return a.length?a.reduce((x,y)=>x+y,0)/a.length:0;}
function dateParts(value){
  const raw=String(value||'').trim();
  let m=raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if(m)return{y:+m[1],mo:+m[2],d:+m[3]};
  m=raw.match(/^(\d{2})[.\-/](\d{2})[.\-/](\d{2}|\d{4})$/);
  if(!m)return null;
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
  let i=mins.findIndex(x=>x>cur), target=dp;
  if(i<0){i=0;target=addDays(dp,1);}
  return{draw:latest.draw+1,time:CURRENT_SCHEDULE[i],date:formatRu(target)};
}
function frequencyMap(seq){const c=Array(11).fill(0);seq.forEach(x=>{if(x>=1&&x<=10)c[x]++;});return c;}
function conditionalLift(seq,anchor,candidate,lag=1){
  let denom=0,hit=0; const baseCount=seq.reduce((n,x)=>n+(x===candidate),0), base=baseCount/Math.max(1,seq.length);
  for(let i=lag;i<seq.length;i++) if(seq[i-lag]===anchor){denom++;if(seq[i]===candidate)hit++;}
  const p=(hit+1.2)/(denom+12), lift=base>0?p/base:1, reliability=clamp(denom/45,0,1);
  return{p,lift,denom,hit,reliability};
}
function gapProfile(seq,col){
  const pos=[];seq.forEach((x,i)=>{if(x===col)pos.push(i);});
  const gaps=[];for(let i=1;i<pos.length;i++)gaps.push(pos[i]-pos[i-1]);
  const current=pos.length?seq.length-1-pos.at(-1):seq.length;
  if(!gaps.length)return{current,median:null,q75:null,hazard:.1,sample:0};
  const s=[...gaps].sort((a,b)=>a-b),med=s[Math.floor(s.length*.5)],q75=s[Math.floor(s.length*.75)],need=current+1;
  const atRisk=gaps.filter(g=>g>=need).length, exact=gaps.filter(g=>g===need).length;
  return{current,median:med,q75,hazard:(exact+1)/(atRisk+10),sample:gaps.length};
}
function packageState(seq,col,p,friend){
  const last=[];for(let lag=1;lag<=7;lag++)if(seq.at(-lag)===col)last.push(lag);
  const veryRecent=last.some(x=>x<=3), overdue=p.q75&&p.current>=p.q75;
  if(veryRecent&&friend>.08)return'АКТИВЕН';
  if(last.length>=2)return'АКТИВЕН';
  if(overdue||friend>.16)return'РАЗВОРАЧИВАЕТСЯ';
  if(p.current<=2&&friend<-.08)return'ЗАТУХАЕТ';
  return'СВЁРНУТ';
}
function buildInternalSnapshot(draws,opts={}){
  const maxWindow=Math.min(opts.maxWindow||1400,draws.length),work=draws.slice(-maxWindow),seq=work.map(d=>d.column),latestSeq=draws.map(d=>d.column);
  const targetTime=opts.targetTime||inferNextTarget(draws).time.slice(0,5),windows=[80,200,500,Math.min(1200,seq.length)];
  const freqByWindow=windows.map(w=>frequencyMap(seq.slice(-Math.min(w,seq.length)))),baseAll=frequencyMap(seq),latestCols=[];
  for(let lag=1;lag<=5;lag++)latestCols.push(latestSeq.at(-lag));
  const rows=[];
  for(let col=1;col<=10;col++){
    const reasons=[];let score=50,friend=0,friendWeight=0;
    for(let lag=1;lag<=5;lag++){
      const anchor=latestCols[lag-1];if(!anchor)continue;
      const st=conditionalLift(seq,anchor,col,lag),raw=clamp(st.lift-1,-.65,.9)*st.reliability,lagWeight=[1,.72,.55,.42,.34][lag-1];
      friend+=raw*lagWeight;friendWeight+=lagWeight;
      if(lag<=3&&raw>.18)reasons.push(`дружба ${anchor}→${col} через ${lag}: +${Math.round(raw*100)}%`);
    }
    const friendNorm=friend/Math.max(.01,friendWeight);score+=clamp(friendNorm*24,-12,16);
    let selfSignal=0;
    for(let lag=1;lag<=5;lag++){
      if(latestSeq.at(-lag)!==col)continue;
      const st=conditionalLift(seq,col,col,lag),bump=clamp((st.lift-1)*st.reliability,-.5,.9)*[1,.8,.65,.52,.42][lag-1];
      selfSignal+=bump;if(bump>.12)reasons.push(lag===1?'поддержка повтора':`поддержка возврата через ${lag-1}`);
    }
    score+=clamp(selfSignal*15,-7,13);
    const gp=gapProfile(seq,col),hazardLift=(gp.hazard/.10)-1;score+=clamp(hazardLift*5,-6,10);
    if(hazardLift>.35)reasons.push(`разрыв ${gp.current}: повышенная фаза возврата`);
    const lifts=freqByWindow.map((fm,i)=>{const w=Math.min(windows[i],seq.length),p=fm[col]/Math.max(1,w),b=baseAll[col]/Math.max(1,seq.length);return b?p/b:1;});
    const recentLift=mean(lifts.slice(0,3)),consistent=lifts.filter(x=>x>1.05).length;
    score+=clamp((recentLift-1)*8,-4,6)+(consistent>=3?2:0);
    if(consistent>=3)reasons.push('поддержка нескольких окон 80/200/500');
    if(targetTime&&targetTime!=='—'){
      const sameTime=work.filter(d=>String(d.time||'').slice(0,5)===targetTime);
      if(sameTime.length>=18){
        const hits=sameTime.filter(d=>d.column===col).length,p=(hits+1)/(sameTime.length+10),base=baseAll[col]/Math.max(1,seq.length),lift=base?p/base:1;
        score+=clamp((lift-1)*4,-3,4);if(lift>1.25)reasons.push(`время ${targetTime} исторически поддерживает`);
      }
    }
    const state=packageState(latestSeq,col,gp,friendNorm+selfSignal);
    if(state==='АКТИВЕН')score+=4;else if(state==='РАЗВОРАЧИВАЕТСЯ')score+=2.5;else if(state==='ЗАТУХАЕТ')score-=2;
    rows.push({col,score:clamp(score,0,100),state,gap:gp.current,reasons:reasons.slice(0,4),friend:friendNorm,self:selfSignal});
  }
  rows.sort((a,b)=>b.score-a.score||a.col-b.col);return rows;
}
function backtestInternal(draws,count=120){
  const start=Math.max(500,draws.length-count);let tests=0,hits=0,top1=0;
  for(let i=start;i<draws.length;i++){
    const hist=draws.slice(0,i),targetTime=String(draws[i]?.time||'').slice(0,5),rows=buildInternalSnapshot(hist,{maxWindow:1200,targetTime}),picks=rows.slice(0,3).map(x=>x.col);
    tests++;if(picks.includes(draws[i].column))hits++;if(picks[0]===draws[i].column)top1++;
  }
  return{tests,hits,top1,hitRate:tests?hits/tests:0,top1Rate:tests?top1/tests:0};
}
function runInternalModel(draws){
  const target=inferNextTarget(draws),rows=buildInternalSnapshot(draws,{targetTime:target.time}),picks=rows.slice(0,3).map(x=>x.col),reasons={};
  rows.slice(0,3).forEach(r=>{reasons[r.col]=`${r.state} · ${r.reasons.length?r.reasons.join('; '):`сводный балл ${r.score.toFixed(1)}`}`;});
  const bt=backtestInternal(draws,120),confidence=bt.hitRate>=.36?'повышенный':bt.hitRate>=.30?'средний':'низкий';
  const packageSummary=rows.slice(0,5).map(r=>`СТ${r.col} ${r.state.toLowerCase()} ${r.score.toFixed(0)}`).join(' · ');
  return{target,picks,reasons,confidence,summary:`Пакеты: ${packageSummary}. Проверка без подглядывания: TOP-3 ${Math.round(bt.hitRate*100)}% на ${bt.tests} последних шагах (случайный ориентир 30%).`,packages:rows,backtest:bt};
}
function settle(archive,draws){
  const byDraw=new Map(draws.map(d=>[Number(d.draw),d]));
  for(const rec of archive){
    if((rec?.provider||'')!=='internal')continue;
    const actual=byDraw.get(Number(rec.targetDraw));
    if(!actual)continue;
    rec.settled=true;rec.actualDraw=actual.draw;rec.actualColumn=actual.column;rec.actualTime=actual.time||'';rec.actualDate=actual.date||'';
    const pos=Array.isArray(rec.picks)?rec.picks.indexOf(actual.column):-1;rec.result=pos===0?'TOP1':pos>0?'TOP3':'MISS';
    if(!rec.targetDate)rec.targetDate=actual.date||'';if(!rec.targetTime||rec.targetTime==='—')rec.targetTime=String(actual.time||'').slice(0,5);
  }
}

const history=JSON.parse(await fs.readFile(HISTORY_FILE,'utf8'));
const draws=flatten(history).sort((a,b)=>a.draw-b.draw).filter((d,i,a)=>i===a.length-1||d.draw!==a[i+1].draw);
if(draws.length<500)throw new Error(`Недостаточно истории: ${draws.length}`);
let archive=await readJson(ARCHIVE_FILE,[]);
archive=Array.isArray(archive)?archive.filter(r=>(r?.provider||'')==='internal'):[];
settle(archive,draws);

const latest=draws.at(-1);
let current=archive.find(r=>Number(r.baseDraw)===Number(latest.draw));
if(!current){
  const model=runInternalModel(draws);
  current={
    id:`internal-${latest.draw}-${Date.now()}`,provider:'internal',auto:true,version:VERSION,createdAt:new Date().toISOString(),
    baseDraw:latest.draw,targetDraw:model.target.draw,targetTime:model.target.time,targetDate:model.target.date,
    officialSchedule:CURRENT_SCHEDULE,scheduleSource:'current official KENO 4M schedule',
    picks:model.picks,reasons:model.reasons,confidence:model.confidence,summary:model.summary,packages:model.packages,backtest:model.backtest,
    settled:false,actualDraw:null,actualColumn:null,actualTime:'',actualDate:'',result:null
  };
  archive.push(current);
}
const byBase=new Map();for(const rec of archive)byBase.set(Number(rec.baseDraw),rec);
const final=[...byBase.values()].sort((a,b)=>Number(a.targetDraw||0)-Number(b.targetDraw||0)).slice(-500);
await fs.writeFile(ARCHIVE_FILE,JSON.stringify(final,null,2)+'\n','utf8');
console.log(`INTERNAL SERVER PASS · база №${latest.draw} · прогноз №${current.targetDraw} · TOP-3 ${(current.picks||[]).join(',')}`);
