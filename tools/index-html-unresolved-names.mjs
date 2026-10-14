#!/usr/bin/env node
// Static check for the authoring page: every identifier that an inline script
// or an inline event-handler attribute of index.html reads or writes must be
// declared where the browser would find it. A function deleted while a call to
// it stays behind is a ReferenceError the page only raises when that code runs;
// this finds it from the source.
//
// Resolution follows the browser's scoping: classic scripts share one
// top-level scope, module scripts have their own (imports included), handler
// attributes see the global scope plus `event`, and the global scope holds the
// browser globals listed below plus every name the page assigns onto `window`
// (`window.x = ...`, `globalThis.x = ...`, `Object.assign(window, {...})`,
// `Object.defineProperty(window, 'x', ...)`). `typeof x` never throws, so it
// is not a reference. Elements with an `id` are reachable as window properties;
// a name that resolves only that way is reported separately as named access.
//
// Not modelled: `with`, direct `eval`, the `with(element)` part of handler
// scope (an element property read bare inside an onclick is reported), and
// external scripts (`src=`), which are listed but not read.
//
// Parsing uses the acorn that ships inside Node (process.versions.acorn), which
// is reachable only with --expose-internals; the command line re-executes
// itself with that flag once, and a program that imports this module runs
// under it. KAMINOS_UNRESOLVED_ACORN_MODULE replaces the module path, so the
// parser-unavailable path can be exercised.
//
//   node tools/index-html-unresolved-names.mjs [--json] [--allow a,b] [index.html]
//
// Exit 0 when nothing is unresolved, 1 when something is (or a script does not
// parse), 2 for a usage error, 3 when the parser is unavailable (the reason is
// on stderr).

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCHEMA = 'kaminos.index-html-unresolved-names.v1';
export const ACORN_INTERNAL_PATH = 'internal/deps/acorn/acorn/dist/acorn';
export const EXIT_PARSER_UNAVAILABLE = 3;
const acornModulePath = () => process.env.KAMINOS_UNRESOLVED_ACORN_MODULE || ACORN_INTERNAL_PATH;

