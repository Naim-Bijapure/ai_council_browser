import chatgptSelectors from "../../config/selectors/chatgpt.json" with { type: "json" };
import deepseekSelectors from "../../config/selectors/deepseek.json" with { type: "json" };
import claudeSelectors from "../../config/selectors/claude.json" with { type: "json" };
import geminiSelectors from "../../config/selectors/gemini.json" with { type: "json" };
import qwenSelectors from "../../config/selectors/qwen.json" with { type: "json" };
import kimiSelectors from "../../config/selectors/kimi.json" with { type: "json" };
import type { SelectorConfig, SelectorGroup } from "./types";
import type { AppKey } from "../types";

const SELECTOR_CONFIGS: Partial<Record<AppKey, SelectorConfig>> = {
  chatgpt: chatgptSelectors as SelectorConfig,
  deepseek: deepseekSelectors as SelectorConfig,
  claude: claudeSelectors as SelectorConfig,
  gemini: geminiSelectors as SelectorConfig,
  qwen: qwenSelectors as SelectorConfig,
  kimi: kimiSelectors as SelectorConfig
};

const REQUIRED_GROUPS: (keyof SelectorGroup)[] = ["input", "send", "response"];

const PSEUDO_SELECTOR_PATTERNS = [":has-text(", ":has(", ":text="];

export function loadSelectorConfig(appKey: AppKey): SelectorConfig {
  const config = SELECTOR_CONFIGS[appKey];

  if (!config) {
    throw new Error(`No selector config found for ${appKey}`);
  }

  validateSelectorConfig(config, appKey);
  return config;
}

export function validateSelectorConfig(config: SelectorConfig, appKey: AppKey): void {
  if (!config.appKey || config.appKey !== appKey) {
    throw new Error(
      `Selector config appKey mismatch: expected ${appKey}, got ${config.appKey ?? "<missing>"}`
    );
  }

  if (!config.selectors || typeof config.selectors !== "object") {
    throw new Error(`Selector config for ${appKey} is missing the 'selectors' object`);
  }

  const missingGroups = REQUIRED_GROUPS.filter((group) => {
    const value = config.selectors[group];
    return !Array.isArray(value) || value.length === 0;
  });

  if (missingGroups.length > 0) {
    throw new Error(
      `Selector config for ${appKey} is missing required selector groups: ${missingGroups.join(", ")}`
    );
  }

  for (const group of REQUIRED_GROUPS) {
    validateSelectorArray(config.selectors[group] as string[], appKey, group);
  }

  for (const optionalGroup of ["completion", "blocked", "loginError"] as const) {
    const value = config.selectors[optionalGroup];
    if (Array.isArray(value)) {
      validateSelectorArray(value, appKey, optionalGroup);
    }
  }
}

function validateSelectorArray(
  selectors: string[],
  appKey: AppKey,
  group: keyof SelectorGroup
): void {
  selectors.forEach((selector, index) => {
    if (typeof selector !== "string" || selector.trim().length === 0) {
      throw new Error(
        `Selector config for ${appKey} group '${group}' contains an empty or non-string entry at index ${index}`
      );
    }

    const pseudoMatch = PSEUDO_SELECTOR_PATTERNS.find((pattern) => selector.includes(pattern));
    if (pseudoMatch) {
      throw new Error(
        `Selector config for ${appKey} group '${group}' entry at index ${index} uses non-native CSS pseudo-selector '${pseudoMatch}...'. Only selectors valid for document.querySelector are allowed.`
      );
    }
  });
}

export function getEmptySelectorGroup(): SelectorGroup {
  return {
    input: [],
    send: [],
    response: [],
    completion: [],
    blocked: [],
    loginError: []
  };
}
