export const ATTACHMENT_BUCKET='dvpp-reflections';
export const MAX_ATTACHMENT_SIZE=20*1024*1024;
export const attachmentTypes={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',gif:'image/gif',webp:'image/webp',pdf:'application/pdf',doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',ppt:'application/vnd.ms-powerpoint',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',xls:'application/vnd.ms-excel',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',txt:'text/plain'};
const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ext=name=>name.split('.').pop().toLowerCase();
export function validateAttachment(file){
 if(!attachmentTypes[ext(file.name)])return 'Podporované jsou obrázky JPG, PNG, GIF a WebP, PDF, Word, PowerPoint, Excel a textové soubory.';
 if(!file.size)return 'Prázdný soubor nelze přiložit.';
 if(file.size>MAX_ATTACHMENT_SIZE)return 'Každý soubor může mít nejvýše 20 MB.';
 if(file.name.length>255)return 'Název souboru může mít nejvýše 255 znaků.';
 return '';
}
export function attachmentIcon(name){
 const extension=ext(name),image=['jpg','jpeg','png','gif','webp'].includes(extension);
 const kind=image?'image':extension==='pdf'?'pdf':['doc','docx'].includes(extension)?'word':['ppt','pptx'].includes(extension)?'powerpoint':['xls','xlsx'].includes(extension)?'excel':'file';
 const drawing=image?'<rect x="3" y="4" width="18" height="16" rx="1"/><circle cx="8" cy="9" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/>':'<path d="M5 2h9l5 5v15H5Z"/><path d="M14 2v6h5"/>';
 const letter={pdf:'PDF',word:'W',powerpoint:'P',excel:'X',file:''}[kind];
 return `<svg class="attachment-icon ${kind}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true">${drawing}${letter?`<text x="12" y="17" text-anchor="middle" fill="currentColor" stroke="none" font-family="Arial,sans-serif" font-weight="bold" font-size="${letter==='PDF'?6.5:10}">${letter}</text>`:''}</svg>`;
}
export function fileSize(bytes){return new Intl.NumberFormat('cs-CZ',{maximumFractionDigits:1}).format(bytes>=1048576?bytes/1048576:Math.max(1,bytes/1024))+(bytes>=1048576?' MB':' kB');}
const trash='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg>';
export function attachmentRows(rows,{editable=false,pending=false}={}){
 return rows.map(f=>`<li class="attachment-row">${attachmentIcon(f.filename)}<button type="button" class="attachment-name" ${pending?'disabled':`data-download-attachment="${escapeHtml(f.id)}"`}>${escapeHtml(f.filename)}</button><span class="attachment-size">${fileSize(f.size_bytes)}${pending?' · připraveno':''}</span>${editable?`<button type="button" class="attachment-remove" data-remove-attachment="${escapeHtml(f.id)}" aria-label="Odebrat přílohu ${escapeHtml(f.filename)}" title="Odebrat přílohu">${trash}</button>`:''}</li>`).join('');
}
export function createAttachmentController({getDb,getUser,isDemo,onError}){
 let saved=[],pending=[],removed=new Set(),disabled=false,busy=false,loading=false,loadFailed=false,revision=0;
 const demoFiles=new Map(),demoRows=new Map(),downloads=new Map();
 const $=s=>document.querySelector(s);
 function render(){
  $('#attachmentList').innerHTML=attachmentRows(saved.filter(f=>!removed.has(f.id)),{editable:true})+attachmentRows(pending.map(p=>p.row),{editable:true,pending:true});
  $('#addAttachment').disabled=disabled||busy||loading||loadFailed||saved.length-removed.size+pending.length>=5;
  $('#attachmentInput').disabled=disabled||busy||loading||loadFailed;
  document.querySelectorAll('#attachmentList .attachment-remove').forEach(b=>b.disabled=disabled||busy||loading||loadFailed);
 }
 async function rowsFor(activityId){
  if(!activityId)return [];
  if(isDemo())return demoRows.get(activityId)||[];
  const {data,error}=await getDb().from('dvpp_attachments').select('*').eq('activity_id',activityId).order('created_at');
  if(error)throw Error('Přílohy se nepodařilo načíst. Zkuste formulář otevřít znovu.');
  return data;
 }
 async function open(activityId){
  const token=++revision;loading=true;loadFailed=false;saved=[];pending=[];removed=new Set();$('#attachmentError').textContent='';render();
  try{const rows=await rowsFor(activityId);if(token!==revision)return;saved=rows;rows.forEach(f=>downloads.set(f.id,f));}
  catch(e){if(token===revision){loadFailed=true;$('#attachmentError').textContent=e.message;}}
  finally{if(token===revision){loading=false;render();}}
 }
 function select(files){
  if(disabled||busy||loading||loadFailed)return;
  $('#attachmentError').textContent='';
  for(const file of files){
   const error=validateAttachment(file);
   if(error){$('#attachmentError').textContent=`${file.name}: ${error}`;continue;}
   if(saved.length-removed.size+pending.length>=5){$('#attachmentError').textContent='K aktivitě lze přidat nejvýše 5 příloh.';break;}
   pending.push({file,row:{id:crypto.randomUUID(),filename:file.name,size_bytes:file.size,mime_type:attachmentTypes[ext(file.name)]}});
  }
  render();
 }
 async function removeStored(f){
  const {error}=await getDb().storage.from(ATTACHMENT_BUCKET).remove([f.object_path]);
  if(error)throw Error(`Přílohu „${f.filename}“ se nepodařilo odebrat.`);
  const result=await getDb().from('dvpp_attachments').delete().eq('id',f.id).select('id');
  if(result.error||!result.data?.length)throw Error(`Záznam přílohy „${f.filename}“ se nepodařilo odebrat.`);
 }
 async function save(activityId){
  if(loading)throw Error('Počkejte na načtení příloh.');
  if(loadFailed)throw Error('Přílohy se nepodařilo načíst. Znovu otevřete formulář.');
  if(disabled&&(pending.length||removed.size))throw Error('Přílohy lze upravovat až po absolvování aktivity.');
  busy=true;render();
  try{
   for(const id of [...removed]){
    const f=saved.find(f=>f.id===id);
    if(!isDemo())await removeStored(f);else demoFiles.delete(id);
    saved=saved.filter(f=>f.id!==id);removed.delete(id);
   }
   for(const item of [...pending]){
    let row={...item.row,activity_id:activityId,user_id:getUser().id};
    if(isDemo())demoFiles.set(row.id,item.file);
    else{
     const result=await getDb().from('dvpp_attachments').insert(row).select('*').single();
     if(result.error)throw Error(`Přílohu „${row.filename}“ nelze přidat. Ověřte oprávnění a limit příloh.`);
     row=result.data;
     const {error}=await getDb().storage.from(ATTACHMENT_BUCKET).upload(row.object_path,item.file,{contentType:row.mime_type,upsert:false});
     if(error){
      // Keep a failed upload pending for retry; release its reserved metadata slot.
      const cleanup=await getDb().from('dvpp_attachments').delete().eq('id',row.id).select('id');
      if(cleanup.error||!cleanup.data?.length){saved.push(row);pending=pending.filter(p=>p!==item);throw Error(`Nahrání „${row.filename}“ nebylo potvrzeno. Před opakováním soubor odeberte a znovu přidejte.`);}
      throw Error(`Soubor „${row.filename}“ se nepodařilo nahrát. Aktivita je uložená; přílohu můžete zkusit uložit znovu.`);
     }
    }
    saved.push(row);downloads.set(row.id,row);pending=pending.filter(p=>p!==item);
   }
  }finally{if(isDemo())demoRows.set(activityId,[...saved]);busy=false;render();}
 }
 async function download(id){
  const row=downloads.get(id)||saved.find(f=>f.id===id);if(!row)return;
  let blob;
  if(isDemo())blob=demoFiles.get(id);
  else{const result=await getDb().storage.from(ATTACHMENT_BUCKET).download(row.object_path);if(result.error)throw Error('Přílohu se nepodařilo stáhnout. Zkontrolujte přihlášení a zkuste to znovu.');blob=result.data;}
  if(!blob)throw Error('Soubor v ukázkovém režimu již není dostupný.');
  const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=row.filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
 }
 async function showDetail(activityId,target){
  target.textContent='Načítání příloh…';
  try{const rows=await rowsFor(activityId);if(!target.isConnected)return;rows.forEach(f=>downloads.set(f.id,f));target.innerHTML=rows.length?`<p class="detailtitle">Přílohy</p><ul class="attachment-list">${attachmentRows(rows)}</ul>`:'';}
  catch{if(target.isConnected)target.textContent='Přílohy se nepodařilo načíst. Otevřete detail znovu.';}
 }
 async function removeAll(activityId){
  const rows=await rowsFor(activityId);
  for(const f of rows){if(isDemo())demoFiles.delete(f.id);else await removeStored(f);}
  if(isDemo())demoRows.delete(activityId);
 }
 $('#addAttachment').onclick=()=>$('#attachmentInput').click();
 $('#attachmentInput').onchange=e=>{select(e.target.files);e.target.value='';};
 document.addEventListener('click',e=>{
  const remove=e.target.closest('[data-remove-attachment]');
  if(remove&&!disabled&&!busy&&!loading){const id=remove.dataset.removeAttachment;pending=pending.filter(p=>p.row.id!==id);if(saved.some(f=>f.id===id))removed.add(id);render();}
  const button=e.target.closest('[data-download-attachment]');
  if(button){button.disabled=true;download(button.dataset.downloadAttachment).catch(e=>onError(e.message)).finally(()=>button.disabled=false);}
 });
 return {open,save,showDetail,removeAll,setDisabled(value){disabled=value;render();},get loading(){return loading;},get count(){return saved.length-removed.size+pending.length;},get changes(){return pending.length>0||removed.size>0;}};
}
