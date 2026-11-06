// Word Fleet — UI, networking and game flow on the client.
import { World } from './scene.js';
import { audio, sfx, unlockAudio } from './audio.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const VOWELS = 'AEIOU';
const COLORS = ['#e63946', '#f4a261', '#e9c46a', '#2a9d8f', '#4ea8de', '#9b5de5', '#f15bb5', '#90be6d'];
const SHIP_SETS = { short: [2, 3, 4, 5, 6, 7], standard: [3, 4, 5, 6, 7, 8], long: [4, 5, 6, 7, 8, 9] };

// ---------------------------------------------------------------- world
let world = null;
try { world = new World($('world')); }
catch (e) { console.error(e); document.body.style.background = 'linear-gradient(#3f8fde,#0d4a7a)'; }
const W = new Proxy({}, { get: (_, k) => (world && typeof world[k] === 'function') ? world[k].bind(world) : (world ? world[k] : () => Promise.resolve()) });

// ---------------------------------------------------------------- local ui state
const ui = {
  state: null, selTarget: null, selLetter: null, animating: false, fxQueue: [], pending: null,
  turnEnds: 0, lastTurnId: null, autoCam: true, setupKey: null, reveal: false, viewMap: false,
  firing: false, color: localStorage.getItem('wf-color') || COLORS[4], lastPhase: null,
};
audio.muted = localStorage.getItem('wf-muted') === '1';

// ---------------------------------------------------------------- networking
let ws = null;
const session = {
  get() { try { return JSON.parse(sessionStorage.getItem('wf-session')); } catch (e) { return null; } },
  set(v) { sessionStorage.setItem('wf-session', JSON.stringify(v)); },
  clear() { sessionStorage.removeItem('wf-session'); },
};
function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.onopen = () => {
    $('conn-status').classList.add('hidden');
    const s = session.get();
    if (s) ws.send(JSON.stringify({ type: 'resume', ...s }));
  };
  ws.onmessage = e => { try { onMessage(JSON.parse(e.data)); } catch (err) { console.error(err); } };
  ws.onclose = () => {
    if (session.get()) $('conn-status').classList.remove('hidden');
    setTimeout(connect, 1500);
  };
}
function send(type, data = {}) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type, ...data }));
  else toast('Connecting to the server… try again in a moment.', true);
}
setInterval(() => { if (ws && ws.readyState === 1) ws.send('{"type":"ping"}'); }, 20000);
connect();

function onMessage(m) {
  switch (m.type) {
    case 'welcome': session.set({ code: m.code, token: m.token }); break;
    case 'resumeFailed': session.clear(); showScreen('home'); break;
    case 'state':
      if (ui.animating) ui.pending = m; else applyState(m);
      break;
    case 'fx': ui.fxQueue.push(m.events); runFx(); break;
    case 'error':
      toast(m.msg, true); sfx('error');
      ui.firing = false;
      if ($('btn-ready').dataset.busy) { delete $('btn-ready').dataset.busy; if (ui.state) renderSetup(ui.state); }
      break;
    case 'toast': toast(m.msg); break;
    case 'checking': $('btn-ready').textContent = '📖 Checking dictionary…'; $('btn-ready').disabled = true; break;
    case 'suggest': {
      const inp = document.querySelector(`#setup-ships input[data-idx="${m.idx}"]`);
      if (inp && m.word) { inp.value = m.word; validateSetup(); }
      break;
    }
    case 'kicked': session.clear(); ui.state = null; showScreen('home'); toast('You were removed from the room by the host.', true); break;
    case 'left': session.clear(); ui.state = null; showScreen('home'); break;
  }
}

// ---------------------------------------------------------------- effects queue
const nameOf = id => (ui.state && ui.state.players.find(p => p.id === id)?.name) || 'Someone';
const isMe = id => ui.state && id === ui.state.you;
async function runFx() {
  if (ui.animating) return;
  ui.animating = true;
  while (ui.fxQueue.length) {
    const events = ui.fxQueue.shift();
    for (const ev of events) {
      try {
        if (ev.type === 'letter' || ev.type === 'word') sfx('fire');
        await Promise.race([
          W.playEvent(ev, {
            autoCam: ui.autoCam,
            onImpact: r => sfx(r === 'hit' ? 'boom' : r === 'blocked' ? 'shield' : 'splash'),
          }),
          new Promise(r => setTimeout(r, 7000)),
        ]);
        announce(ev);
      } catch (e) { console.error(e); }
    }
  }
  ui.animating = false;
  if (ui.pending) { const s = ui.pending; ui.pending = null; applyState(s); }
}

