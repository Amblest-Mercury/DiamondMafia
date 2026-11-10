'use strict';
// MAFIA: THE VILLAGE — authoritative multiplayer server (rooms, game state machine, NPC brains)
const http = require('http'), fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = +process.env.PORT || 3000;
const PUB = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };

function lanIps() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const i of list || []) if (i.family === 'IPv4' && !i.internal) out.push(i.address);
  return out;
}
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/info') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ port: PORT, ips: lanIps() })); }
  let f = u.pathname === '/' ? '/index.html' : decodeURIComponent(u.pathname);
  let root = PUB;
  if (f.startsWith('/vendor/three/')) { root = path.join(__dirname, 'node_modules', 'three'); f = f.slice('/vendor/three'.length); }
  const fp = path.join(root, path.normalize(f));
  if (!fp.startsWith(root)) { res.writeHead(403); return res.end(); }
  fs.readFile(fp, (e, d) => {
    if (e) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(d);
  });
});
const wss = new WebSocketServer({ server });

// ---------- helpers ----------
const rand = (a, b) => a + Math.random() * (b - a);
const ri = n => Math.floor(Math.random() * n);
const pick = a => a[ri(a.length)];
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = ri(i + 1);[a[i], a[j]] = [a[j], a[i]]; } return a; };
const uid = () => crypto.randomBytes(6).toString('hex');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const send = (ws, o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };

const NPC_NAMES = ['Tunde', 'Amaka', 'Chidi', 'Ngozi', 'Bisi', 'Emeka', 'Zainab', 'Kunle', 'Sade', 'Ifeanyi', 'Funmi', 'Obinna', 'Halima', 'Tobi', 'Yemi', 'Chioma', 'Segun', 'Dayo', 'Lola', 'Femi', 'Nkem', 'Uche', 'Wale', 'Kemi'];
const COLORS = ['#ff6b6b', '#4dabf7', '#ffd43b', '#69db7c', '#da77f2', '#ff922b', '#38d9a9', '#f783ac', '#a9e34b', '#748ffc', '#ffa8a8', '#66d9e8', '#e599f7', '#ffc078', '#8ce99a', '#b197fc'];
const HATS = ['none', 'cap', 'beanie', 'gele', 'crown', 'bow', 'tophat', 'headband'];
const SKINS = ['#8d5524', '#c68642', '#e0ac69', '#f1c27d', '#6b4226', '#a0693b', '#ffdbac', '#5c3a21'];
const ARCH = [
  { tag: 'The Analyst', iq: .85, paranoia: .35, deception: .75, talk: .6, conform: .2, style: 'formal' },
  { tag: 'Loudmouth', iq: .45, paranoia: .7, deception: .5, talk: .95, conform: .5, style: 'street' },
  { tag: 'Silent Type', iq: .7, paranoia: .3, deception: .65, talk: .3, conform: .3, style: 'formal' },
  { tag: 'Paranoid', iq: .5, paranoia: .95, deception: .4, talk: .7, conform: .4, style: 'street' },
  { tag: 'Sunshine', iq: .4, paranoia: .2, deception: .5, talk: .7, conform: .8, style: 'warm' },
  { tag: 'Smart Aleck', iq: .75, paranoia: .5, deception: .8, talk: .6, conform: .2, style: 'dry' },
  { tag: 'Nervous', iq: .35, paranoia: .5, deception: .3, talk: .35, conform: .9, style: 'warm' },
  { tag: 'Big Boss', iq: .6, paranoia: .6, deception: .6, talk: .85, conform: .1, style: 'street' },
];
function makePersona() {
  const a = pick(ARCH), j = () => rand(-.1, .1);
  return { tag: a.tag, style: a.style, iq: clamp(a.iq + j(), .15, .97), paranoia: clamp(a.paranoia + j(), 0, 1), deception: clamp(a.deception + j(), 0, 1), talk: clamp(a.talk + j(), .1, 1), conform: clamp(a.conform + j(), 0, 1) };
}

// ---------- NPC speech ----------
const L = {
  accuse: {
    formal: ['I believe {t} is Mafia. {r}', "{t} is who I'm watching. {r}", 'Honestly, {t} worries me the most. {r}'],
    street: ['Abeg o, {t} na Mafia! {r}', 'Na {t} I dey suspect o. {r}', '{t}, you dey form innocent but I no buy am. {r}'],
    warm: ['Oh no... I think it might be {t}? {r}', 'I hate to say it, but {t} feels off. {r}'],
    dry: ["Let me guess, {t} is 'totally innocent'. {r}", 'Wow, {t} acting weird again. Shocker. {r}']
  },
  defend: {
    formal: ["That's absurd. I'm not Mafia, {a}.", '{a}, you have no evidence against me.', 'Why target me, {a}? Think.'],
    street: ['Me?! {a}, abeg face your front!', 'Ah ah, {a}! Na me you see? I be innocent o!', '{a}, stop that nonsense. I no be Mafia!'],
    warm: ["Wait, what? I'm not Mafia, {a}! Please believe me!", '{a}... that really hurts. I am innocent!'],
    dry: ['Bold of you, {a}. Zero proof, maximum confidence.', "Sure {a}. And I'm the Queen of England."]
  },
  counter: {
    formal: ['The real question is why {a} is so eager to blame me.', 'Notice how {a} is deflecting?'],
    street: ['Na {a} dey form! Una see am?', '{a} dey push me because e dey fear!'],
    warm: ['Maybe {a} is trying to hide something?'],
    dry: ['Funny how {a} fixates on me. Very suspicious.']
  },
  chatter: {
    formal: ["Let's think carefully. Who hasn't spoken yet?", "I'm watching everyone's reactions.", 'We need to be methodical here.', 'Who do we actually trust?'],
    street: ['Una wan make Mafia chop us finish? Talk o!', 'Somebody here dey lie, I can feel am.', 'Who saw anything strange?', 'Oya, make we reason am well.'],
    warm: ["I'm scared... who could it be?", 'Can we all just stay calm and talk?', "I really hope we don't make a mistake today."],
    dry: ['Riveting discussion. Truly.', 'So... anyone wanna confess? No? Okay.', 'Quiet people are always the loud ones in disguise.']
  },
  agree: {
    formal: ['I agree with {a}. {t} looks guilty.', '{a} raises a fair point about {t}.'],
    street: ['{a} get point o! {t} dey shady.', 'I dey with {a}. {t} must explain.'],
    warm: ['Yeah, {a} might be right about {t}...'],
    dry: ['For once {a} said something useful. {t}, speak up.']
  },
  det: [
    "I am the DETECTIVE. I checked {t}'s house last night — it was EMPTY. They were out sneaking around. {t} is Mafia!",
    "Listen up, I'm the Detective! {t} was NOT home last night. Only Mafia leave their houses!"
  ],
  detClear: ["I'm the Detective. I checked {t} — they were home all night. {t} is clean."],
  counterDet: ["LIES! I'm the real Detective. It was {a} who left their house!", "Don't trust {a}, that's a fake claim. I'm the true Detective!"],
  fakeDet: ["I'm the Detective, and {t} was NOT home last night. Vote {t}!"],
  doc: ["I'm the Doctor. I protected {t} last night."],
  saw: ["I SAW them! {t} walked into my house last night! {t} is the Mafia!", 'Someone broke into my house — it was {t}! I saw their face!'],
  vote: ["I'm voting {t}.", 'My vote goes to {t}.', '{t}. That is my vote.'],
  mafiaPlan: ["Let's take out {t} tonight.", 'I say {t} is the threat. Strike {t}.', '{t} knows too much. Tonight.', 'Agreed. {t} it is.'],
  mafiaDay: ['Stay calm. Do not look at each other.', "Follow the crowd. Don't stand out.", 'Let the village turn on itself.'],
  died: ['{v} was MURDERED... they were the {role}. Who did this?!', 'They murdered {v}, our {role}, last night. The Mafia is among us!'],
  safe: ['Nobody died! Either the Mafia slipped or someone got saved.', 'A quiet night? Suspicious... maybe the Doctor was busy.'],
};
const REASON = {
  quiet: 'They have said almost nothing.', loud: 'They talk a lot and say nothing.', quick: 'They were quick to point fingers.', flip: 'They keep changing sides.',
  vouch: 'They defended someone suspicious.', gut: 'Call it a gut feeling.', counter: 'They came at me with zero proof.', heat: "Everyone's already thinking it.", scape: 'Look at how they act.', empty: ''
};
function say(p, intent, v = {}) {
  let bank = L[intent]; if (!bank) return '';
  if (!Array.isArray(bank)) bank = bank[p.persona.style] || bank.formal;
  let s = pick(bank);
  return s.replace(/\{(\w+)\}/g, (_, k) => v[k] != null ? v[k] : '').replace(/\s+/g, ' ').trim();
}

