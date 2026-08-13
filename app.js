'use strict';
const LIVE_URL='./top3-live.json';
const LAB_KEY='pozitron.labMatrix.predictions.v1';
const ALGORITHM='LAB v1 · CENTER 8 · pressureTorque 369 · position ON/OFF';
const state={draws:[],days:14,rowLimit:50,mode:'ALL',activeDigits:new Set(),tab:'matrix',updatedAt:null,source:'встроенный архив',predictions:[],archiveFilter:'all',repeatMode:'none',repeatCount:3,forecastKey:null};
const $=s=>document.querySelector(s); const $$=s=>[...document.querySelectorAll(s)];
const WEEK=['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];
const BETS={
  exact3:{label:'Точно 3'},exact3Any3:{label:'Точно 3 + Любые 3'},any2:{label:'Любые 2'},combo6:{label:'Комбо 6'},any3:{label:'Любые 3'},exact1:{label:'Точно 1'},first2:{label:'Первые 2 числа'},last2:{label:'Последние 2 числа'},skip:{label:'ПРОПУСК'}
};

function parseDate(s){const [d,m,y]=String(s).split('.').map(Number);return new Date(Date.UTC(y<100?2000+y:y,m-1,d));}
function formatDate(dt){return [String(dt.getUTCDate()).padStart(2,'0'),String(dt.getUTCMonth()+1).padStart(2,'0'),String(dt.getUTCFullYear()).slice(-2)].join('.');}
function addDays(s,n){const d=parseDate(s);d.setUTCDate(d.getUTCDate()+n);return formatDate(d);}
function weekday(s){return WEEK[parseDate(s).getUTCDay()]}
function normalizeRow(r){if(Array.isArray(r))return {id:+r[0],date:String(r[1]),time:String(r[2]),a:+r[3],b:+r[4],c:+r[5]};return {id:+r.id,date:String(r.date),time:String(r.time),a:+r.a,b:+r.b,c:+r.c}}
function valid(d){return Number.isFinite(d.id)&&/^\d{2}\.\d{2}\.\d{2}$/.test(d.date)&&/^\d{2}:\d{2}$/.test(d.time)&&[d.a,d.b,d.c].every(x=>Number.isInteger(x)&&x>=0&&x<=9)}
function unique(list){const m=new Map();for(const x of list){const d=normalizeRow(x);if(valid(d)&&!m.has(d.id))m.set(d.id,d)}return [...m.values()].sort((a,b)=>b.id-a.id)}
function readPredictions(){try{const x=JSON.parse(localStorage.getItem(LAB_KEY)||'[]');return Array.isArray(x)?x:[]}catch(e){return[]}}
function writePredictions(){localStorage.setItem(LAB_KEY,JSON.stringify(state.predictions))}
function combo(d){return[d.a,d.b,d.c]}
function comboText(a){return a.join(' – ')}
function drawWord(n){const x=Math.abs(n)%100,y=x%10;return x>10&&x<20?'тиражей':y===1?'тираж':y>=2&&y<=4?'тиража':'тиражей'}
function sameMultiset(a,b){return [...a].sort().join('')===[...b].sort().join('')}
function rub(n){return `${Math.round(n).toLocaleString('ru-RU')} ₽`}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}