function announce(ev) {
  const from = isMe(ev.from) ? 'You' : nameOf(ev.from);
  const to = isMe(ev.to) ? 'you' : nameOf(ev.to);
  if (ev.type === 'letter') {
    const tag = ev.counter ? '↩️ Counter-fire! ' : '';
    if (ev.result === 'hit') {
      if (ev.sunk.length) {
        const s = ev.sunk[ev.sunk.length - 1];
        sfx('sink');
        bigMsg(`🚢 SUNK!<small>${tag}The word was <b>${esc(s.word)}</b>${s.def ? ' — ' + esc(s.def) : ''}</small>`, 'gold', 3200);
      } else bigMsg(`💥 HIT!<small>${tag}${esc(from)} hit ${esc(to)} with “${ev.letter}” × ${ev.hits.length}</small>`, '', 1700);
      if (isMe(ev.from)) sfx('coin');
    } else if (ev.result === 'blocked') bigMsg(`🛡️ BLOCKED<small>${tag}${esc(isMe(ev.to) ? 'Your' : nameOf(ev.to) + "'s")} shield stopped “${ev.letter}”</small>`, 'blue', 1700);
    else if (ev.result === 'evaded') bigMsg(`🌫️ LOST IN SMOKE<small>${esc(from)}'s “${ev.letter}” vanished</small>`, 'grey', 1700);
    else bigMsg(`💦 SPLASH<small>${tag}“${ev.letter}” — no new damage on ${esc(to)}</small>`, 'grey', 1400);
  } else if (ev.type === 'word') {
    if (ev.correct) { sfx('sink'); bigMsg(`🎯 TORPEDO!<small>${esc(from)} guessed <b>${esc(ev.word)}</b> and sank the ship!</small>`, 'gold', 3000); }
    else if (ev.result === 'evaded') bigMsg('🌫️ LOST IN SMOKE', 'grey', 1500);
    else bigMsg(`❌ WRONG WORD<small>${esc(ev.word)} is not the word</small>`, 'grey', 1600);
  } else if (ev.type === 'sonar') {
    sfx('ping'); bigMsg(`📡 SONAR<small>${esc(nameOf(ev.to))} has “${ev.letter}” in a ship — it's marked in blue</small>`, 'blue', 2200);
  } else if (ev.type === 'recon') {
    sfx('ping'); bigMsg('✈️ RECON COMPLETE<small>Vowel counts are shown next to each ship</small>', 'blue', 2000);
  } else if (ev.type === 'repair') {
    if (isMe(ev.who)) bigMsg('🧯 FIRE OUT!', 'blue', 1200);
  } else if (ev.type === 'smoke') {
    bigMsg('🌫️ SMOKE SCREEN UP', 'grey', 1200);
  } else if (ev.type === 'gameover') {
    sfx('win');
  }
}

// ---------------------------------------------------------------- toasts / big messages / modal
function toast(msg, err) {
  const d = document.createElement('div');
  d.className = 'toast' + (err ? ' err' : '');
  d.textContent = msg;
  $('toasts').appendChild(d);
  setTimeout(() => d.remove(), 3800);
}
let bigTimer = null;
function bigMsg(html, cls = '', ms = 1600) {
  const el = $('big-msg');
  el.className = 'big-msg ' + cls;
  el.innerHTML = html;
  void el.offsetWidth;
  clearTimeout(bigTimer);
  bigTimer = setTimeout(() => el.classList.add('hidden'), ms);
}
function openModal(title, bodyHtml, onBind) {
  $('modal-title').textContent = title;
  $('modal-body').innerHTML = bodyHtml;
  $('modal').classList.remove('hidden');
  if (onBind) onBind($('modal-body'));
}
function closeModal() { $('modal').classList.add('hidden'); $('modal-body').innerHTML = ''; }
$('modal-cancel').onclick = closeModal;
$('modal').addEventListener('pointerdown', e => { if (e.target === $('modal')) closeModal(); });

// ---------------------------------------------------------------- screens
const SCREENS = { home: 'screen-home', lobby: 'screen-lobby', setup: 'screen-setup', battle: 'hud', over: 'screen-over' };
function showScreen(name) {
  for (const [k, id] of Object.entries(SCREENS)) $(id).classList.toggle('hidden', k !== name);
  if (name !== 'battle') W.setViewShift(0);
  $('btn-back-results').classList.add('hidden');
  if (name === 'home' && world) { world.idleSpin = true; }
}

// ---------------------------------------------------------------- HOME
function renderColorPick(el, current, taken, onPick) {
  el.innerHTML = COLORS.map(c => `<button style="background:${c}" data-c="${c}" class="${c === current ? 'sel' : ''} ${taken.includes(c) && c !== current ? 'taken' : ''}" title="${c}"></button>`).join('');
  el.querySelectorAll('button').forEach(b => b.onclick = () => { if (!b.classList.contains('taken')) onPick(b.dataset.c); });
}
function homeColors() { renderColorPick($('color-pick'), ui.color, [], c => { ui.color = c; localStorage.setItem('wf-color', c); homeColors(); }); }
homeColors();
$('in-name').value = localStorage.getItem('wf-name') || '';
const qsRoom = new URLSearchParams(location.search).get('room');
if (qsRoom) $('in-code').value = qsRoom.toUpperCase().slice(0, 4);
function myName() {
  const n = $('in-name').value.trim();
  if (!n) { toast('Type your captain name first!', true); $('in-name').focus(); return null; }
  localStorage.setItem('wf-name', n);
  return n;
}
$('btn-create').onclick = () => { unlockAudio(); const name = myName(); if (name) send('create', { name, color: ui.color, spectator: $('in-spectator').checked }); };
$('btn-join').onclick = () => {
  unlockAudio();
  const name = myName(); if (!name) return;
  const code = $('in-code').value.trim().toUpperCase();
  if (code.length !== 4) return toast('Enter the 4-letter room code.', true);
  send('join', { code, name, color: ui.color });
};
$('in-code').addEventListener('keydown', e => { if (e.key === 'Enter') $('btn-join').click(); });
$('btn-howto').onclick = showHowTo;

