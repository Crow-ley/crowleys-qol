import { MODULE_ID, I18N } from "../constants.js";
import { RSR_ID, isD20, usesRsrFlagRolls, getRolls, getUsedEntries, rulesVersion } from "./rolls.js";

/**
 * ROLL MODIFIER ENGINE
 *
 * Abilities that change a d20 roll after it lands in chat (Bardic
 * Inspiration, Tactical Mind, Portent, ...) all need the same things:
 * find the roll total on screen, show a button, handle the click, and
 * save the changed roll. This file does all of that once.
 *
 * Each ability is a small "modifier" object registered with
 * registerRollModifier(). It only has to answer two questions:
 *   findSource(actor, context)  "Can this actor use me on this roll?"
 *   use({ message, rollIndex, actor, source })  "Do it."
 *
 * Modifier fields:
 *   id          Unique name, also used to remember it was used.
 *   rules       Which dnd5e rules it supports: ["modern"], ["legacy"], or both.
 *   oncePerRoll true if it can only be used once on the same roll.
 *   enabled()   Optional. Return false to hide it (for example a setting is off).
 *   findSource(actor, context)
 *               Return { uuid, name, img } of the effect, item, or actor that
 *               grants the ability, or null if this actor can't use it here.
 *               context is { message, roll, rollIndex }.
 *   use({ message, rollIndex, actor, source })
 *               Do the work. source is the document from findSource's uuid.
 *   usedTooltip(entry)
 *               Optional. Text shown when hovering the "already used" marker.
 */

/** Every registered modifier, by id. */
const MODIFIERS = new Map();

/** CSS class on each clickable button. */
const BUTTON = "crowleys-qol-mod-button";

/** CSS class on the box that holds our buttons and markers. */
const BOX = "crowleys-qol-mods";

/**
 * Add an ability to the engine. Called from main.js during "init".
 * @param {object} modifier  See the field list at the top of this file.
 */
export function registerRollModifier(modifier) {
  MODIFIERS.set(modifier.id, modifier);
}

/**
 * Start listening for chat messages being drawn.
 * Called from main.js during "init", after every modifier is registered.
 */
export function initRollModifiers() {
  // Foundry's own hook, for any card dnd5e leaves alone after drawing.
  Hooks.on("renderChatMessageHTML", onRenderChatMessage);
  // dnd5e 6 rewrites many cards AFTER Foundry's hook runs, wiping anything
  // we added there. dnd5e's own hook fires once it has finished.
  Hooks.on("dnd5e.renderChatMessage", onRenderChatMessage);
  Hooks.once("ready", watchForRsrCards);
  listenForButtonClicks();
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
 * Decorate one RSR total.
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
  // to see it (dnd5e's "Attack Roll Visibility" setting).
  const hasHitIcon = !!totalElement.querySelector(".icons i");
  decorateTotal(totalElement, message, rollIndex, { shift: hasHitIcon });
}

/* -------------------------------------------- */
/*  Drawing the buttons                         */
/* -------------------------------------------- */

/**
 * Decide what to draw on a roll total: a faded marker for each modifier
 * already used, then a button for each modifier this user can still use.
 */
function decorateTotal(totalElement, message, rollIndex, { shift = false } = {}) {
  // Never draw twice on the same total.
  if (totalElement.querySelector(`.${BOX}`)) return;

  // Hidden rolls (blind GM rolls etc.) show "???" to players. Leave them alone.
  if (!message.isContentVisible) return;

  const used = getUsedEntries(message);
  const markers = used.map(entry => makeUsedMarker(entry));
  const buttons = findButtons(message, rollIndex, used);
  if (!markers.length && !buttons.length) return;

  const box = document.createElement("span");
  box.classList.add(BOX);
  if (shift) box.classList.add("crowleys-qol-shift");
  box.append(...markers, ...buttons);

  totalElement.classList.add("crowleys-qol-has-mods");
  totalElement.prepend(box);
}

