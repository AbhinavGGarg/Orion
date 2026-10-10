function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function normalizeApiBase(value: string): string {
  return trimTrailingSlash(value).replace(/\/api$/, "");
}

/**
 * Resolve the backend API base URL for browser-side calls.
 *
 * Priority:
 * 1) NEXT_PUBLIC_API_URL (explicit)
 * 2) localhost fallback for local development
 * 3) empty string for same-origin calls (supports Next rewrites/proxy)
 */
export function getApiBaseUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (explicit) {
    return normalizeApiBase(explicit);
  }

  return "";
}

export function apiUrl(path: string): string {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${getApiBaseUrl()}${cleanPath}`;
}

export async function parseErrorDetail(response: Response): Promise<string> {
  const fallback = `Request failed (${response.status})`;

  try {
    const payload = await response.json();
    if (typeof payload?.detail === "string" && payload.detail.trim()) {
      return payload.detail;
    }
    if (typeof payload?.message === "string" && payload.message.trim()) {
      return payload.message;
    }
    return fallback;
  } catch {
    return fallback;
  }
}
