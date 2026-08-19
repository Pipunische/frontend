import { useLayoutEffect } from "react";

const FONT_CSS =
  "https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700;800&display=swap";
export const SHARED_APP_CSS = [FONT_CSS, "/static/css/theme.css"] as const;

const refCount = new Map<string, number>();
const nodes = new Map<string, HTMLLinkElement>();

function acquire(href: string) {
  const next = (refCount.get(href) || 0) + 1;
  refCount.set(href, next);
  if (next !== 1) {
    return;
  }
  const existing = document.head.querySelector<HTMLLinkElement>(
    `link[data-pp-css="${CSS.escape(href)}"]`,
  );
  if (existing) {
    nodes.set(href, existing);
    return;
  }
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  link.dataset.ppCss = href;
  document.head.appendChild(link);
  nodes.set(href, link);
}

function release(href: string) {
  const next = (refCount.get(href) || 1) - 1;
  if (next > 0) {
    refCount.set(href, next);
    return;
  }
  refCount.delete(href);
  const link = nodes.get(href);
  nodes.delete(href);
  link?.remove();
}

export function useStaticCss(hrefs: readonly string[], bodyClass?: string) {
  const hrefKey = hrefs.join("|");

  useLayoutEffect(() => {
    const list = hrefKey ? hrefKey.split("|").filter(Boolean) : [];
    for (const href of list) {
      acquire(href);
    }
    if (bodyClass) {
      document.body.classList.add(bodyClass);
    }
    return () => {
      for (const href of list) {
        release(href);
      }
      if (bodyClass) {
        document.body.classList.remove(bodyClass);
      }
    };
  }, [bodyClass, hrefKey]);
}
