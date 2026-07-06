import { createContentScriptBridge } from "../utils/automation/contentBridge";
import { runAgent, runJudge } from "../utils/automation/genericAdapter";
import { runProbeLive, runProbeStatic } from "../utils/automation/probe";
import { checkReadiness } from "../utils/automation/readiness";

export default defineContentScript({
  matches: ["https://www.kimi.com/*", "https://kimi.com/*", "https://kimi.moonshot.cn/*"],
  runAt: "document_idle",
  main() {
    createContentScriptBridge("kimi", {
      async onAgentRun(prompt, selectors, onSubmitted) {
        return runAgent("kimi", prompt, selectors, onSubmitted);
      },
      async onJudgeRun(prompt, selectors) {
        return runJudge("kimi", prompt, selectors);
      },
      async onDiagnosticCheck(selectors) {
        return checkReadiness("kimi", selectors);
      },
      async onProbeRun(mode, selectors) {
        return mode === "static" ? runProbeStatic("kimi", selectors) : runProbeLive("kimi", selectors);
      },
      onCancel() {}
    });
  }
});
