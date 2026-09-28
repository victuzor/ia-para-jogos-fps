export const CONFIG = Object.freeze({
  player: Object.freeze({
    health: 100, magazine: 20, walkSpeed: 2.5, sprintSpeed: 4,
    reloadSeconds: 2, shotInterval: 0.2, damage: 10,
  }),
  bot: Object.freeze({
    health: 100, magazine: 20,
    visionRange: 25, visionDegrees: 100, decisionInterval: 0.1,
    shotHearingRange: 20, sprintHearingRange: 8,
    memorySeconds: 5, soundMemorySeconds: 3,
    patrolSpeed: 2, chaseSpeed: 4,
    attackRange: 12, leaveAttackRange: 14,
    lowHealth: 25, retreatDuration: 3, retreatCooldown: 5,
    reloadSeconds: 2, shotInterval: 0.2, damage: 10,
    reactionSeconds: 0.3, aimDegrees: 5, spreadDegrees: 2,
    turnDegreesPerSecond: 180,
  }),
});
