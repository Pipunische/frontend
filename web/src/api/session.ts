import { apiFetch } from "./client";

export type SessionMe = {
  user_id: string;
  name: string;
  avatar_url: string;
  wallet_balance: number;
  java_host: string;
};

export function fetchSessionMe() {
  return apiFetch<SessionMe>("/api/session/me", { redirectOn401: false });
}

export function logoutSession() {
  return apiFetch<{ status: string }>("/api/logout", {
    method: "POST",
    redirectOn401: false,
  });
}

export type SessionToken = {
  token: string;
  wallet_balance: number;
};

export function fetchSessionToken() {
  return apiFetch<SessionToken>("/api/session/token");
}
