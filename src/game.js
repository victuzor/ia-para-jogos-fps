import { createBot, tickBot } from './ai.js';
import { CONFIG } from './config.js';
import {
  SIZE, angleDelta, angleTo, clamp, clearLine, distance,
  isWall, moveWithCollision, rayWall,
} from './world.js';

const canvas = document.querySelector('#view');
const ctx = canvas.getContext('2d', { alpha: false });
const menu = document.querySelector('#menu');
const menuTitle = document.querySelector('#menuTitle');
const menuMessage = document.querySelector('#menuMessage');
const startButton = document.querySelector('#startButton');
const healthLabel = document.querySelector('#health');
const healthFill = document.querySelector('#healthFill');
const ammoLabel = document.querySelector('#ammo');
const ammoFill = document.querySelector('#ammoFill');
const status = document.querySelector('#status');
const clock = document.querySelector('#clock');
const hitFlash = document.querySelector('#hitFlash');
const crosshair = document.querySelector('#crosshair');
const debugButton = document.querySelector('#debugButton');
const debugStatus = document.querySelector('#debugStatus');
const mobileControls = document.querySelector('#mobileControls');

const FOV = 70 * Math.PI / 180;
const PLAYER = CONFIG.player;
const BOT = CONFIG.bot;
const keys = new Set();
const events = [];
const touchDevice = matchMedia('(pointer: coarse)').matches;
let player;
let bot;
let running = false;
let ended = false;
let debug = false;
let firing = false;
let elapsed = 0;
let aiAccum = 0;
let lastFrame = performance.now();
let lastSprintSound = -Infinity;
let lastBotShot = 0;
let flashUntil = 0;
let hitMarkerUntil = 0;
let touchAimX = null;

function resetRound() {
  player = { x: 2.5, y: 2.5, angle: 0.25, hp: PLAYER.health, ammo: PLAYER.magazine, nextShotAt: 0, reloadingUntil: 0 };
  bot = createBot();
  events.length = 0;
  elapsed = 0;
  aiAccum = 0;
  lastSprintSound = -Infinity;
  lastBotShot = 0;
  flashUntil = 0;
  firing = false;
  ended = false;
  updateHud();
}

function resize() {
  const width = Math.min(window.innerWidth, 1440);
  const height = Math.min(window.innerHeight, 900);
  canvas.width = Math.max(320, Math.round(width));
  canvas.height = Math.max(240, Math.round(height));
}

function showMenu(title, message, action) {
  running = false;
  firing = false;
  menuTitle.innerHTML = title;
  menuMessage.textContent = message;
  startButton.innerHTML = `${action} <span>→</span>`;
  menu.hidden = false;
}

function finishRound(win) {
  if (ended) return;
  ended = true;
  keys.clear();
  showMenu(win ? 'Vitória na <em>arena</em>' : 'Rodada <em>perdida</em>', win ? 'Você eliminou o agente. Inicie uma nova rodada para enfrentar o bot novamente.' : 'O agente eliminou você. Tente usar paredes para interromper a visão dele.', 'NOVA RODADA');
  if (document.pointerLockElement === canvas) document.exitPointerLock();
}

function start() {
  if (ended) resetRound();
  running = true;
  menu.hidden = true;
  lastFrame = performance.now();
  if (!touchDevice && canvas.requestPointerLock) canvas.requestPointerLock().catch(() => {});
}

function addSound(type) {
  events.push({ type, x: player.x, y: player.y, time: elapsed });
  while (events.length > 25 || (events[0] && elapsed - events[0].time > BOT.soundMemorySeconds)) events.shift();
}

function reload() {
  if (!running || player.reloadingUntil > elapsed || player.ammo === PLAYER.magazine) return;
  player.reloadingUntil = elapsed + PLAYER.reloadSeconds;
  status.textContent = 'RECARREGANDO';
}

function playerShoot() {
  if (!running || player.hp <= 0 || player.reloadingUntil > elapsed || elapsed < player.nextShotAt) return;
  if (player.ammo === 0) { reload(); return; }
  player.ammo--;
  player.nextShotAt = elapsed + PLAYER.shotInterval;
  flashUntil = elapsed + 0.08;
  addSound('shot');
  const ux = Math.cos(player.angle);
  const uy = Math.sin(player.angle);
  const vx = bot.x - player.x;
  const vy = bot.y - player.y;
  const along = vx * ux + vy * uy;
  const side = Math.abs(vx * uy - vy * ux);
  if (bot.hp > 0 && along > 0 && along <= BOT.visionRange && side <= 0.28 && along < rayWall(player, player.angle).distance && clearLine(player, bot)) {
    bot.hp = Math.max(0, bot.hp - PLAYER.damage);
    hitMarkerUntil = elapsed + 0.13;
    if (bot.hp === 0) {
      tickBot(bot, player, events, elapsed, 0);
      finishRound(true);
    }
  }
  if (player.ammo === 0) status.textContent = 'PRESSIONE R PARA RECARREGAR';
}

