import {
  PATROL, angleDelta, angleTo, canOccupy, clamp, clearLine,
  distance, findPath, moveWithCollision, rayWall,
} from './world.js';
import { CONFIG } from './config.js';

const C = CONFIG.bot;
const HEARING = { shot: C.shotHearingRange, sprint: C.sprintHearingRange };
const FOV = C.visionDegrees * Math.PI / 180;
const TURN_RATE = C.turnDegreesPerSecond * Math.PI / 180;

export function createBot() {
  return {
    x: 18.5, y: 18.5, angle: -Math.PI / 2, hp: C.health, ammo: C.magazine,
    state: 'Patrulhar', stateSince: 0, patrolIndex: 1,
    lastSeen: null, heard: null, visible: false, acquiredAt: -Infinity,
    lastInvestigatedSoundAt: -Infinity,
    path: [], pathIndex: 0, destination: null, lastPathAt: -Infinity,
    reloadingUntil: 0, nextShotAt: 0, retreatUntil: 0, retreatReadyAt: 0,
    stuckSince: null, stuckRetries: 0, lastPosition: { x: 18.5, y: 18.5 },
    investigationStarted: null, logs: [], shots: [], navigationError: false,
  };
}

export function canSee(bot, player) {
  if (player.hp <= 0 || distance(bot, player) > C.visionRange) return false;
  if (Math.abs(angleDelta(angleTo(bot, player), bot.angle)) > FOV / 2) return false;
  return clearLine(bot, player);
}

function turnToward(bot, target, dt) {
  const difference = angleDelta(angleTo(bot, target), bot.angle);
  bot.angle += clamp(difference, -TURN_RATE * dt, TURN_RATE * dt);
}

function setState(bot, next, now, reason) {
  if (bot.state === next) return;
  bot.logs.push({ time: now, from: bot.state, to: next, reason });
  if (bot.logs.length > 30) bot.logs.shift();
  bot.state = next;
  bot.stateSince = now;
  bot.path = [];
  bot.pathIndex = 0;
  bot.destination = null;
  bot.lastPathAt = -Infinity;
  bot.investigationStarted = null;
}

function processPerception(bot, player, events, now) {
  const sight = canSee(bot, player);
  if (sight) {
    if (!bot.visible) bot.acquiredAt = now;
    bot.lastSeen = { x: player.x, y: player.y, time: now };
  }
  bot.visible = sight;
  if (bot.lastSeen && now - bot.lastSeen.time > C.memorySeconds) bot.lastSeen = null;
  for (const event of events) {
    if (now - event.time > C.soundMemorySeconds || now < event.time) continue;
    if (event.time <= bot.lastInvestigatedSoundAt) continue;
    if (distance(bot, event) > (HEARING[event.type] ?? 0)) continue;
    if (!bot.heard || event.time > bot.heard.time || (event.time === bot.heard.time && event.type === 'shot')) {
      bot.heard = { ...event };
    }
  }
  if (bot.heard && now - bot.heard.time > C.soundMemorySeconds) bot.heard = null;
}

function chooseRetreat(bot, threat) {
  let best = null;
  let score = -Infinity;
  for (let i = 0; i < 6; i++) {
    const theta = i * Math.PI / 3 + 0.25;
    const candidate = { x: bot.x + Math.cos(theta) * 8, y: bot.y + Math.sin(theta) * 8 };
    if (!canOccupy(candidate.x, candidate.y)) continue;
    if (distance(candidate, threat) <= distance(bot, threat) + 0.75) continue;
    const path = findPath(bot, candidate);
    if (!path.length) continue;
    const value = distance(candidate, threat) + (!clearLine(candidate, threat) ? 6 : 0) - path.length * 0.15;
    if (value > score) { score = value; best = candidate; }
  }
  return best;
}

function setRoute(bot, destination, now) {
  if (!destination) return false;
  const changed = !bot.destination || distance(bot.destination, destination) > 1;
  if (!changed && bot.path.length && bot.pathIndex < bot.path.length) return true;
  if (now - bot.lastPathAt < 0.5) return bot.pathIndex < bot.path.length;
  bot.lastPathAt = now;
  bot.destination = { x: destination.x, y: destination.y };
  bot.path = findPath(bot, destination);
  bot.pathIndex = 0;
  bot.navigationError = bot.path.length === 0;
  return bot.path.length > 0;
}

function followRoute(bot, dt, speed, now) {
  if (!bot.path.length || bot.pathIndex >= bot.path.length) return true;
  let target = bot.path[bot.pathIndex];
  if (distance(bot, target) < 0.24 && bot.pathIndex < bot.path.length - 1) {
    bot.pathIndex++;
    target = bot.path[bot.pathIndex];
  }
  turnToward(bot, target, dt);
  const travel = Math.min(speed * dt, distance(bot, target));
  moveWithCollision(bot, Math.cos(angleTo(bot, target)) * travel, Math.sin(angleTo(bot, target)) * travel);

  if (distance(bot, bot.lastPosition) >= 0.2) {
    bot.lastPosition = { x: bot.x, y: bot.y };
    bot.stuckSince = null;
    bot.stuckRetries = 0;
  } else if (bot.stuckSince === null) {
    bot.stuckSince = now;
  } else if (now - bot.stuckSince >= 2) {
    bot.stuckSince = now;
    if (bot.stuckRetries === 0) {
      bot.stuckRetries = 1;
      bot.lastPathAt = -Infinity;
      setRoute(bot, bot.destination, now);
    } else {
      bot.navigationError = true;
      bot.path = [];
      bot.pathIndex = 0;
      bot.patrolIndex = (bot.patrolIndex + 1) % PATROL.length;
      bot.stuckRetries = 0;
      return true;
    }
  }
  return distance(bot, bot.destination) <= 0.75;
}

