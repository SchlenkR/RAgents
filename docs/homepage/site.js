(() => {
  const root = document.documentElement;
  const header = document.querySelector('.masthead');
  const measureHeader = () => root.style.setProperty('--header-height', header.getBoundingClientRect().height + 'px');
  measureHeader();
  new ResizeObserver(measureHeader).observe(header);

  const story = document.querySelector('.feature-story');
  if (!story) return;
  const { gsap, ScrollTrigger } = window;
  if (!gsap || !ScrollTrigger) throw new Error('The homepage requires scroll-vendor.js with GSAP and ScrollTrigger. Run pnpm generate:homepage.');

  const steps = [...story.querySelectorAll('.story-step')];
  const scenes = [...story.querySelectorAll('.story-scene')];
  const stage = story.querySelector('.story-stage');
  const links = [...story.querySelectorAll('.story-nav a')];
  const media = gsap.matchMedia();
  const topInset = () => header.getBoundingClientRect().height + 24;
  let active = 0;
  let refreshFrame = 0;
  let resizeFrame = 0;
  let initialLayout = true;
  let readingStep = null;
  let measuredWidth = innerWidth;
  let measuredHeight = innerHeight;
  let previewWidth = 0;
  let previewHeight = 0;
  let previewFits = false;
  let layoutFrame = 0;

  const sizePreviewStage = () => {
    const width = scenes[0].getBoundingClientRect().width;
    if (width !== previewWidth) previewHeight = 0;
    previewWidth = width;
    previewHeight = Math.max(560, ...scenes.map(scene => scene.scrollHeight));
    story.style.setProperty('--preview-stage-height', `${Math.ceil(previewHeight)}px`);
    const fits = previewHeight <= innerHeight - topInset() - 24;
    if (fits !== previewFits) {
      previewFits = fits;
      cancelAnimationFrame(layoutFrame);
      layoutFrame = requestAnimationFrame(() => gsap.matchMediaRefresh());
    }
  };
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
    sizePreviewStage();
    ScrollTrigger.refresh();
    if (!initialLayout && index !== null) steps[index].scrollIntoView({ behavior: 'instant', block: 'start' });
    measuredWidth = innerWidth;
    measuredHeight = innerHeight;
    rememberPosition();
  };
  sizePreviewStage();

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

  media.add({
    wide: 'screen and (min-width: 960px)',
    motion: 'screen and (prefers-reduced-motion: no-preference)'
  }, context => {
    if (!context.conditions.wide || !previewFits) return;
    story.setAttribute('data-pinned', '');

    context.add('select', (index, animate = true) => {
      active = index;
      scenes.forEach((scene, position) => {
        const selected = position === index;
        scene.inert = !selected;
        scene.setAttribute('aria-hidden', String(!selected));
        gsap.to(scene, {
          autoAlpha: selected ? 1 : 0,
          duration: animate && context.conditions.motion ? .2 : 0, ease: 'power2.out', overwrite: true
        });
      });
      links.forEach((link, position) => {
        if (position === index) link.setAttribute('aria-current', 'step');
        else link.removeAttribute('aria-current');
      });
      story.dataset.active = steps[index].id;
    });

    context.select(active, false);
    gsap.to('.story-progress > span', {
      scaleX: 1, ease: 'none',
      scrollTrigger: { trigger: '.story-steps', start: () => `top ${topInset()}`, end: () => `bottom ${topInset() + stage.offsetHeight}`, scrub: true }
    });
    const sceneTriggers = steps.map((step, index) => {
      return ScrollTrigger.create({
        trigger: step, start: 'top 50%',
        onEnter: () => context.select(index),
        onLeaveBack: () => context.select(Math.max(0, index - 1))
      });
    });
    const syncScene = () => {
      const index = sceneTriggers.reduce((current, trigger, position) => scrollY >= trigger.start ? position : current, 0);
      context.select(index, false);
    };
    ScrollTrigger.addEventListener('refresh', syncScene);
    return () => {
      ScrollTrigger.removeEventListener('refresh', syncScene);
      scenes.forEach(scene => {
        scene.inert = false;
        scene.removeAttribute('aria-hidden');
      });
      story.removeAttribute('data-pinned');
      story.removeAttribute('data-active');
    };
  });

  gsap.addEventListener('matchMedia', restorePosition);
  window.addEventListener('scroll', rememberPosition, { passive: true });
  window.addEventListener('resize', () => {
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