// Names the global scope provides in a browser. Short ambiguous window
// properties (`name`, `status`, `length`, `closed`, `event`, `find`, `close`,
// `focus`, `blur`, `stop`, `scroll`) are deliberately absent: a bare read of
// one of them in page code is far more often a lost declaration than intent.
export const BROWSER_GLOBALS = new Set(`
globalThis undefined NaN Infinity
Object Function Array Number Boolean String Symbol BigInt Date RegExp Promise Proxy Reflect JSON Math Intl Iterator
Error AggregateError EvalError RangeError ReferenceError SyntaxError TypeError URIError SuppressedError DisposableStack AsyncDisposableStack
ArrayBuffer SharedArrayBuffer Atomics DataView
Int8Array Uint8Array Uint8ClampedArray Int16Array Uint16Array Int32Array Uint32Array Float16Array Float32Array Float64Array BigInt64Array BigUint64Array
Map Set WeakMap WeakSet WeakRef FinalizationRegistry
parseFloat parseInt isFinite isNaN eval decodeURI decodeURIComponent encodeURI encodeURIComponent escape unescape
window self document console navigator location history screen frames parent top opener origin performance crypto
indexedDB localStorage sessionStorage caches customElements speechSynthesis visualViewport
devicePixelRatio innerWidth innerHeight outerWidth outerHeight scrollX scrollY pageXOffset pageYOffset screenX screenY screenLeft screenTop
isSecureContext crossOriginIsolated
alert confirm prompt print open
setTimeout clearTimeout setInterval clearInterval queueMicrotask requestAnimationFrame cancelAnimationFrame requestIdleCallback cancelIdleCallback
fetch atob btoa structuredClone getComputedStyle getSelection matchMedia scrollTo scrollBy postMessage reportError createImageBitmap
addEventListener removeEventListener dispatchEvent
Event CustomEvent EventTarget AbortController AbortSignal
Blob File FileReader FileList FormData Headers Request Response URL URLSearchParams WebSocket Worker SharedWorker MessageChannel MessagePort BroadcastChannel
Image Audio Video Option
Node NodeList NodeFilter NodeIterator TreeWalker HTMLCollection Document DocumentFragment DocumentType Text Comment Attr CharacterData Range Selection ShadowRoot
DOMParser XMLSerializer XMLHttpRequest XPathResult XPathEvaluator
MutationObserver ResizeObserver IntersectionObserver PerformanceObserver ReportingObserver
DOMException DOMRect DOMRectReadOnly DOMPoint DOMPointReadOnly DOMMatrix DOMMatrixReadOnly DOMTokenList NamedNodeMap DOMStringMap
Path2D CanvasRenderingContext2D CanvasGradient CanvasPattern OffscreenCanvas OffscreenCanvasRenderingContext2D ImageData ImageBitmap ImageBitmapRenderingContext TextMetrics
WebGLRenderingContext WebGL2RenderingContext WebGLTexture WebGLBuffer WebGLProgram WebGLShader WebGLFramebuffer WebGLRenderbuffer WebGLUniformLocation WebGLActiveInfo WebGLContextEvent
GPU GPUAdapter GPUAdapterInfo GPUDevice GPUQueue GPUBuffer GPUTexture GPUTextureView GPUSampler GPUShaderModule GPUBindGroup GPUBindGroupLayout GPUPipelineLayout
GPURenderPipeline GPUComputePipeline GPUCommandEncoder GPUCommandBuffer GPURenderPassEncoder GPUComputePassEncoder GPUCanvasContext GPUQuerySet
GPUBufferUsage GPUTextureUsage GPUShaderStage GPUMapMode GPUColorWrite GPUValidationError GPUOutOfMemoryError GPUInternalError GPUPipelineError GPUUncapturedErrorEvent GPUDeviceLostInfo GPUSupportedFeatures GPUSupportedLimits
Element HTMLElement SVGElement SVGSVGElement MathMLElement
HTMLHtmlElement HTMLHeadElement HTMLBodyElement HTMLTitleElement HTMLMetaElement HTMLLinkElement HTMLStyleElement HTMLScriptElement HTMLTemplateElement HTMLSlotElement
HTMLDivElement HTMLSpanElement HTMLParagraphElement HTMLPreElement HTMLHeadingElement HTMLBRElement HTMLHRElement HTMLQuoteElement HTMLModElement HTMLTimeElement HTMLDataElement
HTMLAnchorElement HTMLImageElement HTMLPictureElement HTMLSourceElement HTMLMediaElement HTMLVideoElement HTMLAudioElement HTMLTrackElement HTMLCanvasElement HTMLIFrameElement HTMLEmbedElement HTMLObjectElement HTMLMapElement HTMLAreaElement
HTMLUListElement HTMLOListElement HTMLLIElement HTMLDListElement HTMLMenuElement
HTMLTableElement HTMLTableRowElement HTMLTableCellElement HTMLTableSectionElement HTMLTableCaptionElement HTMLTableColElement
HTMLFormElement HTMLInputElement HTMLSelectElement HTMLOptionElement HTMLOptGroupElement HTMLDataListElement HTMLTextAreaElement HTMLButtonElement HTMLLabelElement HTMLFieldSetElement HTMLLegendElement HTMLOutputElement HTMLProgressElement HTMLMeterElement
HTMLDialogElement HTMLDetailsElement HTMLUnknownElement
UIEvent KeyboardEvent MouseEvent PointerEvent WheelEvent TouchEvent Touch TouchList DragEvent DataTransfer DataTransferItem DataTransferItemList ClipboardEvent InputEvent FocusEvent CompositionEvent
ErrorEvent PromiseRejectionEvent MessageEvent CloseEvent ProgressEvent StorageEvent HashChangeEvent PopStateEvent PageTransitionEvent TransitionEvent AnimationEvent BeforeUnloadEvent SubmitEvent FormDataEvent ToggleEvent
GamepadEvent Gamepad DeviceOrientationEvent DeviceMotionEvent
MediaStream MediaStreamTrack MediaRecorder MediaSource MediaDevices ImageCapture
AudioContext OfflineAudioContext BaseAudioContext AudioBuffer AudioBufferSourceNode AudioWorkletNode GainNode OscillatorNode AnalyserNode AudioDestinationNode
Notification Permissions Clipboard ClipboardItem TextEncoder TextDecoder TextEncoderStream TextDecoderStream
ReadableStream WritableStream TransformStream ReadableStreamDefaultReader ReadableStreamBYOBReader WritableStreamDefaultWriter ByteLengthQueuingStrategy CountQueuingStrategy CompressionStream DecompressionStream
IDBKeyRange IDBDatabase IDBRequest IDBTransaction IDBObjectStore IDBCursor Storage StorageManager
CSS CSSStyleSheet CSSStyleDeclaration CSSRule CSSStyleRule StyleSheet MediaQueryList FontFace FontFaceSet
Animation KeyframeEffect DocumentTimeline
VideoFrame VideoEncoder VideoDecoder EncodedVideoChunk ImageDecoder
WebAssembly
SpeechSynthesisUtterance ScreenOrientation
`.split(/\s+/).filter(Boolean));

