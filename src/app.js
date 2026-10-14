import {evaluate,opticalThickness,merit} from './optics.js';
import {downloadWorkbook} from './export.js';
import {MATERIALS,PRESETS,targetAt,grid,validate} from './config.js';
import {frameDuration,insertedLayerId,insertionDetail} from './presentation.js';
import {createMeritScale,formatMeritTick,createReflectanceRange} from './chart-scales.js';
const $=id=>document.getElementById(id);
const NS='http://www.w3.org/2000/svg';
const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
const fmt=(x,d=1)=>Number(x).toLocaleString('en-US',{maximumFractionDigits:d,minimumFractionDigits:d});
const sci=x=>x===0?'0':x<.001?x.toExponential(2):x.toFixed(5);
const svg=(tag,attrs={},text)=>{const n=document.createElementNS(NS,tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);if(text!==undefined)n.textContent=text;return n;};
const append=(el,tag,a,t)=>{const n=svg(tag,a,t);el.append(n);return n;};
let bands=structuredClone(PRESETS.mirror),config,snapshot,best,worker,running=false,paused=false,history=[],events=[],needle=null,initialMerit=0,drag=null,selectedLayer=null,status='Ready',lastStage='',animation=0,displayR=[],displayWavelengths=[],focusedInsertion=null,probeWavelength=null;
let fitReflectance=false,reflectanceRange={min:0,max:1};
function chartGeometry(id, margins){
  const el=$(id),rect=el.getBoundingClientRect(),width=Math.max(240,rect.width),height=Math.max(100,rect.height);
  el.setAttribute('viewBox',`0 0 ${width} ${height}`);
  return {width,height,left:margins.left,right:width-margins.right,top:margins.top,bottom:height-margins.bottom};
}
function spectrumGeometry(){return chartGeometry('spectrum',{left:55,right:16,top:28,bottom:43});}
const plotText={class:'plot-label',style:'font-size:15px'};
const axisText={class:'axis-label',style:'font-size:13px'};
let pausedVisualAnimations=[];
function pauseVisualMotion(value){
  document.body.classList.toggle('paused',value);
  if(value){
    for(const animation of document.getAnimations()){
      const target=animation.effect?.target;
      if(target?.closest?.('.stack-container,#needlePlot')&&!pausedVisualAnimations.includes(animation)){
        animation.pause();pausedVisualAnimations.push(animation);
      }
    }
  }else{
    for(const animation of pausedVisualAnimations)if(animation.playState==='paused')animation.play();
    pausedVisualAnimations=[];
  }
}
const settingIds=['materialL','materialH','substrate','startMaterial','startThickness','points','maxLayers','maxOpticalThickness','targetMerit','cleanupThickness','maxCycles','lambdaMin','lambdaMax'];
for(const id of ['materialL','materialH']){
  MATERIALS.forEach(([name,n],i)=>{const o=document.createElement('option');o.value=i;o.textContent=`${name} · ${n.toFixed(2)}`;$(id).append(o);});
}
$('materialL').value=1;$('materialH').value=4;
try{const saved=JSON.parse(localStorage.getItem('ms-astra-v1'));if(saved){for(const [key,val]of Object.entries(saved.inputs||{}))if(settingIds.includes(key))$(key).value=val;if(saved.bands)bands=saved.bands;}}catch{}
function readConfig(){
  const c={};for(const key of settingIds)c[key]=key==='startMaterial'?$(key).value:Number($(key).value);
  c.nL=MATERIALS[c.materialL]?.[1];c.nH=MATERIALS[c.materialH]?.[1];c.ns=c.substrate;c.materialLName=MATERIALS[c.materialL]?.[0];c.materialHName=MATERIALS[c.materialH]?.[0];
  validate(c,bands);c.wavelengths=grid(c.lambdaMin,c.lambdaMax,c.points);c.target=c.wavelengths.map(w=>targetAt(w,c.lambdaMin,c.lambdaMax,bands));c.bands=structuredClone(bands);return c;
}
function save(){try{localStorage.setItem('ms-astra-v1',JSON.stringify({inputs:Object.fromEntries(settingIds.map(k=>[k,$(k).value])),bands}));}catch{}}
function error(message){
  $('errorBox').textContent=message;$('errorBox').hidden=false;
  const dialog=document.querySelector('dialog[open]');
  if(dialog){let notice=dialog.querySelector('.dialog-error');if(!notice){notice=document.createElement('p');notice.className='dialog-error';notice.setAttribute('role','alert');dialog.querySelector('h2').after(notice);}notice.textContent=message;notice.hidden=false;}
}
function clearError(){$('errorBox').hidden=true;document.querySelectorAll('.dialog-error').forEach(el=>el.hidden=true);}
function reset(){if(running)return;try{config=readConfig();clearError();save();const material=config.startMaterial;const layers=[{id:'initial',material,n:material==='L'?config.nL:config.nH,d:config.startThickness}];const result=evaluate(layers,config.wavelengths,config.ns);snapshot={stage:'initial',layers,R:result.R,merit:merit(result.R,config.target),iteration:0,cycle:0,message:'A single layer. A spectrum of possibilities.'};best=structuredClone(snapshot);initialMerit=snapshot.merit;history=[];events=[];needle=null;lastStage='';status='Ready';selectedLayer=null;focusedInsertion=null;document.body.classList.remove('paused');cancelAnimationFrame(animation);$('stackSelection').textContent='Select a layer to inspect its thickness.';$('eventLog').innerHTML='<div><i></i><span>Ready</span><p>Draw your target and start the synthesis.</p></div>';document.querySelectorAll('[data-preset]').forEach(n=>n.classList.toggle('active',JSON.stringify(PRESETS[n.dataset.preset])===JSON.stringify(bands)));displayR=[...snapshot.R];displayWavelengths=[...config.wavelengths];$('runStatus').textContent='Ready to evolve';$('runMessage').textContent=snapshot.message;$('runButton').innerHTML='<span>▶</span> Start evolution';renderAll();renderBands();$('runButton').disabled=false;$('exportButton').disabled=false;}catch(e){error(e.message);$('runButton').disabled=true;$('exportButton').disabled=true;}}
function domain(){const span=config.lambdaMax-config.lambdaMin;return {min:config.lambdaMin-span*.035,max:config.lambdaMax+span*.035};}
function spectralAxes(){
  const el=$('spectrum');el.replaceChildren();if(!drag)reflectanceRange=createReflectanceRange([...displayR,...(snapshot.verification?.R??snapshot.R),...bands.map(b=>b.R)],{fit:fitReflectance});const g=spectrumGeometry(),{min,max}=domain();
  const X=v=>g.left+(v-min)/(max-min)*(g.right-g.left),Y=v=>g.bottom-(v-reflectanceRange.min)/(reflectanceRange.max-reflectanceRange.min)*(g.bottom-g.top);
  append(el,'defs').innerHTML='<linearGradient id="spectralFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#367bf0" stop-opacity=".065"/><stop offset="100%" stop-color="#367bf0" stop-opacity=".005"/></linearGradient>';
  append(el,'rect',{x:g.left,y:g.top,width:g.right-g.left,height:g.bottom-g.top,fill:'#fdfefe',stroke:'#dce4ef','stroke-width':1});
  const yDivisions=fitReflectance?5:10;
  for(let i=0;i<=yDivisions;i++){const value=reflectanceRange.min+(reflectanceRange.max-reflectanceRange.min)*i/yDivisions,y=Y(value),major=fitReflectance||i%2===0;append(el,'line',{x1:g.left,x2:g.right,y1:y,y2:y,stroke:major?'#dfe6ef':'#f0f3f7','stroke-width':1});if(major)append(el,'text',{x:g.left-12,y:y+5,'text-anchor':'end',...plotText},fmt(value*100,fitReflectance?1:0));}
  const divisions=g.width>=740?8:4;
  for(let i=0;i<=divisions;i++){const w=config.lambdaMin+(config.lambdaMax-config.lambdaMin)*i/divisions;append(el,'line',{x1:X(w),x2:X(w),y1:g.top,y2:g.bottom,stroke:'#e8edf4'});append(el,'text',{x:X(w),y:g.bottom+24,'text-anchor':'middle',...plotText},fmt(w,config.lambdaMax-config.lambdaMin<20?1:0));}
  append(el,'text',{x:g.left,y:16,...axisText},'REFLECTANCE, %');append(el,'text',{x:g.right,y:g.height-2,'text-anchor':'end',...axisText},'WAVELENGTH, nm');
  append(el,'path',{id:'responseFill',fill:'url(#spectralFill)'});append(el,'path',{id:'responseLine',fill:'none',stroke:'#2e78ed','stroke-width':3.5,'stroke-linejoin':'round','stroke-linecap':'round'});
  let prev=0,d='';
  bands.forEach((b,i)=>{const x1=X(config.lambdaMin+prev*(config.lambdaMax-config.lambdaMin)),x2=X(config.lambdaMin+b.end*(config.lambdaMax-config.lambdaMin)),y=Y(b.R);d+=(i?'L':'M')+`${x1},${y} L${x2},${y}`;
    append(el,'line',{x1,x2,y1:y,y2:y,stroke:'transparent','stroke-width':24,'data-drag':'level','data-index':i,class:'target-handle'});append(el,'circle',{cx:(x1+x2)/2,cy:y,r:5.5,fill:'#fff',stroke:'#7854ad','stroke-width':2.5,'data-drag':'level','data-index':i,class:'target-handle'});
    if(i<bands.length-1){append(el,'line',{x1:x2,x2,y1:g.top,y2:g.bottom,stroke:'#c2b0dd','stroke-dasharray':'4 5'});append(el,'rect',{x:x2-11,y:g.top-14,width:22,height:g.bottom-g.top+14,fill:'transparent','data-drag':'boundary','data-index':i,class:'boundary-handle'});append(el,'path',{d:`M${x2-5},${g.top-12} L${x2+5},${g.top-12} L${x2},${g.top-4} Z`,fill:'#7854ad','data-drag':'boundary','data-index':i,class:'boundary-handle'});}prev=b.end;
  });
  const path=append(el,'path',{id:'targetLine',d,fill:'none',stroke:'#7854ad','stroke-width':5,'stroke-dasharray':'10 7','stroke-linecap':'round','stroke-linejoin':'round','pointer-events':'none'});el.insertBefore(path,el.querySelector('[data-drag]'));
  for(const [side,w]of [['min',config.lambdaMin],['max',config.lambdaMax]]){const x=X(w);append(el,'line',{x1:x,x2:x,y1:g.top,y2:g.bottom,stroke:'#afc4df','stroke-width':1.5,'stroke-dasharray':'3 4'});append(el,'rect',{x:x-9,y:g.bottom-10,width:18,height:23,rx:4,fill:'#edf3fc',stroke:'#a6bedc','data-drag':side,class:'boundary-handle'});append(el,'path',{d:`M${x-2},${g.bottom-4} v10 M${x+2},${g.bottom-4} v10`,stroke:'#718baa','pointer-events':'none'});}
  renderResponse(displayR.length?displayR:snapshot.R);
  renderProbe();
}
function renderProbe(){
  $('spectrumProbe')?.remove();
  if(probeWavelength===null||probeWavelength<config.lambdaMin||probeWavelength>config.lambdaMax){probeWavelength=null;$('spectrumReadout').textContent='Drag the target to edit · click the plot to inspect R.';return;}
  const g=spectrumGeometry(),{min,max}=domain(),x=g.left+(probeWavelength-min)/(max-min)*(g.right-g.left);
  const current=evaluate(snapshot.layers,[probeWavelength],config.ns).R[0],target=targetAt(probeWavelength,config.lambdaMin,config.lambdaMax,bands),delta=100*(current-target);
  const group=append($('spectrum'),'g',{id:'spectrumProbe','pointer-events':'none'});
  append(group,'line',{x1:x,x2:x,y1:g.top,y2:g.bottom,stroke:'#55718f','stroke-width':1,'stroke-dasharray':'3 4'});
  append(group,'circle',{cx:x,cy:g.bottom-(current-reflectanceRange.min)/(reflectanceRange.max-reflectanceRange.min)*(g.bottom-g.top),r:5,fill:'#fff',stroke:'#2671e4','stroke-width':2.5});
  $('spectrumReadout').textContent=`${fmt(probeWavelength,1)} nm · Target ${fmt(target*100,2)}% · Current ${fmt(current*100,2)}% · Δ ${delta>=0?'+':''}${fmt(delta,2)} pp`;
}
function renderResponse(R){
  if(!$('responseLine'))return;const g=spectrumGeometry(),{min,max}=domain(),X=v=>g.left+(v-min)/(max-min)*(g.right-g.left),Y=v=>g.bottom-clamp((v-reflectanceRange.min)/(reflectanceRange.max-reflectanceRange.min),0,1)*(g.bottom-g.top);
  const d=R.map((v,i)=>`${i?'L':'M'}${X((displayWavelengths.length===R.length?displayWavelengths:config.wavelengths)[i]).toFixed(2)},${Y(v).toFixed(2)}`).join(' ');$('responseLine').setAttribute('d',d);$('responseFill').setAttribute('d',`${d} L${X(config.lambdaMax)},${g.bottom} L${X(config.lambdaMin)},${g.bottom} Z`);
}
function animateResponse(R,wavelengths=config.wavelengths){
  cancelAnimationFrame(animation);const sameGrid=displayWavelengths.length===wavelengths.length&&displayWavelengths.every((w,i)=>w===wavelengths[i]);const from=sameGrid&&displayR.length===R.length?[...displayR]:[...R],to=[...R];displayWavelengths=[...wavelengths];let start=performance.now(),last=start;
  const duration=window.matchMedia('(prefers-reduced-motion: reduce)').matches?0:Math.min(700,frameDuration(snapshot.stage,Number($('speed').value))*.7);
  function frame(now){if(paused){start+=now-last;last=now;animation=requestAnimationFrame(frame);return;}last=now;const t=duration?Math.min(1,(now-start)/duration):1;displayR=to.map((v,i)=>from[i]+(v-from[i])*(1-(1-t)**3));renderResponse(displayR);if(t<1)animation=requestAnimationFrame(frame);}animation=requestAnimationFrame(frame);
}
function renderInsertionFocus(){
  let panel=$('insertionFocus');if(!panel){panel=document.createElement('div');panel.id='insertionFocus';panel.className='insertion-focus';$('stackLayers').closest('.stack-container').append(panel);}
  const detail=focusedInsertion===null?null:insertionDetail(snapshot.layers,focusedInsertion);
  panel.classList.toggle('empty',!detail);panel.classList.toggle('is-inserting',snapshot.stage==='needle-insertion');
  if(!detail){panel.dataset.id='';panel.innerHTML='<div class="focus-heading">Insertion detail</div><p class="focus-caption">The next inserted layer will appear here, magnified.</p>';return;}
  if(panel.dataset.id!==String(focusedInsertion)){
    panel.dataset.id=String(focusedInsertion);panel.replaceChildren();
    const heading=document.createElement('div');heading.className='focus-heading';panel.append(heading);
    const strip=document.createElement('div');strip.className='focus-strip';strip.setAttribute('role','img');panel.append(strip);
    const caption=document.createElement('div');caption.className='focus-caption';panel.append(caption);
  }
  panel.querySelector('.focus-heading').textContent=`${detail.layer.material} inserted · ${fmt(detail.layer.d,2)} nm`;
  const strip=panel.querySelector('.focus-strip'),ids=new Set();
  detail.segments.forEach((layer,index)=>{const id=String(layer.id);ids.add(id);let el=[...strip.children].find(node=>node.dataset.id===id);if(!el){el=document.createElement('div');el.dataset.id=id;el.className='focus-layer';strip.append(el);}el.classList.toggle('focus-inserted',layer.selected);el.dataset.material=layer.material;el.style.width=`${layer.fraction*100}%`;el.textContent=layer.material;el.title=`${layer.material} · ${fmt(layer.d,3)} nm`;if(strip.children[index]!==el)strip.insertBefore(el,strip.children[index]||null);});
  [...strip.children].forEach(el=>{if(!ids.has(el.dataset.id))el.remove();});
  strip.setAttribute('aria-label',`Magnified insertion: ${detail.layer.material}, ${fmt(detail.layer.d,3)} nm, at depth ${fmt(detail.center,2)} nm`);
  panel.querySelector('.focus-caption').textContent=`Zoomed view · depth ${fmt(detail.left,1)}–${fmt(detail.right,1)} nm`;
}
function renderStack(){
  const el=$('stackLayers'),total=snapshot.layers.reduce((sum,layer)=>sum+layer.d,0),ids=new Set(),focusIndex=snapshot.layers.findIndex(layer=>String(layer.id)===String(focusedInsertion));
  el.classList.toggle('is-inserting',snapshot.stage==='needle-insertion');
  snapshot.layers.forEach((l,i)=>{const id=String(l.id??`${i}-${l.material}`);ids.add(id);let n=[...el.children].find(n=>n.dataset.id===id);if(!n){n=document.createElement('button');n.className=id===String(focusedInsertion)?'layer inserted':'layer';n.dataset.id=id;el.append(n);}n.dataset.material=l.material;n.style.width=`${total?l.d/total*100:0}%`;n.style.setProperty('--layer-width',n.style.width);n.style.flexShrink='0';n.classList.toggle('inserted',snapshot.stage==='needle-insertion'&&id===String(focusedInsertion));n.classList.toggle('is-focused',id===String(focusedInsertion));n.classList.toggle('is-neighbor',focusIndex>=0&&Math.abs(i-focusIndex)===1);n.title=`Layer ${i+1} · ${l.material} · ${fmt(l.d,3)} nm`;n.setAttribute('aria-label',n.title);n.innerHTML=l.d/total>.055?`<span>${l.material}</span>`:'';n.onclick=()=>{selectedLayer=id;$('stackSelection').textContent=`Layer ${i+1} · ${l.material==='L'?config.materialLName:config.materialHName} · n ${l.n.toFixed(2)} · ${fmt(l.d,3)} nm · optical ${fmt(l.d*l.n,3)} nm`;[...el.children].forEach(c=>c.classList.toggle('selected',c===n));};if(selectedLayer===id)n.onclick();if(el.children[i]!==n)el.insertBefore(n,el.children[i]||null);});
  [...el.children].forEach(n=>{if(!ids.has(n.dataset.id))n.remove();});$('geometricTotal').textContent=`${fmt(total,1)} nm`;if(selectedLayer&&!ids.has(selectedLayer)){$('stackSelection').textContent='Select a layer to inspect its thickness.';selectedLayer=null;}
  renderInsertionFocus();
}
function renderNeedle(){
  const el=$('needlePlot');el.replaceChildren();const g=chartGeometry('needlePlot',{left:68,right:10,top:26,bottom:36}),samples=needle?.samples||[],depth=Math.max(1,...samples.map(s=>s.x)),X=x=>g.left+x/depth*(g.right-g.left);
  const max=Math.max(1e-9,...samples.map(s=>Math.abs(s.value))),middle=(g.top+g.bottom)/2,Y=v=>middle-v/max*(g.bottom-g.top)/2;
  for(let i=-1;i<=1;i++){const y=Y(i*max);append(el,'line',{x1:g.left,x2:g.right,y1:y,y2:y,stroke:i?'#eaf0f6':'#bbc7d7','stroke-dasharray':i?'':'4 4'});append(el,'text',{x:g.left-9,y:y+5,'text-anchor':'end',...plotText},samples.length?(i===0?'0':(i*max).toExponential(1)):i===0?'0':'');}
  append(el,'text',{x:g.left,y:16,...axisText},'dF / dη · MSE / nm');append(el,'text',{x:g.right,y:g.height-2,...axisText,'text-anchor':'end'},'DEPTH, nm');
  if(!samples.length){$('needleBadge').textContent='Awaiting scan';$('needleBadge').classList.remove('negative');$('needleCaption').textContent='Negative sensitivity identifies promising insertion positions.';append(el,'line',{x1:g.left,x2:g.right,y1:middle,y2:middle,stroke:'#b5a4d3','stroke-width':2,'stroke-dasharray':'7 8'});return;}
  // Sensitivity is generally discontinuous at material interfaces.
  const groups=[];for(const s of samples){if(!groups.length||groups.at(-1).at(-1).layerIndex!==s.layerIndex)groups.push([]);groups.at(-1).push(s);}for(const group of groups){const d=group.map((s,i)=>`${i?'L':'M'}${X(s.x)},${Y(s.value)}`).join(' ');append(el,'path',{d,fill:'none',stroke:'#8861c7','stroke-width':2.8,'stroke-linejoin':'round'});}
  const tickCount=g.width<470?2:4;for(let i=0;i<=tickCount;i++){const x=i*depth/tickCount;append(el,'text',{x:X(x),y:g.bottom+18,'text-anchor':i===0?'start':i===tickCount?'end':'middle',...plotText},fmt(x,0));}
  const b=needle.best;if(b){const x=X(b.x),y=Y(b.value);append(el,'line',{x1:x,x2:x,y1:g.top,y2:g.bottom,stroke:'#9571c4','stroke-width':1.5,'stroke-dasharray':'4 4'});if(snapshot.stage==='needle-insertion')append(el,'circle',{cx:x,cy:y,r:13,fill:'#9470d0','fill-opacity':'.16',class:'needle-focus-halo'});append(el,'circle',{cx:x,cy:y,r:6,fill:'#8053bd',stroke:'#fff','stroke-width':2});$('needleBadge').textContent=`${b.material} at ${fmt(b.x,1)} nm`;$('needleBadge').classList.toggle('negative',b.value<0);$('needleCaption').textContent=`${snapshot.stage==='needle-insertion'?'Inserted':'Last scan'}: ${b.material} at ${fmt(b.x,1)} nm · dF/dη ${b.value.toExponential(2)} / nm`;}
}
function renderHistory(){
  const el=$('historyPlot');el.replaceChildren();const g=chartGeometry('historyPlot',{left:63,right:10,top:24,bottom:25});
  const series=history.length?history:[{merit:snapshot.merit}],values=series.map(h=>h.merit);
  const scale=createMeritScale(values,{target:config.targetMerit,maxTicks:g.height<160?3:4});
  const Y=value=>g.bottom-scale.position(value)*(g.bottom-g.top),X=i=>g.left+i/Math.max(1,values.length-1)*(g.right-g.left);
  append(el,'text',{x:g.left,y:15,...axisText},scale.mode==='zero'?'MSE':'MSE · log scale');
  for(const tick of scale.ticks){const y=g.bottom-tick.position*(g.bottom-g.top);append(el,'line',{x1:g.left,x2:g.right,y1:y,y2:y,stroke:'#e5ebf3'});append(el,'text',{x:g.left-8,y:y+4,'text-anchor':'end',...plotText,class:'plot-label merit-tick',style:'font-size:13px','data-merit':tick.value},tick.label);}
  const goal=Y(config.targetMerit);append(el,'line',{x1:g.left,x2:g.right,y1:goal,y2:goal,stroke:'#2f947f','stroke-width':1.5,'stroke-dasharray':'5 4'});
  append(el,'path',{d:values.map((v,i)=>`${i?'L':'M'}${X(i)},${Y(v)}`).join(' '),fill:'none',stroke:'#4278b9','stroke-width':2.5,'stroke-linejoin':'round'});
  series.forEach((h,i)=>{if(h.stage==='growth')append(el,'circle',{cx:X(i),cy:Y(h.merit),r:3.5,fill:'#9771c8'});});
  append(el,'circle',{cx:X(values.length-1),cy:Y(values.at(-1)),r:3.5,fill:'#4278b9',stroke:'#fff','stroke-width':1});
  append(el,'text',{x:g.left,y:g.height-3,...plotText,style:'font-size:12px'},'Start');append(el,'text',{x:g.right,y:g.height-3,'text-anchor':'end',...plotText,style:'font-size:12px'},history.length?'Now':'Ready');
  $('meritCaption').textContent=scale.zeroNote||`MSE ≥ 0 · dashed line: limit ${formatMeritTick(config.targetMerit)}`;
}
const stageNames={initial:'Starting layer',refinement:'Refining thicknesses','needle-scan':'Scanning for needles','needle-insertion':'Inserting a new layer',growth:'Gradual evolution',cleanup:'Removing thin layers',final:'Final thickness polish',done:'Synthesis complete'};
function renderMetrics(){if($('designSummary'))$('designSummary').textContent=`${config.materialLName} / ${config.materialHName} · BK7 · ${config.points} spectral points`;$('meritValue').textContent=sci(snapshot.merit);$('meritChange').textContent=initialMerit>0?`${Math.max(-999,(1-snapshot.merit/initialMerit)*100).toFixed(1)}% improvement`:'Initial target already matched';$('layerCount').innerHTML=`${snapshot.layers.length} <em>/ ${config.maxLayers}</em>`;$('layerCaption').textContent=`${snapshot.layers.filter(l=>l.material==='L').length} low · ${snapshot.layers.filter(l=>l.material==='H').length} high`;$('thicknessValue').innerHTML=`${fmt(opticalThickness(snapshot.layers),0)} <em>nm</em>`;$('thicknessCaption').textContent=`of ${fmt(config.maxOpticalThickness,0)} nm allowed`;$('cycleValue').textContent=String(snapshot.cycle||0).padStart(2,'0');$('iterationValue').textContent=`Iteration ${snapshot.iteration||0}`;document.querySelectorAll('[data-stage]').forEach(el=>el.classList.toggle('active',snapshot.stage.startsWith(el.dataset.stage)));}
function renderAll(){spectralAxes();renderMetrics();renderStack();renderNeedle();renderHistory();}
function renderBands(){const el=$('bandRows');el.replaceChildren();bands.forEach((b,i)=>{const row=document.createElement('div');row.className='band-row';const label=document.createElement('label');label.textContent=`Band ${i+1} end · nm`;const end=document.createElement('input');end.type='number';end.step='1';end.value=fmt(config.lambdaMin+b.end*(config.lambdaMax-config.lambdaMin),1).replaceAll(',','');end.disabled=running||i===bands.length-1;end.onchange=()=>{const next=(Number(end.value)-config.lambdaMin)/(config.lambdaMax-config.lambdaMin);if(next<=(bands[i-1]?.end||0)||next>=(bands[i+1]?.end||1)){error('Keep band boundaries in increasing wavelength order.');renderBands();return;}b.end=next;reset();};label.append(end);const rlabel=document.createElement('label');rlabel.textContent='Target reflectance · R';const input=document.createElement('input');Object.assign(input,{type:'number',min:'0',max:'1',step:'.01',value:b.R,disabled:running});input.onchange=()=>{b.R=Number(input.value);reset();};rlabel.append(input);row.append(label,rlabel);if(bands.length>1){const remove=document.createElement('button');remove.textContent='×';remove.setAttribute('aria-label',`Remove band ${i+1}`);remove.disabled=running;remove.onclick=()=>{if(i===bands.length-1)bands[i-1].end=1;bands.splice(i,1);reset();};row.append(remove);}el.append(row);});$('addBand').disabled=running||bands.length>=12;}
function setLocked(lock){settingIds.forEach(id=>$(id).disabled=lock);document.querySelectorAll('[data-preset]').forEach(b=>b.disabled=lock);$('stopButton').disabled=!lock;$('resetButton').disabled=lock;document.body.classList.toggle('running',lock);renderBands();}
function applySnapshot(s){if(s.stage==='needle-insertion')focusedInsertion=insertedLayerId(snapshot,s);else if(['initial','needle-scan','growth','cleanup','done'].includes(s.stage))focusedInsertion=null;snapshot=s;if(s.needle)needle={...s.needle,cycle:s.cycle,selected:s.stage==='needle-insertion'};if(!best||s.merit<best.merit)best=structuredClone(s);history.push({iteration:s.iteration||0,cycle:s.cycle||0,stage:s.stage,merit:s.merit,layers:s.layers.length,opticalThickness:opticalThickness(s.layers)});if(lastStage!==s.stage){lastStage=s.stage;events.unshift({title:stageNames[s.stage]||s.stage,message:s.message||''});events=events.slice(0,15);$('eventLog').replaceChildren(...events.map(e=>{const div=document.createElement('div');div.append(document.createElement('i'));const title=document.createElement('span');title.textContent=e.title;const p=document.createElement('p');p.textContent=e.message;div.append(title,p);return div;}));}if(!paused){$('runStatus').textContent=stageNames[s.stage]||s.stage;$('runMessage').textContent=s.message||'';}renderMetrics();renderStack();renderNeedle();renderHistory();if(fitReflectance)spectralAxes();else renderProbe();animateResponse(s.verification?.R??s.R,s.verification?.wavelengths??config.wavelengths);if(paused)pauseVisualMotion(true);}
function finish(stopped=false){
  running=false;paused=false;pauseVisualMotion(false);worker?.terminate();worker=null;setLocked(false);
  if(stopped&&best)applySnapshot({...best,stage:'done',message:'Stopped by you. Best design retained.'});
  const reached=snapshot.merit<=config.targetMerit,verification=snapshot.verification;
  status=stopped?'Stopped':reached?(verification&&!verification.meetsTarget?'Sampled target reached':'Target reached'):'Search finished';
  $('runStatus').textContent=status;
  if(stopped)$('runMessage').textContent='Best design retained. Export it or start a new evolution.';
  else if(verification){
    const result=reached?(verification.meetsTarget?'Target met on both grids.':'Requested grid met; dense check exceeds threshold.'):'Requested-grid target not reached.';
    $('runMessage').textContent=`${result} Dense check: ${verification.points} points · MSE ${sci(verification.merit)} · max error ${fmt(verification.maxAbsError*100,2)} pp.`;
  }else $('runMessage').textContent=reached?'The design meets your merit threshold on the requested spectral grid.':`${snapshot.message||'Search limit reached.'} Target merit not reached.`;
  $('runButton').innerHTML='<span>▶</span> Run again';
}
$('runButton').onclick=()=>{
  if(running){paused=!paused;pauseVisualMotion(paused);worker.postMessage({type:paused?'pause':'resume'});$('runButton').innerHTML=paused?'<span>▶</span> Resume':'<span>Ⅱ</span> Pause';$('runStatus').textContent=paused?'Evolution paused':stageNames[snapshot.stage];return;}
  reset();if($('runButton').disabled)return;running=true;paused=false;status='Running';setLocked(true);$('runButton').innerHTML='<span>Ⅱ</span> Pause';$('runStatus').textContent='Starting evolution';worker=new Worker(new URL('./worker.js',import.meta.url),{type:'module'});worker.onmessage=({data})=>{if(data.type==='archive'&&(!best||data.snapshot.merit<best.merit))best=structuredClone(data.snapshot);if(data.type==='snapshot')applySnapshot(data.snapshot);if(data.type==='complete')finish();if(data.type==='stopped')finish(true);if(data.type==='error'){finish(true);error(`Synthesis stopped: ${data.message}`);}};worker.onerror=e=>{finish(true);error(`The calculation worker could not run: ${e.message||'please serve the app over HTTP.'}`);};worker.postMessage({type:'start',config,pace:Number($('speed').value)});
};
function setMotionPace(){const pace=Number($('speed').value);document.body.classList.toggle('fast-motion',pace===0);document.documentElement.style.setProperty('--motion-duration',pace===0?'0ms':pace>=500?'1000ms':'650ms');document.documentElement.style.setProperty('--insert-duration',`${frameDuration('needle-insertion',pace)}ms`);worker?.postMessage({type:'pace',pace});}
$('stopButton').onclick=()=>{finish(true);};$('resetButton').onclick=reset;$('speed').onchange=setMotionPace;setMotionPace();
$('settingsForm').addEventListener('submit',event=>{event.preventDefault();reset();});
for(const id of settingIds)$(id).addEventListener('change',reset);
document.querySelectorAll('[data-preset]').forEach(b=>b.onclick=()=>{bands=structuredClone(PRESETS[b.dataset.preset]);document.querySelectorAll('[data-preset]').forEach(n=>n.classList.toggle('active',n===b));reset();});
$('editBandsButton').onclick=()=>{$('targetDialog').showModal();};$('settingsButton').onclick=()=>$('settingsDialog').showModal();$('eventButton').onclick=()=>$('eventDialog').showModal();$('addBand').onclick=()=>{const last=bands.at(-1),start=bands.at(-2)?.end||0;bands.splice(bands.length-1,0,{end:(start+last.end)/2,R:last.R});reset();};
function svgPoint(event){const p=$('spectrum').createSVGPoint();p.x=event.clientX;p.y=event.clientY;return p.matrixTransform($('spectrum').getScreenCTM().inverse());}
$('spectrum').addEventListener('pointerdown',e=>{if(!e.target.dataset.drag){const p=svgPoint(e),g=spectrumGeometry(),d=domain();if(p.x>=g.left&&p.x<=g.right&&p.y>=g.top&&p.y<=g.bottom){probeWavelength=clamp(d.min+(p.x-g.left)/(g.right-g.left)*(d.max-d.min),config.lambdaMin,config.lambdaMax);renderProbe();}return;}if(running)return;drag={type:e.target.dataset.drag,index:Number(e.target.dataset.index),domain:domain(),geometry:spectrumGeometry(),reflectance:{...reflectanceRange}};$('spectrum').setPointerCapture(e.pointerId);e.preventDefault();});
$('spectrum').addEventListener('pointermove',e=>{if(!drag)return;const p=svgPoint(e);const g=drag.geometry,wavelength=drag.domain.min+(p.x-g.left)/(g.right-g.left)*(drag.domain.max-drag.domain.min);if(drag.type==='level'){bands[drag.index].R=Number(clamp(drag.reflectance.min+(g.bottom-p.y)/(g.bottom-g.top)*(drag.reflectance.max-drag.reflectance.min),0,1).toFixed(3));}else if(drag.type==='boundary'){bands[drag.index].end=clamp((wavelength-config.lambdaMin)/(config.lambdaMax-config.lambdaMin),(bands[drag.index-1]?.end||0)+.005,bands[drag.index+1].end-.005);}else if(drag.type==='min'){$('lambdaMin').value=Math.round(clamp(wavelength,100,Number($('lambdaMax').value)-10));}else{$('lambdaMax').value=Math.round(clamp(wavelength,Number($('lambdaMin').value)+10,100000));}document.querySelectorAll('[data-preset]').forEach(n=>n.classList.remove('active'));reset();});
const endDrag=()=>{drag=null;if(fitReflectance)spectralAxes();};$('spectrum').addEventListener('pointerup',endDrag);$('spectrum').addEventListener('pointercancel',endDrag);
$('fitSpectrumButton').onclick=()=>{fitReflectance=!fitReflectance;$('fitSpectrumButton').textContent=fitReflectance?'Full R':'Fit R';$('fitSpectrumButton').setAttribute('aria-pressed',String(fitReflectance));spectralAxes();};
$('presentButton').onclick=()=>{const presenting=document.body.classList.toggle('presenting');$('presentButton').innerHTML=presenting?'⛶ <span>Exit presentation</span>':'⛶ <span>Present</span>';};
$('methodButton').onclick=()=>$('methodDialog').showModal();$('layersButton').onclick=()=>{$('layerTable').replaceChildren(...snapshot.layers.map((l,i)=>{const row=document.createElement('tr');[i+1,`${l.material} · ${l.material==='L'?config.materialLName:config.materialHName}`,l.n.toFixed(2),fmt(l.d,4),fmt(l.n*l.d,4)].forEach(v=>{const c=document.createElement('td');c.textContent=v;row.append(c);});return row;}));$('layersDialog').showModal();};document.querySelectorAll('.dialog-close').forEach(b=>b.onclick=()=>b.closest('dialog').close());document.querySelectorAll('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}}));
$('exportButton').onclick=()=>{try{downloadWorkbook({config:{...config,search:snapshot.search},layers:snapshot.layers,wavelengths:config.wavelengths,target:config.target,R:snapshot.R,history,verification:snapshot.verification,status:running?'In progress snapshot':status+': '+(snapshot.reason||snapshot.message),search:snapshot.search});}catch(e){error(`Excel export failed: ${e.message}`);}};
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&document.body.classList.contains('presenting')&&!document.querySelector('dialog[open]')){$('presentButton').click();}});
reset();
let resizeFrame=0;const chartResize=new ResizeObserver(()=>{cancelAnimationFrame(resizeFrame);resizeFrame=requestAnimationFrame(()=>{if(!config)return;spectralAxes();renderNeedle();renderHistory();});});['spectrum','needlePlot','historyPlot'].forEach(id=>chartResize.observe($(id)));
