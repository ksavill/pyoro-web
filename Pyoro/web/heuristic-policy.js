import { ACTION_DEFINITIONS } from "./agent-policy.js";

function discreteActionForDirection(direction, abilityHeld = false) {
  if (direction < 0) {
    return abilityHeld ? 4 : 1;
  }
  if (direction > 0) {
    return abilityHeld ? 5 : 2;
  }
  return abilityHeld ? 3 : 0;
}

function actionForIndex(actionIndex) {
  return ACTION_DEFINITIONS[actionIndex] || ACTION_DEFINITIONS[0];
}

// Keep these in sync with the corresponding gameplay constants in app.js.
// The policy deliberately works in game-time: app.js scales every entity by
// the same game delta, so the acceleration factor cancels out of intercepts.
const PYORO_2_PHYSICS = Object.freeze({
  beanSpeed: 1.8,
  playerSpeed: 25,
  seedSpeed: 45,
  seedSpawnOffsetX: 1.3,
  seedSpawnY: 15.3,
  beanCollisionY: 14.25,
  playerBeanClearance: 2.05,
});

function reachableFloorBounds(game, player) {
  let minimum = player.width / 2;
  let maximum = game.cases.length - player.width / 2;

  const firstLeftTile = Math.floor(player.x - player.width / 2 - 1);
  for (let index = firstLeftTile; index >= 0; index -= 1) {
    if (!game.cases[index]?.exists) {
      minimum = index + player.width;
      break;
    }
  }

  const firstRightTile = Math.floor(player.x + player.width / 2);
  for (let index = firstRightTile; index < game.cases.length; index += 1) {
    if (!game.cases[index]?.exists) {
      maximum = index - player.width / 2;
      break;
    }
  }

  return {
    minimum: Math.min(minimum, player.x),
    maximum: Math.max(maximum, player.x),
  };
}

function beanFallSpeed(bean) {
  return PYORO_2_PHYSICS.beanSpeed * bean.speedMultiplier;
}

function pyoro2InterceptPlan(player, bean, direction, bounds) {
  let targetX = player.x;

  // Moving to the firing point gives the bean more time to fall, which moves
  // the required firing point. A few fixed-point iterations converge because
  // Pyoro runs much faster than a bean falls.
  for (let iteration = 0; iteration < 5; iteration += 1) {
    const moveTime = Math.abs(targetX - player.x) / PYORO_2_PHYSICS.playerSpeed;
    const projectedBeanY = bean.y + beanFallSpeed(bean) * moveTime;
    const verticalGap = PYORO_2_PHYSICS.seedSpawnY - projectedBeanY;
    if (verticalGap <= 0) {
      return null;
    }

    const seedTravel = verticalGap * PYORO_2_PHYSICS.seedSpeed
      / (PYORO_2_PHYSICS.seedSpeed + beanFallSpeed(bean));
    targetX = bean.x - direction * (PYORO_2_PHYSICS.seedSpawnOffsetX + seedTravel);
  }

  if (targetX < bounds.minimum || targetX > bounds.maximum) {
    return null;
  }

  const moveTime = Math.abs(targetX - player.x) / PYORO_2_PHYSICS.playerSpeed;
  const projectedBeanY = bean.y + beanFallSpeed(bean) * moveTime;
  const verticalGap = PYORO_2_PHYSICS.seedSpawnY - projectedBeanY;
  const shotTime = verticalGap / (PYORO_2_PHYSICS.seedSpeed + beanFallSpeed(bean));
  const hitTime = moveTime + shotTime;
  const floorTime = (PYORO_2_PHYSICS.beanCollisionY - bean.y) / beanFallSpeed(bean);
  if (shotTime <= 0 || hitTime >= floorTime) {
    return null;
  }

  return {
    bean,
    direction,
    targetX,
    moveTime,
    hitTime,
    urgency: Math.max(0, Math.min(1, bean.y / 18)),
  };
}

