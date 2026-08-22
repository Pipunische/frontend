import { useLayoutEffect } from "react";
import { fetchHealth } from "../api/client";

const FONT_CSS =
  "https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700;800&display=swap";
export const SHARED_APP_CSS = [FONT_CSS, "/static/css/theme.css"] as const;

const VERSION_KEY = "pp_static_css_v";
const refCount = new Map<string, number>();
const nodes = new Map<string, HTMLLinkElement>();

let cssVersion = "";
let versionPromise: Promise<string> | null = null;

function readStoredVersion() {
  try {
    return sessionStorage.getItem(VERSION_KEY) || "";
  } catch {
    return "";
  }
}

function writeStoredVersion(version: string) {
  try {
    sessionStorage.setItem(VERSION_KEY, version);
  } catch {
    /* private mode */
  }
}

function withVersion(href: string) {
  if (!href.startsWith("/") || href.includes("?")) {
    return href;
  }
  const version = cssVersion || readStoredVersion();
  return version ? `${href}?v=${encodeURIComponent(version)}` : href;
}

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
  refCount.set(href, 0);
}

export function prefetchStaticCss(hrefs: readonly string[]) {
  void initStaticCssVersion().then(() => {
    for (const href of hrefs) {
      acquire(withVersion(href));
    }
  });
}

export async function initStaticCssVersion() {
  if (cssVersion) {
    return cssVersion;
  }
  const stored = readStoredVersion();
  if (stored) {
    cssVersion = stored;
  }
  if (!versionPromise) {
    versionPromise = fetchHealth()
      .then((health) => {
        cssVersion = health.version || cssVersion || "dev";
        writeStoredVersion(cssVersion);
        return cssVersion;
      })
      .catch(() => {
        cssVersion = cssVersion || "dev";
        return cssVersion;
      });
  }
  return versionPromise;
}

export function useStaticCss(hrefs: readonly string[], bodyClass?: string) {
  const hrefKey = hrefs.join("|");

  useLayoutEffect(() => {
    let cancelled = false;
    const apply = (versioned: string[]) => {
      if (cancelled) {
        return;
      }
      for (const href of versioned) {
        acquire(href);
      }
    };

    const initial = hrefKey ? hrefKey.split("|").filter(Boolean) : [];
    apply(initial.map(withVersion));
    void initStaticCssVersion().then(() => {
      apply(initial.map(withVersion));
    });

    if (bodyClass) {
      document.body.classList.add(bodyClass);
    }
    return () => {
      cancelled = true;
      for (const href of initial.map(withVersion)) {
        release(href);
      }
      if (bodyClass) {
        document.body.classList.remove(bodyClass);
      }
    };
  }, [bodyClass, hrefKey]);
}
