# Crowley's QoL

Quality of life features for the D&D 5e system in Foundry VTT. These are the small things that feel like they should already be in Foundry.

## Requirements

- Foundry VTT v14
- dnd5e system 6.0.0 or newer, Tested in 6.0.5

## Features

### Bardic Inspiration button

When a player makes a d20 roll (attack, save, ability check, skill, tool) and their character has a Bardic Inspiration effect, the effect's image shows up on the left side of the roll total in chat. Click it and the module:

1. Rolls the Bardic Inspiration die
2. Adds it to that roll's total
3. Removes Bardic Inspiration from the actor

The die size comes from the bard who gave the inspiration when possible. If the module can't tell, it asks which die to roll.

**Settings**

- *Bardic Inspiration Button*: turn the feature on or off.
- *Bardic Inspiration Effect Names*: which effect names count. Defaults to `Bardic Inspiration, Inspired`.

## Installation

In Foundry's Setup screen, go to Add-on Modules, click Install Module, and paste this manifest URL:

```
https://github.com/Crow-ley/crowleys-qol/releases/latest/download/module.json
```

## License

MIT. See [LICENSE](LICENSE).
