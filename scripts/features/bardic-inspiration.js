import { MODULE_ID, I18N } from "../constants.js";

/**
 * BARDIC INSPIRATION
 *
 * When a player makes a d20 roll in chat (attack, save, ability check,
 * skill, tool) and their actor has a Bardic Inspiration effect, a small
 * button with the effect's image appears on the roll total.
 *
 * Clicking it:
 *   1. Works out which die to roll (d6, d8, d10, d12).
 *   2. Rolls it (shows Dice So Nice dice if that module is active).
 *   3. Adds the die to the original roll, so the chat total updates.
 *   4. Marks the message so the button can't be used twice.
 *   5. Deletes the Bardic Inspiration effect from the actor.
 *
 * Works with plain dnd5e chat cards and with Ready Set Roll Reforged
 * (module id "rsreforged"), which draws its own attack and check cards.
 */

/** Ready Set Roll Reforged's module id. */
const RSR_ID = "rsreforged";

/** Matches a die formula like "d8" or "1d8". */
const DIE_ONLY = /^\s*(\d*)d(4|6|8|10|12)\s*$/i;

/** Finds a die formula inside longer text, like "Roll a d8 and add it". */
const DIE_IN_TEXT = /\b(\d*d(?:4|6|8|10|12))\b/i;

/**
 * Start listening for chat messages being drawn.
 * Called from main.js during "init".
 */
export function initBardicInspiration() {
  if (!game.settings.get(MODULE_ID, "bardicEnabled")) return;
  // Foundry's own hook, for any card dnd5e leaves alone after drawing.
  Hooks.on("renderChatMessageHTML", onRenderChatMessage);
  // dnd5e 6 rewrites many cards AFTER Foundry's hook runs, wiping anything
  // we added there. dnd5e's own hook fires once it has finished.
  Hooks.on("dnd5e.renderChatMessage", onRenderChatMessage);
  Hooks.once("ready", watchForRsrCards);
  listenForButtonClicks();
}

/* -------------------------------------------- */
/*  Where the rolls live                        */
/* -------------------------------------------- */

/** Is this one of dnd5e's d20 rolls? */
function isD20(roll) {
  const D20Roll = CONFIG.Dice.D20Roll ?? globalThis.dnd5e?.dice?.D20Roll;
  return !!D20Roll && roll instanceof D20Roll;
}

/**
 * On older RSR card layouts, RSR keeps the real rolls in
 * flags.rsreforged.rolls instead of message.rolls. On dnd5e 6 cards it
 * uses message.rolls like everyone else. This tells the two apart.
 */
function usesRsrFlagRolls(message) {
  if (message.rolls?.some(isD20)) return false;
  return Array.isArray(message.flags?.[RSR_ID]?.rolls);
}

