import { apiFetch } from "./client";

export type GoogleAuthResult = {
  status?: string;
  is_new_user?: boolean;
  redirect?: string;
  error?: string;
};

export type NicknameResult = {
  status?: string;
  new_nickname?: string;
  redirect?: string;
  error?: string;
  detail?: string;
};

export function loginWithGoogle(token: string) {
  return apiFetch<GoogleAuthResult>("/api/auth/google", {
    method: "POST",
    body: { token },
    redirectOn401: false,
  });
}

export function updateNickname(new_nickname: string) {
  return apiFetch<NicknameResult>("/api/profile/nickname", {
    method: "POST",
    body: { new_nickname },
  });
}

export type UserStats = {
  hands_played: number;
  total_won: number;
  win_ratio: number;
  biggest_pot: number;
  rank: string;
  rank_progress_percent?: number;
  next_rank?: string | null;
  chips_to_next_rank?: number;
};

export type ProfilePayload = {
  user: {
    user_id: string;
    name: string;
    avatar_url: string;
    wallet_balance: number;
  };
  stats: UserStats;
  java_host?: string;
};

export function fetchProfile() {
  return apiFetch<ProfilePayload>("/api/profile");
}

export function uploadAvatar(file: File) {
  const body = new FormData();
  body.append("avatar", file);
  return apiFetch<{ status?: string; avatar_url?: string }>("/api/upload-avatar", {
    method: "POST",
    body,
  });
}
