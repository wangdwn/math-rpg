/* 数学答题 RPG · 司马平的修炼之路 */
(async function () {
  const $view = document.getElementById('view');
  const $bar = document.getElementById('progressBar');
  const STORE_KEY = 'mathrpg_progress_v1';

  let dungeons = [];
  let cards = [];
  let state = {};

  try {
    const [dRes, cRes] = await Promise.all([
      fetch('data/dungeons.json'),
      fetch('data/cards.json')
    ]);
    if (!dRes.ok || !cRes.ok) throw new Error('content fetch failed');
    dungeons = (await dRes.json()).dungeons || [];
    cards = (await cRes.json()).cards || [];
  } catch (e) {
    $view.innerHTML = '<div class="empty">数据加载失败，请确认文件存在（data/dungeons.json, data/cards.json）</div>';
    return;
  }

  function loadState() {
    try { state = JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { state = {}; }
    state.dungeons = state.dungeons || {};
    state.loots = state.loots || [];
    state.cards = state.cards || {};
  }
  function saveState() { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  // 答案判定：数字答案精确匹配输入中的任一数字；文本答案看包含
  function checkAnswer(input, answers) {
    const clean = String(input).replace(/\s/g, '');
    return answers.some(a => {
      const s = String(a);
      if (/^-?\d+(\.\d+)?$/.test(s)) {
        const nums = (clean.match(/-?\d+(\.\d+)?/g) || []).map(parseFloat);
        const target = parseFloat(s);
        return nums.some(n => Math.abs(n - target) < 1e-9);
      }
      return (() => {
        const idx = clean.indexOf(s);
        if (idx === -1) return false;
        return clean[idx - 1] !== '不'; // 被「不」否定则不算命中
      })();
    });
  }
  function dungeonById(id) { return dungeons.find(d => d.id === id); }
  function cardById(id) { return cards.find(c => c.id === id); }
  function isCleared(did) { return !!(state.dungeons[did] && state.dungeons[did].cleared); }
  function clearPct() {
    if (!dungeons.length) return 0;
    return Math.round(dungeons.filter(d => isCleared(d.id)).length / dungeons.length * 100);
  }

  function updateBar() {
    const pct = clearPct();
    $bar.innerHTML = `<div class="progress-fill" style="width:${pct}%"></div>`;
    $bar.title = `副本通关 ${pct}%`;
  }

  /* ---------- 路由 ---------- */
  function router() {
    const hash = location.hash || '#/';
    const m = hash.match(/^#\/dungeon\/([\w-]+)/);
    if (m) return renderDungeon(m[1]);
    const cm = hash.match(/^#\/cards(?:\/([\w-]+))?/);
    if (cm) return renderCards(cm[1] || '');
    renderHome();
  }

  /* ---------- 大厅 ---------- */
  function renderHome() {
    let html = '<h1 class="page-title">副本大厅</h1><p class="sub">打副本学新招，通关解锁复习卡片。</p><div class="dungeon-list">';
    if (!dungeons.length) {
      html += '<div class="empty">还没有副本，等老师来建。</div>';
    }
    dungeons.forEach(d => {
      const cleared = isCleared(d.id);
      html += `<a class="dungeon" href="#/dungeon/${d.id}">
        <span class="d-status ${cleared ? 'cleared' : 'open'}">${cleared ? '✅ 已通关' : '⚔️ 可挑战'}</span>
        <span class="d-tag">${esc(d.topic)} · ${esc(d.grade)}</span>
        <div class="d-name">${esc(d.name)}</div>
        <div class="d-intro">${esc(d.intro)}</div>
        <div class="d-meta">${d.levels.length} 关 · 解锁 ${d.card_ids.length} 张卡片</div>
      </a>`;
    });
    html += '</div>';
    if (state.loots.length) {
      html += '<h1 class="page-title" style="margin-top:26px">🎒 收集的口诀</h1><div class="card">';
      state.loots.forEach(l => { html += `<div style="margin-bottom:10px;line-height:1.7">${esc(l)}</div>`; });
      html += '</div>';
    }
    $view.innerHTML = html;
  }

  /* ---------- 副本闯关 ---------- */
  const session = {}; // 当前副本会话 { did, level, cleared:boolean[] }

  function renderDungeon(did) {
    const d = dungeonById(did);
    if (!d) { $view.innerHTML = '<div class="empty">副本不存在</div>'; return; }
    session.did = did;
    session.level = 0;
    session.cleared = d.levels.map((_, i) => isCleared(did) ? true : (i === 0));
    session.cleared.fill(false);
    if (isCleared(did)) { /* 重打重新开始，但保留已通关标记 */ }
    drawDungeon();
  }

  function drawDungeon() {
    const d = dungeonById(session.did);
    const lv = d.levels[session.level];
    const stages = d.levels.map((_, i) =>
      `<div class="stage-dot ${i < session.level ? 'done' : (i === session.level ? 'now' : '')}"></div>`).join('');

    $view.innerHTML = `
      <div class="dungeon-header">
        <a class="back" href="#/">← 回大厅</a>
        <h1>${esc(d.name)}</h1>
        <div class="d-intro">第 ${session.level + 1} / ${d.levels.length} 关</div>
      </div>
      <div class="stage-indicator">${stages}</div>
      <div class="card level-box" id="levelBox">
        <div class="monster">${esc(lv.monster)}</div>
        <div class="question">${esc(lv.question)}</div>
        <div class="answer-row">
          <input type="text" id="ansInput" placeholder="输入你的答案" autocomplete="off">
          <button class="btn primary" id="ansBtn">⚔️ 出招</button>
        </div>
        <div class="feedback" id="fb"></div>
      </div>`;

    const input = document.getElementById('ansInput');
    const btn = document.getElementById('ansBtn');
    const fb = document.getElementById('fb');
    input.focus();
    input.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
    btn.addEventListener('click', submit);

    function submit() {
      const val = input.value.trim();
      if (!val) return;
      const ok = checkAnswer(val, lv.answers);
      if (ok) {
        fb.className = 'feedback right';
        fb.innerHTML = `<div class="fb-title">💥 击败 ${esc(lv.name.replace(/^第.关·/, ''))} 的怪物！</div>${esc(lv.loot)}`;
        session.cleared[session.level] = true;
        btn.disabled = true;
        input.disabled = true;
        const nextBtn = document.createElement('button');
        nextBtn.className = 'btn primary';
        nextBtn.style.marginTop = '14px';
        nextBtn.textContent = session.level + 1 < d.levels.length ? '⚔️ 下一关' : '🏆 见 BOSS 奖励';
        nextBtn.addEventListener('click', () => {
          if (session.level + 1 < d.levels.length) {
            session.level++;
            drawDungeon();
          } else {
            finishDungeon();
          }
        });
        fb.appendChild(document.createElement('br'));
        fb.appendChild(nextBtn);
      } else {
        fb.className = 'feedback wrong';
        fb.innerHTML = `<div class="fb-title">💢 被怪物打回来了</div>${esc(lv.hint)}`;
        input.value = '';
        input.focus();
      }
    }
  }

  function finishDungeon() {
    const d = dungeonById(session.did);
    const cleared = isCleared(session.did);
    if (!cleared) {
      state.dungeons[session.did] = { cleared: true, date: new Date().toISOString().slice(0, 10) };
      d.levels.forEach(lv => {
        const firstLine = lv.loot.split('\n')[0].replace(/^🎁\s*/, '');
        if (!state.loots.includes(firstLine)) state.loots.push(firstLine);
      });
      saveState();
      updateBar();
    }
    $view.innerHTML = `
      <div class="victory">
        <div class="v-emoji">🏆</div>
        <h2>${cleared ? '再次通关！' : '副本通关！'}</h2>
        <div class="v-text">${esc(d.summary)}</div>
        <button class="btn primary" id="unlockBtn">🔓 解锁 ${d.card_ids.length} 张复习卡</button>
        <div class="unlock">已解锁：${d.card_ids.map(id => {
          const c = cardById(id);
          const title = esc((c || { title: id }).title);
          return c ? `<a href="#/cards/${id}">${title}</a>` : title;
        }).join('、')}</div>
        <div style="margin-top:18px"><a class="back" href="#/">← 回大厅</a></div>
      </div>`;
    document.getElementById('unlockBtn').addEventListener('click', () => {
      d.card_ids.forEach(id => { state.cards[id] = { unlocked: true }; });
      saveState();
      location.hash = d.card_ids[0] ? `#/cards/${d.card_ids[0]}` : '#/cards';
    });
  }

  /* ---------- 卡片库 ---------- */
  let cardFilter = '全部';
  function renderCards(focusId) {
    const focusCard = focusId ? cardById(focusId) : null;
    if (focusCard) cardFilter = '全部';
    const tags = ['全部', ...new Set(cards.map(c => c.tag))];
    const list = cardFilter === '全部' ? cards : cards.filter(c => c.tag === cardFilter);
    let html = '<h1 class="page-title">复习卡片库</h1><p class="sub">点开卡片做自检，卡壳了就回副本重打那一关。</p>';
    html += '<div class="filter-row">' + tags.map(t =>
      `<span class="filter-chip ${t === cardFilter ? 'active' : ''}" data-tag="${esc(t)}">${esc(t)}</span>`).join('') + '</div>';

    if (focusId && !focusCard) {
      html += `<div class="empty">找不到卡片 ${esc(focusId)}，下面是全部卡片。</div>`;
    }
    if (!list.length) html += '<div class="empty">这个分类下还没有卡片</div>';
    list.forEach(c => {
      const unlocked = !!(state.cards[c.id] && state.cards[c.id].unlocked);
      const relDungeons = dungeons.filter(d => d.card_ids.includes(c.id));
      const rpgHtml = relDungeons.map(d => {
        const cl = isCleared(d.id);
        return cl
          ? `✅ 已通关 <a href="#/dungeon/${d.id}">${esc(d.name)}</a>`
          : `🔒 先打副本 <a href="#/dungeon/${d.id}">${esc(d.name)}</a> 解锁`;
      }).join('<br>');
      const isFocus = focusCard && c.id === focusCard.id;
      html += `
        <div class="card card-item${isFocus ? ' open target' : ''}" data-cid="${esc(c.id)}" id="card-${esc(c.id)}">
          <div class="c-top">
            <span class="c-tag">${esc(c.tag)}</span>
            <span class="c-time">${esc(c.time_estimate)}</span>
          </div>
          <div class="c-title">${esc(c.title)}</div>
          <div class="c-badge">${unlocked ? '🔓 副本已解锁' : '📖 普通卡片'}</div>
          <div class="c-body">
            ${esc(c.content)}
            <div class="c-answer">${esc(c.answer)}</div>
            ${rpgHtml ? `<div class="c-rpg">${rpgHtml}</div>` : ''}
          </div>
        </div>`;
    });
    $view.innerHTML = html;

    $view.querySelectorAll('.filter-chip').forEach(chip => {
      chip.addEventListener('click', () => { cardFilter = chip.dataset.tag; renderCards(); });
    });
    $view.querySelectorAll('.card-item').forEach(item => {
      item.addEventListener('click', e => {
        if (e.target.closest('a')) return;
        item.classList.toggle('open');
      });
    });
    if (focusCard) {
      requestAnimationFrame(() => {
        const el = document.getElementById('card-' + focusCard.id);
        if (el) el.scrollIntoView({ block: 'center' });
      });
    }
  }

  /* ---------- 导航高亮 + 启动 ---------- */
  function highlightNav() {
    const h = location.hash || '#/';
    document.querySelectorAll('.nav-btn[data-nav]').forEach(b => b.classList.remove('active'));
    const key = h.startsWith('#/cards') ? 'cards' : 'home';
    const btn = document.querySelector(`.nav-btn[data-nav="${key}"]`);
    if (btn) btn.classList.add('active');
  }

  window.addEventListener('hashchange', () => {
    highlightNav();
    router();
    if (!/^#\/cards\/[\w-]+/.test(location.hash || '')) window.scrollTo(0, 0);
  });

  loadState();
  updateBar();
  highlightNav();
  router();
})();