export function loadAcorn() {
  try {
    return createRequire(import.meta.url)(acornModulePath());
  } catch (error) {
    const self = path.basename(fileURLToPath(import.meta.url));
    throw new Error(`Node's bundled acorn (${process.versions.acorn || 'unknown version'}) is reachable only with --expose-internals; run \`node --expose-internals tools/${self}\` (${error.message})`);
  }
}

// ---------------------------------------------------------------------------
// HTML: scripts, handler attributes, element ids

function parseAttributes(text) {
  const attributes = [];
  const re = /([^\s=\/"'>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  for (const m of text.matchAll(re)) {
    const value = m[2] ?? m[3] ?? m[4] ?? null;
    let valueOffset = null;
    if (value !== null) {
      const eq = m[0].indexOf('=');
      const quoteIndex = m[0].slice(eq + 1).search(/["']/);
      valueOffset = m.index + eq + 1 + (quoteIndex >= 0 && (m[2] !== undefined || m[3] !== undefined) ? quoteIndex + 1 : m[0].slice(eq + 1).search(/\S/));
    }
    attributes.push({ name: m[1].toLowerCase(), value, valueOffset });
  }
  return attributes;
}

function scriptKind(attributes) {
  const type = (attributes.find(a => a.name === 'type')?.value ?? '').trim().toLowerCase();
  if (attributes.some(a => a.name === 'src')) return 'external';
  if (type === 'module') return 'module';
  if (type === '' || ['text/javascript', 'application/javascript', 'text/ecmascript', 'application/ecmascript'].includes(type)) return 'classic';
  return 'skipped';
}

// One pass over the HTML that skips comments whole and script bodies whole, so
// a `<script>` inside a comment is not a script and a `<!--` inside a script
// is not a comment.
export function scanHtml(html) {
  const scripts = [];
  const comments = [];
  const token = /<!--|<script\b/gi;
  let position = 0;
  for (;;) {
    token.lastIndex = position;
    const m = token.exec(html);
    if (!m) break;
    if (m[0] === '<!--') {
      const end = html.indexOf('-->', m.index + 4);
      const close = end < 0 ? html.length : end + 3;
      comments.push({ start: m.index, end: close });
      position = close;
      continue;
    }
    const tagEnd = html.indexOf('>', m.index);
    if (tagEnd < 0) break;
    const attributes = parseAttributes(html.slice(m.index + '<script'.length, tagEnd));
    const closeTag = /<\/script\s*>/gi;
    closeTag.lastIndex = tagEnd + 1;
    const close = closeTag.exec(html);
    const contentStart = tagEnd + 1;
    const contentEnd = close ? close.index : html.length;
    scripts.push({ index: scripts.length + 1, kind: scriptKind(attributes), type: attributes.find(a => a.name === 'type')?.value ?? null,
      src: attributes.find(a => a.name === 'src')?.value ?? null, tagStart: m.index, start: contentStart, end: contentEnd });
    position = close ? close.index + close[0].length : html.length;
  }
  // Markup only: comments and script bodies blanked to spaces, offsets kept.
  let markup = html;
  const blank = (start, end) => { markup = markup.slice(0, start) + ' '.repeat(end - start) + markup.slice(end); };
  for (const c of comments) blank(c.start, c.end);
  for (const s of scripts) blank(s.start, s.end);
  const handlers = [];
  const elementIds = new Set();
  const tag = /<([a-zA-Z][^\s\/>]*)/g;
  for (const t of markup.matchAll(tag)) {
    // Attribute-aware scan to the end of the tag, so a `>` inside a quoted
    // handler value does not end it.
    let i = t.index + t[0].length;
    const attrs = [];
    while (i < markup.length) {
      while (i < markup.length && /\s/.test(markup[i])) i += 1;
      if (markup[i] === '>') { i += 1; break; }
      if (markup[i] === '/' && markup[i + 1] === '>') { i += 2; break; }
      const nameMatch = /^[^\s=\/>]+/.exec(markup.slice(i, i + 256));
      if (!nameMatch) { i += 1; continue; }
      const name = nameMatch[0];
      i += name.length;
      let j = i;
      while (j < markup.length && /\s/.test(markup[j])) j += 1;
      if (markup[j] !== '=') { attrs.push({ name, value: null, valueOffset: null }); continue; }
      j += 1;
      while (j < markup.length && /\s/.test(markup[j])) j += 1;
      const quote = markup[j];
      if (quote === '"' || quote === "'") {
        const end = markup.indexOf(quote, j + 1);
        const stop = end < 0 ? markup.length : end;
        attrs.push({ name, value: markup.slice(j + 1, stop), valueOffset: j + 1 });
        i = stop + 1;
      } else {
        const end = /[\s>]/.exec(markup.slice(j));
        const stop = end ? j + end.index : markup.length;
        attrs.push({ name, value: markup.slice(j, stop), valueOffset: j });
        i = stop;
      }
    }
    tag.lastIndex = Math.max(tag.lastIndex, i);
    for (const a of attrs) {
      const lower = a.name.toLowerCase();
      if (lower === 'id' && a.value !== null && /^[A-Za-z_$][\w$]*$/.test(a.value)) elementIds.add(a.value);
      if (/^on[a-z]+$/.test(lower) && a.value !== null) handlers.push({ attribute: lower, element: t[1].toLowerCase(), raw: a.value, start: a.valueOffset });
    }
  }
  return { scripts, handlers, elementIds, comments };
}

const ENTITIES = { quot: '"', apos: "'", amp: '&', lt: '<', gt: '>', nbsp: ' ' };
export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body) => {
    if (body[0] === '#') return String.fromCodePoint(body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10));
    return Object.hasOwn(ENTITIES, body.toLowerCase()) ? ENTITIES[body.toLowerCase()] : whole;
  });
}

