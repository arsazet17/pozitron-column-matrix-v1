'use strict';

(() => {
  const HISTORY_URL = 'https://raw.githubusercontent.com/arsazet17/pozitron-column-matrix-v1/main/keno-history.json';
  const MARKER_URL = './marker-base.json';
  const ARCHIVE_KEY = 'pozitron_combo_forecast_archive_v1';
  const MODEL_KEY = 'pozitron_combo_learning_state_v1';
  const LAST_SYNC_KEY = 'pozitron_combo_last_sync_v1';
  const ENGINE_VERSION = 'COMBO-AI-1.0.0';
  const REFRESH_MS = 60000;
  const MAX_ARCHIVE = 500;
  const $ = id => document.getElementById(id);

  const PAYOUTS = {
    7:{7:250000,6:10000,5:1200,4:200,3:100,0:150},
    6:{6:75000,5:4180,4:750,3:200},
    5:{5:20000,4:1920,3:400},
    4:{4:3300,3:300,2:100},
    3:{3:1500,2:300}
  };

  const CURRENT_SCHEDULE = [
    '00:02','00:17','00:32','01:02','01:17','01:32','02:02','02:17','02:32','03:02','03:32','04:02',
    '04:17','04:32','05:02','05:17','05:32','06:02','06:17','06:32','07:02','07:32','08:02','08:17',
    '08:32','09:02','09:17','09:32','10:02','10:17','10:32','11:02','11:32','12:02','12:17','12:32',
    '13:02','13:17','13:32','14:02','14:17','14:32','15:02','15:32','16:02','16:17','16:32','17:02',
    '17:17','17:32','18:02','18:17','18:32','19:02','19:32','20:02','20:17','20:32','21:02','21:17',
    '21:32','22:02','22:17','22:32','23:02','23:32'
  ];

  const DEFAULT_WEIGHTS = {
    3:{marker:.42,transition:.25,group:.18,pattern:.15},
    4:{marker:.25,transition:.35,group:.25,pattern:.15},
    5:{marker:.25,transition:.25,group:.32,pattern:.18},
    6:{marker:.20,transition:.30,group:.25,pattern:.25},
    7:{marker:.25,transition:.25,group:.25,pattern:.25}
  };

  let refreshBusy = false;
  let markerBaseCache = null;
  let lastDraws = [];

  function safeJson(raw, fallback) { try { return JSON.parse(raw); } catch (_) { return fallback; } }
  function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }
  function fmt(n){ return String(n).padStart(2,'0'); }
  function rub(n){ return `${Number(n||0).toLocaleString('ru-RU')} ₽`; }
  function prize(size,hits){ return Number(PAYOUTS[size]?.[hits] || 0); }
  function groupOf(n){ return n >= 4 ? 4 : n; }
  function colOf(n){ return ((Number(n)-1)%10)+1; }

  function normalizeDraw(d){
    if (!d || !Number.isFinite(Number(d.draw))) return null;
    const balls = Array.isArray(d.balls) ? d.balls.map(Number).filter(n=>n>=1&&n<=80).slice(0,20) : [];
    if (balls.length !== 20) return null;
    return {draw:Number(d.draw),date:String(d.date||''),time:String(d.time||''),column:Number(d.column)||null,balls};
  }
  function dedupeDraws(items){
    const m=new Map(); (Array.isArray(items)?items:[]).forEach(x=>{const d=normalizeDraw(x);if(d)m.set(d.draw,d)});
    return [...m.values()].sort((a,b)=>a.draw-b.draw);
  }
  async function fetchHistory(){
    const r=await fetch(`${HISTORY_URL}?ts=${Date.now()}`,{cache:'no-store'});
    if(!r.ok) throw new Error(`архив HTTP ${r.status}`);
    return dedupeDraws(await r.json());
  }
  async function fetchMarkerBase(){
    if(markerBaseCache) return markerBaseCache;
    const r=await fetch(`${MARKER_URL}?ts=${Date.now()}`,{cache:'no-store'});
    if(!r.ok) throw new Error(`маркеры HTTP ${r.status}`);
    markerBaseCache=await r.json(); return markerBaseCache;
  }

  function loadArchive(){ const a=safeJson(localStorage.getItem(ARCHIVE_KEY)||'[]',[]); return Array.isArray(a)?a:[]; }
  function saveArchive(a){ localStorage.setItem(ARCHIVE_KEY,JSON.stringify(a.slice(-MAX_ARCHIVE))); }
  function loadModel(){
    const raw=safeJson(localStorage.getItem(MODEL_KEY)||'{}',{});
    const weights={};
    for(const k of [3,4,5,6,7]) weights[k]={...DEFAULT_WEIGHTS[k],...(raw.weights?.[k]||{})};
    return {version:ENGINE_VERSION,experience:Number(raw.experience||0),updatedAt:raw.updatedAt||null,weights,clusterRecord:raw.clusterRecord||{marker:0,transition:0,group:0,pattern:0}};
  }
  function saveModel(m){ m.version=ENGINE_VERSION;m.updatedAt=new Date().toISOString();localStorage.setItem(MODEL_KEY,JSON.stringify(m)); }
  function normalizeWeights(w){
    const keys=['marker','transition','group','pattern'];
    keys.forEach(k=>w[k]=clamp(Number(w[k])||.01,.08,.60));
    const s=keys.reduce((a,k)=>a+w[k],0)||1; keys.forEach(k=>w[k]/=s); return w;
  }

  function dateParts(value){
    const s=String(value||'').trim(); let m=s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(m)return{y:+m[1],mo:+m[2],d:+m[3]};
    m=s.match(/^(\d{2})[.\-/](\d{2})[.\-/](\d{2}|\d{4})$/); if(!m)return null;
    return{y:+(m[3].length===2?'20'+m[3]:m[3]),mo:+m[2],d:+m[1]};
  }
  function addDays(p,n){const d=new Date(Date.UTC(p.y,p.mo-1,p.d+n));return{y:d.getUTCFullYear(),mo:d.getUTCMonth()+1,d:d.getUTCDate()}}
  function formatDate(p){return`${String(p.d).padStart(2,'0')}.${String(p.mo).padStart(2,'0')}.${p.y}`}
  function inferTarget(draws){
    const last=draws.at(-1); if(!last)return{draw:null,date:'',time:'—'};
    const tm=String(last.time).match(/(\d{1,2}):(\d{2})/), p=dateParts(last.date); if(!tm||!p)return{draw:last.draw+1,date:'',time:'—'};
    const cur=+tm[1]*60 + +tm[2]; const mins=CURRENT_SCHEDULE.map(t=>{const[a,b]=t.split(':').map(Number);return a*60+b});
    let idx=mins.findIndex(x=>x>cur), dp=p; if(idx<0){idx=0;dp=addDays(p,1)}
    return{draw:last.draw+1,date:formatDate(dp),time:CURRENT_SCHEDULE[idx]};
  }

  const PAIRS=(()=>{const out=[];for(let a=0;a<80;a++)for(let b=a+1;b<80;b++)out.push([a,b]);return out})();
  const PAIR_INDEX=(()=>{const x=Array.from({length:80},()=>Array(80).fill(-1));PAIRS.forEach(([a,b],i)=>{x[a][b]=i;x[b][a]=i});return x})();

  function z01(values){
    const min=Math.min(...values), max=Math.max(...values); if(max===min)return values.map(()=>.5);
    return values.map(v=>(v-min)/(max-min));
  }

  function markerScores(base,currentBalls){
    const scale=Number(base?.scale)||100000, ids=currentBalls.map(n=>n-1), raw=Array(80).fill(0);
    if(!base?.singleDelta) return Array(80).fill(.5);
    for(let y=0;y<80;y++){
      const singles=ids.map(x=>(base.singleDelta?.[x]?.[y]||0)/scale).sort((a,b)=>b-a);
      let score=singles.slice(0,5).reduce((a,b)=>a+b,0)/5;
      if(base.pairDelta){
        const pv=[];
        for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++){
          const pi=PAIR_INDEX[ids[i]][ids[j]]; if(pi>=0)pv.push((base.pairDelta?.[pi]?.[y]||0)/scale);
        }
        pv.sort((a,b)=>b-a); score += 1.35*(pv.slice(0,8).reduce((a,b)=>a+b,0)/8);
      }
      raw[y]=score;
    }
    return z01(raw);
  }

  function transitionScores(draws,currentBalls){
    const current=new Set(currentBalls), hits=Array(81).fill(0), support=Array(81).fill(0), persist=Array(81).fill(0), persistN=Array(81).fill(0);
    for(let i=0;i<draws.length-1;i++){
      const prev=draws[i].balls,next=draws[i+1].balls, nextSet=new Set(next);
      let anchors=0; for(const n of prev)if(current.has(n))anchors++;
      if(anchors){ for(const n of next) hits[n]+=anchors; }
      for(const n of prev){persistN[n]++;if(nextSet.has(n))persist[n]++;}
    }
    const raw=[];
    for(let n=1;n<=80;n++){
      let v=hits[n];
      if(current.has(n))v*=1.15;
      v += (persistN[n]?persist[n]/persistN[n]:0)*Math.max(10,draws.length*.002);
      raw.push(v);
    }
    return z01(raw);
  }

  function groupCounts(balls){const c=Array(10).fill(0);for(const n of balls)c[(n-1)%10]++;return c}
  function groupScores(draws,currentBalls){
    const curCounts=groupCounts(currentBalls), curGroups=curCounts.map(groupOf), numHits=Array(81).fill(0), colSupport=Array(10).fill(0);
    for(let i=0;i<draws.length-1;i++){
      const pc=groupCounts(draws[i].balls), pg=pc.map(groupOf), next=draws[i+1].balls;
      const matching=Array(10).fill(false); for(let c=0;c<10;c++){if(pg[c]===curGroups[c]){matching[c]=true;colSupport[c]++;}}
      for(const n of next){const c=(n-1)%10;if(matching[c])numHits[n]++;}
    }
    const raw=[];for(let n=1;n<=80;n++){const c=(n-1)%10;raw.push(numHits[n]/Math.max(1,colSupport[c]));}
    return z01(raw);
  }

  function patternScores(draws,currentBalls){
    const N=draws.length, raw=Array(80).fill(0), current=new Set(currentBalls);
    const windows=[10,20,66,250];
    const sets=draws.map(d=>new Set(d.balls));
    for(let n=1;n<=80;n++){
      let s=0;
      windows.forEach((w,idx)=>{let c=0;for(let i=Math.max(0,N-w);i<N;i++)if(sets[i].has(n))c++; const expected=w*.25; s += (c-expected)/Math.sqrt(Math.max(1,expected)) * [1.6,1.25,.85,.45][idx];});
      let age=N;for(let i=N-1;i>=0;i--){if(sets[i].has(n)){age=N-1-i;break;}}
      if(age===1||age===2)s+=.7; if(age>=3&&age<=6)s+=.35; if(age>12)s-=.25;
      if(current.has(n))s+=.45;
      // чередование A-x-A / A-x-x-A
      if(N>2 && sets[N-2].has(n) && !sets[N-1].has(n))s+=.55;
      if(N>3 && sets[N-3].has(n) && !sets[N-2].has(n) && !sets[N-1].has(n))s+=.35;
      // позиционный след: то же число в соседних позициях прошлых тиражей
      const pos=currentBalls.indexOf(n); if(pos>=0){
        let ph=0,pn=0;for(let i=Math.max(0,N-400);i<N-1;i++){const p=draws[i].balls.indexOf(n);if(p>=0){pn++;const nxt=draws[i+1].balls;for(let q=Math.max(0,p-1);q<=Math.min(19,p+1);q++)if(nxt[q]===n)ph++;}}
        if(pn)s+=.4*(ph/pn);
      }
      raw[n-1]=s;
    }
    return z01(raw);
  }

  async function buildClusters(draws){
    const current=draws.at(-1)?.balls||[]; let marker=Array(80).fill(.5);
    try{marker=markerScores(await fetchMarkerBase(),current)}catch(e){console.warn('Combo marker fallback',e)}
    return {marker,transition:transitionScores(draws,current),group:groupScores(draws,current),pattern:patternScores(draws,current)};
  }

  function combinedRanking(clusters,weights,size){
    const rows=[];
    for(let n=1;n<=80;n++){
      const comp={marker:clusters.marker[n-1],transition:clusters.transition[n-1],group:clusters.group[n-1],pattern:clusters.pattern[n-1]};
      let score=Object.keys(comp).reduce((s,k)=>s+comp[k]*weights[k],0);
      // разные K имеют собственную геометрию, а не являются срезом общего TOP.
      if(size===3) score += .035*Math.min(comp.marker,comp.transition);
      if(size===4) score += .04*Math.min(comp.transition,comp.group);
      if(size===5) score += .04*Math.min(comp.marker,comp.group,comp.pattern);
      if(size===6) score += .035*(comp.transition*comp.pattern);
      if(size===7) score += .03*(1-Math.abs(comp.marker-comp.group));
      rows.push({n,score,comp,col:colOf(n)});
    }
    return rows.sort((a,b)=>b.score-a.score||a.n-b.n);
  }

  function chooseIndependent(ranking,size,priorCombos){
    const chosen=[], colCount=Array(11).fill(0);
    for(const row of ranking){
      let penalty=colCount[row.col]*.055;
      const neighbor=chosen.some(x=>Math.abs(x.n-row.n)<=1); if(neighbor)penalty+=.018;
      const adjusted=row.score-penalty;
      const candidate={...row,adjusted};
      if(chosen.length<size){chosen.push(candidate);colCount[row.col]++;chosen.sort((a,b)=>b.adjusted-a.adjusted);}
      else if(adjusted>chosen.at(-1).adjusted){const old=chosen.pop();colCount[old.col]--;chosen.push(candidate);colCount[row.col]++;chosen.sort((a,b)=>b.adjusted-a.adjusted);}
    }
    let out=chosen.slice(0,size);
    // Запрет "вырастания": ни одна меньшая K не должна быть полным подмножеством большей.
    for(const prev of priorCombos){
      const set=new Set(out.map(x=>x.n));
      if(prev.numbers.every(n=>set.has(n))){
        const replaceIndex=out.map((x,i)=>({i,x})).filter(z=>prev.numbers.includes(z.x.n)).sort((a,b)=>a.x.adjusted-b.x.adjusted)[0]?.i;
        const alt=ranking.find(r=>!set.has(r.n)&&!prev.numbers.includes(r.n));
        if(replaceIndex!=null&&alt)out[replaceIndex]={...alt,adjusted:alt.score};
      }
    }
    return out.sort((a,b)=>a.n-b.n);
  }

  function makeForecast(draws,clusters,model){
    const target=inferTarget(draws), prior=[]; const combos={};
    for(const size of [3,4,5,6,7]){
      const weights=normalizeWeights({...model.weights[size]});
      const ranking=combinedRanking(clusters,weights,size);
      const picks=chooseIndependent(ranking,size,prior);
      combos['K'+size]={size,numbers:picks.map(x=>x.n),score:Number((picks.reduce((s,x)=>s+x.score,0)/size).toFixed(5)),weights,components:Object.fromEntries(picks.map(x=>[x.n,x.comp]))};
      prior.push(combos['K'+size]);
    }
    return {id:`${draws.at(-1).draw}->${target.draw}`,version:ENGINE_VERSION,createdAt:new Date().toISOString(),baseDraw:draws.at(-1).draw,target,status:'open',combos,training:{archiveDraws:draws.length,experience:model.experience}};
  }

  function closeForecasts(draws,archive,model){
    const byDraw=new Map(draws.map(d=>[d.draw,d])); let changed=false;
    for(const rec of archive){
      if(rec.status!=='open')continue; const actual=byDraw.get(Number(rec.target?.draw)); if(!actual)continue;
      const actualSet=new Set(actual.balls); rec.status='closed'; rec.closedAt=new Date().toISOString();rec.actual={draw:actual.draw,date:actual.date,time:actual.time,balls:actual.balls,column:actual.column};
      for(const size of [3,4,5,6,7]){
        const c=rec.combos?.['K'+size]; if(!c)continue; const hitNumbers=c.numbers.filter(n=>actualSet.has(n)); c.hits=hitNumbers.length;c.hitNumbers=hitNumbers;c.prize=prize(size,c.hits);
        // Самообучение: награждаем кластеры, которые были сильнее именно у попавших чисел.
        const keys=['marker','transition','group','pattern'];
        for(const key of keys){
          const vals=c.numbers.map(n=>Number(c.components?.[n]?.[key]||0));
          const hitVals=hitNumbers.map(n=>Number(c.components?.[n]?.[key]||0));
          const allAvg=vals.reduce((a,b)=>a+b,0)/Math.max(1,vals.length);
          const hitAvg=hitVals.length?hitVals.reduce((a,b)=>a+b,0)/hitVals.length:0;
          const reward=hitNumbers.length ? (hitAvg-allAvg) : -(allAvg-.5)*.35;
          model.weights[size][key]=clamp(Number(model.weights[size][key]||.25)+reward*.045,.08,.60);
          model.clusterRecord[key]=(model.clusterRecord[key]||0)+reward;
        }
        normalizeWeights(model.weights[size]);
      }
      model.experience++; changed=true;
    }
    if(changed){saveArchive(archive);saveModel(model)}
    return changed;
  }

  function ensureForecast(draws,archive,model,clusters){
    const base=draws.at(-1)?.draw; if(!base)return null;
    let open=archive.find(r=>r.status==='open'&&Number(r.baseDraw)===base);
    if(!open){open=makeForecast(draws,clusters,model);archive.push(open);saveArchive(archive)}
    return open;
  }

  function overlapInfo(combos){
    const ks=[3,4,5,6,7], out=[];
    for(let i=0;i<ks.length-1;i++){const a=combos['K'+ks[i]].numbers,b=new Set(combos['K'+ks[i+1]].numbers);out.push(`K${ks[i]}∩K${ks[i+1]}=${a.filter(n=>b.has(n)).length}`)}
    return out.join(' · ');
  }

  function render(open,archive,model,draws){
    if(!$('comboView'))return;
    const latest=draws.at(-1);
    $('comboEngineStatus').textContent=`ОБУЧЕН · ${draws.length.toLocaleString('ru-RU')} ТИРАЖЕЙ`;
    $('comboEngineMeta').textContent=`Движок ${ENGINE_VERSION} · опыт закрытых прогнозов: ${model.experience} · последний архив №${latest?.draw||'—'}`;
    if(open){
      $('comboTarget').textContent=`НА №${open.target.draw} · ${open.target.date} · ${open.target.time}`;
      $('comboCards').innerHTML=[3,4,5,6,7].map(size=>{
        const c=open.combos['K'+size],w=c.weights;
        return `<div class="combo-kcard"><div class="combo-khead"><b>K${size}</b><span>${c.numbers.map(fmt).join(' · ')}</span></div><div class="combo-w">ИИ ${(w.marker*100).toFixed(0)}% · переходы ${(w.transition*100).toFixed(0)}% · группы ${(w.group*100).toFixed(0)}% · ритм ${(w.pattern*100).toFixed(0)}%</div></div>`;
      }).join('');
      $('comboOverlap').textContent=`Независимость: ${overlapInfo(open.combos)}. K-комбы рассчитаны отдельно; подмножественное «вырастание» запрещено.`;
    }
    const closed=archive.filter(r=>r.status==='closed').slice(-40).reverse();
    $('comboArchive').innerHTML=closed.length?closed.map(r=>{
      const rows=[3,4,5,6,7].map(size=>{const c=r.combos?.['K'+size];if(!c)return'';return`<div class="combo-hrow"><b>K${size}</b><span>${c.numbers.map(fmt).join('·')}</span><strong>${c.hits}/${size}</strong><em>${c.prize?`🔥 ${rub(c.prize)}`:'—'}</em></div>`}).join('');
      const total=[3,4,5,6,7].reduce((s,z)=>s+Number(r.combos?.['K'+z]?.prize||0),0);
      return `<details class="combo-hist"><summary><span>№${r.target.draw} · ${r.target.date} ${r.target.time}</span><b>${total?`🔥 ${rub(total)}`:'без выигрыша'}</b></summary><div class="combo-hbody">${rows}</div></details>`;
    }).join(''):'<div class="combo-empty">Архив начнёт заполняться после первого завершённого frozen-прогноза.</div>';
  }

  function injectUi(){
    if($('comboViewBtn'))return;
    const style=document.createElement('style'); style.textContent=`
      .combo-launch-row{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:-4px 0 10px}.combo-launch{grid-column:1;border:1px solid #9a7930;background:linear-gradient(135deg,#514014,#2d2a16);color:#ffe27b;border-radius:10px;padding:10px 8px;font-weight:1000}.combo-launch.active{background:#765b16;color:#fff;border-color:#ffd34f}
      .combo-card{margin-top:0}.combo-head{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}.combo-head b{font-size:20px}.combo-status{font-size:11px;color:#6ee7a0;font-weight:1000;text-align:right}.combo-sub{color:#9babc0;font-size:11px;line-height:1.4;margin-top:3px}.combo-target{margin:10px 0;border:1px solid #8c7231;border-radius:13px;background:#2b250f;color:#ffe27b;padding:10px;text-align:center;font-weight:1000}.combo-cards{display:grid;gap:8px}.combo-kcard{border:1px solid #36526d;border-radius:12px;background:#0d1d2e;padding:10px}.combo-khead{display:grid;grid-template-columns:46px 1fr;gap:7px;align-items:center}.combo-khead b{font-size:24px;color:#ffd34f}.combo-khead span{font-family:ui-monospace,Consolas,monospace;font-size:16px;font-weight:1000;line-height:1.5}.combo-w{font-size:10px;color:#8fa4ba;margin-top:5px}.combo-overlap{margin-top:8px;color:#9fb0c3;font-size:10px;line-height:1.45}.combo-refresh{width:100%;margin-top:10px;border:1px solid #4f8194;background:#12485a;color:#fff;border-radius:11px;padding:11px;font-weight:1000}.combo-archive-title{font-size:19px;font-weight:1000;margin:16px 0 8px}.combo-hist{border:1px solid #294862;border-radius:12px;background:#0b1726;margin-top:7px;overflow:hidden}.combo-hist summary{display:flex;justify-content:space-between;gap:8px;padding:10px;cursor:pointer;font-size:12px}.combo-hist summary b{color:#ffd34f}.combo-hbody{border-top:1px solid #294862;padding:8px}.combo-hrow{display:grid;grid-template-columns:36px 1fr 42px 90px;gap:6px;align-items:center;padding:6px 0;border-bottom:1px solid #1d3448;font-size:11px}.combo-hrow:last-child{border-bottom:0}.combo-hrow b{color:#ffd34f}.combo-hrow span{font-family:ui-monospace,Consolas,monospace}.combo-hrow strong{text-align:center}.combo-hrow em{font-style:normal;text-align:right;color:#ffe27b}.combo-empty{border:1px dashed #36526d;border-radius:10px;padding:12px;color:#9babc0;text-align:center;font-size:11px}
      @media(max-width:520px){.combo-launch-row{grid-template-columns:repeat(3,1fr)}.combo-khead span{font-size:14px}.combo-hrow{grid-template-columns:34px 1fr 38px 82px}}
    `; document.head.appendChild(style);
    const tabs=document.querySelector('.viewtabs'); if(tabs){const row=document.createElement('div');row.className='combo-launch-row';row.innerHTML='<button id="comboViewBtn" class="combo-launch" type="button">Комбы</button>';tabs.insertAdjacentElement('afterend',row)}
    const host=$('yuliaView')?.parentElement||document.querySelector('.app'); if(host){const section=document.createElement('section');section.id='comboView';section.className='viewpage';section.innerHTML=`<div class="card combo-card"><div class="combo-head"><div><b>🧩 Комбы K3–K7</b><div class="combo-sub">Самообучение по архиву: ИИ-маркеры · переходы тираж→тираж · группы 0/1/2/3/4+ · повторы/чередования/ритм</div></div><div id="comboEngineStatus" class="combo-status">ЗАГРУЗКА…</div></div><div id="comboTarget" class="combo-target">ПРОГНОЗ ГОТОВИТСЯ</div><div id="comboCards" class="combo-cards"></div><div id="comboOverlap" class="combo-overlap"></div><div id="comboEngineMeta" class="combo-overlap"></div><button id="comboRefreshBtn" class="combo-refresh" type="button">↻ ПЕРЕОБУЧИТЬ ПО СВЕЖЕМУ АРХИВУ</button><div class="combo-archive-title">🗂 Архив комб и выигрышей</div><div id="comboArchive"></div></div>`;host.insertBefore(section,$('settingsPanel')||null)}
    $('comboViewBtn')?.addEventListener('click',()=>{['matrixView','yuliaView','aiView'].forEach(id=>$(id)?.classList.remove('active'));$('comboView')?.classList.add('active');document.querySelectorAll('.viewtab').forEach(b=>b.classList.remove('active'));$('comboViewBtn')?.classList.add('active');refreshAll(true)});
    ['matrixViewBtn','yuliaViewBtn','aiViewBtn'].forEach(id=>$(id)?.addEventListener('click',()=>{$('comboView')?.classList.remove('active');$('comboViewBtn')?.classList.remove('active')}));
    $('comboRefreshBtn')?.addEventListener('click',()=>refreshAll(true));
  }

  async function refreshAll(force=false){
    if(refreshBusy)return; refreshBusy=true;
    try{
      if($('comboEngineStatus'))$('comboEngineStatus').textContent='АНАЛИЗИРУЮ АРХИВ…';
      const draws=await fetchHistory(); lastDraws=draws;
      const archive=loadArchive(), model=loadModel(); closeForecasts(draws,archive,model);
      const latest=draws.at(-1)?.draw, existing=archive.find(r=>r.status==='open'&&Number(r.baseDraw)===latest);
      let open=existing;
      if(!existing||force){
        const clusters=await buildClusters(draws);
        if(existing&&force){
          // frozen нельзя переписывать вручную: на том же baseDraw показываем уже сохранённый прогноз.
          open=existing;
        } else open=ensureForecast(draws,archive,model,clusters);
      }
      render(open,archive,model,draws); localStorage.setItem(LAST_SYNC_KEY,String(Date.now()));
    }catch(e){console.error(e);if($('comboEngineStatus'))$('comboEngineStatus').textContent='ОШИБКА АРХИВА';if($('comboEngineMeta'))$('comboEngineMeta').textContent=String(e?.message||e)}
    finally{refreshBusy=false}
  }

  function boot(){injectUi();refreshAll(false);setInterval(()=>refreshAll(false),REFRESH_MS);}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
