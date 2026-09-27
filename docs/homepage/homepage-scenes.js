(() => {
  const { gsap, ScrollTrigger } = window;
  const story = document.querySelector('.feature-story');
  const W = 540;
  const H = 520;

  const place = (element, point) => {
    element.style.left = `${point.x / W * 100}%`;
    element.style.top = `${point.y / H * 100}%`;
  };
  const travel = (tl, packet, path, at, { duration = 1, reverse = false, from = 0, to = 1 } = {}) => {
    const length = path.getTotalLength();
    const state = { t: 0 };
    tl.to(state, {
      t: 1, duration, ease: 'power1.inOut',
      onUpdate: () => {
        const share = from + (to - from) * (reverse ? 1 - state.t : state.t);
        place(packet, path.getPointAtLength(share * length));
        packet.style.opacity = state.t > 0 && state.t < 1 ? 1 : 0;
      }
    }, at);
  };
  const pop = (tl, targets, at, { stagger = .12, duration = .45 } = {}) => {
    [targets].flat().forEach((target, index) => {
      tl.fromTo(target, { autoAlpha: 0, scale: .6 }, { autoAlpha: 1, scale: 1, duration, ease: 'power2.out' }, at + index * stagger);
    });
  };
  const draw = (tl, paths, at, duration = .7, ease = 'power1.inOut') => tl.fromTo(paths, { strokeDashoffset: 1 }, { strokeDashoffset: 0, duration, ease, stagger: .15 }, at);
  const clock = (tl, total, apply) => {
    const state = { t: 0 };
    apply(0);
    tl.to(state, { t: total, duration: total, ease: 'none', onUpdate: () => apply(state.t) }, 0);
  };
  const clamp = value => Math.max(0, Math.min(1, value));
  const smooth = share => share * share * (3 - 2 * share);
  const within = (time, from, to) => time >= from && time < to;
  const blink = (art, time) => art.querySelectorAll('.think').forEach(think => {
    [...think.children].forEach((dot, index) => dot.classList.toggle('on', Math.floor(time * 6) % 3 === index));
  });
  const onPath = (path, share) => path.getPointAtLength(path.getTotalLength() * share);
  const center = (canvas, element) => {
    const box = canvas.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    return { x: (rect.left + rect.width / 2 - box.left) / box.width * W, y: (rect.top + rect.height / 2 - box.top) / box.height * H };
  };

  const scenes = {
    setups: (art, tl) => {
      const part = name => [...art.querySelectorAll(`[data-su="${name}"]`)];
      const [paths, faints, ghosts, labels, pieces] = ['path', 'faint', 'ghost', 'label', 'piece'].map(part);
      const flight = index => .6 + index * 1.9;
      const trip = 1.4;
      const total = flight(pieces.length - 1) + trip + 1.8;
      clock(tl, total, time => {
        pieces.forEach((piece, index) => {
          const share = smooth(clamp((time - flight(index)) / trip));
          [faints[index], ghosts[index]].forEach(element => { element.style.opacity = 0; });
          labels[index].style.opacity = clamp((share - .75) / .25);
          paths[index].style.strokeDashoffset = 1 - share;
          piece.style.opacity = share > 0 ? 1 : 0;
          piece.style.scale = .35 + .65 * share;
          place(piece, onPath(paths[index], share));
        });
        part('setup')[0].classList.toggle('halo', pieces.some((_, index) => within(time, flight(index), flight(index) + trip)));
        const built = flight(pieces.length - 1) + trip;
        part('frame')[0].classList.toggle('built', time >= built);
      });
    },

    agents: (art, tl) => {
      const part = name => art.querySelector(`[data-n="${name}"]`);
      const edge = (from, to) => art.querySelector(`[data-n-edge="${from} ${to}"]`) || art.querySelector(`[data-n-edge="${to} ${from}"]`);
      const mails = [...art.querySelectorAll('[data-n-mail]')];
      const kinds = { you: 'person', a1: 'agent', a2: 'agent', s1: 'script', s2: 'script', m1: 'app', m2: 'app' };
      const slots = [
        [['you', 'a1']],
        [['a1', 'a2'], ['a1', 's1'], ['you', 'm2']],
        [['a2', 's2'], ['s1', 'm1'], ['m2', 'a2']],
        [['s2', 's1'], ['m1', 'you'], ['a1', 'm1']],
        [['s2', 'm2'], ['a2', 'you']]
      ];
      const trip = 1;
      const trips = slots.flatMap((pairs, slot) => pairs.map(([from, to], lane) => ({ from, to, lane, start: .4 + slot * 1.25 + lane * .2 })));
      const total = Math.max(...trips.map(({ start }) => start)) + trip + .6;
      clock(tl, total, time => {
        const active = trips.filter(({ start }) => within(time, start, start + trip + .3));
        trips.forEach(({ from, to, start }) => {
          const path = edge(from, to);
          const share = smooth(clamp((time - start) / trip));
          path.style.strokeDashoffset = path.dataset.nEdge === `${from} ${to}` ? 1 - share : share - 1;
        });
        mails.forEach((mail, lane) => {
          const current = active.find(item => item.lane === lane);
          const share = current ? smooth(clamp((time - current.start) / trip)) : 0;
          mail.style.opacity = share > 0 && share < 1 ? 1 : 0;
          if (!current) return;
          const path = edge(current.from, current.to);
          mail.dataset.from = kinds[current.from];
          place(mail, onPath(path, path.dataset.nEdge === `${current.from} ${current.to}` ? share : 1 - share));
        });
        Object.keys(kinds).forEach(name => part(name).classList.toggle('halo', active.some(({ from, to }) => from === name || to === name)));
      });
    },

    ui: (art, tl) => {
      const part = name => art.querySelector(`[data-u="${name}"]`);
      const canvas = art.querySelector('.art-canvas');
      const rows = [...art.querySelectorAll('[data-u-row]')];
      const boxes = rows.map(row => row.querySelector('.u-box'));
      const agent = part('agent');
      const homes = { agent: agent.querySelector('.u-face'), you: art.querySelector('.u-actor.person .u-face') };
      const T = { built: 2.9, tick1: 4.4, tick2: 7, press: 8.2, heard: 9.4, answer: 10.4, tick3: 11.5, end: 13 };
      const visits = {
        agent: [[[3, null], [4.2, boxes[0]], [4.7, boxes[0]], [5.6, null]], [[T.answer, null], [11.3, boxes[2]], [11.8, boxes[2]], [12.7, null]]],
        you: [[[5.8, null], [6.8, boxes[1]], [7.3, boxes[1]], [8, part('go')], [8.5, part('go')], [9.3, null]]]
      };
      const follow = (pointer, name, time) => {
        const visit = visits[name].find(keys => within(time, keys[0][0], keys[keys.length - 1][0]));
        pointer.style.opacity = visit ? Math.min(clamp((time - visit[0][0]) / .3), clamp((visit[visit.length - 1][0] - time) / .3)) : 0;
        if (!visit) return;
        const index = visit.reduce((found, [mark], position) => time >= mark ? position : found, 0);
        const [from, a] = visit[index];
        const [to, b] = visit[Math.min(index + 1, visit.length - 1)];
        const start = center(canvas, a || homes[name]);
        const end = center(canvas, b || homes[name]);
        const share = to > from ? smooth(clamp((time - from) / (to - from))) : 0;
        place(pointer, { x: start.x + (end.x - start.x) * share, y: start.y + (end.y - start.y) * share });
      };
      tl.fromTo(part('note'), { autoAlpha: 0 }, { autoAlpha: 1, duration: .5 }, .3);
      draw(tl, part('outline'), .3, 1.1, 'none');
      tl.fromTo(part('panel'), { autoAlpha: 0 }, { autoAlpha: 1, duration: .4, ease: 'none' }, 1.3);
      tl.to(part('outline'), { opacity: 0, duration: .3, ease: 'none' }, 1.6);
      const [bar, foot] = art.querySelectorAll('[data-u-part]');
      [bar, ...rows, foot].forEach((element, index) => {
        tl.fromTo(element, { autoAlpha: 0, y: 6 }, { autoAlpha: 1, y: 0, duration: .35 }, 1.5 + index * .28);
      });
      draw(tl, part('wire'), T.press + .1, T.heard - T.press - .1, 'power1.inOut');
      travel(tl, part('packet'), part('wire'), T.press + .1, { duration: T.heard - T.press - .1 });
      tl.to(part('wire'), { opacity: 0, duration: .5, ease: 'none' }, T.answer);
      clock(tl, T.end, time => {
        const owners = [time >= T.tick1 ? 'agent' : '', time >= T.tick2 ? 'you' : '', time >= T.tick3 ? 'agent' : ''];
        rows.forEach((row, index) => {
          if (owners[index]) row.dataset.by = owners[index];
          else delete row.dataset.by;
          row.classList.toggle('flash', within(time, [T.tick1, T.tick2, T.tick3][index], [T.tick1, T.tick2, T.tick3][index] + .6));
        });
        part('count').textContent = `${owners.filter(Boolean).length} / 3`;
        part('go').classList.toggle('pressed', Math.abs(time - T.press) < .15);
        agent.classList.toggle('thinking', within(time, .3, T.built) || within(time, T.heard, T.answer));
        blink(art, time);
        follow(part('ptr-agent'), 'agent', time);
        follow(part('ptr-you'), 'you', time);
      });
    },

    typescript: (art, tl) => {
      const tabs = [...art.querySelectorAll('[data-tsx-tab]')];
      const panes = [...art.querySelectorAll('[data-tsx-pane]')];
      const press = art.querySelector('[data-tsx-press]');
      const at = index => .4 + index * 2;
      const current = time => panes.reduce((found, _pane, index) => time >= at(index) - .4 ? index : found, 0);
      tl.set(panes.slice(1), { autoAlpha: 0 }, 0);
      panes.slice(1).forEach((pane, offset) => {
        tl.to(panes[offset], { autoAlpha: 0, duration: .15, ease: 'none' }, at(offset + 1) - .35);
        tl.fromTo(pane, { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: .4 }, at(offset + 1) - .2);
      });
      tl.to(press, { scale: .9, duration: .2, yoyo: true, repeat: 1, ease: 'power1.inOut' }, at(2) + 1);
      clock(tl, at(3) + 1.2, time => {
        const index = current(time);
        tabs.forEach((tab, position) => tab.classList.toggle('on', position === index));
        panes[1].classList.toggle('fixed', time >= at(1) + 1.1);
      });
    },

    events: (art, tl) => {
      const rows = [...art.querySelectorAll('[data-j-row]')];
      const list = art.querySelector('[data-j-list]');
      const foot = art.querySelector('[data-j-foot]');
      const first = 3;
      let shown = -1;
      clock(tl, rows.length - first + 1, time => {
        const count = Math.min(rows.length, first + Math.floor(time));
        if (count === shown) return;
        shown = count;
        rows.forEach((row, index) => {
          row.classList.toggle('on', index < count);
          row.classList.toggle('jr-lit', index === count - 1 && row.classList.contains('jr-flash'));
        });
        const hidden = rows.slice(count).reduce((sum, row) => sum + row.offsetHeight, 0);
        list.style.transform = `translateY(${hidden}px)`;
        const note = rows.slice(0, count).reverse().find(row => row.dataset.jNote);
        foot.innerHTML = note ? note.dataset.jNote : '';
      });
    },

    workflows: (art, tl) => {
      const cards = [...art.querySelectorAll('[data-wf-card]')];
      const edge = name => art.querySelector(`[data-wf="${name}"]`);
      const packet = art.querySelector('[data-packet]');
      const round = art.querySelector('[data-wf-round]');
      const [notes, approved, merged] = ['notes', 'ok', 'merged'].map(name => art.querySelector(`[data-wf-${name}]`));
      const [opened, tests, review, fix, merge] = cards;
      const hops = [['open', .3], ['test', 1.5], ['fix', 3.1], ['retest', 4.3], ['test', 5.5], ['merge', 7.1]];
      const visits = [[opened, 0, .4], [tests, 1.1, 1.6], [review, 2.3, 3.1], [fix, 3.9, 4.3], [tests, 5.1, 5.5], [review, 6.3, 7.1], [merge, 7.9, 8.6]];
      tl.set([notes, approved, merged], { autoAlpha: 0 }, 0);
      hops.forEach(([name, at]) => travel(tl, packet, edge(name), at, { duration: .8 }));
      pop(tl, notes, 2.8);
      tl.to(notes, { autoAlpha: 0, duration: .2 }, 5.5);
      pop(tl, approved, 6.8);
      pop(tl, merged, 8.2);
      clock(tl, 8.8, time => {
        cards.forEach(card => card.classList.toggle('halo', visits.some(([target, from, to]) => target === card && time >= from && time < to)));
        round.textContent = `round ${time >= 4.9 ? 2 : 1} of max 3`;
      });
    },

    distributed: (art, tl) => {
      const part = name => art.querySelector(`[data-d="${name}"]`);
      const link = key => art.querySelector(`[data-d-link="${key}"]`);
      const run = key => art.querySelector(`[data-d-run="${key}"]`);
      const runs = { l1: 'a', l2: 'b', web: 'c' };
      const lanes = { l1: 0, l2: .9, web: 1.8 };
      const T = { live: 2.4, think: 4.6, task: 5.2, arrive: 6.4, result: 8.6, back: 9.8, quiet: 13, end: 13.6 };
      const period = 3;
      const cycle = { send: 1, think: .6 };
      const busy = [T.think, T.back];
      const show = (element, key, share, visible) => {
        element.style.opacity = visible ? 1 : 0;
        if (visible) place(element, onPath(link(key), share));
      };
      pop(tl, [...art.querySelectorAll('[data-d-run]')], .3, { stagger: .3 });
      [...art.querySelectorAll('[data-d-client]')].forEach((client, index) => {
        tl.fromTo([client, art.querySelectorAll('.d-link')[index]], { autoAlpha: 0 }, { autoAlpha: 1, duration: .5, ease: 'none' }, 1.3 + index * .3);
      });
      clock(tl, T.end, time => {
        const thinking = new Set();
        Object.keys(runs).forEach(key => {
          const round = Math.floor((time - T.live - lanes[key]) / period);
          const begin = T.live + lanes[key] + round * period;
          const local = time - begin;
          const ends = begin + cycle.send * 2 + cycle.think;
          const allowed = round >= 0 && ends <= T.quiet && !(key === 'l1' && ends > busy[0] && begin < busy[1]);
          const up = local / cycle.send;
          const down = (local - cycle.send - cycle.think) / cycle.send;
          show(art.querySelector(`[data-d-up="${key}"]`), key, smooth(clamp(up)), allowed && up > 0 && up < 1);
          show(art.querySelector(`[data-d-down="${key}"]`), key, 1 - smooth(clamp(down)), allowed && down > 0 && down < 1);
          if (allowed && up >= 1 && down <= 0) thinking.add(runs[key]);
        });
        if (within(time, T.think, T.task)) thinking.add('a');
        ['a', 'b', 'c'].forEach(key => run(key).classList.toggle('thinking', thinking.has(key)));
        part('models').classList.toggle('halo', thinking.size > 0);
        const task = (time - T.task) / (T.arrive - T.task);
        const result = (time - T.result) / (T.back - T.result);
        show(part('task'), 'l1', 1 - smooth(clamp(task)), task > 0 && task < 1);
        show(part('result'), 'l1', smooth(clamp(result)), result > 0 && result < 1);
        art.querySelector('[data-d-client="l1"]').classList.toggle('busy', within(time, T.arrive, T.result));
        art.querySelector('[data-d-client="l1"]').classList.toggle('halo', within(time, T.arrive, T.result));
        part('tools').style.opacity = clamp((time - T.arrive + .3) / .3) * clamp((T.back + .6 - time) / .4);
        part('work').style.setProperty('--done', clamp((time - T.arrive) / (T.result - T.arrive - .3)));
        run('a').classList.toggle('done', time >= T.back);
        blink(art, time);
      });
    }
  };

  const absoluteTop = element => element.getBoundingClientRect().top + scrollY;
  const timelines = Object.entries(scenes).map(([name, build]) => {
    const art = story.querySelector(`[data-art="${name}"]`);
    const tl = gsap.timeline({ paused: true, defaults: { ease: 'power2.out', lazy: false } });
    build(art, tl);
    return { name, art, tl };
  });

  const ticker = list => {
    const lines = [...list.children].map(item => item.textContent);
    const element = document.createElement('div');
    element.className = 'story-ticker';
    element.setAttribute('aria-hidden', 'true');
    element.innerHTML = `<p></p><span>${lines.map(() => '<i></i>').join('')}</span>`;
    const text = element.querySelector('p');
    const dots = [...element.querySelectorAll('i')];
    let shown = -1;
    const show = progress => {
      const index = Math.min(lines.length - 1, Math.floor(progress * lines.length));
      if (index === shown) return;
      shown = index;
      text.textContent = lines[index];
      dots.forEach((dot, position) => dot.classList.toggle('on', position === index));
    };
    show(0);
    return { element, show };
  };

  const media = gsap.matchMedia();
  media.add({ motion: '(prefers-reduced-motion: no-preference)', wide: '(min-width: 960px)' }, context => {
    if (!context.conditions.motion) return;
    const { wide } = context.conditions;
    const bars = [document.querySelector('.masthead'), document.querySelector('.subnav')].filter(Boolean);
    const runs = { setups: 2.4, agents: 2, ui: 3, typescript: 2, events: 2.6, workflows: 2.2, distributed: 2.8 };
    const items = timelines.map(({ name, art, tl }, index) => {
      const scene = art.closest('.story-scene');
      const step = document.getElementById(name);
      const mark = document.createComment('');
      const track = document.createElement('div');
      const stick = document.createElement('div');
      const bullets = ticker(step.querySelector('.feature-benefits'));
      track.className = 'story-scene-track';
      stick.className = 'story-stick';
      track.style.setProperty('--story-index', index);
      scene.before(mark);
      if (wide) mark.before(track);
      else step.querySelector('h3').after(track);
      stick.append(scene, bullets.element);
      track.append(stick);
      return { name, tl, scene, step, mark, track, stick, bullets };
    });
    const probe = document.createElement('div');
    probe.style.cssText = 'position: fixed; top: 0; height: 100svh; visibility: hidden; pointer-events: none;';
    document.body.append(probe);
    const plan = ({ name, stick }) => {
      const inset = bars.reduce((sum, bar) => sum + bar.offsetHeight, 0);
      const view = probe.offsetHeight;
      const room = view - inset;
      const height = stick.offsetHeight;
      const run = height + 16 <= room ? Math.round(runs[name] * view) : 0;
      return { inset, room, top: Math.round(inset + Math.max(8, (room - height) / 2)), height, run };
    };
    const arrange = () => document.documentElement.hasAttribute('data-menu-open') || items.forEach(item => {
      const { inset, room, top, height, run } = plan(item);
      const copy = item.step.querySelector('.feature-copy');
      item.stick.style.setProperty('--scene-top', `${top}px`);
      if (wide) item.step.style.setProperty('--copy-top', `${Math.round(inset + Math.max(8, (room - copy.offsetHeight) / 2))}px`);
      item.track.style.height = run > 0 ? `${Math.ceil(height + run)}px` : '';
    });
    const start = item => {
      const { top, run } = plan(item);
      return run > 0 ? absoluteTop(item.track) - top : absoluteTop(item.track) - innerHeight * .85;
    };
    const end = item => {
      const { run } = plan(item);
      return run > 0 ? start(item) + run : absoluteTop(item.track) + item.stick.offsetHeight * .7 - innerHeight * .5;
    };
    const resized = new ResizeObserver(() => ScrollTrigger.refresh());
    arrange();
    ScrollTrigger.addEventListener('refreshInit', arrange);
    items.forEach(item => {
      resized.observe(item.stick);
      ScrollTrigger.create({
        animation: item.tl, scrub: true, invalidateOnRefresh: true, start: () => start(item), end: () => end(item),
        onUpdate: self => item.bullets.show(self.progress)
      });
    });
    return () => {
      probe.remove();
      resized.disconnect();
      ScrollTrigger.removeEventListener('refreshInit', arrange);
      items.forEach(({ scene, step, mark, track, bullets }) => {
        step.style.removeProperty('--copy-top');
        mark.replaceWith(scene);
        bullets.element.remove();
        track.remove();
      });
    };
  });
  media.add('(prefers-reduced-motion: reduce)', () => {
    timelines.forEach(({ tl }) => tl.progress(1));
  });
})();