function updatePlayer(dt) {
  if (player.reloadingUntil && elapsed >= player.reloadingUntil) {
    player.ammo = PLAYER.magazine;
    player.reloadingUntil = 0;
  }
  const forward = Number(keys.has('KeyW')) - Number(keys.has('KeyS'));
  const strafe = Number(keys.has('KeyD')) - Number(keys.has('KeyA'));
  if (!forward && !strafe) return;
  const sprinting = keys.has('ShiftLeft') || keys.has('ShiftRight');
  const speed = sprinting ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
  const normal = Math.hypot(forward, strafe);
  const dx = (Math.cos(player.angle) * forward + Math.cos(player.angle + Math.PI / 2) * strafe) * speed * dt / normal;
  const dy = (Math.sin(player.angle) * forward + Math.sin(player.angle + Math.PI / 2) * strafe) * speed * dt / normal;
  moveWithCollision(player, dx, dy);
  if (sprinting && elapsed - lastSprintSound >= 0.6) {
    addSound('sprint');
    lastSprintSound = elapsed;
  }
}

function renderWorld() {
  const w = canvas.width;
  const h = canvas.height;
  const horizon = h * 0.5;
  const sky = ctx.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, '#152632');
  sky.addColorStop(1, '#667a7a');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, horizon);
  const ground = ctx.createLinearGradient(0, horizon, 0, h);
  ground.addColorStop(0, '#48524d');
  ground.addColorStop(1, '#192527');
  ctx.fillStyle = ground;
  ctx.fillRect(0, horizon, w, h - horizon);
  ctx.fillStyle = '#e4dcb331';
  ctx.fillRect(0, horizon - 2, w, 3);

  const projection = w / (2 * Math.tan(FOV / 2));
  const columns = Math.ceil(w / 3);
  const depth = new Float32Array(columns);
  for (let i = 0; i < columns; i++) {
    const x = i * 3;
    const cameraX = (x + 1.5) / w - 0.5;
    const angle = player.angle + Math.atan(cameraX * 2 * Math.tan(FOV / 2));
    const hit = rayWall(player, angle);
    const corrected = Math.max(0.08, hit.distance * Math.cos(angle - player.angle));
    depth[i] = corrected;
    const wallHeight = Math.min(h * 4, projection / corrected);
    const top = horizon - wallHeight / 2;
    const fog = clamp(hit.distance / 26, 0, 0.65);
    const checker = (Math.floor(hit.x * 2) + Math.floor(hit.y * 2)) % 2;
    const base = hit.side === 0 ? 137 : 109;
    const shade = Math.floor(base * (1 - fog) + checker * 7);
    ctx.fillStyle = `rgb(${Math.floor(shade * .71)},${Math.floor(shade * .87)},${shade})`;
    ctx.fillRect(x, top, 4, wallHeight + 1);
    const edge = hit.side === 0 ? hit.y % 1 : hit.x % 1;
    if (edge < 0.035 || edge > 0.965) {
      ctx.fillStyle = `rgba(12,25,30,${0.35 * (1 - fog)})`;
      ctx.fillRect(x, top, 4, wallHeight);
    }
    if (wallHeight > 42) {
      ctx.fillStyle = `rgba(7,20,24,${0.18 * (1 - fog)})`;
      ctx.fillRect(x, top + wallHeight * 0.52, 4, Math.max(1, wallHeight * .012));
    }
  }

  if (bot.hp > 0) renderBot(depth, projection, horizon);
  if (debug) renderDebug();
  renderWeapon(w, h);
  if (elapsed < flashUntil) renderMuzzleFlash(w, h);
}

