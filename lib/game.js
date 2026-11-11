// Word Fleet — authoritative game logic. One Room per game.
const crypto = require('crypto');
const { randomWord } = require('./words');
const { isKnownWord } = require('./dictionary');

const MAX_PLAYERS = 6;
const COLORS = ['#e63946', '#f4a261', '#e9c46a', '#2a9d8f', '#4ea8de', '#9b5de5', '#f15bb5', '#90be6d'];
const SHIP_SETS = {
  short: [2, 3, 4, 5, 6, 7],
  standard: [3, 4, 5, 6, 7, 8],
  long: [4, 5, 6, 7, 8, 9],
};
const SHIP_NAMES = { 2: 'Dinghy', 3: 'Patrol Boat', 4: 'Submarine', 5: 'Destroyer', 6: 'Cruiser', 7: 'Battleship', 8: 'Carrier', 9: 'Dreadnought' };
const VOWELS = 'AEIOU';

const ITEMS = {
  shield:       { name: 'Shield',          icon: '🛡️', cost: 40, kind: 'defense', desc: 'Protect one letter. The next attack using that letter on you is blocked.' },
  extinguisher: { name: 'Extinguisher',    icon: '🧯', cost: 25, kind: 'defense', desc: 'Put out the fire on one damaged letter. It is hidden from enemies again.' },
  smoke:        { name: 'Smoke Screen',    icon: '🌫️', cost: 50, kind: 'defense', desc: 'The next attack against you (letter or word) misses completely.' },
  counter:      { name: 'Counter-Battery', icon: '↩️', cost: 55, kind: 'defense', desc: 'The next letter fired at you is automatically fired back at the attacker.' },
  recon:        { name: 'Recon Plane',     icon: '✈️', cost: 20, kind: 'attack',  desc: 'See how many vowels (A E I O U) are in each ship of one player.' },
  sonar:        { name: 'Sonar Ping',      icon: '📡', cost: 35, kind: 'attack',  desc: 'Secretly reveal one hidden letter in a player\'s fleet (only you see it).' },
  double:       { name: 'Double Shot',     icon: '🎯', cost: 45, kind: 'attack',  desc: 'Fire one extra shot this turn. Your turn only.', turnOnly: true },
  barrage:      { name: 'Barrage',         icon: '💣', cost: 70, kind: 'attack',  desc: 'Your next letter is fired at EVERY opponent at once. Your turn only.', turnOnly: true },
};

const DEFAULTS = {
  fleetSize: 5, shipSet: 'standard', turnTime: 60, startCoins: 50,
  income: 5, shop: 'all', dictionary: true, wordGuess: true,
};
const ALLOWED = {
  fleetSize: [3, 4, 5, 6],
  shipSet: ['short', 'standard', 'long'],
  turnTime: [0, 30, 45, 60, 90, 120],
  startCoins: [0, 50, 100, 150, 200],
  income: [0, 5, 10, 15],
  shop: ['all', 'defense', 'attack', 'off'],
  dictionary: [true, false],
  wordGuess: [true, false],
};
const REWARD = { hit: 10, sink: 25, word: 30, survive: 15, lastStanding: 50 };
const FX_GRACE_MS = 3000; // extra time on the clock while attack animations play
const OFFLINE_SKIP_MS = 15000; // how long a dropped captain has to reconnect before their turn is skipped
const LEFT_SKIP_MS = 2000;     // captains who chose to leave are skipped almost straight away

