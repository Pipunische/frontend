import { useEffect, useRef } from "react";
import type { AnimationItem } from "lottie-web";

export function LottieMount({
  url,
  className,
  loop = true,
  fallback,
}: {
  url: string;
  className?: string;
  loop?: boolean;
  fallback?: string;
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
    el.removeAttribute("data-lottie-error");
    void import("lottie-web")
      .then((mod) => {
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
        anim.addEventListener("data_failed", () => {
          console.error("Lottie failed to load", url);
          if (ref.current) {
            ref.current.dataset.lottieError = "1";
            if (fallback) {
              ref.current.textContent = fallback;
            }
          }
        });
      })
      .catch((error) => {
        console.error("Lottie module failed to load", error);
        if (!cancelled && ref.current) {
          ref.current.dataset.lottieError = "1";
          if (fallback) {
            ref.current.textContent = fallback;
          }
        }
      });
    return () => {
      cancelled = true;
      anim?.destroy();
    };
  }, [fallback, loop, url]);

  return <div ref={ref} className={className} />;
}
