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

function targetDirection(player, bean) {
  return bean.x >= player.x ? 1 : -1;
}

function chooseFallbackTargetBean(game) {
  const player = game.pyoro;
  if (!player) {
    return null;
  }

  const beans = game.activeBeans();
  if (!beans.length) {
    return null;
  }

  let bestBean = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  const floorDamage = game.holeCount() / Math.max(game.cases.length, 1);

  for (const bean of beans) {
    if (player.y - bean.y < 3) {
      continue;
    }

    const urgency = bean.y / 18;
    const lateralDistance = Math.abs(bean.x - player.x) / 32;
    const typeBonus = bean.type === "super"
      ? 0.35 + floorDamage * 0.9
      : bean.type === "pink"
        ? 0.18 + floorDamage * 0.45
        : 0;
    const score = urgency * 2.5 + typeBonus - lateralDistance;
    if (score > bestScore) {
      bestScore = score;
      bestBean = bean;
    }
  }

  return bestBean;
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

// The horizontal span the bird can actually walk to: holes in the floor
// block movement, so the world edges are not the only limits.
export function reachableRange(game) {
  const player = game.pyoro;
  const half = player.width / 2;

  let leftTile = Math.floor(player.x - half - 1);
  while (leftTile >= 0 && game.cases[leftTile]?.exists) {
    leftTile -= 1;
  }

  let rightTile = Math.floor(player.x + half);
  while (rightTile < game.cases.length && game.cases[rightTile]?.exists) {
    rightTile += 1;
  }

  return {
    minX: leftTile + 1 + half,
    maxX: rightTile - half,
  };
}

function alignedForDirection(player, entity, direction) {
  const distance = direction === 1 ? entity.x - player.x : player.x - entity.x;
  return (
    player.y - entity.y + entity.height >= distance - entity.width
    && player.y - entity.y - entity.height <= distance + entity.width
  );
}

// True when a seed fired while facing `direction` would hit some bean.
// Beans too close (inside the muzzle offset) or too low cannot be hit.
function shootableBeanExists(game, direction) {
  const player = game.pyoro;
  for (const bean of game.activeBeans()) {
    const forward = (bean.x - player.x) * direction;
    if (forward > 1.5 && player.y - bean.y > 2 && alignedForDirection(player, bean, direction)) {
      return true;
    }
  }
  return false;
}

// Lateral distance from x to the nearest bean that is low enough to be a
// collision hazard soon. Used to keep chasing from ever walking closer to
// a falling bean; the 2.4 threshold is wider than the 2.2 dodge trigger so
// chasing and dodging cannot oscillate at the boundary.
function nearestDangerDistance(game, x) {
  const player = game.pyoro;
  let closest = Number.POSITIVE_INFINITY;
  for (const bean of game.activeBeans()) {
    const above = player.y - bean.y;
    if (above > -1 && above < 6) {
      closest = Math.min(closest, Math.abs(bean.x - x));
    }
  }
  return closest;
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

  // Fire freely while repositioning, but keep the number of seeds in
  // flight bounded, and release the button between shots so it can refire.
  const canRequestShot = !game.input.action
    && game.seeds.filter((seed) => !seed.removed).length < 2;
  const shotFor = (direction) => canRequestShot && shootableBeanExists(game, direction);

  // A seed cannot hit a bean falling straight onto the bird (it spawns
  // beside the beak and flies away diagonally), so nearby overhead beans
  // must be dodged instead of shot.
  let threat = null;
  for (const bean of game.activeBeans()) {
    const lateral = Math.abs(bean.x - player.x);
    const above = player.y - bean.y;
    if (lateral < 2.2 && above > -1 && above < 5) {
      if (!threat || bean.y > threat.y) {
        threat = bean;
      }
    }
  }

  if (threat) {
    let away = threat.x >= player.x ? -1 : 1;
    // Dodge toward a side that actually has room to clear the bean —
    // walls AND floor holes both limit escape routes.
    const range = reachableRange(game);
    const clearance = 2.3;
    const escapeLeftOk = threat.x - clearance >= range.minX;
    const escapeRightOk = threat.x + clearance <= range.maxX;
    if (away === -1 && !escapeLeftOk && escapeRightOk) {
      away = 1;
    } else if (away === 1 && !escapeRightOk && escapeLeftOk) {
      away = -1;
    } else if (!escapeLeftOk && !escapeRightOk) {
      // Trapped: at least put as much distance as possible between us.
      away = range.maxX - threat.x > threat.x - range.minX ? 1 : -1;
    }
    const actionIndex = discreteActionForDirection(away, shotFor(away));
    return {
      actionIndex,
      action: actionForIndex(actionIndex),
      reason: "dodge_bean",
      target: {
        beanType: threat.type,
        beanX: threat.x,
        beanY: threat.y,
        direction: away,
      },
    };
  }

  const rankedTarget = game.bestPyoro2Target();
  const targetBean = rankedTarget?.bean ?? chooseFallbackTargetBean(game);
  if (!targetBean) {
    return {
      actionIndex: 0,
      action: actionForIndex(0),
      reason: "no_target",
      target: null,
    };
  }

  const direction = targetDirection(player, targetBean);
  // The seed travels the 45-degree diagonal, so the bird must stand where
  // that diagonal passes through the bean instead of underneath it.
  const interceptX = targetBean.x - direction * (player.y - targetBean.y);
  const deltaX = interceptX - player.x;
  const target = {
    beanType: targetBean.type,
    beanX: targetBean.x,
    beanY: targetBean.y,
    direction,
    targetX: interceptX,
  };

  if (Math.abs(deltaX) > 0.6) {
    const moveDirection = deltaX < 0 ? -1 : 1;

    // Never walk into another bean's landing zone; hold at the edge and
    // keep shooting until the danger clears. Moves are only allowed if
    // they do not bring the bird closer to a falling bean.
    const nextX = player.x + moveDirection * 0.9;
    const nextDanger = nearestDangerDistance(game, nextX);
    if (nextDanger < 2.4 && nextDanger <= nearestDangerDistance(game, player.x)) {
      const actionIndex = discreteActionForDirection(0, shotFor(player.direction));
      return {
        actionIndex,
        action: actionForIndex(actionIndex),
        reason: "hold_position",
        target,
      };
    }

    const actionIndex = discreteActionForDirection(moveDirection, shotFor(moveDirection));
    return {
      actionIndex,
      action: actionForIndex(actionIndex),
      reason: "move_to_intercept",
      target,
    };
  }

  if (player.direction === direction && player.isShootingEntity(targetBean)) {
    // Refire requires releasing the button for a step.
    const actionIndex = discreteActionForDirection(0, !game.input.action);
    return {
      actionIndex,
      action: actionForIndex(actionIndex),
      reason: game.input.action ? "release_previous_shot" : "shoot_target",
      target,
    };
  }

  if (player.direction !== direction) {
    const actionIndex = discreteActionForDirection(direction, shotFor(direction));
    return {
      actionIndex,
      action: actionForIndex(actionIndex),
      reason: "face_target",
      target,
    };
  }

  return {
    actionIndex: 0,
    action: actionForIndex(0),
    reason: "wait_for_alignment",
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