function showHowTo() {
  openModal('📖 How to play Word Fleet', `<div class="howto"><ol>
    <li><b>Hide your words.</b> Every ship is a secret word. A 5-letter ship needs a 5-letter word.</li>
    <li><b>Take turns.</b> On your turn, pick an enemy fleet and fire a <b>letter</b>.</li>
    <li><b>Every ship</b> in that fleet with your letter is hit — every copy of the letter! So try not to use the same letters in lots of ships.</li>
    <li>Hit letters catch fire and are shown to everyone. Sink a ship by hitting all its letters…</li>
    <li>…or fire a <b>torpedo</b>: guess the whole word. Right = instant sink + bonus coins!</li>
    <li>Earn 🪙 coins for hits and sinks. Spend them in the <b>shop</b> any time: shields, extinguishers, smoke screens, sonar and more.</li>
    <li>The last fleet afloat wins — or the top score when the rounds run out.</li>
  </ol><p>Tips: use the keyboard to pick letters and <b>Enter</b> to fire. Drag to look around, scroll to zoom, right-drag to pan, and click a fleet to target it.</p></div>`);
}

// ---------------------------------------------------------------- APPLY STATE
function applyState(s) {
  const prev = ui.state;
  ui.state = s;
  const me = s.players.find(p => p.id === s.you);
  if (!me) return;
  if (s.phase !== 'setup') ui.setupKey = null;
  if (s.phase !== 'over') ui.viewMap = false;
  W.setRevealAll(!!(me.spectator && ui.reveal));
  W.sync(s);

  // turn change
  ui.turnEnds = s.turnRemaining != null ? Date.now() + s.turnRemaining : 0;
  if (s.phase === 'battle' && s.turnId !== ui.lastTurnId) {
    ui.firing = false;
    if (s.turnId === s.you) { sfx('turn'); bigMsg('🎯 YOUR TURN!<small>Pick a target and a letter</small>', 'gold', 1500); }
    ui.selLetter = null;
  }
  ui.lastTurnId = s.phase === 'battle' ? s.turnId : null;
  if (prev && prev.players.find(p => p.id === s.you)?.shotsLeft !== me.shotsLeft) ui.firing = false;

  if (s.phase === 'lobby') { showScreen('lobby'); renderLobby(s, me); }
  else if (s.phase === 'setup') { showScreen('setup'); renderSetup(s); }
  else if (s.phase === 'battle') { showScreen('battle'); renderHud(s, me); }
  else if (s.phase === 'over') {
    if (ui.lastPhase !== 'over') ui.viewMap = false;
    if (ui.viewMap) { showScreen(null); $('btn-back-results').classList.remove('hidden'); }
    else showScreen('over');
    renderOver(s, me);
  }
  if (ui.lastPhase !== s.phase && (s.phase === 'battle')) W.overview();
  ui.lastPhase = s.phase;
}

// ---------------------------------------------------------------- LOBBY
const SETTING_DEFS = [
  { key: 'maxRounds', label: 'Rounds', opts: [0, 5, 10, 15, 20, 25, 30], fmt: v => v ? `${v} rounds` : 'Until one fleet is left' },
  { key: 'turnTime', label: 'Turn timer', opts: [0, 30, 45, 60, 90, 120], fmt: v => v ? `${v} seconds` : 'No timer' },
  { key: 'fleetSize', label: 'Fleet size', opts: [3, 4, 5, 6], fmt: v => `${v} ships` },
  { key: 'shipSet', label: 'Word lengths', opts: ['short', 'standard', 'long'], fmt: v => ({ short: 'Short (2+ letters)', standard: 'Standard (3+ letters)', long: 'Long (4+ letters)' })[v] },
  { key: 'startCoins', label: 'Starting coins', opts: [0, 50, 100, 150, 200], fmt: v => `🪙 ${v}` },
  { key: 'income', label: 'Coins per turn', opts: [0, 5, 10, 15], fmt: v => `🪙 ${v}` },
  { key: 'shop', label: 'Shop & power-ups', opts: ['all', 'defense', 'attack', 'off'], fmt: v => ({ all: 'All power-ups', defense: 'Defences only', attack: 'Attacks only', off: 'No shop' })[v] },
  { key: 'dictionary', label: 'Dictionary check', opts: [true, false], fmt: v => v ? 'On — real words only' : 'Off' },
  { key: 'wordGuess', label: 'Torpedo (guess word)', opts: [true, false], fmt: v => v ? 'Allowed' : 'Off' },
];
function renderLobby(s, me) {
  const isHost = s.hostId === s.you;
  $('lobby-code').textContent = s.code;
  const comps = s.players.filter(p => !p.spectator);
  $('lobby-players').innerHTML = s.players.map(p => `
    <li><span class="dot" style="background:${p.spectator ? '#888' : p.color}"></span>${esc(p.name)}${p.id === s.you ? ' (you)' : ''}
      <span class="tag">${p.spectator ? '👩‍🏫 teacher' : ''} ${p.id === s.hostId ? '⭐ host' : ''} ${p.connected ? '' : '<span class="offline">offline</span>'}</span>
      ${isHost && p.id !== s.you ? `<button class="kick" data-id="${p.id}" title="Remove">✖</button>` : ''}</li>`).join('')
    + (comps.length < 6 ? `<li class="muted" style="background:none">${6 - comps.length} spot${6 - comps.length > 1 ? 's' : ''} left · join at <b>${esc(location.host)}</b></li>` : '');
  $('lobby-players').querySelectorAll('.kick').forEach(b => b.onclick = () => send('kick', { id: b.dataset.id }));
  if (!me.spectator) renderColorPick($('lobby-colors'), me.color, s.players.map(p => p.color), c => { ui.color = c; localStorage.setItem('wf-color', c); send('color', { color: c }); });
  else $('lobby-colors').innerHTML = '';
  $('host-badge').textContent = isHost ? 'you are the host' : 'host only';
  const sizes = SHIP_SETS[s.settings.shipSet].slice(0, s.settings.fleetSize);
  $('lobby-settings').innerHTML = SETTING_DEFS.map(d => `
    <div class="setting"><label>${d.label}</label>
      <select data-key="${d.key}" ${isHost ? '' : 'disabled'}>
        ${d.opts.map(o => `<option value="${o}" ${String(o) === String(s.settings[d.key]) ? 'selected' : ''}>${d.fmt(o)}</option>`).join('')}
      </select></div>`).join('')
    + `<div class="setting" style="grid-column:1/-1"><label>Ships</label><div class="muted">${sizes.map(n => `${s.shipNames[n]} (${n})`).join(' · ')}</div></div>`;
  $('lobby-settings').querySelectorAll('select').forEach(sel => sel.onchange = () => send('settings', { key: sel.dataset.key, value: sel.value }));
  $('btn-start').classList.toggle('hidden', !isHost);
  $('btn-start').disabled = comps.length < 2;
  $('btn-start').textContent = comps.length < 2 ? 'Need 2+ captains' : 'Start ⚓';
  $('lobby-wait').classList.toggle('hidden', isHost);
}
$('btn-start').onclick = () => send('start');
$('btn-leave').onclick = () => send('leave');

