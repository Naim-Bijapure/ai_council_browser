import { createContentScriptBridge } from "../utils/automation/contentBridge";
import { runAgent, runJudge } from "../utils/automation/genericAdapter";
import { runProbeLive, runProbeStatic } from "../utils/automation/probe";
import { checkReadiness } from "../utils/automation/readiness";

export default defineContentScript({
  matches: ["https://chat.openai.com/*", "https://chatgpt.com/*"],
  runAt: "document_idle",
  main() {
    createContentScriptBridge("chatgpt", {
      async onAgentRun(prompt, selectors, onSubmitted) {
        return runAgent("chatgpt", prompt, selectors, onSubmitted);
      },
      async onJudgeRun(prompt, selectors) {
        return runJudge("chatgpt", prompt, selectors);
      },
      async onDiagnosticCheck(selectors) {
        return checkReadiness("chatgpt", selectors);
      },
      async onProbeRun(mode, selectors) {
        return mode === "static" ? runProbeStatic("chatgpt", selectors) : runProbeLive("chatgpt", selectors);
      },
      onCancel() {}
    });
  }
});
