'use strict';
import fs from 'node:fs/promises';

const HISTORY_FILE='keno-history.json';
const MARKER_FILE='marker-base.json';
const INTERNAL_FILE='internal-forecast-archive.json';
const ARCHIVE_FILE='combo-forecast-archive.json';
const MODEL_FILE='combo-model-state.json';
const VERSION='COMBO-AI-2.0.1';
const MAX_ARCHIVE=600;
const CURRENT_SCHEDULE=['00:02','00:17','00:32','01:02','01:17','01:32','02:02','02:17','02:32','03:02','03:32','04:02','04:17','04:32','05:02','05:17','05:32','06:02','06:17','06:32','07:02','07:32','08:02','08:17','08:32','09:02','09:17','09:32','10:02','10:17','10:32','11:02','11:32','12:02','12:17','12:32','13:02','13:17','13:32','14:02','14:17','14:32','15:02','15:32','16:02','16:17','16:32','17:02','17:17','17:32','18:02','18:17','18:32','19:02','19:32','20:02','20:17','20:32','21:02','21:17','21:32','22:02','22:17','22:32','23:02','23:32'];
const PAYOUTS={7:{7:250000,6:10000,5:1200,4:200,3:100,0:150},6:{6:75000,5:4180,4:750,3:200},5:{5:20000,4:1920,3:400},4:{4:3300,3:300,2:100},3:{3:1500,2:300}};
const CLUSTERS=['marker','anchor','add','repeat','group','road','pattern','parity','position','cooccur'];
const DEFAULT_WEIGHTS={
  3:{marker:.20,anchor:.18,add:.08,repeat:.06,group:.05,road:.08,pattern:.06,parity:.04,position:.08,cooccur:.17},
  4:{marker:.08,anchor:.22,add:.20,repeat:.08,group:.08,road:.05,pattern:.05,parity:.06,position:.12,cooccur:.06},
  5:{marker:.08,anchor:.06,add:.08,repeat:.06,group:.26,road:.18,pattern:.08,parity:.08,position:.04,cooccur:.08},
  6:{marker:.05,anchor:.10,add:.08,repeat:.18,group:.06,road:.06,pattern:.20,parity:.10,position:.10,cooccur:.07},
  7:{marker:.12,anchor:.10,add:.10,repeat:.08,group:.10,road:.10,pattern:.10,parity:.08,position:.08,cooccur:.14}
};
const MAX_OVERLAP={3:{4:1,5:1,6:1,7:1},4:{5:1,6:2,7:2},5:{6:2,7:2},6:{7:2}};

