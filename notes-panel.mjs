// Notes in the page: say something on the thing you mean, address it to an
// agent by name, and read the answers where you are looking. The session
// (createNotesSession) is separate from the DOM (installNotes) so it can be
// tested without a browser. See docs/notes.md.
import {addresseesIn, checkedAnchor, checkedPost, completeMention, foldNotes, formatRef, mentionQueryAt, mentionsIn, notesFor, parseAddressees,
  rankParticipants} from './notes-core.mjs';

export {mentionsIn};

const walk = (note, visit) => { visit(note); for (const reply of note.replies) walk(reply, visit); };
const involves = (note, name) => { let found = false; walk(note, item => { if (item.author === name || (item.recipients ?? []).includes(name)) found = true; }); return found; };

export function createNotesSession({transport, selection, entries, readView, writeView, select, sceneFile, capture,
  href = () => '', title = () => '', avatarOf = null, ownView = async () => true}) {
  let author = null, liveAfter = Infinity, maxKnown = 0, events = [], folded = foldNotes([]), presence = {listeners: [], pages: []};
  let participants = [], notifies = false;
  const listeningNow = () => new Set([...(presence.listeners ?? []).filter(row => row.waiting).map(row => row.name),
    ...participants.filter(person => person.listening).map(person => person.name)]);
  // Who a note reaches: names in the To field, and @mentions of people known here.
  const addressees = (text, to) => [...new Set([...parseAddressees(to), ...addresseesIn(text, participants.map(person => person.name)).recognized])];
  const known = new Set(), subscribers = new Set();
  const changed = () => { for (const subscriber of subscribers) subscriber(); };
  const entryOf = id => entries().find(entry => entry.id === id) ?? null;
  const selectedIds = () => {
    const current = selection() ?? {};
    return (current.memberIds?.length ? current.memberIds : current.ids ?? []).filter(id => !String(id).startsWith('@group:'));
  };

  // A point picked on an object anchors the note while that object stays the
  // selection; selecting anything else drops it.
  let point = null;
  function anchorFromSelection() {
    const current = selection() ?? {};
    const ids = selectedIds();
    const id = current.activeId && entryOf(current.activeId) ? current.activeId : ids.find(entryOf);
    const entry = id ? entryOf(id) : null;
    if (point && entry?.id !== point.id) point = null;
    if (point) return {...point};
    return entry ? {kind: 'object', id: entry.id, label: entry.label || entry.fileName || entry.id} : {kind: 'scene'};
  }

  async function picture() {
    try {
      const shot = await capture();
      if (shot?.blank) return {issue: 'The picture came back as one flat color, so none is attached'};
      if (typeof shot?.image === 'string') return {picture: {dataUrl: shot.image}};
      return {issue: 'No picture was available'};
    } catch (error) {
      return {issue: `No picture: ${error.message}`};
    }
  }

  // Where the person is, read at one moment: what a note is on, in which
  // scene, what is selected and the view.
  function situation() {
    const current = selection() ?? {};
    return {anchor: anchorFromSelection(), scene: sceneFile() || null, view: readView(),
      selection: {ids: selectedIds(), activeId: current.activeId ?? null}};
  }
  const close = (a, b) => typeof a === 'number' ? typeof b === 'number' && Math.abs(a - b) < 1e-4
    : Array.isArray(a) ? Array.isArray(b) && a.length === b.length && a.every((value, index) => close(value, b[index]))
      : a && typeof a === 'object' ? !!b && typeof b === 'object' && Object.keys({...a, ...b}).every(key => close(a[key], b[key]))
        : a === b;

  async function post({text = '', to = '', parent = null, kind = 'note', attachPicture = parent === null} = {}) {
    // The view and picture are the person's own: while something else has the
    // viewport camera, such as a sub taking a picture, they wait for it back.
    const kept = {issue: 'Something else kept the viewport camera, so no view or picture is attached'};
    let own = await ownView();
    let now = situation(), shot = {};
    if (!own) shot = kept;
    else if (attachPicture) {
      // The picture is taken over a few frames. If the person moves, selects or
      // changes scene meanwhile, it is taken again so the note and its picture
      // describe one moment; a view that keeps moving is refused, not mixed.
      // Something can also take the camera during the picture: then neither
      // the view nor the picture is the person's.
      for (let attempt = 1; ; attempt++) {
        shot = await picture();
        if (!(await ownView())) { own = false; shot = kept; break; }
        const after = situation();
        if (close(now, after)) break;
        if (attempt === 3) throw new Error('The view kept changing while the picture was taken, so nothing was posted. Your note is still here; post again once the view is still.');
        now = after;
      }
    }
    const context = {...(own ? {view: now.view} : {}), selection: now.selection, page: {href: href(), title: title()}};
    if (shot.issue) context.pictureIssue = shot.issue;
    const content = checkedPost({kind, text, to: addressees(text, to), parent,
      anchor: parent ? undefined : now.anchor, subject: {scene: now.scene}, context, picture: shot.picture ?? null});
    return transport.post(content);
  }

  return {
    get author() { return author; },
    get state() { return folded; },
    get presence() { return presence; },
    onChange(subscriber) { subscribers.add(subscriber); return () => subscribers.delete(subscriber); },
    anchorFromSelection,
    post,
    async copyRef() {
      const note = await post({kind: 'ref'});
      return {note, text: formatRef(note)};
    },
    hello(payload) {
      author = payload.author;
      // Everything up to the stream's starting point is backlog, not news.
      liveAfter = Math.max(Number(payload.lastSeq) || 0, maxKnown);
      changed();
    },
    receive(batch) {
      const fresh = batch.filter(event => !known.has(event.seq));
      if (!fresh.length) return [];
      for (const event of fresh) { known.add(event.seq); maxKnown = Math.max(maxKnown, event.seq); }
      events = [...events, ...fresh].sort((a, b) => a.seq - b.seq);
      folded = foldNotes(events);
      const notices = !author ? [] : fresh
        .filter(event => event.seq > liveAfter && event.type === 'note' && event.kind !== 'ref'
          && event.author !== author && (event.recipients ?? []).includes(author))
        .map(event => folded.notes.get(event.id)).filter(Boolean);
      changed();
      return notices;
    },
    setPresence(next) { presence = next; changed(); },
    setParticipants(list, {notifies: notifying = false} = {}) { participants = Array.isArray(list) ? list : []; notifies = !!notifying; changed(); },
    notifies() { return notifies; },
    setPoint(anchor) { point = anchor ? checkedAnchor(anchor) : null; changed(); },
    point() { return point ? {...point} : null; },
    // The scene object that stands for an agent: the avatar it registered, else
    // what the vantage says, else the sub piloted under its name. Null when
    // none of these is in the scene.
    avatarFor(name) {
      const registered = participants.find(person => person.name === name)?.avatar;
      for (const id of [registered, avatarOf?.(name), `vantage-${name}`]) if (id && entryOf(id)) return id;
      return null;
    },
    selectAvatar(name) {
      const object = this.avatarFor(name);
      if (object) select(object);
      return {name, object};
    },
    get participants() { return participants; },
    // Who a note being written would reach, and which @words reach no one.
    preview({text = '', to = ''} = {}) {
      let explicit = [];
      try { explicit = parseAddressees(to); } catch { explicit = []; }
      const {recognized, unknown} = addresseesIn(text, participants.map(person => person.name));
      const recipients = [...new Set([...explicit, ...recognized])].filter(name => name !== author);
      const listening = listeningNow();
      // With a notify command, the server tells each recipient who is not listening.
      return {recipients, listening: recipients.filter(name => listening.has(name)),
        notified: notifies ? recipients.filter(name => !listening.has(name)) : [], unknown};
    },
    suggestions(query) {
      const listening = listeningNow();
      return rankParticipants(participants.filter(person => person.name !== author)
        .map(person => ({...person, listening: listening.has(person.name)})), query);
    },
    unread() { return author ? notesFor(folded, author, {unseen: true}) : []; },
    threads() {
      const scene = sceneFile() || null;
      return folded.threads
        .filter(note => note.kind !== 'ref' && ((note.subject?.scene ?? null) === scene || (author && involves(note, author))))
        .sort((a, b) => a.seq - b.seq);
    },
    async markSeen(threadId) {
      const root = folded.notes.get(threadId);
      if (!root || !author) return null;
      const ids = [];
      walk(root, note => { if ((note.recipients ?? []).includes(author) && !note.receipts.seen[author]) ids.push(note.id); });
      return ids.length ? transport.receipt({type: 'seen', notes: ids}) : null;
    },
    setResolved(threadId, resolved) { return transport.receipt({type: resolved ? 'resolved' : 'reopened', notes: [threadId]}); },
    goTo(noteId) {
      const note = folded.notes.get(noteId);
      if (!note) return {found: false};
      const root = folded.notes.get(note.thread) ?? note;
      const view = root.context?.view;
      if (view) writeView(view);
      const object = ['object', 'point'].includes(root.anchor?.kind) ? root.anchor.id : null;
      const present = object ? !!entryOf(object) : false;
      if (present) select(object);
      return {found: true, viewRestored: !!view, object, present};
    },
  };
}

