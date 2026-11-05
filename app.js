(function () {
  'use strict';

  // Compteurs de caractères
  document.querySelectorAll('textarea[data-counter]').forEach(function (ta) {
    var out = document.getElementById(ta.dataset.counter);
    var update = function () { out.textContent = ta.value.length; };
    ta.addEventListener('input', update);
    update();
  });

  // Confirmation avant suppression
  document.querySelectorAll('form[data-confirm]').forEach(function (f) {
    f.addEventListener('submit', function (e) {
      if (!window.confirm(f.dataset.confirm)) e.preventDefault();
    });
  });

  var root = document.getElementById('game');
  if (!root) return;

  var game = root.dataset.game;
  var csrf = document.querySelector('meta[name="csrf"]').content;
  var statusEl = document.getElementById('status');
  var timerEl = document.getElementById('timer');
  var startBtn = document.getElementById('startBtn');

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
    fetch('api_score.php?action=top&game=' + encodeURIComponent(game), { credentials: 'same-origin' })
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
      });
  }

  function saveScore(score) {
    return api({ action: 'submit', game: game, score: score })
      .then(function () { say('Score enregistré : ' + score + ' 🎉'); loadTop(); })
      .catch(function (e) { say('Score refusé : ' + e.message); });
  }

  /* ================= SNAKE ================= */
  function snake() {
    var cv = document.getElementById('canvas');
    var ctx = cv.getContext('2d');
    var N = 20, S = cv.width / N;
    var body, dir, next, food, score = 0, timer = null;

    function place() {
      do {
        food = { x: Math.floor(Math.random() * N), y: Math.floor(Math.random() * N) };
      } while (body.some(function (b) { return b.x === food.x && b.y === food.y; }));
    }
    function draw() {
      ctx.fillStyle = '#0b1020';
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.fillStyle = '#ff4d6d';
      ctx.fillRect(food.x * S + 2, food.y * S + 2, S - 4, S - 4);
      body.forEach(function (b, i) {
        ctx.fillStyle = i === 0 ? '#22c55e' : '#4ade80';
        ctx.fillRect(b.x * S + 1, b.y * S + 1, S - 2, S - 2);
      });
      timerEl.textContent = 'Score : ' + score;
    }
    function over() {
      clearInterval(timer);
      timer = null;
      startBtn.disabled = false;
      say('Perdu ! Score : ' + score + ' (enregistrement...)');
      saveScore(score);
    }
    function tick() {
      dir = next;
      var h = { x: body[0].x + dir.x, y: body[0].y + dir.y };
      if (h.x < 0 || h.y < 0 || h.x >= N || h.y >= N ||
          body.some(function (b) { return b.x === h.x && b.y === h.y; })) {
        return over();
      }
      body.unshift(h);
      if (h.x === food.x && h.y === food.y) { score++; place(); } else { body.pop(); }
      draw();
    }
    function turn(x, y) {
      if (timer === null) return;
      if (x === -dir.x && y === -dir.y) return;
      next = { x: x, y: y };
    }

    var keys = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
                 w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0] };
    document.addEventListener('keydown', function (e) {
      if (timer !== null && Object.prototype.hasOwnProperty.call(keys, e.key)) {
        e.preventDefault();
        turn(keys[e.key][0], keys[e.key][1]);
      }
    });
    var dirs = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
    document.querySelectorAll('[data-dir]').forEach(function (b) {
      b.addEventListener('click', function () {
        var d = dirs[b.dataset.dir];
        turn(d[0], d[1]);
      });
    });

    ctx.fillStyle = '#0b1020';
    ctx.fillRect(0, 0, cv.width, cv.height);

    startBtn.addEventListener('click', function () {
      startBtn.disabled = true;
      api({ action: 'start', game: 'snake' }).then(function () {
        body = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
        dir = next = { x: 1, y: 0 };
        score = 0;
        place();
        draw();
        say('Flèches ou WASD pour diriger le serpent.');
        timer = setInterval(tick, 110);
      }).catch(function (e) { say(e.message); startBtn.disabled = false; });
    });
  }

  /* ================= CLICK SPEED ================= */
  // Le bouton Démarrer est la zone de clic elle-même : on lance et on spamme
  // sans bouger la souris. Après la partie, la zone reste bloquée un court
  // instant pour que les derniers clics ne relancent pas une partie.
  function click() {
    var zone = document.getElementById('clickzone');
    var clicks = 0, state = 'idle', endAt = 0, iv = null;
    var COOLDOWN = 1500;

    startBtn.hidden = true;            // remplacé par la zone de clic
    zone.disabled = false;
    zone.textContent = '▶ Démarrer';
    say('Clique au milieu pour démarrer, puis spamme !');

    function begin() {
      state = 'starting';
      zone.disabled = true;
      zone.textContent = '...';
      api({ action: 'start', game: 'click' }).then(function () {
        clicks = 0;
        state = 'running';
        zone.disabled = false;
        zone.textContent = 'CLIQUE !';
        say('Go !');
        endAt = performance.now() + 10000;
        iv = setInterval(function () {
          var left = Math.max(0, endAt - performance.now());
          timerEl.textContent = (left / 1000).toFixed(1) + ' s';
          if (left <= 0) finish();
        }, 50);
      }).catch(function (e) {
        say(e.message);
        state = 'idle';
        zone.disabled = false;
        zone.textContent = '▶ Démarrer';
      });
    }

    zone.addEventListener('click', function (e) {
      if (!e.isTrusted) return;         // ignore les clics simulés par script
      if (state === 'idle') { begin(); return; }
      if (state !== 'running') return;
      clicks++;
      zone.textContent = clicks;
    });

    function finish() {
      clearInterval(iv);
      state = 'cooldown';
      zone.disabled = true;
      timerEl.textContent = 'Terminé';
      say(clicks + ' clics en 10 s (enregistrement...)');
      var saved = saveScore(clicks);
      var waited = new Promise(function (r) { setTimeout(r, COOLDOWN); });
      Promise.all([saved, waited]).then(function () {
        state = 'idle';
        zone.disabled = false;
        zone.textContent = clicks + ' clics · ▶ Rejouer';
      });
    }
  }

  /* ================= MEMORY ================= */
  function memory() {
    var EMO = ['🍎', '🚀', '🎲', '🎵', '⭐', '🔥', '🐱', '🌈'];
    var grid = document.getElementById('grid');
    var cards = [], first = null, busy = false, playing = false, moves = 0, t0 = 0, iv = null;

    for (let i = 0; i < 16; i++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'mcard';
      b.textContent = '?';
      b.disabled = true;
      b.addEventListener('click', function () { flip(i); });
      grid.appendChild(b);
      cards.push(b);
    }

    function reset() {
      cards.forEach(function (c) { c.textContent = '?'; c.className = 'mcard'; c.disabled = false; });
    }

    function finish(d) {
      clearInterval(iv);
      playing = false;
      startBtn.disabled = false;
      say('Terminé en ' + d.seconds + ' s et ' + d.moves + ' coups : score ' + d.score + ' 🎉');
      loadTop();
    }

    function flip(i) {
      if (!playing || busy) return;
      busy = true;
      api({ action: 'flip', game: 'memory', index: i }).then(function (d) {
        cards[i].textContent = EMO[d.value];
        cards[i].classList.add('open');
        cards[i].disabled = true;
        if (first === null) { first = i; busy = false; return; }
        moves++;
        var a = first;
        first = null;
        if (d.match) {
          cards[a].classList.add('matched');
          cards[i].classList.add('matched');
          if (d.done) finish(d);
          busy = false;
        } else {
          setTimeout(function () {
            [a, i].forEach(function (k) {
              cards[k].textContent = '?';
              cards[k].classList.remove('open');
              cards[k].disabled = false;
            });
            busy = false;
          }, 800);
        }
      }).catch(function (e) { say(e.message); busy = false; });
    }

    startBtn.addEventListener('click', function () {
      startBtn.disabled = true;
      api({ action: 'start', game: 'memory' }).then(function () {
        reset();
        first = null; busy = false; moves = 0; playing = true;
        t0 = performance.now();
        say('Trouve les 8 paires !');
        iv = setInterval(function () {
          timerEl.textContent = Math.round((performance.now() - t0) / 1000) + ' s';
        }, 250);
      }).catch(function (e) { say(e.message); startBtn.disabled = false; });
    });
  }

  loadTop();
  if (game === 'snake') snake();
  else if (game === 'click') click();
  else if (game === 'memory') memory();
})();