function clamp(x,a,b){return Math.max(a,Math.min(b,x));}
function safeNum(x,d=0){x=Number(x);return Number.isFinite(x)?x:d}
function groupOf(n){return n>=4?4:n}
function colOf(n){return ((n-1)%10)+1}
function parityOf(n){return n%2?'odd':'even'}
function prize(size,hits){return Number(PAYOUTS[size]?.[hits]||0)}
function flatten(v,out=[]){
  if(Array.isArray(v)){for(const x of v)flatten(x,out);return out}
  if(v&&typeof v==='object'){
    const draw=Number(v.draw), balls=Array.isArray(v.balls)?v.balls.map(Number).filter(n=>n>=1&&n<=80).slice(0,20):[];
    if(Number.isFinite(draw)&&balls.length===20){out.push({draw,date:String(v.date||''),time:String(v.time||''),column:Number(v.column)||null,balls});return out}
    for(const x of Object.values(v))if(x&&typeof x==='object')flatten(x,out)
  }
  return out
}
function dedupe(a){const m=new Map();for(const d of a)m.set(d.draw,d);return [...m.values()].sort((a,b)=>a.draw-b.draw)}
async function readJson(file,fallback){try{return JSON.parse(await fs.readFile(file,'utf8'))}catch{return fallback}}
function dateParts(v){const s=String(v||'').trim();let m=s.match(/^(\d{4})-(\d{2})-(\d{2})$/);if(m)return{y:+m[1],mo:+m[2],d:+m[3]};m=s.match(/^(\d{2})[.\-/](\d{2})[.\-/](\d{2}|\d{4})$/);if(!m)return null;return{y:+(m[3].length===2?'20'+m[3]:m[3]),mo:+m[2],d:+m[1]}}
function addDays(p,n){const d=new Date(Date.UTC(p.y,p.mo-1,p.d+n));return{y:d.getUTCFullYear(),mo:d.getUTCMonth()+1,d:d.getUTCDate()}}
function fmtDate(p){return p?`${String(p.d).padStart(2,'0')}.${String(p.mo).padStart(2,'0')}.${p.y}`:''}
function inferTarget(draws){const last=draws.at(-1);if(!last)return{draw:null,date:'',time:'—'};const tm=String(last.time).match(/(\d{1,2}):(\d{2})/),p=dateParts(last.date);if(!tm||!p)return{draw:last.draw+1,date:'',time:'—'};const cur=+tm[1]*60 + +tm[2],mins=CURRENT_SCHEDULE.map(t=>{const[a,b]=t.split(':').map(Number);return a*60+b});let i=mins.findIndex(x=>x>cur),dp=p;if(i<0){i=0;dp=addDays(p,1)}return{draw:last.draw+1,date:fmtDate(dp),time:CURRENT_SCHEDULE[i]}}
function norm01(a){let lo=Math.min(...a),hi=Math.max(...a);if(!Number.isFinite(lo)||hi===lo)return a.map(()=>.5);return a.map(x=>(x-lo)/(hi-lo))}
function normalizeWeights(w){for(const k of CLUSTERS)w[k]=clamp(safeNum(w[k],.01),.02,.40);const s=CLUSTERS.reduce((a,k)=>a+w[k],0)||1;for(const k of CLUSTERS)w[k]/=s;return w}
function loadModel(raw){const m=raw&&typeof raw==='object'?raw:{};const weights={};for(const size of [3,4,5,6,7])weights[size]=normalizeWeights({...DEFAULT_WEIGHTS[size],...(m.weights?.[size]||{})});return{version:VERSION,experience:safeNum(m.experience),lastSettledDraw:safeNum(m.lastSettledDraw),updatedAt:m.updatedAt||null,weights,clusterRecord:{...Object.fromEntries(CLUSTERS.map(k=>[k,0])),...(m.clusterRecord||{})}}}

const PAIRS=(()=>{const o=[];for(let a=0;a<80;a++)for(let b=a+1;b<80;b++)o.push([a,b]);return o})();
const PAIR_INDEX=(()=>{const x=Array.from({length:80},()=>Array(80).fill(-1));PAIRS.forEach(([a,b],i)=>{x[a][b]=i;x[b][a]=i});return x})();
function markerScores(base,current){const scale=safeNum(base?.scale,100000),ids=current.map(n=>n-1),raw=Array(80).fill(0);if(!base?.singleDelta)return raw.map(()=>.5);for(let y=0;y<80;y++){const s=ids.map(x=>safeNum(base.singleDelta?.[x]?.[y])/scale).sort((a,b)=>b-a);let z=s.slice(0,6).reduce((a,b)=>a+b,0)/6;if(base.pairDelta){const pv=[];for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++){const pi=PAIR_INDEX[ids[i]][ids[j]];if(pi>=0)pv.push(safeNum(base.pairDelta?.[pi]?.[y])/scale)}pv.sort((a,b)=>b-a);z+=1.35*pv.slice(0,10).reduce((a,b)=>a+b,0)/10}raw[y]=z}return norm01(raw)}

