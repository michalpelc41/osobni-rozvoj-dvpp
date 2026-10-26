const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const source=fs.readFileSync(require('node:path').join(__dirname,'../docs/app.js'),'utf8');
const logic=source.slice(source.indexOf('function clearSignedInView(){'),source.indexOf("window.addEventListener('storage'"));
async function check(name,signOut,{storageFails=false,timeout=false}={}){
 const key='sb-test-auth-token';
 const values=new Map([[key,'test-session'],[key+'-code-verifier','test-verifier'],[key+'-user','test-user'],['unrelated','keep']]);
 const nodes={};const node=selector=>nodes[selector]??=( {disabled:false,textContent:'',reset(){this.resetCalled=true},replaceChildren(){this.cleared=true}} );
 let calls=0,reloads=0,rendered=false;
 const context={signingOut:false,loadRevision:1,user:{id:'test'},activities:[{id:'test'}],profiles:[{id:'test'}],authStorageKey:key,
 $:node,updateOwners(){},render(){rendered=true},
 db:{auth:{signOut(options){calls++;assert.equal(options.scope,'local');return signOut()}}},
 localStorage:{removeItem(k){if(storageFails)throw Error('Storage blocked');values.delete(k)},getItem:k=>values.get(k)??null},
 location:{origin:'https://example.test',pathname:'/',replace(url){assert.equal(url,'https://example.test/');reloads++}},
 setTimeout(fn){if(timeout)queueMicrotask(fn);return 1},clearTimeout(){}
 };
 vm.createContext(context);vm.runInContext(logic,context);
 const pending=context.signOutCurrentBrowser();
 assert.equal(context.user,null);assert.equal(context.activities.length,0);assert.equal(context.profiles.length,0);assert.equal(rendered,true);
 await Promise.all([pending,context.signOutCurrentBrowser()]);
 assert.equal(calls,1);assert.equal(values.get('unrelated'),'keep');
 if(storageFails){assert.equal(reloads,0);assert.match(node('#authError').textContent,/nedovolil/)}
 else{assert.equal(values.has(key),false);assert.equal(values.has(key+'-code-verifier'),false);assert.equal(values.has(key+'-user'),false);assert.equal(reloads,1)}
 console.log('PASS '+name);
}
(async()=>{
 await check('successful local logout',async()=>({error:null}));
 await check('missing server session still clears local login',async()=>({error:{code:'session_not_found',status:403}}));
 await check('network rejection still clears local login',async()=>{throw Error('Network unavailable')});
 await check('synchronous SDK error still clears local login',()=>{throw Error('SDK unavailable')});
 await check('hung logout has bounded fallback',()=>new Promise(()=>{}),{timeout:true});
 await check('blocked storage never reports successful logout',async()=>({error:null}),{storageFails:true});
})().catch(error=>{console.error(error);process.exitCode=1});
