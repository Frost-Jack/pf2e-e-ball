import {
  MODULE_ID,
  RESOURCE_DEFAULT,
  RESOURCE_KEY,
  RESOURCE_MAX,
  RESOURCE_SLUG,
  clampResourceValue,
  resourceSnapshot
} from "./resource.js";

const ICON_PATH = `modules/${MODULE_ID}/assets/e-ball.svg`;
const PATCH_MARK = Symbol.for(`${MODULE_ID}.resource-patch`);
const CHAT_PATCH_MARK = Symbol.for(`${MODULE_ID}.chat-context-patch`);

function localize(key, data) {
  const path = `${MODULE_ID}.${key}`;
  return data ? game.i18n.format(path, data) : game.i18n.localize(path);
}

function rootElement(html) {
  if (html instanceof HTMLElement) return html;
  if (html?.[0] instanceof HTMLElement) return html[0];
  return null;
}

function characterForMessage(message) {
  const actor = message?.actor;
  const resourceActor = actor?.isOfType?.("familiar") ? actor.master : actor;
  return resourceActor?.isOfType?.("character") ? resourceActor : null;
}

function getValue(actor) {
  const stored = actor?.getFlag?.(MODULE_ID, "value");
  return clampResourceValue(stored ?? RESOURCE_DEFAULT, RESOURCE_MAX);
}

function getResource(actor) {
  if (!actor?.isOfType?.("character")) return null;
  return resourceSnapshot(getValue(actor), localize("Resource.Label"), RESOURCE_MAX);
}

async function setValue(actor, value, { render = true } = {}) {
  if (!actor?.isOfType?.("character")) return false;
  if (!actor.canUserModify(game.user, "update")) {
    ui.notifications.warn(localize("Notifications.CannotModify", { actor: actor.name }));
    return false;
  }

  const next = clampResourceValue(value, RESOURCE_MAX);
  if (next === getValue(actor)) return true;

  await actor.update({ [`flags.${MODULE_ID}.value`]: next }, { render });
  for (const party of actor.parties ?? []) party.sheet?.render(false);
  Hooks.callAll(`${MODULE_ID}.change`, actor, getResource(actor));
  return true;
}

async function adjustValue(actor, change) {
  return setValue(actor, getValue(actor) + change);
}

function attachSyntheticResource(actor) {
  if (!actor?.isOfType?.("character")) return;

  const resource = getResource(actor);
  actor.system.resources[RESOURCE_KEY] = { value: resource.value, max: resource.max };
  actor.synthetics.resources[RESOURCE_KEY] = {
    ...resource,
    itemUUID: null,
    update: (value, options = {}) => setValue(actor, value, options),
    renewUses: async () => ({ itemCreates: [], itemUpdates: [] })
  };
}

function installResourcePatch() {
  const CharacterPF2e = CONFIG.PF2E?.Actor?.documentClasses?.character;
  const prototype = CharacterPF2e?.prototype;
  if (!prototype || prototype[PATCH_MARK]) return false;

  const prepareBaseData = prototype.prepareBaseData;
  Object.defineProperty(prototype, "prepareBaseData", {
    configurable: true,
    value: function (...args) {
      const result = prepareBaseData.apply(this, args);
      attachSyntheticResource(this);
      return result;
    }
  });
  Object.defineProperty(prototype, PATCH_MARK, { value: true });
  return true;
}

function createPips(resource, { party = false } = {}) {
  const pips = document.createElement("span");
  pips.className = party ? "e-ball-pips party-pips" : "pips e-ball-pips";

  for (let index = 0; index < resource.max; index += 1) {
    const pip = document.createElement("span");
    pip.className = `e-ball-pip ${index < resource.value ? "filled" : "empty"}`;

    const icon = document.createElement("img");
    icon.src = ICON_PATH;
    icon.alt = "";
    pip.append(icon);
    pips.append(pip);
  }

  return pips;
}

function resourceTooltip(resource) {
  return localize("Resource.Tooltip", { value: resource.value, max: resource.max });
}

function bindResourceControls(element, actor) {
  if (!actor.canUserModify(game.user, "update")) {
    element.classList.add("readonly");
    return;
  }

  element.addEventListener("click", (event) => {
    event.preventDefault();
    void adjustValue(actor, 1);
  });
  element.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    void adjustValue(actor, -1);
  });
}