function anchorAndAddScores(draws,current){const cur=new Set(current),anchor=Array(81).fill(0),add=Array(81).fill(0),support=Array(81).fill(0);for(let i=0;i<draws.length-1;i++){const prev=draws[i].balls,next=draws[i+1].balls,nextSet=new Set(next);const common=prev.filter(n=>cur.has(n));if(!common.length)continue;for(const a of common){support[a]++;for(const n of next){if(n===a)anchor[n]+=1.4;else add[n]+=1}if(nextSet.has(a))anchor[a]+=1.2}}
  const ar=[],ad=[];for(let n=1;n<=80;n++){ar.push(anchor[n]+(cur.has(n)?support[n]*.08:0));ad.push(add[n]*(cur.has(n)?.65:1.12))}return{anchor:norm01(ar),add:norm01(ad)}}
function repeatScores(draws,current){const sets=draws.map(d=>new Set(d.balls)),N=sets.length,raw=Array(80).fill(0);for(let n=1;n<=80;n++){let s=0,trans=0,keep=0;for(let i=0;i<N-1;i++)if(sets[i].has(n)){trans++;if(sets[i+1].has(n))keep++}if(current.includes(n))s+=trans?1.6*(keep/trans):.3;let age=N;for(let i=N-1;i>=0;i--)if(sets[i].has(n)){age=N-1-i;break}if(age===1)s+=.45;if(age===2)s+=.6;if(age===3)s+=.45;if(age>=6&&age<=10)s+=.22;if(N>2&&sets[N-2].has(n)&&!sets[N-1].has(n))s+=.5;if(N>3&&sets[N-3].has(n)&&!sets[N-2].has(n)&&!sets[N-1].has(n))s+=.32;raw[n-1]=s}return norm01(raw)}
function groupCounts(balls){const c=Array(10).fill(0);for(const n of balls)c[colOf(n)-1]++;return c}
function groupRoadScores(draws,current,internal){const curG=groupCounts(current).map(groupOf),num=Array(81).fill(0),col=Array(10).fill(0),sup=0;for(let i=0;i<draws.length-1;i++){const g=groupCounts(draws[i].balls).map(groupOf);let dist=0;for(let c=0;c<10;c++)dist+=Math.abs(g[c]-curG[c]);if(dist>6)continue;const w=1/(1+dist);sup+=w;const nxt=draws[i+1];for(const n of nxt.balls)num[n]+=w;if(nxt.column)col[nxt.column-1]+=2*w}
  const latestInternal=[...(Array.isArray(internal)?internal:[])].reverse().find(r=>!r.settled||r.targetDraw===draws.at(-1)?.draw+1);if(latestInternal){for(const p of latestInternal.packages||[]){const c=Number(p.col)-1;if(c>=0&&c<10)col[c]+=Math.max(0,safeNum(p.score))*2.5}}
  const colN=norm01(col),raw=[];for(let n=1;n<=80;n++)raw.push((sup?num[n]/sup:0)*.65+colN[colOf(n)-1]*.35);return{group:norm01(raw),road:colN}}
