import {createEditCritic} from './authoring-image-history.mjs';

// History-local controls share the application's helper lifecycle and queue UI.
export function installEditCritic({document,history,operation,imageController,onAdopt}){
 const critic=createEditCritic({history,operation}),host=document.createElement('section');host.className='asset-edit-review';
 host.innerHTML=`<button type="button" id="asset-review-edit" title="Compare this saved edit with its original and your request">Review edit</button><div id="asset-review-status" role="status"></div><div id="asset-review-assessment" style="white-space:pre-wrap"></div><label id="asset-review-correction-label" hidden>Suggested next edit<textarea id="asset-review-correction" rows="4"></textarea></label><button type="button" id="asset-review-use" hidden>Use for next edit</button>`;
 document.getElementById('asset-image-history').insertAdjacentElement('afterend',host);
 const by=id=>document.getElementById(id);let error='',painted=null,reviewSource=null;
 function render(){
  const entry=history.read().viewed,review=entry?.editReview,state=operation.read(),busy=operation.busy()||imageController.busy()||!!imageController.read().pending;
  let reason='';try{critic.request();}catch(e){reason=e.message;}
  by('asset-review-edit').disabled=busy||!!reason;
  by('asset-review-status').textContent=error||(state.request?.task==='critique'&&operation.busy()?(state.error||state.progress):review?.status==='partial'?'Review stopped before completion; full output retained below.':review?.status==='unstructured'?'The helper did not separate an assessment from a correction. Review the full response below.':review?.status==='complete'&&!review.correction?'The critic proposed no further edit.':reason||'');
  by('asset-review-assessment').textContent=(review?.status==='complete'?review.assessment:review?.raw?.text)||'';
  const key=JSON.stringify([entry?.source,review?.createdAt]);
  if(key!==painted){painted=key;reviewSource=entry?.source;by('asset-review-correction').value=review?.correction||'';}
  const editable=review?.status==='complete'&&!!review.correction;
  by('asset-review-correction-label').hidden=!editable;by('asset-review-correction').disabled=busy;
  by('asset-review-use').hidden=!editable;by('asset-review-use').disabled=busy||!by('asset-review-correction').value.trim();
 }
 async function review(){error='';try{return await critic.review({admission:by('asset-prompt-outside-queue')?.checked?'outside':'queue'});}catch(e){error=e.message;return null;}finally{render();}}
 function adopt(){error='';try{const text=by('asset-review-correction').value,entry=critic.adopt(reviewSource,text);onAdopt(entry,text);return true;}catch(e){error=e.message;return false;}finally{render();}}
 by('asset-review-edit').onclick=review;by('asset-review-use').onclick=adopt;by('asset-review-correction').oninput=render;
 render();return{render,review,adopt};
}