// ---------------------------------------------------------------- SETUP
function renderSetup(s) {
  const me = s.players.find(p => p.id === s.you);
  const isHost = s.hostId === s.you;
  const key = `${s.code}:${s.lengths.join(',')}`;
  $('setup-host').classList.toggle('hidden', !isHost);
  const form = !me.spectator;
  $('setup-ships').classList.toggle('hidden', !form);
  $('btn-ready').classList.toggle('hidden', !form);
  $('btn-random-all').classList.toggle('hidden', !form);
  $('setup-letters').classList.toggle('hidden', !form);
  if (form && ui.setupKey !== key) {
    ui.setupKey = key;
    $('setup-ships').innerHTML = s.lengths.map((len, i) => `
      <div class="ship-row">
        <div class="sname">${s.shipNames[len]}<small>${len} letters</small></div>
        <input data-idx="${i}" data-len="${len}" maxlength="${len}" placeholder="${'_'.repeat(len).split('').join(' ')}" autocomplete="off" spellcheck="false" />
        <button class="btn ghost" data-dice="${i}" title="Random word">🎲</button>
      </div>`).join('');
    $('setup-ships').querySelectorAll('input').forEach(inp => {
      inp.oninput = () => { inp.value = inp.value.toUpperCase().replace(/[^A-Z]/g, ''); validateSetup(); };
      inp.onkeydown = e => { if (e.key === 'Enter') { const n = $('setup-ships').querySelector(`input[data-idx="${+inp.dataset.idx + 1}"]`); n ? n.focus() : $('btn-ready').click(); } };
    });
    $('setup-ships').querySelectorAll('[data-dice]').forEach(b => b.onclick = () => {
      const i = +b.dataset.dice;
      send('suggest', { len: s.lengths[i], idx: i, avoid: setupWords() });
    });
    // keep words already locked in (e.g. after reconnect)
    if (me.fleet.length === s.lengths.length) me.fleet.forEach((f, i) => { const inp = $('setup-ships').querySelector(`input[data-idx="${i}"]`); if (inp) inp.value = f.letters.join(''); });
    validateSetup();
  }
  if (form) {
    $('setup-ships').querySelectorAll('input, button').forEach(el => el.disabled = me.ready);
    $('btn-random-all').disabled = me.ready;
    const btn = $('btn-ready');
    delete btn.dataset.busy;
    btn.disabled = !!me.checking;
    btn.textContent = me.checking ? '📖 Checking dictionary…' : me.ready ? '✏️ Change my words' : 'Ready! ⚓';
    btn.className = me.ready ? 'btn ghost big' : 'btn gold big';
  }
  const comps = s.players.filter(p => !p.spectator);
  let html = comps.map(p => `<span class="chip"><span class="dot" style="background:${p.color}"></span>${esc(p.name)} ${p.ready ? '✅' : p.checking ? '📖' : '⏳'}</span>`).join('');
  if (me.spectator) {
    html += `<div class="spec-fleet">${comps.map(p => `<div class="sf"><b style="color:${p.color}">${esc(p.name)}</b><br>${p.ready ? p.fleet.map(f => `<b>${f.letters.join('')}</b>`).join(', ') : '<span class="muted">choosing…</span>'}
      ${p.ready ? `<br><button class="btn ghost small" data-reject="${p.id}">↩ Ask to change</button>` : ''}</div>`).join('')}</div>`;
  }
  $('setup-status').innerHTML = html;
  $('setup-status').querySelectorAll('[data-reject]').forEach(b => b.onclick = () => send('reject', { id: b.dataset.reject }));
}
function setupWords() { return [...$('setup-ships').querySelectorAll('input')].map(i => i.value.trim().toUpperCase()); }
function validateSetup() {
  const inputs = [...$('setup-ships').querySelectorAll('input')];
  const words = inputs.map(i => i.value);
  inputs.forEach(i => {
    const ok = i.value.length === +i.dataset.len;
    const dup = ok && words.filter(w => w === i.value).length > 1;
    i.classList.toggle('ok', ok && !dup); i.classList.toggle('bad', i.value.length > 0 && (!ok || dup));
  });
  // shared-letter warning (teaching point: repeated letters are risky)
  const counts = {};
  words.forEach(w => new Set(w.split('')).forEach(c => { if (c) counts[c] = (counts[c] || 0) + 1; }));
  const risky = Object.entries(counts).filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]);
  const total = words.join('').length;
  $('setup-letters').innerHTML = total ? (risky.length
    ? `⚠️ Risky letters: ${risky.map(([c, n]) => `<b>${c}</b> is in ${n} ships`).join(', ')}. One shot could damage all of them!`
    : '👍 Nice — no letter appears in 3 or more ships.') : '';
}
$('btn-ready').onclick = () => {
  const me = ui.state.players.find(p => p.id === ui.state.you);
  if (me.ready) return send('unready');
  const words = setupWords();
  const lens = ui.state.lengths;
  const bad = words.findIndex((w, i) => w.length !== lens[i]);
  if (bad >= 0) return toast(`Ship ${bad + 1} needs a ${lens[bad]}-letter word.`, true);
  $('btn-ready').dataset.busy = '1';
  $('btn-ready').disabled = true;
  send('setFleet', { words });
};
$('btn-random-all').onclick = () => ui.state.lengths.forEach((len, i) => setTimeout(() => send('suggest', { len, idx: i, avoid: setupWords() }), i * 60));
$('btn-force').onclick = () => send('forceStart');
$('btn-cancel-setup').onclick = () => send('endGame');