// ---------------------------------------------------------------------------
// Scope analysis over acorn's ESTree

const VAR_SCOPE_KINDS = new Set(['global', 'script', 'module', 'function', 'handler', 'static-block']);

class Scope {
  constructor(kind, parent, { sloppy = false } = {}) {
    this.kind = kind; this.parent = parent; this.sloppy = sloppy;
    this.names = new Map(); this.refs = [];
  }
  declare(name, kind) { if (!this.names.has(name)) this.names.set(name, kind); }
  varScope() { let s = this; while (!VAR_SCOPE_KINDS.has(s.kind)) s = s.parent; return s; }
}

const SKIP_KEYS = new Set(['type', 'start', 'end', 'loc', 'range']);

class Analyzer {
  constructor() { this.scopes = []; this.windowAssignments = new Map(); }

  scope(kind, parent, options) { const s = new Scope(kind, parent, options); this.scopes.push(s); return s; }

  ref(scope, node, write = false) { scope.refs.push({ name: node.name, node, write }); }

  declarePattern(pattern, scope, kind) {
    if (!pattern) return;
    switch (pattern.type) {
      case 'Identifier': scope.declare(pattern.name, kind); return;
      case 'ObjectPattern': for (const p of pattern.properties) this.declarePattern(p.type === 'RestElement' ? p.argument : p.value, scope, kind); return;
      case 'ArrayPattern': for (const e of pattern.elements) this.declarePattern(e, scope, kind); return;
      case 'RestElement': this.declarePattern(pattern.argument, scope, kind); return;
      case 'AssignmentPattern': this.declarePattern(pattern.left, scope, kind); return;
      default: return;
    }
  }

