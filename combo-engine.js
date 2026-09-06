'use strict';
(() => {
  const ENGINE='COMBO-AI-2.0.1';
  const ARCHIVE_URL='https://raw.githubusercontent.com/arsazet17/pozitron-column-matrix-v1/main/combo-forecast-archive.json';
  const MODEL_URL='https://raw.githubusercontent.com/arsazet17/pozitron-column-matrix-v1/main/combo-model-state.json';
  const REFRESH_MS=60000;
  const CACHE_ARCHIVE_KEY='pozitron_combo_server_archive_cache_v201';
  const CACHE_MODEL_KEY='pozitron_combo_server_model_cache_v201';
  const $=id=>document.getElementById(id);
  const fmt=n=>String(n).padStart(2,'0');
  const rub=n=>`${Number(n||0).toLocaleString('ru-RU')} ₽`;
  let busy=false;

  async function getJson(url,fallback,timeoutMs=6500){
    const ctrl=new AbortController();const timer=setTimeout(()=>ctrl.abort(),timeoutMs);
    try{const r=await fetch(`${url}?ts=${Date.now()}`,{cache:'no-store',signal:ctrl.signal});if(!r.ok)throw new Error(`HTTP ${r.status}`);return await r.json()}catch(e){console.warn('COMBO fetch',url,e);return fallback}finally{clearTimeout(timer)}
  }
  function readCache(key,fallback){try{return JSON.parse(localStorage.getItem(key)||'null')??fallback}catch(_){return fallback}}
  function writeCache(key,value){try{localStorage.setItem(key,JSON.stringify(value))}catch(_){}}
  function hitMarkup(numbers,hits){const hs=new Set((hits||[]).map(Number));return (numbers||[]).map(n=>`<span class=\"combo-num ${hs.has(Number(n))?'hit':''}\">${fmt(n)}${hs.has(Number(n))?'<i>✓</i>':''}</span>`).join('<span class=\"combo-dot\">·</span>')}
  function overlap(a,b){const s=new Set(b);return a.filter(n=>s.has(n)).length}
  function overlapInfo(combos){const ks=[3,4,5,6,7],out=[];for(let i=0;i<ks.length;i++)for(let j=i+1;j<ks.length;j++){const a=combos?.['K'+ks[i]]?.numbers||[],b=combos?.['K'+ks[j]]?.numbers||[];if(a.length&&b.length)out.push(`K${ks[i]}∩K${ks[j]}=${overlap(a,b)}`)}return out.join(' · ')}
  function weightLine(w){if(!w)return'';const labels={marker:'ИИ',anchor:'переход',add:'добавление',repeat:'повтор',group:'группы',road:'столбцы',pattern:'ритм',parity:'чёт/нечёт',position:'позиции',cooccur:'связки'};return Object.entries(labels).map(([k,l])=>`${l} ${Math.round(Number(w[k]||0)*100)}%`).join(' · ')}

  function render(archive,model){
    const open=[...(Array.isArray(archive)?archive:[])].reverse().find(r=>r.status==='open');
    const closed=(Array.isArray(archive)?archive:[]).filter(r=>r.status==='closed').slice(-50).reverse();
    if($('comboEngineStatus'))$('comboEngineStatus').textContent=open?'СЕРВЕРНЫЙ ПРОГНОЗ ГОТОВ':'ЖДУ ПЕРВЫЙ СЕРВЕРНЫЙ РАСЧЁТ';
    if($('comboEngineMeta'))$('comboEngineMeta').textContent=`Движок ${model?.version||ENGINE} · опыт: ${Number(model?.experience||0)} закрытых прогнозов · обучение GitHub после каждого нового тиража`;
    if(open){
      $('comboTarget').textContent=`НА №${open.target?.draw||'—'} · ${open.target?.date||''} · ${open.target?.time||'—'}`;
      $('comboCards').innerHTML=[3,4,5,6,7].map(size=>{const c=open.combos?.['K'+size];if(!c)return'';return `<div class="combo-kcard"><div class="combo-khead"><b>K${size}</b><span>${(c.numbers||[]).map(fmt).join(' · ')}</span></div><div class="combo-w">${weightLine(c.weights)}</div></div>`}).join('');
      $('comboOverlap').textContent=`Пересечения: ${overlapInfo(open.combos)}. K3–K7 строятся разными стратегиями; большие пересечения блокируются до сохранения frozen.`;
    }else{
      $('comboTarget').textContent='СЕРВЕР ГОТОВИТ ПЕРВЫЙ FROZEN';
      $('comboCards').innerHTML='<div class="combo-empty">После ближайшего автоматического цикла GitHub здесь появятся новые независимые K3–K7.</div>';
      $('comboOverlap').textContent='Старый локальный генератор отключён: родственные комбы больше не используются.';
    }
    $('comboArchive').innerHTML=closed.length?closed.map(r=>{
      const rows=[3,4,5,6,7].map(size=>{const c=r.combos?.['K'+size];if(!c)return'';const hitNums=(c.hitNumbers||[]).map(Number);return `<div class="combo-hrow"><b>K${size}</b><span class="combo-hnums">${hitMarkup(c.numbers,hitNums)}</span><strong>${Number(c.hits||0)}/${size}</strong><em>${c.prize?`🔥 ${rub(c.prize)}`:'—'}</em>${hitNums.length?`<small class="combo-hitline">✓ выпали: ${hitNums.map(fmt).join(', ')}</small>`:''}</div>`}).join('');
      const total=[3,4,5,6,7].reduce((s,z)=>s+Number(r.combos?.['K'+z]?.prize||0),0);
      return `<details class="combo-hist"><summary><span>№${r.target?.draw||'—'} · ${r.target?.date||''} ${r.target?.time||''}</span><b>${total?`🔥 ${rub(total)}`:'без выигрыша'}</b></summary><div class="combo-hbody">${rows}</div></details>`
    }).join(''):'<div class="combo-empty">Серверный архив начнёт заполняться после первого завершённого frozen-прогноза.</div>';
  }

  function injectUi(){
    if($('comboViewBtn'))return;
    const style=document.createElement('style');style.textContent=`
      .combo-launch-row{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:-4px 0 10px}.combo-launch{grid-column:1;border:1px solid #9a7930;background:linear-gradient(135deg,#514014,#2d2a16);color:#ffe27b;border-radius:10px;padding:10px 8px;font-weight:1000}.combo-launch.active{background:#765b16;color:#fff;border-color:#ffd34f}.combo-card{margin-top:0}.combo-head{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}.combo-head b{font-size:20px}.combo-status{font-size:11px;color:#6ee7a0;font-weight:1000;text-align:right}.combo-sub{color:#9babc0;font-size:11px;line-height:1.4;margin-top:3px}.combo-target{margin:10px 0;border:1px solid #8c7231;border-radius:13px;background:#2b250f;color:#ffe27b;padding:10px;text-align:center;font-weight:1000}.combo-cards{display:grid;gap:8px}.combo-kcard{border:1px solid #36526d;border-radius:12px;background:#0d1d2e;padding:10px}.combo-khead{display:grid;grid-template-columns:46px 1fr;gap:7px;align-items:center}.combo-khead b{font-size:24px;color:#ffd34f}.combo-khead span{font-family:ui-monospace,Consolas,monospace;font-size:16px;font-weight:1000;line-height:1.5}.combo-w{font-size:10px;color:#8fa4ba;margin-top:5px;line-height:1.45}.combo-overlap{margin-top:8px;color:#9fb0c3;font-size:10px;line-height:1.45}.combo-refresh{width:100%;margin-top:10px;border:1px solid #4f8194;background:#12485a;color:#fff;border-radius:11px;padding:11px;font-weight:1000}.combo-archive-title{font-size:19px;font-weight:1000;margin:16px 0 8px}.combo-hist{border:1px solid #294862;border-radius:12px;background:#0b1726;margin-top:7px;overflow:hidden}.combo-hist summary{display:flex;justify-content:space-between;gap:8px;padding:10px;cursor:pointer;font-size:12px}.combo-hist summary b{color:#ffd34f}.combo-hbody{border-top:1px solid #294862;padding:8px}.combo-hrow{display:grid;grid-template-columns:36px 1fr 42px 90px;gap:6px;align-items:center;padding:6px 0;border-bottom:1px solid #1d3448;font-size:11px}.combo-hrow:last-child{border-bottom:0}.combo-hrow b{color:#ffd34f}.combo-hrow span{font-family:ui-monospace,Consolas,monospace}.combo-hrow strong{text-align:center}.combo-hrow em{font-style:normal;text-align:right;color:#ffe27b}.combo-hnums{display:flex;flex-wrap:wrap;gap:2px;align-items:center}.combo-num{display:inline-flex;align-items:center;gap:2px;font-family:ui-monospace,Consolas,monospace}.combo-num.hit{color:#6ee7a0;font-weight:1000}.combo-num.hit i{font-style:normal;color:#4ade80;font-size:12px}.combo-dot{color:#63778d}.combo-hitline{grid-column:2/-1;color:#6ee7a0;font-size:10px;margin-top:1px}.combo-empty{border:1px dashed #36526d;border-radius:10px;padding:12px;color:#9babc0;text-align:center;font-size:11px}@media(max-width:520px){.combo-khead span{font-size:14px}.combo-hrow{grid-template-columns:34px 1fr 38px 82px}}`;
    document.head.appendChild(style);
    const tabs=document.querySelector('.viewtabs');if(tabs){const row=document.createElement('div');row.className='combo-launch-row';row.innerHTML='<button id="comboViewBtn" class="combo-launch" type="button">Комбы</button>';tabs.insertAdjacentElement('afterend',row)}
    const host=$('yuliaView')?.parentElement||document.querySelector('.app');if(host){const s=document.createElement('section');s.id='comboView';s.className='viewpage';s.innerHTML=`<div class="card combo-card"><div class="combo-head"><div><b>🧩 Комбы K3–K7</b><div class="combo-sub">10 слоёв: ИИ-маркеры · переходящие числа · новые добавления · повторы · группы 0/1/2/3/4+ · дорожки столбцов · ритм · чёт/нечёт · позиции · связки</div></div><div id="comboEngineStatus" class="combo-status">ЗАГРУЗКА…</div></div><div id="comboTarget" class="combo-target">ЗАГРУЗКА</div><div id="comboCards" class="combo-cards"></div><div id="comboOverlap" class="combo-overlap"></div><div id="comboEngineMeta" class="combo-overlap"></div><button id="comboRefreshBtn" class="combo-refresh" type="button">↻ ОБНОВИТЬ СЕРВЕРНЫЙ ПРОГНОЗ</button><div class="combo-archive-title">🗂 Архив комб и выигрышей</div><div id="comboArchive"></div></div>`;host.insertBefore(s,$('settingsPanel')||null)}
    $('comboViewBtn')?.addEventListener('click',()=>{['matrixView','yuliaView','aiView'].forEach(id=>$(id)?.classList.remove('active'));$('comboView')?.classList.add('active');document.querySelectorAll('.viewtab').forEach(b=>b.classList.remove('active'));$('comboViewBtn')?.classList.add('active');refresh()});
    ['matrixViewBtn','yuliaViewBtn','aiViewBtn'].forEach(id=>$(id)?.addEventListener('click',()=>{$('comboView')?.classList.remove('active');$('comboViewBtn')?.classList.remove('active')}));
    $('comboRefreshBtn')?.addEventListener('click',refresh);
  }
  async function refresh(){if(busy)return;busy=true;try{if($('comboEngineStatus'))$('comboEngineStatus').textContent='ОБНОВЛЯЮ…';const cachedA=readCache(CACHE_ARCHIVE_KEY,[]),cachedM=readCache(CACHE_MODEL_KEY,{});const [a,m]=await Promise.all([getJson(ARCHIVE_URL,cachedA),getJson(MODEL_URL,cachedM)]);writeCache(CACHE_ARCHIVE_KEY,a);writeCache(CACHE_MODEL_KEY,m);render(a,m)}finally{busy=false}}
  function boot(){injectUi();const a=readCache(CACHE_ARCHIVE_KEY,[]),m=readCache(CACHE_MODEL_KEY,{});if((Array.isArray(a)&&a.length)||Object.keys(m||{}).length){render(a,m);if($('comboEngineStatus'))$('comboEngineStatus').textContent='КЭШ ПОКАЗАН · ОБНОВЛЯЮ…'}refresh();setInterval(refresh,REFRESH_MS)}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot);else boot();
})();
