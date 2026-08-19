const audioCache: Record<string, HTMLAudioElement> = {};

function getSound(effect: "bet" | "card" | "fold"): HTMLAudioElement {
  if (!audioCache[effect]) {
    const src =
      effect === "bet"
        ? "/static/sounds/chip_bet.mp3"
        : effect === "card"
          ? "/static/sounds/card_slide.mp3"
          : "/static/sounds/fold.mp3";
    audioCache[effect] = new Audio(src);
  }
  return audioCache[effect];
}

export function playSound(effect: "bet" | "card" | "fold") {
  const sound = getSound(effect);
  sound.currentTime = 0;
  void sound.play().catch(() => {});
}