function renderBot(depth, projection, horizon) {
  const w = canvas.width;
  const bearing = angleDelta(angleTo(player, bot), player.angle);
  const dist = distance(player, bot);
  if (Math.abs(bearing) > FOV * 0.63 || dist < 0.1) return;
  const corrected = dist * Math.cos(bearing);
  const screenX = w / 2 + Math.tan(bearing) * projection;
  const figureH = projection * 0.83 / corrected;
  const visibleColumn = clamp(Math.floor(screenX / 3), 0, depth.length - 1);
  if (depth[visibleColumn] < corrected - 0.25 || !clearLine(player, bot)) return;
  const top = horizon - figureH * .49;
  ctx.save();
  ctx.translate(screenX, top);
  ctx.scale(figureH, figureH);
  ctx.fillStyle = '#111b20';
  ctx.fillRect(-.15, .49, .1, .27);
  ctx.fillRect(.05, .49, .1, .27);
  ctx.fillStyle = '#344d4a';
  ctx.fillRect(-.18, .22, .36, .36);
  ctx.fillStyle = '#263d40';
  ctx.fillRect(-.24, .24, .08, .28);
  ctx.fillRect(.16, .24, .08, .28);
  ctx.fillStyle = '#9aada2';
  ctx.fillRect(-.11, .04, .22, .18);
  ctx.fillStyle = '#d4e9af';
  ctx.fillRect(-.105, .11, .21, .045);
  ctx.fillStyle = '#182a2b';
  ctx.fillRect(-.15, .03, .30, .08);
  ctx.fillStyle = '#0e181b';
  ctx.fillRect(-.26, .39, .52, .05);
  ctx.restore();

  const barWidth = clamp(figureH * .42, 34, 110);
  const barHeight = clamp(figureH * .045, 6, 10);
  const barX = screenX - barWidth / 2;
  const barY = top - barHeight - 12;
  ctx.fillStyle = '#10191ee8';
  ctx.fillRect(barX - 2, barY - 2, barWidth + 4, barHeight + 4);
  ctx.fillStyle = '#46575a';
  ctx.fillRect(barX, barY, barWidth, barHeight);
  ctx.fillStyle = bot.hp <= BOT.lowHealth ? '#ef5546' : '#d9f561';
  ctx.fillRect(barX, barY, barWidth * bot.hp / BOT.health, barHeight);
}

function renderWeapon(w, h) {
  const scale = Math.max(.42, Math.min(w / 1150, h / 650, 1.25));
  ctx.save();
  ctx.translate(w * .49, h * .62);
  ctx.scale(scale, scale);
  if (elapsed < flashUntil) ctx.translate(0, 9);

  // Braço e mão aparecem atrás da pistola.
  ctx.fillStyle = '#142126';
  ctx.beginPath();
  ctx.moveTo(207, 164);
  ctx.lineTo(294, 190);
  ctx.lineTo(331, 340);
  ctx.lineTo(201, 340);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#8d705e';
  ctx.beginPath();
  ctx.moveTo(159, 111);
  ctx.lineTo(220, 125);
  ctx.lineTo(260, 190);
  ctx.lineTo(213, 211);
  ctx.lineTo(170, 158);
  ctx.closePath();
  ctx.fill();

  // Guarda-mato e empunhadura da pistola.
  ctx.strokeStyle = '#0b1418';
  ctx.lineWidth = 13;
  ctx.beginPath();
  ctx.moveTo(129, 103);
  ctx.quadraticCurveTo(134, 158, 184, 145);
  ctx.lineTo(213, 107);
  ctx.stroke();
  ctx.fillStyle = '#18252c';
  ctx.beginPath();
  ctx.moveTo(169, 78);
  ctx.lineTo(225, 81);
  ctx.lineTo(276, 244);
  ctx.lineTo(224, 270);
  ctx.lineTo(143, 112);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#3b4a4f';
  ctx.lineWidth = 2;
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.moveTo(187 + i * 8, 143 + i * 17);
    ctx.lineTo(225 + i * 8, 130 + i * 17);
    ctx.stroke();
  }

  // Cano e ferrolho apontam para o centro da tela.
  ctx.fillStyle = '#0b151b';
  ctx.beginPath();
  ctx.moveTo(-9, 16);
  ctx.lineTo(15, -5);
  ctx.lineTo(179, 30);
  ctx.lineTo(237, 72);
  ctx.lineTo(224, 109);
  ctx.lineTo(147, 109);
  ctx.lineTo(7, 49);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#435158';
  ctx.beginPath();
  ctx.moveTo(7, 2);
  ctx.lineTo(23, -12);
  ctx.lineTo(181, 27);
  ctx.lineTo(222, 59);
  ctx.lineTo(210, 79);
  ctx.lineTo(145, 77);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#69787a';
  ctx.beginPath();
  ctx.moveTo(23, -12);
  ctx.lineTo(181, 27);
  ctx.lineTo(169, 33);
  ctx.lineTo(13, -2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#18262c';
  ctx.fillRect(113, 32, 60, 15);
  ctx.fillStyle = '#94a5a3';
  ctx.fillRect(120, 34, 43, 4);
  ctx.fillStyle = '#0a1418';
  ctx.fillRect(12, -14, 10, 9);
  ctx.fillRect(182, 16, 19, 15);
  ctx.fillStyle = '#647575';
  ctx.fillRect(-8, 17, 14, 23);
  ctx.fillStyle = '#071014';
  ctx.fillRect(-8, 23, 8, 10);
  ctx.fillStyle = '#a6846e';
  ctx.beginPath();
  ctx.moveTo(177, 130);
  ctx.quadraticCurveTo(197, 125, 214, 139);
  ctx.lineTo(245, 172);
  ctx.quadraticCurveTo(250, 181, 241, 187);
  ctx.lineTo(221, 177);
  ctx.lineTo(203, 161);
  ctx.lineTo(184, 157);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#705747';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(209, 150);
  ctx.lineTo(237, 177);
  ctx.stroke();
  ctx.restore();
}