// ---------------------------------------------------------------- BATTLE HUD
function opponents(s) { return s.players.filter(p => !p.spectator && p.id !== s.you); }
function ensureTarget(s, me) {
  const opp = opponents(s);
  let t = opp.find(p => p.id === ui.selTarget);
  const canTarget = me.spectator ? opp : opp.filter(p => p.alive);
  if (!t || (!me.spectator && !t.alive)) t = canTarget[0] || opp[0];
  ui.selTarget = t ? t.id : null;
  W.setSelected(ui.selTarget);
  return t;
}
function selectTarget(id) {
  const s = ui.state; if (!s || s.phase !== 'battle') return;
  const p = s.players.find(x => x.id === id);
  if (!p || p.spectator || p.id === s.you) return;
  const me = s.players.find(x => x.id === s.you);
  if (!p.alive && !me.spectator) return toast(`${p.name}'s fleet has already sunk.`);
  ui.selTarget = id;
  W.setSelected(id);
  sfx('click');
  renderHud(s, me);
}
if (world) world.onPick = id => { if (ui.state && ui.state.phase === 'battle') { selectTarget(id); W.focus(id); } };

function tilesHtml(f, opts = {}) {
  return `<div class="tiles">${f.letters.map((ch, j) => {
    let cls = 'tile';
    if (f.sunk) cls += ' sunk';
    else if (f.hits[j]) cls += ' hit' + (opts.fixable ? ' fixable' : '');
    else if (opts.own) cls += ' ok';
    else if (ch && f.sonar[j]) cls += ' sonar';
    else cls += ' blank';
    return `<span class="${cls}" data-ship="${opts.idx}" data-pos="${j}">${ch && (opts.own || f.hits[j] || f.sonar[j] || f.sunk) ? ch : ''}</span>`;
  }).join('')}</div>`;
}

