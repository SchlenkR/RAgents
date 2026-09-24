(() => {
  const { ScrollTrigger } = window;
  const layout = document.querySelector('.story-layout');
  if (!ScrollTrigger || !layout) return;
  ScrollTrigger.create({
    trigger: layout,
    start: 'top 60%',
    end: 'bottom 40%',
    toggleClass: { targets: document.documentElement, className: 'story-active' }
  });
})();