// ---------------- Dictionary lookups (server side, cached) ----------------
const dictCache = new Map(); // word -> { valid: bool|null, def: string|null }
async function lookupWord(word) {
  if (dictCache.has(word)) return dictCache.get(word);
  let result = { valid: null, def: null }; // null = unknown (network problem / rate limit)
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word.toLowerCase())}`, { signal: ctrl.signal });
    clearTimeout(t);
    if (res.status === 404) result = { valid: false, def: null };
    else if (res.ok) {
      const data = await res.json();
      let def = null;
      try { def = data[0].meanings[0].definitions[0].definition; } catch (e) {}
      result = { valid: true, def: def ? String(def).slice(0, 160) : null };
    }
  } catch (e) { /* offline / timeout: accept */ }
  if (result.valid !== null) dictCache.set(word, result);
  return result;
}

function genId(n = 8) { return crypto.randomBytes(n).toString('hex'); }
function cleanName(s) { return String(s || '').replace(/[<>]/g, '').trim().slice(0, 16) || 'Captain'; }

class Room {
  constructor(code, sendFn) {
    this.code = code;
    this.sendFn = sendFn; // (conn, obj) => void
    this.players = [];
    this.hostId = null;
    this.phase = 'lobby';
    this.settings = { ...DEFAULTS };
    this.log = [];
    this.logSeq = 0;
    this.round = 1;
    this.order = [];
    this.turnIdx = -1;
    this.turnEndsAt = 0;
    this.turnStartedAt = 0;
    this.history = {}; // targetId -> { LETTER: 'hit'|'miss'|'blocked' }
    this.results = null;
    this.lastActivity = Date.now();
  }

  // ---------- helpers ----------
  get competitors() { return this.players.filter(p => !p.spectator); }
  get alivePlayers() { return this.order.filter(p => p.alive); }
  get current() { return this.phase === 'battle' ? this.order[this.turnIdx] : null; }
  lengths() { return SHIP_SETS[this.settings.shipSet].slice(0, this.settings.fleetSize); }
  find(id) { return this.players.find(p => p.id === id); }
  host() { return this.find(this.hostId); }

  addLog(text, opts = {}) {
    this.log.push({ id: ++this.logSeq, text, kind: opts.kind || 'info', to: opts.to || null });
    if (this.log.length > 120) this.log.splice(0, this.log.length - 120);
  }

  send(p, obj) { if (p && p.conn && p.connected) this.sendFn(p.conn, obj); }
  error(p, msg) { this.send(p, { type: 'error', msg }); }
  toast(p, msg) { this.send(p, { type: 'toast', msg }); }
  fxAll(events) {
    for (const p of this.players) {
      const evs = events.filter(e => !e.private || e.private === p.id);
      if (evs.length) this.send(p, { type: 'fx', events: evs });
    }
  }
  broadcast() { for (const p of this.players) this.send(p, this.view(p)); }

  // ---------- membership ----------
  addPlayer({ name, color, spectator }) {
    if (this.phase !== 'lobby') throw new Error('That game has already started.');
    if (!spectator && this.competitors.length >= MAX_PLAYERS) throw new Error('That room is full (6 players).');
    const used = this.players.map(p => p.color);
    let c = COLORS.includes(color) && !used.includes(color) ? color : COLORS.find(x => !used.includes(x)) || COLORS[0];
    const p = {
      id: genId(4), token: genId(12), name: cleanName(name), color: c, spectator: !!spectator,
      conn: null, connected: false, disconnectedAt: 0, ready: false, ships: [],
      coins: 0, score: 0, alive: true, shields: [], smoke: false, counter: false,
      barrage: false, shotsLeft: 0, doubleUsed: false, sonar: {}, recon: {},
      hits: 0, sinks: 0, wordsGuessed: 0, eliminatedRound: null,
    };
    this.players.push(p);
    if (!this.hostId) this.hostId = p.id;
    this.addLog(`${p.name} joined the harbour.`);
    return p;
  }

  attach(p, conn) {
    p.conn = conn; p.connected = true; p.disconnectedAt = 0; p.left = false;
    this.lastActivity = Date.now();
  }

  detach(p) {
    p.connected = false; p.conn = null; p.disconnectedAt = Date.now();
    this.broadcast();
  }

  removePlayer(p, reason) {
    this.players = this.players.filter(x => x !== p);
    if (reason) this.addLog(`${p.name} ${reason}.`);
    if (this.hostId === p.id) this.pickNewHost();
  }

  pickNewHost() {
    const next = this.players.find(x => x.connected && !x.spectator) || this.players.find(x => x.connected) || this.players[0];
    this.hostId = next ? next.id : null;
    if (next) this.addLog(`${next.name} is now the host.`);
  }

  // ---------- message handling ----------
  handle(p, msg) {
    this.lastActivity = Date.now();
    const isHost = p.id === this.hostId;
    switch (msg.type) {
      case 'settings': {
        if (!isHost || this.phase !== 'lobby') return;
        const key = msg.key;
        if (!ALLOWED[key]) return;
        const val = ALLOWED[key].find(v => String(v) === String(msg.value));
        if (val === undefined) return;
        this.settings[key] = val;
        break;
      }
      case 'kick': {
        if (!isHost || this.phase !== 'lobby') return;
        const t = this.find(msg.id);
        if (!t || t === p) return;
        this.send(t, { type: 'kicked' });
        this.removePlayer(t, 'was removed by the host');
        break;
      }
      case 'color': {
        if (this.phase !== 'lobby' || !COLORS.includes(msg.color)) return;
        if (this.players.some(x => x !== p && x.color === msg.color)) return this.error(p, 'That colour is taken.');
        p.color = msg.color;
        break;
      }
      case 'leave': {
        if (this.phase === 'lobby' || p.spectator) this.removePlayer(p, 'left');
        else { p.connected = false; p.conn = null; p.disconnectedAt = Date.now(); p.left = true; this.addLog(`${p.name} left the battle.`); }
        break;
      }
      case 'start': {
        if (!isHost || this.phase !== 'lobby') return;
        if (this.competitors.length < 2) return this.error(p, 'You need at least 2 captains to start.');
        this.phase = 'setup';
        for (const x of this.players) { x.ready = false; x.ships = []; }
        this.addLog('⚓ Fleet setup! Choose a secret word for every ship.');
        break;
      }
      case 'suggest': {
        const len = Number(msg.len);
        const w = randomWord(len, Array.isArray(msg.avoid) ? msg.avoid : []);
        this.send(p, { type: 'suggest', idx: msg.idx, word: w });
        return; // no broadcast
      }
      case 'setFleet': return this.setFleet(p, msg.words);
      case 'unready': {
        if (this.phase !== 'setup' || p.spectator) return;
        p.ready = false;
        break;
      }
      case 'reject': {
        if (!isHost || this.phase !== 'setup') return;
        const t = this.find(msg.id);
        if (!t || !t.ready) return;
        t.ready = false;
        this.toast(t, 'The host asked you to choose different words. Please change your fleet.');
        this.addLog(`The host sent ${t.name}'s fleet back to the dockyard.`);
        break;
      }
      case 'forceStart': {
        if (!isHost || this.phase !== 'setup') return;
        for (const x of this.competitors) if (!x.ready) this.autoFleet(x);
        this.startBattle();
        break;
      }
      case 'fire': return this.fire(p, msg.target, msg.letter);
      case 'guessWord': return this.guessWord(p, msg.target, msg.ship, msg.word);
      case 'buy': return this.buy(p, msg);
      case 'endGame': {
        if (!isHost || (this.phase !== 'battle' && this.phase !== 'setup')) return;
        this.addLog('The host ended the battle.');
        if (this.phase === 'setup') { this.phase = 'lobby'; break; }
        return this.finish('host');
      }
      case 'toLobby': {
        if (!isHost || this.phase !== 'over') return;
        this.phase = 'lobby';
        this.results = null;
        for (const x of this.players) { x.ready = false; x.ships = []; }
        this.addLog('Back in the harbour. Ready for another battle?');
        break;
      }
      default: return;
    }
    this.broadcast();
  }

  // ---------- setup ----------
  async setFleet(p, words) {
    if (this.phase !== 'setup' || p.spectator || p.ready || p.checking) return;
    const lens = this.lengths();
    if (!Array.isArray(words) || words.length !== lens.length) return this.error(p, 'Please fill in every ship.');
    const clean = words.map(w => String(w || '').toUpperCase().trim());
    for (let i = 0; i < lens.length; i++) {
      if (!/^[A-Z]+$/.test(clean[i])) return this.error(p, `Ship ${i + 1}: use letters A–Z only.`);
      if (clean[i].length !== lens[i]) return this.error(p, `Ship ${i + 1} needs a ${lens[i]}-letter word.`);
    }
    if (new Set(clean).size !== clean.length) return this.error(p, 'Each ship needs a different word.');
    if (this.settings.dictionary) {
      // The built-in word list decides. Only words it doesn't know are checked online,
      // and they are rejected unless the online dictionary positively confirms them
      // (an unreachable / rate-limited dictionary no longer lets any word through).
      const unknown = clean.filter(w => !isKnownWord(w));
      if (unknown.length) {
        p.checking = true;
        this.send(p, { type: 'checking' });
        this.broadcast();
        const looks = await Promise.all(unknown.map(lookupWord));
        p.checking = false;
        if (this.phase !== 'setup' || !this.players.includes(p) || p.ready) return this.broadcast();
        const bad = unknown.filter((w, i) => looks[i].valid !== true);
        if (bad.length) {
          this.error(p, `Not a real word: ${bad.join(', ')}. Check the spelling or pick another word.`);
          return this.broadcast();
        }
      }
    }
    p.ships = clean.map(w => this.makeShip(w, null));
    p.ready = true;
    this.addLog(`${p.name}'s fleet is ready.`);
    if (this.competitors.every(x => x.ready)) return this.startBattle();
    this.broadcast();
  }

  // Definitions are only flavour text (shown when a ship sinks), so fetch them in the background.
  fetchDef(ship) {
    lookupWord(ship.word).then(r => { if (r.def && !ship.def) ship.def = r.def; }).catch(() => {});
  }

  makeShip(word, def) {
    const ship = { word, len: word.length, hits: Array(word.length).fill(false), sunk: false, wrong: [], def: def || null };
    if (!ship.def) this.fetchDef(ship);
    return ship;
  }

  autoFleet(p) {
    const used = [];
    p.ships = this.lengths().map(len => {
      const w = randomWord(len, used) || 'X'.repeat(len);
      used.push(w);
      return this.makeShip(w, null);
    });
    p.ready = true;
    this.addLog(`${p.name}'s fleet was given random words.`);
  }

  startBattle() {
    this.phase = 'battle';
    this.round = 1;
    this.order = this.competitors.slice();
    this.turnIdx = -1;
    this.history = {};
    for (const p of this.order) {
      Object.assign(p, {
        coins: this.settings.startCoins, score: 0, alive: true, shields: [], smoke: false, counter: false,
        barrage: false, shotsLeft: 0, doubleUsed: false, sonar: {}, recon: {}, hits: 0, sinks: 0,
        wordsGuessed: 0, eliminatedRound: null,
      });
      this.history[p.id] = {};
    }
    this.addLog('🔥 Battle stations! Pick a target and fire a letter.', { kind: 'big' });
    this.advance(true);
    this.broadcast();
  }

  // ---------- turns ----------
  advance(noIncome) {
    if (this.phase !== 'battle') return;
    const n = this.order.length;
    let idx = this.turnIdx;
    for (let step = 0; step < n; step++) {
      idx++;
      if (idx >= n) {
        idx = 0;
        this.round++; // no round limit: the battle only ends when every fleet but one is sunk
        this.addLog(`— Round ${this.round} —`, { kind: 'round' });
      }
      if (this.order[idx].alive) break;
    }
    this.turnIdx = idx;
    const p = this.order[idx];
    p.shotsLeft = 1;
    p.doubleUsed = false;
    if (!noIncome && this.settings.income) p.coins += this.settings.income;
    this.turnStartedAt = Date.now();
    this.turnEndsAt = this.settings.turnTime ? Date.now() + this.settings.turnTime * 1000 + FX_GRACE_MS : 0;
  }

  tick() {
    const now = Date.now();
    // Hand the host role on if the host has been gone a while.
    const h = this.host();
    if (h && !h.connected && now - h.disconnectedAt > 20000 && this.players.some(x => x.connected)) {
      this.pickNewHost();
      this.broadcast();
    }
    if (this.phase !== 'battle') return;
    const cur = this.current;
    if (!cur) return;
    // A captain who drops out mid-turn gets time to reconnect (counted from when they dropped,
    // not from the start of the turn) so a brief network blip doesn't hand the opponent extra shots.
    const grace = cur.left ? LEFT_SKIP_MS : OFFLINE_SKIP_MS;
    if (!cur.connected && now - Math.max(this.turnStartedAt, cur.disconnectedAt) > grace) {
      this.addLog(`${cur.name} is offline — turn skipped.`);
      this.advance();
      return this.broadcast();
    }
    if (this.turnEndsAt && now > this.turnEndsAt) {
      this.addLog(`⏰ ${cur.name} ran out of time.`);
      this.advance();
      this.broadcast();
    }
  }

  checkTurnPlayer(p) {
    if (this.phase !== 'battle') return 'The battle has not started.';
    if (p.spectator) return 'Spectators cannot fire.';
    if (this.current !== p) return 'Wait for your turn!';
    if (p.shotsLeft <= 0) return 'You have no shots left.';
    return null;
  }

  // ---------- attacks ----------
  // A letter is "spent" on a fleet when firing it again can't do anything:
  // it already missed, or it already hit and every copy is still burning.
  isSpent(t, L) {
    const prev = (this.history[t.id] || {})[L];
    if (prev === 'miss') return true;
    if (prev === 'hit') return !t.ships.some(s => !s.sunk && s.word.split('').some((c, j) => c === L && !s.hits[j]));
    return false;
  }

  resolveLetter(att, t, L, canCounter) {
    const ev = { type: 'letter', from: att.id, to: t.id, letter: L, hits: [], sunk: [], result: 'miss', counter: !canCounter };
    const hist = this.history[t.id] || (this.history[t.id] = {});
    if (t.smoke) {
      t.smoke = false;
      ev.result = 'evaded';
      this.addLog(`🌫️ ${att.name} fired "${L}" at ${t.name}… it vanished into a smoke screen!`, { kind: 'block' });
    } else if (t.shields.includes(L)) {
      t.shields = t.shields.filter(x => x !== L);
      ev.result = 'blocked';
      hist[L] = 'blocked';
      this.addLog(`🛡️ ${t.name}'s shield blocked ${att.name}'s "${L}"!`, { kind: 'block' });
    } else {
      t.ships.forEach((s, i) => {
        if (s.sunk) return;
        for (let j = 0; j < s.len; j++) {
          if (s.word[j] === L && !s.hits[j]) { s.hits[j] = true; ev.hits.push({ ship: i, pos: j }); }
        }
        if (s.hits.every(Boolean)) {
          s.sunk = true;
          ev.sunk.push({ ship: i, word: s.word, def: s.def });
        }
      });
      if (ev.hits.length) {
        ev.result = 'hit';
        hist[L] = 'hit';
        const gain = ev.hits.length * REWARD.hit + ev.sunk.length * REWARD.sink;
        att.coins += gain; att.score += gain; att.hits += ev.hits.length; att.sinks += ev.sunk.length;
        ev.gain = gain;
        const n = ev.hits.length;
        this.addLog(`💥 ${att.name} hit ${t.name} with "${L}" — ${n} hit${n > 1 ? 's' : ''}! (+${gain})`, { kind: 'hit' });
        for (const s of ev.sunk) this.addLog(`🚢 ${t.name}'s ${SHIP_NAMES[s.word.length]} sank! The word was ${s.word}.`, { kind: 'sink' });
      } else {
        // a letter that only matches already-damaged segments still counts as "hit" in history
        const has = t.ships.some(s => !s.sunk && s.word.includes(L));
        hist[L] = has ? 'hit' : 'miss';
        this.addLog(`💦 ${att.name} fired "${L}" at ${t.name} — ${has ? 'no new damage' : 'miss'}.`, { kind: 'miss' });
      }
      this.checkEliminated(t, ev);
    }
    const out = [ev];
    if (canCounter && t.counter && ev.result !== 'evaded' && att.alive) {
      t.counter = false;
      this.addLog(`↩️ ${t.name}'s Counter-Battery fires "${L}" back at ${att.name}!`, { kind: 'block' });
      out.push(...this.resolveLetter(t, att, L, false));
    }
    return out;
  }

  checkEliminated(t, ev) {
    if (t.alive && t.ships.length && t.ships.every(s => s.sunk)) {
      t.alive = false;
      t.eliminatedRound = this.round;
      ev.eliminated = true;
      this.addLog(`☠️ ${t.name}'s whole fleet has been sunk!`, { kind: 'big' });
    }
  }

  afterShot(p, events) {
    p.shotsLeft--;
    this.fxAll(events);
    if (this.order.filter(x => x.alive).length <= 1) return this.finish('last');
    if (!p.alive || p.shotsLeft <= 0) this.advance();
    else if (this.turnEndsAt) this.turnEndsAt += FX_GRACE_MS; // time for the animation
    this.broadcast();
  }

  fire(p, targetId, letter) {
    const err = this.checkTurnPlayer(p);
    if (err) return this.error(p, err);
    const L = String(letter || '').toUpperCase();
    if (!/^[A-Z]$/.test(L)) return this.error(p, 'Choose a letter A–Z.');
    const t = this.find(targetId);
    if (!t || t === p || t.spectator || !t.alive || !this.order.includes(t)) return this.error(p, 'Choose an enemy fleet to attack.');
    if (this.isSpent(t, L)) return this.error(p, `"${L}" has already been fired at ${t.name} — pick a different letter.`);
    let targets = [t];
    if (p.barrage) {
      p.barrage = false;
      targets = this.order.filter(x => x !== p && x.alive);
      this.addLog(`💣 ${p.name} launches a BARRAGE of "${L}" at every fleet!`, { kind: 'big' });
    }
    const events = [];
    for (const x of targets) events.push(...this.resolveLetter(p, x, L, true));
    this.afterShot(p, events);
  }

  guessWord(p, targetId, shipIdx, word) {
    if (!this.settings.wordGuess) return this.error(p, 'Word guessing is turned off.');
    const err = this.checkTurnPlayer(p);
    if (err) return this.error(p, err);
    const t = this.find(targetId);
    if (!t || t === p || !t.alive || !this.order.includes(t)) return this.error(p, 'Choose an enemy fleet.');
    const s = t.ships[Number(shipIdx)];
    if (!s || s.sunk) return this.error(p, 'Choose a ship that is still afloat.');
    const W = String(word || '').toUpperCase().trim();
    if (!/^[A-Z]+$/.test(W) || W.length !== s.len) return this.error(p, `That ship needs a ${s.len}-letter word.`);
    if (s.wrong.includes(W)) return this.error(p, `${W} has already been guessed for that ship — try another word.`);
    const ev = { type: 'word', from: p.id, to: t.id, ship: Number(shipIdx), word: W, correct: false, hits: [], sunk: [], result: 'miss' };
    if (t.smoke) {
      t.smoke = false;
      ev.result = 'evaded';
      this.addLog(`🌫️ ${p.name}'s torpedo at ${t.name} was lost in a smoke screen!`, { kind: 'block' });
    } else if (W === s.word) {
      for (let j = 0; j < s.len; j++) if (!s.hits[j]) { s.hits[j] = true; ev.hits.push({ ship: ev.ship, pos: j }); }
      s.sunk = true;
      ev.correct = true; ev.result = 'hit';
      ev.sunk.push({ ship: ev.ship, word: s.word, def: s.def });
      const gain = ev.hits.length * REWARD.hit + REWARD.sink + REWARD.word;
      p.coins += gain; p.score += gain; p.hits += ev.hits.length; p.sinks++; p.wordsGuessed++;
      ev.gain = gain;
      this.addLog(`🎯 TORPEDO! ${p.name} guessed ${t.name}'s word ${W} and sank the ${SHIP_NAMES[s.len]}! (+${gain})`, { kind: 'sink' });
      this.checkEliminated(t, ev);
    } else {
      if (!s.wrong.includes(W)) s.wrong.push(W);
      if (s.wrong.length > 8) s.wrong.shift();
      this.addLog(`🌊 ${p.name} guessed "${W}" for ${t.name}'s ${SHIP_NAMES[s.len]} — wrong!`, { kind: 'miss' });
    }
    this.afterShot(p, [ev]);
  }

  // ---------- shop ----------
  buy(p, msg) {
    if (this.phase !== 'battle') return this.error(p, 'The shop opens when the battle starts.');
    if (p.spectator || !p.alive) return this.error(p, 'Only captains still afloat can shop.');
    const item = ITEMS[msg.item];
    if (!item) return;
    const shop = this.settings.shop;
    if (shop === 'off' || (shop === 'defense' && item.kind !== 'defense') || (shop === 'attack' && item.kind !== 'attack'))
      return this.error(p, 'That item is not available in this game.');
    if (p.coins < item.cost) return this.error(p, `You need ${item.cost} coins for ${item.name}.`);
    if (item.turnOnly && this.current !== p) return this.error(p, `${item.name} can only be bought on your turn.`);
    const events = [];
    switch (msg.item) {
      case 'shield': {
        const L = String(msg.letter || '').toUpperCase();
        if (!/^[A-Z]$/.test(L)) return this.error(p, 'Choose a letter to shield.');
        if (p.shields.includes(L)) return this.error(p, `"${L}" is already shielded.`);
        if (p.shields.length >= 3) return this.error(p, 'You can have at most 3 shields.');
        p.shields.push(L);
        this.addLog(`🛡️ You shielded the letter "${L}".`, { to: p.id });
        break;
      }
      case 'extinguisher': {
        const s = p.ships[Number(msg.ship)];
        const pos = Number(msg.pos);
        if (!s || s.sunk || !s.hits[pos]) return this.error(p, 'Choose a burning letter on a ship that is still afloat.');
        s.hits[pos] = false;
        events.push({ type: 'repair', who: p.id, ship: Number(msg.ship), pos });
        this.addLog(`🧯 ${p.name} put out a fire on their ${SHIP_NAMES[s.len]}!`, { kind: 'block' });
        break;
      }
      case 'smoke': {
        if (p.smoke) return this.error(p, 'Your smoke screen is already up.');
        p.smoke = true;
        events.push({ type: 'smoke', who: p.id, private: p.id });
        this.addLog('🌫️ Smoke screen ready. The next attack on you will miss.', { to: p.id });
        break;
      }
      case 'counter': {
        if (p.counter) return this.error(p, 'Your Counter-Battery is already armed.');
        p.counter = true;
        this.addLog('↩️ Counter-Battery armed.', { to: p.id });
        break;
      }
      case 'recon': {
        const t = this.find(msg.target);
        if (!t || t === p || !this.order.includes(t) || !t.alive) return this.error(p, 'Choose an enemy fleet.');
        if (p.recon[t.id]) return this.error(p, `You already have recon on ${t.name}.`);
        p.recon[t.id] = t.ships.map(s => s.word.split('').filter(c => VOWELS.includes(c)).length);
        events.push({ type: 'recon', who: p.id, to: t.id, private: p.id });
        this.addLog(`✈️ Recon plane over ${t.name}: vowels per ship are ${p.recon[t.id].join(', ')}.`, { to: p.id });
        break;
      }
      case 'sonar': {
        const t = this.find(msg.target);
        if (!t || t === p || !this.order.includes(t) || !t.alive) return this.error(p, 'Choose an enemy fleet.');
        const seen = p.sonar[t.id] || (p.sonar[t.id] = []);
        const options = [];
        t.ships.forEach((s, i) => {
          if (s.sunk) return;
          for (let j = 0; j < s.len; j++) if (!s.hits[j] && !seen.some(x => x.ship === i && x.pos === j)) options.push({ ship: i, pos: j });
        });
        if (!options.length) return this.error(p, `Sonar found nothing new on ${t.name}.`);
        const pick = options[Math.floor(Math.random() * options.length)];
        seen.push(pick);
        const s = t.ships[pick.ship];
        events.push({ type: 'sonar', who: p.id, to: t.id, ship: pick.ship, pos: pick.pos, letter: s.word[pick.pos], private: p.id });
        this.addLog(`📡 Sonar: ${t.name}'s ${SHIP_NAMES[s.len]} has "${s.word[pick.pos]}" in position ${pick.pos + 1}.`, { to: p.id });
        break;
      }
      case 'double': {
        if (p.doubleUsed) return this.error(p, 'Only one Double Shot per turn.');
        p.doubleUsed = true;
        p.shotsLeft += 1;
        if (this.turnEndsAt) this.turnEndsAt += 15000;
        this.addLog(`🎯 ${p.name} loaded a Double Shot!`, { kind: 'big' });
        break;
      }
      case 'barrage': {
        if (p.barrage) return this.error(p, 'Barrage is already loaded.');
        p.barrage = true;
        this.addLog(`💣 ${p.name} is loading a Barrage…`, { kind: 'big' });
        break;
      }
    }
    p.coins -= item.cost;
    if (events.length) this.fxAll(events);
    this.broadcast();
  }

  // ---------- end ----------
  finish(reason) {
    this.phase = 'over';
    this.turnEndsAt = 0;
    const alive = this.order.filter(p => p.alive);
    const rows = this.order.map(p => {
      const afloat = p.ships.filter(s => !s.sunk).length;
      let final = p.score + afloat * REWARD.survive;
      if (reason === 'last' && p.alive) final += REWARD.lastStanding;
      return { id: p.id, name: p.name, color: p.color, score: p.score, afloat, final, hits: p.hits, sinks: p.sinks, words: p.wordsGuessed, alive: p.alive };
    });
    rows.sort((a, b) => b.final - a.final || b.afloat - a.afloat || b.hits - a.hits);
    this.results = { reason, rows };
    const w = rows[0];
    const why = reason === 'last' ? 'last fleet afloat' : 'ended by host';
    this.addLog(`🏆 ${w ? w.name : 'Nobody'} wins the battle! (${why})`, { kind: 'big' });
    this.fxAll([{ type: 'gameover', winner: w ? w.id : null, alive: alive.map(p => p.id) }]);
    this.broadcast();
  }

  // ---------- per-player view ----------
  view(v) {
    const cur = this.current;
    const reveal = this.phase === 'over';
    return {
      type: 'state',
      you: v.id,
      code: this.code,
      hostId: this.hostId,
      phase: this.phase,
      settings: this.settings,
      lengths: this.lengths(),
      shipNames: SHIP_NAMES,
      items: ITEMS,
      colors: COLORS,
      round: this.round,
      turnId: cur ? cur.id : null,
      turnRemaining: this.turnEndsAt ? Math.max(0, this.turnEndsAt - Date.now()) : null,
      results: this.results,
      players: this.players.map(p => {
        const own = p.id === v.id;
        const seen = (v.sonar && v.sonar[p.id]) || [];
        const recon = v.recon && v.recon[p.id];
        const showWords = own || v.spectator || reveal;
        const base = {
          id: p.id, name: p.name, color: p.color, spectator: p.spectator, connected: p.connected,
          ready: p.ready, checking: !!p.checking, alive: p.alive, coins: p.coins, score: p.score,
          hitsLanded: p.hits, eliminatedRound: p.eliminatedRound,
          afloat: p.ships.filter(s => !s.sunk).length,
          history: this.history[p.id] || {},
          spent: Object.keys(this.history[p.id] || {}).filter(L => this.isSpent(p, L)),
        };
        // Fleet details are only shared once the battle is on (or with the owner/spectator during setup).
        const shareFleet = this.phase === 'battle' || this.phase === 'over' || own || v.spectator;
        base.fleet = shareFleet ? p.ships.map((s, i) => {
          const open = showWords || s.sunk;
          return {
            len: s.len,
            name: SHIP_NAMES[s.len],
            sunk: s.sunk,
            hits: s.hits.slice(),
            letters: s.word.split('').map((ch, j) => (open || s.hits[j] || seen.some(x => x.ship === i && x.pos === j)) ? ch : null),
            sonar: s.word.split('').map((ch, j) => seen.some(x => x.ship === i && x.pos === j)),
            wrong: s.wrong.slice(),
            vowels: recon ? recon[i] : null,
            def: (s.sunk || reveal) ? s.def : null,
          };
        }) : [];
        if (own) Object.assign(base, { shields: p.shields.slice(), smoke: p.smoke, counter: p.counter, barrage: p.barrage, shotsLeft: p.shotsLeft });
        return base;
      }),
      log: this.log.filter(e => !e.to || e.to === v.id).slice(-40),
    };
  }
}

module.exports = { Room, ITEMS, COLORS, SHIP_SETS, DEFAULTS, ALLOWED, REWARD, MAX_PLAYERS };
