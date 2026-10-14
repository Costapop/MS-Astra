/** Deterministic IEEE-754 test inputs for independent-audit.py; seed 0x694fa128. */
import {evaluate,merit,needleDerivative} from '../src/optics.js';
let seed=0x694fa128;
const rng=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/2**32;};
const cases=[];
for(let c=0;c<60;c++){
 const count=[1,2,3,7,16,32,80][c%7];
 const nL=[1.38,1.46,1.63][c%3],nH=[1.95,2.1,2.45,3.95][c%4];
 const lambda0=[100,400,1000,10000][c%4];
 const wavelengths=Array.from({length:9},(_,i)=>lambda0*(1+i*.17));
 let layers=Array.from({length:count},(_,i)=>({id:String(i),material:i%2?'L':'H',n:i%2?nL:nH,d:(.02+.98*rng())*lambda0*1.8}));
 const optical=layers.reduce((s,l)=>s+l.n*l.d,0);if(optical>95000)layers=layers.map(l=>({...l,d:l.d*95000/optical}));
 if(c%9===0)layers[0].d=1e-6;
 const target=wavelengths.map(()=>rng());
 const state=evaluate(layers,wavelengths,1.52);
 const js=[];
 for(const j of new Set([0,Math.floor(count/2),count-1]))for(const f of [0,.271,.5,.863,1]){
  const position=layers[j].d*f,needleN=layers[j].material==='L'?nH:nL;
  js.push({j,position,needleN,g:needleDerivative(layers,wavelengths,target,1.52,j,position,needleN)});
 }
 cases.push({layers,wavelengths,target,ns:1.52,F:merit(state.R,target),R:state.R,T:state.T,J:state.jacobian,needles:js});
}

const highQ = [15, 19].map(pairs => {
 const H={material:'H',n:3.95,d:550/(4*3.95)}, L={material:'L',n:1.38,d:550/(4*1.38)};
 const layers=[];
 for(let i=0;i<pairs;i++) layers.push({...H},{...L});
 layers.push({...H,d:550/(2*3.95)});
 for(let i=0;i<pairs;i++) layers.push({...L},{...H});
 const j=2*pairs, state=evaluate(layers,[550],1.52);
 return {layers,wavelength:550,j,R:state.R[0],T:state.T[0],J:state.jacobian[0][j],
  needle:needleDerivative(layers,[550],[.2],1.52,j,layers[j].d*.271,1.38)};
});
console.log(JSON.stringify({cases,highQ}));
