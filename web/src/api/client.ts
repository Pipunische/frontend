const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

const SESSION_EXPIRED_PATH = "/login?error=session_expired";

export class ApiError extends Error {
  readonly status: number;
  readonly redirect?: string;
  readonly payload: unknown;

  constructor(
    message: string,
    status: number,
    payload?: unknown,
    redirect?: string,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
    this.redirect = redirect;
  }
}

type ApiOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
  redirectOn401?: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseRedirect(payload: unknown): string {
  if (isRecord(payload) && typeof payload.redirect === "string") {
    return payload.redirect.startsWith("/")
      ? payload.redirect
      : SESSION_EXPIRED_PATH;
  }
  return SESSION_EXPIRED_PATH;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return undefined;
}

function errorMessageFromPayload(payload: unknown, status: number): string {
  if (isRecord(payload)) {
    const fromBody = firstString(payload.message, payload.detail, payload.error);
    if (fromBody) {
      return fromBody;
    }
  }
  if (typeof payload === "string" && payload.trim()) {
    return payload;
  }
  return `Request failed: ${status}`;
}

export async function apiFetch<T = unknown>(
  path: string,
  options: ApiOptions = {},
): Promise<T> {
  const { body, headers, redirectOn401 = true, ...rest } = options;
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;

  const response = await fetch(`${API_BASE}${path}`, {
    ...rest,
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(body !== undefined && !isForm ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });

  const contentType = response.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");
  const payload = isJson
    ? await response.json().catch(() => undefined)
    : await response.text().catch(() => "");

  if (response.status === 401) {
    const redirect = parseRedirect(payload);
    if (redirectOn401) {
      const current = `${window.location.pathname}${window.location.search}`;
      if (current !== redirect) {
        window.location.assign(redirect);
      }
    }
    throw new ApiError("Unauthorized", 401, payload, redirect);
  }

  if (!response.ok) {
    throw new ApiError(errorMessageFromPayload(payload, response.status), response.status, payload);
  }

  return payload as T;
}

export async function fetchHealth() {
  return apiFetch<{ status: string; service: string; version: string }>(
    "/api/health",
  );
}
