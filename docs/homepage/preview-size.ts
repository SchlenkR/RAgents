if (window.parent !== window) document.documentElement.style.overflow = "clip";

const reportHeight = () => window.parent.postMessage({
  type: "homepage-preview-size",
  height: Math.ceil(document.body.getBoundingClientRect().height),
}, location.protocol === "file:" ? "*" : location.origin);

new ResizeObserver(reportHeight).observe(document.body);
window.addEventListener("load", reportHeight);
