export const MATERIALS = [
  ['MgF2',1.38],['SiO2',1.46],['Al2O3',1.63],['HfO2',1.95],['Ta2O5',2.10],['TiO2',2.45],['ZnS',2.35],['a-Si',3.95],['K8',1.52],['Quartz',1.46],['Sitall',1.54]
];
export const PRESETS = {mirror:[{end:1,R:.95}],ar:[{end:1,R:0}],edge:[{end:.5,R:.02},{end:1,R:.95}],split:[{end:.3,R:.02},{end:.7,R:.95},{end:1,R:.02}]};
export function targetAt(wavelength,min,max,bands){const t=(wavelength-min)/(max-min);return (bands.find(b=>t<b.end-1e-12)||bands.at(-1)).R;}
export function grid(min,max,count){return Array.from({length:count},(_,i)=>min+(max-min)*i/(count-1));}
export function validate(c,bands){
  if(!Number.isFinite(c.lambdaMin)||!Number.isFinite(c.lambdaMax)||c.lambdaMin<100||c.lambdaMax>100000||c.lambdaMax<=c.lambdaMin)throw Error('Choose a wavelength range with 100 ≤ From < To ≤ 100,000 nm.');
  for(const [key,min,max] of [['points',5,1001],['maxLayers',1,80],['maxCycles',1,40]]) if(!Number.isInteger(c[key])||c[key]<min||c[key]>max)throw Error(`${key==='points'?'Spectral points':key==='maxLayers'?'Maximum layers':'Evolution cycles'} must be an integer between ${min} and ${max}.`);
  if(!(c.nL<c.nH))throw Error('Choose a low-index material with nL strictly below nH.');
  if(!Number.isFinite(c.startThickness)||c.startThickness<.1||c.startThickness>100000)throw Error('Starting thickness must be between 0.1 and 100,000 nm.');
  if(!Number.isFinite(c.maxOpticalThickness)||c.maxOpticalThickness<1||c.maxOpticalThickness>100000)throw Error('Maximum optical thickness must be between 1 and 100,000 nm.');
  if(c.startThickness*(c.startMaterial==='L'?c.nL:c.nH)>c.maxOpticalThickness+1e-9)throw Error('The starting layer exceeds the optical thickness limit. Increase the limit or reduce its thickness.');
  if(!Number.isFinite(c.targetMerit)||c.targetMerit<0||c.targetMerit>1)throw Error('Target merit must lie between 0 and 1.');
  if(!Number.isFinite(c.cleanupThickness)||c.cleanupThickness<0||c.cleanupThickness>10)throw Error('Cleanup thickness must be between 0 and 10 nm.');
  let end=0; for(const b of bands){if(!Number.isFinite(b.R)||b.R<0||b.R>1||!Number.isFinite(b.end)||b.end<=end||b.end>1)throw Error('Target bands must have increasing boundaries and reflectance between 0 and 1.');end=b.end;}
  if(end!==1)throw Error('Target bands must cover the complete wavelength range.');
  return c;
}
