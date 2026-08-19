import { Client, type IFrame } from "@stomp/stompjs";

export const RECONNECT_DELAYS = [500, 1000, 2000, 5000] as const;
export const FAST_RECONNECT_DELAY_MS = 500;

export function pokerWsUrl(javaHost: string): string {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${javaHost}/ws-poker`;
}

export type PokerStompHandlers = {
  onConnect: (client: Client) => void;
  onStompError: (frame: IFrame | string) => void;
  onWebSocketClose?: () => void;
};

/** Shared native-WebSocket STOMP client (lobby now, table later). */
export function createPokerStompClient(
  javaHost: string,
  token: string,
  handlers: PokerStompHandlers,
): Client {
  const client = new Client({
    brokerURL: pokerWsUrl(javaHost),
    connectHeaders: {
      Authorization: `Bearer ${token}`,
    },
    reconnectDelay: 0,
    heartbeatIncoming: 0,
    heartbeatOutgoing: 0,
    debug: () => {},
    onConnect: () => handlers.onConnect(client),
    onStompError: (frame) => handlers.onStompError(frame),
    onWebSocketClose: () => handlers.onWebSocketClose?.(),
    onWebSocketError: () => handlers.onStompError("WebSocket error"),
  });
  return client;
}

export function reconnectDelayMs(attempt: number, fast: boolean): number {
  if (fast) {
    return FAST_RECONNECT_DELAY_MS;
  }
  return RECONNECT_DELAYS[Math.min(attempt, RECONNECT_DELAYS.length - 1)];
}
