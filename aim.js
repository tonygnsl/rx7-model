/* Aim Trainer : 3 cibles a l'ecran, touche-les le plus vite possible pendant 30 s.
   - les cibles retrecissent et disparaissent plus vite au fil de la partie
   - combo : x1 -> x3 en enchainant les cibles sans rater
   - une cible qui disparait ou un clic dans le vide casse le combo (-5 pts)
   Fichier externe (CSP script-src 'self'). Le score est verifie par api_score.php. */
(function () {
  'use strict';

  var root = document.getElementById('game');
  if (!root || root.dataset.game !== 'aim') return;

  var cv = document.getElementById('aimcanvas');
  var ctx = cv.getContext('2d');
  var W = cv.width, H = cv.height;
  var csrf = document.querySelector('meta[name="csrf"]').content;
  var statusEl = document.getElementById('status');
  var timerEl = document.getElementById('timer');
  var startBtn = document.getElementById('startBtn');

  /* ---------- reglages ---------- */
  var DURATION = 30;                 // secondes de jeu
  var COUNTDOWN = 3;                 // 3, 2, 1 avant de commencer
  var NB_TARGETS = 3;                // cibles visibles en meme temps
  var R_START = 32, R_END = 18;      // rayon des cibles au debut / a la fin
  var LIFE_START = 2.4, LIFE_END = 1.3;  // duree de vie d'une cible (s)
  var HIT_PTS = 10, MISS_PTS = 5;
  var COOLDOWN = 1500;               // pause apres la partie avant de pouvoir relancer

  var COL = { bg: '#121318', grid: 'rgba(255,255,255,.04)', text: '#f4efe6', muted: '#a7a5ae',
              accent: '#ff5a1f', ring: '#f4efe6', good: '#ffd27a', bad: '#e5484d' };

  /* ---------- etat ---------- */
  var state = 'idle';                // idle | starting | countdown | running | cooldown
  var targets = [], fx = [];
  var t0 = 0, playStart = 0, endAt = 0;
  var pts = 0, hits = 0, misses = 0, combo = 0, bestCombo = 0, reactSum = 0;
  var result = null;
  var mouse = { x: W / 2, y: H / 2, in: false };
  var startTarget = { x: W / 2, y: H / 2 + 20, r: 46 };
  var best = readBest();

  function say(t) { statusEl.textContent = t; }

  function readBest() { try { return parseInt(localStorage.getItem('aimBest'), 10) || 0; } catch (e) { return 0; } }
  function saveBest(v) { try { localStorage.setItem('aimBest', String(v)); } catch (e) { /* stockage indisponible */ } }

  /* ---------- son (petits bips, aucun fichier a charger) ---------- */
  var audio = null;
  function beep(freq, dur, type, vol) {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      var o = audio.createOscillator(), g = audio.createGain();
      o.type = type || 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(vol || 0.08, audio.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + dur);
      o.connect(g); g.connect(audio.destination);
      o.start(); o.stop(audio.currentTime + dur);
    } catch (e) { /* pas de son, pas grave */ }
  }

  /* ---------- serveur ---------- */
  function api(payload) {
    return fetch('api_score.php', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: JSON.stringify(payload)
    }).then(function (r) {
      return r.json().then(function (d) {
        if (!r.ok) throw new Error(d.error || 'Erreur');
        return d;
      });
    });
  }

  function loadTop() {
    fetch('api_score.php?action=top&game=aim', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var ol = document.getElementById('top');
        ol.textContent = '';
        var top = d.top || [];
        if (!top.length) {
          var li0 = document.createElement('li');
          li0.textContent = 'Aucun score pour le moment';
          ol.appendChild(li0);
        }
        top.forEach(function (row) {
          var li = document.createElement('li');
          li.textContent = row.username + ' : ' + row.score;
          ol.appendChild(li);
        });
      }).catch(function () {});
  }

  /* ---------- regles ---------- */
  function progress(now) { return Math.min(1, Math.max(0, (now - playStart) / (DURATION * 1000))); }
  function lerp(a, b, k) { return a + (b - a) * k; }
  function multiplier() { return Math.min(3, 1 + Math.floor(combo / 5) * 0.5); }   // x1, x1.5, x2, x2.5, x3
  function accuracy() { var t = hits + misses; return t ? Math.round(hits * 100 / t) : 100; }

  function grade(s) {
    if (s >= 2000) return 'S';
    if (s >= 1400) return 'A';
    if (s >= 900) return 'B';
    if (s >= 500) return 'C';
    return 'D';
  }

  function newTarget(now) {
    var k = progress(now);
    var r = lerp(R_START, R_END, k);
    var m = r + 10, t, tries = 0;
    do {
      t = { x: m + Math.random() * (W - 2 * m), y: 56 + m + Math.random() * (H - 56 - 2 * m),
            r: r, born: now, life: lerp(LIFE_START, LIFE_END, k) * 1000 };
    } while (++tries < 40 && targets.some(function (o) { return Math.hypot(o.x - t.x, o.y - t.y) < (o.r + t.r) * 1.8; }));
    return t;
  }

  function miss(x, y, label) {
    misses++;
    combo = 0;
    pts = Math.max(0, pts - MISS_PTS);
    fx.push({ kind: 'miss', x: x, y: y, life: 1 });
    fx.push({ kind: 'text', x: x, y: y - 16, life: 1, txt: label || '-' + MISS_PTS, col: COL.bad });
    beep(140, 0.12, 'square', 0.05);
  }

  /* ---------- deroulement ---------- */
  function begin() {
    state = 'starting';
    result = null;
    say('...');
    api({ action: 'start', game: 'aim' }).then(function () {
      pts = 0; hits = 0; misses = 0; combo = 0; bestCombo = 0; reactSum = 0;
      targets = []; fx = [];
      t0 = performance.now();
      state = 'countdown';
      say('Prépare-toi...');
    }).catch(function (e) { state = 'idle'; say(e.message); });
  }

  function play(now) {
    playStart = now;
    endAt = now + DURATION * 1000;
    for (var i = 0; i < NB_TARGETS; i++) targets.push(newTarget(now));
    state = 'running';
    say('Enchaîne les cibles sans rater pour monter le combo (jusqu’à x3).');
    beep(880, 0.15, 'triangle', 0.08);
  }

  function finish() {
    state = 'cooldown';
    targets = [];
    var record = pts > best;
    if (record) { best = pts; saveBest(best); }
    result = { score: pts, hits: hits, misses: misses, acc: accuracy(), combo: bestCombo,
               react: hits ? Math.round(reactSum / hits) : 0, grade: grade(pts), record: record };
    timerEl.textContent = 'Terminé';
    say(hits + ' cibles, ' + result.acc + ' % de précision (enregistrement...)');
    beep(520, 0.25, 'triangle', 0.08);
    var saved = api({ action: 'submit', game: 'aim', score: pts })
      .then(function () { say('Score enregistré : ' + pts + ' 🎯'); loadTop(); })
      .catch(function (e) { say('Score refusé : ' + e.message); });
    var waited = new Promise(function (r) { setTimeout(r, COOLDOWN); });
    Promise.all([saved, waited]).then(function () { state = 'idle'; });
  }

  /* ---------- souris / doigt ---------- */
  function toCanvas(e) {
    var r = cv.getBoundingClientRect();
    return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height };
  }

  cv.addEventListener('pointermove', function (e) {
    var p = toCanvas(e);
    mouse.x = p.x; mouse.y = p.y; mouse.in = true;
  });
  cv.addEventListener('pointerleave', function () { mouse.in = false; });
  cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  cv.addEventListener('pointerdown', function (e) {
    if (!e.isTrusted) return;             // ignore les clics simules par script
    e.preventDefault();
    var p = toCanvas(e), now = performance.now();
    if (state === 'idle') {
      if (Math.hypot(p.x - startTarget.x, p.y - startTarget.y) <= startTarget.r) begin();
      return;
    }
    if (state !== 'running') return;
    for (var i = 0; i < targets.length; i++) {
      var t = targets[i];
      if (Math.hypot(p.x - t.x, p.y - t.y) <= t.r) {
        var gain = Math.round(HIT_PTS * multiplier());
        hits++;
        combo++;
        bestCombo = Math.max(bestCombo, combo);
        pts += gain;
        reactSum += now - t.born;
        fx.push({ kind: 'ring', x: t.x, y: t.y, r: t.r, life: 1 });
        fx.push({ kind: 'text', x: t.x, y: t.y - t.r - 6, life: 1, txt: '+' + gain, col: COL.good });
        beep(620 + Math.min(combo, 20) * 25, 0.07, 'sine', 0.07);   // le son monte avec le combo
        targets[i] = newTarget(now);
        return;
      }
    }
    miss(p.x, p.y);
  });

  /* ---------- dessin ---------- */
  function drawTarget(x, y, r, alpha) {
    var rings = [COL.accent, COL.ring, COL.accent, COL.ring];
    ctx.globalAlpha = alpha;
    for (var i = 0; i < rings.length; i++) {
      ctx.beginPath();
      ctx.arc(x, y, r * (1 - i * 0.24), 0, Math.PI * 2);
      ctx.fillStyle = rings[i];
      ctx.fill();
    }
    ctx.beginPath(); ctx.arc(x, y, r * 0.12, 0, Math.PI * 2); ctx.fillStyle = COL.accent; ctx.fill();
    ctx.globalAlpha = 1;
  }

  function text(t, x, y, size, col, align, weight) {
    ctx.font = (weight || 700) + ' ' + size + 'px system-ui, sans-serif';
    ctx.fillStyle = col;
    ctx.textAlign = align || 'center';
    ctx.fillText(t, x, y);
  }

  function drawBackground() {
    ctx.fillStyle = COL.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = COL.grid;
    ctx.lineWidth = 1;
    for (var gx = 0; gx <= W; gx += 60) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke(); }
    for (var gy = 0; gy <= H; gy += 60) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke(); }
  }

  function drawHud(now) {
    var left = Math.max(0, endAt - now);
    text(pts + ' pts', 16, 34, 24, COL.text, 'left');
    text(hits + ' touchées · ' + misses + ' ratés · ' + accuracy() + ' %', 150, 33, 15, COL.muted, 'left', 500);
    text((left / 1000).toFixed(1) + ' s', W - 16, 34, 24, left < 5000 ? COL.accent : COL.text, 'right');
    if (combo >= 5) text('COMBO x' + multiplier() + '  (' + combo + ')', W / 2, 34, 20, COL.good);
    // barre de temps
    ctx.fillStyle = 'rgba(255,255,255,.08)';
    ctx.fillRect(0, 48, W, 4);
    ctx.fillStyle = left < 5000 ? COL.accent : COL.text;
    ctx.fillRect(0, 48, W * left / (DURATION * 1000), 4);
  }

  function drawMenu() {
    if (result) {
      text(result.grade, W / 2 - 150, 120, 64, result.grade === 'S' ? COL.good : COL.accent);
      text(result.score + ' pts', W / 2 + 30, 104, 40, COL.text);
      text(result.record ? 'Nouveau record perso !' : 'Record perso : ' + best, W / 2 + 30, 132, 16,
           result.record ? COL.good : COL.muted, 'center', 600);
      text(result.hits + ' cibles · ' + result.acc + ' % de précision · combo max ' + result.combo +
           ' · ' + result.react + ' ms par cible', W / 2, 172, 16, COL.muted, 'center', 500);
    } else {
      text('AIM TRAINER', W / 2, 110, 40, COL.text);
      text('30 s · les cibles rétrécissent et disparaissent de plus en plus vite', W / 2, 142, 16, COL.muted, 'center', 500);
      if (best) text('Record perso : ' + best, W / 2, 168, 16, COL.good, 'center', 600);
    }
    var ready = state === 'idle';
    drawTarget(startTarget.x, startTarget.y, startTarget.r, ready ? 1 : 0.3);
    if (ready) text(result ? 'Clique pour rejouer' : 'Clique pour démarrer', W / 2, startTarget.y + startTarget.r + 30, 18, COL.text, 'center', 600);
  }

  function drawFx() {
    for (var i = fx.length - 1; i >= 0; i--) {
      var f = fx[i];
      f.life -= f.kind === 'text' ? 0.03 : 0.06;
      if (f.life <= 0) { fx.splice(i, 1); continue; }
      ctx.globalAlpha = f.life;
      if (f.kind === 'text') {
        text(f.txt, f.x, f.y - (1 - f.life) * 24, 18, f.col);
      } else {
        ctx.strokeStyle = f.kind === 'ring' ? COL.good : COL.bad;
        ctx.lineWidth = 3;
        ctx.beginPath();
        if (f.kind === 'ring') ctx.arc(f.x, f.y, f.r + (1 - f.life) * 22, 0, Math.PI * 2);
        else { ctx.moveTo(f.x - 7, f.y - 7); ctx.lineTo(f.x + 7, f.y + 7); ctx.moveTo(f.x + 7, f.y - 7); ctx.lineTo(f.x - 7, f.y + 7); }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
  }

  function drawCrosshair() {
    if (!mouse.in) return;
    ctx.strokeStyle = COL.text;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(mouse.x - 12, mouse.y); ctx.lineTo(mouse.x - 4, mouse.y);
    ctx.moveTo(mouse.x + 4, mouse.y); ctx.lineTo(mouse.x + 12, mouse.y);
    ctx.moveTo(mouse.x, mouse.y - 12); ctx.lineTo(mouse.x, mouse.y - 4);
    ctx.moveTo(mouse.x, mouse.y + 4); ctx.lineTo(mouse.x, mouse.y + 12);
    ctx.stroke();
  }

  /* ---------- boucle principale ---------- */
  function frame(now) {
    drawBackground();

    if (state === 'countdown') {
      var n = COUNTDOWN - Math.floor((now - t0) / 1000);
      if (n <= 0) play(now);
      else {
        text(String(n), W / 2, H / 2 + 30, 110, COL.accent);
        timerEl.textContent = DURATION + ' s';
      }
    }

    if (state === 'running') {
      // cibles expirees = ratees
      for (var i = 0; i < targets.length; i++) {
        var t = targets[i];
        if (now - t.born > t.life) { miss(t.x, t.y, 'trop lent'); targets[i] = newTarget(now); }
      }
      targets.forEach(function (t) {
        var age = (now - t.born) / t.life;
        var pop = Math.min(1, (now - t.born) / 90);                   // petite apparition
        drawTarget(t.x, t.y, t.r * (0.6 + 0.4 * pop), age > 0.7 ? 1 - (age - 0.7) * 2 : 1);  // s'efface en fin de vie
      });
      drawHud(now);
      timerEl.textContent = (Math.max(0, endAt - now) / 1000).toFixed(1) + ' s';
      if (now >= endAt) finish();
    } else if (state !== 'countdown') {
      drawMenu();
    }

    drawFx();
    drawCrosshair();
    requestAnimationFrame(frame);
  }

  startBtn.hidden = true;     // on demarre en cliquant la cible au centre
  say('Clique la cible au centre pour démarrer.');
  timerEl.textContent = DURATION + ' s';
  loadTop();
  requestAnimationFrame(frame);
})();