function patternScores(draws,current){const N=draws.length,sets=draws.map(d=>new Set(d.balls)),raw=Array(80).fill(0),wins=[8,20,66,250];for(let n=1;n<=80;n++){let s=0;wins.forEach((w,ix)=>{let c=0;for(let i=Math.max(0,N-w);i<N;i++)if(sets[i].has(n))c++;const p=c/Math.min(w,N);s+=p*[1.6,1.25,.85,.45][ix]});let streak=0;for(let i=N-1;i>=0&&sets[i].has(n);i--)streak++;if(streak>=2)s-=.12*streak;if(current.includes(n))s+=.15;raw[n-1]=s}return norm01(raw)}
function parityScores(draws,current){const curEven=current.filter(n=>n%2===0).length,raw=Array(80).fill(0),cnt={even:0,odd:0},sup=0;for(let i=0;i<draws.length-1;i++){const e=draws[i].balls.filter(n=>n%2===0).length;if(Math.abs(e-curEven)>2)continue;sup++;for(const n of draws[i+1].balls)cnt[parityOf(n)]++}const pe=sup?cnt.even/(cnt.even+cnt.odd):.5;for(let n=1;n<=80;n++)raw[n-1]=(n%2===0?pe:1-pe);return norm01(raw)}
function positionScores(draws,current){const raw=Array(81).fill(0),sup=Array(81).fill(0);for(let i=0;i<draws.length-1;i++){const a=draws[i].balls,b=draws[i+1].balls;for(let p=0;p<20;p++){const anchor=a[p];if(!current.includes(anchor))continue;for(let q=Math.max(0,p-2);q<=Math.min(19,p+2);q++){raw[b[q]]+=q===p?1.4:1;sup[b[q]]++}}}return norm01(raw.slice(1))}
function cooccurScores(draws,current){const raw=Array(81).fill(0);const anchors=current;for(let i=0;i<draws.length-1;i++){const a=new Set(draws[i].balls),b=draws[i+1].balls;let m=0;for(const n of anchors)if(a.has(n))m++;if(m<2)continue;const w=m*m;for(const n of b)raw[n]+=w}return norm01(raw.slice(1))}
function buildClusters(base,draws,internal){const cur=draws.at(-1).balls;const aa=anchorAndAddScores(draws,cur),gr=groupRoadScores(draws,cur,internal),roadNums=Array.from({length:80},(_,i)=>gr.road[colOf(i+1)-1]);return{marker:markerScores(base,cur),anchor:aa.anchor,add:aa.add,repeat:repeatScores(draws,cur),group:gr.group,road:roadNums,pattern:patternScores(draws,cur),parity:parityScores(draws,cur),position:positionScores(draws,cur),cooccur:cooccurScores(draws,cur)}}

function strategyScore(comp,w,size,n,current){let s=0;for(const k of CLUSTERS)s+=comp[k]*w[k];const present=current.has(n);if(size===3)s+=.08*Math.min(comp.marker,comp.anchor,comp.cooccur);if(size===4)s+=.08*Math.min(comp.anchor,comp.add,comp.position)+(present?.015:.035);if(size===5)s+=.10*Math.min(comp.group,comp.road)+(comp.parity*.03);if(size===6)s+=.08*Math.min(comp.repeat,comp.pattern,comp.position)+(present?.03:0);if(size===7)s+=.05*Math.min(comp.marker,comp.group,comp.cooccur)+.03*comp.parity;return s}
function ranking(clusters,w,size,currentBalls){const cur=new Set(currentBalls),rows=[];for(let n=1;n<=80;n++){const comp=Object.fromEntries(CLUSTERS.map(k=>[k,clusters[k][n-1]]));rows.push({n,col:colOf(n),parity:parityOf(n),comp,score:strategyScore(comp,w,size,n,cur)})}return rows.sort((a,b)=>b.score-a.score||a.n-b.n)}
function overlapCount(nums,other){const s=new Set(other);return nums.filter(n=>s.has(n)).length}
function allowedOverlap(size,priorSize){const a=Math.min(size,priorSize),b=Math.max(size,priorSize);return MAX_OVERLAP[a]?.[b]??Math.max(1,Math.floor(a*.4))}
function validAgainstPrior(nums,size,prior){for(const p of prior){if(overlapCount(nums,p.numbers)>allowedOverlap(size,p.size))return false}return true}
function selectDiverse(rank,size,prior,currentBalls){const chosen=[],cols=Array(11).fill(0);let even=0;for(const r of rank){if(chosen.length>=size)break;const test=[...chosen.map(x=>x.n),r.n];if(!validAgainstPrior(test,size,prior))continue;if(cols[r.col]>=2)continue;const nextEven=even+(r.parity==='even'?1:0);const remain=size-test.length;if(nextEven>Math.ceil(size*.7))continue;if((test.length-nextEven)>Math.ceil(size*.7))continue;const near=chosen.some(x=>Math.abs(x.n-r.n)<=1);if(near&&size<=5)continue;chosen.push(r);cols[r.col]++;even=nextEven}
  if(chosen.length<size){for(const r of rank){if(chosen.some(x=>x.n===r.n))continue;const test=[...chosen.map(x=>x.n),r.n];if(!validAgainstPrior(test,size,prior))continue;chosen.push(r);if(chosen.length===size)break}}
  return chosen.slice(0,size).sort((a,b)=>a.n-b.n)}