/** Get the message's rolls from wherever they are stored. */
function getRolls(message) {
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

/* -------------------------------------------- */
/*  Finding the roll total on screen            */
/* -------------------------------------------- */

/**
 * Plain dnd5e cards. Runs every time Foundry draws a chat message.
 *
 * @param {ChatMessage} message  The chat message document.
 * @param {HTMLElement} html     The message's HTML element.
 */
function onRenderChatMessage(message, html) {
  // Some hooks hand over jQuery instead of a plain element. Unwrap it.
  const element = html instanceof HTMLElement ? html : html?.[0];
  if (!element) return;

  // dnd5e 6 item cards: an attack is its own hidden "attack" message, and
  // the item card shows a summary row of it. Each summary row carries that
  // attack message's id, so decorate it using that message.
  for (const summary of element.querySelectorAll(".card-summary[data-message-id]")) {
    const source = game.messages.get(summary.dataset.messageId);
    if (source) decorateRollIn(summary, source);
  }

  // RSR cards are handled by watchForRsrCards instead.
  if (usesRsrFlagRolls(message)) return;

  // A standalone roll card (saves, checks, or attacks shown on their own).
  decorateRollIn(element, message);
}

/**
 * Find the d20 roll of `message` inside `container` and decorate its total.
 */
function decorateRollIn(container, message) {
  const rollIndex = getRolls(message).findIndex(isD20);
  if (rollIndex === -1) return;

  // dnd5e draws each roll as its own ".dice-roll" block, in the same order
  // as message.rolls. A summary row may only show one, so fall back to it.
  const rollElements = container.querySelectorAll(".dice-roll");
  const rollElement = rollElements[rollIndex] ?? rollElements[0];
  if (!rollElement) return;
  const totalElement = rollElement.querySelector(".dice-total") ?? rollElement;

  // dnd5e 6 shows the hit/miss mark on the left of the roll row for people
  // allowed to see it. Make room for it only when it's there.
  const hasHitIcon = !!rollElement.querySelector(".icons i, .icons dnd5e-icon");
  decorateTotal(totalElement, message, rollIndex, { shift: hasHitIcon });
}

/**
 * RSR cards. RSR builds its attack and check sections after Foundry's
 * render hooks have already finished, so a render hook never sees them.
 * Instead we watch the page for RSR's ".rsr-multiroll" totals being added.
 */
function watchForRsrCards() {
  if (!game.modules.get(RSR_ID)?.active) return;

  const scan = node => {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    if (node.matches(".rsr-multiroll")) decorateRsrTotal(node);
    for (const found of node.querySelectorAll(".rsr-multiroll")) decorateRsrTotal(found);
  };

  const observer = new MutationObserver(records => {
    for (const record of records) record.addedNodes.forEach(scan);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Catch anything already on screen.
  scan(document.body);
}

/**
 * Add our button to one RSR total.
 * @param {HTMLElement} multiroll  RSR's ".rsr-multiroll" element.
 */
function decorateRsrTotal(multiroll) {
  // RSR sections carry the id of the message that owns the roll.
  // On dnd5e 6 that is the separate attack/check message, not the item card.
  const host = multiroll.closest("[data-rsr-message-id], [data-message-id]");
  const id = host?.dataset.rsrMessageId ?? host?.dataset.messageId;
  const message = game.messages.get(id);
  if (!message) return;

  const rollIndex = getRolls(message).findIndex(isD20);
  if (rollIndex === -1) return;

  // With advantage RSR shows both d20s; the one that doesn't count is ".ignored".
  const totalElement = multiroll.querySelector(".dice-total:not(.ignored)")
    ?? multiroll.querySelector(".dice-total");
  if (!totalElement) return;

  // RSR puts the hit/miss icon on the left edge, but only for people allowed
  // to see it (dnd5e's "Attack Roll Visibility" setting). Only make room for
  // the icon when it's actually there.
  const hasHitIcon = !!totalElement.querySelector(".icons i");
  decorateTotal(totalElement, message, rollIndex, { shift: hasHitIcon });
}

/* -------------------------------------------- */
/*  Drawing the button                          */
/* -------------------------------------------- */

/**
 * Decide what (if anything) to draw on a roll total.
 */
function decorateTotal(totalElement, message, rollIndex, { shift = false } = {}) {
  // Never draw twice on the same total.
  if (totalElement.querySelector(".crowleys-qol-bardic-button, .crowleys-qol-bardic-used")) return;

  // Hidden rolls (blind GM rolls etc.) show "???" to players. Leave them alone.
  if (!message.isContentVisible) return;

  // Already used on this message? Show a faded marker for everyone and stop.
  const used = message.getFlag(MODULE_ID, "bardicInspiration");
  if (used) {
    addUsedMarker(totalElement, used, shift);
    return;
  }

  // Only the people who could actually spend the die should see the button.
  const actor = ChatMessage.getSpeakerActor(message.speaker);
  if (!actor?.isOwner) return;

  // We have to edit the message to change its total. Players can only edit
  // messages they created, so skip messages this user isn't allowed to edit.
  if (!message.canUserModify(game.user, "update")) return;

  const effect = findInspirationEffect(actor);
  if (!effect) return;

  addUseButton(totalElement, message, rollIndex, effect, shift);
}

/**
 * Look through the actor's active effects for one whose name matches
 * the names in the module setting (case does not matter).
 * @returns {ActiveEffect|undefined}
 */
function findInspirationEffect(actor) {
  const names = game.settings.get(MODULE_ID, "bardicEffectNames")
    .split(",")
    .map(name => name.trim().toLowerCase())
    .filter(Boolean);

  // appliedEffects only contains effects that are on and not suppressed,
  // including ones coming from the actor's items.
  return actor.appliedEffects.find(effect => names.includes(effect.name.toLowerCase()));
}

/**
 * Put the clickable image on the roll total.
 */
function addUseButton(totalElement, message, rollIndex, effect, shift) {
  const label = game.i18n.format(`${I18N}.BardicInspiration.Use`, { name: effect.name });

  const button = document.createElement("button");
  button.type = "button";
  button.classList.add("crowleys-qol-bardic-button");
  if (shift) button.classList.add("crowleys-qol-shift");
  button.dataset.tooltip = label;
  button.setAttribute("aria-label", label);

  // Everything the click needs is written onto the button itself, because
  // dnd5e 6 can copy a card's HTML after we draw it, and a copy keeps
  // attributes but loses any click listener attached to the original.
  button.dataset.messageId = message.id;
  button.dataset.rollIndex = String(rollIndex);
  button.dataset.effectUuid = effect.uuid;

  const img = document.createElement("img");
  img.src = effect.img;
  img.alt = "";
  button.append(img);

  totalElement.classList.add("crowleys-qol-has-bardic");
  totalElement.prepend(button);
}

/**
 * One listener for the whole page, added once at startup.
 *
 * It listens in the "capture" phase on window, which runs before any
 * listener on the chat card itself. That's how we beat dnd5e's own
 * "click the total to open the breakdown" handler to the click.
 */
function listenForButtonClicks() {
  // The browser normally reports the clicked element as event.target. But on
  // dnd5e 6's compact roll row, another element can sit on top of our button
  // or swallow mouse events for everything inside it, so event.target ends
  // up being the row. So we also check the click's screen position against
  // every Bardic Inspiration button on the page.
  const isOurs = event => {
    const direct = event.target instanceof Element
      && event.target.closest(".crowleys-qol-bardic-button");
    if (direct) return direct;

    for (const button of document.querySelectorAll(".crowleys-qol-bardic-button")) {
      const box = button.getBoundingClientRect();
      if (!box.width || !box.height) continue; // hidden copy
      if (event.clientX >= box.left && event.clientX <= box.right
        && event.clientY >= box.top && event.clientY <= box.bottom) return button;
    }
    return null;
  };

  // Swallow the press itself too, in case anything reacts to it.
  for (const type of ["pointerdown", "mousedown"]) {
    window.addEventListener(type, event => {
      if (isOurs(event)) event.stopPropagation();
    }, true);
  }

  window.addEventListener("click", event => {
    const button = isOurs(event);
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    onButtonClick(button);
  }, true);
}

/** Handle a click on any Bardic Inspiration button. */
async function onButtonClick(button) {
  if (button.disabled) return;

  const message = game.messages.get(button.dataset.messageId);
  const effect = fromUuidSync(button.dataset.effectUuid);
  const rollIndex = Number(button.dataset.rollIndex);

  // The effect may have been removed since the button was drawn.
  if (!message || !effect) {
    button.remove();
    return;
  }

  button.disabled = true;
  try {
    await useBardicInspiration(message, rollIndex, effect);
  } catch (err) {
    console.error(`${MODULE_ID} | Bardic Inspiration failed`, err);
    ui.notifications.error(game.i18n.localize(`${I18N}.BardicInspiration.Error`));
    button.disabled = false;
  }
}

/**
 * After the die has been spent, show a faded copy of the image with the
 * amount that was added, so the table can see what happened.
 */
function addUsedMarker(totalElement, data, shift) {
  const marker = document.createElement("span");
  marker.classList.add("crowleys-qol-bardic-used");
  if (shift) marker.classList.add("crowleys-qol-shift");
  marker.dataset.tooltip = game.i18n.format(`${I18N}.BardicInspiration.Used`, {
    name: data.name,
    formula: data.formula,
    result: data.result
  });

  const img = document.createElement("img");
  img.src = data.img;
  img.alt = "";

  const text = document.createElement("span");
  text.textContent = `+${data.result}`;

  marker.append(img, text);
  totalElement.classList.add("crowleys-qol-has-bardic");
  totalElement.prepend(marker);
}

/* -------------------------------------------- */
/*  Spending the die                            */
/* -------------------------------------------- */

/**
 * Roll the inspiration die, add it to the chat roll, and remove the effect.
 */
async function useBardicInspiration(message, rollIndex, effect) {
  const actor = effect.parent instanceof Actor ? effect.parent : effect.parent?.actor;
  const formula = await resolveDieFormula(effect, actor);
  if (!formula) return; // The player closed the "which die?" prompt.

  // 1. Roll the die on its own.
  const bonus = await new Roll(formula).evaluate();
  for (const term of bonus.terms) {
    term.options.flavor ??= game.i18n.localize(`${I18N}.BardicInspiration.Flavor`);
  }
  if (game.dice3d) await game.dice3d.showForRoll(bonus, game.user, true);

  // 2. Build a new roll: the old roll's pieces + "+" + the die.
  //    Using the old roll's own class (D20Roll) and options keeps the
  //    success/failure colouring, advantage info, crit ranges, etc.
  //    This is the same pattern RSR uses for its own "Add Bonus" button.
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

  // 3. Save it onto the message, wherever that message keeps its rolls.
  //    Every connected client redraws the message, and the flag tells our
  //    code to show the "used" marker instead of the button.
  const serialized = rolls.map(roll => roll.toJSON());
  const update = {
    [`flags.${MODULE_ID}.bardicInspiration`]: {
      formula,
      result: bonus.total,
      img: effect.img,
      name: effect.name
    }
  };
  if (usesRsrFlagRolls(message)) update[`flags.${RSR_ID}.rolls`] = serialized;
  else update.rolls = serialized;
  await message.update(update);

  // 4. The die is spent. Remove the effect from the actor.
  await effect.delete();
}

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
  return normalize(effect.getFlag(MODULE_ID, "die"))
    ?? searchFlagsForDie(effect.flags)
    ?? dieFromOrigin(effect, actor)
    ?? dieFromText(effect.description)
    ?? dieFromText(effect.name)
    ?? promptForDie();
}

/** Turn "d8" or "1d8" into "1d8". Anything else becomes null. */
function normalize(value) {
  if (typeof value !== "string") return null;
  const match = value.match(DIE_ONLY);
  if (!match) return null;
  return `${match[1] || 1}d${match[2]}`;
}

/** Look through a flags object (a few levels deep) for a die formula. */
function searchFlagsForDie(flags, depth = 0) {
  if (!flags || typeof flags !== "object" || depth > 3) return null;
  for (const value of Object.values(flags)) {
    const found = normalize(value) ?? searchFlagsForDie(value, depth + 1);
    if (found) return found;
  }
  return null;
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
    const formula = inspirationScale(bard);
    if (formula) return formula;
  }
  return null;
}

/** Read actor.system.scale.<class>.<anything with "inspiration"> */
function inspirationScale(actor) {
  const scale = actor?.system?.scale;
  if (!scale) return null;
  for (const values of Object.values(scale)) {
    for (const [key, value] of Object.entries(values ?? {})) {
      if (!key.toLowerCase().includes("inspiration")) continue;
      const formula = normalize(value?.formula) ?? normalize(value?.die);
      if (formula) return formula;
    }
  }
  return null;
}

/** Find something like "d8" written in plain text. */
function dieFromText(text) {
  if (typeof text !== "string") return null;
  return normalize(text.match(DIE_IN_TEXT)?.[1]);
}

/** Last resort: ask the player which die to roll. */
async function promptForDie() {
  const { DialogV2 } = foundry.applications.api;
  const choice = await DialogV2.wait({
    window: { title: game.i18n.localize(`${I18N}.BardicInspiration.PromptTitle`) },
    content: `<p>${game.i18n.localize(`${I18N}.BardicInspiration.PromptContent`)}</p>`,
    buttons: ["d6", "d8", "d10", "d12"].map((die, i) => ({
      action: die,
      label: die,
      default: i === 0
    })),
    rejectClose: false
  });
  return normalize(choice);
}