  // Default values and computed keys inside a binding pattern are expressions.
  visitPatternExpressions(pattern, scope) {
    if (!pattern) return;
    switch (pattern.type) {
      case 'ObjectPattern':
        for (const p of pattern.properties) {
          if (p.type === 'RestElement') { this.visitPatternExpressions(p.argument, scope); continue; }
          if (p.computed) this.visit(p.key, scope);
          this.visitPatternExpressions(p.value, scope);
        }
        return;
      case 'ArrayPattern': for (const e of pattern.elements) this.visitPatternExpressions(e, scope); return;
      case 'RestElement': this.visitPatternExpressions(pattern.argument, scope); return;
      case 'AssignmentPattern': this.visitPatternExpressions(pattern.left, scope); this.visit(pattern.right, scope); return;
      default: return;
    }
  }

  // The left side of an assignment or for-in/of head: identifiers are writes.
  visitAssignmentTarget(target, scope) {
    switch (target.type) {
      case 'Identifier': this.ref(scope, target, true); return;
      case 'ObjectPattern':
        for (const p of target.properties) {
          if (p.type === 'RestElement') { this.visitAssignmentTarget(p.argument, scope); continue; }
          if (p.computed) this.visit(p.key, scope);
          this.visitAssignmentTarget(p.value, scope);
        }
        return;
      case 'ArrayPattern': for (const e of target.elements) if (e) this.visitAssignmentTarget(e, scope); return;
      case 'RestElement': this.visitAssignmentTarget(target.argument, scope); return;
      case 'AssignmentPattern': this.visitAssignmentTarget(target.left, scope); this.visit(target.right, scope); return;
      default: this.visit(target, scope);
    }
  }

  recordWindowAssignment(node) {
    const { left } = node;
    if (left.type !== 'MemberExpression' || left.object.type !== 'Identifier') return;
    if (!['window', 'globalThis', 'self'].includes(left.object.name)) return;
    if (!left.computed && left.property.type === 'Identifier') this.windowAssignments.set(left.property.name, node.start);
    else if (left.computed && left.property.type === 'Literal' && typeof left.property.value === 'string') this.windowAssignments.set(left.property.value, node.start);
  }

  recordWindowCall(node) {
    const { callee } = node;
    if (callee.type !== 'MemberExpression' || callee.computed || callee.object.type !== 'Identifier' || callee.object.name !== 'Object') return;
    const [target, second] = node.arguments;
    if (!target || target.type !== 'Identifier' || !['window', 'globalThis', 'self'].includes(target.name)) return;
    if (callee.property.name === 'assign') {
      for (const source of node.arguments.slice(1)) {
        if (source.type !== 'ObjectExpression') continue;
        for (const p of source.properties) {
          if (p.type !== 'Property' || p.computed) continue;
          if (p.key.type === 'Identifier') this.windowAssignments.set(p.key.name, node.start);
          else if (p.key.type === 'Literal' && typeof p.key.value === 'string') this.windowAssignments.set(p.key.value, node.start);
        }
      }
    } else if (callee.property.name === 'defineProperty' && second?.type === 'Literal' && typeof second.value === 'string') {
      this.windowAssignments.set(second.value, node.start);
    }
  }

  visitFunction(node, scope) {
    const s = this.scope('function', scope, { sloppy: scope.sloppy });
    if (node.type === 'FunctionExpression' && node.id) s.declare(node.id.name, 'function-name');
    if (node.type !== 'ArrowFunctionExpression') s.declare('arguments', 'implicit');
    for (const p of node.params) this.declarePattern(p, s, 'param');
    for (const p of node.params) this.visitPatternExpressions(p, s);
    if (node.body.type === 'BlockStatement') for (const statement of node.body.body) this.visit(statement, s);
    else this.visit(node.body, s);
  }

  visitClass(node, scope) {
    const s = this.scope('class', scope);
    if (node.id) s.declare(node.id.name, 'class-name');
    if (node.superClass) this.visit(node.superClass, s);
    for (const element of node.body.body) this.visit(element, s);
  }

  visitBlockBody(statements, scope) {
    for (const statement of statements) this.visit(statement, scope);
  }

