(() => {
  const nav = document.querySelector('.subnav');
  if (!nav) return;
  const links = [...nav.querySelectorAll('a')];
  const sections = links.map(link => document.getElementById(link.hash.slice(1)));
  const toggle = nav.querySelector('.subnav-toggle');
  const label = nav.querySelector('[data-subnav-label]');
  const fallback = label.textContent;
  const open = state => {
    nav.toggleAttribute('data-open', state);
    toggle.setAttribute('aria-expanded', String(state));
  };
  const fit = () => {
    nav.removeAttribute('data-compact');
    const compact = nav.scrollWidth > nav.clientWidth;
    nav.toggleAttribute('data-compact', compact);
    if (!compact) open(false);
  };
  const jump = (event, hash) => {
    const target = document.getElementById(hash.slice(1));
    if (!target) return;
    event.preventDefault();
    open(false);
    target.scrollIntoView({ behavior: 'instant', block: 'start' });
    history.replaceState(null, '', hash);
  };
  toggle.addEventListener('click', () => open(!nav.hasAttribute('data-open')));
  document.addEventListener('click', event => {
    const link = event.target.closest('a[href^="#"]');
    if (link && link.hash.length > 1) return jump(event, link.hash);
    if (!nav.contains(event.target)) open(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !nav.hasAttribute('data-open')) return;
    open(false);
    toggle.focus();
  });
  const mark = index => {
    label.textContent = index < 0 ? fallback : links[index].textContent;
    links.forEach((link, position) => {
      if (position !== index) return link.removeAttribute('aria-current');
      link.setAttribute('aria-current', 'true');
      const left = link.offsetLeft - (nav.clientWidth - link.offsetWidth) / 2;
      nav.scrollTo({ left, behavior: 'instant' });
    });
  };
  const update = () => {
    const line = innerHeight * .45;
    const index = sections.reduce((found, section, position) => section && section.getBoundingClientRect().top <= line ? position : found, -1);
    if (index < 0 || !sections[index] || sections[index].getBoundingClientRect().bottom < line - innerHeight * .3 && index === sections.length - 1) return mark(-1);
    mark(index);
  };
  addEventListener('scroll', update, { passive: true });
  addEventListener('resize', update);
  new ResizeObserver(fit).observe(nav);
  fit();
  update();
})();
