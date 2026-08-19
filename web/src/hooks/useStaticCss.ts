import { useLayoutEffect } from "react";

export function useStaticCss(hrefs: readonly string[], bodyClass?: string) {
  const hrefKey = hrefs.join("|");

  useLayoutEffect(() => {
    const created: HTMLLinkElement[] = [];
    for (const href of hrefKey.split("|")) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      document.head.appendChild(link);
      created.push(link);
    }
    if (bodyClass) {
      document.body.classList.add(bodyClass);
    }
    return () => {
      for (const link of created) {
        link.remove();
      }
      if (bodyClass) {
        document.body.classList.remove(bodyClass);
      }
    };
  }, [bodyClass, hrefKey]);
}
