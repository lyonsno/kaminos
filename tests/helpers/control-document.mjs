// Minimal eventful DOM for property/history tests; real browser conformance is separate.
export class Element extends EventTarget {
 constructor(document){super();this.ownerDocument=document;this.children=[];this.style={};this.dataset={};this.value='';this.checked=false;this.classes=new Set();this.classList={add:name=>this.classes.add(name),remove:name=>this.classes.delete(name),contains:name=>this.classes.has(name)};}
 append(...nodes){this.children.push(...nodes);}prepend(...nodes){this.children.unshift(...nodes);}
 setAttribute(key,value){this[key]=String(value);}remove(){this.removed=true;}
 setPointerCapture(){}hasPointerCapture(){return false;}
 focus(){this.ownerDocument.activeElement=this;this.fire('focus');this.fire('focusin');}select(){}
 blur(){this.ownerDocument.activeElement=null;this.fire('blur');}
 fire(type,properties={}){const event=new Event(type,{cancelable:true});for(const [key,value]of Object.entries(properties))Object.defineProperty(event,key,{value});this.dispatchEvent(event);return event;}
}
export function controlDocument(){const document=new EventTarget();document.defaultView=new EventTarget();document.createElement=()=>new Element(document);document.getElementById=()=>null;return document;}
