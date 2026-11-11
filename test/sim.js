// Simulated game: 3 bots + spectator host play through lobby, setup, battle, shop and game over.
// Run: node test/sim.js
process.env.PORT = process.env.PORT || '3999';
const assert = require('assert');
const { WORDS } = require('../lib/words');
const { server } = require('../server');

for (const [len, list] of Object.entries(WORDS)) for (const w of list) assert.strictEqual(w.length, Number(len), `bad length ${w}`);

const URL = `ws://localhost:${process.env.PORT}/ws`;
const wait = ms => new Promise(r => setTimeout(r, ms));

function bot(name) {
  return new Promise(resolve => {
    const ws = new WebSocket(URL);
    const b = { name, ws, state: null, errors: [], fx: [], msgs: [] };
    b.send = (type, data = {}) => ws.send(JSON.stringify({ type, ...data }));
    b.next = (pred, ms = 4000) => new Promise((res, rej) => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        const hit = b.msgs.find(pred);
        if (hit) { clearInterval(iv); b.msgs = b.msgs.filter(m => m !== hit); res(hit); }
        else if (Date.now() - t0 > ms) { clearInterval(iv); rej(new Error(`${name}: timeout`)); }
      }, 10);
    });
    ws.onmessage = e => {
      const m = JSON.parse(e.data);
      b.msgs.push(m);
      if (m.type === 'state') b.state = m;
      if (m.type === 'error') b.errors.push(m.msg);
      if (m.type === 'fx') b.fx.push(...m.events);
    };
    ws.onopen = () => resolve(b);
  });
}
const me = b => b.state.players.find(p => p.id === b.state.you);
const P = (b, id) => b.state.players.find(p => p.id === id);

