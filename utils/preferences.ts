import { browser } from "wxt/browser";
import { DEFAULT_AGENT_KEYS, DEFAULT_JUDGE_KEY, isAppKey, normalizeAppKeys } from "./appRegistry";
import { DEFAULT_JUDGE_PROMPT_TEMPLATE_ID, JUDGE_PROMPT_TEMPLATES } from "./judgePromptTemplates";
import { DEFAULT_RELAY_JUDGE_PROMPT_TEMPLATE_ID, RELAY_JUDGE_PROMPT_TEMPLATES } from "./relayJudgePromptTemplates";
import { DEFAULT_RED_TEAM_JUDGE_PROMPT_TEMPLATE_ID, RED_TEAM_JUDGE_PROMPT_TEMPLATES } from "./redTeamJudgePromptTemplates";
import { DEFAULT_PROMPT_REFINER_JUDGE_PROMPT_TEMPLATE_ID, PROMPT_REFINER_JUDGE_PROMPT_TEMPLATES } from "./promptRefinerJudgePromptTemplates";
import type { AppKey, CouncilPreferences, CouncilType, RedTeamRole } from "./types";

const STORAGE_KEY = "aiCouncilPreferences";

export const DEFAULT_PREFERENCES: CouncilPreferences = {
  councilType: "agentJudge",
  selectedAgentKeys: DEFAULT_AGENT_KEYS,
  judgeKey: DEFAULT_JUDGE_KEY,
  judgePromptTemplateId: DEFAULT_JUDGE_PROMPT_TEMPLATE_ID,
  relayJudgePromptTemplateId: DEFAULT_RELAY_JUDGE_PROMPT_TEMPLATE_ID,
  redTeamRoles: {},
  redTeamJudgePromptTemplateId: DEFAULT_RED_TEAM_JUDGE_PROMPT_TEMPLATE_ID,
  promptRefinerJudgePromptTemplateId: DEFAULT_PROMPT_REFINER_JUDGE_PROMPT_TEMPLATE_ID
};

const VALID_RED_TEAM_ROLES: ReadonlySet<RedTeamRole> = new Set(["author", "attacker", "defender"]);

function normalizeCouncilType(value: unknown): CouncilType {
  if (value === "relay") return "relay";
  if (value === "redTeam") return "redTeam";
  if (value === "promptRefiner") return "promptRefiner";
  return "agentJudge";
}

function normalizeRedTeamRoles(value: unknown): Partial<Record<AppKey, RedTeamRole>> {
  if (!value || typeof value !== "object") return {};
  const result: Partial<Record<AppKey, RedTeamRole>> = {};
  for (const [key, role] of Object.entries(value as Record<string, unknown>)) {
    if (isAppKey(key) && typeof role === "string" && VALID_RED_TEAM_ROLES.has(role as RedTeamRole)) {
      result[key] = role as RedTeamRole;
    }
  }
  return result;
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
  const redTeamJudgePromptTemplateId = RED_TEAM_JUDGE_PROMPT_TEMPLATES.some((t) => t.id === saved.redTeamJudgePromptTemplateId)
    ? saved.redTeamJudgePromptTemplateId!
    : DEFAULT_RED_TEAM_JUDGE_PROMPT_TEMPLATE_ID;
  const promptRefinerJudgePromptTemplateId = PROMPT_REFINER_JUDGE_PROMPT_TEMPLATES.some((t) => t.id === saved.promptRefinerJudgePromptTemplateId)
    ? saved.promptRefinerJudgePromptTemplateId!
    : DEFAULT_PROMPT_REFINER_JUDGE_PROMPT_TEMPLATE_ID;

  const preferences: CouncilPreferences = {
    councilType: normalizeCouncilType(saved.councilType),
    selectedAgentKeys: selectedAgentKeys.length > 0 ? selectedAgentKeys : DEFAULT_AGENT_KEYS,
    judgeKey,
    judgePromptTemplateId,
    relayJudgePromptTemplateId,
    redTeamRoles: normalizeRedTeamRoles(saved.redTeamRoles),
    redTeamJudgePromptTemplateId,
    promptRefinerJudgePromptTemplateId
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
      : DEFAULT_RELAY_JUDGE_PROMPT_TEMPLATE_ID,
    redTeamRoles: normalizeRedTeamRoles(preferences.redTeamRoles),
    redTeamJudgePromptTemplateId: RED_TEAM_JUDGE_PROMPT_TEMPLATES.some((t) => t.id === preferences.redTeamJudgePromptTemplateId)
      ? preferences.redTeamJudgePromptTemplateId
      : DEFAULT_RED_TEAM_JUDGE_PROMPT_TEMPLATE_ID,
    promptRefinerJudgePromptTemplateId: PROMPT_REFINER_JUDGE_PROMPT_TEMPLATES.some((t) => t.id === preferences.promptRefinerJudgePromptTemplateId)
      ? preferences.promptRefinerJudgePromptTemplateId
      : DEFAULT_PROMPT_REFINER_JUDGE_PROMPT_TEMPLATE_ID
  };

  await browser.storage.sync.set({ [STORAGE_KEY]: safePreferences });
  return safePreferences;
}