async function load(){
  const seed=Array.isArray(window.TOP3_SEED)?window.TOP3_SEED:[];let live=[];
  try{const r=await fetch(`${LIVE_URL}?t=${Date.now()}`,{cache:'no-store'});if(r.ok){const j=await r.json();live=j.draws||[];state.updatedAt=j.updatedAt||null;state.source=j.source||'live';}}catch(e){}
  state.draws=unique([...live,...seed]);state.predictions=readPredictions();applyFacts(false);
  $('#totalCount').textContent=state.draws.length.toLocaleString('ru-RU');updateStatus();renderAll();
}
function updateStatus(){let txt='Обновлено: архив';if(state.updatedAt){const d=new Date(state.updatedAt);txt=`Обновлено: ${d.toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}`;}$('#updatedText').textContent=txt;}
function filteredByDays(){if(!state.draws.length)return[];const latest=parseDate(state.draws[0].date);const min=new Date(latest);min.setUTCDate(min.getUTCDate()-(state.days-1));return state.draws.filter(d=>parseDate(d.date)>=min)}
function daysGrouped(){const list=filteredByDays();const map=new Map();for(const d of list){if(!map.has(d.date))map.set(d.date,[]);map.get(d.date).push(d)}return [...map.entries()].sort((a,b)=>parseDate(b[0])-parseDate(a[0])).slice(0,state.rowLimit)}
function timeList(groups){const set=new Set();groups.forEach(([,ds])=>ds.forEach(d=>set.add(d.time)));return [...set].sort((a,b)=>a.localeCompare(b))}
function scheduleTimes(){const counts=new Map();state.draws.forEach(d=>counts.set(d.time,(counts.get(d.time)||0)+1));return [...counts.entries()].filter(([,n])=>n>=2).map(([t])=>t).sort()}
function freqMap(groups,times){const f={};for(const time of times){f[time]={A:Array(10).fill(0),B:Array(10).fill(0),C:Array(10).fill(0),ALL:Array(10).fill(0)};}for(const [,ds]of groups){for(const d of ds){const vals=[d.a,d.b,d.c];['A','B','C'].forEach((p,i)=>{f[d.time][p][vals[i]]++;f[d.time].ALL[vals[i]]++;});}}return f}
function level(n,max){if(!max)return 0;const r=n/max;if(n===0)return 0;if(r<.35)return 1;if(r<.55)return 2;if(r<.75)return 3;if(r<.92)return 4;return 5}

function renderMatrix(){const groups=daysGrouped(),times=timeList(groups),freq=freqMap(groups,times);const cols=`126px repeat(${times.length},206px)`;let html=`<div class="matrix-grid" style="grid-template-columns:${cols}">`;
  html+=`<div class="mcell mhead date-head date-cell"><b>Дата</b><span>день</span></div>`;for(const t of times)html+=`<div class="mcell mhead time-head"><div class="time-title">${t}</div><div class="abc-head"><span>A</span><span>B</span><span>C</span></div></div>`;
  for(const [date,ds] of groups){html+=`<div class="mcell date-cell"><b>${date}</b><span>${weekday(date)}</span></div>`;const byTime=new Map(ds.map(d=>[d.time,d]));for(const t of times){const d=byTime.get(t);if(!d){html+=`<div class="mcell draw-cell"><div class="draw-id">—</div><div class="digits"><button class="matrix-digit freq-0" disabled>·</button><button class="matrix-digit freq-0" disabled>·</button><button class="matrix-digit freq-0" disabled>·</button></div></div>`;continue;} const vals=[d.a,d.b,d.c],ps=['A','B','C'];const max=Math.max(...freq[t][state.mode]);html+=`<div class="mcell draw-cell"><div class="draw-id">№${d.id}</div><div class="digits">`+vals.map((v,i)=>{const key=state.mode==='ALL'?'ALL':state.mode;const count=freq[t][key][v];const lv=level(count,max);const dim=state.mode!=='ALL'&&state.mode!==ps[i]?' dim':'';const sel=state.activeDigits.has(v)?' selected':'';return `<button class="matrix-digit freq-${lv}${dim}${sel}" data-digit="${v}" title="${ps[i]} · ${count} раз">${v}</button>`}).join('')+`</div></div>`;}}
  html+='</div>';$('#matrixTable').innerHTML=html;bindDigitClicks($('#matrixTable'));renderMatrixStatus(groups,times);renderBars(filteredByDays());
}
function renderMatrixStatus(groups,times){const latest=state.draws[0];$('#matrixStatus').innerHTML=`Режим: <b>${state.mode==='ALL'?'ВСЕ':state.mode}</b><br>Дней: <b>${groups.length}</b><br>Времён: <b>${times.length}</b><br>Последний: <b>${latest?`№${latest.id}`:'—'}</b><br>Источник: <b>${state.source}</b>`}
function renderBars(list){const c=Array(10).fill(0);list.forEach(d=>{c[d.a]++;c[d.b]++;c[d.c]++});const max=Math.max(...c,1);$('#frequencyBars').innerHTML=c.map((v,i)=>`<div class="bar-wrap"><span class="bar-value">${v}</span><div class="bar" style="height:${Math.max(4,v/max*120)}px"></div><span class="bar-label">${i}</span></div>`).join('')}
function renderActiveDigits(){for(const id of ['topDigitButtons','activeDigitButtons']){const el=$('#'+id);el.innerHTML=Array.from({length:10},(_,i)=>`<button class="digit-btn ${state.activeDigits.has(i)?'active':''}" data-digit="${i}">${i}</button>`).join('');bindDigitClicks(el)}$('#selectedCount').textContent=`Выбрано: ${state.activeDigits.size} / 10`}
function bindDigitClicks(root){root.querySelectorAll('[data-digit]').forEach(b=>b.onclick=()=>{const n=+b.dataset.digit;state.activeDigits.has(n)?state.activeDigits.delete(n):state.activeDigits.add(n);renderAll()})}
function renderHorizontal(){const list=filteredByDays().slice(0,state.rowLimit);$('#horizontalBody').innerHTML=list.map(d=>`<tr><td>№${d.id}</td><td>${d.date} <span class="weekday">${weekday(d.date)}</span></td><td>${d.time}</td><td><div class="combo-buttons">${combo(d).map(v=>`<button class="h-digit ${state.activeDigits.has(v)?'selected':''}" data-digit="${v}">${v}</button>`).join('')}</div></td></tr>`).join('');bindDigitClicks($('#horizontalBody'))}

