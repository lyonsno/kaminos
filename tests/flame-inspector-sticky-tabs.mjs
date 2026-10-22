// kaminos-test: node
// The flame inspector's search and Shape/Motion/Look/Quality tabs stay at the
// top of the properties panel while its settings scroll (operator, 2026-10-20).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../authoring-workspace.css', import.meta.url), 'utf8');
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selectors: selector.split(',').map(s => s.trim()), body }));
const navigation = rules.filter(rule => rule.selectors.includes('.flame-inspector-navigation')).map(rule => rule.body).join(';');
assert.match(navigation, /position:\s*sticky/, 'the flame navigation sticks to the top of the scrolling inspector');
assert.match(navigation, /top:\s*-?\d+px|top:\s*0/, 'it sticks at the top edge of the scrolling inspector');
assert.match(navigation, /background(-color)?:\s*#[0-9a-f]{3,6}/i, 'it has an opaque background so scrolled settings do not show through');
assert.match(navigation, /z-index:\s*\d+/, 'it paints above the scrolled rows');
// Sticky positioning only works if no ancestor between it and the scroll
// container clips overflow; the inspector body is that scroll container.
const body = rules.filter(rule => rule.selectors.includes('.authoring-inspector-body')).map(rule => rule.body).join(';');
assert.match(body, /overflow:\s*auto/, 'the inspector body is the scroll container the navigation sticks within');
console.log('flame inspector sticky tabs contracts passed');
