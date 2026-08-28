const fs=require('fs');

function need(s,a,b,name){
  if(!s.includes(a)) throw new Error(name+': target not found');
  return s.replace(a,b);
}

let m=fs.readFileSync('matrix.js','utf8');

// ONLY groups in Horizontal Yulia. No colors/legend/main matrix changes.
if(!m.includes('class="yulia-group-mark"')){
  const old=`        const cls = yuliaColorClass(data, dateKey, time, timeIndex, w);
        return \`<td class="yulia-cell \${cls}"
          data-win-draw="\${d.draw}"
          data-win-col="\${w}"
          title="\${time} · официальный Столото ст\${w} · нажмите для группы">\${w}</td>\`;`;
  const neu=`        const cls = yuliaColorClass(data, dateKey, time, timeIndex, w);
        const drawIndex = draws.findIndex(x => Number(x.draw) === Number(d.draw));
        const group = drawIndex >= 0 ? groupDetails(drawIndex, w).group : '—';
        return \`<td class="yulia-cell \${cls}"
          data-win-draw="\${d.draw}"
          data-win-col="\${w}"
          title="\${time} · официальный Столото ст\${w} · нажмите для группы"><span class="yulia-main-value">\${w}</span><span class="yulia-group-mark">(\${group})</span></td>\`;`;
  m=need(m,old,neu,'Yulia group cell');
}
fs.writeFileSync('matrix.js',m);

let h=fs.readFileSync('index.html','utf8');

// Only CSS for the new tiny label.
if(!h.includes('.yulia-group-mark{')){
  const a='.yulia-cell:active{transform:scale(.96)}';
  const b=`.yulia-cell:active{transform:scale(.96)}
.yulia-cell{position:relative}
.yulia-main-value{display:inline-block}
.yulia-group-mark{position:absolute;right:3px;bottom:1px;font-size:9px;line-height:1;font-weight:900;opacity:.78;color:currentColor;pointer-events:none}`;
  h=need(h,a,b,'Yulia group CSS');
}

// Existing M5M update mechanism stays. ONLY bump its identifiers.
h=h.replace(/<title>ПОЗИТРОН · МАТРИЦА СТОЛБОВ v[^<]+<\/title>/,
            '<title>ПОЗИТРОН · МАТРИЦА СТОЛБОВ v2.2.15</title>');
h=h.replace(/<small>новое отдельное приложение · v[^<]+<\/small>/,
            '<small>новое отдельное приложение · v2.2.15</small>');
h=h.replace(/<script src="matrix\.js\?v=[^"]+"><\/script>/,
            '<script src="matrix.js?v=v2215-yulia"></script>');
h=h.replace(/\.\/sw\.js\?v=[^'"]+/,'./sw.js?v=matrix-v2215');
fs.writeFileSync('index.html',h);

let sw=fs.readFileSync('sw.js','utf8');
sw=sw.replace(/const CACHE='[^']+';/,"const CACHE='matrix-v2215';");
fs.writeFileSync('sw.js',sw);

let man=JSON.parse(fs.readFileSync('manifest.webmanifest','utf8'));
man.start_url='./?app=v2215';
fs.writeFileSync('manifest.webmanifest',JSON.stringify(man,null,2)+'\n');

console.log('v2.2.15 YULIA groups + version identifiers only');
