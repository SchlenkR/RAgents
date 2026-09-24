(() => {
  const { gsap, ScrollTrigger } = window;
  if (!gsap || !ScrollTrigger || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const scrub = panel => ({ trigger: panel, start: 'top 95%', end: 'center 70%', scrub: true });
  const at = element => {
    const style = getComputedStyle(element);
    return { x: Number(style.getPropertyValue('--x')), y: Number(style.getPropertyValue('--y')) };
  };
  const burst = (tl, elements, origin, from, start, gap) => elements.forEach((element, index) => {
    const { x, y } = at(element);
    tl.fromTo(element, { '--dx': origin.x - x, '--dy': origin.y - y, '--s': from, autoAlpha: 0 }, { '--dx': 0, '--dy': 0, '--s': 1, autoAlpha: 1, duration: 1, ease: 'power2.out' }, start + index * gap);
  });
  const lines = (tl, panel) => tl.fromTo(panel.querySelectorAll('[data-pa-line]'), { opacity: 0 }, { opacity: .45, duration: .6, stagger: .15, ease: 'none' }, 0);

  const plugin = document.querySelector('[data-pa="plugin"]');
  if (plugin) {
    const tl = gsap.timeline({ scrollTrigger: scrub(plugin) });
    lines(tl, plugin);
    burst(tl, plugin.querySelectorAll('[data-pa-token]'), { x: 166, y: 150 }, .3, .2, .2);
    tl.fromTo(plugin.querySelector('[data-pa-off]'), { '--dx': -170, '--dy': 51 }, { '--dx': 0, '--dy': 0, duration: 1.4, ease: 'power1.inOut' }, 1);
    tl.fromTo(plugin.querySelectorAll('.pa-eject, .pa-eject-tip, .pa-shadow'), { autoAlpha: 0 }, { autoAlpha: 1, duration: .6, ease: 'none' }, 1.8);
  }

  const profile = document.querySelector('[data-pa="profile"]');
  if (profile) {
    const tl = gsap.timeline({ scrollTrigger: scrub(profile) });
    lines(tl, profile);
    burst(tl, profile.querySelectorAll('[data-pp-copy]'), { x: 156, y: 160 }, 1.3, .3, .3);
  }
})();