// ---------- rooms ----------
const rooms = new Map();
const NIGHT = new Set(['nightFall', 'nightSummon', 'nightActions', 'nightTravel', 'nightAttack', 'nightReturn']);
const CHAT_OK = new Set(['lobby', 'day', 'vote', 'revote', 'voteResult', 'dawn']);
const BASE = { reveal: 9000, day: 90000, vote: 30000, revote: 20000, voteResult: 8500, nightFall: 30000, nightSummon: 20000, nightActions: 40000, nightTravel: 50000, nightAttack: 8000, nightReturn: 25000, dawn: 12000 };
const LOCKPH = new Set(['nightSummon', 'nightActions', 'nightTravel', 'nightAttack', 'nightReturn']);
const ACTPH = new Set(['nightSummon', 'nightActions', 'nightTravel']);   // when the Detective & Doctor may roam and act

// ---- village geometry (mirrors the 3D client) ----
const RINGR = 34, RACK = { x: 4.2, z: 2.6 };
function hg(room, i) { const n = room.players.length, a = -Math.PI / 2 + Math.PI / n + i * 2 * Math.PI / n, yaw = Math.atan2(-Math.cos(a), -Math.sin(a)); return { x: Math.cos(a) * RINGR, z: Math.sin(a) * RINGR, yaw, c: Math.cos(yaw), s: Math.sin(yaw) }; }
const l2w = (h, lx, lz) => [h.x + lx * h.c + lz * h.s, h.z - lx * h.s + lz * h.c];
function insideHouse(room, i, pos, m = 0) { if (!pos) return false; const h = hg(room, i), dx = pos.x - h.x, dz = pos.z - h.z, lx = dx * h.c - dz * h.s, lz = dx * h.s + dz * h.c; return Math.abs(lx) < 3.45 + m && lz > -2.85 - m && lz < 2.85 + m; }
function isHomeP(room, p) { if (p.isNPC || !p.connected || !p.pos) return p.loc === 'home' || p.loc === 'dead'; return insideHouse(room, houseOf(room, p), p.pos, .3); }
function tpTo(room, p, x, z, ry, note) { p.pos = { x, z, t: Date.now() }; if (p.ws) send(p.ws, { type: 'tp', x, z, ry, note }); }
function tpHome(room, p, msg) { const i = houseOf(room, p), h = hg(room, i), [x, z] = l2w(h, -1.0, -.95); tpTo(room, p, x, z, h.yaw, msg); }
function tpWell(room, p, k) { const a = k * 1.7 + .4; tpTo(room, p, Math.cos(a) * 3.4, Math.sin(a) * 3.4, a + Math.PI, '🌑 You were pulled out to the meeting ground.'); }