function renderHud(s, me) {
  const isMyTurn = s.turnId === s.you;
  const cur = s.players.find(p => p.id === s.turnId);
  $('round-pill').textContent = `Round ${s.round}${s.settings.maxRounds ? ' / ' + s.settings.maxRounds : ''}`;
  $('turn-banner').classList.toggle('mine', isMyTurn);
  $('turn-text').innerHTML = isMyTurn
    ? `🎯 YOUR TURN${me.shotsLeft > 1 ? ` — ${me.shotsLeft} shots` : ''}${me.barrage ? ' · 💣 Barrage loaded' : ''}`
    : cur ? `<span style="color:${cur.color}">${esc(cur.name)}</span> is aiming…` : '';
  $('timer-bar').classList.toggle('hidden', !s.settings.turnTime);

  // fleets list
  const comps = s.players.filter(p => !p.spectator);
  $('fleet-list').innerHTML = comps.map(p => `
    <div class="fcard ${p.id === ui.selTarget ? 'sel' : ''} ${p.id === s.turnId ? 'turn' : ''} ${p.alive ? '' : 'dead'} ${p.id === s.you ? 'me' : ''}" data-id="${p.id}">
      <span class="dot" style="background:${p.color}"></span>
      <div><div class="nm">${esc(p.name)}${p.id === s.you ? ' (you)' : ''}</div>
        <div class="sub">🪙 ${p.coins} · ⭐ ${p.score} ${p.connected ? '' : '<span class="offline">offline</span>'}</div></div>
      <div class="ships">${p.alive ? `⛴ ${p.afloat}/${p.fleet.length}` : '☠️'}</div>
    </div>`).join('');
  $('fleet-list').querySelectorAll('.fcard').forEach(el => el.onclick = () => { selectTarget(el.dataset.id); if (el.dataset.id !== s.you) W.focus(el.dataset.id); });

  // my fleet + defences
  if (me.spectator) {
    $('my-panel').innerHTML = `<h4>👩‍🏫 Teacher view</h4>
      <label class="check"><input type="checkbox" id="chk-reveal" ${ui.reveal ? 'checked' : ''}/> Reveal all words (don't project this!)</label>
      ${s.hostId === s.you ? '<div class="row"><button class="btn ghost small" id="btn-end-spec">End battle now</button></div>' : ''}`;
    $('chk-reveal').onchange = e => { ui.reveal = e.target.checked; W.setRevealAll(ui.reveal); W.sync(s); renderHud(s, me); };
    const be = $('btn-end-spec'); if (be) be.onclick = confirmEnd;
    $('shop-panel').classList.add('hidden');
  } else {
    $('shop-panel').classList.toggle('hidden', s.settings.shop === 'off');
    $('my-coins').textContent = `🪙 ${me.coins}`;
    $('my-fleet').innerHTML = me.fleet.map((f, i) => `<div class="ship-line ${f.sunk ? 'sunk' : ''}"><span class="sl">${f.name}</span>${tilesHtml(f, { own: true, idx: i })}</div>`).join('');
    const defs = [];
    me.shields.forEach(L => defs.push(`🛡️ ${L}`));
    if (me.smoke) defs.push('🌫️ Smoke');
    if (me.counter) defs.push('↩️ Counter');
    if (me.barrage) defs.push('💣 Barrage');
    if (!me.alive) defs.push('☠️ Fleet sunk');
    $('my-defenses').innerHTML = defs.map(d => `<span class="def">${d}</span>`).join('');
    renderShop(s, me, isMyTurn);
  }

  // target panel
  const t = ensureTarget(s, me);
  if (!t) { $('target-head').innerHTML = '<span class="muted">No targets</span>'; return; }
  const canAct = isMyTurn && me.alive && me.shotsLeft > 0 && !ui.firing && t.alive;
  const guessOn = s.settings.wordGuess;
  $('target-head').innerHTML = `<div><span class="muted">Target:</span> <span class="tname" style="color:${t.color}">${esc(t.name)}</span>
      <span class="muted">· ⛴ ${t.afloat}/${t.fleet.length} afloat</span></div>
    <div class="muted tiny">${opponents(s).length > 1 ? 'Click a fleet (or the ocean) to change target' : ''}</div>`;
  $('target-fleet').innerHTML = t.fleet.map((f, i) => `
    <div class="ship-line ${f.sunk ? 'sunk' : ''} ${canAct && guessOn && !f.sunk ? 'guessable' : ''}" data-ship="${i}">
      <span class="sl">${f.name} (${f.len})</span>
      ${tilesHtml(f, { own: me.spectator && ui.reveal, idx: i })}
      ${f.vowels != null ? `<span class="vowel-chip">✈️ ${f.vowels} vowel${f.vowels === 1 ? '' : 's'}</span>` : ''}
      ${f.wrong.length ? `<span class="wrong" title="Wrong guesses">${f.wrong.map(esc).join(' ')}</span>` : ''}
      ${f.sunk && f.def ? `<span class="muted tiny" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f.def)}</span>` : ''}
      ${canAct && guessOn && !f.sunk ? '<button class="guess-btn">🎯 Guess word</button>' : ''}
    </div>`).join('');
  $('target-fleet').querySelectorAll('.ship-line.guessable').forEach(el => el.onclick = () => openGuess(t, +el.dataset.ship));

  // keyboard
  const hist = t.history || {};
  const showKeys = !me.spectator;
  $('keyboard').classList.toggle('hidden', !showKeys);
  $('btn-fire').classList.toggle('hidden', !showKeys);
  $('keyboard').innerHTML = ALPHA.map(L => `<button class="key ${hist[L] || ''} ${L === ui.selLetter ? 'sel' : ''} ${VOWELS.includes(L) ? 'vowel' : ''}" data-l="${L}" ${me.alive ? '' : 'disabled'} title="${hist[L] ? 'Already fired: ' + hist[L] : ''}">${L}</button>`).join('');
  $('keyboard').querySelectorAll('.key').forEach(k => k.onclick = () => { ui.selLetter = k.dataset.l; sfx('click'); renderHud(ui.state, ui.state.players.find(p => p.id === ui.state.you)); });
  const fire = $('btn-fire');
  fire.disabled = !(canAct && ui.selLetter);
  fire.textContent = ui.selLetter ? `🔥 FIRE “${ui.selLetter}”` : '🔥 FIRE';
  let hint = '';
  if (me.spectator) hint = 'Spectating';
  else if (!me.alive) hint = 'Your fleet has sunk — you can still watch the battle.';
  else if (!isMyTurn) hint = `Waiting for ${cur ? esc(cur.name) : 'next captain'}… you can still use the shop.`;
  else if (!ui.selLetter) hint = 'Choose a letter (or press a key)' + (guessOn ? ', or click a ship to guess its word.' : '.');
  else if (hist[ui.selLetter] === 'miss') hint = `“${ui.selLetter}” already missed this fleet — are you sure?`;
  else if (hist[ui.selLetter] === 'hit') hint = `“${ui.selLetter}” already hit here. Fire again only if a fire was put out.`;
  else if (hist[ui.selLetter] === 'blocked') hint = `A shield blocked “${ui.selLetter}” before — it's gone now, so try again!`;
  else hint = `Fire “${ui.selLetter}” at ${esc(t.name)}${me.barrage ? ' — and everyone else (Barrage)!' : ''}`;
  $('fire-hint').innerHTML = hint;
  renderLog(s);
  if (window.innerWidth > 820) W.setViewShift(Math.max(0, Math.round(($('bottom').offsetHeight - 70) / 2)));
}

