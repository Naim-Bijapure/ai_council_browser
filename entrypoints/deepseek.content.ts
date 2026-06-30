import { createContentScriptBridge } from "../utils/automation/contentBridge";
import { runAgent, runJudge } from "../utils/automation/genericAdapter";
import { runProbeLive, runProbeStatic } from "../utils/automation/probe";
import { checkReadiness } from "../utils/automation/readiness";

export default defineContentScript({
  matches: ["https://chat.deepseek.com/*"],
  runAt: "document_idle",
  main() {
    createContentScriptBridge("deepseek", {
      async onAgentRun(prompt, selectors) {
        return runAgent("deepseek", prompt, selectors);
      },
      async onJudgeRun(prompt, selectors) {
        return runJudge("deepseek", prompt, selectors);
      },
      async onDiagnosticCheck(selectors) {
        return checkReadiness("deepseek", selectors);
      },
      async onProbeRun(mode, selectors) {
        return mode === "static" ? runProbeStatic("deepseek", selectors) : runProbeLive("deepseek", selectors);
      },
      onCancel() {}
    });
  }
});