  visit(node, scope) {
    if (!node || typeof node.type !== 'string') return;
    switch (node.type) {
      case 'Identifier': this.ref(scope, node); return;
      case 'Literal': case 'PrivateIdentifier': case 'MetaProperty': case 'ThisExpression': case 'Super':
      case 'BreakStatement': case 'ContinueStatement': case 'EmptyStatement': case 'DebuggerStatement': case 'ExportAllDeclaration':
        return;
      case 'VariableDeclaration': {
        const target = node.kind === 'var' ? scope.varScope() : scope;
        for (const d of node.declarations) {
          this.declarePattern(d.id, target, node.kind);
          this.visitPatternExpressions(d.id, scope);
          if (d.init) this.visit(d.init, scope);
        }
        return;
      }
      case 'FunctionDeclaration':
        if (node.id) {
          scope.declare(node.id.name, 'function');
          // Sloppy scripts hoist block-level function declarations to the
          // enclosing function (Annex B); allow the reference either way.
          if (scope.sloppy) scope.varScope().declare(node.id.name, 'function');
        }
        this.visitFunction(node, scope);
        return;
      case 'FunctionExpression': case 'ArrowFunctionExpression': this.visitFunction(node, scope); return;
      case 'ClassDeclaration': if (node.id) scope.declare(node.id.name, 'class'); this.visitClass(node, scope); return;
      case 'ClassExpression': this.visitClass(node, scope); return;
      case 'BlockStatement': this.visitBlockBody(node.body, this.scope('block', scope, { sloppy: scope.sloppy })); return;
      case 'StaticBlock': this.visitBlockBody(node.body, this.scope('static-block', scope)); return;
      case 'SwitchStatement': {
        this.visit(node.discriminant, scope);
        const s = this.scope('block', scope, { sloppy: scope.sloppy });
        for (const c of node.cases) { if (c.test) this.visit(c.test, s); this.visitBlockBody(c.consequent, s); }
        return;
      }
      case 'ForStatement': {
        const s = this.scope('block', scope, { sloppy: scope.sloppy });
        this.visit(node.init, s); this.visit(node.test, s); this.visit(node.update, s); this.visit(node.body, s);
        return;
      }
      case 'ForInStatement': case 'ForOfStatement': {
        const s = this.scope('block', scope, { sloppy: scope.sloppy });
        if (node.left.type === 'VariableDeclaration') this.visit(node.left, s); else this.visitAssignmentTarget(node.left, s);
        this.visit(node.right, s); this.visit(node.body, s);
        return;
      }
      case 'CatchClause': {
        const s = this.scope('catch', scope, { sloppy: scope.sloppy });
        if (node.param) { this.declarePattern(node.param, s, 'catch'); this.visitPatternExpressions(node.param, s); }
        this.visitBlockBody(node.body.body, s);
        return;
      }
      case 'LabeledStatement': this.visit(node.body, scope); return;
      case 'MemberExpression': this.visit(node.object, scope); if (node.computed) this.visit(node.property, scope); return;
      case 'Property': if (node.computed) this.visit(node.key, scope); this.visit(node.value, scope); return;
      case 'MethodDefinition': case 'PropertyDefinition': case 'AccessorProperty':
        if (node.computed) this.visit(node.key, scope); if (node.value) this.visit(node.value, scope); return;
      case 'ImportDeclaration': for (const sp of node.specifiers) scope.declare(sp.local.name, 'import'); return;
      case 'ImportExpression': this.visit(node.source, scope); if (node.options) this.visit(node.options, scope); return;
      case 'ExportNamedDeclaration':
        if (node.declaration) this.visit(node.declaration, scope);
        else if (!node.source) for (const sp of node.specifiers) if (sp.local.type === 'Identifier') this.ref(scope, sp.local);
        return;
      case 'ExportDefaultDeclaration': this.visit(node.declaration, scope); return;
      case 'AssignmentExpression':
        this.recordWindowAssignment(node);
        this.visitAssignmentTarget(node.left, scope); this.visit(node.right, scope);
        return;
      case 'CallExpression':
        this.recordWindowCall(node);
        this.visit(node.callee, scope); for (const a of node.arguments) this.visit(a, scope);
        return;
      case 'UnaryExpression':
        if (node.operator === 'typeof' && node.argument.type === 'Identifier') return;
        this.visit(node.argument, scope);
        return;
      case 'TemplateLiteral': for (const e of node.expressions) this.visit(e, scope); return;
      default:
        for (const key of Object.keys(node)) {
          if (SKIP_KEYS.has(key)) continue;
          const child = node[key];
          if (Array.isArray(child)) { for (const c of child) if (c && typeof c.type === 'string') this.visit(c, scope); }
          else if (child && typeof child === 'object' && typeof child.type === 'string') this.visit(child, scope);
        }
    }
  }
}