// --- DOM -------------------------------------------------------------------

const STYLE = `
.kn-root{position:absolute;inset:0;pointer-events:none;z-index:40;font:12px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#e0e0e0}
.kn-root button{font:inherit}
.kn-toggle{position:absolute;right:12px;bottom:30px;pointer-events:auto;padding:5px 10px;border:1px solid #3a4245;border-radius:6px;background:rgba(16,20,22,.94);color:#cfd8dc;cursor:pointer;box-shadow:0 4px 18px #0008}
.kn-toggle[data-unread]:not([data-unread="0"]){border-color:#f0d28a;color:#f0d28a}
.kn-drawer{position:absolute;top:52px;right:12px;bottom:58px;width:min(380px,calc(100% - 24px));display:flex;flex-direction:column;pointer-events:auto;border:1px solid #3a4245;border-radius:8px;background:rgba(16,20,22,.97);box-shadow:0 8px 28px #000a;overflow:hidden}
.kn-drawer[hidden]{display:none}
.kn-head{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid #2a3033}
.kn-head strong{font-size:12px}
.kn-listening{flex:1;min-width:0;color:#8fa3a8;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kn-close{border:0;background:none;color:#8fa3a8;cursor:pointer;font-size:14px}
.kn-compose{display:flex;flex-direction:column;gap:6px;padding:10px;border-top:1px solid #2a3033}
.kn-name{border:0;background:none;padding:0;font:inherit;font-weight:600;color:#cfd8dc;cursor:pointer}
.kn-name.kn-agent{color:#5fd3c8}
.kn-name:hover,.kn-name:focus-visible{text-decoration:underline}
.kn-mention{border:0;background:none;padding:0;font:inherit;color:#9fe6bd;cursor:pointer}
.kn-mention:hover,.kn-mention:focus-visible{text-decoration:underline}
.kn-anchor{font-size:11px;color:#9fe6bd}
.kn-compose input,.kn-compose textarea,.kn-replybox textarea{box-sizing:border-box;width:100%;padding:6px 8px;border:1px solid #333;border-radius:5px;background:#151a1c;color:#e0e0e0;font:inherit}
.kn-compose textarea{min-height:56px;resize:vertical}
.kn-row{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.kn-row label{display:flex;align-items:center;gap:4px;color:#9aa5a8;font-size:11px;margin-right:auto;white-space:nowrap;flex-shrink:0}
.kn-btn{padding:4px 10px;border:1px solid #3a4245;border-radius:5px;background:#202628;color:#cfd8dc;cursor:pointer;font-size:11px}
.kn-btn.primary{border-color:#3e7f73;background:#1d3a35;color:#bff3e4}
.kn-btn:disabled{opacity:.5;cursor:default}
.kn-status{min-height:14px;color:#8fa3a8;font-size:10px}
.kn-status[data-tone="error"]{color:#f29b8b}
.kn-threads{flex:1;overflow-y:auto;padding:6px 10px 12px}
.kn-drawer.kn-compact{overflow-y:auto}
.kn-drawer.kn-compact .kn-threads{flex:none;overflow:visible}
.kn-covering{padding:6px 10px;border-bottom:1px solid #2a3033;color:#f0d28a;font-size:10px}
.kn-empty{color:#7c878a;padding:12px 0;font-size:11px}
.kn-thread{border:1px solid #2a3033;border-radius:6px;margin:8px 0;padding:8px;background:#151a1c}
.kn-thread[data-resolved="true"]{opacity:.6}
.kn-thread[data-focus="true"]{border-color:#5fd3c8}
.kn-on{font-size:10px;color:#9fe6bd;margin-bottom:4px}
.kn-note{margin:4px 0}
.kn-replies{margin-left:10px;padding-left:8px;border-left:2px solid #2f3a3d}
.kn-meta{font-size:10px;color:#8fa3a8}
.kn-text{white-space:pre-wrap;word-break:break-word;margin:2px 0;font-size:12px;line-height:1.35}
.kn-pic{display:block;max-width:100%;max-height:150px;margin:4px 0;border:1px solid #2a3033;border-radius:4px;cursor:zoom-in}
.kn-receipts{font-size:10px;color:#7c878a}
.kn-unread{color:#f0d28a}
.kn-actions{display:flex;gap:4px;margin-top:6px;flex-wrap:wrap}
.kn-replybox{display:flex;flex-direction:column;gap:4px;margin-top:6px}
.kn-replybox[hidden]{display:none}
.kn-pins{position:absolute;inset:0;overflow:hidden}
.kn-pin{position:absolute;transform:translate(-50%,-100%);pointer-events:auto;min-width:18px;height:18px;padding:0 5px;border:1px solid #5fd3c8;border-radius:9px 9px 9px 2px;background:rgba(16,20,22,.92);color:#bff3e4;font-size:10px;line-height:16px;cursor:pointer;box-shadow:0 2px 8px #000a}
.kn-point-pin{transform:translate(-50%,-50%);min-width:12px;height:12px;padding:0;border-radius:6px;line-height:10px;text-align:center}
.kn-pin[data-unread="true"]{border-color:#f0d28a;color:#f0d28a}
.kn-reach{font-size:10px;color:#8fa3a8;min-height:12px;line-height:1.35}
.kn-reach[data-unknown="true"]{color:#f0d28a}
.kn-suggest{position:absolute;z-index:5;max-height:200px;overflow-y:auto;box-sizing:border-box;background:#151a1c;border:1px solid #3e7f73;border-radius:6px;box-shadow:0 8px 22px #000c;padding:3px 0}
.kn-suggest[hidden]{display:none}
.kn-suggest-item{padding:4px 8px;font-size:11px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kn-suggest-item b{color:#bff3e4;font-weight:600}
.kn-suggest-item[aria-selected="true"]{background:#1d3a35}
.kn-suggest-about{color:#8fa3a8}
.kn-toasts{position:absolute;top:52px;left:12px;max-width:max(220px,calc(100% - 430px));display:flex;flex-direction:column;gap:6px;align-items:flex-start}
.kn-toast{pointer-events:auto;max-width:100%;box-sizing:border-box;padding:8px 12px;border:1px solid #f0d28a;border-radius:6px;background:rgba(16,20,22,.97);color:#f3e2b3;cursor:pointer;box-shadow:0 6px 22px #000b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
`;

