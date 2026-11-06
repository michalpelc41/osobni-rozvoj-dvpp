const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../docs/attachments.js'),'utf8').replaceAll('export ','');
const nodes={};const calls=[];let rows=[],uploadFails=false,sequence=0;
const node=s=>nodes[s]??=( {innerHTML:'',textContent:'',disabled:false,value:'',click(){},isConnected:true} );
const db={from(){return {
 select(){return {eq:()=>({order:async()=>({data:[...rows],error:null})})};},
 insert(row){return {select:()=>({single:async()=>{const r={...row,object_path:'owner/activity/'+row.id};rows.push(r);calls.push('reserve');return {data:r};}})};},
 delete(){return {eq:(_key,id)=>({select:async()=>{rows=rows.filter(r=>r.id!==id);calls.push('delete-row');return {data:[{id}]};}})};}
};},storage:{from(){return {upload:async()=>{calls.push('upload');return {error:uploadFails?{}:null};},remove:async()=>{calls.push('delete-file');return {error:null};}};}}};
const context={document:{querySelector:node,querySelectorAll:()=>[],addEventListener(_type,fn){context.click=fn;}},crypto:{randomUUID:()=>String(++sequence)},Intl,Map,Set,URL,setTimeout};
vm.createContext(context);vm.runInContext(source,context);
const ctl=context.createAttachmentController({getDb:()=>db,getUser:()=>({id:'owner'}),isDemo:()=>false,onError:()=>{}});
const file=(name,size=10)=>({name,size});
function select(files){node('#attachmentInput').onchange({target:{files,value:''}});}
(async()=>{
 assert.match(context.validateAttachment(file('script.html')),/Podporované/);
 assert.match(context.validateAttachment(file('large.pdf',21*1024*1024)),/20 MB/);
 assert.match(context.validateAttachment(file('empty.pdf',0)),/Prázdný/);
 assert.equal(context.validateAttachment(file('Příloha.DOCX')),'');
 assert.match(context.attachmentRows([{id:'a',filename:'<script>.pdf',size_bytes:1}]),/&lt;script&gt;/);
 await ctl.open('activity');select([file('same.pdf'),file('same.pdf')]);assert.equal(ctl.count,2);assert.equal(rows.length,0,'selection must not upload');
 uploadFails=true;await assert.rejects(ctl.save('activity'),/nepodařilo nahrát/);assert.equal(rows.length,0);assert.equal(ctl.count,2,'failed upload remains available for retry');
 uploadFails=false;await ctl.save('activity');assert.equal(rows.length,2);assert.equal(ctl.count,2);
 await ctl.open('activity');select(Array.from({length:5},(_,i)=>file(i+'.pdf')));assert.equal(ctl.count,5,'client count limit includes existing files');
 await ctl.open('activity');assert.equal(ctl.count,2,'reopening cancels unsaved selections');
 context.click({target:{closest:s=>s==='[data-remove-attachment]'?{dataset:{removeAttachment:rows[0].id}}:null}});
 assert.equal(rows.length,2,'removal is deferred until Save');await ctl.save('activity');assert.equal(rows.length,1);assert.deepEqual(calls.slice(-2),['delete-file','delete-row']);
 ctl.setDisabled(true);select([file('future.pdf')]);assert.equal(ctl.count,1);
 console.log('PASS validation, escaping, deferred upload/removal, duplicate names, failed-upload cleanup/retry, count limits and future-date lock');
})().catch(e=>{console.error(e);process.exitCode=1;});
