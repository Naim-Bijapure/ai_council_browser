import { createContentScriptBridge } from "../utils/automation/contentBridge";
import { runAgent, runJudge } from "../utils/automation/genericAdapter";
import { runProbeLive, runProbeStatic } from "../utils/automation/probe";
import { checkReadiness } from "../utils/automation/readiness";

export default defineContentScript({
  matches: ["https://chat.qwen.ai/*"],
  runAt: "document_idle",
  main() {
    createContentScriptBridge("qwen", {
      async onAgentRun(prompt, selectors) {
        return runAgent("qwen", prompt, selectors);
      },
      async onJudgeRun(prompt, selectors) {
        return runJudge("qwen", prompt, selectors);
      },
      async onDiagnosticCheck(selectors) {
        return checkReadiness("qwen", selectors);
      },
      async onProbeRun(mode, selectors) {
        return mode === "static" ? runProbeStatic("qwen", selectors) : runProbeLive("qwen", selectors);
      },
      onCancel() {}
    });
  }
});