function renderCharacterSheet(app, html) {
  const actor = app.actor;
  const root = rootElement(html);
  if (!root || !actor?.isOfType?.("character")) return;

  const details = root.querySelector("header.char-header .char-details");
  if (!details || details.querySelector(".e-ball-resource")) return;

  const resource = getResource(actor);
  const element = document.createElement("div");
  element.className = "dots e-ball-resource";
  element.dataset.tooltip = resourceTooltip(resource);

  const label = document.createElement("span");
  label.className = "label";
  label.textContent = resource.label;
  element.append(label, createPips(resource));

  const heroPoints = details.querySelector(".dots");
  heroPoints ? heroPoints.insertAdjacentElement("afterend", element) : details.append(element);
  bindResourceControls(element, actor);
}

function renderPartySheet(_app, html) {
  const root = rootElement(html);
  if (!root) return;

  for (const member of root.querySelectorAll("[data-tab='overview'] .member[data-actor-uuid]")) {
    if (member.querySelector(".e-ball-party-resource")) continue;
    const actor = fromUuidSync(member.dataset.actorUuid ?? "");
    if (!actor?.isOfType?.("character")) continue;

    const header = member.querySelector(":scope > .data > header");
    if (!header) continue;

    const resource = getResource(actor);
    const element = document.createElement("a");
    element.className = "resource e-ball-party-resource";
    element.dataset.tooltip = `${actor.name}: ${resourceTooltip(resource)}`;
    element.setAttribute("aria-label", resource.label);
    element.append(createPips(resource, { party: true }));

    header.classList.add("e-ball-enabled");
    header.append(element);
    bindResourceControls(element, actor);
  }
}

function messageFromContextElement(element) {
  const messageElement = element?.closest?.("[data-message-id]") ?? element;
  return game.messages.get(messageElement?.dataset?.messageId ?? "");
}

function canRerollWithEBall(element) {
  const message = messageFromContextElement(element);
  const actor = characterForMessage(message);
  return Boolean(message?.isRerollable && (message.isAuthor || game.user.isGM) && actor && getValue(actor) > 0);
}

async function rerollFromMessage(message) {
  const actor = characterForMessage(message);
  if (!actor || getValue(actor) < 1) {
    ui.notifications.warn(localize("Notifications.NoResource"));
    return false;
  }

  await game.pf2e.Check.rerollFromMessage(message, { resource: RESOURCE_SLUG });
  return true;
}

function addChatContextOption(options) {
  if (!Array.isArray(options) || options.some((option) => option.eBall)) return options;

  const heroPointIndex = options.findIndex(
    (entry) => entry.name === "PF2E.RerollMenu.HeroPoint" || entry.label === "PF2E.RerollMenu.HeroPoint"
  );
  const usesV13ContextOptions = options.some(
    (entry) => "name" in entry && ("condition" in entry || "callback" in entry)
  );
  const option = usesV13ContextOptions
    ? {
        eBall: true,
        name: localize("Reroll.Menu"),
        icon: '<i class="e-ball-context-icon fa-fw"></i>',
        condition: canRerollWithEBall,
        callback: (element) => {
          const message = messageFromContextElement(element);
          return message ? rerollFromMessage(message) : undefined;
        }
      }
    : {
        eBall: true,
        label: localize("Reroll.Menu"),
        icon: "e-ball-context-icon",
        visible: canRerollWithEBall,
        onClick: (_event, element) => {
          const message = messageFromContextElement(element);
          return message ? rerollFromMessage(message) : undefined;
        }
      };
  options.splice(heroPointIndex >= 0 ? heroPointIndex + 1 : options.length, 0, option);
  return options;
}

function installChatContextOption() {
  const chat = ui.chat;
  if (!chat || chat[CHAT_PATCH_MARK] || typeof chat._getEntryContextOptions !== "function") return;

  const getOptions = chat._getEntryContextOptions;
  chat._getEntryContextOptions = function (...args) {
    return addChatContextOption(getOptions.apply(this, args));
  };
  Object.defineProperty(chat, CHAT_PATCH_MARK, { value: true });
}

function installRerollLocalization() {
  foundry.utils.setProperty(
    game.i18n.translations,
    "PF2E.RerollMenu.MessageEBall",
    localize("Reroll.Message")
  );
}

