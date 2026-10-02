import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { lightPixel, createMarqueeRenderer, mountAirshipMarquee } from '../airship-marquee.js';

function setup(t) {
 const dom = new JSDOM(readFileSync(new URL('../index.html', import.meta.url), 'utf8'), { pretendToBeVisual: true });
 t.after(() => dom.window.close());
 return { dom, root: dom.window.document.querySelector('.market-airship') };
}
test('marquee selects warm light pixels while the hull and blue screen stay steady', () => {
 for (const rgb of [[.25,.27,.3],[.03,.06,.14],[.05,.05,.05]]) assert.equal(lightPixel(...rgb,.4,.4).emission, 0);
 assert.equal(lightPixel(1,.08,.02,.4,.4).emission, 1);
 assert.equal(lightPixel(1,.6,.1,.8,.7).frame, true);
 assert.equal(lightPixel(1,.6,.1,.4,.4).frame, false);
});
test('reduced motion skips graphics and preference changes cancel an existing initialization', async t => {
 const { dom, root } = setup(t), media = new dom.window.EventTarget(); media.matches = true;
 const signals = [];
 const stop = mountAirshipMarquee(root, { media, start: async (_root, { signal }) => { signals.push(signal); } });
 assert.equal(signals.length, 0);
 media.matches = false; media.dispatchEvent(new dom.window.Event('change'));
 assert.equal(signals.length, 1); assert.equal(signals[0].aborted, false);
 media.matches = true; media.dispatchEvent(new dom.window.Event('change')); assert.equal(signals[0].aborted, true);
 media.matches = false; media.dispatchEvent(new dom.window.Event('change')); assert.equal(signals.length, 2);
 stop(); assert.equal(signals[1].aborted, true);
 media.dispatchEvent(new dom.window.Event('change')); assert.equal(signals.length, 2);
});
test('missing WebGL keeps the original ship and all three live price links usable', async t => {
 const { dom, root } = setup(t);
 root.querySelector('img').decode = async () => {};
 t.mock.method(dom.window.HTMLCanvasElement.prototype, 'getContext', () => null);
 const content = root.querySelector('.airship-display').outerHTML;
 await createMarqueeRenderer(root);
 assert.equal(root.hasAttribute('data-marquee'), false); assert.equal(root.querySelector('canvas'), null);
 assert.equal(root.querySelector('.airship-display').outerHTML, content);
 assert.equal(root.querySelectorAll('a[href^="/graphs"]').length, 3);
});
test('phones skip decorative graphics and resizing back to desktop restores them', t => {
 const { dom, root } = setup(t);
 const media = new dom.window.EventTarget(); media.matches = false;
 const compact = new dom.window.EventTarget(); compact.matches = true;
 const signals = [];
 const stop = mountAirshipMarquee(root, { media, compact, start: async (_root, { signal }) => { signals.push(signal); } });
 assert.equal(signals.length, 0);
 assert.equal(root.querySelectorAll('a[href^="/graphs"]').length, 3);
 compact.matches = false; compact.dispatchEvent(new dom.window.Event('change'));
 assert.equal(signals.length, 1);
 compact.matches = true; compact.dispatchEvent(new dom.window.Event('change'));
 assert.equal(signals[0].aborted, true);
 stop();
 compact.matches = false; compact.dispatchEvent(new dom.window.Event('change'));
 assert.equal(signals.length, 1);
});
test('cancellation while the artwork loads never creates a graphics context or hides the image', async t => {
 const { dom, root } = setup(t); let decoded;
 root.querySelector('img').decode = () => new Promise(resolve => { decoded = resolve; });
 t.mock.method(dom.window.HTMLCanvasElement.prototype, 'getContext', () => { throw new Error('Must not start'); });
 const controller = new AbortController(), pending = createMarqueeRenderer(root, { signal: controller.signal });
 controller.abort(); decoded(); await pending;
 assert.equal(root.hasAttribute('data-marquee'), false); assert.equal(root.querySelector('canvas'), null);
});
