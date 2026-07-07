import { browser } from "wxt/browser";
import { DEFAULT_AGENT_KEYS, DEFAULT_JUDGE_KEY, isAppKey, normalizeAppKeys } from "./appRegistry";
import { DEFAULT_JUDGE_PROMPT_TEMPLATE_ID, JUDGE_PROMPT_TEMPLATES } from "./judgePromptTemplates";
import { DEFAULT_RELAY_JUDGE_PROMPT_TEMPLATE_ID, RELAY_JUDGE_PROMPT_TEMPLATES } from "./relayJudgePromptTemplates";
import type { CouncilPreferences, CouncilType } from "./types";

const STORAGE_KEY = "aiCouncilPreferences";

export const DEFAULT_PREFERENCES: CouncilPreferences = {
  councilType: "agentJudge",
  selectedAgentKeys: DEFAULT_AGENT_KEYS,
  judgeKey: DEFAULT_JUDGE_KEY,
  judgePromptTemplateId: DEFAULT_JUDGE_PROMPT_TEMPLATE_ID,
  relayJudgePromptTemplateId: DEFAULT_RELAY_JUDGE_PROMPT_TEMPLATE_ID
};

function normalizeCouncilType(value: unknown): CouncilType {
  return value === "relay" ? "relay" : "agentJudge";
}

export async function getPreferences(): Promise<CouncilPreferences> {
  const result = await browser.storage.sync.get(STORAGE_KEY);
  const saved = result[STORAGE_KEY] as Partial<CouncilPreferences> | undefined;

  if (!saved) {
    await savePreferences(DEFAULT_PREFERENCES);
    return DEFAULT_PREFERENCES;
  }

  const selectedAgentKeys = normalizeAppKeys(saved.selectedAgentKeys ?? []);
  const judgeKey = saved.judgeKey && isAppKey(saved.judgeKey) ? saved.judgeKey : DEFAULT_JUDGE_KEY;
  const judgePromptTemplateId = JUDGE_PROMPT_TEMPLATES.some((t) => t.id === saved.judgePromptTemplateId)
    ? saved.judgePromptTemplateId!
    : DEFAULT_JUDGE_PROMPT_TEMPLATE_ID;
  const relayJudgePromptTemplateId = RELAY_JUDGE_PROMPT_TEMPLATES.some((t) => t.id === saved.relayJudgePromptTemplateId)
    ? saved.relayJudgePromptTemplateId!
    : DEFAULT_RELAY_JUDGE_PROMPT_TEMPLATE_ID;

  const preferences: CouncilPreferences = {
    councilType: normalizeCouncilType(saved.councilType),
    selectedAgentKeys: selectedAgentKeys.length > 0 ? selectedAgentKeys : DEFAULT_AGENT_KEYS,
    judgeKey,
    judgePromptTemplateId,
    relayJudgePromptTemplateId
  };

  await savePreferences(preferences);
  return preferences;
}

export async function savePreferences(preferences: CouncilPreferences): Promise<CouncilPreferences> {
  const selectedAgentKeys = normalizeAppKeys(preferences.selectedAgentKeys);
  const safePreferences: CouncilPreferences = {
    councilType: normalizeCouncilType(preferences.councilType),
    selectedAgentKeys: selectedAgentKeys.length > 0 ? selectedAgentKeys : DEFAULT_AGENT_KEYS,
    judgeKey: isAppKey(preferences.judgeKey) ? preferences.judgeKey : DEFAULT_JUDGE_KEY,
    judgePromptTemplateId: JUDGE_PROMPT_TEMPLATES.some((t) => t.id === preferences.judgePromptTemplateId)
      ? preferences.judgePromptTemplateId
      : DEFAULT_JUDGE_PROMPT_TEMPLATE_ID,
    relayJudgePromptTemplateId: RELAY_JUDGE_PROMPT_TEMPLATES.some((t) => t.id === preferences.relayJudgePromptTemplateId)
      ? preferences.relayJudgePromptTemplateId
      : DEFAULT_RELAY_JUDGE_PROMPT_TEMPLATE_ID
  };

  await browser.storage.sync.set({ [STORAGE_KEY]: safePreferences });
  return safePreferences;
}
