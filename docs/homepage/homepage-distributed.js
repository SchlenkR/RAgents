(() => {
  const story = document.querySelector('[data-dm-story]');
  const { gsap, ScrollTrigger } = window;
  if (!story || !gsap || !ScrollTrigger) return;
  const header = document.querySelector('.masthead');
  const steps = [...story.querySelectorAll('.dm-step')];
  const scenes = [...story.querySelectorAll('.dm-scene')];
  let active = 0;

  const select = index => {
    active = index;
    scenes.forEach((scene, position) => {
      const selected = position === index;
      scene.classList.toggle('dm-active', selected);
      scene.inert = !selected;
      scene.setAttribute('aria-hidden', String(!selected));
    });
  };
  const release = () => {
    story.removeAttribute('data-pinned');
    story.style.removeProperty('--dm-stage-h');
    scenes.forEach(scene => {
      scene.classList.remove('dm-active');
      scene.inert = false;
      scene.removeAttribute('aria-hidden');
    });
  };
  const layout = () => {
    story.setAttribute('data-pinned', '');
    const height = Math.max(...scenes.map(scene => scene.offsetHeight));
    if (height > innerHeight - header.offsetHeight - 72) return release();
    story.style.setProperty('--dm-stage-h', `${Math.ceil(height)}px`);
    select(active);
  };

  gsap.matchMedia().add('screen and (min-width: 960px)', () => {
    layout();
    ScrollTrigger.addEventListener('refreshInit', layout);
    steps.forEach((step, index) => ScrollTrigger.create({
      trigger: step, start: 'top 50%', end: 'bottom 50%',
      onToggle: self => self.isActive && story.hasAttribute('data-pinned') && select(index)
    }));
    return () => {
      ScrollTrigger.removeEventListener('refreshInit', layout);
      release();
    };
  });
})();