function renderShop(s, me, isMyTurn) {
  const allowed = k => s.settings.shop === 'all' || s.settings.shop === k;
  const list = Object.entries(s.items).filter(([, it]) => allowed(it.kind));
  $('shop').innerHTML = list.map(([id, it]) => {
    let off = !me.alive || me.coins < it.cost || (it.turnOnly && !isMyTurn);
    if (id === 'smoke' && me.smoke) off = true;
    if (id === 'counter' && me.counter) off = true;
    if (id === 'barrage' && me.barrage) off = true;
    if (id === 'shield' && me.shields.length >= 3) off = true;
    if (id === 'extinguisher' && !me.fleet.some(f => !f.sunk && f.hits.some(Boolean))) off = true;
    return `<div class="shop-item kind-${it.kind}"><div class="ic">${it.icon}</div>
      <div><div class="nm">${it.name}</div><div class="ds">${it.desc}</div></div>
      <button class="btn gold" data-buy="${id}" ${off ? 'disabled' : ''}>🪙${it.cost}</button></div>`;
  }).join('');
  $('shop').querySelectorAll('[data-buy]').forEach(b => b.onclick = () => buyFlow(b.dataset.buy));
}

function buyFlow(id) {
  const s = ui.state; const me = s.players.find(p => p.id === s.you);
  const item = s.items[id];
  if (id === 'shield') {
    // count how many of my undamaged letters each shield would protect
    const cnt = {};
    me.fleet.forEach(f => { if (!f.sunk) f.letters.forEach((c, j) => { if (!f.hits[j]) cnt[c] = (cnt[c] || 0) + 1; }); });
    openModal('🛡️ Shield a letter', `<p>The next attack using this letter on your fleet is blocked. Numbers show how many of your letters it protects.</p>
      <div class="grid-letters">${ALPHA.map(L => `<button class="key ${cnt[L] ? '' : 'miss'}" data-l="${L}" ${me.shields.includes(L) ? 'disabled' : ''}>${L}${cnt[L] ? `<sup style="font-size:10px;margin-left:2px">${cnt[L]}</sup>` : ''}</button>`).join('')}</div>`,
      body => body.querySelectorAll('[data-l]').forEach(b => b.onclick = () => { send('buy', { item: id, letter: b.dataset.l }); sfx('coin'); closeModal(); }));
  } else if (id === 'extinguisher') {
    openModal('🧯 Put out a fire', `<p>Click a burning letter. It will be repaired and hidden from enemies again.</p>
      ${me.fleet.map((f, i) => f.sunk ? '' : `<div class="ship-line"><span class="sl">${f.name}</span>${tilesHtml(f, { own: true, idx: i, fixable: true })}</div>`).join('')}`,
      body => body.querySelectorAll('.tile.hit').forEach(t => t.onclick = () => { send('buy', { item: id, ship: +t.dataset.ship, pos: +t.dataset.pos }); sfx('coin'); closeModal(); }));
  } else if (id === 'recon' || id === 'sonar') {
    const opp = opponents(s).filter(p => p.alive);
    openModal(`${item.icon} ${item.name}`, `<p>${item.desc}</p>` + opp.map(p => `<button class="btn ghost opt" data-t="${p.id}"><span style="color:${p.color}">●</span> ${esc(p.name)} ${p.id === ui.selTarget ? '(current target)' : ''}</button>`).join(''),
      body => body.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { send('buy', { item: id, target: b.dataset.t }); sfx('coin'); closeModal(); }));
  } else {
    send('buy', { item: id }); sfx('coin');
  }
}

function openGuess(t, shipIdx) {
  const f = t.fleet[shipIdx];
  openModal(`🎯 Torpedo — guess ${esc(t.name)}'s ${f.name}`, `
    <p>Type the whole ${f.len}-letter word. If you're right the ship sinks instantly (+bonus coins). If you're wrong, your shot is used up.</p>
    <div class="pattern">${tilesHtml(f, { idx: shipIdx })}</div>
    ${f.wrong.length ? `<p>Already tried: <span class="wrong">${f.wrong.map(esc).join(', ')}</span></p>` : ''}
    <input id="guess-in" maxlength="${f.len}" placeholder="${'_ '.repeat(f.len).trim()}" style="text-transform:uppercase;letter-spacing:8px;text-align:center" autocomplete="off" spellcheck="false" />
    <div class="row end"><button class="btn red" id="guess-go">🚀 Launch torpedo</button></div>`, body => {
    const inp = body.querySelector('#guess-in');
    const pre = f.letters.map(c => c || '').join('');
    inp.oninput = () => { inp.value = inp.value.toUpperCase().replace(/[^A-Z]/g, ''); };
    setTimeout(() => inp.focus(), 50);
    const go = () => {
      const w = inp.value.trim();
      if (w.length !== f.len) return toast(`Needs ${f.len} letters.`, true);
      const clash = f.letters.findIndex((c, j) => c && w[j] !== c);
      if (clash >= 0 && !confirm(`Letter ${clash + 1} should be "${f.letters[clash]}". Fire anyway?`)) return;
      ui.firing = true;
      send('guessWord', { target: t.id, ship: shipIdx, word: w });
      closeModal();
    };
    body.querySelector('#guess-go').onclick = go;
    inp.onkeydown = e => { if (e.key === 'Enter') go(); };
    void pre;
  });
}

function doFire() {
  const s = ui.state; if (!s || s.phase !== 'battle') return;
  const me = s.players.find(p => p.id === s.you);
  if (s.turnId !== s.you || !ui.selLetter || !ui.selTarget || ui.firing || me.shotsLeft <= 0) return;
  ui.firing = true;
  send('fire', { target: ui.selTarget, letter: ui.selLetter });
  ui.selLetter = null;
  renderHud(s, me);
}
$('btn-fire').onclick = doFire;