function makeForecast(draws,base,internal,model){const clusters=buildClusters(base,draws,internal),prior=[],combos={};for(const size of [3,4,5,6,7]){const w=normalizeWeights({...model.weights[size]});const rank=ranking(clusters,w,size,draws.at(-1).balls);const picks=selectDiverse(rank,size,prior,draws.at(-1).balls);combos['K'+size]={size,numbers:picks.map(x=>x.n),score:+(picks.reduce((a,x)=>a+x.score,0)/size).toFixed(6),weights:w,components:Object.fromEntries(picks.map(x=>[x.n,x.comp]))};prior.push(combos['K'+size])}return{id:`${draws.at(-1).draw}->${inferTarget(draws).draw}`,version:VERSION,createdAt:new Date().toISOString(),baseDraw:draws.at(-1).draw,target:inferTarget(draws),status:'open',combos,training:{archiveDraws:draws.length,experience:model.experience}}}
function rewardModel(rec,actual,model){const set=new Set(actual.balls);for(const size of [3,4,5,6,7]){const c=rec.combos?.['K'+size];if(!c)continue;const hits=c.numbers.filter(n=>set.has(n));c.hits=hits.length;c.hitNumbers=hits;c.prize=prize(size,hits.length);for(const k of CLUSTERS){const vals=c.numbers.map(n=>safeNum(c.components?.[n]?.[k],.5));const hitVals=hits.map(n=>safeNum(c.components?.[n]?.[k],.5));const avg=vals.reduce((a,b)=>a+b,0)/Math.max(1,vals.length),hav=hitVals.length?hitVals.reduce((a,b)=>a+b,0)/hitVals.length:0;const reward=hits.length?(hav-avg):-(avg-.5)*.22;model.weights[size][k]=clamp(model.weights[size][k]+reward*.025,.02,.40);model.clusterRecord[k]=(model.clusterRecord[k]||0)+reward}normalizeWeights(model.weights[size])}model.experience++;model.lastSettledDraw=Math.max(model.lastSettledDraw||0,actual.draw)}
function settle(archive,draws,model){const by=new Map(draws.map(d=>[d.draw,d]));let changed=false;for(const rec of archive){if(rec.status!=='open')continue;const actual=by.get(Number(rec.target?.draw));if(!actual)continue;rec.status='closed';rec.closedAt=new Date().toISOString();rec.actual={draw:actual.draw,date:actual.date,time:actual.time,column:actual.column,balls:actual.balls};rewardModel(rec,actual,model);changed=true}return changed}

const history=dedupe(flatten(JSON.parse(await fs.readFile(HISTORY_FILE,'utf8'))));
if(history.length<100)throw new Error(`Недостаточно истории: ${history.length}`);
const marker=JSON.parse(await fs.readFile(MARKER_FILE,'utf8'));
const internal=await readJson(INTERNAL_FILE,[]);
let archive=await readJson(ARCHIVE_FILE,[]);archive=Array.isArray(archive)?archive:[];
let model=loadModel(await readJson(MODEL_FILE,{}));
settle(archive,history,model);
const latest=history.at(-1);
let open=archive.find(r=>r.status==='open'&&Number(r.baseDraw)===latest.draw);
if(!open){open=makeForecast(history,marker,internal,model);archive.push(open)}
archive=archive.sort((a,b)=>Number(a.target?.draw||0)-Number(b.target?.draw||0)).slice(-MAX_ARCHIVE);
model.updatedAt=new Date().toISOString();model.version=VERSION;
await fs.writeFile(ARCHIVE_FILE,JSON.stringify(archive,null,2)+'\n');
await fs.writeFile(MODEL_FILE,JSON.stringify(model,null,2)+'\n');
console.log(`${VERSION} · base ${latest.draw} -> ${open.target.draw} · ${[3,4,5,6,7].map(k=>`K${k}:${open.combos['K'+k].numbers.join('-')}`).join(' | ')}`);
