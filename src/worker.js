import { synthesize } from './optimizer.js';
let paused=false,stopped=false,pace=180;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
self.onmessage=async({data})=>{
  if(data.type==='pause'){paused=true;return;}
  if(data.type==='resume'){paused=false;return;}
  if(data.type==='pace'){pace=data.pace;return;}
  if(data.type==='stop'){stopped=true;return;}
  if(data.type!=='start')return;
  stopped=false;paused=false;pace=data.pace;
  try{
    let previousStage='', pending=null, shownMerit=Infinity, refinementCount=0;
    for await(const snapshot of synthesize(data.config)){
      while(paused&&!stopped)await wait(50);
      if(stopped)break;
      // Every physical stage is shown; small consecutive LM updates are batched
      // for animation only. The solver still evaluates and retains every step.
      if(snapshot.stage==='refinement'||snapshot.stage==='final'){
        refinementCount++;
        const relative=Math.abs(shownMerit-snapshot.merit)/Math.max(shownMerit,1e-14);
        if(snapshot.stage===previousStage&&refinementCount%6!==0&&relative<.04){pending=snapshot;continue;}
      }else if(pending){self.postMessage({type:'snapshot',snapshot:pending});pending=null;}
      self.postMessage({type:'snapshot',snapshot});
      previousStage=snapshot.stage;shownMerit=snapshot.merit;pending=null;
      await wait(snapshot.stage==='refinement'||snapshot.stage==='final'?Math.min(pace,90):pace);
    }
    self.postMessage({type:stopped?'stopped':'complete'});
  }catch(error){self.postMessage({type:'error',message:error.message});}
};
