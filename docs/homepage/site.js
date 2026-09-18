(() => {
  const root = document.documentElement;
  const sampleButtons = [...document.querySelectorAll('[data-start-sample]')];
  const sampleLinks = [...document.querySelectorAll('[data-sample-link]')];
  let availableSamples = new Set();
  if (window.parent !== window && location.protocol !== 'file:') {
    window.addEventListener('message', event => {
      if (event.source !== window.parent || event.origin !== location.origin || event.data?.type !== 'ragents:help-context') return;
      availableSamples = new Set(event.data.canStartSamples === true && Array.isArray(event.data.entries)
        ? event.data.entries.filter(entry => typeof entry === 'string') : []);
      sampleButtons.forEach(button => { button.hidden = !availableSamples.has(button.dataset.startSample); });
      sampleLinks.forEach(link => { link.hidden = !availableSamples.has(link.dataset.sampleLink); });
    });
    sampleButtons.forEach(button => button.addEventListener('click', () => {
      const entry = button.dataset.startSample;
      if (availableSamples.has(entry)) window.parent.postMessage({ type: 'ragents:start-sample', entry }, location.origin);
    }));
    sampleLinks.forEach(link => link.addEventListener('click', event => {
      const entry = link.dataset.sampleLink;
      if (!availableSamples.has(entry)) return;
      event.preventDefault();
      window.parent.postMessage({ type: 'ragents:start-sample', entry }, location.origin);
    }));
    window.parent.postMessage({ type: 'ragents:help-ready' }, location.origin);
  }
  const header = document.querySelector('.masthead');
  const measureHeader = () => root.style.setProperty('--header-height', header.getBoundingClientRect().height + 'px');
  measureHeader();
  new ResizeObserver(measureHeader).observe(header);

  const story = document.querySelector('.feature-story');
  if (!story) return;
  const { gsap, ScrollTrigger } = window;
  if (!gsap || !ScrollTrigger) throw new Error('Die Homepage benötigt scroll-vendor.js mit GSAP und ScrollTrigger. Bitte pnpm generate:homepage ausführen.');

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
    if (previewFrames.some(frame => !frame.style.height)) return;
    const width = scenes[0].getBoundingClientRect().width;
    if (width !== previewWidth) previewHeight = 0;
    previewWidth = width;
    scenes.forEach(scene => {
      const frame = scene.querySelector('iframe');
      if (!frame) return;
      const style = getComputedStyle(scene);
      const bar = scene.querySelector('.mini-app-window-bar');
      previewHeight = Math.max(previewHeight, frame.offsetHeight + bar.offsetHeight
        + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + 70);
    });
    story.style.setProperty('--preview-stage-height', `${Math.ceil(previewHeight)}px`);
    const fits = previewHeight <= innerHeight - topInset() - 24;
    if (fits !== previewFits) {
      previewFits = fits;
      cancelAnimationFrame(layoutFrame);
      layoutFrame = requestAnimationFrame(() => gsap.matchMediaRefresh());
    }
  };
  const previewFrames = [...story.querySelectorAll('iframe')];
  window.addEventListener('message', event => {
    const frame = previewFrames.find(item => event.source === item.contentWindow);
    if (!frame || (location.protocol !== 'file:' && event.origin !== location.origin)
      || event.data?.type !== 'homepage-preview-size') return;
    const height = event.data.height;
    if (!Number.isFinite(height) || height <= 0) return;
    const nextHeight = `${Math.ceil(height)}px`;
    if (frame.style.height === nextHeight) return;
    frame.style.height = nextHeight;
    sizePreviewStage();
    refresh();
  });

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

  const diagramTimeline = (id, trigger, start = 'top 75%', end = 'bottom 80%') => gsap.timeline({
    defaults: { ease: 'none' },
    scrollTrigger: { id, trigger, start, end, scrub: true, invalidateOnRefresh: true }
  });
  const travel = (timeline, graphic, key, at, duration, reverse = false) => {
    const path = graphic.querySelector(`[data-route="${key}"]`);
    const packet = graphic.querySelector(`[data-packet="${key}"]`);
    timeline.set(packet, { autoAlpha: 1 }, at);
    timeline.to(packet, {
      motionPath: { path, align: path, alignOrigin: [.5, .5], start: reverse ? 1 : 0, end: reverse ? 0 : 1 },
      duration
    }, at);
    timeline.set(packet, { autoAlpha: 0 }, at + duration);
  };
  const trace = (timeline, graphic, key, at, duration) => timeline.fromTo(
    graphic.querySelector(`[data-route="${key}"]`),
    { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration }, at
  );
  const animateSetups = (timeline, scene) => {
    const one = selector => scene.querySelector(selector);
    const agent = one('[data-build-part="agent"]');
    const program = one('[data-build-part="program"]');
    const view = one('[data-build-part="view"]');
    const assignment = one('[data-build-part="assignment"]');
    const working = one('[data-build-status="working"]');
    const done = one('[data-build-status="done"]');
    gsap.set(working, { autoAlpha: 1 });
    gsap.set(done, { autoAlpha: 0 });
    timeline.set(working, { autoAlpha: 1 }, 0);
    timeline.set(done, { autoAlpha: 0 }, 0);
    timeline.fromTo(one('[data-build-line="agent"]'), { backgroundColor: '#e4d7ef00' }, { backgroundColor: '#e4d7ef', duration: .3 }, .15);
    timeline.fromTo(agent, { opacity: .12 }, { opacity: 1, duration: .55 }, .45);
    timeline.fromTo(one('[data-build-line="program"]'), { backgroundColor: '#e4d7ef00' }, { backgroundColor: '#e4d7ef', duration: .3 }, 1.2);
    timeline.fromTo(program, { opacity: .12 }, { opacity: 1, duration: .4 }, 1.5);
    timeline.fromTo(view, { opacity: .12 }, { opacity: 1, duration: .6 }, 1.65);
    timeline.fromTo(one('[data-build-line="input"]'), { backgroundColor: '#e4d7ef00' }, { backgroundColor: '#e4d7ef', duration: .3 }, 2.65);
    timeline.fromTo(assignment, { opacity: 0 }, { opacity: 1, duration: .4 }, 2.95);
    timeline.fromTo(program.querySelector('code'), { color: '#493857' }, { color: '#318064', duration: .4 }, 3.5);
    timeline.fromTo(one('[data-build-result="entry"]'), { opacity: 0 }, { opacity: 1, duration: .45 }, 3.9);
    timeline.fromTo(one('[data-build-result="count"]'), { opacity: 0 }, { opacity: 1, duration: .2 }, 4.15);
    timeline.set(working, { autoAlpha: 0 }, 4.4);
    timeline.set(done, { autoAlpha: 1 }, 4.4);
    timeline.to({}, { duration: .8 });
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
    document.querySelectorAll('.section-heading, .feature, .journal-heading, .journal-demo, .support, .developer-intro, .example-list').forEach(element => {
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

  media.add({
    all: 'all',
    motion: 'screen and (prefers-reduced-motion: no-preference)',
    wide: 'screen and (min-width: 960px)'
  }, context => {
    if (!context.conditions.motion) return;
    const setup = scenes[0];
    const pinned = story.hasAttribute('data-pinned');
    const setupTimeline = diagramTimeline('schema-setups', pinned ? steps[0] : setup,
      pinned ? 'top 50%' : 'top 75%', pinned ? 'bottom 55%' : 'bottom 80%');
    animateSetups(setupTimeline, setup);

    const events = document.querySelector('.event-schema');
    const delivery = diagramTimeline('schema-events', events);
    delivery.to(events.querySelector('.event-source'), { borderColor: '#4b9776', backgroundColor: '#e0f2e7', duration: .3 }, 0);
    trace(delivery, events, 'event-in', .3, .9);
    travel(delivery, events, 'event-in', .3, .9);
    delivery.to(events.querySelector('.event-filter'), { backgroundColor: '#bde1cc', borderColor: '#32795a', duration: .45 }, 1.2);
    ['event-agent', 'event-program'].forEach((key, index) => {
      trace(delivery, events, key, 1.9, 1.25);
      travel(delivery, events, key, 1.9, 1.25);
      delivery.to(events.querySelectorAll('.event-targets .event-node')[index],
        { borderColor: '#4b9776', backgroundColor: '#e0f2e7', duration: .3 }, 3.15);
    });
    delivery.fromTo(events.querySelectorAll('[data-event-receipt]'),
      { opacity: 0, y: 4 }, { opacity: 1, y: 0, duration: .25 }, 3.2);
    delivery.to({}, { duration: .6 });

    const workspace = document.querySelector('.workspace-figure');
    const canvas = diagramTimeline('schema-canvas', workspace);
    const nodes = workspace.querySelectorAll('.workspace-node');
    const logs = workspace.querySelectorAll('[data-canvas-log]');
    canvas.to(nodes[0], { borderColor: '#684b84', backgroundColor: '#dcd0e8', duration: .3 }, 0);
    canvas.fromTo(logs, { opacity: .3 }, { opacity: 1, stagger: 1.4, duration: .3 }, 0);
    workspace.querySelectorAll('.connector').forEach((connector, index) => {
      const at = .35 + index * 2.5;
      canvas.set(connector, { '--delivery-opacity': 1 }, at);
      canvas.fromTo(connector, { '--delivery': 0 }, { '--delivery': 1, duration: .8 }, at);
      canvas.set(connector, { '--delivery-opacity': 0 }, at + .8);
    });
    canvas.to(nodes[1], { borderColor: '#69483e', backgroundColor: '#eec4b1', duration: .5 }, 1.2);
    canvas.to(nodes[2], { borderColor: '#6f6237', backgroundColor: '#e9dca1', duration: .5 }, 1.2);
    canvas.to(nodes[3], { borderColor: '#79638d', backgroundColor: '#e7edf2', duration: .5 }, 3.7);
    canvas.to(workspace.querySelector('.workspace-journal'), { borderColor: '#b8aeba', backgroundColor: '#e9e2ed', duration: .3 }, 4.2);
    canvas.to({}, { duration: .4 });
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
