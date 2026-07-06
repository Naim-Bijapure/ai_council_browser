import { createContentScriptBridge } from "../utils/automation/contentBridge";
import { runAgent, runJudge } from "../utils/automation/genericAdapter";
import { runProbeLive, runProbeStatic } from "../utils/automation/probe";
import { checkReadiness } from "../utils/automation/readiness";

export default defineContentScript({
  matches: ["https://grok.com/*", "https://grok.x.ai/*"],
  runAt: "document_idle",
  main() {
    createContentScriptBridge("grok", {
      async onAgentRun(prompt, selectors, onSubmitted) {
        return runAgent("grok", prompt, selectors, onSubmitted);
      },
      async onJudgeRun(prompt, selectors) {
        return runJudge("grok", prompt, selectors);
      },
      async onDiagnosticCheck(selectors) {
        return checkReadiness("grok", selectors);
      },
      async onProbeRun(mode, selectors) {
        return mode === "static" ? runProbeStatic("grok", selectors) : runProbeLive("grok", selectors);
      },
      onCancel() {}
    });
  }
});
