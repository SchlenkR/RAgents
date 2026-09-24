(() => {
  const { gsap, ScrollTrigger } = window;
  if (!gsap || !ScrollTrigger || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const narrow = matchMedia('(max-width: 959.98px)');
  document.querySelectorAll('.story-step .feature-benefits').forEach(list => {
    const items = [...list.children];
    const step = list.closest('.story-step');
    const range = { trigger: step, start: 'top 75%', end: () => narrow.matches ? 'bottom 60%' : `+=${innerHeight * 3}` };
    const tl = gsap.timeline({ scrollTrigger: { ...range, scrub: true, invalidateOnRefresh: true } });
    items.forEach((item, index) => tl.fromTo(item, { autoAlpha: 0, x: -36 }, { autoAlpha: 1, x: 0, duration: 1, ease: 'power1.out' }, index * .6));
  });
})();
