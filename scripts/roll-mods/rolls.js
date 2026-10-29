import { MODULE_ID } from "../constants.js";

/**
 * ROLL HELPERS
 *
 * Small tools every roll modifier shares: finding a message's rolls,
 * adding a bonus to one of them, and saving the result.
 */

/** Ready Set Roll Reforged's module id. */
export const RSR_ID = "rsreforged";

/** Is this one of dnd5e's d20 rolls (attack, save, check, skill, tool)? */
export function isD20(roll) {
  const D20Roll = CONFIG.Dice.D20Roll ?? globalThis.dnd5e?.dice?.D20Roll;
  return !!D20Roll && roll instanceof D20Roll;
}

/**
 * On older RSR card layouts, RSR keeps the real rolls in
 * flags.rsreforged.rolls instead of message.rolls. On dnd5e 6 cards it
 * uses message.rolls like everyone else. This tells the two apart.
 */
export function usesRsrFlagRolls(message) {
  if (message.rolls?.some(isD20)) return false;
  return Array.isArray(message.flags?.[RSR_ID]?.rolls);
}

/** Get the message's rolls from wherever they are stored. */
export function getRolls(message) {
  if (!usesRsrFlagRolls(message)) return Array.from(message.rolls ?? []);
  return message.flags[RSR_ID].rolls
    .map(data => {
      if (data instanceof Roll) return data;
      try {
        return Roll.fromData(data);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/**
 * Which rules the world uses. dnd5e stores this as its own world setting:
 * "modern" for 2024 and "legacy" for 2014.
 * @returns {"modern"|"legacy"}
 */
export function rulesVersion() {
  try {
    return game.settings.get("dnd5e", "rulesVersion") === "legacy" ? "legacy" : "modern";
  } catch {
    return "modern";
  }
}

/**
 * Roll a formula on its own, label its dice, and show Dice So Nice if active.
 * @param {string} formula  Like "1d8".
 * @param {string} flavor   Label shown next to the dice in the breakdown.
 * @returns {Promise<Roll>}
 */
export async function rollBonus(formula, flavor) {
  const roll = await new Roll(formula).evaluate();
  for (const term of roll.terms) term.options.flavor ??= flavor;
  if (game.dice3d) await game.dice3d.showForRoll(roll, game.user, true);
  return roll;
}

/**
 * Add a rolled bonus onto one roll in a chat message and save it, together
 * with a record of what was used so the card can show it afterwards.
 *
 * @param {ChatMessage} message
 * @param {number} rollIndex  Which roll in the message to change.
 * @param {Roll} bonus        An evaluated roll to add on.
 * @param {object} usedEntry  What to remember, see engine.js "used markers".
 */
export async function addBonusToRoll(message, rollIndex, bonus, usedEntry) {
  // Build a new roll: the old roll's pieces + "+" + the bonus.
  // Using the old roll's own class (D20Roll) and options keeps the
  // success/failure colouring, advantage info, crit ranges, etc.
  // This is the same pattern RSR uses for its own "Add Bonus" button.
  const rolls = getRolls(message);
  const original = rolls[rollIndex];
  const RollClass = original.constructor;

  const combined = RollClass.fromTerms([
    ...original.terms.map(term => foundry.utils.deepClone(term)),
    new foundry.dice.terms.OperatorTerm({ operator: "+" }),
    ...bonus.terms
  ]);
  combined.options = foundry.utils.deepClone(original.options);
  delete combined.options.rsreforgedCriticalBase; // RSR's saved pre-crit copy would drop our bonus
  combined._total = original.total + bonus.total;
  combined._evaluated = true;
  rolls[rollIndex] = combined;

  await saveRolls(message, rolls, usedEntry);
}

/**
 * Save changed rolls back to wherever the message keeps them, and add an
 * entry to the message's list of used modifiers. One update, so every
 * connected player redraws the card once with both changes.
 */
export async function saveRolls(message, rolls, usedEntry) {
  const serialized = rolls.map(roll => roll.toJSON());
  const used = [...getUsedEntries(message), usedEntry];

  const update = { [`flags.${MODULE_ID}.used`]: used };
  if (usesRsrFlagRolls(message)) update[`flags.${RSR_ID}.rolls`] = serialized;
  else update.rolls = serialized;
  await message.update(update);
}

/**
 * Every modifier already used on this message.
 * Messages from version 0.1.0 stored a single "bardicInspiration" flag
 * instead of a list, so read that too and treat it as one entry.
 * @returns {object[]}
 */
export function getUsedEntries(message) {
  const used = message.getFlag(MODULE_ID, "used");
  const list = Array.isArray(used) ? [...used] : [];

  const legacy = message.getFlag(MODULE_ID, "bardicInspiration");
  if (legacy && !list.some(entry => entry.id === "bardicInspiration")) {
    list.push({
      id: "bardicInspiration",
      name: legacy.name,
      img: legacy.img,
      text: `+${legacy.result}`,
      formula: legacy.formula,
      result: legacy.result
    });
  }
  return list;
}
