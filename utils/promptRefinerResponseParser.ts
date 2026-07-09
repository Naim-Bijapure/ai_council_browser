import type { RelayRole } from "./types";

export interface ParsedRefinerResponse {
  notesText?: string;
  enhancedPromptText: string;
}

const NOTES_HEADER = /(?:^|\n)#+\s*\*{0,2}Notes\*{0,2}\s*\n/i;
const ENHANCED_HEADER = /(?:^|\n)#+\s*\*{0,2}Enhanced\s+[Pp]rompt\*{0,2}\s*\n/i;

/**
 * Parses a prompt-refiner step response.
 *  - Drafter (author): the whole response is the enhanced prompt.
 *  - Enhancer (reviewer): split "## Notes" and "## Enhanced prompt".
 *
 * relayRole is reused: "author" = Drafter, "reviewer" = Enhancer.
 */
export function parseRefinerResponse(responseText: string, role: RelayRole): ParsedRefinerResponse {
  const trimmed = responseText.trim();
  if (!trimmed) {
    return { enhancedPromptText: "" };
  }

  if (role === "author") {
    return { enhancedPromptText: trimmed };
  }

  const enhancedSplit = trimmed.split(ENHANCED_HEADER);
  if (enhancedSplit.length >= 2) {
    const beforeEnhanced = enhancedSplit[0];
    const enhancedPromptText = enhancedSplit.slice(1).join("").trim();
    const notesParts = beforeEnhanced.split(NOTES_HEADER);
    const notesText = notesParts.length >= 2
      ? notesParts.slice(1).join("").trim()
      : beforeEnhanced.trim() || undefined;

    return {
      notesText: notesText || undefined,
      enhancedPromptText: enhancedPromptText || trimmed
    };
  }

  // Only a "## Notes" section (no enhanced-prompt header) — keep the whole
  // response as the enhanced prompt so the chain still advances.
  const notesOnly = trimmed.split(NOTES_HEADER);
  if (notesOnly.length >= 2) {
    return {
      notesText: notesOnly.slice(1).join("").trim() || undefined,
      enhancedPromptText: trimmed
    };
  }

  return { enhancedPromptText: trimmed };
}
