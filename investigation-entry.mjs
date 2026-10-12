// Presentation of an addressable investigation. Persistence, live-attempt
// discovery and recording are supplied by the shared investigation owner.
export function createInvestigationEntry({document,investigation,url,actions={}}) {
  if(!investigation?.id || !url)throw Error('Investigation identity and return link are required');
  const make=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
  const node=make('section');node.className='investigation-guide investigation-entry';
  node.setAttribute('aria-label','Investigation');node.setAttribute('data-investigation',investigation.id);
  const title=make('h3',investigation.title||investigation.guide?.question||'Investigation');
  const link=make('a','Return to this investigation');link.href=url;
  node.append(title,link);
  for(const [label,key] of [['Try This','tryThis'],['Why This Matters','whyThisMatters']]){
    const text=investigation.guide?.[key];if(!text)continue;
    const details=make('details');details.append(make('summary',label),make('p',text));node.append(details);
  }
  const status=make('output');status.setAttribute('aria-live','polite');
  const start=make('button','Start new water'),returnToLive=make('button','Return to live water');
  const note=make('textarea');note.setAttribute('aria-label','Your observation');note.placeholder='Your observation';note.value=investigation.note||'';
  const saveNote=make('button','Save note'),capture=make('button','Capture'),finish=make('button','Finish');
  for(const button of [start,returnToLive,saveNote,capture,finish])button.type='button';
  const commands=make('div');commands.append(start,returnToLive);
  const recordCommands=make('div');recordCommands.append(saveNote,capture,finish);
  const history=make('div');history.setAttribute('aria-label','Retained observations');
  node.append(status,commands,note,recordCommands,make('h4','Retained observations'),history);
  let attempt=null,busy=false,finished=false;
  function controls(){
    const live=attempt?.state==='live',owned=live&&attempt.owned===true;
    start.disabled=busy||live||typeof actions.start!=='function';
    returnToLive.hidden=!live||owned;returnToLive.disabled=busy||typeof actions.returnToLive!=='function';
    saveNote.disabled=busy||typeof actions.saveNote!=='function';
    capture.disabled=busy||!owned||finished||typeof actions.capture!=='function';
    finish.disabled=busy||!owned||finished||typeof actions.finish!=='function';
  }
  const run=async action=>{
    if(busy)return;busy=true;controls();
    try{const result=await action();if(result?.message)status.textContent=result.message;return result;}
    catch(error){status.textContent=`Save/return failed: ${error.message||error}`;}
    finally{busy=false;controls();}
  };
  function setAttempt(value){
    if(value&&!['live','lost','finished'].includes(value.state))throw Error('Unknown investigation attempt state');
    attempt=value;finished=value?.state==='finished';
    status.textContent=value?.state==='live'?(value.owned?'Recording this live water':'Live water is open in another page'):
      value?.state==='lost'?'The previous water runtime has ended. Retained observations remain available.':
      value?.state==='finished'?'Investigation recording retained':'Open the retained investigation, or start a new water attempt.';
    controls();
  }
  start.onclick=()=>!start.disabled&&run(()=>actions.start());
  returnToLive.onclick=()=>!returnToLive.disabled&&run(()=>actions.returnToLive(attempt));
  saveNote.onclick=()=>!saveNote.disabled&&run(()=>actions.saveNote(note.value));
  capture.onclick=()=>!capture.disabled&&run(()=>actions.capture(note.value));
  finish.onclick=()=>!finish.disabled&&run(async()=>{const result=await actions.finish(note.value);finished=true;return result;});
  function setCaptures(captures){
    history.replaceChildren();
    for(const observation of captures||[]){
      const row=make('p'),label=observation.note||observation.label||'Retained view';
      if(observation.url){const a=make('a',label);a.href=observation.url;row.append(a);}else row.textContent=label;
      history.append(row);
    }
  }
  setCaptures(investigation.captures);setAttempt(null);
  return {node,nodes:{link,status,start,returnToLive,note,saveNote,capture,finish,history},setAttempt,setCaptures};
}
