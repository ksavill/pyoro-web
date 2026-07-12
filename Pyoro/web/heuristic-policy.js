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

  if (game.input.action) {
    return {
      actionIndex: 0,
      action: actionForIndex(0),
      reason: "release_previous_shot",
      target: null,
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
    // Dodge toward a side that actually has room to clear the bean;
    // sprinting past it beats being cornered against a wall.
    const minX = player.width / 2;
    const maxX = game.cases.length - player.width / 2;
    const clearance = 2.3;
    const canEscape = (dir) => (dir === -1
      ? threat.x - clearance >= minX
      : threat.x + clearance <= maxX);
    if (!canEscape(away) && canEscape(-away)) {
      away = -away;
    }
    const actionIndex = discreteActionForDirection(away, false);
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
    const actionIndex = discreteActionForDirection(deltaX < 0 ? -1 : 1, false);
    return {
      actionIndex,
      action: actionForIndex(actionIndex),
      reason: "move_to_intercept",
      target,
    };
  }

  if (player.direction === direction && player.isShootingEntity(targetBean)) {
    const actionIndex = discreteActionForDirection(0, true);
    return {
      actionIndex,
      action: actionForIndex(actionIndex),
      reason: "shoot_target",
      target,
    };
  }

  if (player.direction !== direction) {
    const actionIndex = discreteActionForDirection(direction, false);
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
