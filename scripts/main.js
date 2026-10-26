import { MODULE_ID } from "./constants.js";
import { registerSettings } from "./settings.js";
import { initBardicInspiration } from "./features/bardic-inspiration.js";

/**
 * Entry point. Foundry loads this file because it is listed under
 * "esmodules" in module.json.
 *
 * "init" runs once, early, before the world data finishes loading.
 * It is the right place to register settings and hook listeners.
 */
Hooks.once("init", () => {
  // Printing the version makes it easy to confirm in the console (F12)
  // that Foundry loaded the newest files and not a cached copy.
  console.log(`${MODULE_ID} | Initializing Crowley's QoL v${game.modules.get(MODULE_ID)?.version}`);
  registerSettings();

  // Every feature in this module is for dnd5e. If the world uses a
  // different system, do nothing at all.
  if (game.system.id !== "dnd5e") return;

  initBardicInspiration();
});