function targetDraw(){const latest=state.draws[0],times=scheduleTimes();if(!latest||!times.length)return null;const after=times.find(t=>t>latest.time);return {id:latest.id+1,date:after?latest.date:addDays(latest.date,1),time:after||times[0]};}
function positionCounts(list,pos){const arr=Array(10).fill(0);list.forEach(d=>arr[pos]++);return arr}
function topTwo(score){const order=score.map((v,d)=>({d,v})).sort((a,b)=>b.v-a.v||a.d-b.d);return {digit:order[0].d,top:order[0].v,second:order[1].v,margin:order[0].v?((order[0].v-order[1].v)/order[0].v):0}}
function labForecast(){
  const target=targetDraw();if(!target)return null;
  const window=filteredByDays(),timeRows=window.filter(d=>d.time===target.time),dayRows=window.filter(d=>weekday(d.date)===weekday(target.date)),recent=state.draws.slice(0,40);
  const pressureByPos=[.55,.35,.75];
  const learned369={'04:40':[false,false,true],'09:40':[true,false,true],'13:40':[true,false,true],'16:25':[true,true,true],'21:25':[true,false,false]};
  const time369=learned369[target.time]||null;const cornerCount={3:0,6:0,9:0};timeRows.forEach(d=>combo(d).forEach(n=>{if(n===3||n===6||n===9)cornerCount[n]++}));const cornerMax=Math.max(1,...Object.values(cornerCount));
  const positions=[0,1,2].map(pos=>{
    const tc=positionCounts(timeRows,pos),dc=positionCounts(dayRows,pos),rc=positionCounts(recent,pos);
    const baseScore=Array(10).fill(0).map((_,d)=>tc[d]*3+dc[d]*1.6+rc[d]*.35+(d===8?1.25:0));
    const torqueScore=baseScore.map((v,d)=>v+([3,6,9].includes(d)?(.35+cornerCount[d]/cornerMax*pressureByPos[pos]):0));
    const baseBest=topTwo(baseScore),torqueBest=topTwo(torqueScore);const autoOn=[3,6,9].includes(torqueBest.digit)&&torqueBest.margin>=baseBest.margin;
    const factorOn=time369?time369[pos]:autoOn;const best=factorOn?torqueBest:baseBest;const score=factorOn?torqueScore:baseScore;
    return {...best,timeCount:tc[best.digit],dayCount:dc[best.digit],score,factorOn};
  });
  const picks=positions.map(p=>p.digit);const conf=positions.map(p=>p.margin);const firstStrength=Math.min(conf[0],conf[1]),lastStrength=Math.min(conf[1],conf[2]);let bet='skip',stakePositions=[];
  if(Math.min(...conf)>=.22&&timeRows.length>=5){bet='exact3';stakePositions=[0,1,2]}
  else if(Math.max(firstStrength,lastStrength)>=.13){if(lastStrength>firstStrength){bet='last2';stakePositions=[1,2]}else{bet='first2';stakePositions=[0,1]}}
  else{const best=conf.indexOf(Math.max(...conf));if(conf[best]>=.08){bet='exact1';stakePositions=[best]}}
  const verticalStrength=positions.reduce((s,p)=>s+p.timeCount,0)/Math.max(1,timeRows.length*3);const horizontalStrength=positions.reduce((s,p)=>s+p.dayCount,0)/Math.max(1,dayRows.length*3);
  let suggestedRepeat=verticalStrength>=horizontalStrength?'vertical':'horizontal';
  const selectedConfidence=stakePositions.length?stakePositions.reduce((s,i)=>s+conf[i],0)/stakePositions.length:conf.reduce((s,x)=>s+x,0)/3;
  const remainingToday=scheduleTimes().filter(t=>t>=target.time).length;
  const repeatPower=Math.min(1,horizontalStrength*4+selectedConfidence*2);
  const horizontalRepeatCount=bet==='skip'?1:Math.max(1,Math.min(6,remainingToday,Math.round(2+repeatPower*4)));
  if(suggestedRepeat==='horizontal'&&remainingToday<2)suggestedRepeat='vertical';
  const horizontalTimes=scheduleTimes().filter(t=>t>=target.time).slice(0,horizontalRepeatCount);
  const stakeDigits=stakePositions.map(i=>picks[i]);const cost=betCost(bet,picks);
  return {target,picks,bet,stakePositions,stakeDigits,cost,positions,verticalStrength,horizontalStrength,suggestedRepeat,horizontalRepeatCount,horizontalTimes,timeRows:timeRows.length,dayRows:dayRows.length,centerMode:'8 жёсткий центр',factor369:positions.map(p=>p.factorOn?'ON':'OFF'),verticalSignal:`${Math.round(verticalStrength*100)}%`,horizontalSignal:`${Math.round(horizontalStrength*100)}%`,mirrorRotation:true,repeatState:false,algorithm:ALGORITHM};
}
function betCost(code,picks){if(code==='skip')return 0;if(code==='combo6')return new Set(picks).size===3?540:270;return 90}
function betLabel(code){return BETS[code]?.label||code}
function defaultRepeat(f){return f.suggestedRepeat}
function repeatAdviceText(f){if(f.bet==='skip')return'НЕ ТИРАЖИРОВАТЬ';if(f.suggestedRepeat==='vertical')return`↑ ПО ВЕРТИКАЛИ · 1 ПОВТОР · ${addDays(f.target.date,1)} В ${f.target.time}`;return`→ ПО ГОРИЗОНТАЛИ · ${f.horizontalRepeatCount} ${drawWord(f.horizontalRepeatCount).toUpperCase()} · ${f.horizontalTimes.join(', ')}`}
function renderLab(){
  const f=labForecast();if(!f){$('#labForecast').innerHTML='<div class="archive-empty">Недостаточно данных для расчёта следующего тиража.</div>';return}
  const key=`${f.target.date}|${f.target.time}|${f.picks.join('')}`;if(state.forecastKey!==key){state.forecastKey=key;state.repeatMode=defaultRepeat(f);state.repeatCount=f.horizontalRepeatCount}
  const adviceClass=f.bet==='skip'?'skip-type':'';const stake=f.bet==='skip'?'ставки нет':comboText(f.stakeDigits);
  const repeatAdvice=repeatAdviceText(f);
  $('#labForecast').innerHTML=`<div class="forecast-panel"><div class="forecast-main"><div class="forecast-target"><span>Целевой тираж: <b>№${f.target.id}</b></span><span><b>${f.target.date} · ${f.target.time}</b></span></div><div class="forecast-label">ПРОГНОЗ</div><div class="forecast-digits">${f.picks.map(n=>`<span class="forecast-digit">${n}</span>`).join('')}</div></div><div class="forecast-advice"><div class="forecast-label">ПРОГНОЗ ИИ</div><div class="advice-type ${adviceClass}">${betLabel(f.bet)}</div><div class="forecast-label">СТАВКА</div><div class="stake-line">${stake}</div><div class="stake-cost">Стоимость: ${rub(f.cost)}</div><div class="ai-repeat">Совет по тиражированию: <b>${repeatAdvice}</b></div></div></div>`;
  $('#labSignals').innerHTML=`<div class="signal-row"><span>Вертикаль ${f.target.time}</span><b>${f.verticalSignal}</b></div><div class="signal-row"><span>Горизонталь ${weekday(f.target.date)}</span><b>${f.horizontalSignal}</b></div><div class="signal-row"><span>Центр</span><b>${f.centerMode}</b></div><div class="signal-row"><span>369 по позициям</span><b>${f.factor369.join(' / ')}</b></div><div class="signal-row"><span>Поворот / зеркало</span><b>учтены</b></div><div class="signal-row"><span>Алгоритм</span><b>LAB v1</b></div>`;
  renderRepeatControls(f);renderStats();renderArchive();
}
function horizontalTargets(target,count){const times=scheduleTimes().filter(t=>t>=target.time);return times.slice(0,count).map((time,i)=>({id:target.id+i,date:target.date,time}));}
function targetsForRepeat(f){if(state.repeatMode==='vertical')return [f.target,{id:null,date:addDays(f.target.date,1),time:f.target.time}];if(state.repeatMode==='horizontal')return horizontalTargets(f.target,state.repeatCount);return[f.target]}
function renderRepeatControls(f){
  $$('#repeatMode button').forEach(b=>b.classList.toggle('active',b.dataset.repeat===state.repeatMode));
  $('#repeatCount').value=String(state.repeatCount);
  $('#repeatCountWrap').classList.toggle('hidden',state.repeatMode!=='horizontal');
  const available=scheduleTimes().filter(t=>t>=f.target.time).length;let hint='Прогноз будет сохранён только на один целевой тираж.';
  if(state.repeatMode==='vertical')hint=`↑ Эта же ставка заранее фиксируется ещё на <b>${addDays(f.target.date,1)} в ${f.target.time}</b>.`;
  if(state.repeatMode==='horizontal'){const count=Math.min(state.repeatCount,available),times=scheduleTimes().filter(t=>t>=f.target.time).slice(0,count);hint=`→ Ставка фиксируется на <b>${count} ${drawWord(count)}</b> текущего дня, включая целевой: <b>${times.join(', ')}</b>. Совет ИИ: <b>${f.horizontalRepeatCount} ${drawWord(f.horizontalRepeatCount)}</b>.`}
  $('#repeatHint').innerHTML=hint;
  const duplicate=state.predictions.some(p=>p.targetDate===f.target.date&&p.targetTime===f.target.time&&p.origin!==false);
  $('#saveForecastBtn').disabled=duplicate;$('#saveForecastBtn').textContent=duplicate?'🔒 ПРОГНОЗ НА ЭТОТ ТИРАЖ УЖЕ СОХРАНЁН':'🔒 СОХРАНИТЬ ПРОГНОЗ ДО ТИРАЖА';
}

