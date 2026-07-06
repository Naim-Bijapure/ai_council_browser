const CONVERSATION_PATH_MARKERS = ["/c/", "/chat/", "/conversation", "/g/"];

export function isNewChatUrl(url: string, newChatUrl: string): boolean {
  if (url === newChatUrl) return true;
  try {
    const parsed = new URL(url);
    const newParsed = new URL(newChatUrl);
    return parsed.origin === newParsed.origin && parsed.pathname === newParsed.pathname && !parsed.search;
  } catch {
    return false;
  }
}

export function isCapturableChatUrl(
  url: string,
  newChatUrl: string,
  urlBefore?: string
): boolean {
  if (!url || !url.startsWith("http")) return false;

  if (urlBefore && url !== urlBefore) {
    return true;
  }

  if (url !== newChatUrl && !isNewChatUrl(url, newChatUrl)) {
    return true;
  }

  try {
    const parsed = new URL(url);
    const landing = new URL(newChatUrl);

    if (parsed.origin !== landing.origin) {
      return false;
    }

    if (parsed.search || parsed.hash) {
      return true;
    }

    if (CONVERSATION_PATH_MARKERS.some((marker) => parsed.pathname.includes(marker))) {
      return true;
    }

    if (parsed.pathname !== landing.pathname && parsed.pathname.length > 1) {
      return true;
    }
  } catch {
    return false;
  }

  return false;
}