function restyleRerollIndicator(message, html) {
  const options = message.flags?.pf2e?.context?.options ?? [];
  if (!options.includes(`check:reroll:${RESOURCE_SLUG}`)) return;

  const root = rootElement(html);
  const indicator = root?.querySelector(".reroll-indicator");
  indicator?.classList.add("e-ball-reroll-indicator");
}

function applyWorkbenchHeroPointRules(oldRoll, newRoll, resource, keepOption) {
  if (resource?.slug !== RESOURCE_SLUG || !game.modules.get("xdy-pf2e-workbench")?.active) return;
  const keep = typeof keepOption === "object" ? (keepOption.keep ?? "new") : (keepOption ?? "new");
  if (keep !== "new") return;

  const settingKey = "xdy-pf2e-workbench.heroPointRules";
  if (!game.settings.settings.has(settingKey)) return;
  const rule = game.settings.get("xdy-pf2e-workbench", "heroPointRules");
  const die = newRoll.dice.find(
    (term) => term instanceof foundry.dice.terms.Die && term.number === 1 && term.faces === 20
  );
  const lowResult = die?.results.find((result) => result.active && result.result <= 10);

  if (die && lowResult && rule === "keeleysHeroPointRule") {
    newRoll.terms.push(
      foundry.dice.terms.OperatorTerm.fromData({ class: "OperatorTerm", operator: "+", evaluated: true }),
      foundry.dice.terms.NumericTerm.fromData({ class: "NumericTerm", number: 10, evaluated: true })
    );
    newRoll._total += 10;
    newRoll.options.keeleyAdd10 = true;
  } else if (die && lowResult && rule === "heroicRerolls") {
    const previous = lowResult.result;
    lowResult.result = 10;
    newRoll._total = newRoll._total - previous + 10;
    newRoll.options.heroicReroll = true;
  } else if (rule === "useHighestHeroPointRoll") {
    if (typeof keepOption === "object") {
      keepOption.keep = "higher";
      return;
    }

    const oldResult = oldRoll.dice
      .find((term) => term instanceof foundry.dice.terms.Die && term.number === 1 && term.faces === 20)
      ?.results.find((result) => result.active)?.result ?? 0;
    const newResult = die?.results.find((result) => result.active)?.result ?? 0;
    if (oldResult > newResult && die?.results.length) {
      die.results[0].result = oldResult;
      newRoll._total = oldRoll._total;
      newRoll.options.useHighestRoll = true;
    }
  }
}

function exposeApi() {
  const api = Object.freeze({
    id: MODULE_ID,
    resourceSlug: RESOURCE_SLUG,
    max: RESOURCE_MAX,
    get: getResource,
    set: setValue,
    add: adjustValue,
    spend: (actor) => (getValue(actor) > 0 ? adjustValue(actor, -1) : Promise.resolve(false)),
    rerollFromMessage
  });

  game.modules.get(MODULE_ID).api = api;
  game.pf2eEBall = api;
  Hooks.callAll(`${MODULE_ID}.ready`, api);
}

Hooks.once("init", () => {
  if (!installResourcePatch()) Hooks.once("setup", installResourcePatch);
  Hooks.on("renderCharacterSheetPF2e", renderCharacterSheet);
  Hooks.on("renderPartySheetPF2e", renderPartySheet);
  Hooks.on("renderChatMessage", restyleRerollIndicator);
  Hooks.on("pf2e.reroll", applyWorkbenchHeroPointRules);
  Hooks.on("preUpdateActor", (actor, changes) => {
    if (!actor.isOfType?.("character")) return;
    const path = `flags.${MODULE_ID}.value`;
    if (foundry.utils.hasProperty(changes, path)) {
      foundry.utils.setProperty(changes, path, clampResourceValue(foundry.utils.getProperty(changes, path)));
    }
  });
});

Hooks.on("getChatMessageContextOptions", (_chat, options) => addChatContextOption(options));

Hooks.once("ready", () => {
  const installedAtReady = installResourcePatch();
  if (installedAtReady) {
    for (const actor of game.actors.filter((actor) => actor.isOfType("character"))) actor.reset();
  }
  installRerollLocalization();
  installChatContextOption();
  exposeApi();
  console.log(`${MODULE_ID} | Ready`);
});