function choosePyoro2Plan(game, player, bounds) {
  const floorDamage = game.holeCount() / Math.max(game.cases.length, 1);
  let bestPlan = null;

  for (const bean of game.activeBeans()) {
    for (const direction of [-1, 1]) {
      const plan = pyoro2InterceptPlan(player, bean, direction, bounds);
      if (!plan) {
        continue;
      }

      const typeBonus = bean.type === "super"
        ? 2.4 + floorDamage * 5
        : bean.type === "pink"
          ? 0.8 + floorDamage * 2
          : 0;
      const movementCost = Math.abs(plan.targetX - player.x) / 10;
      const facingBonus = player.direction === direction ? 0.08 : 0;
      plan.score = plan.urgency * 4 + typeBonus + facingBonus - movementCost;

      if (!bestPlan || plan.score > bestPlan.score) {
        bestPlan = plan;
      }
    }
  }

  return bestPlan;
}

function shotOpportunity(game, player) {
  let best = null;

  for (const direction of [-1, 1]) {
    let hitCount = 0;
    let value = 0;
    let primaryBean = null;
    let primaryUrgency = -1;

    for (const bean of game.activeBeans()) {
      const seedStartX = player.x + PYORO_2_PHYSICS.seedSpawnOffsetX * direction;
      const forwardDistance = (bean.x - seedStartX) * direction;
      if (forwardDistance < -0.25) {
        continue;
      }

      const travelTime = Math.max(0, forwardDistance) / PYORO_2_PHYSICS.seedSpeed;
      const seedY = PYORO_2_PHYSICS.seedSpawnY - PYORO_2_PHYSICS.seedSpeed * travelTime;
      const projectedBeanY = bean.y + beanFallSpeed(bean) * travelTime;
      if (Math.abs(seedY - projectedBeanY) > 0.9) {
        continue;
      }

      hitCount += 1;
      const urgency = bean.y / 18;
      value += hitCount === 1 ? 1 : hitCount === 2 ? 2 : hitCount === 3 ? 6 : 20;
      value += urgency * 1.5;
      if (bean.type === "pink") {
        value += 1 + game.holeCount() * 0.15;
      } else if (bean.type === "super") {
        value += 5 + game.holeCount() * 0.4;
      }
      if (urgency > primaryUrgency) {
        primaryUrgency = urgency;
        primaryBean = bean;
      }
    }

    if (hitCount && (!best || value > best.value)) {
      best = { direction, hitCount, value, bean: primaryBean };
    }
  }

  return best;
}

function safeDestination(game, player, bounds) {
  const threats = game.activeBeans()
    .map((bean) => ({
      bean,
      time: (PYORO_2_PHYSICS.beanCollisionY - bean.y) / beanFallSpeed(bean),
    }))
    // Look beyond the immediate collision so a dodge does not escape one
    // bean by stepping directly underneath the next one.
    .filter(({ time }) => time >= -0.03 && time <= 1.2)
    .sort((left, right) => left.time - right.time);

  if (!threats.some(({ bean, time }) => (
    time <= 0.45
    && Math.abs(bean.x - player.x) < PYORO_2_PHYSICS.playerBeanClearance
  ))) {
    return null;
  }

  const candidates = new Set([player.x, bounds.minimum, bounds.maximum]);
  const clampToReachableFloor = (position) => Math.max(
    bounds.minimum,
    Math.min(bounds.maximum, position),
  );
  for (const { bean } of threats) {
    candidates.add(clampToReachableFloor(bean.x - PYORO_2_PHYSICS.playerBeanClearance));
    candidates.add(clampToReachableFloor(bean.x + PYORO_2_PHYSICS.playerBeanClearance));
  }

  let best = null;
  for (const candidate of candidates) {
    let risk = 0;
    for (const { bean, time } of threats) {
      const distance = candidate - player.x;
      const travel = Math.min(
        Math.abs(distance),
        PYORO_2_PHYSICS.playerSpeed * Math.max(time, 0),
      );
      const projectedX = player.x + Math.sign(distance) * travel;
      const clearance = Math.abs(projectedX - bean.x);
      if (clearance < PYORO_2_PHYSICS.playerBeanClearance) {
        risk += (PYORO_2_PHYSICS.playerBeanClearance - clearance) * (time < 0.3 ? 100 : 20);
      }
    }

    const edgePenalty = candidate <= bounds.minimum + 0.1 || candidate >= bounds.maximum - 0.1 ? 0.15 : 0;
    const cost = risk + Math.abs(candidate - player.x) * 0.08 + edgePenalty;
    if (!best || cost < best.cost) {
      best = { x: candidate, cost, threats };
    }
  }

  return best;
}

