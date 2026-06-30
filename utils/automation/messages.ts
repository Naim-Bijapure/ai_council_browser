import type { AppKey } from "../types";
import type { AdapterResult, ProbeMode, ProbeResult, ReadinessResult, SelectorGroup, SendConfirmationResult } from "./types";

export type BgToContentMessage =
  | {
      type: "AGENT_RUN";
      appKey: AppKey;
      prompt: string;
      selectors: SelectorGroup;
    }
  | {
      type: "JUDGE_RUN";
      appKey: AppKey;
      prompt: string;
      selectors: SelectorGroup;
    }
  | {
      type: "DIAGNOSTIC_CHECK";
      appKey: AppKey;
      selectors: SelectorGroup;
    }
  | {
      type: "PROBE_RUN";
      appKey: AppKey;
      selectors: SelectorGroup;
      mode: ProbeMode;
    }
  | { type: "CANCEL" };

export type ContentToBgMessage =
  | {
      type: "CONTENT_READY";
      appKey: AppKey;
    }
  | {
      type: "ADAPTER_RESULT";
      appKey: AppKey;
      result: AdapterResult;
    }
  | {
      type: "SEND_CONFIRMED";
      appKey: AppKey;
      result: SendConfirmationResult;
    }
  | {
      type: "STATUS_UPDATE";
      appKey: AppKey;
      status: string;
      detail?: string;
    }
  | {
      type: "DIAGNOSTIC_RESULT";
      appKey: AppKey;
      ready: boolean;
      errorReason?: string;
    }
  | {
      type: "PROBE_RESULT";
      appKey: AppKey;
      result: ProbeResult;
    };

export type ReadinessPayload = ReadinessResult;
