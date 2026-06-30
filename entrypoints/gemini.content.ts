import { createContentScriptBridge } from "../utils/automation/contentBridge";
import { runAgent, runJudge } from "../utils/automation/genericAdapter";
import { runProbeLive, runProbeStatic } from "../utils/automation/probe";
import { checkReadiness } from "../utils/automation/readiness";

export default defineContentScript({
  matches: ["https://gemini.google.com/*"],
  runAt: "document_idle",
  main() {
    createContentScriptBridge("gemini", {
      async onAgentRun(prompt, selectors) {
        return runAgent("gemini", prompt, selectors);
      },
      async onJudgeRun(prompt, selectors) {
        return runJudge("gemini", prompt, selectors);
      },
      async onDiagnosticCheck(selectors) {
        return checkReadiness("gemini", selectors);
      },
      async onProbeRun(mode, selectors) {
        return mode === "static" ? runProbeStatic("gemini", selectors) : runProbeLive("gemini", selectors);
      },
      onCancel() {}
    });
  }
});
