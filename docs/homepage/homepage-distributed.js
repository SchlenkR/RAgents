(() => {
  const story = document.querySelector('[data-dm-story]');
  const stage = story?.querySelector('[data-dm-stage]');
  const { gsap, ScrollTrigger } = window;
  if (!story || !stage || !gsap || !ScrollTrigger) return;
  const header = document.querySelector('.masthead');
  const steps = [...story.querySelectorAll('.dm-step')];

  const order = ['ui', 'runs', 'ghost', 'tools', 'models', 'profile'];
  const icons = { ui: 'browser', runs: 'run', ghost: 'run', tools: 'tools', models: 'models', profile: 'profile' };
  const tones = { ui: 'dm-cream', runs: 'dm-agent', ghost: 'dm-note', tools: 'dm-app', models: 'dm-coord', profile: 'dm-script' };
  const modes = [
    {
      heading: 'One laptop, one process',
      caption: 'Everything but the model calls stays on your laptop.',
      idle: 'server',
      items: { ui: ['laptop', 'VS Code', 'or a browser'], runs: ['laptop', 'Runs', 'agents, journal'], tools: ['laptop', 'Tools', 'files, shell, Git'], models: ['laptop', 'Models', 'your own key'] },
      links: [['ui', 'runs', ''], ['runs', 'tools', ''], ['runs', 'models', 'model calls']],
    },
    {
      heading: 'One server, many browsers',
      caption: 'Every browser talks to its run. Files and tools stay on the server.',
      items: { ui: ['laptop', 'Browsers', 'you, your team, clients'], runs: ['server', 'Runs', 'agents, journal'], tools: ['server', 'Tools', 'a folder per run'], models: ['server', 'Models', 'keys stay here'], profile: ['server', 'Profile', 'prompts, skills, plugins'] },
      links: [['ui', 'runs', 'live'], ['runs', 'tools', ''], ['runs', 'models', '']],
    },
    {
      heading: 'Coordinate centrally, run tools locally',
      caption: 'The run sends a tool call to your laptop. It runs on your files, the result goes back.',
      items: { ui: ['laptop', 'VS Code', 'chat, mini-apps'], runs: ['server', 'Runs', 'agents, journal'], tools: ['laptop', 'Tools', 'your checkout'], models: ['server', 'Models', 'keys stay here'], profile: ['server', 'Profile', 'prompts, skills, plugins'] },
      links: [['ui', 'runs', 'chat, live'], ['runs', 'tools', 'tool call'], ['runs', 'models', '']],
    },
    {
      heading: 'Local runs, central profile and models',
      caption: 'The profile arrives once. Model calls go through the relay, which shows only an alias.',
      items: { ui: ['laptop', 'VS Code', 'or a browser'], runs: ['laptop', 'Runs', 'journal stays here'], tools: ['laptop', 'Tools', 'your checkout'], models: ['server', 'Model relay', 'aliases only'], profile: ['server', 'Profile', 'fetched once'] },
      links: [['ui', 'runs', ''], ['runs', 'tools', ''], ['runs', 'models', 'model calls'], ['profile', 'runs', 'once, cached']],
    },
    {
      heading: 'A run changes machines',
      caption: 'The run continues on the server. Its folder stays bound to your laptop.',
      items: { ui: ['laptop', 'Browser', 'or VS Code'], runs: ['server', 'Run A', 'continues here'], ghost: ['laptop', 'Run A', 'copy until deleted'], tools: ['laptop', 'Tools', 'folder stays'], models: ['server', 'Models', 'keys stay here'], profile: ['server', 'Profile', 'prompts, skills, plugins'] },
      links: [['ghost', 'runs', 'run archive'], ['runs', 'tools', ''], ['ui', 'runs', 'live']],
    },
  ];

  const svg = (tag, attributes) => {
    const element = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, value));
    return element;
  };
  const icon = name => `<svg aria-hidden="true"><use href="#dm-i-${name}"/></svg>`;
  const layout = mode => {
    const lanes = { laptop: [], server: [] };
    order.filter(key => mode.items[key]).forEach(key => lanes[mode.items[key][0]].push(key));
    return Object.fromEntries(Object.entries(lanes).flatMap(([lane, keys]) => keys.map((key, index) => [key, {
      x: lane === 'laptop' ? 140 : 420,
      y: 60 + (index + .5) * 280 / keys.length,
      index,
    }])));
  };
  const path = (from, to) => {
    if (from.x !== to.x) {
      const middle = (from.x + to.x) / 2;
      return { d: `M${from.x} ${from.y}C${middle} ${from.y} ${middle} ${to.y} ${to.x} ${to.y}`, x: middle, y: (from.y + to.y) / 2 };
    }
    if (Math.abs(from.index - to.index) === 1) return { d: `M${from.x} ${from.y}V${to.y}`, x: from.x + 44, y: (from.y + to.y) / 2 };
    const bow = from.x + 140;
    return { d: `M${from.x} ${from.y}C${bow} ${from.y} ${bow} ${to.y} ${to.x} ${to.y}`, x: from.x + 108, y: (from.y + to.y) / 2 };
  };

  const build = fixed => {
    const figure = document.createElement('figure');
    figure.className = `dm-scene ${fixed ? 'dm-static' : 'dm-live'}`;
    figure.setAttribute('role', 'img');
    figure.innerHTML = `<div class="dm-scene-heading"></div><div class="dm-dg"><div class="dm-dg-in">
      <div class="dm-machine dm-laptop" style="--x:16;--y:36;--w:248;--h:322"><span class="dm-machine-label">${icon('laptop')}Your laptop</span><span class="dm-machine-foot"></span></div>
      <div class="dm-machine dm-server" style="--x:296;--y:36;--w:248;--h:322"><span class="dm-machine-label">${icon('server')}Server</span><span class="dm-machine-foot"></span></div>
    </div></div><figcaption></figcaption>`;
    const canvas = figure.querySelector('.dm-dg-in');
    const lines = svg('svg', { class: 'dm-lines', viewBox: '0 0 560 380', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
    canvas.prepend(lines);
    const nodes = Object.fromEntries(order.map(key => {
      const node = document.createElement('div');
      node.className = `dm-node dm-move ${tones[key]}`;
      node.innerHTML = `<span class="dm-glyph${key === 'ui' ? ' dm-sq' : ''}">${icon(icons[key])}</span><span><strong></strong><small></small></span>`;
      canvas.append(node);
      return [key, node];
    }));
    const labels = document.createElement('div');
    canvas.append(labels);
    const show = index => {
      const mode = modes[index];
      const spots = layout(mode);
      figure.querySelector('.dm-scene-heading').textContent = mode.heading;
      figure.querySelector('figcaption').textContent = mode.caption;
      figure.setAttribute('aria-label', `${mode.heading}. ${mode.caption}`);
      figure.querySelectorAll('.dm-machine').forEach(machine => {
        const idle = machine.classList.contains(`dm-${mode.idle}`);
        machine.classList.toggle('dm-idle', idle);
        machine.querySelector('.dm-machine-foot').textContent = idle ? 'not needed' : '';
      });
      order.forEach(key => {
        const node = nodes[key];
        const item = mode.items[key];
        node.classList.toggle('dm-gone', !item);
        if (!item) return;
        node.style.setProperty('--x', spots[key].x);
        node.style.setProperty('--y', spots[key].y);
        node.querySelector('strong').textContent = item[1];
        node.querySelector('small').textContent = item[2];
        node.querySelector('use').setAttribute('href', `#dm-i-${key === 'ui' && item[1] === 'VS Code' ? 'laptop' : icons[key]}`);
      });
      lines.replaceChildren(...mode.links.map(([from, to]) => svg('path', { class: 'dm-ln dm-flow', d: path(spots[from], spots[to]).d })));
      labels.replaceChildren(...mode.links.filter(link => link[2]).map(([from, to, text]) => {
        const spot = path(spots[from], spots[to]);
        const label = document.createElement('span');
        label.className = 'dm-lbl';
        label.style.setProperty('--x', spot.x);
        label.style.setProperty('--y', spot.y);
        label.textContent = text;
        return label;
      }));
    };
    return { figure, show };
  };

  const live = build(false);
  stage.append(live.figure);
  modes.forEach((_mode, index) => {
    const copy = build(true);
    copy.show(index);
    copy.figure.style.setProperty('--i', index);
    stage.append(copy.figure);
  });
  let active = 0;
  const select = index => {
    active = index;
    live.show(index);
  };
  select(0);
  requestAnimationFrame(() => live.figure.classList.add('dm-ready'));

  const release = () => {
    story.removeAttribute('data-pinned');
    story.style.removeProperty('--dm-stage-h');
  };
  const pin = () => {
    story.setAttribute('data-pinned', '');
    const height = live.figure.offsetHeight;
    if (height > innerHeight - header.offsetHeight - 72) return release();
    story.style.setProperty('--dm-stage-h', `${Math.ceil(height)}px`);
    select(active);
  };

  gsap.matchMedia().add('screen and (min-width: 960px)', () => {
    pin();
    ScrollTrigger.addEventListener('refreshInit', pin);
    steps.forEach((step, index) => ScrollTrigger.create({
      trigger: step, start: 'top 50%', end: 'bottom 50%',
      onToggle: self => self.isActive && story.hasAttribute('data-pinned') && select(index)
    }));
    return () => {
      ScrollTrigger.removeEventListener('refreshInit', pin);
      release();
    };
  });
})();
