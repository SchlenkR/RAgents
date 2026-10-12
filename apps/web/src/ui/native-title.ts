import { useLayoutEffect, useState } from "react";

export function createNativeTitleRemover() {
  const descriptions = new WeakMap<Element, string>();
  return (root: Element) => {
    for (const element of [root, ...root.querySelectorAll("[title]")]) {
      const description = element.getAttribute("title");
      if (description === null) continue;
      const current = element.getAttribute("aria-description");
      if (description && (current === null || current === descriptions.get(element))) {
        element.setAttribute("aria-description", description);
        descriptions.set(element, description);
      }
      element.removeAttribute("title");
    }
  };
}

export function useNoNativeTitles() {
  const [element, setElement] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!element) return;
    const removeTitles = createNativeTitleRemover();
    removeTitles(element);
    const observer = new MutationObserver(() => removeTitles(element));
    observer.observe(element, { childList: true, subtree: true, attributes: true, attributeFilter: ["title"] });
    return () => observer.disconnect();
  }, [element]);
  return setElement;
}