function movementWillCollide(game, player, direction, bounds) {
  if (!direction) {
    return false;
  }

  const gameDelta = (game.fixedStep ?? 1 / 60) * game.speed;
  const nextX = Math.max(
    bounds.minimum,
    Math.min(bounds.maximum, player.x + direction * PYORO_2_PHYSICS.playerSpeed * gameDelta),
  );

  return game.activeBeans().some((bean) => {
    const nextY = bean.y + beanFallSpeed(bean) * gameDelta;
    return (
      nextY >= PYORO_2_PHYSICS.beanCollisionY - 0.15
      && nextY <= 17.75
      && Math.abs(bean.x - nextX) < PYORO_2_PHYSICS.playerBeanClearance
    );
  });
}

function safeMovementDirection(game, player, desiredDirection, bounds) {
  if (!movementWillCollide(game, player, desiredDirection, bounds)) {
    return desiredDirection;
  }
  if (!movementWillCollide(game, player, -desiredDirection, bounds)) {
    return -desiredDirection;
  }
  return 0;
}

function heuristicPyoro1Decision(game) {
  const player = game.pyoro;
  if (!player || player.dead) {
    return {
      actionIndex: 0,
      action: actionForIndex(0),
      reason: "player_unavailable",
      target: null,
    };
  }

  if (player.tongue) {
    if (!player.tongue.goBack && !player.tongue.caughtBean) {
      const actionIndex = discreteActionForDirection(player.direction, true);
      return {
        actionIndex,
        action: actionForIndex(actionIndex),
        reason: "hold_tongue_out",
        target: player.tongue.caughtBean
          ? {
            beanType: player.tongue.caughtBean.type,
            beanX: player.tongue.caughtBean.x,
            beanY: player.tongue.caughtBean.y,
          }
          : null,
      };
    }

    return {
      actionIndex: 0,
      action: actionForIndex(0),
      reason: "wait_for_tongue_return",
      target: null,
    };
  }

  const plan = game.bestPyoro1Plan();
  if (!plan) {
    return {
      actionIndex: 0,
      action: actionForIndex(0),
      reason: "no_intercept_plan",
      target: null,
    };
  }

  if (Math.abs(player.x - plan.targetX) <= 0.65) {
    const actionIndex = discreteActionForDirection(plan.direction, true);
    return {
      actionIndex,
      action: actionForIndex(actionIndex),
      reason: "fire_intercept",
      target: {
        beanType: plan.bean.type,
        beanX: plan.bean.x,
        beanY: plan.bean.y,
        direction: plan.direction,
        targetX: plan.targetX,
        urgency: plan.urgency,
      },
    };
  }

  const direction = player.x < plan.targetX ? 1 : -1;
  const actionIndex = discreteActionForDirection(direction, false);
  return {
    actionIndex,
    action: actionForIndex(actionIndex),
    reason: "move_to_intercept",
    target: {
      beanType: plan.bean.type,
      beanX: plan.bean.x,
      beanY: plan.bean.y,
      direction: plan.direction,
      targetX: plan.targetX,
      urgency: plan.urgency,
    },
  };
}

