/* Aim Trainer : 3 cibles a l'ecran, touche-les le plus vite possible pendant 30 s.
   Fichier externe (CSP script-src 'self'). Le score est verifie par api_score.php
   (duree mesuree cote serveur + plafond). */
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

  var DURATION = 30;          // secondes
  var NB_TARGETS = 3;         // cibles visibles en meme temps
  var RADIUS = 26;            // rayon d'une cible (pixels du canvas)
  var HIT_PTS = 10, MISS_PTS = 3;
  var COOLDOWN = 1500;        // pause apres la partie avant de pouvoir relancer

  var state = 'idle';         // idle | starting | running | cooldown
  var targets = [], fx = [];
  var hits = 0, misses = 0, endAt = 0, lastHitAt = 0, reactSum = 0;
  var result = null;
  var startTarget = { x: W / 2, y: H / 2, r: 46 };

  function say(t) { statusEl.textContent = t; }

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

  function score() { return Math.max(0, hits * HIT_PTS - misses * MISS_PTS); }
  function accuracy() { var t = hits + misses; return t ? Math.round(hits * 100 / t) : 100; }

  /* ---------- cibles ---------- */
  function newTarget() {
    var m = RADIUS + 12, t, ok, tries = 0;
    do {
      t = { x: m + Math.random() * (W - 2 * m), y: m + 40 + Math.random() * (H - 2 * m - 40), born: performance.now() };
      ok = targets.every(function (o) { return Math.hypot(o.x - t.x, o.y - t.y) > RADIUS * 3; });
    } while (!ok && ++tries < 40);
    return t;
  }

  function begin() {
    state = 'starting';
    result = null;
    say('...');
    api({ action: 'start', game: 'aim' }).then(function () {
      hits = 0; misses = 0; reactSum = 0;
      targets = [];
      for (var i = 0; i < NB_TARGETS; i++) targets.push(newTarget());
      lastHitAt = performance.now();
      endAt = performance.now() + DURATION * 1000;
      state = 'running';
      say('Touche les cibles ! Chaque clic dans le vide coute ' + MISS_PTS + ' points.');
    }).catch(function (e) { state = 'idle'; say(e.message); });
  }

  function finish() {
    state = 'cooldown';
    targets = [];
    var s = score();
    result = { score: s, hits: hits, misses: misses, acc: accuracy(),
               react: hits ? Math.round(reactSum / hits) : 0 };
    timerEl.textContent = 'Terminé';
    say(hits + ' cibles, ' + result.acc + ' % de précision (enregistrement...)');
    var saved = api({ action: 'submit', game: 'aim', score: s })
      .then(function () { say('Score enregistré : ' + s + ' 🎯'); loadTop(); })
      .catch(function (e) { say('Score refusé : ' + e.message); });
    var waited = new Promise(function (r) { setTimeout(r, COOLDOWN); });
    Promise.all([saved, waited]).then(function () { state = 'idle'; });
  }

  /* ---------- clics ---------- */
  function toCanvas(e) {
    var r = cv.getBoundingClientRect();
    return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height };
  }

  cv.addEventListener('pointerdown', function (e) {
    if (!e.isTrusted) return;             // ignore les clics simules par script
    e.preventDefault();
    var p = toCanvas(e);
    if (state === 'idle') {
      if (Math.hypot(p.x - startTarget.x, p.y - startTarget.y) <= startTarget.r) begin();
      return;
    }
    if (state !== 'running') return;
    for (var i = 0; i < targets.length; i++) {
      var t = targets[i];
      if (Math.hypot(p.x - t.x, p.y - t.y) <= RADIUS) {
        var now = performance.now();
        hits++;
        reactSum += now - Math.max(t.born, lastHitAt);
        lastHitAt = now;
        fx.push({ x: t.x, y: t.y, r: RADIUS, life: 1, hit: true });
        targets[i] = newTarget();
        return;
      }
    }
    misses++;
    fx.push({ x: p.x, y: p.y, r: 8, life: 1, hit: false });
  });
  cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  /* ---------- dessin ---------- */
  function drawTarget(x, y, r, label) {
    var rings = ['#ff5a1f', '#f4efe6', '#ff5a1f', '#f4efe6'];
    for (var i = 0; i < rings.length; i++) {
      ctx.beginPath();
      ctx.arc(x, y, r * (1 - i * 0.24), 0, Math.PI * 2);
      ctx.fillStyle = rings[i];
      ctx.fill();
    }
    ctx.beginPath(); ctx.arc(x, y, r * 0.12, 0, Math.PI * 2); ctx.fillStyle = '#ff5a1f'; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0,0,0,.55)';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    if (label) {
      ctx.fillStyle = '#f4efe6';
      ctx.font = '600 18px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(label, x, y + r + 28);
    }
  }

  function render(now) {
    ctx.fillStyle = '#121318';
    ctx.fillRect(0, 0, W, H);
    // grille legere facon stand de tir
    ctx.strokeStyle = 'rgba(255,255,255,.04)';
    ctx.lineWidth = 1;
    for (var gx = 0; gx <= W; gx += 60) { ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke(); }
    for (var gy = 0; gy <= H; gy += 60) { ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke(); }

    if (state === 'running') {
      var left = Math.max(0, endAt - now);
      timerEl.textContent = (left / 1000).toFixed(1) + ' s';
      targets.forEach(function (t) {
        var grow = Math.min(1, (now - t.born) / 90);   // petite apparition
        drawTarget(t.x, t.y, RADIUS * (0.6 + 0.4 * grow));
      });
      // HUD
      ctx.textAlign = 'left';
      ctx.fillStyle = '#f4efe6';
      ctx.font = '700 22px system-ui, sans-serif';
      ctx.fillText(score() + ' pts', 16, 32);
      ctx.font = '500 15px system-ui, sans-serif';
      ctx.fillStyle = '#a7a5ae';
      ctx.fillText(hits + ' touchées · ' + misses + ' ratés · ' + accuracy() + ' %', 140, 31);
      ctx.textAlign = 'right';
      ctx.fillStyle = left < 5000 ? '#ff5a1f' : '#f4efe6';
      ctx.font = '700 22px system-ui, sans-serif';
      ctx.fillText((left / 1000).toFixed(1) + ' s', W - 16, 32);
      if (left <= 0) finish();
    } else {
      if (result) {
        ctx.textAlign = 'center';
        ctx.fillStyle = '#f4efe6';
        ctx.font = '700 40px system-ui, sans-serif';
        ctx.fillText(result.score + ' pts', W / 2, 110);
        ctx.font = '500 17px system-ui, sans-serif';
        ctx.fillStyle = '#a7a5ae';
        ctx.fillText(result.hits + ' cibles · ' + result.misses + ' ratés · ' + result.acc + ' % de précision · ' +
                     result.react + ' ms par cible', W / 2, 144);
      }
      var label = state === 'idle' ? (result ? 'Clique pour rejouer' : 'Clique pour démarrer') : '';
      ctx.globalAlpha = state === 'idle' ? 1 : 0.35;
      drawTarget(startTarget.x, startTarget.y, startTarget.r, label);
      ctx.globalAlpha = 1;
    }

    // effets d'impact
    for (var i = fx.length - 1; i >= 0; i--) {
      var f = fx[i];
      f.life -= 0.06;
      if (f.life <= 0) { fx.splice(i, 1); continue; }
      ctx.globalAlpha = f.life;
      ctx.strokeStyle = f.hit ? '#ffd27a' : '#e5484d';
      ctx.lineWidth = 3;
      ctx.beginPath();
      if (f.hit) ctx.arc(f.x, f.y, f.r + (1 - f.life) * 22, 0, Math.PI * 2);
      else { ctx.moveTo(f.x - 7, f.y - 7); ctx.lineTo(f.x + 7, f.y + 7); ctx.moveTo(f.x + 7, f.y - 7); ctx.lineTo(f.x - 7, f.y + 7); }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    requestAnimationFrame(render);
  }

  startBtn.hidden = true;     // on demarre en cliquant la cible au centre
  say('Clique la cible au centre pour démarrer. 30 secondes, 3 cibles à la fois.');
  timerEl.textContent = DURATION + ' s';
  loadTop();
  requestAnimationFrame(render);
})();