/**
 * Build a button for every modifier the current user could use on this roll.
 * @returns {HTMLButtonElement[]}
 */
function findButtons(message, rollIndex, used) {
  // Only the people who own the roller should see buttons for their own roll.
  const actor = ChatMessage.getSpeakerActor(message.speaker);
  if (!actor?.isOwner) return [];

  // We have to edit the message to change its total. Players can only edit
  // messages they created, so skip messages this user isn't allowed to edit.
  if (!message.canUserModify(game.user, "update")) return [];

  const rules = rulesVersion();
  const roll = getRolls(message)[rollIndex];
  const context = { message, roll, rollIndex };
  const buttons = [];

  for (const modifier of MODIFIERS.values()) {
    if (modifier.rules && !modifier.rules.includes(rules)) continue;
    if (modifier.enabled && !modifier.enabled()) continue;
    if (modifier.oncePerRoll && used.some(entry => entry.id === modifier.id)) continue;

    let source = null;
    try {
      source = modifier.findSource(actor, context);
    } catch (err) {
      console.error(`${MODULE_ID} | ${modifier.id}: findSource failed`, err);
    }
    if (source) buttons.push(makeButton(modifier, message, rollIndex, source));
  }
  return buttons;
}

/** One clickable image button. */
function makeButton(modifier, message, rollIndex, source) {
  const label = source.label ?? source.name;

  const button = document.createElement("button");
  button.type = "button";
  button.classList.add(BUTTON);
  button.dataset.tooltip = label;
  button.setAttribute("aria-label", label);

  // Everything the click needs is written onto the button itself, because
  // dnd5e 6 can copy a card's HTML after we draw it, and a copy keeps
  // attributes but loses any click listener attached to the original.
  button.dataset.modifier = modifier.id;
  button.dataset.messageId = message.id;
  button.dataset.rollIndex = String(rollIndex);
  button.dataset.sourceUuid = source.uuid;

  const img = document.createElement("img");
  img.src = source.img;
  img.alt = "";
  button.append(img);
  return button;
}

/**
 * After a modifier has been used, show a faded copy of its image with what
 * it did (like "+5"), so the table can see what happened.
 */
function makeUsedMarker(entry) {
  const modifier = MODIFIERS.get(entry.id);
  const marker = document.createElement("span");
  marker.classList.add("crowleys-qol-mod-used");
  marker.dataset.tooltip = modifier?.usedTooltip?.(entry) ?? entry.name ?? "";

  const img = document.createElement("img");
  img.src = entry.img;
  img.alt = "";

  const text = document.createElement("span");
  text.textContent = entry.text ?? "";

  marker.append(img, text);
  return marker;
}

/* -------------------------------------------- */
/*  Clicks                                      */
/* -------------------------------------------- */

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
  // every one of our buttons on the page.
  const isOurs = event => {
    const direct = event.target instanceof Element && event.target.closest(`.${BUTTON}`);
    if (direct) return direct;

    for (const button of document.querySelectorAll(`.${BUTTON}`)) {
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

/** Handle a click on any modifier button. */
async function onButtonClick(button) {
  if (button.disabled) return;

  const modifier = MODIFIERS.get(button.dataset.modifier);
  const message = game.messages.get(button.dataset.messageId);
  const source = fromUuidSync(button.dataset.sourceUuid);
  const rollIndex = Number(button.dataset.rollIndex);
  const actor = message ? ChatMessage.getSpeakerActor(message.speaker) : null;

  // The ability may have been spent or removed since the button was drawn.
  if (!modifier || !message || !source || !actor) {
    button.remove();
    return;
  }

  button.disabled = true;
  try {
    await modifier.use({ message, rollIndex, actor, source });
  } catch (err) {
    console.error(`${MODULE_ID} | ${modifier.id} failed`, err);
    const name = source.name ?? modifier.id;
    ui.notifications.error(game.i18n.format(`${I18N}.RollMods.Error`, { name }));
    button.disabled = false;
  }
}