function heuristicPyoro2Decision(game) {
  const player = game.pyoro;
  if (!player || player.dead) {
    return {
      actionIndex: 0,
      action: actionForIndex(0),
      reason: "player_unavailable",
      target: null,
    };
  }

  // Headless actions use input.action, while the browser bot drives the
  // player directly and tracks the same press edge with menuBotAbilityHeld.
  const abilityHeld = Boolean(game.input.action || game.menuBotAbilityHeld);
  const bounds = reachableFloorBounds(game, player);
  const safe = safeDestination(game, player, bounds);
  const movementStep = PYORO_2_PHYSICS.playerSpeed * (game.fixedStep ?? 1 / 60) * game.speed;
  if (safe) {
    const threat = safe.threats[0]?.bean;
    const delta = safe.x - player.x;
    if (Math.abs(delta) <= Math.max(0.12, movementStep * 0.55)) {
      const actionIndex = 0;
      return {
        actionIndex,
        action: actionForIndex(actionIndex),
        reason: abilityHeld ? "release_at_safe_position" : "hold_safe_position",
        target: threat ? {
          beanType: threat.type,
          beanX: threat.x,
          beanY: threat.y,
          targetX: safe.x,
        } : null,
      };
    }

    const direction = delta < 0 ? -1 : 1;
    const actionIndex = discreteActionForDirection(direction, false);
    return {
      actionIndex,
      action: actionForIndex(actionIndex),
      reason: "dodge_predicted_collision",
      target: threat ? {
        beanType: threat.type,
        beanX: threat.x,
        beanY: threat.y,
        direction,
        targetX: safe.x,
      } : null,
    };
  }

  const opportunity = shotOpportunity(game, player);
  if (opportunity && !abilityHeld) {
    const actionIndex = discreteActionForDirection(0, true);
    if (player.direction !== opportunity.direction) {
      const safeDirection = safeMovementDirection(
        game,
        player,
        opportunity.direction,
        bounds,
      );
      const faceActionIndex = discreteActionForDirection(safeDirection, false);
      return {
        actionIndex: faceActionIndex,
        action: actionForIndex(faceActionIndex),
        reason: safeDirection === opportunity.direction
          ? "face_shot_opportunity"
          : "avoid_collision_while_facing",
        target: null,
      };
    }
    return {
      actionIndex,
      action: actionForIndex(actionIndex),
      reason: opportunity.hitCount > 1 ? "shoot_combo" : "shoot_intercept",
      target: opportunity.bean ? {
        beanType: opportunity.bean.type,
        beanX: opportunity.bean.x,
        beanY: opportunity.bean.y,
        direction: opportunity.direction,
      } : null,
    };
  }

  const plan = choosePyoro2Plan(game, player, bounds);
  if (!plan) {
    return {
      actionIndex: 0,
      action: actionForIndex(0),
      reason: abilityHeld ? "release_previous_shot" : "no_reachable_target",
      target: null,
    };
  }

  const deltaX = plan.targetX - player.x;
  const target = {
    beanType: plan.bean.type,
    beanX: plan.bean.x,
    beanY: plan.bean.y,
    direction: plan.direction,
    targetX: plan.targetX,
  };

  if (Math.abs(deltaX) > Math.max(0.35, movementStep * 0.55)) {
    const desiredDirection = deltaX < 0 ? -1 : 1;
    const direction = safeMovementDirection(game, player, desiredDirection, bounds);
    const actionIndex = discreteActionForDirection(direction, false);
    return {
      actionIndex,
      action: actionForIndex(actionIndex),
      reason: direction === desiredDirection ? "move_to_intercept" : "avoid_collision_en_route",
      target,
    };
  }

  if (abilityHeld) {
    return {
      actionIndex: 0,
      action: actionForIndex(0),
      reason: "release_previous_shot",
      target,
    };
  }

  if (player.direction !== plan.direction) {
    const direction = safeMovementDirection(game, player, plan.direction, bounds);
    const actionIndex = discreteActionForDirection(direction, false);
    return {
      actionIndex,
      action: actionForIndex(actionIndex),
      reason: direction === plan.direction ? "face_target" : "avoid_collision_while_facing",
      target,
    };
  }

  return {
    actionIndex: discreteActionForDirection(0, true),
    action: actionForIndex(discreteActionForDirection(0, true)),
    reason: "shoot_planned_intercept",
    target,
  };
}

export function heuristicDecisionForGame(game) {
  return game.currentMode().key === "pyoro2"
    ? heuristicPyoro2Decision(game)
    : heuristicPyoro1Decision(game);
}

export function heuristicActionForGame(game) {
  return heuristicDecisionForGame(game).actionIndex;
}