function renderMuzzleFlash(w, h) {
  const scale = Math.max(.42, Math.min(w / 1150, h / 650, 1.25));
  ctx.save();
  ctx.translate(w * .49, h * .62);
  ctx.scale(scale, scale);
  ctx.fillStyle = '#fce8a875';
  ctx.beginPath();
  ctx.moveTo(-8, 27);
  ctx.lineTo(-53, -23);
  ctx.lineTo(-31, 23);
  ctx.lineTo(-66, 9);
  ctx.lineTo(-25, 44);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function renderDebug() {
  const scale = Math.min(11, Math.floor(canvas.height * .38 / SIZE));
  const left = 18;
  const top = 68;
  ctx.fillStyle = '#061219d9';
  ctx.fillRect(left - 8, top - 30, SIZE * scale + 16, SIZE * scale + 62);
  ctx.fillStyle = '#d9f561';
  ctx.font = 'bold 12px monospace';
  ctx.fillText(`BOT: ${bot.state}`, left, top - 10);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      ctx.fillStyle = isWall(x, y) ? '#7d9290' : '#273c3c';
      ctx.fillRect(left + x * scale, top + y * scale, scale - 1, scale - 1);
    }
  }
  ctx.fillStyle = '#e4f37c';
  for (const point of bot.path.slice(bot.pathIndex)) ctx.fillRect(left + point.x * scale - 1, top + point.y * scale - 1, 3, 3);
  if (bot.lastSeen) {
    ctx.strokeStyle = '#f9a94c';
    ctx.beginPath();
    ctx.arc(left + bot.lastSeen.x * scale, top + bot.lastSeen.y * scale, 4, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.fillStyle = '#ee644f';
  ctx.beginPath();
  ctx.arc(left + bot.x * scale, top + bot.y * scale, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ee644f';
  ctx.beginPath();
  ctx.moveTo(left + bot.x * scale, top + bot.y * scale);
  ctx.lineTo(left + (bot.x + Math.cos(bot.angle) * 2) * scale, top + (bot.y + Math.sin(bot.angle) * 2) * scale);
  ctx.stroke();
  ctx.fillStyle = '#b7f567';
  ctx.beginPath();
  ctx.arc(left + player.x * scale, top + player.y * scale, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#bed1d0';
  ctx.font = '11px monospace';
  ctx.fillText(`VISÃO: ${bot.visible ? 'SIM' : 'NÃO'}  ROTA: ${bot.path.length - bot.pathIndex}`, left, top + SIZE * scale + 16);
  const latest = bot.logs.at(-1);
  if (latest) ctx.fillText(`${latest.from} > ${latest.to}: ${latest.reason}`.slice(0, 34), left, top + SIZE * scale + 30);
}

function updateHud() {
  healthLabel.textContent = player.hp;
  healthFill.style.width = `${player.hp}%`;
  ammoLabel.textContent = player.ammo;
  ammoFill.style.width = `${player.ammo / PLAYER.magazine * 100}%`;
  const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
  const seconds = Math.floor(elapsed % 60).toString().padStart(2, '0');
  clock.textContent = `${minutes}:${seconds}`;
  if (player.hp <= 25) healthFill.style.background = '#ef5546';
  else healthFill.style.background = '#d9f561';
  if (running && player.reloadingUntil <= elapsed) {
    status.textContent = debug ? `BOT: ${bot.state.toUpperCase()}` : bot.visible && distance(bot, player) < 12 ? 'INIMIGO À VISTA' : 'ELIMINE O AGENTE';
  }
  hitFlash.style.opacity = player.hp < 100 && elapsed - lastBotShot < .18 ? '.8' : '0';
  crosshair.classList.toggle('hit', elapsed < hitMarkerUntil);
}

function frame(timestamp) {
  const dt = Math.min((timestamp - lastFrame) / 1000, 0.05);
  lastFrame = timestamp;
  if (running) {
    elapsed += dt;
    updatePlayer(dt);
    if (firing) playerShoot();
    aiAccum += dt;
    while (aiAccum >= BOT.decisionInterval) {
      const previousHp = player.hp;
      const previousShotCount = bot.shots.length;
      tickBot(bot, player, events, elapsed, BOT.decisionInterval);
      if (player.hp < previousHp) lastBotShot = elapsed;
      if (bot.shots.length > previousShotCount) lastBotShot = elapsed;
      aiAccum -= BOT.decisionInterval;
      if (player.hp <= 0) { finishRound(false); break; }
    }
    updateHud();
  }
  renderWorld();
  requestAnimationFrame(frame);
}

startButton.addEventListener('click', start);
debugButton.addEventListener('click', () => {
  debug = !debug;
  debugStatus.textContent = debug ? 'ON' : 'OFF';
});
window.addEventListener('resize', resize);
window.addEventListener('keydown', event => {
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ShiftLeft', 'ShiftRight'].includes(event.code)) event.preventDefault();
  keys.add(event.code);
  if (event.repeat) return;
  if (event.code === 'KeyR') reload();
  if (event.code === 'F3' && !event.ctrlKey && !event.altKey) {
    event.preventDefault();
    debug = !debug;
    debugStatus.textContent = debug ? 'ON' : 'OFF';
  }
});
window.addEventListener('keyup', event => keys.delete(event.code));
window.addEventListener('blur', () => { keys.clear(); firing = false; });
document.addEventListener('mousemove', event => {
  if (running && document.pointerLockElement === canvas) player.angle += event.movementX * .0026;
});
document.addEventListener('pointerlockchange', () => {
  if (!touchDevice && document.pointerLockElement !== canvas && running && !ended) {
    keys.clear();
    firing = false;
    showMenu('Jogo <em>pausado</em>', 'A rodada está pausada. Volte à arena quando estiver pronto.', 'CONTINUAR');
  }
});
canvas.addEventListener('mousedown', event => {
  if (!touchDevice && event.button === 0 && running) {
    firing = true;
    playerShoot();
  }
});
window.addEventListener('mouseup', event => {
  if (event.button === 0) firing = false;
});
canvas.addEventListener('pointerdown', event => {
  if (event.pointerType === 'touch' && running) touchAimX = event.clientX;
});
canvas.addEventListener('pointermove', event => {
  if (event.pointerType === 'touch' && running && touchAimX !== null) {
    player.angle += (event.clientX - touchAimX) * .006;
    touchAimX = event.clientX;
  }
});
canvas.addEventListener('pointerup', () => { touchAimX = null; });
document.querySelectorAll('[data-control]').forEach(button => {
  const code = button.dataset.control;
  button.addEventListener('pointerdown', event => { event.preventDefault(); keys.add(code); button.setPointerCapture(event.pointerId); });
  button.addEventListener('pointerup', () => keys.delete(code));
  button.addEventListener('pointercancel', () => keys.delete(code));
});
const touchFire = document.querySelector('#touchFire');
touchFire.addEventListener('pointerdown', event => {
  event.preventDefault();
  firing = true;
  touchFire.setPointerCapture(event.pointerId);
  playerShoot();
});
touchFire.addEventListener('pointerup', () => { firing = false; });
touchFire.addEventListener('pointercancel', () => { firing = false; });
document.querySelector('#touchReload').addEventListener('pointerdown', reload);
if (touchDevice) {
  mobileControls.hidden = false;
  document.querySelector('.controls').innerHTML = '<span>CONTROLES mover</span><span>ARRASTE mirar</span><span>ATIRAR disparar</span><span>RECARREGAR recarregar</span>';
  document.querySelector('.menu-note').textContent = 'Arraste na arena para mirar.';
}
resetRound();
resize();
requestAnimationFrame(frame);
