import { useState } from "react";
import type { PanelEmote } from "../api/table";
import { LottieMount } from "./LottieMount";

export function EmotePanel({
  emotes,
  onSend,
}: {
  emotes: PanelEmote[];
  onSend: (emoteId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  if (!emotes.length) {
    return null;
  }
  return (
    <div className="hero-emote-wrapper">
      <button type="button" className="btn-emote" onClick={() => setOpen((v) => !v)}>
        💬
      </button>
      <div id="emote-panel" className={`emote-panel${open ? " show" : ""}`}>
        {emotes.map((emote) => (
          <button
            key={emote.emote_id}
            type="button"
            className={`${emote.style_class ? `emote-exclusive ${emote.style_class}` : ""}${emote.lottie_url ? " emote-btn--lottie" : ""}`}
            title={emote.name}
            onClick={() => {
              setOpen(false);
              onSend(emote.emote_id);
            }}
          >
            {emote.lottie_url ? (
              <LottieMount url={emote.lottie_url} className="emote-lottie-thumb" />
            ) : (
              emote.emoji
            )}
          </button>
        ))}
      </div>
    </div>
  );
}