function genCode() { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; let c; do { c = ''; for (let i = 0; i < 4; i++) c += A[ri(A.length)]; } while (rooms.has(c)); return c; }
function newRoom() {
  const room = {
    code: genCode(), hostId: null, players: [], watchers: [], settings: { size: 8, mafia: 0, pace: 'normal', dayLen: 90 },
    phase: 'lobby', phaseId: 0, phaseStart: 0, phaseEnd: 0, day: 0, chats: { public: [], mafia: [], ghost: [] }, sched: [],
    night: null, votes: {}, cands: null, ready: new Set(), winner: null, claims: {}, dayAccs: [], tally: null, pendingWin: null, lastDeath: null, emptySince: 0, revoted: false,
  };
  rooms.set(room.code, room); return room;
}
function cleanName(s) { return String(s || '').replace(/[<>&"]/g, '').trim().slice(0, 14) || 'Player'; }
function uniqueName(room, name) {
  const taken = new Set([...room.players, ...room.watchers].map(p => p.name.toLowerCase()));
  let n = name, i = 2; while (taken.has(n.toLowerCase())) n = name.slice(0, 11) + i++; return n;
}
function newLook(room) {
  const used = new Set(room.players.map(p => p.look && p.look.color));
  const free = COLORS.filter(c => !used.has(c));
  return { color: free.length ? pick(free) : pick(COLORS), hat: pick(HATS), skin: pick(SKINS), pat: ri(3) };
}
function newPlayer(room, name, isNPC, ws) {
  return { id: uid(), token: uid() + uid(), name, isNPC, ws: ws || null, connected: !!ws, role: null, alive: true, shownDead: false, loc: 'home', pos: null, weapon: null, look: newLook(room), persona: makePersona(), mem: null, notes: [], lastMsg: 0 };
}
const isAI = p => p.isNPC || !p.connected;
const humans = room => room.players.filter(p => !p.isNPC);
const livingHumans = room => room.players.filter(p => !p.isNPC && p.connected && p.alive);
const allClients = room => [...room.players.filter(p => !p.isNPC && p.ws), ...room.watchers.filter(w => w.ws)];
const isGod = (room, c) => c.watcher || !c.alive || room.phase === 'gameover';
const aliveList = room => room.players.filter(p => p.alive);
const byId = (room, id) => room.players.find(p => p.id === id);
const houseOf = (room, p) => room.players.indexOf(p);
function autoMafia(n) { return Math.max(1, Math.floor(n / 4)); }

// ---------- views ----------
function canSee(room, c, ch) {
  if (ch === 'public') return true;
  if (ch === 'mafia') return isGod(room, c) || (c.role === 'mafia');
  if (ch === 'ghost') return isGod(room, c);
  return false;
}
function view(room, c) {
  const me = c.watcher ? null : c;
  // a victim lives through their own attack scene (they see it happen) and only becomes a ghost afterwards
  const dying = !!(me && !me.alive && room.night && room.night.killed === me.id && (room.phase === 'nightAttack' || room.phase === 'nightReturn'));
  const god = isGod(room, c) && !dying;
  const night = NIGHT.has(room.phase);
  const myMafia = me && me.role === 'mafia';
  const n = room.night;
  const vic = me && n && n.target === me.id && (room.phase === 'nightAttack' || room.phase === 'nightReturn');
  const players = room.players.map((p, i) => {
    const real = god || p === me || (myMafia && p.role === 'mafia') || (vic && p.id === n.striker);
    let alive = real ? p.alive : !p.shownDead;
    let loc = p.loc;
    if (dying && p === me) { alive = true; loc = 'home'; }
    if (!alive) loc = 'dead';
    if (!real && !alive && !p.shownDead) loc = 'plaza';
    if (alive && loc === 'dead') loc = 'home';   // a victim still looks alive (and in bed) to everyone but the dead themselves until dawn
    const showRole = god || p === me || (myMafia && p.role === 'mafia') || p.shownDead;
    let nl; if (LOCKPH.has(room.phase) && p.alive && ['mafia', 'detective', 'doctor'].includes(p.role)) { const out = isAI(p) ? (p.loc !== 'home' && p.loc !== 'dead') : !isHomeP(room, p); if (out) nl = p.role; }   // what a figure outside at night looks like
    return { nl, id: p.id, name: p.name, look: p.look, isNPC: p.isNPC, ai: isAI(p), tag: p.persona.tag, house: i, alive, loc, role: showRole ? p.role : undefined, connected: p.connected, host: p.id === room.hostId, dead: p.shownDead || (god && !p.alive), weapon: p.weapon || null };
  });
  const priv = !!(me && me.alive && ['mafia', 'detective', 'doctor'].includes(me.role));
  const v = {
    type: 'state', code: room.code, phase: room.phase, phaseId: room.phaseId, left: room.phaseEnd === Infinity ? -1 : Math.max(0, room.phaseEnd - Date.now()), total: room.phaseEnd === Infinity ? -1 : room.phaseEnd - room.phaseStart,
    day: room.day, hostId: room.hostId, settings: room.settings, players, god, winner: room.winner,
    you: { id: c.id, name: c.name, watcher: !!c.watcher, role: me ? me.role : null, alive: me ? (me.alive || dying) : false },
    notes: me ? me.notes : [], cands: room.cands, votedCount: Object.keys(room.votes).length, ready: room.ready.size, youReady: room.ready.has(c.id),
    yourVote: me ? room.votes[me.id] || null : null, tally: room.tally, nHumans: humans(room).length + room.watchers.length,
  };
  v.lock = LOCKPH.has(room.phase) && !god;
  v.unlock = [];   // doors you may pass tonight: your own (if you have a night job) and, for the Mafia, the victim's
  if (LOCKPH.has(room.phase) && me && me.alive) { if (priv) v.unlock.push(houseOf(room, me)); if (me.role === 'mafia' && n && n.target && ['nightTravel', 'nightAttack', 'nightReturn'].includes(room.phase)) v.unlock.push(room.players.findIndex(p => p.id === n.target)); }
  v.night = null;
  if (me && me.alive && LOCKPH.has(room.phase) && n) {
    if (me.role === 'mafia') v.night = { mvotes: n.mvotes, you: n.mvotes[me.id] || null, target: ['nightTravel', 'nightAttack', 'nightReturn'].includes(room.phase) ? n.target : null, weapon: me.weapon, struck: !!n.striker, victimHouse: n.target ? room.players.findIndex(p => p.id === n.target) : -1 };
    if (me.role === 'detective') v.night = { used: n.check != null, checked: n.check, open: ACTPH.has(room.phase) };
    if (me.role === 'doctor') v.night = { protect: n.protect, open: ACTPH.has(room.phase) && !n.lockedProtect };
  }
  if (god && n) v.god = { mvotes: n.mvotes, target: n.target, protect: n.protect, check: n.check, striker: n.striker };
  if (n && ['nightTravel', 'nightAttack', 'nightReturn'].includes(room.phase)) {
    const victim = me && n.target === me.id && room.phase !== 'nightTravel';
    if (victim || god || myMafia) v.attack = { victim: n.target, striker: n.striker, strikers: n.strikers || [n.striker], saved: room.phase === 'nightTravel' ? null : n.saved, showFace: !!victim || god };
  }
  if (room.phase === 'dawn' || room.phase === 'day' || room.phase === 'gameover') v.lastDeath = room.lastDeath;
  return v;
}
function broadcast(room) { for (const c of allClients(room)) send(c.ws, view(room, c)); }
function sendFull(room, c) {
  send(c.ws, view(room, c));
  const hist = {}; for (const ch of ['public', 'mafia', 'ghost']) hist[ch] = canSee(room, c, ch) ? room.chats[ch].slice(-80) : [];
  send(c.ws, { type: 'hist', hist });
}

// ---------- chat ----------
function postChat(room, ch, from, text, meta) {
  const m = { id: uid(), ch, from: from ? from.id : null, name: from ? from.name : '', text, t: Date.now(), sys: !from };
  room.chats[ch].push(m); if (room.chats[ch].length > 200) room.chats[ch].shift();
  for (const c of allClients(room)) if (canSee(room, c, ch)) send(c.ws, { type: 'chat', m });
  if (ch === 'public' && from && room.phase !== 'lobby') analyze(room, from, text, meta);
  return m;
}
const sys = (room, text, ch = 'public') => postChat(room, ch, null, text);
const after = (room, ms, fn) => room.sched.push({ at: Date.now() + ms, fn });
const note = (p, text) => { p.notes.push({ t: text, day: p.__day || 0 }); };

// ---------- text understanding (humans & NPC speech) ----------
const ACC_RE = /\b(sus|suspect|suspicious|suspicion|mafia|killer|liar|lying|lies|guilty|fake|shady|wicked|vote|kill|murderer|culprit|thief)\b/i;
const TRUST_RE = /\b(innocent|trust|clean|safe|vouch|honest|town|villager)\b/i;
const NEG_RE = /(\bnot\b|\bisn'?t\b|\bain'?t\b|n't|\bnever\b)\s+(\w+\s+){0,2}(mafia|sus|guilty|suspicious|killer)/i;
function parseText(room, from, text) {
  const meta = { acc: [], vouch: [], claim: null };
  const named = room.players.filter(p => p.alive && p.id !== from.id && new RegExp('\\b' + esc(p.name) + '\\b', 'i').test(text));
  meta.tag = named.map(p => p.id);
  const neg = NEG_RE.test(text);
  if (named.length) {
    if (ACC_RE.test(text) && !neg) meta.acc = named.map(p => p.id);
    else if (TRUST_RE.test(text) || neg) meta.vouch = named.map(p => p.id);
  }
  if (/\b(i am|i'm|im)\s+(the\s+)?detective\b/i.test(text)) {
    const c = { role: 'detective', away: [], clear: [] };
    for (const p of named) { if (/(not home|away|empty|out|left|sneak|wasn'?t home|was not)/i.test(text)) c.away.push(p.id); else c.clear.push(p.id); }
    meta.claim = c; meta.acc = c.away.slice();
  } else if (/\b(i am|i'm|im)\s+(the\s+)?doctor\b/i.test(text)) meta.claim = { role: 'doctor', away: [], clear: [] };
  return meta;
}
function heat(room, id) { const s = new Set(); for (const a of room.dayAccs) if (a.to === id) s.add(a.from); return s.size; }
function sus(m, id) { return m.sus[id] == null ? .2 : m.sus[id]; }
function bump(m, id, d) { m.sus[id] = clamp(sus(m, id) + d, -1, 1.6); }

function npcAnswer(room, l, from, text) {
  l.mem.pending = null; if (!l.alive || !from.alive || !CHAT_OK.has(room.phase)) return;
  const q = /\?/.test(text), mafia = l.role === 'mafia', st = l.persona.style;
  const where = { formal: ["I was around the plaza most of the time. Nothing to hide, {a}.", 'I stayed where everyone could see me, {a}.'], street: ['I dey here the whole time, {a}. Ask anybody!', 'Abeg {a}, I no get anything to hide o.'], warm: ["I was just here talking with everyone, {a}. I promise!", 'Um, I stayed close to the group, {a}.'], dry: ['Riveting question, {a}. I was here, being innocent.', 'Where was I? Probably somewhere you were not looking, {a}.'] };
  const hear = { formal: ['I hear you, {a}. Go on.', 'Noted, {a}. What do you think we should do?'], street: ['I dey hear you, {a}. Wetin you wan talk?', 'Oya {a}, talk your own make we hear.'], warm: ['Hi {a}! Yes, what is it?', 'I am listening, {a}.'], dry: ['Oh, now you notice me, {a}.', 'Fascinating, {a}. Go on.'] };
  const bank = (q ? where : hear)[st] || (q ? where : hear).formal;
  npcSpeak(room, l, pick(bank).replace('{a}', from.name), { acc: [], vouch: [], claim: null }, 2);
}
function analyze(room, from, text, meta) {
  if (!meta) { meta = parseText(room, from, text); meta.text = text; }
  for (const to of meta.acc || []) room.dayAccs.push({ from: from.id, to, t: Date.now() });
  if (meta.claim) room.claims[from.id] = meta.claim;
  for (const l of room.players) {
    if (!l.alive || l.id === from.id || !isAI(l)) continue;
    hear(room, l, from, meta);
  }
}
function hear(room, l, from, meta) {
  const m = l.mem, pr = l.persona, mafia = l.role === 'mafia';
  if (m.known[from.id] === 'mafia' && !mafia) { /* known mafia speaking: their accusations carry reverse weight */ }
  if (meta.tag && meta.tag.includes(l.id) && !(meta.acc && meta.acc.includes(l.id)) && !m.pending && !from.isNPC) {   // a person spoke to me directly
    m.pending = from.id; after(room, rand(1500, 4000), () => npcAnswer(room, l, from, meta.text || ''));
  }
  if (meta.acc && meta.acc.includes(l.id)) {
    m.accusedBy.push(from.id);
    if (!mafia) bump(m, from.id, .04 + .1 * pr.paranoia);
    if (!m.pending) { m.pending = from.id; after(room, rand(1400, 4300), () => npcDefend(room, l, from)); }
  }
  for (const to of meta.acc || []) {
    if (to === l.id) continue;
    if (mafia) {
      const t = byId(room, to);
      if (t && t.role === 'mafia' && Math.random() < .35 + pr.deception * .2) after(room, rand(2500, 6000), () => npcDefendAlly(room, l, t, from));
      continue;
    }
    let w = (.05 + .1 * pr.conform) * (meta.witness ? 3 : 1);
    if (m.known[from.id] === 'mafia') w = -.1;
    else w *= (1.1 - sus(m, from.id) * .6);
    if (m.known[to] === 'town') w *= .2;
    bump(m, to, w);
  }
  for (const to of meta.vouch || []) { if (to !== l.id && !mafia) bump(m, to, -.08 * (1 - sus(m, from.id) * .5)); }
  if (meta.claim) hearClaim(room, l, from, meta);
}
function hearClaim(room, l, from, meta) {
  const m = l.mem, pr = l.persona, c = meta.claim;
  const rivals = Object.keys(room.claims).filter(k => k !== from.id && room.claims[k].role === c.role);
  const tr = clamp(.85 - sus(m, from.id) - (rivals.length ? .3 : 0) + (Math.random() - .5) * .3 * (1.2 - pr.iq), .05, .95);
  if (c.role === 'detective') {
    if (l.role === 'detective') { bump(m, from.id, .9); return; }
    if (l.role === 'mafia') {
      const hitsAlly = c.away.some(id => { const t = byId(room, id); return t && t.role === 'mafia'; });
      if (hitsAlly && from.role !== 'mafia') m.threat[from.id] = 1.6;   // this is the real detective
      return;
    }
    for (const id of c.away) { if (id === l.id) bump(m, from.id, .8); else bump(m, id, .55 * tr); }
    for (const id of c.clear) { if (id === l.id) bump(m, from.id, -.1); else bump(m, id, -.25 * tr); }
    if (rivals.length) { bump(m, from.id, .12); }
  } else if (c.role === 'doctor') {
    if (l.role === 'doctor') bump(m, from.id, .9);
    else if (l.role === 'mafia') m.threat[from.id] = Math.max(m.threat[from.id] || 0, 1.0);
  }
}

// ---------- NPC brain ----------
function initMem(room) {
  for (const p of room.players) {
    p.mem = { sus: {}, known: {}, checks: [], accusedBy: [], threat: {}, pending: null, nextSpeak: Date.now() + rand(4000, 9000), saw: null, sawSaid: false, said: {}, accToday: 0, reported: false, protectedLast: null, lastProt: null, docClaimed: false, spoke: 0 };
    for (const q of room.players) if (q !== p) {
      p.mem.sus[q.id] = rand(.12, .3);
      if (p.role === 'mafia' && q.role === 'mafia') p.mem.known[q.id] = 'mafia-ally';
    }
  }
}
function trustedNonAllies(room, p) { return room.players.filter(q => q.alive && q.id !== p.id && p.mem.known[q.id] !== 'mafia-ally'); }
function npcSpeak(room, p, text, meta, prio = 1) {
  if (!p.alive || !CHAT_OK.has(room.phase)) return false;
  const now = Date.now(), gap = [16000, 7000, 2000][prio];
  if (now - (room.lastNpcMsg || 0) < gap) return false;
  room.lastNpcMsg = now; p.mem.spoke++; postChat(room, 'public', p, text, meta || { acc: [], vouch: [], claim: null }); return true;
}
function bestSuspect(room, p, opts = {}) {
  const m = p.mem, pr = p.persona; let best = null, bs = -1e9, why = 'gut';
  for (const q of room.players) {
    if (!q.alive || q.id === p.id) continue;
    if (m.known[q.id] === 'mafia-ally' && !opts.allowAlly) continue;
    if (opts.cands && !opts.cands.includes(q.id)) continue;
    let s = sus(m, q.id), r = 'gut';
    if (m.known[q.id] === 'mafia') s += 5;
    if (m.known[q.id] === 'town') s -= 3;
    const h = heat(room, q.id); s += h * .12 * (.35 + pr.conform); if (h >= 2) r = 'heat';
    if (p.role === 'mafia') {
      s = h * .45 + (m.threat[q.id] || 0) * .8 + rand(0, .25) + (room.claims[q.id] ? .35 : 0);
      if (q.role === 'mafia') s = -9;
    } else if (q.mem && opts.quiet !== false && q.mem.spoke === 0 && room.day > 0) { s += .1 * pr.paranoia; r = 'quiet'; }
    s += (Math.random() - .5) * (1.15 - pr.iq) * .7;
    if (s > bs) { bs = s; best = q; why = r; }
  }
  return best ? { p: best, score: bs, why } : null;
}
function npcDefend(room, l, accuser) {
  const m = l.mem; m.pending = null;
  if (!l.alive || !['day', 'dawn', 'vote', 'revote'].includes(room.phase)) return;
  const pr = l.persona, mafia = l.role === 'mafia';
  let text = say(l, 'defend', { a: accuser.name }), meta = { acc: [], vouch: [], claim: null, def: true };
  if (Math.random() < (mafia ? .5 : .25) + pr.paranoia * .3 && accuser.alive) { text += ' ' + say(l, 'counter', { a: accuser.name }); meta.acc = [accuser.id]; }
  npcSpeak(room, l, text, meta, 2);
}
function npcDefendAlly(room, l, ally, accuser) {
  if (!l.alive || !ally.alive || room.phase !== 'day' || accuser.id === l.id) return;
  const t = { formal: `I don't see it. ${ally.name} has been fair so far.`, street: `Abeg, ${ally.name} no be Mafia. Una dey rush!`, warm: `I... don't think it's ${ally.name}, really.`, dry: `${ally.name}? Come on, be serious.` };
  npcSpeak(room, l, t[l.persona.style] || t.formal, { acc: [], vouch: [ally.id], claim: null });
}
function npcDayTick(room, p, now) {
  const m = p.mem, pr = p.persona;
  if (now < m.nextSpeak) return;
  m.nextSpeak = now + (11000 + Math.random() * 17000) * (1.45 - pr.talk);
  if (room.phase === 'vote' || room.phase === 'revote') { if (Math.random() < .7) return; }
  const left = room.phaseEnd - now, mafia = p.role === 'mafia';
  const phaseFrac = room.phase === 'day' ? 1 - left / (room.phaseEnd - room.phaseStart) : .5;
  // 1. witnessed an attack
  if (m.saw && !m.sawSaid) {
    const a = byId(room, m.saw);
    if (a && a.alive) { m.sawSaid = true; return npcSpeak(room, p, say(p, 'saw', { t: a.name }), { acc: [a.id], vouch: [], claim: null, witness: true }, 2); }
  }
  // 2. detective report
  if (p.role === 'detective' && !m.reported && room.phase === 'day') {
    const away = m.checks.filter(c => c.away && byId(room, c.id).alive);
    if (away.length && phaseFrac > (pr.iq > .65 ? .45 : .05)) {
      m.reported = true;
      const t = byId(room, away[0].id);
      return npcSpeak(room, p, say(p, 'det', { t: t.name }), { acc: [t.id], vouch: [], claim: { role: 'detective', away: away.map(a => a.id), clear: [] } }, 2);
    }
    const clear = m.checks.filter(c => !c.away && byId(room, c.id).alive && !m.said['clr' + c.id]);
    if (clear.length && room.day > 1 && Math.random() < .3) {
      const t = byId(room, clear[0].id); m.said['clr' + t.id] = 1;
      return npcSpeak(room, p, say(p, 'detClear', { t: t.name }), { acc: [], vouch: [t.id], claim: { role: 'detective', away: [], clear: [t.id] } }, 2);
    }
  }
  // 3. mafia counter-claim
  if (mafia && !m.said.fake) {
    const rival = Object.keys(room.claims).find(k => room.claims[k].role === 'detective' && room.claims[k].away.some(id => { const t = byId(room, id); return t && t.role === 'mafia'; }));
    if (rival && pr.deception > .45 && Math.random() < .6) {
      const r = byId(room, rival); m.said.fake = 1;
      if (r && r.alive) return npcSpeak(room, p, say(p, 'counterDet', { a: r.name }), { acc: [r.id], vouch: [], claim: { role: 'detective', away: [r.id], clear: [] } }, 2);
    }
  }
  // 4. doctor claim
  if (p.role === 'doctor' && !m.docClaimed && m.lastProt && room.day > 1 && Math.random() < .25 && room.lastDeath == null) {
    const t = byId(room, m.lastProt); if (t && t.alive) { m.docClaimed = true; return npcSpeak(room, p, say(p, 'doc', { t: t.name }), { acc: [], vouch: [], claim: { role: 'doctor', away: [], clear: [] } }); }
  }
  // 5. accusations
  if (m.accToday < 3 && Math.random() < .35 + pr.talk * .45) {
    const b = bestSuspect(room, p);
    const thr = mafia ? .25 : .26 - pr.paranoia * .1;
    if (b && b.score > thr && !m.said['a' + b.p.id + room.day]) {
      m.said['a' + b.p.id + room.day] = 1; m.accToday++;
      let r = REASON[b.why] || REASON.gut; if (mafia) r = REASON[pick(['scape', 'quick', 'flip', 'gut'])];
      return npcSpeak(room, p, say(p, 'accuse', { t: b.p.name, r }), { acc: [b.p.id], vouch: [], claim: null });
    }
  }
  // 6. agreement or chatter
  const recent = room.dayAccs.slice(-6).filter(a => a.from !== p.id && a.to !== p.id);
  if (recent.length && Math.random() < .3 + pr.conform * .3) {
    const a = pick(recent), f = byId(room, a.from), t = byId(room, a.to);
    if (f && t && f.alive && t.alive && !m.said['g' + a.to + a.from]) {
      m.said['g' + a.to + a.from] = 1;
      return npcSpeak(room, p, say(p, 'agree', { a: f.name, t: t.name }), { acc: mafia || m.known[f.id] === 'mafia' ? [] : [t.id], vouch: [], claim: null }, 0);
    }
  }
  if (Math.random() < .18) npcSpeak(room, p, say(p, 'chatter'), null, 0);
}
function npcCastVote(room, p, cands) {
  if (!p.alive || (room.phase !== 'vote' && room.phase !== 'revote')) return;
  const b = bestSuspect(room, p, { cands, quiet: true });
  let target = b ? b.p : null;
  if (p.role === 'mafia' && target === null) target = byId(room, pick(cands.filter(id => id !== p.id)));
  if (p.role === 'mafia' && p.persona.deception > .6 && Math.random() < .18) {
    const ally = room.players.find(q => q.alive && q.role === 'mafia' && q.id !== p.id && cands.includes(q.id) && heat(room, q.id) >= 3);
    if (ally) target = ally;
  }
  if (!target) return;
  castVote(room, p, target.id);
  if (Math.random() < .1) npcSpeak(room, p, say(p, 'vote', { t: target.name }), { acc: [target.id], vouch: [], claim: null }, 0);
}
function npcNight(room) {   // runs when the night proper begins (nightSummon)
  const n = room.night, alive = aliveList(room);
  for (const p of alive) if (isAI(p) && (p.role === 'doctor' || p.role === 'detective')) after(room, rand(1500, 8500), () => {
    if (!p.alive || room.phase !== 'nightSummon') return;
    let best = null, bs = -9;
    if (p.role === 'doctor') { for (const q of alive) { const s = Math.random() * .5 + (q === p ? .15 : 0) + (room.claims[q.id] && room.claims[q.id].role === 'detective' ? 1 : 0) + ((q.mem && q.mem.spoke) ? .1 : 0) - (q.id === p.mem.lastProt ? .7 : 0); if (s > bs) { bs = s; best = q; } } }
    else { const done = new Set(p.mem.checks.map(c => c.id)); for (const q of alive) { if (q === p || done.has(q.id)) continue; const s = sus(p.mem, q.id) + rand(0, .9 - p.persona.iq * .5); if (s > bs) { bs = s; best = q; } } }
    if (!best) return;
    p.loc = 'at:' + houseOf(room, best); broadcast(room);        // they really walk out to that house...
    after(room, 8500, () => { if (!p.alive) return; if (p.role === 'doctor') doProtect(room, p, best); else doCheck(room, p, best); p.loc = 'home'; broadcast(room); });   // ...act, and head home
  });
}
function npcMafiaVotes(room) {
  const n = room.night;
  let order = 0;
  for (const p of aliveList(room).filter(q => q.role === 'mafia' && isAI(q))) after(room, rand(2500, 8000) + order++ * 900, () => {
    if (!p.alive || room.phase !== 'nightActions') return;
    const humanVotes = Object.entries(n.mvotes).filter(([id]) => { const q = byId(room, id); return q && !isAI(q); });
    let t; const first = Object.values(n.mvotes)[0];
    if (humanVotes.length && Math.random() < .55 + p.persona.conform * .4) t = humanVotes[0][1];
    else if (first && Math.random() < .5 + p.persona.conform * .45) t = first;
    else t = pickVictim(room, p);
    if (!t) return;
    n.mvotes[p.id] = t; const tp = byId(room, t);
    if (tp) postChat(room, 'mafia', p, say(p, 'mafiaPlan', { t: tp.name }));
    broadcast(room);
  });
}
function npcHunt(room) {
  const n = room.night, mafs = aliveList(room).filter(p => p.role === 'mafia');
  for (const p of mafs) if (isAI(p)) p.weapon = Math.random() < .3 ? 'gun' : 'knife';
  const tp = byId(room, n.target);
  if (!mafs.some(p => !isAI(p))) after(room, rand(16000, 26000), () => { if (room.phase === 'nightTravel' && !n.striker) doMurder(room, pick(mafs)); });
}
function pickVictim(room, p) {
  let best = null, bs = -9;
  for (const q of aliveList(room)) {
    if (q.role === 'mafia') continue;
    let s = Math.random() * .4 + (p.mem.threat[q.id] || 0);
    const cl = room.claims[q.id]; if (cl) s += cl.role === 'detective' ? 1.4 : .9;
    for (const a of room.dayAccs) if (a.from === q.id) { const t = byId(room, a.to); if (t && t.role === 'mafia') s += .4; }
    if (s > bs) { bs = s; best = q; }
  }
  return best ? best.id : null;
}
function npcOnReveal(room, victim, cause) {
  for (const l of room.players) {
    if (!isAI(l) || !l.alive) continue;
    const m = l.mem, pr = l.persona;
    m.known[victim.id] = victim.role === 'mafia' ? 'mafia-dead' : 'town';
    if (cause === 'lynch') {
      const accusers = new Set(room.dayAccs.filter(a => a.to === victim.id).map(a => a.from));
      const defenders = new Set(); // vouch tracking is lightweight
      for (const id of accusers) { if (id === l.id) continue; if (victim.role === 'mafia') bump(m, id, -.15); else bump(m, id, .2 * (.5 + pr.iq)); }
    }
  }
}

// ---------- state machine ----------
function dur(room, ph) {
  const pace = { relaxed: 1.4, normal: 1, fast: .7 }[room.settings.pace] || 1;
  const noH = livingHumans(room).length === 0;
  let d = BASE[ph] * (+process.env.TEST_SCALE || 1);
  if (ph === 'day') d = (room.settings.dayLen || 90) * 1000;
  if (ph === 'nightAttack' && process.env.TEST_ATTACK) d = +process.env.TEST_ATTACK;
  if (['vote', 'revote'].includes(ph)) d *= pace;
  if (noH && room.phase !== 'lobby') { const q = { day: 40000, vote: 15000, revote: 10000, nightFall: 14000, nightSummon: 12000, nightActions: 15000, nightTravel: 30000, nightReturn: 14000 }; if (q[ph]) d = q[ph]; }
  return d;
}
function setLocs(room) {
  const ph = room.phase, n = room.night;
  for (const p of room.players) {
    if (!p.alive) { p.loc = 'dead'; continue; }
    switch (ph) {
      case 'reveal': case 'nightFall': case 'nightReturn': p.loc = 'home'; break;
      case 'nightSummon': if (p.role === 'mafia') p.loc = 'meet'; else p.loc = 'home'; break;
      case 'nightActions': if (p.role === 'mafia') p.loc = 'meet'; break;
      case 'nightTravel': if (p.role === 'mafia' && n && n.target) p.loc = 'at:' + houseOf(room, byId(room, n.target)); break;
      case 'nightAttack': if (p.role === 'mafia' && n && n.target) p.loc = ((n.strikers || [n.striker]).includes(p.id) ? 'in:' : 'at:') + houseOf(room, byId(room, n.target)); break;
      default: p.loc = 'plaza';
    }
  }
}
function enter(room, ph) {
  const now = Date.now();
  room.phase = ph; room.phaseId++; room.phaseStart = now; room.phaseEnd = ph === 'gameover' ? Infinity : now + dur(room, ph); room.sched = [];
  switch (ph) {
    case 'day':
      room.day++; room.ready.clear(); room.dayAccs = []; room.claims = room.claims || {};
      for (const p of room.players) { p.mem.accToday = 0; p.mem.nextSpeak = now + rand(7000, 18000) * (1.4 - p.persona.talk); p.mem.pending = null; p.__day = room.day; }
      break;
    case 'vote': case 'revote': {
      room.votes = {};
      if (ph === 'vote') room.cands = null;
      const cands = room.cands || aliveList(room).map(p => p.id);
      for (const p of aliveList(room)) if (isAI(p)) after(room, rand(2500, ph === 'vote' ? 14000 : 9000), () => npcCastVote(room, p, cands.filter(id => id !== p.id)));
      break;
    }
    case 'nightFall': room.night = null; room.tally = null; for (const p of room.players) p.weapon = null; break;
    case 'nightSummon':
      room.night = { mvotes: {}, target: null, protect: null, check: null, striker: null, saved: false, killed: null, lockedProtect: false };
      for (const p of aliveList(room)) p.__day = room.day;
      npcNight(room);
      // anyone in the Mafia who is still indoors after a moment is dragged out to the meeting ground
      after(room, 12000, () => { aliveList(room).filter(p => p.role === 'mafia' && !isAI(p)).forEach((p, k) => { if (!p.pos || Math.hypot(p.pos.x, p.pos.z) > 9) tpWell(room, p, k); }); });
      sys(room, '🌑 Night. Leave your house and gather at the well in the middle of the village.', 'mafia');
      break;
    case 'nightActions': npcMafiaVotes(room); sys(room, '🗳️ Decide who dies tonight. Pick a name — no agreement means fate picks from your choices.', 'mafia'); break;
    case 'nightTravel': npcHunt(room); break;
    case 'nightAttack': resolveAttack(room); break;
    case 'dawn': doDawn(room); for (const p of room.players) p.weapon = null; break;
    case 'gameover': for (const p of room.players) p.shownDead = !p.alive || p.shownDead; break;
  }
  if (ph !== 'dawn') setLocs(room);
  else for (const p of room.players) p.loc = p.alive ? 'plaza' : 'dead';
  broadcast(room);
}
function checkWin(room) {
  const al = aliveList(room), m = al.filter(p => p.role === 'mafia').length, o = al.length - m;
  if (m === 0) return 'village';
  if (m >= o) return 'mafia';
  return null;
}
function resolveTarget(room) {
  const n = room.night, mafs = aliveList(room).filter(p => p.role === 'mafia');
  const cnt = {}; for (const [id, t] of Object.entries(n.mvotes)) { const q = byId(room, id); if (q && q.alive && q.role === 'mafia') cnt[t] = (cnt[t] || 0) + 1; }
  const top = Math.max(0, ...Object.values(cnt)), tied = Object.keys(cnt).filter(k => cnt[k] === top);
  let how = '';
  if (!tied.length) { n.target = pickVictim(room, mafs[0] || { mem: { threat: {} } }) || pick(aliveList(room).filter(p => p.role !== 'mafia')).id; how = ' Nobody chose, so fate picked.'; }
  else { n.target = pick(tied); if (tied.length > 1) how = ' No agreement, so fate picked one of the names you chose.'; }
  sys(room, `🎯 Target locked: ${byId(room, n.target).name}'s house.${how} Grab a weapon from the crate and go!`, 'mafia');
}
function resolveAttack(room) {
  const n = room.night, victim = byId(room, n.target), striker = byId(room, n.striker);
  n.saved = n.protect === victim.id;
  if (n.saved) {
    victim.mem.saw = striker.id;
    victim.notes.push({ t: `Night ${room.day}: Someone broke in... it was ${striker.name}! A golden light shielded you. You survived — and now you know the attacker.`, day: room.day });
    const doc = room.players.find(p => p.role === 'doctor' && p.alive);
    if (doc && n.protect === victim.id) doc.notes.push({ t: `Night ${room.day}: The Mafia struck ${victim.name}'s house — your protection saved them!`, day: room.day });
  } else {
    victim.alive = false; victim.loc = 'dead'; n.killed = victim.id;
    victim.notes.push({ t: `You were murdered by ${striker.name}.`, day: room.day });
  }
}
function doDawn(room) {
  const n = room.night; room.lastDeath = null;
  if (n && n.killed) {
    const v = byId(room, n.killed); v.shownDead = true; room.lastDeath = { id: v.id, name: v.name, role: v.role, cause: 'night' };
    sys(room, `☀️ Dawn breaks... 🩸 ${v.name} was MURDERED last night. They were the ${v.role.toUpperCase()}.`);
    npcOnReveal(room, v, 'night');
    for (const l of room.players) if (isAI(l) && l.alive) { l.mem.nextSpeak = Date.now() + rand(9000, 20000); }
    after(room, rand(2500, 5000), () => { const l = pick(room.players.filter(p => p.alive && isAI(p))); if (l) npcSpeak(room, l, say(l, 'died', { v: v.name, role: v.role }), null, 2); });
  } else {
    sys(room, '☀️ Dawn breaks... the Mafia struck, but their victim lives! Nobody was murdered last night.');
    after(room, rand(2500, 5000), () => { const l = pick(room.players.filter(p => p.alive && isAI(p))); if (l) npcSpeak(room, l, say(l, 'safe'), null, 2); });
  }
  room.pendingWin = checkWin(room);
}
function castVote(room, p, target) {
  if (!p.alive || (room.phase !== 'vote' && room.phase !== 'revote')) return;
  if (target !== 'abstain') {
    const t = byId(room, target); if (!t || !t.alive || t.id === p.id) return;
    if (room.cands && !room.cands.includes(target)) return;
  }
  room.votes[p.id] = target;
  if (Object.keys(room.votes).length >= aliveList(room).length) room.phaseEnd = Math.min(room.phaseEnd, Date.now() + 1800);
  broadcast(room);
}
function resolveVote(room) {
  if (process.env.NO_LYNCH) room.votes = {};
  const counts = {}; for (const t of Object.values(room.votes)) if (t !== 'abstain') counts[t] = (counts[t] || 0) + 1;
  const top = Math.max(0, ...Object.values(counts)), tied = Object.keys(counts).filter(k => counts[k] === top);
  if (top > 0 && tied.length > 1 && room.phase === 'vote') {
    sys(room, `⚖️ A tie between ${tied.map(i => byId(room, i).name).join(' and ')}! The village votes again.`);
    room.cands = tied; room.tally = { counts, tie: true, tied }; room.revoted = true;
    return enter(room, 'revote');
  }
  let elim = null;
  if (top > 0 && tied.length === 1) elim = byId(room, tied[0]);
  room.tally = { counts, eliminated: elim ? elim.id : null, tie: tied.length > 1, tied };
  if (elim) {
    elim.alive = false; elim.shownDead = true; elim.loc = 'dead';
    room.lastDeath = { id: elim.id, name: elim.name, role: elim.role, cause: 'vote' };
    sys(room, `🗳️ The village has spoken. ${elim.name} is eliminated. They were the ${elim.role.toUpperCase()}.`);
    npcOnReveal(room, elim, 'lynch');
  } else { room.lastDeath = null; sys(room, room.tally.tie ? '⚖️ Tied again — nobody is eliminated today.' : '🗳️ No votes were cast. Nobody is eliminated.'); }
  room.cands = null; room.pendingWin = checkWin(room);
  enter(room, 'voteResult');
}
function advance(room) {
  switch (room.phase) {
    case 'reveal': return enter(room, 'day');
    case 'day': return enter(room, 'vote');
    case 'vote': case 'revote': return resolveVote(room);
    case 'voteResult': room.revoted = false; if (room.pendingWin) return endGame(room, room.pendingWin); return enter(room, 'nightFall');
    case 'nightFall':   // curfew: anyone still outside is sent to bed, and the doors are sealed
      for (const p of aliveList(room)) if (!isAI(p) && !isHomeP(room, p)) tpHome(room, p, '⚡ Curfew! You were sent home — your door is sealed until dawn.');
      return enter(room, 'nightSummon');
    case 'nightSummon': return enter(room, 'nightActions');
    case 'nightActions': resolveTarget(room); return enter(room, 'nightTravel');
    case 'nightTravel': {   // out of time: the attack happens anyway
      const n = room.night, mafs = aliveList(room).filter(p => p.role === 'mafia');
      return doMurder(room, mafs.find(p => !isAI(p)) || pick(mafs));
    }
    case 'nightAttack': return enter(room, 'nightReturn');
    case 'nightReturn':
      for (const p of aliveList(room)) if (!isAI(p) && ['mafia', 'detective', 'doctor'].includes(p.role) && !isHomeP(room, p)) tpHome(room, p, '🏠 You took too long — you were sent home.');
      return enter(room, 'dawn');
    case 'dawn': if (room.pendingWin) return endGame(room, room.pendingWin); return enter(room, 'day');
  }
}
function endGame(room, w) {
  room.winner = w;
  sys(room, w === 'village' ? '🎉 The Mafia has been rooted out. THE VILLAGE WINS!' : '🔪 The Mafia has taken over. THE MAFIA WINS!');
  enter(room, 'gameover');
}
function doCheck(room, p, target) {
  const n = room.night; if (!n || n.check || !ACTPH.has(room.phase)) return false;
  if (!target || !target.alive || target.id === p.id) return false;
  n.check = target.id;
  const away = !isHomeP(room, target);    // is the occupant physically out of their house right now?
  p.mem.checks.push({ id: target.id, away });
  p.mem.known[target.id] = away ? 'mafia' : 'town';
  p.notes.push({ t: away ? `Night ${room.day}: ${target.name}'s house was EMPTY — they were out in the dark. Only Mafia are supposed to leave their houses at night...` : `Night ${room.day}: ${target.name} was safely at home.`, day: room.day, kind: away ? 'bad' : 'good' });
  broadcast(room); return true;
}
function doProtect(room, p, target) {
  const n = room.night; if (!n || n.lockedProtect || !ACTPH.has(room.phase)) return false;
  if (!target || !target.alive) return false;
  n.protect = target.id; p.mem.lastProt = target.id;
  p.notes.push({ t: `Night ${room.day}: You are protecting ${target.name}'s house.`, day: room.day, kind: 'good' });
  broadcast(room); return true;
}
function doMurder(room, striker) {
  const n = room.night; if (!n || n.striker || room.phase !== 'nightTravel') return;
  n.striker = striker.id; n.lockedProtect = true;   // the Doctor's choice is locked BEFORE the attack is finalised
  const vi = room.players.findIndex(p => p.id === n.target), h = hg(room, vi);
  if (!isAI(striker) && !insideHouse(room, vi, striker.pos, .8)) { const [x, z] = l2w(h, -.7, -1.7); tpTo(room, striker, x, z, h.yaw, '⏱ Time was up — you were pulled into the house.'); }
  n.strikers = [striker.id];   // every Mafia member who is in there joins in: NPCs walk in, humans must already be inside
  for (const q of aliveList(room)) if (q.role === 'mafia' && q.id !== striker.id && (isAI(q) || insideHouse(room, vi, q.pos, .8))) n.strikers.push(q.id);
  enter(room, 'nightAttack');
}
function tickRoom(room, now) {
  if (room.phase === 'lobby') { if (!allClients(room).length && now - room.emptySince > 120000) rooms.delete(room.code); return; }
  if (!allClients(room).some(c => c.connected !== false)) { if (!room.emptySince) room.emptySince = now; if (now - room.emptySince > 300000) rooms.delete(room.code); } else room.emptySince = now;
  if (room.phase === 'gameover') return;
  for (const s of room.sched.slice()) if (s.at <= now) { room.sched.splice(room.sched.indexOf(s), 1); try { s.fn(); } catch (e) { console.error(e); } }
  if (now >= room.phaseEnd) return advance(room);
  const ph = room.phase;
  if (ph === 'day' || ph === 'dawn' || ph === 'vote' || ph === 'revote') for (const p of aliveList(room)) if (isAI(p)) npcDayTick(room, p, now);
  if (ph === 'day') { const lh = livingHumans(room); if (lh.length && lh.every(p => room.ready.has(p.id)) && room.phaseEnd - now > 2500) { room.phaseEnd = now + 1500; broadcast(room); } }
  if (ph === 'nightActions') {
    const n = room.night, mafs = aliveList(room).filter(p => p.role === 'mafia');
    if (now - room.phaseStart > 6000 && mafs.every(p => n.mvotes[p.id]) && room.phaseEnd - now > 1500) room.phaseEnd = now + 1200;
  }
  if (ph === 'nightReturn') {
    const out = aliveList(room).filter(p => ['mafia', 'detective', 'doctor'].includes(p.role) && !isAI(p) && !isHomeP(room, p));
    if (now - room.phaseStart > 12000 && !out.length && room.phaseEnd - now > 1500) room.phaseEnd = now + 1000;
  }
}
setInterval(() => { const now = Date.now(); for (const room of [...rooms.values()]) { try { tickRoom(room, now); } catch (e) { console.error(e); } } }, 300);

// ---------- game start / reset ----------
function startGame(room) {
  const S = room.settings;
  const hs = humans(room).length;
  let name = 0; const used = new Set(room.players.map(p => p.name.toLowerCase()));
  const pool = shuffle(NPC_NAMES);
  while (room.players.length < S.size) {
    let nm = pool.find(n => !used.has(n.toLowerCase())) || 'Bot' + (room.players.length + 1);
    used.add(nm.toLowerCase()); pool.splice(pool.indexOf(nm), 1);
    room.players.push(newPlayer(room, nm, true));
  }
  room.players = shuffle(room.players);
  const mc = clamp(S.mafia || autoMafia(S.size), 1, Math.floor((S.size - 1) / 2));
  const roles = shuffle([...Array(mc).fill('mafia'), 'detective', 'doctor', ...Array(Math.max(0, S.size - mc - 2)).fill('villager')]);
  room.players.forEach((p, i) => { p.role = roles[i]; p.alive = true; p.shownDead = false; p.notes = []; p.pos = null; p.weapon = null; });
  if (process.env.FORCE_ROLE) { const h = room.players.find(p => !p.isNPC), o = room.players.find(p => p.role === process.env.FORCE_ROLE); if (h && o && h !== o) { [h.role, o.role] = [o.role, h.role]; } }
  initMem(room);
  room.day = 0; room.winner = null; room.claims = {}; room.dayAccs = []; room.lastDeath = null; room.tally = null; room.pendingWin = null; room.night = null;
  room.chats.mafia = []; room.chats.ghost = [];
  sys(room, `🏘️ A new game begins in the village — ${room.players.length} villagers, ${mc} of them Mafia. Check your house...`);
  enter(room, 'reveal');
}
function resetToLobby(room) {
  room.players = room.players.filter(p => !p.isNPC && p.connected);
  for (const p of room.players) { p.role = null; p.alive = true; p.shownDead = false; p.loc = 'home'; p.notes = []; p.mem = null; }
  room.phase = 'lobby'; room.phaseId++; room.winner = null; room.day = 0; room.night = null; room.tally = null; room.sched = [];
  room.chats = { public: [], mafia: [], ghost: [] };
  if (!room.players.concat(room.watchers).some(c => c.id === room.hostId)) room.hostId = (room.players[0] || room.watchers[0] || {}).id || null;
  broadcast(room);
  for (const c of allClients(room)) sendFull(room, c);
}

// ---------- connections ----------
function attach(ws, room, c) {
  c.ws = ws; c.connected = true; ws.ctx = { room, id: c.id, watcher: !!c.watcher };
  if (!room.hostId) room.hostId = c.id;
  send(ws, { type: 'joined', code: room.code, token: c.token, id: c.id, watcher: !!c.watcher });
  sendFull(room, c); broadcast(room);
}
function clientOf(ws) {
  const x = ws.ctx; if (!x) return null;
  const room = rooms.get(x.room.code); if (!room) return null;
  const c = x.watcher ? room.watchers.find(w => w.id === x.id) : room.players.find(p => p.id === x.id);
  return c ? { room, c } : null;
}
function onClose(ws) {
  const r = clientOf(ws); if (!r) return;
  const { room, c } = r; if (c.ws !== ws) return;
  c.ws = null; c.connected = false;
  if (c.watcher) { room.watchers = room.watchers.filter(w => w !== c); }
  else if (room.phase === 'lobby') { room.players = room.players.filter(p => p !== c); }
  if (room.hostId === c.id) {
    const nh = [...room.players.filter(p => !p.isNPC && p.connected), ...room.watchers][0];
    room.hostId = nh ? nh.id : null;
  }
  if (room.phase === 'lobby') room.emptySince = room.emptySince || Date.now();
  broadcast(room);
}
function handle(ws, m) {
  switch (m.type) {
    case 'create': {
      const room = newRoom(), name = cleanName(m.name);
      room.settings.size = clamp(+m.size || 8, 4, 16);
      room.settings.pace = ['relaxed', 'normal', 'fast'].includes(m.pace) ? m.pace : 'normal';
      if (m.watch) { const w = { id: uid(), token: uid() + uid(), name, watcher: true, ws: null, connected: true, alive: false }; room.watchers.push(w); return attach(ws, room, w); }
      const p = newPlayer(room, name, false, ws); room.players.push(p); return attach(ws, room, p);
    }
    case 'join': {
      const room = rooms.get(String(m.code || '').toUpperCase().trim());
      if (!room) return send(ws, { type: 'error', msg: 'No room with that code.' });
      const name = uniqueName(room, cleanName(m.name));
      if (room.phase === 'lobby' && !m.watch) {
        if (humans(room).length >= room.settings.size) return send(ws, { type: 'error', msg: 'That room is full.' });
        const p = newPlayer(room, name, false, ws); room.players.push(p); return attach(ws, room, p);
      }
      const w = { id: uid(), token: uid() + uid(), name, watcher: true, ws: null, connected: true, alive: false }; room.watchers.push(w); return attach(ws, room, w);
    }
    case 'rejoin': {
      const room = rooms.get(String(m.code || '').toUpperCase());
      if (!room) return send(ws, { type: 'gone' });
      const c = room.players.find(p => p.token === m.token && !p.isNPC) || room.watchers.find(w => w.token === m.token);
      if (!c) return send(ws, { type: 'gone' });
      if (c.ws && c.ws !== ws) try { c.ws.close(); } catch { }
      return attach(ws, room, c);
    }
  }
  const r = clientOf(ws); if (!r) return;
  const { room, c } = r, me = c.watcher ? null : c;
  switch (m.type) {
    case 'settings': {
      if (room.phase !== 'lobby' || c.id !== room.hostId) return;
      const S = room.settings;
      if (m.size != null) S.size = clamp(Math.max(+m.size || 8, humans(room).length), 4, 16);
      if (m.mafia != null) S.mafia = clamp(+m.mafia || 0, 0, Math.floor((S.size - 1) / 2));
      if (S.mafia > Math.floor((S.size - 1) / 2)) S.mafia = 0;
      if (['relaxed', 'normal', 'fast'].includes(m.pace)) S.pace = m.pace;
      if (m.dayLen != null) S.dayLen = clamp(Math.round(+m.dayLen) || 90, 30, 600);
      return broadcast(room);
    }
    case 'start': if (room.phase === 'lobby' && c.id === room.hostId) startGame(room); return;
    case 'kick': {
      if (room.phase !== 'lobby' || c.id !== room.hostId) return;
      const t = room.players.find(p => p.id === m.id && p.id !== c.id);
      if (t) { if (t.ws) { send(t.ws, { type: 'gone', msg: 'You were removed by the host.' }); try { t.ws.close(); } catch { } } room.players = room.players.filter(p => p !== t); broadcast(room); }
      return;
    }
    case 'chat': {
      const text = String(m.text || '').trim().slice(0, 220); if (!text) return;
      const now = Date.now(); if (now - (c.lastMsg || 0) < 500) return; c.lastMsg = now;
      const god = isGod(room, c);
      if (room.phase === 'lobby') return postChat(room, 'public', c.watcher ? { id: c.id, name: c.name } : c, text);
      if (m.ch === 'mafia' && me && me.alive && me.role === 'mafia') return postChat(room, 'mafia', me, text);
      if (god && (m.ch === 'ghost' || m.ch === 'public' || m.ch === 'mafia')) return postChat(room, 'ghost', c.watcher ? { id: c.id, name: c.name + ' 👁' } : me, text);
      if (m.ch === 'public' && me && me.alive && CHAT_OK.has(room.phase)) return postChat(room, 'public', me, text);
      return;
    }
    case 'accuse': {
      if (!me || !me.alive || !['day', 'dawn', 'vote', 'revote'].includes(room.phase)) return;
      const t = byId(room, m.target); if (!t || !t.alive || t.id === me.id) return;
      return postChat(room, 'public', me, `🫵 I accuse ${t.name}! I think ${t.name} is Mafia!`, { acc: [t.id], vouch: [], claim: null });
    }
    case 'ready': {
      if (!me || !me.alive || room.phase !== 'day') return;
      if (room.ready.has(me.id)) room.ready.delete(me.id); else { room.ready.add(me.id); sys(room, `✋ ${me.name} is ready to vote.`); }
      return broadcast(room);
    }
    case 'vote': return me && castVote(room, me, m.target);
    case 'night': {
      if (!me || !me.alive || room.phase !== 'nightActions' || !room.night) return;
      const t = byId(room, m.target); if (!t || !t.alive) return;
      const n = room.night;
      if (m.action === 'kill' && me.role === 'mafia' && t.role !== 'mafia') {
        n.mvotes[me.id] = t.id;
        for (const q of room.players) if (q.role === 'mafia' && q.alive && isAI(q) && !n.mvotes[q.id] && Math.random() < .5) { /* NPCs will follow on their own schedule */ }
        postChat(room, 'mafia', null, `🔪 ${me.name} votes to strike ${t.name}.`);
        return broadcast(room);
      }
      return;
    }
    case 'weapon': {   // Mafia pick a weapon up from the crate at the meeting ground
      if (!me || !me.alive || me.role !== 'mafia' || !room.night || !ACTPH.has(room.phase) || !['knife', 'gun'].includes(m.w)) return;
      if (me.pos && Math.hypot(me.pos.x - RACK.x, me.pos.z - RACK.z) > 8) return;
      me.weapon = m.w; postChat(room, 'mafia', null, `${m.w === 'gun' ? '🔫' : '🔪'} ${me.name} took the ${m.w}.`); return broadcast(room);
    }
    case 'murder': {   // the Mafia strike by themselves, inside the victim's house
      const n = room.night;
      if (!me || !me.alive || me.role !== 'mafia' || room.phase !== 'nightTravel' || !n || n.striker || !me.weapon) return;
      const vi = room.players.findIndex(p => p.id === n.target);
      if (!insideHouse(room, vi, me.pos, .8)) return send(ws, { type: 'notice', text: 'Get inside the victim\'s house first.' });
      return doMurder(room, me);
    }
    case 'investigate': { if (me && me.alive && me.role === 'detective') { if (!doCheck(room, me, byId(room, m.target))) send(ws, { type: 'notice', text: 'You can only investigate once, during the night, before the Mafia return.' }); } return; }
    case 'protect': { if (me && me.alive && me.role === 'doctor') { if (!doProtect(room, me, byId(room, m.target))) send(ws, { type: 'notice', text: 'Too late — the Mafia have already struck.' }); } return; }
    case 'pos': {
      if (!me || !me.alive || room.phase === 'lobby') return;
      me.pos = { x: +m.x || 0, z: +m.z || 0, t: Date.now() };
      const o = { type: 'pos', id: me.id, x: +m.x || 0, z: +m.z || 0, ry: +m.ry || 0 };
      for (const cl of allClients(room)) if (cl.id !== me.id) send(cl.ws, o);
      return;
    }
    case 'playagain': if (room.phase === 'gameover' && c.id === room.hostId) resetToLobby(room); return;
    case 'leave': {
      ws.ctx = null; c.ws = null; c.connected = false; c.token = 'x' + uid();
      if (c.watcher) room.watchers = room.watchers.filter(w => w !== c);
      else if (room.phase === 'lobby') room.players = room.players.filter(p => p !== c);
      if (room.hostId === c.id) { const nh = [...room.players.filter(p => !p.isNPC && p.connected), ...room.watchers][0]; room.hostId = nh ? nh.id : null; }
      return broadcast(room);
    }
  }
}
wss.on('connection', ws => {
  ws.isAlive = true; ws.on('pong', () => ws.isAlive = true);
  ws.on('message', raw => { let m; try { m = JSON.parse(raw); } catch { return; } try { handle(ws, m); } catch (e) { console.error(e); send(ws, { type: 'error', msg: 'Server hiccup — try again.' }); } });
  ws.on('close', () => onClose(ws));
});
setInterval(() => { for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; try { ws.ping(); } catch { } } }, 25000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  MAFIA: THE VILLAGE is running!\n  → http://localhost:${PORT}`);
  for (const ip of lanIps()) console.log(`  → http://${ip}:${PORT}   (friends on your Wi-Fi)`);
  console.log('');
});
