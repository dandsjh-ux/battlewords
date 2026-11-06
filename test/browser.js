// Headless browser test: 3 tabs play through lobby -> setup -> battle -> over.
// three.js is replaced by a permissive stub (CDN is unreachable in the sandbox) so this checks UI + flow, not rendering.
process.env.PORT = '4011';
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const { server } = require('../server');
const fs = require('fs');

const STUB = `
function mk() { const cache = {}; const target = function () {};
  return new Proxy(target, {
    get(t, k) { if (k === Symbol.toPrimitive) return () => 0; if (k === 'then') return undefined;
      if (k === Symbol.iterator) return function* () {}; if (k in cache) return cache[k]; const v = mk(); cache[k] = v; return v; },
    set(t, k, v) { cache[k] = v; return true; }, apply() { return mk(); }, construct() { return mk(); } }); }
export class WebGLRenderer { constructor() { this.domElement = document.createElement('canvas'); }
  setPixelRatio() {} setSize() {} render() {}
  setAnimationLoop(fn) { const loop = () => { try { fn(); } catch (e) { console.error('FRAME ERROR', e.message, e.stack); return; } setTimeout(loop, 16); }; loop(); } }
export class Clock { getDelta() { return 0.016; } }
` + 'ACESFilmicToneMapping AdditiveBlending BackSide BoxGeometry CanvasTexture CircleGeometry Color ConeGeometry CylinderGeometry DirectionalLight DodecahedronGeometry DoubleSide Fog Group HemisphereLight IcosahedronGeometry Mesh MeshBasicMaterial MeshStandardMaterial NormalBlending PerspectiveCamera PlaneGeometry Raycaster RingGeometry SRGBColorSpace Scene ShaderMaterial SphereGeometry Sprite SpriteMaterial Vector2 Vector3 Vector4'
  .split(' ').map(n => `export const ${n} = mk();`).join('\n');

const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const mkPage = async (label) => {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    const page = await ctx.newPage();
    await page.route('**/three.module.js', r => r.fulfill({ contentType: 'text/javascript', body: STUB }));
    await page.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
    page.on('pageerror', e => errors.push(`${label} pageerror: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|ERR_FAILED/.test(m.text())) errors.push(`${label} console: ${m.text()}`); });
    page.on('dialog', d => d.accept());
    await page.goto(`http://localhost:${process.env.PORT}/`);
    return page;
  };
  const shots = '/home/claude/word-fleet/test/shots';
  fs.mkdirSync(shots, { recursive: true });

  const A = await mkPage('A');
  await A.fill('#in-name', 'Ava');
  await A.click('#btn-create');
  await A.waitForSelector('#screen-lobby:not(.hidden)');
  const code = (await A.textContent('#lobby-code')).trim();
  const B = await mkPage('B'); await B.fill('#in-name', 'Ben'); await B.fill('#in-code', code); await B.click('#btn-join');
  const C = await mkPage('C'); await C.fill('#in-name', 'Cai'); await C.fill('#in-code', code); await C.click('#btn-join');
  await C.waitForSelector('#screen-lobby:not(.hidden)');
  await wait(300);
  await A.selectOption('select[data-key="fleetSize"]', '4');
  await A.selectOption('select[data-key="startCoins"]', '150');
  await wait(300);
  await A.screenshot({ path: `${shots}/1-lobby.png` });
  if ((await B.inputValue('select[data-key="fleetSize"]')) !== '4') throw new Error('setting not synced');

  await A.click('#btn-start');
  await A.waitForSelector('#screen-setup:not(.hidden)');
  for (const P of [A, B, C]) { await P.waitForSelector('#setup-ships input'); await P.click('#btn-random-all'); }
  await wait(600);
  await A.fill('#setup-ships input[data-idx="0"]', 'cat');
  await A.screenshot({ path: `${shots}/2-setup.png` });
  for (const P of [A, B, C]) await P.click('#btn-ready');
  await A.waitForSelector('#hud:not(.hidden)', { timeout: 15000 });
  await wait(500);
  await A.screenshot({ path: `${shots}/3-battle.png` });

  // A buys a shield via modal
  await B.click('[data-buy="shield"]');
  await B.waitForSelector('#modal:not(.hidden)');
  await B.click('#modal-body [data-l="E"]');
  await wait(300);
  const defs = await B.textContent('#my-defenses');
  if (!defs.includes('E')) throw new Error('shield not shown: ' + defs);

  // Play turns using keyboard + fire button
  const pages = { };
  const ids = {};
  for (const [n, P] of [['A', A], ['B', B], ['C', C]]) ids[n] = await P.evaluate(() => JSON.parse(sessionStorage.getItem('wf-session')));
  const letters = 'EAOTRSINLHDCUMPGBYWFKV'.split('');
  let li = 0, turns = 0;
  for (let k = 0; k < 400; k++) {
    let acted = false;
    for (const P of [A, B, C]) {
      const mine = await P.evaluate(() => document.getElementById('turn-banner').classList.contains('mine') && !document.getElementById('btn-fire').classList.contains('hidden'));
      if (!mine) continue;
      if (turns === 2) { // try a torpedo guess
        const g = await P.$('#target-fleet .guess-btn');
        if (g) { await g.click(); await P.fill('#guess-in', 'ZZZ'.padEnd(await P.$eval('#guess-in', e => e.maxLength), 'Z')); await P.click('#guess-go'); turns++; acted = true; await wait(3000); break; }
      }
      if (turns === 4) { await P.click('[data-buy="sonar"]').catch(() => {}); await P.waitForTimeout(200); const o = await P.$('#modal-body [data-t]'); if (o) await o.click(); await wait(2500); }
      await P.keyboard.press(letters[li % letters.length]);
      if (await P.$eval('#btn-fire', b => b.disabled)) continue;
      li++;
      await P.click('#btn-fire');
      turns++; acted = true;
      if (turns === 3) { await wait(900); await P.screenshot({ path: `${shots}/4-firing.png` }); }
      await wait(2600);
      break;
    }
    if (await A.evaluate(() => !document.getElementById('screen-over').classList.contains('hidden'))) break;
    if (!acted) await wait(300);
  }
  await wait(2500);
  await B.screenshot({ path: `${shots}/5-battle-later.png` });
  const over = await A.evaluate(() => !document.getElementById('screen-over').classList.contains('hidden'));
  console.log('turns played:', turns, 'game over:', over);
  if (over) await A.screenshot({ path: `${shots}/6-over.png` });
  else {
    await A.click('#btn-menu'); await A.click('#m-end'); await wait(2500);
    await A.screenshot({ path: `${shots}/6-over.png` });
  }
  const overNow = await A.evaluate(() => !document.getElementById('screen-over').classList.contains('hidden'));
  if (!overNow) throw new Error('over screen not shown');
  await A.click('#btn-again');
  await A.waitForSelector('#screen-lobby:not(.hidden)');

  // reload resume
  await B.reload();
  await B.waitForSelector('#screen-lobby:not(.hidden)', { timeout: 6000 });
  console.log('resume after reload OK');

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : '✅ no page errors');
  await browser.close();
  server.close();
  process.exit(errors.length ? 1 : 0);
})().catch(async e => { console.error('❌', e); process.exit(1); });
