interface ScrollViewport {
  scrollTop: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

const atEnd = (viewport: ScrollViewport) => viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 24;

export function createChatScroll(onFollowChange: (following: boolean) => void) {
  let following = true;
  let lastTop = 0;

  const follow = (value: boolean) => {
    if (following === value) return;
    following = value;
    onFollowChange(value);
  };
  const layout = (viewport: ScrollViewport, dragging = false) => {
    if (viewport.clientHeight <= 0) return;
    if (dragging && viewport.scrollTop < lastTop && !atEnd(viewport)) follow(false);
    if (following) viewport.scrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
    else if (viewport.scrollHeight <= viewport.clientHeight) follow(true);
    lastTop = viewport.scrollTop;
  };
  return {
    layout,
    pause(viewport: ScrollViewport) {
      if (viewport.scrollTop > 0) follow(false);
    },
    scroll(viewport: ScrollViewport, dragging = false) {
      if (viewport.clientHeight <= 0) return;
      if (atEnd(viewport)) follow(true);
      else if (dragging && viewport.scrollTop < lastTop) follow(false);
      lastTop = viewport.scrollTop;
    },
    jump(viewport: ScrollViewport) {
      follow(true);
      layout(viewport);
    },
  };
}
