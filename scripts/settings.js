import { MODULE_ID, I18N } from "./constants.js";

/**
 * Register every setting the module uses.
 * Called once from the "init" hook in main.js, which is the only place
 * Foundry allows settings to be registered.
 */
export function registerSettings() {
  game.settings.register(MODULE_ID, "bardicEnabled", {
    name: `${I18N}.Settings.BardicEnabled.Name`,
    hint: `${I18N}.Settings.BardicEnabled.Hint`,
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    requiresReload: true
  });

  game.settings.register(MODULE_ID, "bardicEffectNames", {
    name: `${I18N}.Settings.BardicEffectNames.Name`,
    hint: `${I18N}.Settings.BardicEffectNames.Hint`,
    scope: "world",
    config: true,
    type: String,
    default: "Bardic Inspiration, Inspired"
  });
}
