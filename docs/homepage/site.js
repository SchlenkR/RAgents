(() => {
  const root = document.documentElement;
  const header = document.querySelector('.masthead');
  const measureHeader = () => root.style.setProperty('--header-height', header.getBoundingClientRect().height + 'px');
  measureHeader();
  new ResizeObserver(measureHeader).observe(header);

  const burger = header.querySelector('.nav-menu');
  if (burger) {
    const menu = state => {
      root.toggleAttribute('data-menu-open', state);
      burger.setAttribute('aria-expanded', String(state));
      measureHeader();
    };
    burger.addEventListener('click', () => menu(!root.hasAttribute('data-menu-open')));
    document.addEventListener('click', event => {
      if (!root.hasAttribute('data-menu-open') || burger.contains(event.target)) return;
      if (event.target.closest('a') || !event.target.closest('.masthead, .subnav')) menu(false);
    });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !root.hasAttribute('data-menu-open')) return;
      menu(false);
      burger.focus();
    });
    matchMedia('(min-width: 721px)').addEventListener('change', event => event.matches && menu(false));
  }

  const story = document.querySelector('.feature-story');
  if (!story) return;
  const { gsap, ScrollTrigger } = window;
  if (!gsap || !ScrollTrigger) throw new Error('The homepage requires scroll-vendor.js with GSAP and ScrollTrigger. Run pnpm generate:homepage.');

  const steps = [...story.querySelectorAll('.story-step')];
  const media = gsap.matchMedia();
  const topInset = () => header.getBoundingClientRect().height + 24;
  let refreshFrame = 0;
  let resizeFrame = 0;
  let initialLayout = true;
  let readingStep = null;
  let measuredWidth = innerWidth;
  let measuredHeight = innerHeight;

  const refresh = () => {
    cancelAnimationFrame(refreshFrame);
    refreshFrame = requestAnimationFrame(() => ScrollTrigger.refresh());
  };
  const alignHash = () => {
    const target = document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (target) target.scrollIntoView({ behavior: 'instant', block: 'start' });
  };
  const rememberPosition = () => {
    if (innerWidth !== measuredWidth || innerHeight !== measuredHeight) return;
    const bounds = story.querySelector('.story-layout').getBoundingClientRect();
    readingStep = bounds.top < topInset() && bounds.bottom > topInset()
      ? steps.reduce((current, step, index) => step.getBoundingClientRect().top < innerHeight / 2 ? index : current, 0)
      : null;
  };
  const restorePosition = () => {
    const index = readingStep;
    ScrollTrigger.refresh();
    if (!initialLayout && index !== null) steps[index].scrollIntoView({ behavior: 'instant', block: 'start' });
    measuredWidth = innerWidth;
    measuredHeight = innerHeight;
    rememberPosition();
  };

  media.add('screen and (prefers-reduced-motion: no-preference) and (hover: hover)', () => {
    root.setAttribute('data-homepage-motion', '');
    gsap.fromTo(root, { '--reading-progress': 0 }, {
      '--reading-progress': 1, ease: 'none',
      scrollTrigger: { start: 0, end: () => ScrollTrigger.maxScroll(window), scrub: true }
    });
    gsap.to('[data-hero-copy]', {
      y: -28, ease: 'none',
      scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true }
    });
    document.querySelectorAll('.section-heading, .feature, .support, .developer-intro, .example-list').forEach(element => {
      gsap.from(element, {
        opacity: 0, y: 26, duration: .65, ease: 'power2.out',
        scrollTrigger: { trigger: element, start: 'top 92%', once: true }
      });
    });
    return () => root.removeAttribute('data-homepage-motion');
  });

  gsap.addEventListener('matchMedia', restorePosition);
  window.addEventListener('scroll', rememberPosition, { passive: true });
  window.addEventListener('resize', () => {
    if (innerWidth === measuredWidth && innerWidth < 960) return;
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(restorePosition);
  });
  new ResizeObserver(refresh).observe(story.querySelector('.story-steps'));
  new ResizeObserver(refresh).observe(header);
  document.querySelectorAll('details').forEach(details => details.addEventListener('toggle', refresh));
  window.addEventListener('pageshow', refresh);
  document.fonts.ready.then(() => {
    ScrollTrigger.refresh();
    alignHash();
    initialLayout = false;
    rememberPosition();
  });
})();
