import test from 'node:test';
import assert from 'node:assert/strict';
import {frameDuration, insertedLayerId, insertionDetail} from '../src/presentation.js';
import {Worker} from 'node:worker_threads';
import {synthesize} from '../src/optimizer.js';

test('needle insertion remains on screen long enough to follow; Fast bypasses holds', () => {
  assert.ok(frameDuration('needle-insertion',180) >= 1800);
  assert.ok(frameDuration('needle-insertion',700) >= 3000);
  assert.ok(frameDuration('refinement',180) >= 250);
  for (const stage of ['initial','refinement','needle-scan','needle-insertion','growth','cleanup','final','done']) assert.equal(frameDuration(stage,0),0);
});

test('insertion focus selects the needle rather than the newly named host remnant', () => {
  const before = {layers:[{id:'host',material:'L',n:1.46,d:100}]};
  const after = {stage:'needle-insertion',needle:{best:{material:'H'}},layers:[{id:'host',material:'L',n:1.46,d:49},{id:'new',material:'H',n:2.1,d:2},{id:'host-split-new',material:'L',n:1.46,d:49}]};
  assert.equal(insertedLayerId(before,after),'new');
  const focus = insertionDetail(after.layers,'new');
  assert.equal(focus.center,50);
  assert.equal(focus.left,43);
  assert.equal(focus.right,57);
  assert.ok(Math.abs(focus.segments.reduce((sum,layer)=>sum+layer.fraction,0)-1)<1e-12);
  assert.equal(focus.segments.filter(layer=>layer.selected).length,1);
  assert.equal(focus.segments[1].fraction,1/7);
});

test('magnified insertion detail remains inside the coating at either surface', () => {
  const layers=[{id:'first',material:'H',d:1},{id:'middle',material:'L',d:100},{id:'last',material:'H',d:1}];
  assert.equal(insertionDetail(layers,'first').left,0);
  assert.equal(insertionDetail(layers,'last').right,102);
  assert.equal(insertionDetail(layers,'missing'),null);
});

test('worker pause freezes stage delivery and pacing leaves the final numerical solution unchanged', {timeout:10000}, async () => {
  const source = `import {parentPort} from 'node:worker_threads';
    globalThis.self={postMessage:message=>parentPort.postMessage(message)};
    await import(${JSON.stringify(new URL('../src/worker.js',import.meta.url).href)});
    parentPort.on('message',data=>self.onmessage({data}));parentPort.postMessage({type:'ready'});`;
  const worker=new Worker(new URL(`data:text/javascript,${encodeURIComponent(source)}`));
  const messages=[];
  const waiting=[];
  worker.on('message',message=>{messages.push(message);for(const listener of [...waiting])listener(message);});
  const next=type=>new Promise((resolve,reject)=>{
    const listener=message=>{if(message.type==='error')reject(Error(message.message));if(message.type===type){waiting.splice(waiting.indexOf(listener),1);resolve(message);}};
    waiting.push(listener);
  });
  try{
    await next('ready');
    const wavelengths=Array.from({length:11},(_,i)=>450+i*20);
    const config={nL:1.46,nH:2.1,ns:1.52,wavelengths,target:wavelengths.map(()=>.95),maxLayers:13,maxOpticalThickness:2500,targetMerit:1e-4,startMaterial:'H',startThickness:100,maxCycles:1,maxNeedlesPerCycle:2,maxRefinementIterations:12};
    const initial=next('snapshot');worker.postMessage({type:'start',config,pace:180});await initial;
    worker.postMessage({type:'pause'});
    await new Promise(resolve=>setTimeout(resolve,700));
    assert.equal(messages.filter(message=>message.type==='snapshot').length,1,'pause must hold the current physical stage');
    const complete=next('complete');worker.postMessage({type:'pace',pace:0});worker.postMessage({type:'resume'});await complete;
    const actual=messages.filter(message=>message.type==='snapshot').at(-1).snapshot;
    let expected;for await(const snapshot of synthesize(config))expected=snapshot;
    assert.equal(actual.stage,'done');
    assert.equal(actual.merit,expected.merit);
    assert.deepEqual(actual.layers,expected.layers);
    assert.deepEqual(actual.R,expected.R);
  }finally{await worker.terminate();}
});
