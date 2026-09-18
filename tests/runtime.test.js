import assert from "node:assert/strict";
import test from "node:test";

const onceHooks = new Map();
const regularHooks = new Map();

globalThis.HTMLElement = class {};
globalThis.Hooks = {
  once(name, callback) {
    onceHooks.set(name, callback);
  },
  on(name, callback) {
    regularHooks.set(name, callback);
  },
  callAll() {}
};
globalThis.foundry = {
  utils: {
    getProperty(object, path) {
      return path.split(".").reduce((value, key) => value?.[key], object);
    },
    hasProperty(object, path) {
      return this.getProperty(object, path) !== undefined;
    },
    setProperty(object, path, value) {
      const keys = path.split(".");
      const last = keys.pop();
      const target = keys.reduce((entry, key) => (entry[key] ??= {}), object);
      target[last] = value;
    }
  },
  dice: {
    terms: {
      Die: class Die {},
      OperatorTerm: { fromData: (data) => data },
      NumericTerm: { fromData: (data) => data }
    }
  }
};
globalThis.ui = { notifications: { warn() {} } };

class MockCharacter {
  constructor(value) {
    this.flags = { "pf2e-e-ball": { value } };
    this.parties = [];
  }

  prepareBaseData() {
    this.system = { resources: {} };
    this.synthetics = { resources: {} };
  }

  isOfType(type) {
    return type === "character";
  }

  getFlag(scope, key) {
    return this.flags[scope]?.[key];
  }

  canUserModify() {
    return true;
  }

  async update(changes) {
    this.flags["pf2e-e-ball"].value = changes["flags.pf2e-e-ball.value"];
  }

  getResource(resource) {
    return resource === "e-ball" ? this.synthetics.resources.eBall : null;
  }

  async updateResource(resource, value) {
    return this.getResource(resource)?.update(value);
  }
}

globalThis.CONFIG = { PF2E: { Actor: { documentClasses: { character: MockCharacter } } } };
const messages = new Map();
const rerollCalls = [];
let actorFilterCalls = 0;
globalThis.game = {
  actors: {
    filter() {
      actorFilterCalls += 1;
      return [];
    }
  },
  i18n: {
    format: (key) => key,
    localize: (key) => key,
    translations: {}
  },
  modules: new Map([
    ["pf2e-e-ball", {}],
    ["xdy-pf2e-workbench", { active: false }]
  ]),
  messages,
  pf2e: {
    Check: {
      async rerollFromMessage(message, options) {
        rerollCalls.push({ message, options });
        const resource = message.actor.getResource(options.resource);
        await message.actor.updateResource(resource.slug, resource.value - 1);
      }
    }
  },
  settings: { settings: new Map() },
  user: {}
};

globalThis.ui.chat = {
  _getEntryContextOptions() {
    return [
      {
        name: "PF2E.RerollMenu.HeroPoint",
        icon: '<i class="fa-solid fa-hospital-symbol"></i>',
        condition: () => true,
        callback: () => undefined
      }
    ];
  }
};

await import(`../src/main.js?runtime-test=${Date.now()}`);
await onceHooks.get("init")();
const cachedContextOptions = ui.chat._getEntryContextOptions();
regularHooks.get("getChatMessageContextOptions")(ui.chat, cachedContextOptions);
await onceHooks.get("ready")();

test("the PF2e character preparation patch installs an E-Ball synthetic resource", async () => {
  const actor = new MockCharacter(1);
  actor.prepareBaseData();

  assert.deepEqual(actor.system.resources.eBall, { value: 1, max: 1 });
  assert.equal(actor.synthetics.resources.eBall.slug, "e-ball");
  assert.equal(actor.synthetics.resources.eBall.value, 1);

  await actor.synthetics.resources.eBall.update(0);
  assert.equal(actor.flags["pf2e-e-ball"].value, 0);
  await actor.synthetics.resources.eBall.update(9);
  assert.equal(actor.flags["pf2e-e-ball"].value, 1);
});

test("the module registers the sheet and reroll integration hooks", () => {
  assert.equal(typeof regularHooks.get("renderCharacterSheetPF2e"), "function");
  assert.equal(typeof regularHooks.get("renderPartySheetPF2e"), "function");
  assert.equal(typeof regularHooks.get("getChatMessageContextOptions"), "function");
  assert.equal(typeof regularHooks.get("pf2e.reroll"), "function");
});

test("ready does not reset every character when the resource patch is already installed", () => {
  assert.equal(actorFilterCalls, 0);
});

test("the Foundry v13 chat hook adds the E-Ball before the menu is cached", async () => {
  const actor = new MockCharacter(1);
  actor.prepareBaseData();
  const message = { actor, isAuthor: true, isRerollable: true };
  messages.set("message-id", message);

  const eBallOption = cachedContextOptions.at(1);
  const element = { dataset: { messageId: "message-id" }, closest: () => null };

  assert.equal(eBallOption.name, "pf2e-e-ball.Reroll.Menu");
  assert.match(eBallOption.icon, /^<i class="e-ball-context-icon fa-fw"><\/i>$/);
  assert.equal(eBallOption.condition(element), true);

  await eBallOption.callback(element);

  assert.deepEqual(rerollCalls.at(-1), { message, options: { resource: "e-ball" } });
  assert.equal(actor.flags["pf2e-e-ball"].value, 0);
  assert.equal(eBallOption.condition(element), false);
});

test("the Workbench keep-highest rule uses the old d20 result on Foundry v13", () => {
  game.modules.get("xdy-pf2e-workbench").active = true;
  game.settings.settings.set("xdy-pf2e-workbench.heroPointRules", {});
  game.settings.get = () => "useHighestHeroPointRoll";

  const oldDie = new foundry.dice.terms.Die();
  oldDie.number = 1;
  oldDie.faces = 20;
  oldDie.results = [{ active: true, result: 17 }];
  const newDie = new foundry.dice.terms.Die();
  newDie.number = 1;
  newDie.faces = 20;
  newDie.results = [{ active: true, result: 4 }];
  const oldRoll = { dice: [oldDie], _total: 23 };
  const newRoll = { dice: [newDie], _total: 10, options: {} };

  regularHooks.get("pf2e.reroll")(oldRoll, newRoll, { slug: "e-ball" }, "new");

  assert.equal(newDie.results[0].result, 17);
  assert.equal(newRoll._total, 23);
  assert.equal(newRoll.options.useHighestRoll, true);
});
