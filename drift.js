/* drift.js : jeu de drift + poursuite policiere (vue du dessus).
   Le score est envoye a api_score.php, qui le plafonne selon la duree mesuree par le serveur. */
(function () {
  'use strict';
  var root = document.getElementById('game');
  if (!root || root.dataset.game !== 'drift') return;

  var cv = document.getElementById('canvas');
  var ctx = cv.getContext('2d');
  var csrfMeta = document.querySelector('meta[name="csrf"]');
  var csrf = csrfMeta ? csrfMeta.content : '';
  var statusEl = document.getElementById('status');
  var timerEl = document.getElementById('timer');
  var startBtn = document.getElementById('startBtn');
  var CW = cv.width, CH = cv.height;
  var ZOOM = 1.35, VW = CW / ZOOM, VH = CH / ZOOM;
  var FONT = 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';

  function say(t) { if (statusEl) statusEl.textContent = t; }

  /* ---------------- API (meme protocole que les autres jeux) ---------------- */
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
  function refreshTop() {
    fetch('api_score.php?game=drift', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        var ol = document.getElementById('top');
        if (!ol) return;
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

  /* ---------------- Generation de la carte ---------------- */
  var T = 32, N = 160, WORLD = T * N;
  var G = 0, ROAD = 1, DIRT = 2, FIELD = 3, SAND = 4, WATER = 5, BUILD = 6, TREE = 7, HOUSE = 8, ROCK = 9, PARK = 10;
  var SOLID = {}; SOLID[WATER] = SOLID[BUILD] = SOLID[TREE] = SOLID[HOUSE] = SOLID[ROCK] = true;
  // vitesse max (px/s) et adherence par surface
  var SURF = {};
  SURF[ROAD] = { max: 255, grip: 1 };
  SURF[DIRT] = { max: 210, grip: 0.85 };
  SURF[G] = { max: 175, grip: 0.75 };
  SURF[PARK] = { max: 175, grip: 0.75 };
  SURF[FIELD] = { max: 160, grip: 0.7 };
  SURF[SAND] = { max: 145, grip: 0.62 };

  function rng(seed) {
    return function () {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function hash(x, y) {
    var h = Math.imul(x, 374761393) + Math.imul(y, 668265263) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function smooth(x, y, s) {
    var gx = x / s, gy = y / s, x0 = Math.floor(gx), y0 = Math.floor(gy);
    var fx = gx - x0, fy = gy - y0;
    fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
    var a = hash(x0, y0), b = hash(x0 + 1, y0), c = hash(x0, y0 + 1), d = hash(x0 + 1, y0 + 1);
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  }
  function noise(x, y) { return smooth(x, y, 22) * 0.65 + smooth(x + 500, y + 500, 9) * 0.35; }

  var map = new Uint8Array(N * N), biome = new Uint8Array(N * N);
  var mark = new Uint8Array(N * N), junction = new Uint8Array(N * N);
  var MK_HE = 1, MK_VE = 2, MK_HM = 4, MK_VM = 8; // ligne au bord bas / bord droit / milieu horizontal / milieu vertical
  var B_CITY = 0, B_SUB = 1, B_FARM = 2, B_FOREST = 3, B_LAKE = 4, B_DESERT = 5;
  var BIOME_NAMES = ['Centre-ville', 'Banlieue', 'Campagne', 'For\u00eat', 'Lac', 'D\u00e9sert'];

  function idx(x, y) { return y * N + x; }
  function tileAt(tx, ty) { return (tx < 0 || ty < 0 || tx >= N || ty >= N) ? TREE : map[idx(tx, ty)]; }
  function isRoadish(t) { return t === ROAD || t === DIRT; }

  (function build() {
    var c = N / 2, x, y, i;
    for (y = 0; y < N; y++) for (x = 0; x < N; x++) {
      var d = Math.max(Math.abs(x - c), Math.abs(y - c));
      var n = noise(x, y), b;
      if (d < 20) b = B_CITY;
      else if (d < 32) b = B_SUB;
      else if (n < 0.33) b = B_LAKE;
      else if (n < 0.5) b = B_FARM;
      else if (n < 0.68) b = B_FOREST;
      else b = B_DESERT;
      biome[idx(x, y)] = b;
      var t = G;
      if (b === B_CITY) t = BUILD;
      else if (b === B_LAKE) t = (n < 0.29) ? WATER : SAND;
      else if (b === B_FARM) t = (hash(x * 3, y) < 0.004) ? HOUSE : FIELD;
      else if (b === B_FOREST) t = (smooth(x + 900, y + 300, 4) > 0.64 && hash(x, y * 7) < 0.55) ? TREE : G;
      else if (b === B_DESERT) t = (hash(x * 5, y * 2) < 0.008) ? ROCK : SAND;
      map[idx(x, y)] = t;
    }
    function road(x0, y0, x1, y1, type, w, skipCity) {
      var horiz = (y0 === y1);
      var dx = Math.sign(x1 - x0), dy = Math.sign(y1 - y0);
      var len = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      for (var k = 0; k <= len; k++) {
        for (var o = 0; o < w; o++) {
          var px = x0 + dx * k + (dy ? o : 0), py = y0 + dy * k + (dx ? o : 0);
          if (px < 1 || py < 1 || px >= N - 1 || py >= N - 1) continue;
          var j = idx(px, py), cur = map[j], bb = biome[j];
          if (type === DIRT && (cur === ROAD || cur === WATER || bb === B_CITY || bb === B_SUB)) continue;
          if (skipCity && bb === B_CITY) continue;
          if (cur === ROAD && type === ROAD) { junction[j] = 1; mark[j] = 0; continue; }
          map[j] = type;
          if (type !== ROAD || junction[j]) continue;
          if (w % 2 === 0 && o === w / 2 - 1) mark[j] = horiz ? MK_HE : MK_VE;
          if (w % 2 === 1 && o === (w - 1) / 2) mark[j] = horiz ? MK_HM : MK_VM;
        }
      }
    }
    // centre-ville : rues tous les 8 tuiles, quelques places/parcs
    for (i = c - 20; i <= c + 20; i += 8) { road(i, c - 20, i, c + 22, ROAD, 3); road(c - 20, i, c + 22, i, ROAD, 3); }
    for (y = c - 19; y < c + 20; y += 8) for (x = c - 19; x < c + 20; x += 8) {
      if (hash(x, y) < 0.25) for (var py = y + 2; py < y + 7; py++) for (var px = x + 2; px < x + 7; px++) if (map[idx(px, py)] === BUILD) map[idx(px, py)] = PARK;
    }
    // banlieue : rues tous les 12
    for (i = c - 32; i <= c + 32; i += 12) { road(i, c - 32, i, c + 34, ROAD, 3, true); road(c - 32, i, c + 34, i, ROAD, 3, true); }
    // autoroutes en croix + peripherique (ponts au-dessus de l'eau)
    road(2, c - 1, N - 3, c - 1, ROAD, 4); road(c - 1, 2, c - 1, N - 3, ROAD, 4);
    var R = 52;
    road(c - R, c - R, c + R + 2, c - R, ROAD, 3); road(c - R, c + R, c + R + 2, c + R, ROAD, 3);
    road(c - R, c - R, c - R, c + R + 2, ROAD, 3); road(c + R, c - R, c + R, c + R + 2, ROAD, 3);
    // chemins de terre a la campagne
    for (i = 8; i < N - 8; i += 18) { road(i, 4, i, N - 5, DIRT, 2); road(4, i, N - 5, i, DIRT, 2); }
    // banlieue : maisons uniquement le long des rues, jardins au milieu
    for (y = 1; y < N - 1; y++) for (x = 1; x < N - 1; x++) {
      if (biome[idx(x, y)] !== B_SUB || map[idx(x, y)] !== G) continue;
      var nearRoad = map[idx(x + 1, y)] === ROAD || map[idx(x - 1, y)] === ROAD || map[idx(x, y + 1)] === ROAD || map[idx(x, y - 1)] === ROAD;
      if (!nearRoad && hash(x + 7, y + 3) < 0.6) continue;
      var front = 0;
      for (var oy = -2; oy <= 2; oy++) for (var ox = -2; ox <= 2; ox++) if (map[idx(Math.max(0, Math.min(N - 1, x + ox)), Math.max(0, Math.min(N - 1, y + oy)))] === ROAD) front = 1;
      if (front && !nearRoad && hash(x, y) < 0.42) map[idx(x, y)] = HOUSE;
    }
    // rien de solide colle aux routes : on garde les bas-cotes degages
    for (y = 1; y < N - 1; y++) for (x = 1; x < N - 1; x++) {
      var tt = map[idx(x, y)];
      if (tt !== TREE && tt !== ROCK) continue;
      for (var k2 = 0; k2 < 4; k2++) {
        var nx = x + [1, -1, 0, 0][k2], ny = y + [0, 0, 1, -1][k2];
        if (isRoadish(map[idx(nx, ny)])) { map[idx(x, y)] = (tt === ROCK) ? SAND : G; break; }
      }
    }
    // bordure infranchissable
    for (i = 0; i < N; i++) { map[idx(i, 0)] = map[idx(0, i)] = map[idx(i, N - 1)] = map[idx(N - 1, i)] = TREE; }
  })();

  // couleurs de base (mini-carte)
  var COL = {};
  COL[G] = '#3e6b34'; COL[ROAD] = '#34343b'; COL[DIRT] = '#8a6740'; COL[FIELD] = '#a49a3c'; COL[SAND] = '#d4bd85';
  COL[WATER] = '#2a6a9e'; COL[BUILD] = '#b86f4c'; COL[TREE] = '#1f4a1e'; COL[HOUSE] = '#a35a42'; COL[ROCK] = '#8c8274'; COL[PARK] = '#4d8a40';

  var mini = document.createElement('canvas');
  mini.width = mini.height = N;
  (function () {
    var mc = mini.getContext('2d'), img = mc.createImageData(N, N);
    for (var i = 0; i < N * N; i++) {
      var v = parseInt(COL[map[i]].slice(1), 16);
      img.data[i * 4] = v >> 16; img.data[i * 4 + 1] = (v >> 8) & 255; img.data[i * 4 + 2] = v & 255; img.data[i * 4 + 3] = 255;
    }
    mc.putImageData(img, 0, 0);
  })();

  /* ---------------- Rendu du decor par blocs pre-calcules ---------------- */
  var CH_T = 16, CHPX = CH_T * T, chunks = {}, chunkOrder = [];

  function shade(hex, f) {
    var v = parseInt(hex.slice(1), 16), r = v >> 16, g = (v >> 8) & 255, b = v & 255;
    r = Math.max(0, Math.min(255, Math.round(r * f))); g = Math.max(0, Math.min(255, Math.round(g * f))); b = Math.max(0, Math.min(255, Math.round(b * f)));
    return 'rgb(' + r + ',' + g + ',' + b + ')';
  }

  function paintGround(c, tt, x, y, tx, ty) {
    var h = hash(tx, ty), v = 0.92 + smooth(tx + 40, ty + 40, 5) * 0.16;
    switch (tt) {
      case ROAD: c.fillStyle = shade('#3c3d47', 0.97 + h * 0.06); break;
      case DIRT: c.fillStyle = shade('#8a6740', v); break;
      case FIELD: c.fillStyle = shade((Math.floor(tx / 6) + Math.floor(ty / 5)) % 2 ? '#c2b143' : '#9fb43f', v); break;
      case SAND: case ROCK: c.fillStyle = shade('#e6cc8a', v); break;
      case WATER: c.fillStyle = shade('#2f86c4', 0.9 + smooth(tx, ty, 6) * 0.2); break;
      case BUILD: c.fillStyle = '#6c6d75'; break;
      case PARK: c.fillStyle = shade('#5fa04a', v); break;
      default: c.fillStyle = shade('#4f8f3e', v);
    }
    c.fillRect(x, y, T, T);
  }

  function paintDetail(c, tt, x, y, tx, ty) {
    var h = hash(tx, ty), h2 = hash(ty + 11, tx + 5), k;
    switch (tt) {
      case G: case PARK:
        c.fillStyle = 'rgba(255,255,255,.06)';
        for (k = 0; k < 3; k++) c.fillRect(x + hash(tx + k, ty) * 28, y + hash(tx, ty + k) * 28, 2, 3);
        if (h < 0.05) { c.fillStyle = h2 < 0.5 ? '#f2e06a' : '#e7e7f2'; c.fillRect(x + h2 * 26 + 2, y + h * 300 % 26 + 2, 3, 3); }
        break;
      case FIELD:
        c.fillStyle = 'rgba(0,0,0,.13)';
        if ((Math.floor(tx / 6) + Math.floor(ty / 5)) % 2) { for (k = 3; k < T; k += 6) c.fillRect(x, y + k, T, 2); }
        else { for (k = 3; k < T; k += 6) c.fillRect(x + k, y, 2, T); }
        break;
      case SAND:
        c.fillStyle = 'rgba(140,105,50,.18)';
        c.beginPath(); c.ellipse(x + 16, y + 10 + h * 12, 12, 2, 0, 0, 7); c.fill();
        break;
      case DIRT:
        c.fillStyle = 'rgba(60,40,20,.25)';
        if (tileAt(tx + 1, ty) === DIRT && tileAt(tx - 1, ty) === DIRT) c.fillRect(x, y + 14, T, 4);
        else if (tileAt(tx, ty + 1) === DIRT && tileAt(tx, ty - 1) === DIRT) c.fillRect(x + 14, y, 4, T);
        break;
      case WATER:
        c.strokeStyle = 'rgba(190,225,255,.18)'; c.lineWidth = 1.5;
        c.beginPath(); c.moveTo(x + 4 + h * 8, y + 10 + h2 * 12); c.quadraticCurveTo(x + 12 + h * 8, y + 6 + h2 * 12, x + 20 + h * 8, y + 10 + h2 * 12); c.stroke();
        // ecume sur les berges
        c.fillStyle = 'rgba(10,40,70,.6)';
        if (tileAt(tx, ty - 1) !== WATER) c.fillRect(x, y, T, 5);
        if (tileAt(tx, ty + 1) !== WATER) c.fillRect(x, y + T - 5, T, 5);
        if (tileAt(tx - 1, ty) !== WATER) c.fillRect(x, y, 5, T);
        if (tileAt(tx + 1, ty) !== WATER) c.fillRect(x + T - 5, y, 5, T);
        c.fillStyle = 'rgba(235,245,255,.45)';
        if (tileAt(tx, ty - 1) !== WATER) c.fillRect(x, y, T, 3);
        if (tileAt(tx, ty + 1) !== WATER) c.fillRect(x, y + T - 3, T, 3);
        if (tileAt(tx - 1, ty) !== WATER) c.fillRect(x, y, 3, T);
        if (tileAt(tx + 1, ty) !== WATER) c.fillRect(x + T - 3, y, 3, T);
        break;
      case ROAD:
        var m = mark[idx(tx, ty)];
        c.fillStyle = 'rgba(245,235,190,.75)';
        if (m === MK_HE && tx % 2 === 0) c.fillRect(x + 4, y + T - 1, 16, 2);
        if (m === MK_VE && ty % 2 === 0) c.fillRect(x + T - 1, y + 4, 2, 16);
        if (m === MK_HM && tx % 2 === 0) c.fillRect(x + 4, y + T / 2 - 1, 16, 2);
        if (m === MK_VM && ty % 2 === 0) c.fillRect(x + T / 2 - 1, y + 4, 2, 16);
        // trottoirs / bas-cotes
        var bi = biome[idx(tx, ty)], curb = (bi === B_CITY || bi === B_SUB) ? '#8d8e95' : 'rgba(255,255,255,.55)', cw = (bi === B_CITY || bi === B_SUB) ? 4 : 1;
        c.fillStyle = curb;
        if (!isRoadish(tileAt(tx, ty - 1))) c.fillRect(x, y, T, cw);
        if (!isRoadish(tileAt(tx, ty + 1))) c.fillRect(x, y + T - cw, T, cw);
        if (!isRoadish(tileAt(tx - 1, ty))) c.fillRect(x, y, cw, T);
        if (!isRoadish(tileAt(tx + 1, ty))) c.fillRect(x + T - cw, y, cw, T);
        if (h < 0.06) { c.fillStyle = 'rgba(0,0,0,.18)'; c.beginPath(); c.ellipse(x + 8 + h2 * 16, y + 10 + h * 100, 5, 3, 0, 0, 7); c.fill(); }
        break;
    }
  }

  function paintObject(c, tt, x, y, tx, ty) {
    var h = hash(tx, ty), h2 = hash(ty + 3, tx + 9);
    switch (tt) {
      case BUILD:
        // le dessin couvre exactement la zone de collision : ce qu'on voit = ce qui bloque
        var bx = Math.floor((tx + 4) / 8), by = Math.floor((ty + 4) / 8), bh = hash(bx * 7 + 3, by * 5 + 1);
        var roofs = ['#b86f4c', '#6f8fa6', '#c2a878', '#7f9c6a', '#a07894', '#c47f5a'];
        var roof = roofs[Math.floor(bh * roofs.length)];
        var top = tileAt(tx, ty - 1) !== BUILD, left = tileAt(tx - 1, ty) !== BUILD, bot = tileAt(tx, ty + 1) !== BUILD, right = tileAt(tx + 1, ty) !== BUILD;
        c.fillStyle = 'rgba(0,0,0,.45)';
        if (bot) c.fillRect(x + 6, y + T, T, 9);
        if (right) c.fillRect(x + T, y + 6, 9, T);
        c.fillStyle = roof; c.fillRect(x, y, T, T);
        // facade sombre en bas/droite, rebord clair en haut/gauche : effet de volume
        c.fillStyle = 'rgba(0,0,0,.38)';
        if (bot) c.fillRect(x, y + T - 6, T, 6);
        if (right) c.fillRect(x + T - 6, y, 6, T);
        c.fillStyle = 'rgba(255,255,255,.28)';
        if (top) c.fillRect(x, y, T, 3);
        if (left) c.fillRect(x, y, 3, T);
        // contour noir net sur tout le bord du batiment
        c.fillStyle = '#121216';
        if (top) c.fillRect(x, y, T, 2);
        if (bot) c.fillRect(x, y + T - 2, T, 2);
        if (left) c.fillRect(x, y, 2, T);
        if (right) c.fillRect(x + T - 2, y, 2, T);
        if (h < 0.16) { c.fillStyle = '#d9dce2'; c.fillRect(x + 9, y + 9, 10, 8); c.fillStyle = '#8f939c'; c.fillRect(x + 11, y + 11, 6, 3); }
        else if (h < 0.24) { c.fillStyle = 'rgba(160,220,255,.45)'; c.fillRect(x + 7, y + 7, 16, 16); }
        break;
      case HOUSE:
        var col = ['#c0583c', '#a8452f', '#8f6f52', '#c2803f'][Math.floor(h * 4)];
        c.fillStyle = 'rgba(0,0,0,.4)'; c.fillRect(x + 8, y + 8, 26, 26);
        c.fillStyle = col; c.fillRect(x + 3, y + 3, T - 6, T - 6);
        c.fillStyle = 'rgba(255,255,255,.22)'; c.fillRect(x + 3, y + 3, T - 6, 12);
        c.fillStyle = 'rgba(0,0,0,.25)'; c.fillRect(x + 3, y + 15, T - 6, 2);
        c.strokeStyle = '#121216'; c.lineWidth = 2; c.strokeRect(x + 4, y + 4, T - 8, T - 8);
        if (h2 < 0.5) { c.fillStyle = '#5b5b60'; c.fillRect(x + 20, y + 6, 4, 4); }
        break;
      case TREE:
        var rad = 11 + h * 4, cx = x + 16 + (h2 - 0.5) * 6, cy = y + 16 + (h - 0.5) * 6;
        c.fillStyle = 'rgba(0,0,0,.28)'; c.beginPath(); c.arc(cx + 4, cy + 5, rad, 0, 7); c.fill();
        c.fillStyle = h < 0.5 ? '#1f4a1e' : '#265a24'; c.beginPath(); c.arc(cx, cy, rad, 0, 7); c.fill();
        c.strokeStyle = 'rgba(8,20,8,.9)'; c.lineWidth = 2; c.stroke();
        c.fillStyle = h < 0.5 ? '#2d6b2a' : '#347a2f'; c.beginPath(); c.arc(cx - 2, cy - 2, rad * 0.7, 0, 7); c.fill();
        c.fillStyle = 'rgba(255,255,255,.12)'; c.beginPath(); c.arc(cx - 4, cy - 5, rad * 0.32, 0, 7); c.fill();
        break;
      case ROCK:
        c.fillStyle = 'rgba(0,0,0,.25)'; c.beginPath(); c.ellipse(x + 19, y + 20, 12, 8, 0, 0, 7); c.fill();
        c.fillStyle = '#8c8274'; c.beginPath(); c.ellipse(x + 16, y + 16, 12, 9, 0.3, 0, 7); c.fill();
        c.strokeStyle = '#3a342c'; c.lineWidth = 2; c.stroke();
        c.fillStyle = '#a69c8e'; c.beginPath(); c.ellipse(x + 13, y + 13, 6, 4, 0.3, 0, 7); c.fill();
        break;
      case PARK:
        if (h < 0.1) {
          c.fillStyle = 'rgba(0,0,0,.25)'; c.beginPath(); c.arc(x + 19, y + 19, 9, 0, 7); c.fill();
          c.fillStyle = '#2d6b2a'; c.beginPath(); c.arc(x + 16, y + 16, 9, 0, 7); c.fill();
        } else if (h < 0.16) { c.fillStyle = '#b9a98a'; c.fillRect(x, y + 13, T, 6); }
        break;
    }
  }

  function getChunk(cx, cy) {
    var key = cx + ',' + cy;
    if (chunks[key]) return chunks[key];
    var cnv = document.createElement('canvas');
    cnv.width = cnv.height = CHPX;
    var c = cnv.getContext('2d');
    var tx0 = cx * CH_T, ty0 = cy * CH_T, tx, ty, x, y, tt;
    // une tuile de marge pour que les ombres et objets debordent proprement
    for (var pass = 0; pass < 3; pass++) {
      for (ty = ty0 - 1; ty <= ty0 + CH_T; ty++) for (tx = tx0 - 1; tx <= tx0 + CH_T; tx++) {
        if (tx < 0 || ty < 0 || tx >= N || ty >= N) continue;
        tt = map[idx(tx, ty)]; x = (tx - tx0) * T; y = (ty - ty0) * T;
        if (pass === 0) paintGround(c, tt, x, y, tx, ty);
        else if (pass === 1) paintDetail(c, tt, x, y, tx, ty);
        else paintObject(c, tt, x, y, tx, ty);
      }
    }
    chunks[key] = cnv; chunkOrder.push(key);
    if (chunkOrder.length > 48) delete chunks[chunkOrder.shift()];
    return cnv;
  }

  var vignette = (function () {
    var v = document.createElement('canvas'); v.width = CW; v.height = CH;
    var c = v.getContext('2d'), g = c.createRadialGradient(CW / 2, CH / 2, CH * 0.35, CW / 2, CH / 2, CW * 0.7);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.45)');
    c.fillStyle = g; c.fillRect(0, 0, CW, CH);
    return v;
  })();

  /* ---------------- Entrees clavier / tactiles ---------------- */
  var keys = {};
  var KEYMAP = { ArrowUp: 'up', KeyW: 'up', KeyZ: 'up', ArrowDown: 'down', KeyS: 'down',
                 ArrowLeft: 'left', KeyA: 'left', KeyQ: 'left', ArrowRight: 'right', KeyD: 'right', Space: 'hb' };
  window.addEventListener('keydown', function (e) {
    var k = KEYMAP[e.code];
    if (k && state === 'play') { keys[k] = true; e.preventDefault(); }
  });
  window.addEventListener('keyup', function (e) { var k = KEYMAP[e.code]; if (k) keys[k] = false; });
  window.addEventListener('blur', function () { keys = {}; });
  Array.prototype.forEach.call(document.querySelectorAll('[data-key]'), function (b) {
    var k = b.getAttribute('data-key');
    var on = function (e) { e.preventDefault(); keys[k] = true; };
    var off = function (e) { e.preventDefault(); keys[k] = false; };
    b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off);
    b.addEventListener('pointerleave', off); b.addEventListener('pointercancel', off);
  });

  /* ---------------- Physique des voitures ---------------- */
  function makeCar(x, y, a, cop) {
    return { x: x, y: y, a: a, vx: 0, vy: 0, r: 11, cop: !!cop, hp: 100, stuck: 0, rev: 0, slip: 0, steer: 0 };
  }
  function surfAt(x, y) {
    var t = tileAt(Math.floor(x / T), Math.floor(y / T));
    return SURF[t] || SURF[G];
  }

  // collision cercle / tuiles pleines ; renvoie la vitesse d'impact
  function collideWorld(c) {
    var impact = 0;
    var tx0 = Math.floor((c.x - c.r) / T), tx1 = Math.floor((c.x + c.r) / T);
    var ty0 = Math.floor((c.y - c.r) / T), ty1 = Math.floor((c.y + c.r) / T);
    for (var ty = ty0; ty <= ty1; ty++) for (var tx = tx0; tx <= tx1; tx++) {
      var tt = tileAt(tx, ty);
      if (!SOLID[tt]) continue;
      // arbres et rochers : obstacle rond plus petit que la tuile
      var round = (tt === TREE || tt === ROCK), dx, dy, d2, rr = c.r;
      if (round) {
        dx = c.x - (tx * T + 16); dy = c.y - (ty * T + 16); rr = c.r + 11;
        d2 = dx * dx + dy * dy;
        if (d2 >= rr * rr) continue;
      } else {
        var ins = tt === HOUSE ? 3 : 0;
        var nx = Math.max(tx * T + ins, Math.min(c.x, tx * T + T - ins)), ny = Math.max(ty * T + ins, Math.min(c.y, ty * T + T - ins));
        dx = c.x - nx; dy = c.y - ny; d2 = dx * dx + dy * dy;
        if (d2 >= c.r * c.r) continue;
        if (d2 === 0) { dx = c.x - (tx * T + T / 2); dy = c.y - (ty * T + T / 2); d2 = 0; }
      }
      var d = Math.sqrt(d2) || Math.hypot(dx, dy) || 1;
      var ux = dx / d, uy = dy / d, pen = rr - Math.sqrt(d2);
      c.x += ux * pen; c.y += uy * pen;
      var vn = c.vx * ux + c.vy * uy;
      if (vn < 0) {
        impact = Math.max(impact, -vn);
        c.vx -= 1.4 * vn * ux; c.vy -= 1.4 * vn * uy;
        c.vx *= 0.75; c.vy *= 0.75;
      }
    }
    return impact;
  }

  function stepCar(c, inp, dt, maxBoost) {
    var fx = Math.cos(c.a), fy = Math.sin(c.a), rx = -fy, ry = fx;
    var vf = c.vx * fx + c.vy * fy, vr = c.vx * rx + c.vy * ry;
    var s = surfAt(c.x, c.y), max = s.max * (maxBoost || 1);
    var speed = Math.hypot(c.vx, c.vy);
    if (inp.up) vf += (280 * s.grip + 60) * dt * (c.boostA || 1);
    if (inp.down) vf -= (vf > 0 ? 560 : 180) * dt;
    if (!inp.up && !inp.down) vf *= Math.exp(-1.1 * dt);
    if (vf > max) vf += (max - vf) * Math.min(1, 3 * dt);
    if (vf < -95) vf = -95;
    // direction lissee : plus precise au clavier
    var want = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    c.steer += (want - c.steer) * Math.min(1, dt * 14);
    var turnK = Math.min(1, Math.abs(vf) / 40) * (vf >= 0 ? 1 : -1);
    var hiSpeed = 1 - 0.15 * Math.min(1, Math.abs(vf) / 255);
    c.a += c.steer * (inp.hb ? 4.2 : 3.7) * hiSpeed * turnK * dt;
    // adherence laterale : faible au frein a main = drift
    var lat = inp.hb ? 1.9 : 11 * s.grip + 2;
    vr *= Math.exp(-lat * dt);
    if (inp.hb) vf *= Math.exp(-0.6 * dt);
    c.vx = fx * vf + rx * vr; c.vy = fy * vf + ry * vr;
    c.x += c.vx * dt; c.y += c.vy * dt;
    c.slip = speed > 1 ? Math.abs(vr) / speed : 0;
    return collideWorld(c);
  }

  function collideCars(a, b) {
    var dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy), m = a.r + b.r;
    if (d >= m || d === 0) return 0;
    var ux = dx / d, uy = dy / d, pen = (m - d) / 2;
    a.x -= ux * pen; a.y -= uy * pen; b.x += ux * pen; b.y += uy * pen;
    var rel = (b.vx - a.vx) * ux + (b.vy - a.vy) * uy;
    if (rel < 0) {
      a.vx += rel * ux * 0.6; a.vy += rel * uy * 0.6;
      b.vx -= rel * ux * 0.6; b.vy -= rel * uy * 0.6;
    }
    return -rel;
  }

  /* ---------------- Etat de la partie ---------------- */
  var state = 'idle', player, cops, npcs, pickups, wrecks, skids, smoke, sparks, cam = { x: 0, y: 0 };
  var takedowns = 0, flashT = 0;
  var nitroT = 0, jamT = 0, pickT = 0, npcT = 0;
  var elapsed, score, drift, combo, driftEnd, bust, spawnT, msg, msgT, endReason, lastFrame, shake = 0, t = 0;

  function findSpawn(cx, cy, minD, maxD, rnd) {
    for (var tries = 0; tries < 80; tries++) {
      var ang = rnd() * Math.PI * 2, dist = minD + rnd() * (maxD - minD);
      var tx = Math.floor((cx + Math.cos(ang) * dist) / T), ty = Math.floor((cy + Math.sin(ang) * dist) / T);
      var tt = tileAt(tx, ty);
      if (tt === ROAD || tt === DIRT) return { x: tx * T + T / 2, y: ty * T + T / 2 };
    }
    return null;
  }

  var pHist = [], pHistT = 0;
  function reset() {
    var c = N / 2;
    player = makeCar((c + 1) * T, (c + 1) * T + T / 2, 0, false);
    cops = []; npcs = []; pickups = []; wrecks = []; skids = []; smoke = []; sparks = [];
    takedowns = 0; flashT = 0;
    nitroT = 0; jamT = 0; pickT = 1; npcT = 0;
    elapsed = 0; score = 0; drift = 0; combo = 1; driftEnd = 0; bust = 0; pHist = []; pHistT = 0; spawnT = 5; msg = ''; msgT = 0; shake = 0;
    cam.x = player.x; cam.y = player.y;
  }

  function stars() { return Math.min(5, 1 + Math.floor(elapsed / 25)); }
  function flash(m) { msg = m; msgT = 1.6; }

  function bank() {
    if (drift > 5) {
      var pts = Math.floor(drift * combo);
      score += pts;
      flash('DRIFT +' + pts + (combo > 1.05 ? '  x' + combo.toFixed(1) : ''));
    }
    drift = 0; combo = 1;
  }

  function addSparks(x, y, n) {
    for (var i = 0; i < n && sparks.length < 80; i++) {
      var a = Math.random() * 7, s = 60 + Math.random() * 160;
      sparks.push({ x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.4 + Math.random() * 0.3 });
    }
  }

  var rndSpawn = rng(Date.now() & 0xffff);

  // facon Reckless Getaway : les flics qui se crashent explosent et rapportent des points
  function explode(c) {
    for (var i = 0; i < 26 && sparks.length < 140; i++) {
      var a = Math.random() * 7, v = 80 + Math.random() * 260;
      sparks.push({ x: c.x, y: c.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.5 + Math.random() * 0.5 });
    }
    for (i = 0; i < 8 && smoke.length < 180; i++) smoke.push({ x: c.x + (Math.random() - 0.5) * 20, y: c.y + (Math.random() - 0.5) * 20, r: 10 + Math.random() * 10, life: 1.4, dark: true });
    wrecks.push({ x: c.x, y: c.y, a: c.a, t: 7 });
    if (wrecks.length > 12) wrecks.shift();
    var d = Math.hypot(c.x - player.x, c.y - player.y);
    if (d < 520) { shake = Math.max(shake, 10 - d / 60); flashT = 0.12; }
    takedowns++;
    var pts = 150 * stars();
    score += pts;
    flash('TAKEDOWN ! +' + pts);
  }

  /* ---------------- Bonus au sol ---------------- */
  var PICK = {
    nitro: { col: '#36c8ff', ch: 'N', name: 'NITRO !' },
    repair: { col: '#3ccf74', ch: '+', name: 'R\u00e9paration +35' },
    jam: { col: '#c77dff', ch: '?', name: 'Brouilleur : la police te perd !' },
    cash: { col: '#ffd25a', ch: '$', name: 'Bonus +250' }
  };
  var PICK_KEYS = ['nitro', 'nitro', 'repair', 'jam', 'cash', 'cash'];

  function updatePickups(dt) {
    pickT -= dt;
    if (pickT <= 0 && pickups.length < 9) {
      var p = findSpawn(player.x, player.y, 280, 760, Math.random);
      if (p) pickups.push({ x: p.x, y: p.y, type: PICK_KEYS[Math.floor(Math.random() * PICK_KEYS.length)], t: Math.random() * 6 });
      pickT = 2.2;
    }
    for (var i = pickups.length - 1; i >= 0; i--) {
      var k = pickups[i], d = Math.hypot(k.x - player.x, k.y - player.y);
      k.t += dt;
      if (d < 24) {
        if (k.type === 'nitro') nitroT = 4;
        else if (k.type === 'repair') player.hp = Math.min(100, player.hp + 35);
        else if (k.type === 'cash') score += 250;
        else if (k.type === 'jam') {
          jamT = 5;
          cops.forEach(function (c) { var a = Math.random() * 7; c.tx = c.x + Math.cos(a) * 500; c.ty = c.y + Math.sin(a) * 500; });
        }
        flash(PICK[k.type].name);
        addSparks(k.x, k.y, 12);
        pickups.splice(i, 1);
      } else if (d > 1300) pickups.splice(i, 1);
    }
  }

  /* ---------------- Circulation (vehicules PNJ) ---------------- */
  var NPC_COLORS = [['#3a7bd5', '#1d3f73'], ['#e9e9ec', '#8a8f99'], ['#2fae6b', '#14583a'], ['#f2c94c', '#9a7a1c'],
                    ['#9b51e0', '#4e2479'], ['#2a2c31', '#0b0b0d'], ['#c0392b', '#641c14'], ['#7fb3c9', '#3d6475']];
  var DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  function isRoadT(tx, ty) { return tileAt(tx, ty) === ROAD; }
  function canGo(tx, ty, k, n) { for (var s2 = 1; s2 <= n; s2++) if (!isRoadT(tx + DIRS[k][0] * s2, ty + DIRS[k][1] * s2)) return false; return true; }

  function spawnNpc() {
    for (var tries = 0; tries < 30; tries++) {
      var ang = Math.random() * 7, dist = 420 + Math.random() * 380;
      var tx = Math.floor((player.x + Math.cos(ang) * dist) / T), ty = Math.floor((player.y + Math.sin(ang) * dist) / T);
      if (!isRoadT(tx, ty)) continue;
      var opts = [];
      for (var k = 0; k < 4; k++) if (canGo(tx, ty, k, 5)) opts.push(k);
      if (!opts.length) continue;
      var dir = opts[Math.floor(Math.random() * opts.length)];
      var c = makeCar(tx * T + T / 2, ty * T + T / 2, Math.atan2(DIRS[dir][1], DIRS[dir][0]), false);
      c.npc = true; c.dir = dir; c.spd = 90 + Math.random() * 55; c.crash = 0; c.ltx = tx; c.lty = ty;
      c.col = NPC_COLORS[Math.floor(Math.random() * NPC_COLORS.length)];
      return c;
    }
    return null;
  }

  // detection de blocage : on mesure le deplacement reel sur des fenetres d'une seconde
  function progress(c, dt) {
    if (c.px === undefined) { c.px = c.x; c.py = c.y; c.pt = 0; c.stuckT = 0; }
    c.pt += dt;
    if (c.pt >= 1) {
      var moved = Math.hypot(c.x - c.px, c.y - c.py);
      c.px = c.x; c.py = c.y; c.pt = 0;
      c.stuckT = moved < 28 ? c.stuckT + 1 : 0;
    }
    return c.stuckT;
  }
  function onScreen(c) { return Math.abs(c.x - cam.x) < VW / 2 + 60 && Math.abs(c.y - cam.y) < VH / 2 + 60; }
  function poof(c) {
    for (var i = 0; i < 6 && smoke.length < 180; i++) smoke.push({ x: c.x + (Math.random() - 0.5) * 18, y: c.y + (Math.random() - 0.5) * 18, r: 8, life: 1 });
  }

  function updateNpc(c, dt) {
    if (c.crash > 0) {
      c.crash -= dt;
      stepCar(c, {}, dt, 1);
      if (c.crash <= 0) {
        var tx0 = Math.floor(c.x / T), ty0 = Math.floor(c.y / T);
        if (!isRoadT(tx0, ty0)) { c.crash = 0.5; c.offRoad = (c.offRoad || 0) + 0.5; return; }
        c.offRoad = 0;
        // repart dans l'axe le plus proche de son orientation
        var best = 0, bd = 9;
        for (var k0 = 0; k0 < 4; k0++) { var da = Math.abs(Math.atan2(Math.sin(c.a - Math.atan2(DIRS[k0][1], DIRS[k0][0])), Math.cos(c.a - Math.atan2(DIRS[k0][1], DIRS[k0][0])))); if (da < bd && isRoadT(tx0 + DIRS[k0][0], ty0 + DIRS[k0][1])) { bd = da; best = k0; } }
        c.dir = best; c.ltx = tx0; c.lty = ty0;
      }
      return;
    }
    var d = DIRS[c.dir], tx = Math.floor(c.x / T), ty = Math.floor(c.y / T);
    var ccx = tx * T + T / 2, ccy = ty * T + T / 2;
    var along = d[0] ? (ccx - c.x) * d[0] : (ccy - c.y) * d[1];
    if ((tx !== c.ltx || ty !== c.lty) && along <= 0) {
      c.ltx = tx; c.lty = ty;
      var straight = isRoadT(tx + d[0], ty + d[1]);
      var opts = [];
      for (var k = 0; k < 4; k++) if (k !== c.dir && k !== (c.dir + 2) % 4 && canGo(tx, ty, k, 5)) opts.push(k);
      if (!straight || (opts.length && Math.random() < 0.15)) {
        if (opts.length) c.dir = opts[Math.floor(Math.random() * opts.length)];
        else if (!straight) c.dir = (c.dir + 2) % 4;
        c.x = ccx; c.y = ccy; d = DIRS[c.dir];
      }
    }
    // freine si quelqu'un est juste devant
    var blocked = false, all = [player].concat(cops, npcs);
    for (var i = 0; i < all.length; i++) {
      var o = all[i]; if (o === c) continue;
      var dx = o.x - c.x, dy = o.y - c.y, ahead = dx * d[0] + dy * d[1], lat = Math.abs(-dx * d[1] + dy * d[0]);
      if (ahead > 0 && ahead < 52 && lat < 20) { blocked = true; break; }
    }
    // bloque face a quelqu'un depuis trop longtemps : demi-tour
    c.blockT = blocked ? (c.blockT || 0) + dt : 0;
    if (c.blockT > 1.6) {
      var nd = (c.dir + 2) % 4;
      if (isRoadT(tx + DIRS[nd][0], ty + DIRS[nd][1])) { c.dir = nd; d = DIRS[nd]; c.ltx = tx; c.lty = ty; blocked = false; }
      c.blockT = 0;
    }
    var v = c.vx * d[0] + c.vy * d[1], target = blocked ? 0 : c.spd;
    v += Math.max(-420 * dt, Math.min(130 * dt, target - v));
    if (d[0]) c.y += (ccy - c.y) * Math.min(1, dt * 6); else c.x += (ccx - c.x) * Math.min(1, dt * 6);
    c.vx = d[0] * v; c.vy = d[1] * v;
    c.x += c.vx * dt; c.y += c.vy * dt;
    var ta = Math.atan2(d[1], d[0]), da2 = Math.atan2(Math.sin(ta - c.a), Math.cos(ta - c.a));
    c.a += da2 * Math.min(1, dt * 10);
    collideWorld(c);
  }

  function updateTraffic(dt) {
    npcT -= dt;
    if (npcT <= 0 && npcs.length < 10) { var n = spawnNpc(); if (n) npcs.push(n); npcT = 0.7; }
    for (var i = npcs.length - 1; i >= 0; i--) {
      var c = npcs[i];
      updateNpc(c, dt);
      var nsT = progress(c, dt);
      if ((nsT >= 3 && !onScreen(c)) || nsT >= 6 || (c.offRoad || 0) > 6) {
        if (onScreen(c)) poof(c);
        npcs.splice(i, 1);
        continue;
      }
      var hit = collideCars(player, c);
      if (hit > 25) { c.crash = 2.5; if (hit > 120) { player.hp -= (hit - 120) * 0.04; shake = Math.min(7, hit / 35); addSparks((player.x + c.x) / 2, (player.y + c.y) / 2, 6); } }
      for (var j = 0; j < cops.length; j++) { var hn = collideCars(cops[j], c); if (hn > 25) c.crash = 2.5; if (hn > 110) cops[j].hp -= (hn - 110) * 0.3; }
      for (j = 0; j < i; j++) { if (collideCars(npcs[j], c) > 25) { c.crash = 2; npcs[j].crash = 2; } }
      if (Math.hypot(c.x - player.x, c.y - player.y) > 1150) npcs.splice(i, 1);
    }
  }

  function update(dt) {
    elapsed += dt;
    var lvl = stars();
    if (nitroT > 0) nitroT -= dt;
    if (jamT > 0) jamT -= dt;
    player.boostA = nitroT > 0 ? 1.7 : 1;
    var impact = stepCar(player, keys, dt, nitroT > 0 ? 1.35 : 1);
    if (nitroT > 0 && keys.up && Math.random() < 0.8) {
      var fxn = Math.cos(player.a), fyn = Math.sin(player.a);
      sparks.push({ x: player.x - fxn * 18, y: player.y - fyn * 18, vx: -fxn * 120 + (Math.random() - 0.5) * 40, vy: -fyn * 120 + (Math.random() - 0.5) * 40, life: 0.25, blue: true });
    }
    var sp = Math.hypot(player.vx, player.vy);
    if (impact > 100) {
      player.hp -= (impact - 110) * 0.08; shake = Math.min(10, impact / 35); addSparks(player.x, player.y, 8);
      if (drift > 0) { drift = 0; combo = 1; flash('Drift perdu !'); }
    }
    if (sp > 100 && player.slip > 0.26) {
      drift += sp * player.slip * dt * 0.21;
      combo = Math.min(5, combo + dt * 0.35);
      driftEnd = 0;
      var bx = player.x - Math.cos(player.a) * 13, by = player.y - Math.sin(player.a) * 13;
      if (smoke.length < 160 && Math.random() < 0.6) smoke.push({ x: bx, y: by, r: 5, life: 1 });
      var px = -Math.sin(player.a) * 7, py = Math.cos(player.a) * 7;
      skids.push([bx + px, by + py, bx - px, by - py]);
      if (skids.length > 1200) skids.shift();
    } else if (drift > 0) {
      driftEnd += dt;
      if (driftEnd > 0.45) bank();
    }
    score += 10 * lvl * dt;

    pHistT += dt;
    if (pHistT >= 0.25) { pHistT = 0; pHist.push([player.x, player.y]); if (pHist.length > 7) pHist.shift(); }
    var netMove = pHist.length >= 7 ? Math.hypot(player.x - pHist[0][0], player.y - pHist[0][1]) : 999;
    var pinned = netMove < 95;  // en 1,5 s le joueur n'a quasiment pas avance (donut, sur place, coince)

    // police
    spawnT -= dt;
    var maxCops = Math.min(7, lvl + 1);
    if (spawnT <= 0 && cops.length < maxCops) {
      var p = findSpawn(player.x, player.y, 520, 780, rndSpawn);
      if (p) { cops.push(makeCar(p.x, p.y, Math.atan2(player.y - p.y, player.x - p.x), true)); flash('Renfort de police !'); }
      spawnT = Math.max(2.5, 7.5 - lvl);
    }
    var near = false;
    for (var i = cops.length - 1; i >= 0; i--) {
      var c = cops[i];
      // temps de reaction : le flic ne relit ta position que de temps en temps,
      // et parfois il anticipe trop -> une feinte peut le pieger
      var dP = Math.hypot(c.x - player.x, c.y - player.y);
      c.think = (c.think || 0) - dt;
      if (c.tx === undefined) { c.tx = player.x; c.ty = player.y; }
      if (c.think <= 0 && jamT <= 0) {
        var lead = (dP < 170 || pinned) ? 0 : (Math.random() < 0.3 ? 0.95 : 0.45);
        c.tx = player.x + player.vx * lead; c.ty = player.y + player.vy * lead;
        c.think = dP < 110 ? 0.12 + Math.random() * 0.18 : 0.3 + Math.random() * 0.45;
      }
      var tx = c.tx, ty = c.ty;
      var want = Math.atan2(ty - c.y, tx - c.x);
      var probe = function (ang, dist) { return SOLID[tileAt(Math.floor((c.x + Math.cos(ang) * dist) / T), Math.floor((c.y + Math.sin(ang) * dist) / T))]; };
      if (probe(c.a, 44)) {
        var l = probe(c.a - 0.6, 38), r = probe(c.a + 0.6, 38);
        want = c.a + (l && !r ? 1.2 : (!l && r ? -1.2 : ((i + Math.floor(elapsed)) % 2 ? 1.2 : -1.2)));
      }
      // separation : un flic evite de foncer dans un collegue devant lui
      var cSp = Math.hypot(c.vx, c.vy), fx = Math.cos(c.a), fy = Math.sin(c.a), yieldB = false;
      for (var k2 = 0; k2 < cops.length; k2++) {
        var o = cops[k2]; if (o === c) continue;
        var rx = o.x - c.x, ry = o.y - c.y, od = Math.hypot(rx, ry);
        if (od > 0 && od < 90) {
          var ahead = (rx * fx + ry * fy) / od;
          if (ahead > 0.35) {
            var side = rx * fy - ry * fx;   // >0 : collegue a gauche -> on part a droite
            want += (side > 0 ? 0.75 : -0.75) * (1 - od / 90) * 1.6;
            var closing = ((c.vx - o.vx) * rx + (c.vy - o.vy) * ry) / od;
            if (od < 60 && closing > 60) yieldB = true;
          }
        }
      }
      var diff = Math.atan2(Math.sin(want - c.a), Math.cos(want - c.a));
      var inp = { up: true, down: false, left: diff < -0.08, right: diff > 0.08, hb: Math.abs(diff) > 1.6 && cSp > 160 };
      // de pres : il ralentit pour pouvoir tourner serre au lieu de passer a cote a fond
      if (dP < 140 && Math.abs(diff) > 0.8 && cSp > 110) { inp.up = false; inp.down = cSp > 170; inp.hb = false; }
      if (yieldB) { inp.up = false; inp.down = cSp > 90; }
      if (c.rev > 0) { c.rev -= dt; inp = { up: false, down: true, left: c.revSide > 0, right: c.revSide < 0, hb: false }; }
      var cImp = stepCar(c, inp, dt, 0.84 + lvl * 0.04);
      if (c.hp === undefined) c.hp = 100;
      if (cImp > 145) { c.hp -= (cImp - 145) * 0.4; addSparks(c.x, c.y, 4); }
      if (Math.hypot(c.vx, c.vy) < 22 && c.rev <= 0) { c.stuck += dt; if (c.stuck > 1) { c.rev = 0.8 + Math.random() * 0.5; c.revSide = (c.revSide || 1) * -1; c.stuck = 0; } } else if (c.rev <= 0) c.stuck = 0;
      var csT = progress(c, dt);
      if (dP < 80) c.stuckT = 0;  // colle au joueur : ce n'est pas un blocage, c'est une tentative d'arrestation
      else if (csT >= 2 && c.rev <= 0) { c.rev = 1.1; c.revSide = (c.revSide || 1) * -1; }
      if ((csT >= 3 && !onScreen(c)) || csT >= 6) { if (onScreen(c)) poof(c); cops.splice(i, 1); continue; }
      var hit = collideCars(player, c);
      if (hit > 80) { player.hp -= (hit - 80) * 0.05; shake = Math.min(9, hit / 30); addSparks((player.x + c.x) / 2, (player.y + c.y) / 2, 10); }
      if (hit > 140) c.hp -= (hit - 140) * 0.35;
      for (var j = 0; j < i; j++) { var hc = collideCars(c, cops[j]); if (hc > 110) { c.hp -= (hc - 110) * 0.3; cops[j].hp -= (hc - 110) * 0.3; addSparks((c.x + cops[j].x) / 2, (c.y + cops[j].y) / 2, 6); } }
      if (c.hp <= 0) { explode(c); cops.splice(i, 1); continue; }
      var d = Math.hypot(c.x - player.x, c.y - player.y);
      if (d < 70) near = true;
      if (d > 1500) cops.splice(i, 1);
    }

    // jauge d'arrestation (facon NFS Most Wanted)
    var nearN = 0; for (i = 0; i < cops.length; i++) if (Math.hypot(cops[i].x - player.x, cops[i].y - player.y) < 85) nearN++;
    if (near && (sp < 55 || pinned) && jamT <= 0) bust += dt * (sp < 55 ? 1 : 0.8) * (nearN >= 2 ? 1.4 : 1);
    else bust = Math.max(0, bust - dt * 0.8);

    updateTraffic(dt);
    updatePickups(dt);

    for (i = wrecks.length - 1; i >= 0; i--) { wrecks[i].t -= dt; if (wrecks[i].t <= 0) wrecks.splice(i, 1); else if (Math.random() < 0.15 && smoke.length < 180) smoke.push({ x: wrecks[i].x, y: wrecks[i].y, r: 6, life: 1, dark: true }); }
    if (flashT > 0) flashT -= dt;
    for (i = smoke.length - 1; i >= 0; i--) { var s = smoke[i]; s.life -= dt * 1.3; s.r += dt * 26; if (s.life <= 0) smoke.splice(i, 1); }
    for (i = sparks.length - 1; i >= 0; i--) { var k = sparks[i]; k.life -= dt; k.x += k.vx * dt; k.y += k.vy * dt; if (k.life <= 0) sparks.splice(i, 1); }
    if (msgT > 0) msgT -= dt;
    shake = Math.max(0, shake - dt * 30);

    cam.x += (player.x + player.vx * 0.3 - cam.x) * Math.min(1, dt * 5);
    cam.y += (player.y + player.vy * 0.3 - cam.y) * Math.min(1, dt * 5);

    if (bust >= 2.5) end('ARR\u00caT\u00c9 !');
    else if (player.hp <= 0) end('\u00c9PAVE !');
  }

  /* ---------------- Rendu ---------------- */
  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function drawCar(c) {
    ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.a);
    // ombre
    ctx.fillStyle = 'rgba(0,0,0,.4)'; rr(-15, -7, 34, 19, 6); ctx.fill();
    // roues
    ctx.fillStyle = '#111';
    var steerA = c.steer * 0.35;
    [[-10, -10], [-10, 7], [9, -10], [9, 7]].forEach(function (w, i) {
      ctx.save(); ctx.translate(w[0] + 3, w[1] + 1.5); if (i > 1) ctx.rotate(steerA); ctx.fillRect(-4, -1.5, 8, 3); ctx.restore();
    });
    // carrosserie
    var body = c.cop ? '#eef1f5' : (c.npc ? c.col[0] : '#ff5a1f'), dark = c.cop ? '#1b2a44' : (c.npc ? c.col[1] : '#b8380c');
    var g = ctx.createLinearGradient(0, -9, 0, 9);
    g.addColorStop(0, body); g.addColorStop(1, dark);
    ctx.fillStyle = g; rr(-17, -9, 34, 18, 5); ctx.fill();
    if (c.cop) { ctx.fillStyle = '#1b2a44'; rr(-17, -9, 9, 18, 4); ctx.fill(); rr(10, -9, 7, 18, 3); ctx.fill(); }
    else if (!c.npc) { ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillRect(-17, -1.2, 34, 2.4); }
    // vitres + toit
    ctx.fillStyle = '#1a2433'; rr(1, -7, 8, 14, 2); ctx.fill();
    ctx.fillStyle = '#243246'; rr(-11, -6, 5, 12, 2); ctx.fill();
    ctx.fillStyle = c.cop ? '#f7f9fb' : (c.npc ? c.col[0] : '#ff7a45'); rr(-6, -7, 7, 14, 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fillRect(2, -6, 2, 12);
    // phares / feux
    ctx.fillStyle = '#fff7d8'; ctx.fillRect(15, -8, 2, 4); ctx.fillRect(15, 4, 2, 4);
    ctx.fillStyle = '#ff2a2a'; ctx.fillRect(-17, -8, 2, 4); ctx.fillRect(-17, 4, 2, 4);
    if (c.cop) {
      var on = Math.floor(t * 8) % 2 === 0;
      ctx.fillStyle = on ? '#ff2b2b' : '#2b6bff'; ctx.fillRect(-4, -7, 3, 6);
      ctx.fillStyle = on ? '#2b6bff' : '#ff2b2b'; ctx.fillRect(-4, 1, 3, 6);
    }
    ctx.restore();
    if (c.cop) {
      var on2 = Math.floor(t * 8) % 2;
      var gl = ctx.createRadialGradient(c.x, c.y, 2, c.x, c.y, 46);
      gl.addColorStop(0, on2 ? 'rgba(255,40,40,.28)' : 'rgba(40,100,255,.28)'); gl.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gl; ctx.fillRect(c.x - 46, c.y - 46, 92, 92);
    }
  }

  function drawWreck(w) {
    ctx.save(); ctx.translate(w.x, w.y); ctx.rotate(w.a);
    ctx.fillStyle = 'rgba(0,0,0,.45)'; rr(-15, -7, 34, 19, 6); ctx.fill();
    ctx.fillStyle = '#2a2624'; rr(-17, -9, 34, 18, 5); ctx.fill();
    ctx.fillStyle = '#3d3632'; rr(-8, -7, 14, 14, 3); ctx.fill();
    ctx.restore();
    if (w.t > 2) {
      var fl = 0.6 + Math.random() * 0.4, g = ctx.createRadialGradient(w.x, w.y, 1, w.x, w.y, 16 * fl);
      g.addColorStop(0, 'rgba(255,230,140,.95)'); g.addColorStop(0.5, 'rgba(255,120,30,.7)'); g.addColorStop(1, 'rgba(255,60,0,0)');
      ctx.fillStyle = g; ctx.fillRect(w.x - 18, w.y - 18, 36, 36);
    }
  }

  function drawPickup(k, ox, oy) {
    if (k.x < ox - 30 || k.x > ox + VW + 30 || k.y < oy - 30 || k.y > oy + VH + 30) return;
    var info = PICK[k.type], pulse = 1 + Math.sin(k.t * 4) * 0.12;
    var g = ctx.createRadialGradient(k.x, k.y, 2, k.x, k.y, 26 * pulse);
    g.addColorStop(0, info.col + 'aa'); g.addColorStop(1, info.col + '00');
    ctx.fillStyle = g; ctx.fillRect(k.x - 28, k.y - 28, 56, 56);
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.beginPath(); ctx.arc(k.x + 2, k.y + 3, 11 * pulse, 0, 7); ctx.fill();
    ctx.fillStyle = info.col; ctx.beginPath(); ctx.arc(k.x, k.y, 11 * pulse, 0, 7); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#10131a'; ctx.font = 'bold 13px ' + FONT; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(info.ch, k.x, k.y + 1);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  }

  function headlights(c) {
    var fx = Math.cos(c.a), fy = Math.sin(c.a);
    var g = ctx.createRadialGradient(c.x + fx * 40, c.y + fy * 40, 4, c.x + fx * 40, c.y + fy * 40, 46);
    g.addColorStop(0, 'rgba(255,245,210,.16)'); g.addColorStop(1, 'rgba(255,245,210,0)');
    ctx.fillStyle = g; ctx.fillRect(c.x + fx * 40 - 46, c.y + fy * 40 - 46, 92, 92);
  }

  function render() {
    var sx = shake ? (Math.random() - 0.5) * shake : 0, sy = shake ? (Math.random() - 0.5) * shake : 0;
    var ox = cam.x - VW / 2 + sx, oy = cam.y - VH / 2 + sy;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#1b3a1a'; ctx.fillRect(0, 0, CW, CH);
    ctx.setTransform(ZOOM, 0, 0, ZOOM, Math.round(-ox * ZOOM), Math.round(-oy * ZOOM));
    var cx0 = Math.max(0, Math.floor(ox / CHPX)), cy0 = Math.max(0, Math.floor(oy / CHPX));
    var cx1 = Math.min(N / CH_T - 1, Math.floor((ox + VW) / CHPX)), cy1 = Math.min(N / CH_T - 1, Math.floor((oy + VH) / CHPX));
    for (var cy = cy0; cy <= cy1; cy++) for (var cx = cx0; cx <= cx1; cx++) ctx.drawImage(getChunk(cx, cy), cx * CHPX, cy * CHPX);
    // traces de pneus
    ctx.strokeStyle = 'rgba(15,15,15,.28)'; ctx.lineWidth = 3; ctx.beginPath();
    for (var i = 0; i < skids.length; i++) {
      var s = skids[i];
      if (s[0] < ox - 20 || s[0] > ox + VW + 20 || s[1] < oy - 20 || s[1] > oy + VH + 20) continue;
      ctx.moveTo(s[0], s[1]); ctx.lineTo(s[0] + 0.1, s[1] + 0.1);
      ctx.moveTo(s[2], s[3]); ctx.lineTo(s[2] + 0.1, s[3] + 0.1);
    }
    ctx.lineCap = 'round'; ctx.stroke();
    for (i = 0; i < smoke.length; i++) { var m = smoke[i]; ctx.fillStyle = m.dark ? 'rgba(40,36,34,' + (m.life * 0.4).toFixed(3) + ')' : 'rgba(215,215,220,' + (m.life * 0.22).toFixed(3) + ')'; ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, 7); ctx.fill(); }
    for (i = 0; i < wrecks.length; i++) drawWreck(wrecks[i]);
    for (i = 0; i < pickups.length; i++) drawPickup(pickups[i], ox, oy);
    for (i = 0; i < npcs.length; i++) { var nc = npcs[i]; if (nc.x > ox - 40 && nc.x < ox + VW + 40 && nc.y > oy - 40 && nc.y < oy + VH + 40) drawCar(nc); }
    if (player) {
      headlights(player);
      for (i = 0; i < cops.length; i++) { headlights(cops[i]); drawCar(cops[i]); }
      drawCar(player);
    }
    for (i = 0; i < sparks.length; i++) { var k = sparks[i]; ctx.fillStyle = k.blue ? 'rgba(90,200,255,' + Math.min(1, k.life * 4).toFixed(2) + ')' : 'rgba(255,' + (180 + Math.floor(k.life * 100)) + ',80,' + Math.min(1, k.life * 2).toFixed(2) + ')'; ctx.fillRect(k.x - 1.5, k.y - 1.5, k.blue ? 4 : 2.5, k.blue ? 4 : 2.5); }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(vignette, 0, 0);
    if (flashT > 0) { ctx.fillStyle = 'rgba(255,190,120,' + (flashT * 2.5).toFixed(2) + ')'; ctx.fillRect(0, 0, CW, CH); }
    if (player) hud();
    if (state !== 'play') overlay();
  }

  function panel(x, y, w, h) { ctx.fillStyle = 'rgba(10,10,14,.62)'; rr(x, y, w, h, 8); ctx.fill(); }
  function bar(x, y, w, h, v, col, label) {
    panel(x, y, w, h);
    ctx.fillStyle = col; rr(x + 3, y + 3, Math.max(0, (w - 6) * Math.min(1, v)), h - 6, 4); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 11px ' + FONT; ctx.fillText(label, x + 9, y + h - 6);
  }

  function hud() {
    panel(12, 12, 210, drift > 0 ? 96 : 66);
    ctx.textAlign = 'left'; ctx.fillStyle = '#fff'; ctx.font = 'bold 24px ' + FONT;
    ctx.fillText(Math.floor(score).toLocaleString('fr-FR') + ' pts', 24, 42);
    ctx.font = '17px ' + FONT;
    var st = ''; for (var i = 0; i < 5; i++) st += i < stars() ? '\u2605' : '\u2606';
    ctx.fillStyle = '#ffb21f'; ctx.fillText(st, 24, 66);
    if (takedowns) { ctx.fillStyle = '#ff6b6b'; ctx.font = 'bold 14px ' + FONT; ctx.fillText('\ud83d\udca5 ' + takedowns, 150, 66); ctx.font = '17px ' + FONT; }
    if (drift > 0) { ctx.fillStyle = '#ff7a45'; ctx.font = 'bold 19px ' + FONT; ctx.fillText('DRIFT ' + Math.floor(drift) + '  x' + combo.toFixed(1), 24, 94); }
    // compteur
    var kmh = Math.round(Math.hypot(player.vx, player.vy) * 0.6);
    var bxr = CW - 170, byr = CH - 78;
    panel(bxr, byr, 156, 64);
    ctx.textAlign = 'right'; ctx.fillStyle = '#fff'; ctx.font = 'bold 30px ' + FONT;
    ctx.fillText(kmh, CW - 62, CH - 34);
    ctx.font = '13px ' + FONT; ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.fillText('km/h', CW - 24, CH - 34);
    var b = biome[idx(Math.max(0, Math.min(N - 1, Math.floor(player.x / T))), Math.max(0, Math.min(N - 1, Math.floor(player.y / T))))];
    ctx.fillText(BIOME_NAMES[b], CW - 24, CH - 22 + 4);
    ctx.textAlign = 'left';
    var py0 = CH - 92;
    if (nitroT > 0) { bar(12, py0, 96, 22, nitroT / 4, '#36c8ff', 'Nitro'); }
    if (jamT > 0) { bar(nitroT > 0 ? 116 : 12, py0, 96, 22, jamT / 5, '#c77dff', 'Brouilleur'); }
    bar(12, CH - 62, 200, 22, Math.max(0, player.hp) / 100, player.hp > 35 ? '#3ccf74' : '#ff5a5a', 'Carrosserie');
    bar(12, CH - 34, 200, 22, bust / 2.5, '#3b7bff', 'Arrestation');
    // mini-carte
    var M = 136, mx = CW - M - 16, my = 16, sc = M / WORLD;
    panel(mx - 5, my - 5, M + 10, M + 10);
    ctx.save(); rr(mx, my, M, M, 6); ctx.clip();
    ctx.globalAlpha = 0.92; ctx.imageSmoothingEnabled = false; ctx.drawImage(mini, mx, my, M, M); ctx.imageSmoothingEnabled = true; ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.lineWidth = 1; ctx.strokeRect(mx + (cam.x - VW / 2) * sc, my + (cam.y - VH / 2) * sc, VW * sc, VH * sc);
    for (i = 0; i < pickups.length; i++) { ctx.fillStyle = PICK[pickups[i].type].col; ctx.fillRect(mx + pickups[i].x * sc - 1.5, my + pickups[i].y * sc - 1.5, 3, 3); }
    ctx.fillStyle = '#6aa0ff'; for (i = 0; i < cops.length; i++) { ctx.beginPath(); ctx.arc(mx + cops[i].x * sc, my + cops[i].y * sc, 2.5, 0, 7); ctx.fill(); }
    ctx.fillStyle = '#ff5a1f'; ctx.beginPath(); ctx.arc(mx + player.x * sc, my + player.y * sc, 3.5, 0, 7); ctx.fill();
    ctx.restore();
    if (msgT > 0 && msg) {
      ctx.globalAlpha = Math.min(1, msgT); ctx.textAlign = 'center'; ctx.font = 'bold 26px ' + FONT;
      ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillText(msg, CW / 2 + 2, 52); ctx.fillStyle = '#ffd25a'; ctx.fillText(msg, CW / 2, 50);
      ctx.globalAlpha = 1; ctx.textAlign = 'left';
    }
  }

  function overlay() {
    ctx.fillStyle = 'rgba(8,8,11,.7)'; ctx.fillRect(0, 0, CW, CH);
    ctx.textAlign = 'center'; ctx.fillStyle = '#fff';
    if (state === 'over') {
      ctx.font = 'bold 46px ' + FONT; ctx.fillStyle = endReason.indexOf('ARR') === 0 ? '#6aa0ff' : '#ff5a5a';
      ctx.fillText(endReason, CW / 2, CH / 2 - 30);
      ctx.fillStyle = '#fff'; ctx.font = 'bold 26px ' + FONT;
      ctx.fillText(Math.floor(score).toLocaleString('fr-FR') + ' points en ' + Math.floor(elapsed) + ' s  \u2022  ' + takedowns + ' takedown' + (takedowns > 1 ? 's' : ''), CW / 2, CH / 2 + 14);
      ctx.font = '15px ' + FONT; ctx.fillStyle = 'rgba(255,255,255,.75)';
      ctx.fillText('Clique sur \u00ab Rejouer \u00bb pour relancer', CW / 2, CH / 2 + 46);
    } else {
      ctx.font = 'bold 38px ' + FONT; ctx.fillText('DRIFT & POURSUITE', CW / 2, CH / 2 - 64);
      ctx.font = '16px ' + FONT; ctx.fillStyle = 'rgba(255,255,255,.85)';
      ctx.fillText('Fl\u00e8ches / ZQSD : conduire     Espace : frein \u00e0 main (drift)', CW / 2, CH / 2 - 22);
      ctx.fillText('Drifte, s\u00e8me la police et fais-la se crasher (takedowns).', CW / 2, CH / 2 + 4);
      ctx.fillText('Si tu restes coinc\u00e9 pr\u00e8s d\u2019un flic, tu es arr\u00eat\u00e9.', CW / 2, CH / 2 + 28);
      ctx.fillText('Bonus : N nitro   + r\u00e9paration   ? brouilleur   $ points', CW / 2, CH / 2 + 56);
    }
    ctx.textAlign = 'left';
  }

  /* ---------------- Boucle et cycle de partie ---------------- */
  function frame(now) {
    requestAnimationFrame(frame);
    var dt = Math.min(0.033, (now - lastFrame) / 1000 || 0);
    lastFrame = now;
    t += dt;
    if (state === 'play' && !document.hidden) {
      update(dt / 2); if (state === 'play') update(dt / 2);
      if (timerEl) timerEl.textContent = Math.floor(score) + ' pts';
    }
    render();
  }

  function end(reason) {
    if (drift > 0) bank();
    state = 'over'; endReason = reason; keys = {};
    var final = Math.floor(score);
    say(reason + ' Score : ' + final + ' (enregistrement...)');
    api({ action: 'submit', game: 'drift', score: final })
      .then(function () { say(reason + ' Score enregistr\u00e9 : ' + final); refreshTop(); })
      .catch(function (e) { say('Score refus\u00e9 : ' + e.message); })
      .then(function () { startBtn.disabled = false; startBtn.textContent = '\u25b6 Rejouer'; });
  }

  function start() {
    startBtn.disabled = true;
    api({ action: 'start', game: 'drift' }).then(function () {
      reset();
      state = 'play';
      say('Bonne chance ! Espace pour drifter.');
      cv.focus();
    }).catch(function (e) { say(e.message); startBtn.disabled = false; });
  }

  startBtn.addEventListener('click', start);
  reset();
  lastFrame = performance.now();
  requestAnimationFrame(frame);
})();