function fire(bot, player, now, random) {
  if (now < bot.nextShotAt || bot.ammo <= 0 || now - bot.acquiredAt < C.reactionSeconds) return;
  if (!bot.visible || distance(bot, player) > C.attackRange) return;
  if (Math.abs(angleDelta(angleTo(bot, player), bot.angle)) > C.aimDegrees * Math.PI / 180) return;
  if (!clearLine(bot, player)) return;
  bot.ammo--;
  bot.nextShotAt = now + C.shotInterval;
  const shotAngle = bot.angle + (random() * 2 - 1) * C.spreadDegrees * Math.PI / 180;
  const ux = Math.cos(shotAngle);
  const uy = Math.sin(shotAngle);
  const vx = player.x - bot.x;
  const vy = player.y - bot.y;
  const along = vx * ux + vy * uy;
  const side = Math.abs(vx * uy - vy * ux);
  const wallDistance = rayWall(bot, shotAngle).distance;
  const hit = along > 0 && along < wallDistance && side <= 0.25;
  if (hit) player.hp = Math.max(0, player.hp - C.damage);
  bot.shots.push({ time: now, hit, angle: shotAngle });
  if (bot.shots.length > 10) bot.shots.shift();
}

export function tickBot(bot, player, events, now, dt = C.decisionInterval, random = Math.random) {
  if (bot.hp <= 0) {
    setState(bot, 'Morto', now, 'vida zerada');
    bot.visible = false;
    return;
  }
  processPerception(bot, player, events, now);
  const threat = bot.visible ? player : bot.lastSeen;
  if (bot.reloadingUntil > now) {
    setState(bot, 'Recarregar', now, 'recarga em andamento');
    return;
  }
  if (bot.state === 'Recarregar' && bot.reloadingUntil !== 0) {
    bot.ammo = C.magazine;
    bot.reloadingUntil = 0;
  }

  if (bot.state === 'Recuar' && now >= bot.retreatUntil) bot.retreatReadyAt = now + C.retreatCooldown;
  const retreatActive = bot.state === 'Recuar' && now < bot.retreatUntil && bot.destination;
  let retreatPoint = null;
  if (!retreatActive && bot.hp <= C.lowHealth && bot.visible && now >= bot.retreatReadyAt) {
    retreatPoint = chooseRetreat(bot, player);
  }
  if (retreatPoint) {
    setState(bot, 'Recuar', now, 'vida baixa');
    bot.retreatUntil = now + C.retreatDuration;
    setRoute(bot, retreatPoint, now);
  } else if (retreatActive) {
    // Keep the existing destination until retreat ends.
  } else if (bot.ammo === 0) {
    setState(bot, 'Recarregar', now, 'carregador vazio');
    bot.reloadingUntil = now + C.reloadSeconds;
    return;
  } else if (bot.visible) {
    const range = bot.state === 'Atacar' ? C.leaveAttackRange : C.attackRange;
    setState(bot, distance(bot, player) <= range ? 'Atacar' : 'Perseguir', now, 'alvo visível');
  } else if (bot.lastSeen || bot.heard) {
    setState(bot, 'Investigar', now, 'pista recente');
  } else {
    setState(bot, 'Patrulhar', now, 'sem pistas');
  }

  if (bot.state === 'Atacar') {
    turnToward(bot, player, dt);
    fire(bot, player, now, random);
  } else if (bot.state === 'Perseguir') {
    if (setRoute(bot, player, now)) followRoute(bot, dt, C.chaseSpeed, now);
  } else if (bot.state === 'Recuar') {
    if (followRoute(bot, dt, C.chaseSpeed, now)) bot.retreatUntil = now;
  } else if (bot.state === 'Investigar') {
    const clue = bot.lastSeen ?? bot.heard;
    if (clue && setRoute(bot, clue, now)) {
      if (followRoute(bot, dt, C.patrolSpeed, now)) {
        if (bot.investigationStarted === null) bot.investigationStarted = now;
        bot.angle += dt * 1.2;
        if (now - bot.investigationStarted >= 2) {
          if (bot.heard) bot.lastInvestigatedSoundAt = bot.heard.time;
          bot.lastSeen = null;
          bot.heard = null;
          setState(bot, 'Patrulhar', now, 'busca concluída');
        }
      }
    } else if (clue) {
      bot.lastSeen = null;
      bot.heard = null;
    }
  } else if (bot.state === 'Patrulhar') {
    const point = PATROL[bot.patrolIndex];
    if (setRoute(bot, point, now) && followRoute(bot, dt, C.patrolSpeed, now)) {
      bot.patrolIndex = (bot.patrolIndex + 1) % PATROL.length;
      bot.path = [];
    }
  }
}
