(() => {
  const nav = document.querySelector('.subnav');
  if (!nav) return;
  const links = [...nav.querySelectorAll('a')];
  const sections = links.map(link => document.getElementById(link.hash.slice(1)));
  const jump = (event, hash) => {
    const target = document.getElementById(hash.slice(1));
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ behavior: 'instant', block: 'start' });
    history.replaceState(null, '', hash);
  };
  document.addEventListener('click', event => {
    const link = event.target.closest('a[href^="#"]');
    if (link && link.hash.length > 1) jump(event, link.hash);
  });
  const mark = index => links.forEach((link, position) => {
    if (position !== index) return link.removeAttribute('aria-current');
    link.setAttribute('aria-current', 'true');
    const left = link.offsetLeft - (nav.clientWidth - link.offsetWidth) / 2;
    nav.scrollTo({ left, behavior: 'instant' });
  });
  const update = () => {
    const line = innerHeight * .45;
    const index = sections.reduce((found, section, position) => section && section.getBoundingClientRect().top <= line ? position : found, -1);
    if (index < 0 || !sections[index] || sections[index].getBoundingClientRect().bottom < line - innerHeight * .3 && index === sections.length - 1) return mark(-1);
    mark(index);
  };
  addEventListener('scroll', update, { passive: true });
  addEventListener('resize', update);
  update();
})();
