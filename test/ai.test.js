import test from 'node:test';
import assert from 'node:assert/strict';
import { createBot, canSee, tickBot } from '../src/ai.js';
import { clearLine, findPath, isWall } from '../src/world.js';

function nearby() {
  const bot = createBot();
  bot.x = 2.5;
  bot.y = 2.5;
  bot.angle = 0;
  bot.lastPosition = { x: 2.5, y: 2.5 };
  return { bot, player: { x: 3.5, y: 2.5, hp: 100 } };
}

test('visão respeita alcance, cone e parede', () => {
  const { bot, player } = nearby();
  assert.equal(canSee(bot, player), true);
  bot.angle = Math.PI;
  assert.equal(canSee(bot, player), false);
  bot.angle = 0;
  player.x = 5.5;
  assert.equal(clearLine(bot, player), false);
  assert.equal(canSee(bot, player), false);
});

test('rota encontra caminho navegável entre os dois lados da arena', () => {
  const path = findPath({ x: 2.5, y: 2.5 }, { x: 18.5, y: 18.5 });
  assert.ok(path.length > 0);
  assert.deepEqual(path.at(-1), { x: 18.5, y: 18.5 });
  assert.ok(path.every(point => !isWall(point.x, point.y)));
  assert.deepEqual(findPath({ x: 2.5, y: 2.5 }, { x: 4.5, y: 2.5 }), []);
});

test('bot aguarda reação, atira apenas com visão e investiga a última posição', () => {
  const { bot, player } = nearby();
  tickBot(bot, player, [], 0, .1, () => .5);
  assert.equal(bot.state, 'Atacar');
  assert.equal(bot.ammo, 20);
  tickBot(bot, player, [], .4, .1, () => .5);
  assert.equal(bot.ammo, 19);
  assert.equal(player.hp, 90);
  const seen = { x: bot.lastSeen.x, y: bot.lastSeen.y };
  player.x = 5.5;
  tickBot(bot, player, [], .5, .1, () => .5);
  assert.equal(bot.state, 'Investigar');
  assert.equal(bot.ammo, 19);
  assert.deepEqual({ x: bot.lastSeen.x, y: bot.lastSeen.y }, seen);
  player.x = 6.5;
  tickBot(bot, player, [], .6, .1, () => .5);
  assert.deepEqual({ x: bot.lastSeen.x, y: bot.lastSeen.y }, seen);
});

test('ruído inicia investigação sem autorizar disparo', () => {
  const { bot, player } = nearby();
  bot.angle = Math.PI;
  tickBot(bot, player, [{ type: 'shot', x: player.x, y: player.y, time: 0 }], 0, .1);
  assert.equal(bot.state, 'Investigar');
  assert.equal(bot.ammo, 20);
  assert.equal(bot.lastSeen, null);
});

test('recarga bloqueia disparos e morte interrompe ação', () => {
  const { bot, player } = nearby();
  bot.ammo = 0;
  tickBot(bot, player, [], 0, .1);
  assert.equal(bot.state, 'Recarregar');
  tickBot(bot, player, [], 1, .1);
  assert.equal(bot.ammo, 0);
  tickBot(bot, player, [], 2.1, .1);
  assert.equal(bot.ammo, 19);
  bot.hp = 0;
  tickBot(bot, player, [], 2.2, .1);
  assert.equal(bot.state, 'Morto');
  assert.equal(bot.ammo, 19);
});

test('vida baixa aciona recuo somente quando existe caminho', () => {
  const { bot, player } = nearby();
  bot.hp = 25;
  tickBot(bot, player, [], 0, .1);
  assert.equal(bot.state, 'Recuar');
  assert.ok(bot.destination);
  assert.ok(bot.path.length > 0);
});

test('bot patrulha, encontra e elimina um jogador parado sem travar na navegação', () => {
  const bot = createBot();
  const player = { x: 2.5, y: 2.5, hp: 100 };
  for (let step = 0; step < 400 && player.hp > 0; step++) {
    tickBot(bot, player, [], step / 10, .1, () => .5);
  }
  assert.equal(player.hp, 0);
  assert.equal(bot.navigationError, false);
  assert.ok(bot.logs.some(log => log.to === 'Atacar'));
});
