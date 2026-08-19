import { useEffect, useRef } from "react";
import type { AnimationItem } from "lottie-web";

export function LottieMount({
  url,
  className,
  loop = true,
}: {
  url: string;
  className?: string;
  loop?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !url) {
      return;
    }
    let cancelled = false;
    let anim: AnimationItem | null = null;
    el.innerHTML = "";
    void import("lottie-web").then((mod) => {
      if (cancelled || !ref.current) {
        return;
      }
      anim = mod.default.loadAnimation({
        container: ref.current,
        renderer: "svg",
        loop,
        autoplay: true,
        path: url,
      });
    });
    return () => {
      cancelled = true;
      anim?.destroy();
    };
  }, [loop, url]);

  return <div ref={ref} className={className} />;
}