const randomPageId = window => `page-${(window.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, '')}`;

function element(document, tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// A picture of what the person sees, flagged when it is one flat color.
export async function capturePicture({capture, document}) {
  const shot = await capture();
  const image = new Image();
  image.src = shot.image;
  await image.decode();
  const probe = document.createElement('canvas');
  probe.width = probe.height = 24;
  const context = probe.getContext('2d', {willReadFrequently: true});
  context.drawImage(image, 0, 0, 24, 24);
  const data = context.getImageData(0, 0, 24, 24).data;
  let blank = true;
  for (let index = 4; index < data.length && blank; index += 4) {
    for (let channel = 0; channel < 3; channel++) if (Math.abs(data[index + channel] - data[channel]) > 3) { blank = false; break; }
  }
  return {...shot, blank};
}

/**
 * Join notes to the running application. `entries()` returns live scene
 * entries `{id,label,fileName,type,object}`; `selection()` returns
 * `{ids,memberIds,activeId}`; `capture()` resolves to `{image,width,height}`
 * of what the viewport shows.
 */
export function installNotes({THREE, document, window, viewport, camera, entries, selection, select, readView, writeView,
  sceneFile, capture, redraw = () => {}, endpoint = '/api/notes', linkedNote = null, ready = null, avatarOf = null, avoid = () => [],
  ownView = async () => true, pickAt = null}) {
  if (!document.getElementById('kaminos-notes-style')) {
    const style = element(document, 'style');
    style.id = 'kaminos-notes-style';
    style.textContent = STYLE;
    document.head.append(style);
  }
  const pageId = randomPageId(window);
  const transport = {token: null};
  const send = async (path, body) => {
    const response = await window.fetch(path, {method: 'POST', body: JSON.stringify(body),
      headers: {'Content-Type': 'application/json', 'X-Kaminos-Notes-Page': pageId, 'X-Kaminos-Notes-Token': transport.token ?? ''}});
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error || `Notes request failed (${response.status})`);
    return data;
  };
  transport.post = body => send(endpoint, body);
  transport.receipt = body => send(`${endpoint}/receipt`, body);
  const session = createNotesSession({transport, selection, entries, readView, writeView, select, sceneFile,
    capture: () => capturePicture({capture, document}), href: () => window.location.href, title: () => document.title, avatarOf,
    ownView: () => ownView({waiting: () => say("Waiting for a sub's picture to finish, so yours shows your view\u2026")})});

  // --- structure ---
  const root = element(document, 'div', 'kn-root');
  root.dataset.vantageIgnore = '';
  root.dataset.kaminosNotes = pageId;
  const pins = element(document, 'div', 'kn-pins');
  const toasts = element(document, 'div', 'kn-toasts');
  const toggle = element(document, 'button', 'kn-toggle', 'Notes');
  toggle.type = 'button';
  toggle.title = 'Notes on this scene (Shift+N)';
  toggle.setAttribute('aria-expanded', 'false');
  const drawer = element(document, 'aside', 'kn-drawer');
  drawer.hidden = true;
  drawer.setAttribute('aria-label', 'Notes');
  // Panels sharing the viewport's top right, such as an agent sub's, stay in
  // view. The drawer goes below them when that leaves room for a conversation,
  // beside them when the viewport is wide enough, below them scrolling as a
  // whole when there is a little room, and only when there is none over them,
  // saying so.
  const covering = element(document, 'div', 'kn-covering', "Too little room to keep the sub's panel in view; it is behind notes.");
  covering.hidden = true;
  const placeDrawer = () => {
    const host = viewport.getBoundingClientRect(), width = Math.min(380, host.width - 24);
    const panels = avoid().filter(panel => panel?.isConnected && !panel.hidden).map(panel => panel.getBoundingClientRect())
      .filter(rect => rect.width && rect.height && rect.left < host.right - 12 && rect.right > host.right - 12 - width);
    const below = Math.max(52, ...panels.map(rect => rect.bottom - host.top + 8));
    const beside = Math.max(12, ...panels.map(rect => host.right - rect.left + 8));
    const room = host.height - 58 - below;
    const place = !panels.length || room >= 240 ? {top: below, right: 12}
      : host.width - beside - 12 >= 280 ? {top: 52, right: beside}
        : room >= 120 ? {top: below, right: 12, compact: true}
          : {top: 52, right: 12, covering: true};
    drawer.style.top = `${Math.round(place.top)}px`;
    drawer.style.right = `${Math.round(place.right)}px`;
    drawer.style.width = place.right > 12 ? `${Math.round(Math.min(380, host.width - place.right - 12))}px` : '';
    drawer.classList.toggle('kn-compact', !!place.compact);
    covering.hidden = !place.covering;
  };
  const head = element(document, 'div', 'kn-head');
  const listening = element(document, 'span', 'kn-listening');
  const close = element(document, 'button', 'kn-close', '×');
  close.type = 'button';
  close.setAttribute('aria-label', 'Close notes');
  head.append(element(document, 'strong', '', 'Notes'), listening, close);
  const compose = element(document, 'div', 'kn-compose');
  const anchorLine = element(document, 'div', 'kn-anchor');
  const text = element(document, 'textarea');
  text.placeholder = 'Say what you see. Type @ to reach an agent.';
  text.setAttribute('aria-label', 'Note');
  const reach = element(document, 'div', 'kn-reach');
  reach.setAttribute('aria-live', 'polite');
  const to = element(document, 'input');
  to.placeholder = 'Also to @name, even one not listed yet';
  to.setAttribute('aria-label', 'Also address to');
  const row = element(document, 'div', 'kn-row');
  const attachLabel = element(document, 'label');
  const attach = element(document, 'input');
  attach.type = 'checkbox';
  attach.checked = true;
  attachLabel.append(attach, document.createTextNode('attach what I see'));
  const postButton = element(document, 'button', 'kn-btn primary', 'Post');
  postButton.type = 'button';
  const refButton = element(document, 'button', 'kn-btn', 'Copy ref');
  refButton.type = 'button';
  refButton.title = 'Copy a reference to paste into a terminal conversation';
  row.append(attachLabel, refButton, postButton);
  const status = element(document, 'div', 'kn-status');
  status.setAttribute('role', 'status');
  compose.append(anchorLine, text, reach, to, row, status);
  const threads = element(document, 'div', 'kn-threads');
  drawer.append(head, covering, threads, compose);
  root.append(pins, toasts, toggle, drawer);
  viewport.append(root);
  // The notes sit inside the viewport: a click, drag or scroll on them is not a
  // click on empty scene (which would clear the selection) or a camera gesture,
  // and typing in them is not an editor hotkey.
  for (const surface of [pins, toasts, toggle, drawer]) {
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'wheel']) {
      surface.addEventListener(type, event => event.stopPropagation());
    }
  }
  for (const type of ['keydown', 'keyup', 'keypress']) {
    drawer.addEventListener(type, event => { if (event.target.closest?.('input,textarea')) event.stopPropagation(); });
  }

  let focusThread = null;
  const say = (message, tone = '') => { status.textContent = message; status.dataset.tone = tone; };
  const anchorText = anchor => anchor?.kind === 'object' ? `"${anchor.label}"` : anchor?.kind === 'point' ? `a point of "${anchor.label}"` : 'the scene';
  const refreshAnchor = () => { anchorLine.textContent = `On ${anchorText(session.anchorFromSelection())}`; };

  const listeningNames = () => (session.presence.listeners ?? []).filter(row => row.waiting).map(row => row.name);
  const pageAuthors = () => (session.presence.pages ?? []).map(page => page.author);
  // Agents listen through tools/notes.mjs wait; people read in an open page.
  const deliveryText = note => (note.recipients ?? []).map(name => {
    if (note.receipts.seen[name]) return `${name}: seen`;
    if (note.receipts.delivered[name]) return `${name}: delivered`;
    const told = note.receipts.notified?.[name];
    if (told) return `${name}: ${told.ok ? 'notified' : 'notify failed'}`;
    if (listeningNames().includes(name)) return `${name}: listening`;
    if (pageAuthors().includes(name)) return `${name}: page open`;
    return `${name}: not seen yet`;
  }).join(' \u00b7 ');

  // A name selects that agent's avatar in the scene, when it has one there.
  function selectAvatarOf(name) {
    const {object} = session.selectAvatar(name);
    if (object) { redraw(); refreshAnchor(); say(`Selected @${name}'s avatar`); }
    else say(`@${name} has no avatar in this scene`);
  }
  function nameButton(name, className) {
    const button = element(document, 'button', className, name);
    button.type = 'button';
    button.title = `Select @${name}'s avatar`;
    button.addEventListener('click', () => selectAvatarOf(name));
    return button;
  }
  // Note text with each @mention of someone known here as a name to click.
  function textWithMentions(value) {
    const node = element(document, 'div', 'kn-text');
    const known = new Set(session.participants.map(person => person.name));
    let last = 0;
    for (const match of value.matchAll(/(^|[\s(,;])@([a-z0-9][a-z0-9._-]{0,63})/gi)) {
      const name = match[2].toLowerCase(), at = match.index + match[1].length;
      if (!known.has(name)) continue;
      const button = nameButton(name, 'kn-mention');
      button.textContent = `@${match[2]}`;
      node.append(document.createTextNode(value.slice(last, at)), button);
      last = at + 1 + match[2].length;
    }
    node.append(document.createTextNode(value.slice(last)));
    return node;
  }

  function noteNode(note, depth) {
    const node = element(document, 'div', 'kn-note');
    const meta = element(document, 'div', 'kn-meta');
    meta.append(nameButton(note.author, note.via === 'page' ? 'kn-name' : 'kn-name kn-agent'),
      document.createTextNode(` \u00b7 ${new Date(note.at).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}`));
    if (session.author && (note.recipients ?? []).includes(session.author) && !note.receipts.seen[session.author]) {
      meta.append(element(document, 'span', 'kn-unread', ' · new'));
    }
    node.append(meta);
    if (note.text) node.append(textWithMentions(note.text));
    if (note.picture) {
      const picture = element(document, 'img', 'kn-pic');
      picture.alt = `Picture with ${note.author}'s note`;
      picture.src = `${endpoint}/picture?note=${encodeURIComponent(note.id)}`;
      picture.addEventListener('click', () => window.open(picture.src, '_blank', 'noopener'));
      node.append(picture);
    }
    if (note.context?.pictureIssue) node.append(element(document, 'div', 'kn-receipts', note.context.pictureIssue));
    const receipts = deliveryText(note);
    if (receipts) node.append(element(document, 'div', 'kn-receipts', `to ${receipts}`));
    if (note.replies.length) {
      const replies = element(document, 'div', 'kn-replies');
      for (const reply of note.replies) replies.append(noteNode(reply, depth + 1));
      node.append(replies);
    }
    return node;
  }

  // @ suggestions in the note, reply and To fields: names known here, the ones
  // listening now first. Arrows move, Tab or Enter completes, Escape closes.
  const suggest = element(document, 'div', 'kn-suggest');
  suggest.id = `kn-suggest-${pageId}`;
  suggest.hidden = true;
  suggest.setAttribute('role', 'listbox');
  suggest.setAttribute('aria-label', 'People to mention');
  drawer.append(suggest);
  let suggesting = null;
  const markSuggestion = () => {
    [...suggest.children].forEach((item, index) => item.setAttribute('aria-selected', String(index === suggesting.index)));
    suggest.children[suggesting.index]?.scrollIntoView({block: 'nearest'});
    suggesting.field.setAttribute('aria-activedescendant', `${suggest.id}-${suggesting.index}`);
  };
  function hideSuggestions() {
    suggest.hidden = true;
    suggesting?.field.removeAttribute('aria-activedescendant');
    suggesting = null;
  }
  function acceptSuggestion(index = suggesting?.index ?? 0) {
    if (!suggesting) return;
    const {field, items} = suggesting;
    const done = completeMention(field.value, field.selectionStart, items[index].name);
    hideSuggestions();
    if (!done) return;
    field.value = done.text;
    field.focus();
    field.setSelectionRange(done.caret, done.caret);
    field.dispatchEvent(new window.Event('input', {bubbles: true}));
    hideSuggestions();
  }
  function showSuggestions(field) {
    const found = field.selectionStart === field.selectionEnd ? mentionQueryAt(field.value, field.selectionStart) : null;
    const items = found ? session.suggestions(found.query) : [];
    if (!items.length) { if (suggesting?.field === field) hideSuggestions(); return; }
    const index = suggesting?.field === field ? Math.min(suggesting.index, items.length - 1) : 0;
    suggesting = {field, items, index};
    suggest.replaceChildren(...items.map((person, position) => {
      const item = element(document, 'div', 'kn-suggest-item');
      item.id = `${suggest.id}-${position}`;
      item.setAttribute('role', 'option');
      item.append(element(document, 'b', '', `@${person.name}`));
      const tags = [person.listening ? 'listening' : '', person.kind === 'person' ? 'person' : '', person.about || ''].filter(Boolean).join(' \u00b7 ');
      if (tags) item.append(element(document, 'span', 'kn-suggest-about', `  ${tags}`));
      item.addEventListener('mousedown', event => { event.preventDefault(); acceptSuggestion(position); });
      return item;
    }));
    suggest.hidden = false;
    const box = field.getBoundingClientRect(), frame = drawer.getBoundingClientRect();
    suggest.style.left = `${box.left - frame.left}px`;
    suggest.style.width = `${box.width}px`;
    const below = frame.bottom - box.bottom;
    suggest.style.top = below > suggest.offsetHeight + 8 ? `${box.bottom - frame.top + 2}px` : `${box.top - frame.top - suggest.offsetHeight - 2}px`;
    markSuggestion();
  }
  function attachMentions(field) {
    field.setAttribute('aria-autocomplete', 'list');
    field.setAttribute('aria-controls', suggest.id);
    field.addEventListener('input', () => showSuggestions(field));
    field.addEventListener('click', () => showSuggestions(field));
    field.addEventListener('keyup', event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) showSuggestions(field); });
    field.addEventListener('blur', () => { if (suggesting?.field === field) hideSuggestions(); });
    field.addEventListener('keydown', event => {
      if (suggesting?.field !== field || suggest.hidden) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        suggesting.index = (suggesting.index + (event.key === 'ArrowDown' ? 1 : -1) + suggesting.items.length) % suggesting.items.length;
        markSuggestion();
      } else if (event.key === 'Tab' || (event.key === 'Enter' && !event.metaKey && !event.ctrlKey)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        acceptSuggestion();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        hideSuggestions();
      }
    });
  }
  const reachText = ({recipients, listening, notified = [], unknown}, {reply = false} = {}) => {
    const parts = [];
    const named = recipients.map(name => `@${name}${listening.includes(name) ? ' (listening)' : notified.includes(name) ? ' (will be notified)' : ''}`).join(', ');
    if (reply) parts.push(named ? `Goes to this conversation and ${named}` : '');
    else parts.push(named ? `Reaches ${named}` : 'Reaches no one in particular: anyone reading this scene will see it');
    if (unknown.length) parts.push(`${unknown.map(name => `@${name}`).join(', ')} ${unknown.length === 1 ? "isn't anyone known here, so it stays" : "aren't anyone known here, so they stay"} text`);
    return parts.filter(Boolean).join(' \u00b7 ');
  };
  function updateReach() {
    const preview = session.preview({text: text.value, to: to.value});
    reach.textContent = text.value.trim() || to.value.trim() ? reachText(preview) : '';
    reach.dataset.unknown = String(preview.unknown.length > 0);
  }
  attachMentions(text);
  attachMentions(to);
  text.addEventListener('input', updateReach);
  to.addEventListener('input', updateReach);
  let participantsTimer = 0;
  const refreshParticipants = () => window.fetch(`${endpoint}/participants`, {cache: 'no-store'})
    .then(response => response.ok ? response.json() : null)
    .then(data => { if (data) session.setParticipants(data.participants ?? [], {notifies: !!data.notifies}); })
    .catch(() => {});
  const refreshParticipantsSoon = () => { window.clearTimeout(participantsTimer); participantsTimer = window.setTimeout(refreshParticipants, 150); };

  const latestNoteIn = note => { let latest = note; walk(note, item => { if (item.seq > latest.seq) latest = item; }); return latest; };
  const threadOf = id => session.state.notes.get(id) ?? null;

  // Thread cards are kept and updated in place. A reply being written keeps
  // its focus, caret, attach choice and Send state through presence changes,
  // receipts and new notes; only a card's notes and actions are redrawn.
  const cards = new Map();
  const cardsHost = element(document, 'div');
  const empty = element(document, 'div', 'kn-empty', 'No notes on this scene yet. Select something and say what you see.');
  threads.append(empty, cardsHost);

  function makeCard(threadId) {
    const card = element(document, 'div', 'kn-thread');
    card.dataset.thread = threadId;
    const on = element(document, 'div', 'kn-on');
    const body = element(document, 'div');
    const actions = element(document, 'div', 'kn-actions');
    const box = element(document, 'div', 'kn-replybox');
    box.dataset.replyFor = threadId;
    box.hidden = true;
    const reply = element(document, 'textarea');
    reply.placeholder = 'Reply. Type @ to bring someone else in.';
    reply.setAttribute('aria-label', 'Reply');
    const replyReach = element(document, 'div', 'kn-reach');
    attachMentions(reply);
    // Recomputed on typing and whenever who is known or listening changes, so
    // the line always matches what Send would address.
    const updateReplyReach = () => {
      const preview = session.preview({text: reply.value});
      replyReach.textContent = preview.recipients.length || preview.unknown.length ? reachText(preview, {reply: true}) : '';
      replyReach.dataset.unknown = String(preview.unknown.length > 0);
    };
    reply.addEventListener('input', updateReplyReach);
    const replyRow = element(document, 'div', 'kn-row');
    const replyAttachLabel = element(document, 'label');
    const replyAttach = element(document, 'input');
    replyAttach.type = 'checkbox';
    replyAttachLabel.append(replyAttach, document.createTextNode('attach what I see'));
    const send = element(document, 'button', 'kn-btn primary', 'Send');
    send.type = 'button';
    const submit = async () => {
      if (send.disabled || (!reply.value.trim() && !replyAttach.checked)) return;
      const thread = threadOf(threadId);
      if (!thread) return say('That thread is no longer in the log', 'error');
      send.disabled = true;
      try {
        // The reply answers the latest note in the thread; the server keeps it
        // addressed to whoever the conversation was with.
        await session.post({text: reply.value, parent: latestNoteIn(thread).id, attachPicture: replyAttach.checked});
        reply.value = '';
        replyReach.textContent = '';
        replyAttach.checked = false;
        box.hidden = true;
        say('Reply sent');
      } catch (error) {
        say(error.message, 'error');
      } finally {
        send.disabled = false;
      }
    };
    send.addEventListener('click', submit);
    reply.addEventListener('keydown', event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); submit(); } });
    replyRow.append(replyAttachLabel, send);
    box.append(reply, replyReach, replyRow);
    card.append(on, body, actions, box);
    const entry = {card, on, body, actions, box, reply, updateReplyReach, signature: null};
    cards.set(threadId, entry);
    return entry;
  }

  function fillCard(entry, thread) {
    entry.card.dataset.resolved = String(thread.resolved);
    entry.card.dataset.focus = String(thread.id === focusThread);
    entry.on.textContent = `On ${anchorText(thread.anchor)}${thread.subject?.scene && thread.subject.scene !== (sceneFile() || null) ? ` in ${thread.subject.scene}` : ''}`;
    entry.body.replaceChildren(noteNode(thread, 0));
    const threadId = thread.id;
    const button = (label, handler, title) => {
      const control = element(document, 'button', 'kn-btn', label);
      control.type = 'button';
      if (title) control.title = title;
      control.addEventListener('click', () => Promise.resolve().then(handler).catch(error => say(error.message, 'error')));
      return control;
    };
    entry.actions.replaceChildren(
      button('Reply', () => { entry.box.hidden = false; entry.reply.focus(); }),
      button('Go to', () => {
        const current = threadOf(threadId);
        const result = session.goTo(threadId);
        redraw();
        say(result.object && !result.present ? `"${current?.anchor?.label}" is no longer in this scene; restored the view only` : 'Restored the view this note was written from');
      }, 'Restore the view and selection the note was written from'),
      button(thread.resolved ? 'Reopen' : 'Resolve', () => session.setResolved(threadId, !threadOf(threadId)?.resolved)),
      button('Copy ref', async () => {
        await window.navigator.clipboard.writeText(formatRef(threadOf(threadId)));
        say(`Copied a reference to ${threadId}`);
      }),
    );
  }

  const signatureOf = thread => {
    const known = new Set(session.participants.map(person => person.name));
    const parts = [thread.resolved, thread.id === focusThread, session.author, listeningNames().join(','), pageAuthors().join(','), sceneFile() || ''];
    // An @name becomes a button once that someone is known here.
    walk(thread, note => parts.push(note.seq, Object.keys(note.receipts.seen).join(','), Object.keys(note.receipts.delivered).join(','),
      mentionsIn(note.text).filter(name => known.has(name)).join(',')));
    return parts.join('|');
  };

  function renderThreads() {
    const list = session.threads();
    const active = document.activeElement;
    const writing = cardsHost.contains(active);
    const wanted = new Set(list.map(thread => thread.id));
    for (const [id, entry] of cards) {
      if (!wanted.has(id) && !entry.card.contains(active)) { entry.card.remove(); cards.delete(id); }
    }
    const scroll = threads.scrollTop;
    const following = threads.scrollHeight - threads.scrollTop - threads.clientHeight < 32;
    const ordered = list.map(thread => {
      const entry = cards.get(thread.id) ?? makeCard(thread.id);
      const signature = signatureOf(thread);
      if (signature !== entry.signature) { fillCard(entry, thread); entry.signature = signature; }
      return entry.card;
    });
    empty.hidden = list.length > 0;
    // Moving a card would take focus from a reply being written: while one
    // is, new cards are added at the end and the order catches up later.
    if (writing) {
      for (const card of ordered) if (!card.isConnected) cardsHost.append(card);
    } else {
      ordered.forEach((card, index) => { if (cardsHost.children[index] !== card) cardsHost.insertBefore(card, cardsHost.children[index] ?? null); });
    }
    // Like a chat: newest at the bottom, followed while you are there.
    threads.scrollTop = following || forceBottom ? threads.scrollHeight : scroll;
    forceBottom = false;
  }
  let forceBottom = false;

  function render() {
    const unread = session.unread().length;
    toggle.textContent = unread ? `Notes \u00b7 ${unread} new` : 'Notes';
    toggle.dataset.unread = String(unread);
    const waiting = listeningNames();
    if (waiting.join(',') !== listening.dataset.names) {
      listening.dataset.names = waiting.join(',');
      if (waiting.length) {
        listening.replaceChildren(document.createTextNode('listening: '));
        waiting.forEach((name, index) => listening.append(...(index ? [document.createTextNode(', ')] : []), nameButton(name, 'kn-name kn-agent')));
      } else {
        listening.textContent = 'no agent is listening right now';
      }
    }
    updateReach();
    refreshAnchor();
    if (!drawer.hidden) renderThreads();
    for (const entry of cards.values()) if (entry.reply.value) entry.updateReplyReach();
  }

  function openDrawer({thread = null, composeFocus = false} = {}) {
    drawer.hidden = false;
    placeDrawer();
    toggle.setAttribute('aria-expanded', 'true');
    if (thread) focusThread = thread;
    else forceBottom = true;
    refreshParticipants();
    for (const entry of cards.values()) entry.signature = null;
    render();
    if (thread) {
      threads.querySelector(`[data-thread="${thread}"]`)?.scrollIntoView({block: 'nearest'});
      session.markSeen(thread).catch(error => say(error.message, 'error'));
    }
    if (composeFocus) text.focus();
  }
  const closeDrawer = () => { drawer.hidden = true; toggle.setAttribute('aria-expanded', 'false'); focusThread = null; };

  toggle.addEventListener('click', () => (drawer.hidden ? openDrawer({composeFocus: true}) : closeDrawer()));
  close.addEventListener('click', closeDrawer);
  drawer.addEventListener('keydown', event => { if (event.key === 'Escape') { event.stopPropagation(); closeDrawer(); } });
  const postNote = async () => {
    postButton.disabled = true;
    say('Posting…');
    try {
      const note = await session.post({text: text.value, to: to.value, attachPicture: attach.checked});
      text.value = '';
      to.value = '';
      updateReach();
      refreshParticipantsSoon();
      focusThread = note.id;
      const waiting = listeningNames();
      const reach = note.recipients.length
        ? note.recipients.map(name => `${name} ${waiting.includes(name) ? 'is listening' : session.notifies() ? 'will be notified' : 'will see it at its next check'}`).join('; ')
        : 'not addressed: anyone reading this scene will see it';
      say(`Posted ${note.id}. ${reach}.`);
    } catch (error) {
      say(error.message, 'error');
    } finally {
      postButton.disabled = false;
    }
  };
  postButton.addEventListener('click', postNote);
  text.addEventListener('keydown', event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); postNote(); } });
  refButton.addEventListener('click', async () => {
    refButton.disabled = true;
    try {
      const {note, text: copied} = await session.copyRef();
      await window.navigator.clipboard.writeText(copied);
      say(`Copied ${note.id}: paste it into the conversation you're having.`);
    } catch (error) {
      say(error.message, 'error');
    } finally {
      refButton.disabled = false;
    }
  });
  const onKey = event => {
    if (event.defaultPrevented || event.repeat || event.target.closest?.('input,textarea,select,[contenteditable="true"]')) return;
    if (event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey && event.code === 'KeyN') {
      event.preventDefault();
      openDrawer({composeFocus: true});
    }
  };
  document.addEventListener('keydown', onKey);

  function toast(note) {
    const root = session.state.notes.get(note.thread) ?? note;
    const item = element(document, 'div', 'kn-toast', `${note.author}${note.parent ? ' replied' : ''} on ${anchorText(root.anchor)}: ${note.text || '(picture)'}`);
    item.setAttribute('role', 'status');
    item.addEventListener('click', () => { item.remove(); openDrawer({thread: root.id}); });
    toasts.append(item);
    window.setTimeout(() => item.remove(), 9000);
  }

  // --- pins over noted objects ---
  const box = new THREE.Box3(), point = new THREE.Vector3();
  let frame = 0, placedAt = -Infinity;
  // About fifteen times a second: pins follow the camera without costing a frame.
  function placePins(now) {
    frame = window.requestAnimationFrame(placePins);
    if (now - placedAt < 66) return;
    placedAt = now;
    const width = viewport.clientWidth, height = viewport.clientHeight;
    const byObject = new Map();
    for (const note of session.threads()) {
      if (note.resolved || note.anchor?.kind !== 'object') continue;
      const list = byObject.get(note.anchor.id) ?? [];
      list.push(note);
      byObject.set(note.anchor.id, list);
    }
    const keep = new Set();
    for (const [id, notes] of byObject) {
      const entry = entries().find(item => item.id === id);
      if (!entry?.object) continue;
      box.setFromObject(entry.object);
      if (box.isEmpty()) continue;
      box.getCenter(point);
      point.y = box.max.y;
      point.project(camera);
      if (point.z < -1 || point.z > 1 || Math.abs(point.x) > 1.05 || Math.abs(point.y) > 1.05) continue;
      keep.add(id);
      let pin = pins.querySelector(`[data-pin="${CSS.escape(id)}"]`);
      if (!pin) {
        pin = element(document, 'button', 'kn-pin');
        pin.type = 'button';
        pin.dataset.pin = id;
        pin.addEventListener('click', () => {
          const current = session.threads().filter(note => note.anchor?.id === id && !note.resolved);
          if (current.length) openDrawer({thread: current[0].id});
        });
        pins.append(pin);
      }
      const unread = session.author ? notes.some(note => { let found = false; walk(note, item => { if ((item.recipients ?? []).includes(session.author) && !item.receipts.seen[session.author]) found = true; }); return found; }) : false;
      pin.textContent = String(notes.length);
      pin.title = `${notes.length} note${notes.length === 1 ? '' : 's'} on "${entry.label || id}"`;
      pin.dataset.unread = String(unread);
      pin.style.left = `${((point.x + 1) / 2) * width}px`;
      pin.style.top = `${((1 - point.y) / 2) * height}px`;
    }
    // A note on a point gets its own pin there, carried by its object: the
    // object's current placement applied to the point in its own frame.
    for (const note of session.threads()) {
      if (note.resolved || note.anchor?.kind !== 'point') continue;
      const entry = entries().find(item => item.id === note.anchor.id);
      if (!entry?.object) continue;
      entry.object.updateMatrixWorld();
      point.fromArray(note.anchor.local).applyMatrix4(entry.object.matrixWorld).project(camera);
      if (point.z < -1 || point.z > 1 || Math.abs(point.x) > 1.05 || Math.abs(point.y) > 1.05) continue;
      const key = `point:${note.id}`;
      keep.add(key);
      let pin = pins.querySelector(`[data-pin="${CSS.escape(key)}"]`);
      if (!pin) {
        pin = element(document, 'button', 'kn-pin kn-point-pin');
        pin.type = 'button';
        pin.dataset.pin = key;
        pin.addEventListener('click', () => openDrawer({thread: note.id}));
        pins.append(pin);
      }
      pin.textContent = '\u2022';
      pin.title = `Note on a point of "${note.anchor.label}"`;
      pin.style.left = `${((point.x + 1) / 2) * width}px`;
      pin.style.top = `${((1 - point.y) / 2) * height}px`;
    }
    for (const pin of [...pins.children]) if (!keep.has(pin.dataset.pin)) pin.remove();
  }
  frame = window.requestAnimationFrame(placePins);

  // --- the live link ---
  // A linked note opens once the page's starting scene is restored, so its
  // object is there to select and the saved camera does not overwrite its view.
  let linked = linkedNote, sceneReady = !ready;
  const applyLink = () => {
    const note = linked && sceneReady ? session.state.notes.get(linked) : null;
    if (!note) return;
    linked = null;
    openDrawer({thread: note.thread});
    const result = session.goTo(note.id);
    redraw();
    say(result.object && !result.present ? `Opened ${note.id}; its object is not in this scene, so only the view was restored` : `Opened ${note.id} and restored the view it was written from`);
  };
  if (ready) Promise.resolve().then(ready).then(() => { sceneReady = true; applyLink(); }, () => { /* the page is moving to the saved scene's route; the link travels with it */ });
  const source = new window.EventSource(`${endpoint}/stream?page=${encodeURIComponent(pageId)}&after=0`);
  source.addEventListener('hello', event => {
    const hello = JSON.parse(event.data);
    transport.token = hello.token;
    session.hello(hello);
    refreshParticipants();
    if (status.dataset.tone === 'error' && /link/i.test(status.textContent)) say('Reconnected');
  });
  source.addEventListener('events', event => {
    const batch = JSON.parse(event.data).events;
    const known = new Set(session.participants.map(person => person.name));
    const notices = session.receive(batch);
    if (batch.some(item => item.type === 'note' && item.author && !known.has(item.author))) refreshParticipantsSoon();
    for (const note of notices) toast(note);
    applyLink();
  });
  source.addEventListener('presence', event => { session.setPresence(JSON.parse(event.data)); refreshParticipantsSoon(); });
  source.addEventListener('error', () => { if (source.readyState !== 2) say('Notes link lost; reconnecting…', 'error'); });
  const unsubscribe = session.onChange(render);
  // With the drawer open, Alt-click on the scene pins the note to the point
  // under the cursor, as the renderer drew it (the host's pick).
  const onPointPick = event => {
    if (drawer.hidden || !pickAt || !event.altKey || event.button !== 0 || event.target?.tagName !== 'CANVAS' || !viewport.contains(event.target)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const rect = event.target.getBoundingClientRect();
    const at = [(event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height];
    Promise.resolve().then(() => pickAt(at)).then(result => {
      const hit = result?.hit;
      if (!hit?.id || !hit.local || !hit.point) return say('Nothing to pin there');
      const entry = entries().find(item => item.id === hit.id);
      select(hit.id);
      session.setPoint({kind: 'point', id: hit.id, label: entry?.label || hit.label || hit.id, local: hit.local, point: hit.point,
        ...(hit.normal ? {normal: hit.normal} : {}), ...(Number.isInteger(hit.surface?.face) ? {face: hit.surface.face} : {}),
        ...(typeof hit.surface?.path === 'string' ? {path: hit.surface.path} : {}),
        ...(hit.geometry?.identity ? {geometry: hit.geometry.identity} : {}), ...(hit.authority ? {authority: hit.authority} : {}), at});
      refreshAnchor();
      say(`Pinned a point on "${entry?.label || hit.label || hit.id}"${hit.authority === 'approximate' ? ' (approximate: something drawn outside the scene may cover it)' : ''}`);
    }).catch(error => say(`Could not pin a point: ${error.message}`, 'error'));
  };
  window.addEventListener('pointerdown', onPointPick, {capture: true});
  const refreshOnSelection = window.setInterval(() => { if (!drawer.hidden) { refreshAnchor(); placeDrawer(); } }, 500);
  const placeOnResize = () => { if (!drawer.hidden) placeDrawer(); };
  window.addEventListener('resize', placeOnResize);
  render();

  return {
    pageId,
    session,
    open: thread => openDrawer({thread}),
    compose: () => openDrawer({composeFocus: true}),
    dispose() {
      source.close();
      unsubscribe();
      window.cancelAnimationFrame(frame);
      window.clearInterval(refreshOnSelection);
      window.removeEventListener('pointerdown', onPointPick, {capture: true});
      window.removeEventListener('resize', placeOnResize);
      window.clearTimeout(participantsTimer);
      document.removeEventListener('keydown', onKey);
      root.remove();
    },
  };
}
