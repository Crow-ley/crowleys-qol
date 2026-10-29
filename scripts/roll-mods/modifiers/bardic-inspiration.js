import { MODULE_ID, I18N } from "../../constants.js";
import { rollBonus, addBonusToRoll } from "../rolls.js";
import { normalizeDie, searchFlagsForDie, dieFromText, dieFromScale, promptForDie } from "../dice.js";

/**
 * BARDIC INSPIRATION
 *
 * A character with a Bardic Inspiration effect gets a button on their d20
 * rolls. Clicking it rolls the inspiration die, adds it to the total, and
 * deletes the effect. The rule is the same in 2014 and 2024.
 */
export const bardicInspiration = {
  id: "bardicInspiration",
  rules: ["modern", "legacy"],
  oncePerRoll: true,

  enabled() {
    return game.settings.get(MODULE_ID, "bardicEnabled");
  },

  /** The character's Bardic Inspiration effect, if they have one. */
  findSource(actor) {
    const names = game.settings.get(MODULE_ID, "bardicEffectNames")
      .split(",")
      .map(name => name.trim().toLowerCase())
      .filter(Boolean);

    // appliedEffects only contains effects that are on and not suppressed,
    // including ones coming from the actor's items.
    const effect = actor.appliedEffects.find(e => names.includes(e.name.toLowerCase()));
    if (!effect) return null;

    return {
      uuid: effect.uuid,
      name: effect.name,
      img: effect.img,
      label: game.i18n.format(`${I18N}.BardicInspiration.Use`, { name: effect.name })
    };
  },

  /** Roll the die, add it to the roll, and remove the effect. */
  async use({ message, rollIndex, actor, source: effect }) {
    const formula = await resolveDieFormula(effect, actor);
    if (!formula) return; // The player closed the "which die?" prompt.

    const bonus = await rollBonus(formula, game.i18n.localize(`${I18N}.BardicInspiration.Flavor`));

    await addBonusToRoll(message, rollIndex, bonus, {
      id: this.id,
      name: effect.name,
      img: effect.img,
      text: `+${bonus.total}`,
      formula,
      result: bonus.total
    });

    // The die is spent. Remove the effect from the actor.
    // Done after the roll is saved, so a failure never loses the die for nothing.
    await effect.delete();
  },

  usedTooltip(entry) {
    return game.i18n.format(`${I18N}.BardicInspiration.Used`, {
      name: entry.name,
      formula: entry.formula,
      result: entry.result
    });
  }
};

/**
 * Work out which die this Bardic Inspiration uses.
 * Tries, in order:
 *   a) Our own flag on the effect (flags.crowleys-qol.die).
 *   b) A die stored in any other module's flags on the effect.
 *   c) The bard who gave it: their "inspiration" scale value.
 *   d) A die written in the effect's description or name.
 *   e) Ask the player.
 *
 * @returns {Promise<string|null>} A formula like "1d8", or null if cancelled.
 */
async function resolveDieFormula(effect, actor) {
  return normalizeDie(effect.getFlag(MODULE_ID, "die"))
    ?? searchFlagsForDie(effect.flags)
    ?? dieFromOrigin(effect, actor)
    ?? dieFromText(effect.description)
    ?? dieFromText(effect.name)
    ?? promptForDie(game.i18n.localize(`${I18N}.BardicInspiration.PromptTitle`));
}

/**
 * effect.origin is the UUID of whatever created the effect, usually the
 * bard's "Bardic Inspiration" feature item. From that item we can reach
 * the bard, and the bard's class has a scale value for the die size.
 */
function dieFromOrigin(effect, actor) {
  let origin = null;
  if (effect.origin) {
    try {
      origin = fromUuidSync(effect.origin);
    } catch {
      origin = null;
    }
  }

  const candidates = [
    origin?.actor,                                   // origin is an Item on the bard
    origin?.parent?.actor,                           // origin is an Activity or Effect inside an Item
    origin instanceof Actor ? origin : null,         // origin is the bard
    actor                                            // bard inspired themself
  ];

  for (const bard of candidates) {
    const formula = dieFromScale(bard, "inspiration");
    if (formula) return formula;
  }
  return null;
}
