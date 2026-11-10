/* MAFIA: THE VILLAGE — client: networking, UI, chat, sound */
(function () {
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { } }, del(k) { try { localStorage.removeItem(k); } catch { } } };

  // ---------- sound ----------
  let AC = null, muted = store.get('mv_mute') === '1';
  function ac() { if (!AC) { try { AC = new (window.AudioContext || window.webkitAudioContext)(); } catch { } } if (AC && AC.state === 'suspended') AC.resume(); return AC; }
  function tone(f, d, type = 'sine', v = .08, slide = 0, delay = 0) {
    if (muted) return; const a = ac(); if (!a) return; const t = a.currentTime + delay, o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, f + slide), t + d);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + .02); g.gain.exponentialRampToValueAtTime(.0001, t + d); o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + d + .05);
  }
  function noise(d, v = .1, delay = 0) { if (muted) return; const a = ac(); if (!a) return; const n = a.sampleRate * d, b = a.createBuffer(1, n, a.sampleRate), x = b.getChannelData(0); for (let i = 0; i < n; i++) x[i] = (Math.random() * 2 - 1) * (1 - i / n); const s = a.createBufferSource(), g = a.createGain(); s.buffer = b; g.gain.value = v; s.connect(g); g.connect(a.destination); s.start(a.currentTime + delay); }
  const SFX = {
    pop() { tone(660, .12, 'sine', .05, 300); }, click() { tone(440, .08, 'triangle', .05); }, tick() { tone(900, .05, 'square', .02); },
    night() { [220, 277, 330].forEach((f, i) => tone(f, 1.8, 'sine', .05, -30, i * .15)); },
    dawn() { [523, 659, 784, 1046].forEach((f, i) => tone(f, .7, 'triangle', .06, 0, i * .13)); },
    stab() { noise(.35, .2); tone(120, .5, 'sawtooth', .1, -80); tone(1400, .15, 'square', .05, -900); },
    holy() { [784, 988, 1175, 1568].forEach((f, i) => tone(f, .9, 'sine', .06, 0, i * .09)); },
    ghost() { tone(500, 1.4, 'sine', .05, 400); tone(503, 1.4, 'sine', .05, 400); },
    creak() { tone(90, 1.4, 'sawtooth', .04, 60); tone(130, 1.2, 'sawtooth', .02, -40, .3); },
    role() { [392, 523, 659].forEach((f, i) => tone(f, .6, 'triangle', .06, 0, i * .12)); },
    win() { [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, .8, 'triangle', .07, 0, i * .12)); },
    lose() { [330, 277, 220, 165].forEach((f, i) => tone(f, .9, 'sawtooth', .05, 0, i * .18)); },
    vote() { tone(300, .1, 'square', .04); tone(500, .12, 'square', .04, 0, .06); },
    zap() { noise(.25, .12); tone(1800, .2, 'sawtooth', .05, -1400); },
  };
  World.sfx = n => SFX[n] && SFX[n]();
  $('btnMute').textContent = muted ? '🔇' : '🔊';
  $('btnMute').onclick = () => { muted = !muted; store.set('mv_mute', muted ? '1' : '0'); $('btnMute').textContent = muted ? '🔇' : '🔊'; ac(); };
  addEventListener('pointerdown', () => ac(), { once: true });

  // ---------- network ----------
  let ws = null, S = null, prev = null, session = null, myId = null, lastPhaseId = -1, endAt = 0, totalMs = 1, reconTimer = 0;
  const chats = { public: [], mafia: [], ghost: [] }; let tab = 'public'; const unread = { public: 0, mafia: 0, ghost: 0 };
  try { session = JSON.parse(store.get('mv_session') || 'null'); } catch { }
  function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }
  // ----- phone layout: a body class drives the compact HUD
  const mobileMQ = matchMedia('(max-width:820px)'), coarseMQ = matchMedia('(pointer:coarse)');
  function applyMobile() { const m = mobileMQ.matches || (coarseMQ.matches && innerWidth < 1100); document.body.classList.toggle('mobile', m); document.body.classList.toggle('landscape', m && innerWidth > innerHeight); window.IS_MOBILE = m; }
  applyMobile(); addEventListener('resize', applyMobile); addEventListener('orientationchange', applyMobile);
  World.send = send;
  World.onToast = t => toast(t);
  // ----- things near you you can interact with (press E for the first one)
  World.onNear = list => {
    const el = $('interact'); el.innerHTML = list.map((a, i) => `<button class="btn ${a.act === 'murder' ? 'primary' : ''}" data-i="${i}">${i === 0 ? '<kbd>E</kbd> ' : ''}${esc(a.label)}</button>`).join('');
    for (const b of el.querySelectorAll('button')) b.onclick = () => doAct(list[+b.dataset.i]);
  };
  World.onAct = a => doAct(a);
  function doAct(a) {
    if (!a) return; SFX.click();
    if (a.act === 'talk') openTag(a.id);
    else if (a.act === 'weapon') send({ type: 'weapon', w: a.w });
    else if (a.act === 'murder') send({ type: 'murder' });
    else if (a.act === 'investigate') send({ type: 'investigate', target: a.id });
    else if (a.act === 'protect') send({ type: 'protect', target: a.id });
    else if (['sleep', 'getup', 'window'].includes(a.act)) World.localAct(a);
  }
  // ----- "say something about this person" — tags them in the public chat
  let tagId = null;
  function openTag(id) {
    if (!S) return; const p = S.players.find(x => x.id === id); if (!p || p.id === S.you.id) return;
    if (!S.you.alive || S.god) return toast('Ghosts can\'t talk to the living.');
    if (!['day', 'vote', 'revote', 'voteResult', 'dawn'].includes(S.phase)) return toast('Nobody can talk right now — it\'s night.');
    tagId = id; $('tagName').textContent = p.name; $('tagIn').value = ''; $('tagBox').classList.remove('hidden');
    $('tagVote').style.display = (S.phase === 'vote' || S.phase === 'revote') && p.alive ? '' : 'none'; setTimeout(() => $('tagIn').focus(), 30);
  }
  function closeTag() { $('tagBox').classList.add('hidden'); tagId = null; $('tagIn').blur(); }
  function sendTag() { const t = $('tagIn').value.trim(); const p = S && S.players.find(x => x.id === tagId); if (!t || !p) return closeTag(); send({ type: 'chat', ch: 'public', text: `@${p.name} ${t}` }); closeTag(); }
  $('tagSend').onclick = sendTag; $('tagX').onclick = closeTag; $('tagVote').onclick = () => { if (tagId) send({ type: 'vote', target: tagId }); SFX.vote(); closeTag(); };
  $('tagIn').addEventListener('keydown', e => { if (e.key === 'Enter') sendTag(); if (e.key === 'Escape') closeTag(); });
  for (const b of $('camBtns').querySelectorAll('button')) b.onclick = () => { World.setCam(b.dataset.m); hideViewTip(); };
  const CAMS = [['chase', '🎥', 'Chase'], ['eye', '👁', 'Eye'], ['top', '🛰', 'Overview']];
  $('camFab').onclick = () => { const i = CAMS.findIndex(c => c[0] === World.camMode); const n = CAMS[(i + 1) % 3]; World.setCam(n[0]); hideViewTip(); };
  $('btnMenu').onclick = () => { $('menuSheet').classList.toggle('hidden'); $('mAlive').textContent = S ? '👥 ' + S.players.filter(p => p.alive).length + ' / ' + S.players.length + ' alive' : ''; };
  $('mSound').onclick = () => $('btnMute').click(); $('mJournal').onclick = () => { $('menuSheet').classList.add('hidden'); $('btnJournal').click(); };
  const tickerEl = $('ticker');
  function ticker(m) { if (chatOpen || !S || S.phase === 'lobby') return; const d = document.createElement('div'); d.className = 'tk'; d.innerHTML = m.sys ? esc(m.text) : '<b>' + esc(m.name) + ':</b> ' + esc(m.text); tickerEl.appendChild(d); while (tickerEl.children.length > 3) tickerEl.firstChild.remove(); setTimeout(() => d.remove(), 7200); }
  World.onCam = m => { const c = CAMS.find(x => x[0] === m); if (c) { $('camFabIcon').textContent = c[1]; $('camFabTxt').textContent = c[2]; } World.onCam0 && World.onCam0(m); };
  World.onCam0 = m => { for (const b of $('camBtns').querySelectorAll('button')) b.classList.toggle('on', b.dataset.m === m); };
  function connect() {
    ws = new WebSocket(window.MAFIA_SERVER || ((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host));
    ws.onopen = () => { $('conn').classList.add('hidden'); if (session) send({ type: 'rejoin', code: session.code, token: session.token }); };
    ws.onclose = () => { $('conn').classList.remove('hidden'); clearTimeout(reconTimer); reconTimer = setTimeout(connect, 1500); };
    ws.onmessage = ev => { let m; try { m = JSON.parse(ev.data); } catch { return; } onMsg(m); };
  }
  function onMsg(m) {
    switch (m.type) {
      case 'joined': session = { code: m.code, token: m.token }; store.set('mv_session', JSON.stringify(session)); myId = m.id; break;
      case 'error': $('homeErr').textContent = m.msg; break;
      case 'gone': session = null; store.del('mv_session'); S = null; showScreen('home'); if (m.msg) $('homeErr').textContent = m.msg; World.setInGame(false); break;
      case 'hist': for (const ch of ['public', 'mafia', 'ghost']) { chats[ch] = m.hist[ch] || []; } unread.public = unread.mafia = unread.ghost = 0; renderChat(); break;
      case 'chat': onChat(m.m); break;
      case 'pos': World.onPos && World.onPos(m); break;
      case 'tp': World.teleport && World.teleport(m); break;
      case 'notice': toast(m.text); break;
      case 'state': onState(m); break;
    }
  }

  // ---------- screens ----------
  function showScreen(n) {
    $('home').classList.toggle('hidden', n !== 'home'); $('lobby').classList.toggle('hidden', n !== 'lobby'); $('hud').classList.toggle('hidden', n !== 'hud');
    World.setInGame(n === 'hud');
  }
  // home
  $('name').value = store.get('mv_name') || '';
  const qp = new URLSearchParams(location.search).get('room'); if (qp) { $('code').value = qp.toUpperCase(); $('joinOpts').classList.remove('hidden'); }
  $('btnCreate').onclick = () => { $('createOpts').classList.toggle('hidden'); $('joinOpts').classList.add('hidden'); SFX.click(); };
  $('btnJoinShow').onclick = () => { $('joinOpts').classList.toggle('hidden'); $('createOpts').classList.add('hidden'); SFX.click(); };
  $('size').oninput = () => $('sizeV').textContent = $('size').value;
  let pace = 'normal'; for (const b of $('paceSeg').children) b.onclick = () => { pace = b.dataset.v; for (const x of $('paceSeg').children) x.classList.toggle('on', x === b); };
  const nm = () => { const v = $('name').value.trim() || 'Player' + Math.floor(Math.random() * 90 + 10); store.set('mv_name', $('name').value.trim()); return v; };
  $('btnCreateGo').onclick = () => { $('homeErr').textContent = ''; send({ type: 'create', name: nm(), size: +$('size').value, pace, watch: $('watch').checked }); };
  $('btnJoinGo').onclick = () => { $('homeErr').textContent = ''; send({ type: 'join', code: $('code').value.trim().toUpperCase(), name: nm() }); };
  $('code').addEventListener('keydown', e => { if (e.key === 'Enter') $('btnJoinGo').click(); });
  $('btnLeave').onclick = $('btnHome').onclick = () => { send({ type: 'leave' }); session = null; store.del('mv_session'); S = null; $('gameover').classList.add('hidden'); showScreen('home'); };

  // lobby
  let lan = [];
  if (!window.MAFIA_SERVER) fetch('/api/info').then(r => r.json()).then(j => { lan = j.ips.map(ip => `http://${ip}:${j.port}`); }).catch(() => { });
  function inviteLink() { const base = (location.hostname === 'localhost' || location.hostname === '127.0.0.1') && lan[0] ? lan[0] : location.origin; return `${base}/?room=${S.code}`; }
  $('btnCopy').onclick = () => { const t = `Join my Mafia: The Village game! Code ${S.code} → ${inviteLink()}`; (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(() => $('btnCopy').textContent = 'Copied ✓', () => prompt('Copy this invite:', t)); setTimeout(() => $('btnCopy').textContent = 'Copy invite', 1800); };
  $('lobSize').oninput = () => send({ type: 'settings', size: +$('lobSize').value });
  $('lobMafia').oninput = () => send({ type: 'settings', mafia: +$('lobMafia').value });
  $('lobDay').oninput = () => send({ type: 'settings', dayLen: +$('lobDay').value });
  for (const b of $('lobPace').children) b.onclick = () => send({ type: 'settings', pace: b.dataset.v });
  $('btnStart').onclick = () => send({ type: 'start' });
  function renderLobby() {
    $('lobCode').textContent = S.code; $('lanLink').innerHTML = lan.length ? `Friends on your Wi-Fi: <b>${esc(inviteLink())}</b>` : '';
    const host = S.hostId === S.you.id, set = S.settings;
    $('hostCtl').classList.toggle('hidden', !host); $('guestInfo').classList.toggle('hidden', host);
    $('lobSize').value = set.size; $('lobSizeV').textContent = set.size; $('lobSize').min = Math.max(4, S.players.length);
    const max = Math.floor((set.size - 1) / 2); $('lobMafia').max = max; $('lobMafia').value = Math.min(set.mafia, max);
    $('lobMafiaV').textContent = set.mafia ? set.mafia : `auto (${Math.max(1, Math.floor(set.size / 4))})`;
    for (const b of $('lobPace').children) b.classList.toggle('on', b.dataset.v === set.pace);
    $('lobDay').value = set.dayLen || 90; $('lobDayV').textContent = (set.dayLen || 90) >= 120 ? Math.round((set.dayLen || 90) / 6) / 10 + ' min' : (set.dayLen || 90) + 's';
    const slots = []; const faces = ['😀', '😎', '🤠', '🥳', '😺', '🦊', '🐸', '🐼'];
    S.players.forEach((p, i) => slots.push(`<div class="slot ${p.id === S.you.id ? 'me' : ''}"><div class="av" style="background:${p.look.color}">${faces[i % faces.length]}</div><div><b>${esc(p.name)}</b><small>${p.host ? '👑 host' : 'player'}</small></div>${host && p.id !== S.you.id ? `<span class="x" data-k="${p.id}">✕</span>` : ''}</div>`));
    for (let i = S.players.length; i < set.size; i++) slots.push(`<div class="slot empty"><div class="av" style="background:#555">🤖</div><div><b>NPC</b><small>auto-fill</small></div></div>`);
    $('slots').innerHTML = slots.join('');
    for (const x of $('slots').querySelectorAll('.x')) x.onclick = () => send({ type: 'kick', id: x.dataset.k });
    const watchers = S.nHumans - S.players.length; if (S.you.watcher) $('guestInfo').textContent = 'You are watching. The host will start the game…'; else $('guestInfo').textContent = `Waiting for the host to start…${watchers > 0 ? ` (${watchers} watching)` : ''}`;
    $('btnStart').textContent = S.players.length === 0 ? '▶ Start (all-NPC game)' : `▶ Start Game (${S.players.length} human${S.players.length > 1 ? 's' : ''} + ${set.size - S.players.length} NPC)`;
  }

  // ---------- chat ----------
  function myChannels() {
    const c = ['public']; if (!S) return c;
    if (S.god) { c.push('ghost'); if (S.god && S.you.watcher || S.god) c.push('mafia'); }
    else if (S.you.role === 'mafia' && S.you.alive) c.push('mafia');
    return [...new Set(c)];
  }
  const chName = { public: '🏘 Village', mafia: '🔪 Mafia', ghost: '👻 Ghosts' };
  function renderTabs() {
    const ch = myChannels(); if (!ch.includes(tab)) tab = 'public';
    $('tabs').innerHTML = ch.map(c => `<button data-c="${c}" class="${c} ${c === tab ? 'on' : ''}">${chName[c]}${unread[c] ? '<span class="dot"></span>' : ''}</button>`).join('');
    for (const b of $('tabs').children) b.onclick = () => { tab = b.dataset.c; unread[tab] = 0; renderChat(); };
    const inp = $('chatIn');
    let can = false, ph = '';
    if (tab === 'public') { can = S.god ? false : (S.you.alive && ['lobby', 'day', 'vote', 'revote', 'voteResult', 'dawn'].includes(S.phase)); ph = can ? 'Say something to the village…' : (S.god ? 'Ghosts cannot speak to the living — use the Ghosts tab' : 'The village is asleep…'); }
    else if (tab === 'mafia') { can = S.you.role === 'mafia' && S.you.alive; ph = can ? 'Whisper to your fellow Mafia…' : 'Mafia channel (read-only)'; }
    else { can = S.god; ph = 'Chat with the other ghosts…'; }
    inp.disabled = !can; inp.placeholder = ph;
  }
  function msgHtml(m) {
    if (m.sys) return `<div class="msg sys">${esc(m.text)}</div>`;
    const mine = m.from === (S && S.you.id), p = S && S.players.find(x => x.id === m.from), col = p ? p.look.color : '#fff';
    return `<div class="msg ${mine ? 'me' : ''} ${m.ch === 'mafia' ? 'mafia' : m.ch === 'ghost' ? 'ghost' : ''}"><b style="color:${col}">${esc(m.name)}</b>${esc(m.text)}</div>`;
  }
  function renderChat() { if (!S) return; renderTabs(); const box = $('msgs'); box.innerHTML = chats[tab].map(msgHtml).join(''); box.scrollTop = box.scrollHeight; }
  function onChat(m) {
    chats[m.ch].push(m); if (chats[m.ch].length > 200) chats[m.ch].shift();
    if (m.ch === tab) { const box = $('msgs'); const near = box.scrollHeight - box.scrollTop - box.clientHeight < 80; box.insertAdjacentHTML('beforeend', msgHtml(m)); if (near || m.from === (S && S.you.id)) box.scrollTop = box.scrollHeight; }
    else { unread[m.ch]++; renderTabs(); }
    if (m.from && m.ch !== 'ghost') { World.bubble(m.from, m.text); } else if (m.from && S && S.god) World.bubble(m.from, m.text);
    if (m.ch === 'public') ticker(m);
    if (m.from !== (S && S.you.id)) { SFX.pop(); if (!chatOpen && m.ch === tab) { chatUnread++; for (const id of ['chatBadge', 'pillBadge']) { $(id).classList.remove('hidden'); $(id).textContent = chatUnread; } } }
    
  }
  $('chatForm').onsubmit = e => { e.preventDefault(); const t = $('chatIn').value.trim(); if (!t || $('chatIn').disabled) return; send({ type: 'chat', ch: tab, text: t }); $('chatIn').value = ''; };
  // ----- show / hide chat (it can cover the village, so hiding it is obvious: a button in the panel, a button on the top bar, a pill, and the H key)
  let chatUnread = 0, chatOpen = true;
  function setChat(open, remember = true) {
    chatOpen = open; $('chatPanel').classList.toggle('min', !open); document.body.classList.toggle('chatOpen', open); $('chatPill').classList.toggle('hidden', open || !S || S.phase === 'lobby');
    if (open) { chatUnread = 0; const box = $('msgs'); box.scrollTop = box.scrollHeight; }
    for (const id of ['chatBadge', 'pillBadge']) { $(id).classList.toggle('hidden', !chatUnread); $(id).textContent = chatUnread; }
    if (remember) store.set('mv_chat', open ? '1' : '0');
  }
  $('btnChatToggle').onclick = () => setChat(!chatOpen); $('chatMin').onclick = () => setChat(false); $('chatPill').onclick = () => setChat(true);
  addEventListener('keydown', e => { if (/INPUT|TEXTAREA/.test(e.target.tagName)) return; if (e.code === 'KeyH') setChat(!chatOpen); });
  { const pref = store.get('mv_chat'); setChat(innerWidth > 820 ? pref !== '0' : false, false); }   // phones start with chat hidden
  $('btnJournal').onclick = () => { $('journal').classList.toggle('hidden'); renderJournal(); };
  $('jclose').onclick = () => $('journal').classList.add('hidden');
  function renderJournal() {
    if (!S) return; const n = S.notes || [];
    $('jbody').innerHTML = (n.length ? n.map(x => `<div class="jn ${x.kind || ''}">${esc(x.t)}</div>`).join('') : '<div class="jn">Nothing yet. Secrets you learn will be written here.</div>') + `<div class="jn">🎭 Your role: <b>${S.you.role ? S.you.role.toUpperCase() : 'spectator'}</b></div>`;
  }
  function toast(t) { const d = document.createElement('div'); d.className = 'toast'; d.textContent = t; $('toasts').appendChild(d); setTimeout(() => d.remove(), 7600); }

  // ---------- banners ----------
  let bannerT = 0;
  function banner(big, small, color = '#ffd24a') {
    const b = $('banner'); b.style.setProperty('--bc', color); b.innerHTML = `<div class="big">${esc(big)}</div><div class="small">${esc(small || '')}</div>`;
    b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
  }

  // ---------- state handling ----------
  const ROLES = {
    mafia: { icon: '🔪', name: 'MAFIA', bg: 'linear-gradient(160deg,#7a0f2b,#ff3355)', desc: 'By night you meet your fellow Mafia, pick a victim and visit their house. By day, lie your way out of trouble. Win when Mafia ≥ everyone else.' },
    detective: { icon: '🕵️', name: 'DETECTIVE', bg: 'linear-gradient(160deg,#0d4a6b,#2ac3e8)', desc: 'Each night, check ONE house: is the owner home or away? Mafia must leave their houses to kill — so an empty house is a giveaway!' },
    doctor: { icon: '💉', name: 'DOCTOR', bg: 'linear-gradient(160deg,#0f6a4a,#3ee0a0)', desc: 'Each night, protect ONE house. If the Mafia strike it, the victim survives — and sees who attacked them.' },
    villager: { icon: '🧑‍🌾', name: 'VILLAGER', bg: 'linear-gradient(160deg,#7a5a14,#ffc83a)', desc: 'No special powers — just your wits. Talk, watch, and vote out the Mafia before they take over the village.' },
  };
  const LOCKPH = new Set(['nightSummon', 'nightActions', 'nightTravel', 'nightAttack', 'nightReturn']);
  const NIGHTP = new Set(['nightFall', 'nightSummon', 'nightActions', 'nightTravel', 'nightAttack', 'nightReturn']);
  function phaseInfo(s) {
    const me = s.you, mafia = me.role === 'mafia' && me.alive, god = s.god;
    const sleepy = 'Everyone is asleep in their houses…';
    switch (s.phase) {
      case 'reveal': return ['🎭', 'Welcome!', 'Check your secret role'];
      case 'day': return ['☀️', `Day ${s.day}`, 'Discuss — who is the Mafia?'];
      case 'vote': return ['🗳️', 'Vote!', 'Pick who to eliminate'];
      case 'revote': return ['⚖️', 'Tie — Revote!', 'Only the tied players are on the ballot'];
      case 'voteResult': return ['📜', 'The Verdict', 'The votes are counted…'];
      case 'nightFall': return ['🌆', `Night ${s.day}`, 'Everyone heads home…'];
      case 'nightSummon': return ['🌙', `Night ${s.day}`, mafia || god ? 'The Mafia slip out of their houses…' : sleepy];
      case 'nightActions': return ['🌙', `Night ${s.day}`, god ? 'Night actions in progress' : mafia ? 'Choose your victim' : me.role === 'detective' && me.alive ? 'Investigate a house' : me.role === 'doctor' && me.alive ? 'Protect a house' : sleepy];
      case 'nightTravel': return ['🌙', `Night ${s.day}`, mafia || god ? 'The Mafia creep toward their victim…' : sleepy];
      case 'nightAttack': return ['🌙', `Night ${s.day}`, mafia || god ? 'The strike!' : sleepy];
      case 'nightReturn': return ['🌙', `Night ${s.day}`, mafia || god ? 'Returning home…' : sleepy];
      case 'dawn': return ['🌅', 'Dawn', 'The village wakes up…'];
      case 'gameover': return ['🏁', 'Game Over', s.winner === 'village' ? 'The Village wins!' : 'The Mafia wins!'];
    }
    return ['🏘', '', ''];
  }
  let viewTipDone = false;
  function hideViewTip() { $('viewTip').classList.add('hidden'); $('camBtns').classList.remove('pulse'); $('camFab').classList.remove('pulse'); }
  function onState(s) {
    prev = S; S = s; myId = s.you.id;
    endAt = Date.now() + (s.left < 0 ? 1e9 : s.left); totalMs = s.total > 0 ? s.total : 1;
    if (s.phase === 'lobby') {
      showScreen('lobby'); renderLobby(); $('gameover').classList.add('hidden'); $('roleCard').classList.add('hidden'); World.mode = null; lastPhaseId = -1;
      World.setState(s, null); return;
    }
    showScreen('hud');
    if (!viewTipDone) { viewTipDone = true; $('viewTip').classList.remove('hidden'); $('camBtns').classList.add('pulse'); $('camFab').classList.add('pulse'); setTimeout(hideViewTip, 14000); }
    $('chatPill').classList.toggle('hidden', chatOpen);
    const newPhase = s.phaseId !== lastPhaseId;
    const pv = prev && prev.phase !== 'lobby' ? prev : null;
    World.setState(s, pv);
    if (s.votedCount > (pv ? pv.votedCount : 0) && (s.phase === 'vote' || s.phase === 'revote') && !newPhase) { World.ballot(); SFX.vote(); }
    if (s.notes.length > (pv ? pv.notes.length : 0) && pv) { const n = s.notes[s.notes.length - 1]; toast('📓 ' + n.t); }
    if (newPhase) { lastPhaseId = s.phaseId; onNewPhase(s, pv); }
    const [ic, ti, su] = phaseInfo(s);
    $('phaseIcon').textContent = ic; $('phaseTitle').textContent = ti; $('phaseSub').textContent = su;
    const me = s.you, R = ROLES[me.role];
    $('roleChip').innerHTML = me.watcher ? '👁 Spectating' : R ? `${R.icon} ${R.name}${me.alive ? '' : ' 👻'}` : '';
    $('roleChip').style.background = R && !me.watcher ? R.bg.replace('160deg', '90deg') : '';
    const al = s.players.filter(p => p.alive).length;
    $('aliveChip').textContent = `👥 ${al}/${s.players.length}`;
    renderTabs(); renderActions(); renderJournal();
    if (s.phase === 'gameover') showGameOver(s); else $('gameover').classList.add('hidden');
  }
  function onNewPhase(s, pv) {
    const me = s.you;
    switch (s.phase) {
      case 'reveal':
        if (me.role) { const R = ROLES[me.role]; $('rcIcon').textContent = R.icon; $('rcName').textContent = R.name; let d = R.desc; if (me.role === 'mafia') { const al = s.players.filter(p => p.role === 'mafia' && p.id !== me.id).map(p => p.name); d += al.length ? ` Your partners: ${al.join(', ')}.` : ' You work alone.'; } $('rcDesc').textContent = d; document.querySelector('.rcBack').style.setProperty('--rcbg', R.bg); document.querySelector('.rcBack').style.background = R.bg; const rc = $('roleCard'); rc.classList.remove('hidden'); const inner = rc.querySelector('.rcInner'); inner.style.animation = 'none'; void inner.offsetWidth; inner.style.animation = ''; SFX.role(); setTimeout(() => $('roleCard').classList.add('hidden'), 7500); }
        else banner('A new game!', 'You are watching the village.');
        break;
      case 'day': banner(`☀ Day ${s.day}`, s.day === 1 ? 'Talk, accuse, defend — find the Mafia!' : 'Discuss who to eliminate.', '#ffd24a'); break;
      case 'vote': banner('🗳 VOTE!', 'Click a villager or pick below. Votes are secret.', '#ff5d8f'); break;
      case 'revote': banner('⚖ TIE!', 'Revote between the tied players.', '#ff9f43'); break;
      case 'voteResult': { const t = s.tally; if (t && t.eliminated) { const p = s.players.find(x => x.id === t.eliminated); banner(`${p.name} is OUT`, `They were the ${(p.role || '?').toUpperCase()}`, p.role === 'mafia' ? '#3ee0a0' : '#ff4d5e'); } else banner('No one is eliminated', t && t.tie ? 'Tied again…' : 'The village could not decide.', '#9aa5ff'); break; }
      case 'nightFall': banner(`🌙 Night ${s.day}`, 'Everyone goes home and locks the door…', '#8a9bff'); break;
      case 'dawn': { let d = s.lastDeath && s.lastDeath.cause === 'night' ? s.lastDeath : null; if (!d && pv) { const q = s.players.find(p => p.dead && pv.players.find(o => o.id === p.id && !o.dead)); if (q) d = { name: q.name, role: q.role || '?', cause: 'night' }; } if (d) banner(`🌅 ${d.name} was MURDERED`, `Stabbed in their sleep. They were the ${String(d.role).toUpperCase()}.`, '#ff4d5e'); else banner('🌅 Nobody was murdered', 'The Mafia struck — but the victim lived!', '#3ee0a0'); break; }
      case 'nightAttack': break;
    }
  }
  function showGameOver(s) {
    const me = s.you, won = me.role ? (s.winner === 'village') === (me.role !== 'mafia') : null;
    $('goTitle').textContent = s.winner === 'village' ? '🎉 VILLAGE WINS!' : '🔪 MAFIA WINS!';
    $('goTitle').style.color = s.winner === 'village' ? '#3ee0a0' : '#ff4d5e';
    $('goSub').textContent = won === null ? 'What a game!' : won ? 'Victory — nicely played! 🏆' : 'Defeat — better luck next time.';
    $('goList').innerHTML = s.players.map(p => `<div class="gp ${p.role === 'mafia' ? 'mafia' : ''} ${p.alive ? '' : 'dead'}"><i style="background:${p.look.color};width:16px;height:16px;border-radius:50%;display:inline-block"></i>${esc(p.name)} ${p.role ? { mafia: '🔪', detective: '🕵️', doctor: '💉', villager: '🧑‍🌾' }[p.role] : ''}${p.alive ? '' : ' 💀'}</div>`).join('');
    const host = s.hostId === me.id; $('btnAgain').style.display = host ? '' : 'none';
    if ($('gameover').classList.contains('hidden')) { won === false ? SFX.lose() : SFX.win(); setTimeout(() => { if (S && S.phase === 'gameover') $('gameover').classList.remove('hidden'); }, 1800); }
  }
  $('btnAgain').onclick = () => send({ type: 'playagain' });
  $('roleCard').onclick = () => $('roleCard').classList.add('hidden');

  // ---------- actions panel ----------
  let accCool = 0;
  function chip(p, opts = {}) {
    return `<button class="pick ${opts.cls || ''} ${opts.sel ? 'sel' : ''}" data-id="${p.id}"><i style="background:${p.look.color}"></i>${esc(p.name)}${opts.n ? `<span class="n">${opts.n}</span>` : ''}</button>`;
  }
  function bind(rootSel, fn) { for (const b of $('actions').querySelectorAll(rootSel)) b.onclick = () => { SFX.click(); fn(b.dataset.id, b); }; }
  let actOpen = false;
  function renderActions() {
    const s = S, me = s.you, A = $('actions'); let html = '', mode = null;
    const alive = s.players.filter(p => p.alive), others = alive.filter(p => p.id !== me.id);
    const iAmAlive = me.alive && !me.watcher && !s.god;
    const ph = s.phase, role = me.role, N = s.night;
    const box = (title, body = '') => `<div class="abox"><h4>${title}</h4>${body}</div>`;
    if (ph === 'reveal') html = box(me.role ? 'Click the card to dismiss' : 'Watching', '<p>Look around — you are on your own doorstep. Walk anywhere you like.</p>');
    else if (s.god && ph !== 'gameover') {
      let g = '';
      if (s.god && LOCKPH.has(ph)) { const t = id => (s.players.find(p => p.id === id) || {}).name; g = `<p>🔪 Mafia votes: ${Object.keys(s.god.mvotes || {}).length ? Object.entries(s.god.mvotes).map(([a, b]) => `${t(a)}→${t(b)}`).join(', ') : '…'}${s.god.target ? ` · 🎯 ${t(s.god.target)}` : ''}</p>${s.god.protect ? `<p>💉 Doctor protects: ${t(s.god.protect)}</p>` : ''}${s.god.check ? `<p>🕵️ Detective checks: ${t(s.god.check)}</p>` : ''}`; }
      html = box(`👻 ${me.watcher ? 'Spectating' : 'You are a ghost'}`, `<p>Fly around with WASD (Q/E down/up). You see everything, but can only talk with other ghosts.</p>${g}`);
    }
    else if (ph === 'day' || ph === 'dawn') {
      html = `<div class="abox"><h4>${ph === 'dawn' ? '🌅 The village wakes' : '💬 Discuss'} — walk up to someone to talk, or tap a name</h4>`;
      html += `<div class="chips">${others.map(p => chip(p)).join('')}</div>`;
      if (ph === 'day') html += `<p style="font-size:.8rem">You can enter any house. Voting starts when the timer ends.</p><button class="btn small primary" id="rdy">${s.youReady ? '✔ Ready to vote (tap to undo)' : '✋ I\'m ready to vote'}</button> <small>${s.ready} ready</small>`;
      html += '</div>';
    }
    else if (ph === 'vote' || ph === 'revote') {
      const cands = s.cands ? alive.filter(p => s.cands.includes(p.id) && p.id !== me.id) : others;
      html = `<div class="abox"><h4>🗳️ Cast your secret vote <small>(${s.votedCount}/${alive.length} voted — no vote = nobody)</small></h4><div class="chips">${cands.map(p => chip(p, { cls: 'danger', sel: s.yourVote === p.id })).join('')}</div><button class="btn small ${s.yourVote === 'abstain' ? 'primary' : ''}" id="abs">🤐 Vote nobody</button></div>`;
      mode = { kind: 'player', valid: id => cands.some(p => p.id === id), selected: s.yourVote, color: '#ff4d5e' };
    }
    else if (ph === 'voteResult') {
      const t = s.tally, p = t && t.eliminated && s.players.find(x => x.id === t.eliminated);
      html = box(`📜 ${p ? `${esc(p.name)} has been eliminated` : 'Nobody is eliminated'}`, p ? `<p>They were the <b>${(p.role || '').toUpperCase()}</b>.</p>` : '');
    }
    else if (ph === 'nightFall' && iAmAlive) html = box('🌙 CURFEW — get inside your house!', '<p>When the timer hits zero, anyone still outside is thrown into bed and every door is <b>sealed</b> until dawn.</p>' + (['mafia', 'detective', 'doctor'].includes(role) ? '<p>You will be called out later tonight…</p>' : ''));
    else if (LOCKPH.has(ph) && iAmAlive) {
      if (role === 'mafia' && N) {
        if (ph === 'nightSummon') html = box('🌑 Go to the meeting ground', '<p>Follow the beacon to the well. If you stay indoors you\'ll be dragged out. Chat privately in the Mafia tab.</p>');
        else if (ph === 'nightActions') { const t = alive.filter(p => p.role !== 'mafia'); html = box('🔪 Choose tonight\'s victim <small>(no agreement → fate picks from your choices)</small>', `<div class="chips">${t.map(p => chip(p, { cls: 'danger', sel: N.you === p.id, n: Object.values(N.mvotes || {}).filter(v => v === p.id).length || '' })).join('')}</div>`); }
        else if (ph === 'nightTravel') {
          const vn = N.victimHouse >= 0 ? s.players[N.victimHouse].name : '?';
          html = box(`🎯 Target: ${esc(vn)}`, !N.weapon ? '<p>1. Take a <b>weapon</b> from the crate at the meeting ground (press <kbd>E</kbd> near it).</p>' : N.struck ? '<p>Done.</p>' : `<p>2. Follow the beacon to <b>${esc(vn)}</b>'s house, step inside and find them in bed.</p><p>3. Press <b>${N.weapon === 'gun' ? 'SHOOT' : 'MURDER'}</b> when you\'re next to them.</p><p style="font-size:.8rem">If you take too long, the game does it for you.</p>`);
        }
        else if (ph === 'nightAttack') html = box('😈 It is done…', '<p>Get ready to run.</p>');
        else html = box('🏃 RUN HOME!', '<p>Get back into your house before time runs out — or you\'ll be teleported.</p>');
      }
      else if (role === 'detective' && N) html = box('🔍 Detective', ph === 'nightReturn' || ph === 'nightAttack' ? '<p>Head home now.</p>' : N.used ? `<p><b>${esc((s.notes[s.notes.length - 1] || {}).t || 'Result saved in your journal 📓')}</b></p><p>Go home when you\'re ready.</p>` : '<p>Your door is unlocked. Sneak out to <b>any house</b> and press <kbd>E</kbd> → Investigate. Is the owner home… or out in the dark?</p><p style="font-size:.8rem">Do it before the Mafia return home!</p>');
      else if (role === 'doctor' && N) html = box('💉 Doctor', ph === 'nightReturn' || ph === 'nightAttack' ? '<p>Head home now.</p>' : `<p>Your door is unlocked. Walk to the house you want to protect and press <kbd>E</kbd> → Protect. ${N.protect ? '<b>(Protecting: ' + esc((s.players.find(p => p.id === N.protect) || {}).name) + ')</b>' : ''}</p><p style="font-size:.8rem">The Mafia strike soon — choose before they do!</p>`);
      else html = box('😴 Your door is sealed until dawn', '<p>Stay inside. Look out of your <b>windows</b> — you may see something moving in the dark… but you won\'t see who.</p>');
    }
    A.innerHTML = html;
    World.mode = mode;
    if (window.IS_MOBILE) {
      const ab = A.querySelector('.abox'), h4 = ab && ab.querySelector('h4');
      if (ab && h4) { if (actOpen || ph === 'vote' || ph === 'revote' || (ph === 'nightActions' && role === 'mafia')) ab.classList.add('open'); h4.onclick = () => { actOpen = !actOpen; ab.classList.toggle('open', actOpen); }; }
    }
    const rdy = $('rdy'); if (rdy) rdy.onclick = () => { send({ type: 'ready' }); SFX.click(); };
    const abs = $('abs'); if (abs) abs.onclick = () => { send({ type: 'vote', target: 'abstain' }); SFX.click(); };
    if (ph === 'day' || ph === 'dawn') bind('.pick', id => openTag(id));
    if (ph === 'vote' || ph === 'revote') bind('.pick', id => send({ type: 'vote', target: id }));
    if (ph === 'nightActions' && role === 'mafia') bind('.pick', id => send({ type: 'night', action: 'kill', target: id }));
  }
  World.onclick = h => {
    if (!S || h.type !== 'player') return;
    if (h.id === S.you.id) return;
    SFX.click(); openTag(h.id);
  };

  // ---------- timer ----------
  setInterval(() => {
    if (!S || S.phase === 'lobby') return;
    if (S.left < 0) { $('timerTxt').textContent = '∞'; $('tring').style.strokeDashoffset = 0; return; }
    const left = Math.max(0, endAt - Date.now()), sec = Math.ceil(left / 1000);
    $('timerTxt').textContent = sec; $('tring').style.strokeDashoffset = 119.4 * (1 - left / totalMs);
    $('tring').style.stroke = sec <= 5 ? '#ff4d5e' : '#ffd24a';
    if (sec <= 5 && sec > 0 && (S.phase === 'vote' || S.phase === 'day' || S.phase === 'revote' || S.phase === 'nightActions') && Math.abs(left % 1000 - 999) < 120) SFX.tick();
  }, 200);

  connect();
})();