(async () => {
  const host = await bot('Teacher');
  host.send('create', { name: 'Teacher', spectator: true });
  const w = await host.next(m => m.type === 'welcome');
  const code = w.code;
  assert.strictEqual(code.length, 4);

  const a = await bot('Ava'); a.send('join', { code, name: 'Ava', color: '#e63946' });
  const b = await bot('Ben'); b.send('join', { code, name: 'Ben', color: '#e63946' }); // colour clash -> reassigned
  const c = await bot('Cai'); c.send('join', { code, name: 'Cai' });
  await wait(200);
  assert.strictEqual(host.state.players.length, 4);
  assert.notStrictEqual(P(host, a.state.you).color, P(host, b.state.you).color, 'colours unique');

  // non-host can't change settings
  a.send('settings', { key: 'fleetSize', value: 3 });
  await wait(80);
  assert.strictEqual(host.state.settings.fleetSize, 5);
  host.send('settings', { key: 'fleetSize', value: '3' });
  host.send('settings', { key: 'turnTime', value: '30' });
  host.send('settings', { key: 'startCoins', value: '200' });
  host.send('settings', { key: 'fleetSize', value: '99' }); // invalid, ignored
  await wait(150);
  assert.strictEqual(a.state.settings.fleetSize, 3);
  assert.deepStrictEqual(a.state.lengths, [3, 4, 5]);
  assert.strictEqual(a.state.settings.startCoins, 200);

  host.send('start');
  await wait(150);
  assert.strictEqual(a.state.phase, 'setup');

  // validation
  a.send('setFleet', { words: ['CAT', 'SHIP'] });
  a.send('setFleet', { words: ['CAT', 'SHIPS', 'OCEAN'] });
  a.send('setFleet', { words: ['C4T', 'SHIP', 'OCEAN'] });
  await wait(200);
  assert.ok(a.errors.length >= 3, 'validation errors: ' + a.errors.join(' | '));
  a.errors = [];

  // dictionary check: made-up words are rejected even when the online dictionary is unreachable
  a.send('setFleet', { words: ['XQZ', 'SHIP', 'OCEAN'] });
  await wait(3500);
  assert.ok(!me(a).ready, 'gibberish fleet must not be accepted');
  assert.ok(a.errors.some(e => /Not a real word: XQZ/.test(e)), 'dictionary error: ' + a.errors.join(' | '));
  a.errors = [];

  // Ava: CAT SHIP OCEAN  Ben: DOG FISH WHALE ; Cai left to auto-fill via forceStart
  a.send('setFleet', { words: ['cat', 'ship', 'ocean'] });
  b.send('setFleet', { words: ['DOG', 'FISH', 'WHALE'] });
  await wait(150); // known words are accepted straight from the offline word list
  assert.ok(me(a).ready && me(b).ready, 'a,b ready ' + a.errors.join(','));
  // others can't see Ava's fleet during setup; spectator can
  assert.strictEqual(P(b, a.state.you).fleet.length, 0);
  assert.strictEqual(P(host, a.state.you).fleet[0].letters.join(''), 'CAT');
  // reject Ben then re-ready
  host.send('reject', { id: b.state.you });
  await wait(100);
  assert.ok(!me(b).ready);
  b.send('setFleet', { words: ['DOG', 'FISH', 'WHALE'] });
  await wait(3800);
  host.send('forceStart');
  await wait(200);
  assert.strictEqual(a.state.phase, 'battle');
  assert.strictEqual(me(c).fleet.length, 3, 'cai auto fleet');
  const ids = { a: a.state.you, b: b.state.you, c: c.state.you };
  const bots = { [ids.a]: a, [ids.b]: b, [ids.c]: c };
  const turn = () => bots[a.state.turnId];

  // enemies see hidden letters
  assert.deepStrictEqual(P(b, ids.a).fleet[2].letters, [null, null, null, null, null]);
  assert.strictEqual(a.state.turnId, ids.a, 'Ava starts');

  // out of turn fire rejected
  b.errors = [];
  b.send('fire', { target: ids.a, letter: 'A' });
  await wait(80);
  assert.ok(b.errors.length === 1);

  // Ben buys a shield on 'H' and counter-battery anytime
  b.send('buy', { item: 'shield', letter: 'H' });
  b.send('buy', { item: 'counter' });
  await wait(100);
  assert.deepStrictEqual(me(b).shields, ['H']);
  assert.ok(me(b).counter);
  assert.strictEqual(me(b).coins, 200 - 40 - 55);

  // Ava buys double shot (her turn) and recon on Ben
  a.send('buy', { item: 'double' });
  a.send('buy', { item: 'recon', target: ids.b });
  await wait(100);
  assert.strictEqual(me(a).shotsLeft, 2);
  assert.deepStrictEqual(P(a, ids.b).fleet.map(s => s.vowels), [1, 1, 2]);
  assert.strictEqual(P(c, ids.b).fleet[0].vowels, null, 'recon private');

  // Ava fires H at Ben -> blocked by shield, counter fires H back at Ava (SHIP has H)
  a.send('fire', { target: ids.b, letter: 'H' });
  await wait(120);
  let ev = a.fx.filter(e => e.type === 'letter');
  assert.strictEqual(ev[0].result, 'blocked');
  assert.strictEqual(ev[1].result, 'hit');
  assert.strictEqual(ev[1].from, ids.b);
  assert.ok(P(c, ids.a).fleet[1].letters[1] === 'H', 'Ava SHIP H revealed publicly');
  assert.strictEqual(a.state.turnId, ids.a, 'still Ava (double shot)');
  // Ava fires A at Ben (WHALE) — no shield
  a.fx = [];
  a.send('fire', { target: ids.b, letter: 'A' });
  await wait(120);
  ev = a.fx.filter(e => e.type === 'letter');
  assert.strictEqual(ev.length, 1, 'counter already used');
  assert.deepStrictEqual(ev[0].hits, [{ ship: 2, pos: 2 }]);
  assert.strictEqual(a.state.turnId, ids.b, 'Ben turn now');
  assert.strictEqual(P(a, ids.b).history.A, 'hit');
  assert.strictEqual(P(a, ids.b).history.H, 'blocked');

  // Ben: extinguisher is his own repair; he fixes nothing yet (no damage on him? WHALE A hit)
  b.send('buy', { item: 'extinguisher', ship: 2, pos: 2 });
  await wait(100);
  assert.strictEqual(P(a, ids.b).fleet[2].letters[2], null, 'repaired -> hidden again');
  // Ben guesses Ava's ship word: torpedo CAT
  b.send('guessWord', { target: ids.a, ship: 0, word: 'cat' });
  await wait(120);
  assert.ok(P(c, ids.a).fleet[0].sunk);
  assert.strictEqual(P(c, ids.a).fleet[0].letters.join(''), 'CAT');
  assert.strictEqual(c.state.turnId, ids.c);

  // Cai buys sonar on Ava, then smoke test: Ava buys smoke, Cai fires at Ava -> evaded
  c.send('buy', { item: 'sonar', target: ids.a });
  a.send('buy', { item: 'smoke' });
  await wait(100);
  const sonarCount = P(c, ids.a).fleet.flatMap(s => s.sonar).filter(Boolean).length;
  assert.strictEqual(sonarCount, 1);
  assert.strictEqual(P(b, ids.a).fleet.flatMap(s => s.sonar).filter(Boolean).length, 0, 'sonar private');
  c.fx = [];
  c.send('fire', { target: ids.a, letter: 'O' });
  await wait(120);
  assert.strictEqual(c.fx.find(e => e.type === 'letter').result, 'evaded');

  // turn-only item rejected off-turn
  c.errors = [];
  c.send('buy', { item: 'barrage' });
  await wait(80);
  assert.ok(c.errors.length === 1);

  // Spent letters / repeated torpedo guesses are refused without using up the turn
  assert.strictEqual(a.state.turnId, ids.a);
  a.send('guessWord', { target: ids.b, ship: 1, word: 'DISH' }); // wrong (FISH)
  await wait(100);
  assert.strictEqual(a.state.turnId, ids.b);
  b.send('fire', { target: ids.a, letter: 'Z' }); // miss
  await wait(100);
  assert.strictEqual(a.state.turnId, ids.c);
  assert.ok(P(c, ids.a).spent.includes('Z'));
  c.errors = [];
  c.send('fire', { target: ids.a, letter: 'Z' }); // already missed Ava's fleet
  c.send('guessWord', { target: ids.b, ship: 1, word: 'DISH' }); // already guessed
  await wait(100);
  assert.strictEqual(c.errors.length, 2, 'spent shots refused: ' + c.errors.join(' | '));
  assert.strictEqual(c.state.turnId, ids.c, 'still Cai\'s turn');
  assert.strictEqual(me(c).shotsLeft, 1, 'no shot used');

  // Play out: each bot fires letters of enemies' words until game over
  const alphabet = 'EAOISHNTRLCDUPMGBFYWKVXZJQ'.split('');
  let guard = 0;
  while (a.state.phase === 'battle' && guard++ < 300) {
    const t = turn();
    const tid = t.state.you;
    const enemies = t.state.players.filter(p => !p.spectator && p.id !== tid && p.alive);
    const target = enemies[guard % enemies.length];
    if (guard === 5) t.send('buy', { item: 'barrage' });
    const tried = target.history;
    const L = alphabet.find(x => !tried[x]) || 'E';
    t.send('fire', { target: target.id, letter: L });
    await wait(40);
  }
  assert.strictEqual(a.state.phase, 'over', 'game finished');
  assert.ok(a.state.results.rows.length === 3);
  assert.ok(a.fx.some(e => e.type === 'gameover'));
  // all words revealed at end
  assert.ok(P(b, ids.a).fleet.every(s => s.letters.every(Boolean)));
  console.log('Results:', a.state.results.rows.map(r => `${r.name}:${r.final}`).join('  '), `(${guard} shots)`);

  // back to lobby, resume after disconnect
  host.send('toLobby');
  await wait(100);
  assert.strictEqual(a.state.phase, 'lobby');
  const tok = (await Promise.resolve(a.msgs.find(m => m.type === 'welcome'))) || null;
  a.ws.close();
  await wait(150);
  assert.strictEqual(P(host, ids.a).connected, false);
  const a2 = await bot('Ava2');
  a2.send('resume', { code, token: tok.token });
  await wait(150);
  assert.strictEqual(a2.state.you, ids.a);
  assert.strictEqual(P(host, ids.a).connected, true);

  // timer: turnTime 30 -> check turnRemaining present in a new battle
  host.send('start');
  await wait(100);
  host.send('forceStart');
  await wait(150);
  assert.ok(a2.state.turnRemaining > 25000);
  assert.strictEqual(a2.state.round, 1);

  // a brief disconnect mid-turn must not skip the turn (which gave the opponent extra shots)
  assert.strictEqual(a2.state.turnId, ids.a);
  await wait(4500);
  a2.ws.close();
  await wait(1200);
  assert.strictEqual(host.state.turnId, ids.a, 'turn kept during short disconnect');
  const a3 = await bot('Ava3');
  a3.send('resume', { code, token: tok.token });
  await wait(150);
  assert.strictEqual(a3.state.turnId, ids.a);

  console.log('host errors:', host.errors);
  console.log('✅ All simulation checks passed');
  server.close();
  process.exit(0);
})().catch(e => { console.error('❌', e); process.exit(1); });
