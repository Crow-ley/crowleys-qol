import { I18N } from "../constants.js";

/**
 * DIE HELPERS
 *
 * Shared tools for working out which die an ability uses.
 */

/** Matches a die formula like "d8" or "1d8". */
const DIE_ONLY = /^\s*(\d*)d(4|6|8|10|12|20)\s*$/i;

/** Finds a die formula inside longer text, like "Roll a d8 and add it". */
const DIE_IN_TEXT = /\b(\d*d(?:4|6|8|10|12|20))\b/i;

/** Turn "d8" or "1d8" into "1d8". Anything else becomes null. */
export function normalizeDie(value) {
  if (typeof value !== "string") return null;
  const match = value.match(DIE_ONLY);
  if (!match) return null;
  return `${match[1] || 1}d${match[2]}`;
}

/** Look through a flags object (a few levels deep) for a die formula. */
export function searchFlagsForDie(flags, depth = 0) {
  if (!flags || typeof flags !== "object" || depth > 3) return null;
  for (const value of Object.values(flags)) {
    const found = normalizeDie(value) ?? searchFlagsForDie(value, depth + 1);
    if (found) return found;
  }
  return null;
}

/** Find something like "d8" written in plain text. */
export function dieFromText(text) {
  if (typeof text !== "string") return null;
  return normalizeDie(text.match(DIE_IN_TEXT)?.[1]);
}

/**
 * Read a class scale value whose name contains `keyword`, such as the bard's
 * "inspiration" die. dnd5e stores these at actor.system.scale.<class>.<name>.
 */
export function dieFromScale(actor, keyword) {
  const scale = actor?.system?.scale;
  if (!scale) return null;
  for (const values of Object.values(scale)) {
    for (const [key, value] of Object.entries(values ?? {})) {
      if (!key.toLowerCase().includes(keyword)) continue;
      const formula = normalizeDie(value?.formula) ?? normalizeDie(value?.die);
      if (formula) return formula;
    }
  }
  return null;
}

/**
 * Last resort: ask the player which die to roll.
 * @param {string} title  Dialog title.
 * @param {string[]} dice Choices, like ["d6", "d8"].
 * @returns {Promise<string|null>} A formula like "1d8", or null if closed.
 */
export async function promptForDie(title, dice = ["d6", "d8", "d10", "d12"]) {
  const { DialogV2 } = foundry.applications.api;
  const choice = await DialogV2.wait({
    window: { title },
    content: `<p>${game.i18n.localize(`${I18N}.RollMods.PromptDie`)}</p>`,
    buttons: dice.map((die, i) => ({ action: die, label: die, default: i === 0 })),
    rejectClose: false
  });
  return normalizeDie(choice);
}
