export function createInvestigationGuide({document, question, tryThis, whyThisMatters, onCapture, onFinish}) {
  const node = document.createElement('section');
  node.className = 'investigation-guide';
  node.style.cssText = 'display:grid;gap:8px;padding:12px 0;min-width:0;overflow-wrap:anywhere';
  const title = document.createElement('h3');
  title.textContent = question;
  title.style.cssText = 'font-size:14px;margin:0';
  node.append(title);
  for (const [label, text] of [['Try This', tryThis], ['Why This Matters', whyThisMatters]]) {
    const details = document.createElement('details');
    const summary = document.createElement('summary'); summary.textContent = label;
    const body = document.createElement('p'); body.textContent = text;
    body.style.cssText = 'margin:8px 0';
    details.append(summary, body); node.append(details);
  }
  const note = document.createElement('textarea');
  note.placeholder = 'Your observation'; note.setAttribute('aria-label', 'Your observation');
  note.style.cssText = 'box-sizing:border-box;width:100%;min-height:64px;resize:vertical';
  const commands = document.createElement('div');
  commands.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
  const capture = document.createElement('button'); capture.textContent = 'Capture';
  const finish = document.createElement('button'); finish.textContent = 'Finish';
  const status = document.createElement('output');
  status.setAttribute('aria-live', 'polite'); status.textContent = 'Recording';
  commands.append(capture, finish); node.append(note, commands, status);
  let busy = false, stopped = false, frozen = false;
  const run = async action => {
    if (busy || stopped) return;
    busy = true; capture.disabled = finish.disabled = true;
    try {
      const result = await action(note.value);
      status.textContent = result.message;
    } catch (error) {status.textContent = `${frozen ? 'Recording stopped; save failed' : 'Capture/return failed'}: ${error.message || error}`;}
    finally {busy = false; capture.disabled = stopped || frozen; finish.disabled = stopped;}
  };
  capture.onclick = () => run(onCapture);
  finish.onclick = () => run(async value => {
    const result = await onFinish(value); stopped = true; return result;
  });
  return {node, freeze(message) {
    frozen = true; capture.disabled = true; status.textContent = message;
  }, saveFailed(message) {
    frozen = true; capture.disabled = true; finish.disabled = false;
    finish.textContent = 'Retry Save'; status.textContent = message;
  }, disconnect(message = 'Recording disconnected') {
    stopped = true; capture.disabled = finish.disabled = true; status.textContent = message;
  }};
}
