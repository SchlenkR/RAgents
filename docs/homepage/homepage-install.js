(() => {
  const section = document.querySelector('[data-install]');
  if (!section) return;
  const tabs = [...section.querySelectorAll('[role="tab"]')];
  const status = section.querySelector('[data-install-status]');
  const select = tab => {
    for (const item of tabs) {
      const selected = item === tab;
      item.setAttribute('aria-selected', String(selected));
      item.tabIndex = selected ? 0 : -1;
      document.getElementById(item.getAttribute('aria-controls')).hidden = !selected;
    }
    status.textContent = '';
  };
  for (const tab of tabs) {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', event => {
      const index = tabs.indexOf(tab);
      const target = event.key === 'ArrowRight' ? (index + 1) % tabs.length
        : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : undefined;
      if (target === undefined) return;
      event.preventDefault();
      select(tabs[target]);
      tabs[target].focus();
    });
  }
  const platforms = [...section.querySelectorAll('[data-install-platform]')];
  const selectPlatform = platform => {
    for (const button of platforms) button.setAttribute('aria-pressed', String(button.dataset.installPlatform === platform));
    for (const panel of section.querySelectorAll('[data-install-os]')) panel.hidden = panel.dataset.installOs !== platform;
    status.textContent = '';
  };
  for (const button of platforms) button.addEventListener('click', () => selectPlatform(button.dataset.installPlatform));
  const platform = navigator.userAgentData?.platform ?? navigator.platform;
  if (/Win/i.test(platform)) selectPlatform('windows');
  else if (/Linux/i.test(platform)) selectPlatform('linux');
  for (const button of section.querySelectorAll('[data-install-copy]')) {
    button.addEventListener('click', async () => {
      const code = button.closest('.install-command').querySelector('code');
      try {
        await navigator.clipboard.writeText(code.textContent);
        status.textContent = 'Command copied.';
      } catch {
        const selection = getSelection();
        const range = document.createRange();
        range.selectNodeContents(code);
        selection.removeAllRanges();
        selection.addRange(range);
        status.textContent = 'Command selected. Copy it with your keyboard.';
      }
    });
  }
})();
