const fs = require('fs');

function mustReplace(source, oldText, newText, label) {
  if (!source.includes(oldText)) throw new Error(label + ': target not found');
  return source.replace(oldText, newText);
}

let matrix = fs.readFileSync('matrix.js','utf8');

const oldCell = `        const cls = yuliaColorClass(data, dateKey, time, timeIndex, w);
        return \`<td class="yulia-cell \${cls}"
          data-win-draw="\${d.draw}"
          data-win-col="\${w}"
          title="\${time} · официальный Столото ст\${w} · нажмите для группы">\${w}</td>\`;`;

const newCell = `        const cls = yuliaColorClass(data, dateKey, time, timeIndex, w);
        const drawIndex = draws.findIndex(x => Number(x.draw) === Number(d.draw));
        const group = drawIndex >= 0 ? groupDetails(drawIndex, w).group : '—';
        return \`<td class="yulia-cell \${cls}"
          data-win-draw="\${d.draw}"
          data-win-col="\${w}"
          title="\${time} · официальный Столото ст\${w} · нажмите для группы"><span class="yulia-main-value">\${w}</span><span class="yulia-group-mark">(\${group})</span></td>\`;`;

if (!matrix.includes('class="yulia-group-mark"')) {
  matrix = mustReplace(matrix, oldCell, newCell, 'Yulia cell');
}
fs.writeFileSync('matrix.js', matrix);

let html = fs.readFileSync('index.html','utf8');

const cssAnchor = `.yulia-cell:active{transform:scale(.96)}`;
const cssAdd = `.yulia-cell:active{transform:scale(.96)}
.yulia-cell{position:relative}
.yulia-main-value{display:inline-block}
.yulia-group-mark{
  position:absolute;
  right:3px;
  bottom:1px;
  font-size:9px;
  line-height:1;
  font-weight:900;
  opacity:.78;
  color:currentColor;
  pointer-events:none;
}`;

if (!html.includes('.yulia-group-mark{')) {
  html = mustReplace(html, cssAnchor, cssAdd, 'Yulia group CSS');
}

html = html.replace(
  /<script src="matrix\.js\?v=[^"]+"><\/script>/,
  '<script src="matrix.js?v=groups-only-2215"></script>'
);

fs.writeFileSync('index.html', html);

console.log('GROUPS ONLY patch applied');