// ---------------------------------------------------------------------------

function lineTable(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return offset => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= offset) lo = mid; else hi = mid - 1; }
    return { line: lo + 1, column: offset - starts[lo] + 1 };
  };
}

export function analyzeHtml(html, { acorn = loadAcorn(), file = 'index.html', allow = [] } = {}) {
  const started = performance.now();
  const { scripts, handlers, elementIds } = scanHtml(html);
  const at = lineTable(html);
  const analyzer = new Analyzer();
  const global = analyzer.scope('global', null, { sloppy: true });
  for (const name of BROWSER_GLOBALS) global.declare(name, 'browser');
  for (const name of allow) global.declare(name, 'allowed');
  const classicTop = analyzer.scope('script', global, { sloppy: true });
  const parseErrors = [];
  const chunks = [];

  for (const script of scripts) {
    const source = html.slice(script.start, script.end);
    const { line: startLine } = at(script.start);
    const { line: endLine } = at(Math.max(script.start, script.end - 1));
    const summary = { index: script.index, kind: script.kind, type: script.type, src: script.src, startLine, endLine, chars: source.length };
    chunks.push(summary);
    if (script.kind !== 'module' && script.kind !== 'classic') continue;
    let program;
    try {
      program = acorn.parse(source, { ecmaVersion: 'latest', sourceType: script.kind, allowHashBang: false });
    } catch (error) {
      const pos = typeof error.pos === 'number' ? at(script.start + error.pos) : at(script.start);
      parseErrors.push({ context: `${script.kind} script #${script.index}`, message: error.message, ...pos });
      continue;
    }
    const scope = script.kind === 'module' ? analyzer.scope('module', classicTop, { sloppy: false }) : classicTop;
    scope.context = `${script.kind} script #${script.index}`;
    scope.base = script.start;
    const context = { label: scope.context, base: script.start, approximate: false };
    for (const statement of program.body) analyzer.visit(statement, scope);
    for (const s of analyzer.scopes) if (!s.context && s.kind !== 'global' && s.kind !== 'script') { s.context = context.label; s.base = context.base; }
    summary.declarations = [...scope.names.keys()].length;
  }

  const handlerSummary = { count: handlers.length, attributes: {} };
  for (const handler of handlers) {
    handlerSummary.attributes[handler.attribute] = (handlerSummary.attributes[handler.attribute] || 0) + 1;
    const source = decodeEntities(handler.raw);
    const approximate = source !== handler.raw;
    let program;
    try {
      program = acorn.parse(source, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true });
    } catch (error) {
      const pos = typeof error.pos === 'number' && !approximate ? at(handler.start + error.pos) : at(handler.start);
      parseErrors.push({ context: `${handler.attribute} attribute on <${handler.element}>`, message: error.message, ...pos, approximate });
      continue;
    }
    const scope = analyzer.scope('handler', classicTop, { sloppy: true });
    scope.declare('event', 'handler');
    scope.context = `${handler.attribute} attribute on <${handler.element}>`;
    scope.base = handler.start;
    scope.approximate = approximate;
    const before = analyzer.scopes.length;
    for (const statement of program.body) analyzer.visit(statement, scope);
    for (const s of analyzer.scopes.slice(before)) { s.context = scope.context; s.base = scope.base; s.approximate = approximate; }
  }

  for (const name of analyzer.windowAssignments.keys()) global.declare(name, 'window-assignment');

  const unresolved = [];
  const namedAccess = [];
  for (const scope of analyzer.scopes) {
    for (const ref of scope.refs) {
      let s = scope, found = false;
      while (s) { if (s.names.has(ref.name)) { found = true; break; } s = s.parent; }
      if (found) continue;
      const offset = (scope.base ?? 0) + ref.node.start;
      const entry = { name: ref.name, ...at(offset), offset, context: scope.context || 'unknown', write: ref.write, ...(scope.approximate ? { approximate: true } : {}) };
      if (elementIds.has(ref.name)) namedAccess.push(entry); else unresolved.push(entry);
    }
  }
  unresolved.sort((a, b) => a.offset - b.offset);
  namedAccess.sort((a, b) => a.offset - b.offset);
  const counts = {};
  for (const u of unresolved) counts[u.name] = (counts[u.name] || 0) + 1;

  return {
    schema: SCHEMA, file, ok: unresolved.length === 0 && parseErrors.length === 0,
    acorn: acorn.version, durationMs: Math.round(performance.now() - started),
    scripts: chunks, handlers: handlerSummary,
    windowAssignments: [...analyzer.windowAssignments.keys()].sort(),
    elementIds: elementIds.size, allowed: [...allow],
    unresolvedNames: counts, unresolved, namedAccess, parseErrors,
  };
}

