// kaminos-test: node
import test from 'node:test';
import assert from 'node:assert/strict';
const module=await import('../scene-resource-finalizers.mjs').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;});
test('producer finalization is exclusive, asynchronous and exactly once including rejection',async()=>{
 assert.equal(typeof module.createSceneResourceFinalizers,'function','application final retirement must preserve producer resource authority');
 const errors=[],registry=module.createSceneResourceFinalizers({onError:error=>errors.push(error)}),root={};let calls=0,finish;
 registry.register(root,()=>{++calls;return new Promise(resolve=>{finish=resolve;});});
 assert.equal(registry.canRestore(root),true);assert.throws(()=>registry.register(root,()=>{}),/already/);
 const one=registry.retire(root);assert.equal(registry.retire(root),one);assert.equal(registry.canRestore(root),false);
 await Promise.resolve();assert.equal(calls,1);finish();await one;assert.equal(errors.length,0);
 const failed={},error=Error('drain failed');registry.register(failed,()=>{throw error;});
 const result=registry.retire(failed);await assert.rejects(result,/drain failed/);assert.equal(registry.retire(failed),result);assert.deepEqual(errors,[error]);
});
