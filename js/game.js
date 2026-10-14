/* =====================================================================
   Attrape-cadeaux — mini-jeu de Noël (canvas, sans aucune image externe)
   Déplace le traîneau du Père Noël (doigt, souris ou flèches) pour attraper
   les cadeaux. Évite le charbon. Trois vies : un cadeau raté ou un morceau
   de charbon attrapé = une vie en moins. La vitesse augmente avec le score.

   Score maximum théorique : environ 2,3 points par seconde (la base de données
   refuse les scores impossibles, voir submit_score dans schema.sql).
   ===================================================================== */

const W = 360;
const H = 560;
const GROUND = 40;          // hauteur de la neige au sol
const SIZE = 30;            // taille d'un cadeau à l'écran
const SLEIGH_W = 78;
const SLEIGH_H = 48;
const FONT = '"Macondo", "Segoe Script", "Comic Sans MS", cursive';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---------- Sprites en pixel art ---------- */

function makeSprite(rows, palette, scale) {
  const w = Math.max(...rows.map((r) => r.length));
  const c = document.createElement("canvas");
  c.width = w * scale;
  c.height = rows.length * scale;
  const g = c.getContext("2d");
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      const col = palette[ch];
      if (!col) return;
      g.fillStyle = col;
      g.fillRect(x * scale, y * scale, scale, scale);
    });
  });
  return c;
}

const GIFT = [
  "...RRRR...",
  "..R.RR.R..",
  "DDDDRRDDDD",
  "BBBBRRBBBB",
  "BBBBRRBBBB",
  "RRRRRRRRRR",
  "BBBBRRBBBB",
  "BBBBRRBBBB",
  "BBBBRRBBBB",
  "DDDDDDDDDD",
];

const COAL = [
  "...EEEE...",
  "..EKKKKE..",
  ".EKLKKKKE.",
  ".EKKKKLKE.",
  "EKKMKKKKKE",
  "EKLKKKKMKE",
  "EKKKKLKKKE",
  ".EKKKKKKE.",
  "..EKKKKE..",
  "...EEEE...",
];

const HEART = [
  ".rr.rr.",
  "rrrrrrr",
  "rrrrrrr",
  ".rrrrr.",
  "..rrr..",
  "...r...",
];

const SLEIGH = [
  "...w......................",
  "..rrr.....................",
  ".rrrrr..............rr....",
  ".wwwww.............rrr....",
  ".wseswwww..........rr.....",
  ".wsssw..w.........rr......",
  ".wwwww..rrrrrrrrrrrrrrrr..",
  "rrrwrrrrrrrrrrrrrrrrrrrrr.",
  "rwrrrrrrrrrrrrrrrrrrrrrwr.",
  "rrrrrrrrrrrrrrrrrrrrrrrrr.",
  ".dddddddddddddddddddddd...",
  "..yyyyyyyyyyyyyyyyyyyy....",
  "...k..k........k...k......",
  ".kkkkkkkkkkkkkkkkkkkkkkkk.",
  "kk......................kk",
  "k........................k",
];

const GIFT_COLORS = [
  { B: "#d62f2f", D: "#9c1f1f", R: "#f6d64a" },
  { B: "#2f9e57", D: "#1f6e3c", R: "#f4f4f4" },
  { B: "#3b7be0", D: "#2756a3", R: "#f6d64a" },
  { B: "#8a4fc9", D: "#5f3592", R: "#f4f4f4" },
];
const GOLD_COLORS = { B: "#f2c230", D: "#b88a10", R: "#fff6c4" };
const COAL_COLORS = { K: "#34343c", L: "#7b7b8c", E: "#a9a9bd", M: "#ff5a3c" };
const SLEIGH_COLORS = { r: "#c7252b", d: "#8f1a20", w: "#f4f4f4", y: "#f2c230", k: "#2b1a10", s: "#f1c9a0", e: "#222222" };

function makeSprites() {
  return {
    gifts: GIFT_COLORS.map((p) => makeSprite(GIFT, p, 3)),
    gold: makeSprite(GIFT, GOLD_COLORS, 3),
    coal: makeSprite(COAL, COAL_COLORS, 3),
    heart: makeSprite(HEART, { r: "#ff4d5e" }, 3),
    sleigh: makeSprite(SLEIGH, SLEIGH_COLORS, 3),
  };
}

/* ---------- Décor statique (dessiné une seule fois) ---------- */

