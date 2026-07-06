import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "wxt";

export default defineConfig({
  manifestVersion: 3,
  modules: ["@wxt-dev/module-react"],
  vite: () => ({
    plugins: [tailwindcss()]
  }),
  webExt: {
    disabled: process.env.WXT_MANUAL_DEV === "true",
    binaries: {
      chrome: process.env.WXT_CHROMIUM_BINARY ?? "./scripts/brave-flatpak"
    }
  },
  manifest: {
    name: "AI Council",
    description: "Run a demo AI council workflow from a Chrome side panel.",
    version: "0.1.0",
    permissions: ["storage", "tabs"],
    host_permissions: [
      "https://chat.openai.com/*",
      "https://chatgpt.com/*",
      "https://chat.deepseek.com/*",
      "https://claude.ai/*",
      "https://gemini.google.com/*",
      "https://chat.qwen.ai/*",
      "https://kimi.moonshot.cn/*",
      "https://www.kimi.com/*",
      "https://kimi.com/*",
      "https://www.perplexity.ai/*",
      "https://grok.com/*",
      "https://grok.x.ai/*"
    ],
    action: {
      default_title: "Open AI Council"
    }
  }
});
