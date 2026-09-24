(() => {
  const board = document.querySelector('.hero-board');
  const nav = board && board.querySelector('.feature-stickers');
  if (!nav) return;
  const copy = board.querySelector('.hero-copy');
  const stickers = [...nav.querySelectorAll('.feature-sticker')];
  const edge = 14;
  const gap = 18;
  const samples = 720;

  const reset = () => stickers.forEach(sticker => ['left', 'top', 'right', 'bottom'].forEach(side => sticker.style.removeProperty(side)));

  const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

  const layout = () => {
    reset();
    if (getComputedStyle(nav).position !== 'absolute') return;
    const area = nav.getBoundingClientRect();
    const text = copy.getBoundingClientRect();
    const blocked = {
      left: text.left - area.left - gap,
      right: text.right - area.left + gap,
      top: text.top - area.top - gap,
      bottom: text.bottom - area.top + gap
    };
    const sizes = stickers.map(sticker => ({ w: sticker.offsetWidth, h: sticker.offsetHeight }));
    const w = Math.max(...sizes.map(size => size.w));
    const h = Math.max(...sizes.map(size => size.h));
    const hero = board.closest('.hero').getBoundingClientRect();
    const cx = area.width / 2;
    const cy = area.height / 2;
    const rx = Math.min(hero.width, 1440) / 2 - w / 2 - edge * 2;
    const ry = cy - h / 2 - edge;
    const bend = value => Math.sign(value) * Math.abs(value) ** .5;
    const point = angle => ({ x: cx + bend(Math.cos(angle)) * rx, y: cy + bend(Math.sin(angle)) * ry });
    const free = angle => {
      const { x, y } = point(angle);
      return !overlaps({ left: x - w / 2, right: x + w / 2, top: y - h / 2, bottom: y + h / 2 }, blocked);
    };
    const angles = Array.from({ length: samples }, (_, index) => -Math.PI / 2 + index / samples * Math.PI * 2);
    const steps = angles.map((angle, index) => {
      const next = angles[(index + 1) % samples] + (index + 1 === samples ? Math.PI * 2 : 0);
      const a = point(angle);
      const b = point(next);
      return { angle, free: free(angle), length: Math.hypot(b.x - a.x, b.y - a.y) };
    });
    const total = steps.reduce((sum, step) => sum + (step.free ? step.length : 0), 0);
    if (!total) return;
    const spacing = total / stickers.length;
    const targets = stickers.map((_, index) => spacing * (index + .5));
    const placed = steps.reduce((state, step) => {
      if (!step.free) return state;
      const reached = state.walked + step.length;
      const hits = targets.slice(state.found.length).filter(target => target <= reached).map(() => step.angle);
      return { walked: reached, found: [...state.found, ...hits] };
    }, { walked: 0, found: [] }).found;
    stickers.forEach((sticker, index) => {
      const { x, y } = point(placed[index] ?? placed[placed.length - 1]);
      sticker.style.left = `${x - sizes[index].w / 2}px`;
      sticker.style.top = `${y - sizes[index].h / 2}px`;
      sticker.style.right = 'auto';
      sticker.style.bottom = 'auto';
    });
  };

  new ResizeObserver(() => requestAnimationFrame(layout)).observe(board);
  document.fonts.ready.then(layout);
  layout();
})();
