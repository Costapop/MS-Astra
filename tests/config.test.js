import test from 'node:test';import assert from 'node:assert/strict';
import {validate,targetAt,grid,PRESETS} from '../src/config.js';
const c={lambdaMin:400,lambdaMax:800,points:121,maxLayers:24,maxCycles:8,nL:1.46,nH:2.1,startMaterial:'H',startThickness:100,maxOpticalThickness:6000,targetMerit:.0001,cleanupThickness:.5};
test('uniform spectral grid includes both endpoints',()=>assert.deepEqual(grid(400,800,5),[400,500,600,700,800]));
test('piecewise target is right continuous at boundaries',()=>{assert.equal(targetAt(599,400,800,PRESETS.edge),.02);assert.equal(targetAt(600,400,800,PRESETS.edge),.95);assert.equal(targetAt(800,400,800,PRESETS.edge),.95);});
test('validation rejects impossible budgets and malformed controls',()=>{assert.doesNotThrow(()=>validate(c,PRESETS.mirror));for(const bad of [{lambdaMin:800},{points:2},{maxLayers:2.5},{nH:1.38},{maxOpticalThickness:100},{targetMerit:NaN},{cleanupThickness:-1}])assert.throws(()=>validate({...c,...bad},PRESETS.mirror));assert.throws(()=>validate(c,[{end:.4,R:.5},{end:.3,R:.5}]));});
