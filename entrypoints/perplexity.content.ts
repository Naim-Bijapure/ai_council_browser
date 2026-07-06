import { createContentScriptBridge } from "../utils/automation/contentBridge";
import { runAgent, runJudge } from "../utils/automation/genericAdapter";
import { runProbeLive, runProbeStatic } from "../utils/automation/probe";
import { checkReadiness } from "../utils/automation/readiness";

export default defineContentScript({
  matches: ["https://www.perplexity.ai/*"],
  runAt: "document_idle",
  main() {
    createContentScriptBridge("perplexity", {
      async onAgentRun(prompt, selectors, onSubmitted) {
        return runAgent("perplexity", prompt, selectors, onSubmitted);
      },
      async onJudgeRun(prompt, selectors) {
        return runJudge("perplexity", prompt, selectors);
      },
      async onDiagnosticCheck(selectors) {
        return checkReadiness("perplexity", selectors);
      },
      async onProbeRun(mode, selectors) {
        return mode === "static" ? runProbeStatic("perplexity", selectors) : runProbeLive("perplexity", selectors);
      },
      onCancel() {}
    });
  }
});