export function formatReport(report) {
  const lines = [];
  const where = e => `${report.file}:${e.line}:${e.column}${e.approximate ? ' (approximate)' : ''}`;
  for (const error of report.parseErrors) lines.push(`parse error in ${error.context} at ${where(error)}: ${error.message}`);
  const byName = new Map();
  for (const u of report.unresolved) { if (!byName.has(u.name)) byName.set(u.name, []); byName.get(u.name).push(u); }
  for (const [name, uses] of byName) {
    lines.push(`${name}: ${uses.length} unresolved use${uses.length === 1 ? '' : 's'}`);
    for (const u of uses) lines.push(`  ${where(u)}  ${u.write ? 'write' : 'read'} in ${u.context}`);
  }
  for (const n of report.namedAccess) lines.push(`named access: ${n.name} at ${where(n)} resolves only through an element id (${n.context})`);
  const scripts = report.scripts.map(s => `${s.kind}${s.src ? ` src=${s.src}` : ''} (lines ${s.startLine}-${s.endLine}${s.declarations !== undefined ? `, ${s.declarations} top-level names` : ''})`);
  lines.push(`${report.ok ? 'OK' : 'FAILED'}  ${report.unresolved.length} unresolved, ${report.parseErrors.length} parse errors, ${report.namedAccess.length} named-access; scripts: ${scripts.join('; ')}; handlers: ${report.handlers.count}; window assignments: ${report.windowAssignments.length}; acorn ${report.acorn}; ${report.durationMs} ms`);
  return lines.join('\n');
}

export function parseArgs(argv) {
  const args = { json: false, allow: [], file: null };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag === '--json') args.json = true;
    else if (flag === '--allow') { if (i + 1 >= argv.length) throw new Error('--allow requires a value'); args.allow.push(...argv[++i].split(',').filter(Boolean)); }
    else if (flag.startsWith('--')) throw new Error(`unknown argument ${flag}`);
    else if (args.file) throw new Error(`one file at a time, got ${args.file} and ${flag}`);
    else args.file = flag;
  }
  return args;
}

const invokedAsMain = (() => { try { return Boolean(process.argv[1]) && fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(path.resolve(process.argv[1])); } catch { return false; } })();
if (invokedAsMain) {
  let acorn = null;
  let loadError = null;
  try { acorn = createRequire(import.meta.url)(acornModulePath()); } catch (error) { acorn = null; loadError = error; }
  if (!acorn && !process.execArgv.includes('--expose-internals')) {
    // Re-run once under the flag that exposes Node's acorn; nothing else changes.
    const child = spawnSync(process.execPath, ['--expose-internals', ...process.execArgv, ...process.argv.slice(1)], { stdio: 'inherit' });
    process.exit(child.status ?? 1);
  }
  if (!acorn) {
    console.error(`parser unavailable: Node ${process.version} does not provide ${acornModulePath()} even with --expose-internals (${loadError?.message?.split('\n')[0]})`);
    process.exit(EXIT_PARSER_UNAVAILABLE);
  }
  let args;
  try { args = parseArgs(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exit(2); }
  const file = path.resolve(args.file || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'index.html'));
  let html;
  try { html = fs.readFileSync(file, 'utf8'); } catch (error) { console.error(error.message); process.exit(2); }
  const report = analyzeHtml(html, { acorn, file: path.relative(process.cwd(), file) || file, allow: args.allow });
  console.log(args.json ? JSON.stringify(report, null, 2) : formatReport(report));
  process.exit(report.ok ? 0 : 1);
}
