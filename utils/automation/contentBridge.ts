import { browser } from "wxt/browser";
import type { BgToContentMessage, ContentToBgMessage } from "./messages";
import type { AdapterResult, ProbeMode, ProbeResult, ReadinessResult, SelectorGroup, SendConfirmationResult } from "./types";
import type { AppKey } from "../types";

export interface ContentScriptHandlers {
  onAgentRun: (prompt: string, selectors: SelectorGroup) => Promise<AdapterResult>;
  onJudgeRun: (prompt: string, selectors: SelectorGroup) => Promise<SendConfirmationResult>;
  onDiagnosticCheck: (selectors: SelectorGroup) => Promise<ReadinessResult>;
  onProbeRun: (mode: ProbeMode, selectors: SelectorGroup) => Promise<ProbeResult>;
  onCancel: () => void;
}

export function createContentScriptBridge(appKey: AppKey, handlers: ContentScriptHandlers): void {
  let cancelled = false;

  sendContentReadyWithRetry();

  browser.runtime.onMessage.addListener((message: BgToContentMessage) => {
    if (cancelled) {
      return Promise.resolve();
    }

    switch (message.type) {
      case "AGENT_RUN":
        if (message.appKey !== appKey) return Promise.resolve();
        console.log(`[ContentBridge:${appKey}] AGENT_RUN received`, { promptLength: message.prompt.length });
        return handlers
          .onAgentRun(message.prompt, message.selectors)
          .then((result) => {
            if (cancelled) return;
            console.log(`[ContentBridge:${appKey}] AGENT_RUN result`, result);
            void sendToBg({ type: "ADAPTER_RESULT", appKey, result });
          })
          .catch((error: unknown) => {
            console.error(`[ContentBridge:${appKey}] AGENT_RUN error`, error);
            void sendToBg({
              type: "ADAPTER_RESULT",
              appKey,
              result: { success: false, errorReason: error instanceof Error ? error.message : "dom_error" }
            });
          });

      case "JUDGE_RUN":
        if (message.appKey !== appKey) return Promise.resolve();
        return handlers
          .onJudgeRun(message.prompt, message.selectors)
          .then((result) => {
            if (cancelled) return;
            void sendToBg({ type: "SEND_CONFIRMED", appKey, result });
          })
          .catch((error: unknown) => {
            void sendToBg({
              type: "SEND_CONFIRMED",
              appKey,
              result: { sent: false, errorReason: error instanceof Error ? error.message : "send_failed" }
            });
          });

      case "DIAGNOSTIC_CHECK":
        if (message.appKey !== appKey) return Promise.resolve();
        return handlers
          .onDiagnosticCheck(message.selectors)
          .then((readiness) => {
            void sendToBg({
              type: "DIAGNOSTIC_RESULT",
              appKey,
              ready: readiness.ready,
              errorReason: readiness.errorReason
            });
          })
          .catch((error: unknown) => {
            void sendToBg({
              type: "DIAGNOSTIC_RESULT",
              appKey,
              ready: false,
              errorReason: error instanceof Error ? error.message : "dom_error"
            });
          });

      case "PROBE_RUN":
        if (message.appKey !== appKey) return Promise.resolve();
        return handlers
          .onProbeRun(message.mode, message.selectors)
          .then((result) => {
            void sendToBg({ type: "PROBE_RESULT", appKey, result });
          })
          .catch((error: unknown) => {
            void sendToBg({
              type: "PROBE_RESULT",
              appKey,
              result: {
                appKey,
                mode: message.mode,
                steps: [{
                  field: "input" as const,
                  status: "fail" as const,
                  detail: `probe error: ${error instanceof Error ? error.message : "unknown"}`
                }],
                durationMs: 0
              }
            });
          });

      case "CANCEL":
        cancelled = true;
        handlers.onCancel();
        return Promise.resolve();

      default:
        return Promise.resolve();
    }
  });

  function sendToBg(message: ContentToBgMessage): Promise<unknown> {
    return browser.runtime.sendMessage(message).catch(() => {
      // Background may not be listening yet; ignore.
    });
  }

  function sendContentReadyWithRetry(): void {
    let attempts = 0;
    const maxAttempts = 5;

    const trySend = (): void => {
      if (cancelled || attempts >= maxAttempts) return;
      attempts++;

      void browser.runtime
        .sendMessage({ type: "CONTENT_READY", appKey })
        .then(() => {
          // Sent successfully — background acknowledged.
        })
        .catch(() => {
          // Background not ready yet — retry after 500ms
          if (attempts < maxAttempts) {
            setTimeout(trySend, 500);
          }
        });
    };

    trySend();
  }
}
