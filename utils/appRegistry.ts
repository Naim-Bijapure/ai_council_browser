import type { AppKey, SupportedApp } from "./types";

export const SUPPORTED_APPS: SupportedApp[] = [
  {
    key: "chatgpt",
    displayName: "ChatGPT",
    domain: "chat.openai.com",
    matchPatterns: ["https://chat.openai.com/*", "https://chatgpt.com/*"],
    newChatUrl: "https://chat.openai.com/"
  },
  {
    key: "claude",
    displayName: "Claude",
    domain: "claude.ai",
    matchPatterns: ["https://claude.ai/*"],
    newChatUrl: "https://claude.ai/new"
  },
  {
    key: "gemini",
    displayName: "Gemini",
    domain: "gemini.google.com",
    matchPatterns: ["https://gemini.google.com/*"],
    newChatUrl: "https://gemini.google.com/app"
  },
  {
    key: "deepseek",
    displayName: "DeepSeek",
    domain: "chat.deepseek.com",
    matchPatterns: ["https://chat.deepseek.com/*"],
    newChatUrl: "https://chat.deepseek.com/"
  },
  {
    key: "qwen",
    displayName: "Qwen",
    domain: "chat.qwen.ai",
    matchPatterns: ["https://chat.qwen.ai/*"],
    newChatUrl: "https://chat.qwen.ai/"
  },
  {
    key: "kimi",
    displayName: "Kimi",
    domain: "kimi.moonshot.cn",
    matchPatterns: ["https://kimi.moonshot.cn/*"],
    newChatUrl: "https://kimi.moonshot.cn/"
  }
];

export const DEFAULT_AGENT_KEYS: AppKey[] = SUPPORTED_APPS.map((app) => app.key);
export const DEFAULT_JUDGE_KEY: AppKey = "chatgpt";

export function getSupportedApp(key: AppKey): SupportedApp {
  const app = SUPPORTED_APPS.find((candidate) => candidate.key === key);

  if (!app) {
    throw new Error(`Unknown app key: ${key}`);
  }

  return app;
}

export function isAppKey(value: string): value is AppKey {
  return SUPPORTED_APPS.some((app) => app.key === value);
}

export function normalizeAppKeys(keys: string[]): AppKey[] {
  const unique = new Set<AppKey>();

  keys.forEach((key) => {
    if (isAppKey(key)) {
      unique.add(key);
    }
  });

  return [...unique];
}