function saveForecast(){
  const f=labForecast();if(!f)return;const targets=targetsForRepeat(f);if(!targets.length)return;
  if(state.predictions.some(p=>p.targetDate===f.target.date&&p.targetTime===f.target.time&&p.origin!==false)){toast('Прогноз на этот тираж уже зафиксирован.');return}
  const now=new Date().toISOString(),originId=`lab-${Date.now()}`;const total=targets.length;
  const newRecords=targets.map((t,i)=>({
    id:`${originId}-${i+1}`,originId,origin:i===0,isRepeat:i>0,repeatMode:state.repeatMode,repeatIndex:i+1,repeatTotal:total,
    targetDrawId:t.id,targetDate:t.date,targetTime:t.time,createdAt:now,locked:true,
    forecast:[...f.picks],bet:f.bet,betLabel:betLabel(f.bet),stakePositions:[...f.stakePositions],stakeDigits:[...f.stakeDigits],stakeCost:f.cost,
    matrixState:{center:f.centerMode,factor369:[...f.factor369],verticalSignal:f.verticalSignal,horizontalSignal:f.horizontalSignal,mirrorRotation:f.mirrorRotation,repeatState:f.repeatState,algorithm:f.algorithm},
    fact:null,resultStatus:f.bet==='skip'?'skip':'pending',matchedPositions:[],recommendationWon:null,winAmount:0
  }));
  state.predictions=[...newRecords,...state.predictions];writePredictions();renderLab();toast(`Сохранено записей: ${newRecords.length}. Прогнозы заблокированы.`)
}
function evaluateRecord(p,fact){
  const forecast=p.forecast,code=p.bet;const positions=forecast.map((n,i)=>n===fact[i]);const matched=positions.map((ok,i)=>ok?['A','B','C'][i]:null).filter(Boolean);let won=false,amount=0;
  if(code==='exact3')won=positions.every(Boolean);
  else if(code==='first2')won=positions[0]&&positions[1];
  else if(code==='last2')won=positions[1]&&positions[2];
  else if(code==='exact1')won=p.stakePositions.every(i=>forecast[i]===fact[i]);
  else if(code==='any2'){const wanted=[...p.stakeDigits];const pool=[...fact];won=wanted.every(n=>{const i=pool.indexOf(n);if(i<0)return false;pool.splice(i,1);return true})}
  else if(code==='any3'||code==='combo6'||code==='exact3Any3')won=sameMultiset(forecast,fact);
  if(won){
    if(code==='exact3'||code==='combo6')amount=45000;
    else if(code==='first2'||code==='last2')amount=5400;
    else if(code==='exact1')amount=450;
    else if(code==='any2')amount=2700;
    else if(code==='any3')amount=new Set(forecast).size===3?9000:18000;
    else if(code==='exact3Any3')amount=positions.every(Boolean)?27000:(new Set(forecast).size===3?4500:9000);
  }
  return {fact:[...fact],matchedPositions:matched,recommendationWon:won,winAmount:amount,resultStatus:code==='skip'?'skip':(won?'win':'loss')};
}
function applyFacts(showToast=true){
  const byTarget=new Map(state.draws.map(d=>[`${d.date}|${d.time}`,d]));let changed=0;
  state.predictions=state.predictions.map(p=>{if(p.fact)return p;const d=byTarget.get(`${p.targetDate}|${p.targetTime}`);if(!d)return p;changed++;return {...p,targetDrawId:d.id,...evaluateRecord(p,combo(d))}});
  if(changed){writePredictions()}if(showToast)toast(changed?`Добавлено фактических результатов: ${changed}.`:'Новых фактических результатов пока нет.');renderStats();renderArchive();
}
function statusText(p){if(p.resultStatus==='win')return `<div class="result-win">🔥 ${esc(p.betLabel)} — СЫГРАЛО</div><div class="win-amount">+ ${rub(p.winAmount)}</div>`;if(p.resultStatus==='loss')return `<div class="result-loss">❌ ${esc(p.betLabel)} — НЕ СЫГРАЛО</div>`;if(p.resultStatus==='skip')return `<div class="result-skip">ПРОПУСК · проигрыш не считается</div>`;return `<div class="result-pending">ОЖИДАЕТ ТИРАЖА</div>`}
function directionText(p){if(p.repeatMode==='vertical')return `↑ По вертикали · ${p.isRepeat?'повтор':'исходный прогноз'}`;if(p.repeatMode==='horizontal')return `→ По горизонтали · ${p.repeatIndex}/${p.repeatTotal}`;return 'Один прогноз'}
function predictionCard(p){
  const cls=p.resultStatus;const fact=p.fact||[];const digitHtml=p.forecast.map((n,i)=>`<span class="pred-digit ${p.fact?(n===p.fact[i]?'hit':'miss'):''}">${n}</span>`).join('');
  const factHtml=p.fact?fact.map(n=>`<span class="fact-digit">${n}</span>`).join(''):'<span class="result-pending">—</span>';const matches=p.fact?(p.matchedPositions.length?p.matchedPositions.join(' + '):'нет'):'—';
  return `<article class="prediction-card ${cls}"><div class="pred-head"><div><div class="pred-title">${p.targetTime} · ${p.targetDate}${p.targetDrawId?` · №${p.targetDrawId}`:''}</div><div class="pred-mode">${directionText(p)}</div></div><div class="pred-lock">🔒 зафиксирован ${new Date(p.createdAt).toLocaleString('ru-RU')}</div></div><div class="pred-grid"><div class="pred-col"><label>ПРОГНОЗ</label><div class="pred-combo">${digitHtml}</div></div><div class="pred-col"><label>ФАКТ</label><div class="pred-combo">${factHtml}</div></div><div class="pred-col"><label>ПРОВЕРКА РЕКОМЕНДАЦИИ</label>${statusText(p)}</div></div><div class="pred-details">ПРОГНОЗ ИИ: <b>${esc(p.betLabel)}</b> · СТАВКА: <b>${p.bet==='skip'?'нет':comboText(p.stakeDigits)}</b> · Стоимость: <b>${rub(p.stakeCost)}</b><br>Совпало: <b>${matches}</b> · Центр: ${esc(p.matrixState.center)} · 369: ${p.matrixState.factor369.join('/')}<br>${esc(p.matrixState.algorithm)}</div></article>`
}
function renderArchive(){
  if(!$('#labArchive'))return;let list=[...state.predictions].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)||b.repeatIndex-a.repeatIndex);
  if(state.archiveFilter!=='all')list=list.filter(p=>p.resultStatus===state.archiveFilter);
  $('#labArchive').innerHTML=list.length?list.map(predictionCard).join(''):'<div class="archive-empty">В этом фильтре записей пока нет.</div>';
  $$('#archiveFilters button').forEach(b=>b.classList.toggle('active',b.dataset.filter===state.archiveFilter));
}
function renderStats(){
  if(!$('#labStats'))return;const all=state.predictions,recs=all.filter(p=>p.bet!=='skip'),settled=recs.filter(p=>['win','loss'].includes(p.resultStatus)),wins=settled.filter(p=>p.resultStatus==='win'),skips=all.filter(p=>p.bet==='skip'),stake=settled.reduce((s,p)=>s+p.stakeCost,0),prize=settled.reduce((s,p)=>s+p.winAmount,0),net=prize-stake,rate=settled.length?wins.length/settled.length*100:0;
  const tiles=[['Сохранено',all.length,''],['Рекомендаций',recs.length,''],['Пропусков',skips.length,''],['Выигрышей',wins.length,'good'],['Попадание',`${rate.toFixed(1)}%`,rate>=50?'good':''],['Сумма ставок',rub(stake),''],['Выигрыши',rub(prize),'good'],['Чистый итог',`${net>=0?'+ ':''}${rub(net)}`,net>=0?'good':'bad']];
  $('#labStats').innerHTML=tiles.map(([l,v,c])=>`<div class="stat-tile ${c}"><span>${l}</span><b>${v}</b></div>`).join('');
}
function switchTab(tab){state.tab=tab;$$('.tab,.foot').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));$$('.view').forEach(v=>v.classList.remove('active'));$('#'+tab+'View').classList.add('active');renderAll()}
function renderAll(){renderActiveDigits();renderMatrix();renderHorizontal();renderLab()}
function toast(message){const old=$('.toast');if(old)old.remove();const el=document.createElement('div');el.className='toast';el.textContent=message;document.body.appendChild(el);setTimeout(()=>el.remove(),3200)}
function bind(){
  $$('.tab,.foot').forEach(b=>b.onclick=()=>switchTab(b.dataset.tab));
  $('#dayButtons').querySelectorAll('button').forEach(b=>b.onclick=()=>{state.days=+b.dataset.days;$('#dayButtons').querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b));renderAll()});
  $('#rowLimit').onchange=e=>{state.rowLimit=+e.target.value;renderAll()};
  $('#positionMode').querySelectorAll('button').forEach(b=>b.onclick=()=>{state.mode=b.dataset.mode;$('#positionMode').querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b));renderAll()});
  $('#resetBtn').onclick=()=>{state.activeDigits.clear();renderAll()};$('#refreshBtn').onclick=()=>location.reload();
  $('#repeatMode').querySelectorAll('button').forEach(b=>b.onclick=()=>{state.repeatMode=b.dataset.repeat;renderLab()});
  $('#repeatCount').onchange=e=>{state.repeatCount=+e.target.value;renderLab()};
  $('#saveForecastBtn').onclick=saveForecast;$('#checkResultsBtn').onclick=()=>applyFacts(true);
  $('#archiveFilters').querySelectorAll('button').forEach(b=>b.onclick=()=>{state.archiveFilter=b.dataset.filter;renderArchive()});
}
window.addEventListener('load',async()=>{bind();await load();setTimeout(()=>{$('#splash').classList.add('hidden');$('#app').classList.remove('hidden')},650);if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{})});