function lerpColor(a, b, t) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * t)).join(",")})`;
}

function makeBackground() {
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");

  // ciel en bandes
  const bands = 18;
  for (let i = 0; i < bands; i++) {
    g.fillStyle = lerpColor("#10101a", "#2f2f48", i / (bands - 1));
    g.fillRect(0, Math.floor((i * H) / bands), W, Math.ceil(H / bands) + 1);
  }

  // étoiles fixes (pseudo-aléatoires reproductibles)
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 70; i++) {
    g.fillStyle = rnd() > 0.8 ? "#ffffff" : "#b9bbd6";
    const s = rnd() > 0.85 ? 3 : 2;
    g.fillRect(Math.floor(rnd() * W), Math.floor(rnd() * (H * 0.62)), s, s);
  }

  // lune
  const cx = 292, cy = 78, r = 24;
  g.fillStyle = "#f3efc9";
  for (let dy = -r; dy < r; dy += 3) {
    const dx = Math.floor(Math.sqrt(r * r - dy * dy));
    g.fillRect(cx - dx, cy + dy, dx * 2, 3);
  }
  g.fillStyle = "#d6d2a8";
  g.fillRect(cx - 9, cy - 6, 6, 6);
  g.fillRect(cx + 5, cy + 6, 6, 6);
  g.fillRect(cx - 3, cy + 12, 3, 3);

  // collines
  const base = H - GROUND;
  const hill = (color, amp, f1, f2, off) => {
    g.fillStyle = color;
    for (let x = 0; x < W; x += 6) {
      const h = Math.round((amp + 22 * Math.sin(x / f1 + off) + 12 * Math.sin(x / f2 + off * 2)) / 4) * 4;
      g.fillRect(x, base - h, 6, h + 2);
    }
  };
  hill("#262640", 70, 52, 21, 0.5);
  hill("#1d1d33", 44, 41, 17, 2.1);

  // sapins
  const pine = (x, h, color) => {
    g.fillStyle = color;
    let w = 6;
    for (let y = base - h; y < base - 6; y += 8) {
      g.fillRect(x - w / 2, y, w, 8);
      w += 6;
    }
    g.fillStyle = "#3b2a1c";
    g.fillRect(x - 3, base - 8, 6, 8);
  };
  [[24, 88], [64, 60], [310, 96], [336, 64], [276, 56]].forEach(([x, h]) => pine(x, h, "#173a2b"));

  // neige au sol
  g.fillStyle = "#e9eefc";
  g.fillRect(0, base, W, GROUND);
  g.fillStyle = "#c7d0ea";
  g.fillRect(0, base + 14, W, GROUND - 14);
  g.fillStyle = "#ffffff";
  for (let x = 0; x < W; x += 24) g.fillRect(x, base - 3, 12, 3);

  return c;
}

/* ---------- Le jeu ---------- */

export function createGame(canvas, { onGameOver } = {}) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;

  const bg = makeBackground();
  const spr = makeSprites();

  const SLEIGH_Y = H - GROUND - SLEIGH_H + 8;     // haut du traîneau
  const CATCH_Y = SLEIGH_Y + 14;                  // ligne où l'on attrape
  const MISS_Y = H - GROUND + 4;                  // un cadeau qui touche la neige est raté

  let state = "ready";                            // ready | playing | paused | over
  let score = 0, lives = 3, t = 0, spawnTimer = 0.7, spawnCount = 0;
  let items = [], popups = [];
  let shake = 0, flash = 0, overAt = 0, clock = 0;
  const sleigh = { x: W / 2, target: W / 2 };
  const keys = new Set();
  let raf = 0, last = 0, alive = true;

  const flakes = Array.from({ length: 46 }, () => ({
    x: Math.random() * W, y: Math.random() * H, v: 18 + Math.random() * 34, s: Math.random() > 0.75 ? 3 : 2, p: Math.random() * 6,
  }));
  const twinkles = Array.from({ length: 14 }, () => ({ x: Math.random() * W, y: Math.random() * H * 0.6, p: Math.random() * 6 }));

  /* --- logique --- */

  function reset() {
    score = 0; lives = 3; t = 0; spawnTimer = 0.7; spawnCount = 0;
    items = []; popups = []; shake = 0; flash = 0;
    sleigh.x = W / 2; sleigh.target = W / 2;
  }

  function start() {
    reset();
    state = "playing";
  }

  function spawn() {
    spawnCount++;
    const coal = spawnCount > 2 && Math.random() < 0.2;
    const gold = !coal && spawnCount % 8 === 0;
    const speed = (150 + Math.min(score * 5, 230)) * (0.92 + Math.random() * 0.16);
    items.push({
      x: 14 + Math.random() * (W - 28 - SIZE),
      y: -SIZE,
      v: speed,
      type: coal ? "coal" : gold ? "gold" : "gift",
      sprite: coal ? spr.coal : gold ? spr.gold : spr.gifts[Math.floor(Math.random() * spr.gifts.length)],
    });
    const base = Math.max(0.55, 1.0 - score * 0.012);
    spawnTimer = base * (1 + Math.random() * 0.25);     // jamais plus rapide que 0,55 s
  }

  function loseLife() {
    lives--;
    flash = 0.3;
    shake = 0.3;
    if (lives <= 0) {
      state = "over";
      overAt = performance.now();
      if (onGameOver) onGameOver({ score, durationMs: Math.round(t * 1000) });
    }
  }

  function update(dt) {
    clock += dt;
    for (const f of flakes) {
      f.y += f.v * dt;
      f.x += Math.sin(clock + f.p) * 10 * dt;
      if (f.y > H - GROUND) { f.y = -4; f.x = Math.random() * W; }
    }
    shake = Math.max(0, shake - dt);
    flash = Math.max(0, flash - dt);
    popups = popups.filter((p) => (p.age += dt) < 0.8);
    if (state !== "playing") return;

    t += dt;

    // déplacement du traîneau : clavier prioritaire, sinon vers la position du doigt/souris
    const dir = (keys.has("arrowright") || keys.has("d") ? 1 : 0) - (keys.has("arrowleft") || keys.has("a") || keys.has("q") ? 1 : 0);
    if (dir) {
      sleigh.x += dir * 520 * dt;
      sleigh.target = sleigh.x;
    } else {
      const d = sleigh.target - sleigh.x;
      const step = 950 * dt;
      sleigh.x += Math.abs(d) <= step ? d : Math.sign(d) * step;
    }
    sleigh.x = clamp(sleigh.x, SLEIGH_W / 2, W - SLEIGH_W / 2);

    spawnTimer -= dt;
    if (spawnTimer <= 0) spawn();

    const left = sleigh.x - SLEIGH_W / 2 + 6;
    const right = sleigh.x + SLEIGH_W / 2 - 6;
    for (const it of items) {
      it.y += it.v * dt;
      if (it.dead) continue;
      const bottom = it.y + SIZE;
      if (bottom >= CATCH_Y && it.y < CATCH_Y + 24 && it.x + SIZE > left && it.x < right) {
        it.dead = true;
        if (it.type === "coal") {
          popups.push({ x: it.x + SIZE / 2, y: CATCH_Y - 10, text: "Aïe !", color: "#ff7a7a", age: 0 });
          loseLife();
        } else {
          const pts = it.type === "gold" ? 3 : 1;
          score += pts;
          popups.push({ x: it.x + SIZE / 2, y: CATCH_Y - 10, text: `+${pts}`, color: it.type === "gold" ? "#ffd34a" : "#ffffff", age: 0 });
        }
      } else if (bottom >= MISS_Y) {
        it.dead = true;
        if (it.type !== "coal") {
          popups.push({ x: it.x + SIZE / 2, y: MISS_Y - 14, text: "Raté !", color: "#ff7a7a", age: 0 });
          loseLife();
        }
      }
      if (state !== "playing") break;
    }
    items = items.filter((it) => !it.dead);
  }

  /* --- dessin --- */

  function text(str, x, y, size, { align = "center", color = "#fff", stroke = "#0a0a14", width = 4 } = {}) {
    ctx.font = `${size}px ${FONT}`;
    ctx.textAlign = align;
    ctx.textBaseline = "alphabetic";
    ctx.lineJoin = "round";
    ctx.lineWidth = width;
    ctx.strokeStyle = stroke;
    ctx.strokeText(str, x, y);
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  }

  function panel(x, y, w, h) {
    ctx.fillStyle = "rgba(10, 10, 22, 0.72)";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
  }

  function draw() {
    ctx.save();
    if (shake > 0) ctx.translate((Math.random() - 0.5) * shake * 18, (Math.random() - 0.5) * shake * 18);
    ctx.drawImage(bg, 0, 0);

    for (const s of twinkles) {
      const a = 0.35 + 0.65 * Math.abs(Math.sin(clock * 1.6 + s.p));
      ctx.fillStyle = `rgba(255,255,255,${a.toFixed(2)})`;
      ctx.fillRect(Math.floor(s.x), Math.floor(s.y), 3, 3);
    }

    ctx.fillStyle = "#ffffff";
    for (const f of flakes) ctx.fillRect(Math.floor(f.x), Math.floor(f.y), f.s, f.s);

    for (const it of items) ctx.drawImage(it.sprite, Math.round(it.x), Math.round(it.y));

    ctx.drawImage(spr.sleigh, Math.round(sleigh.x - SLEIGH_W / 2), SLEIGH_Y);

    for (const p of popups) {
      ctx.globalAlpha = 1 - p.age / 0.8;
      text(p.text, p.x, p.y - p.age * 40, 22, { color: p.color });
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    if (flash > 0) {
      ctx.fillStyle = `rgba(220, 30, 30, ${(flash / 0.3) * 0.35})`;
      ctx.fillRect(0, 0, W, H);
    }

    // HUD
    if (state === "playing" || state === "paused" || state === "over") {
      text(`Score ${score}`, 12, 36, 26, { align: "left" });
      for (let i = 0; i < 3; i++) {
        ctx.globalAlpha = i < lives ? 1 : 0.25;
        ctx.drawImage(spr.heart, W - 12 - (3 - i) * 25, 14);
      }
      ctx.globalAlpha = 1;
    }

    if (state === "ready") drawReady();
    else if (state === "paused") drawPaused();
    else if (state === "over") drawOver();
  }

  function drawReady() {
    panel(24, 120, W - 48, 310);
    text("Attrape-cadeaux", W / 2, 172, 34, { color: "#ffd34a" });
    text("Déplace le traîneau du Père Noël", W / 2, 208, 17);
    text("(glisse ton doigt, la souris ou ← →)", W / 2, 230, 15, { color: "#c9c9d6", width: 3 });

    const row = (sprite, label, y) => {
      ctx.drawImage(sprite, 70, y - 24);
      text(label, 116, y, 19, { align: "left" });
    };
    row(spr.gifts[0], "cadeau : +1 point", 282);
    row(spr.gold, "cadeau doré : +3 points", 322);
    row(spr.coal, "charbon : -1 vie", 362);

    text("Ne laisse tomber aucun cadeau !", W / 2, 400, 16, { color: "#c9c9d6", width: 3 });
    const pulse = 0.65 + 0.35 * Math.sin(clock * 4);
    ctx.globalAlpha = pulse;
    text("Touche pour jouer", W / 2, 470, 26, { color: "#7dffb0" });
    ctx.globalAlpha = 1;
  }

  function drawPaused() {
    ctx.fillStyle = "rgba(10, 10, 22, 0.6)";
    ctx.fillRect(0, 0, W, H);
    text("Pause", W / 2, 250, 38, { color: "#ffd34a" });
    text("Touche pour reprendre", W / 2, 296, 22);
  }

  function drawOver() {
    ctx.fillStyle = "rgba(10, 10, 22, 0.62)";
    ctx.fillRect(0, 0, W, H);
    panel(34, 170, W - 68, 220);
    text("Partie terminée", W / 2, 226, 32, { color: "#ffd34a" });
    text("Score", W / 2, 272, 20, { color: "#c9c9d6", width: 3 });
    text(String(score), W / 2, 330, 56);
    const ready = performance.now() - overAt > 600;
    ctx.globalAlpha = ready ? 0.65 + 0.35 * Math.sin(clock * 4) : 0.3;
    text("Touche pour rejouer", W / 2, 372, 20, { color: "#7dffb0" });
    ctx.globalAlpha = 1;
  }

  /* --- boucle --- */

  function frame(ts) {
    if (!alive) return;
    const dt = Math.min(0.05, last ? (ts - last) / 1000 : 1 / 60);
    last = ts;
    update(dt);
    draw();
    raf = requestAnimationFrame(frame);
  }

  /* --- contrôles --- */

  function tap() {
    if (state === "ready") start();
    else if (state === "paused") state = "playing";
    else if (state === "over" && performance.now() - overAt > 600) start();
  }

  const toX = (ev) => {
    const r = canvas.getBoundingClientRect();
    return clamp(((ev.clientX - r.left) / (r.width || W)) * W, SLEIGH_W / 2, W - SLEIGH_W / 2);
  };
  const onPointerDown = (ev) => {
    ev.preventDefault();
    sleigh.target = toX(ev);
    try { canvas.setPointerCapture(ev.pointerId); } catch { /* sans importance */ }
    tap();
  };
  const onPointerMove = (ev) => {
    if (ev.pointerType === "mouse" || ev.buttons) sleigh.target = toX(ev);
  };
  const onKeyDown = (ev) => {
    // ne pas voler les touches au menu déroulant du classement ni aux champs de saisie
    if (ev.target && ev.target !== canvas && /^(select|input|textarea|button)$/i.test(ev.target.tagName)) return;
    const k = ev.key.toLowerCase();
    if (["arrowleft", "arrowright", " "].includes(k)) ev.preventDefault();
    if (k === " " || k === "enter") { tap(); return; }
    keys.add(k);
  };
  const onKeyUp = (ev) => keys.delete(ev.key.toLowerCase());
  const onVisibility = () => { if (document.hidden && state === "playing") state = "paused"; };
  const onBlur = () => keys.clear();

  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  document.addEventListener("visibilitychange", onVisibility);

  raf = requestAnimationFrame(frame);

  return {
    start,
    pause() { if (state === "playing") state = "paused"; },
    getState: () => state,
    snapshot: () => ({ state, score, lives, t, items: items.map((i) => ({ x: i.x, y: i.y, type: i.type })), sleighX: sleigh.x }),
    destroy() {
      alive = false;
      cancelAnimationFrame(raf);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
    },
  };
}