document.addEventListener('keydown', e => {
  if (!ui.state || ui.state.phase !== 'battle') return;
  if (!$('modal').classList.contains('hidden')) { if (e.key === 'Escape') closeModal(); return; }
  if (e.target.tagName === 'INPUT') return;
  const me = ui.state.players.find(p => p.id === ui.state.you);
  if (me.spectator) return;
  if (/^[a-zA-Z]$/.test(e.key) && !e.ctrlKey && !e.metaKey) { ui.selLetter = e.key.toUpperCase(); sfx('click'); renderHud(ui.state, me); }
  else if (e.key === 'Enter') doFire();
  else if (e.key === 'Escape') { ui.selLetter = null; renderHud(ui.state, me); }
});

let logSeen = 0;
function renderLog(s) {
  const box = $('log');
  const atBottom = box.scrollTop + box.clientHeight >= box.scrollHeight - 30;
  box.innerHTML = s.log.map(e => `<div class="le ${e.kind} ${e.to ? 'private' : ''}">${e.to ? '🔒 ' : ''}${esc(e.text)}</div>`).join('');
  const last = s.log.length ? s.log[s.log.length - 1].id : 0;
  if (atBottom || last !== logSeen) box.scrollTop = box.scrollHeight;
  logSeen = last;
}

// timer
setInterval(() => {
  const s = ui.state;
  if (!s || s.phase !== 'battle' || !s.settings.turnTime || !ui.turnEnds) return;
  const total = s.settings.turnTime * 1000 + 3000;
  const left = Math.max(0, ui.turnEnds - Date.now());
  $('timer-fill').style.width = `${Math.min(100, (left / total) * 100)}%`;
  $('timer-fill').classList.toggle('low', left < 10000);
}, 200);

// top tools
$('btn-cam-overview').onclick = () => { W.overview(); };
$('btn-cam-me').onclick = () => { if (ui.state) W.focus(ui.state.you); };
$('btn-autocam').onclick = () => { ui.autoCam = !ui.autoCam; $('btn-autocam').classList.toggle('on', ui.autoCam); toast(ui.autoCam ? 'Auto camera on' : 'Auto camera off'); };
function soundBtn() { $('btn-sound').textContent = audio.muted ? '🔇' : '🔊'; }
soundBtn();
$('btn-sound').onclick = () => { audio.muted = !audio.muted; localStorage.setItem('wf-muted', audio.muted ? '1' : '0'); unlockAudio(); soundBtn(); };
function confirmEnd() { if (confirm('End the battle now and show the results?')) send('endGame'); }
$('btn-menu').onclick = () => {
  const s = ui.state; const isHost = s && s.hostId === s.you;
  openModal('☰ Menu', `
    <button class="btn ghost opt" id="m-howto">📖 How to play</button>
    ${isHost ? '<button class="btn ghost opt" id="m-end">🏁 End battle now (host)</button>' : ''}
    <button class="btn ghost opt" id="m-leave">🚪 Leave the game</button>
    <p>Room code: <b>${s ? s.code : ''}</b></p>`, body => {
    body.querySelector('#m-howto').onclick = showHowTo;
    const e = body.querySelector('#m-end'); if (e) e.onclick = () => { closeModal(); confirmEnd(); };
    body.querySelector('#m-leave').onclick = () => { if (confirm('Leave this game? Your fleet stays on the map.')) { closeModal(); send('leave'); } };
  });
};

// ---------------------------------------------------------------- OVER
function renderOver(s, me) {
  const r = s.results;
  if (!r) return;
  const w = r.rows[0];
  $('over-title').innerHTML = w && w.id === s.you ? '🏆 VICTORY!' : `🏆 ${esc(w ? w.name : '')} WINS!`;
  $('over-reason').textContent = { last: 'Last fleet afloat!', rounds: 'All rounds played — highest score wins.', host: 'The host ended the battle.' }[r.reason] || '';
  $('over-table').innerHTML = `<tr><th>#</th><th>Captain</th><th>Hits</th><th>Ships sunk</th><th>Torpedoes</th><th>Ships afloat</th><th>Final score</th></tr>` +
    r.rows.map((row, i) => `<tr class="${i === 0 ? 'first' : ''}"><td>${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</td>
      <td><span style="color:${row.color}">●</span> ${esc(row.name)}${row.id === s.you ? ' (you)' : ''}</td><td>${row.hits}</td><td>${row.sinks}</td><td>${row.words}</td><td>${row.afloat}</td><td>${row.final}</td></tr>`).join('');
  const comps = s.players.filter(p => !p.spectator);
  $('over-words').innerHTML = comps.map(p => p.fleet.map(f => `<div class="ow"><span style="color:${p.color}">●</span> <b>${f.letters.join('')}</b> <span class="muted">(${esc(p.name)})</span>${f.def ? `<i>${esc(f.def)}</i>` : ''}</div>`).join('')).join('');
  const isHost = s.hostId === s.you;
  $('btn-again').classList.toggle('hidden', !isHost);
}
$('btn-again').onclick = () => send('toLobby');
$('btn-leave2').onclick = () => send('leave');
$('btn-view-map').onclick = () => { ui.viewMap = true; showScreen(null); $('btn-back-results').classList.remove('hidden'); W.overview(); };
$('btn-back-results').onclick = () => { ui.viewMap = false; showScreen('over'); };

// initial screen
showScreen(session.get() ? null : 'home');
setTimeout(() => { if (!ui.state) showScreen('home'); }, 2500);
