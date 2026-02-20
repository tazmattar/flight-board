(function () {
  // ── Element refs ──────────────────────────────────────────────────────────
  const standsIcaoInput    = document.getElementById('standsIcaoInput');
  const loadStandsBtn      = document.getElementById('loadStandsBtn');
  const addStandRowBtn     = document.getElementById('addStandRowBtn');
  const saveStandsBtn      = document.getElementById('saveStandsBtn');
  const standsTableBody    = document.getElementById('standsTableBody');
  const standsCountLabel   = document.getElementById('standsCountLabel');
  const standsJsonToggle   = document.getElementById('standsJsonToggle');
  const standsJsonEditor   = document.getElementById('standsJsonEditor');
  const applyJsonBtn       = document.getElementById('applyJsonBtn');

  const themeTableBody     = document.getElementById('themeTableBody');
  const addThemeRowBtn     = document.getElementById('addThemeRowBtn');
  const saveThemesBtn      = document.getElementById('saveThemesBtn');

  const refreshTrafficBtn         = document.getElementById('refreshTrafficBtn');
  const trafficTotalPageViews     = document.getElementById('trafficTotalPageViews');
  const trafficTotalUniqueVisitors= document.getElementById('trafficTotalUniqueVisitors');
  const trafficTodayPageViews     = document.getElementById('trafficTodayPageViews');
  const trafficTodayUniqueVisitors= document.getElementById('trafficTodayUniqueVisitors');
  const trafficTopPaths           = document.getElementById('trafficTopPaths');
  const trafficTopAirports        = document.getElementById('trafficTopAirports');
  const trafficSevenDayBody       = document.getElementById('trafficSevenDayBody');

  const statusBar = document.getElementById('statusBar');

  let themeOptions = [];

  // ── Utilities ─────────────────────────────────────────────────────────────
  function setStatus(message, type) {
    statusBar.textContent = message;
    statusBar.className = 'status';
    if (type) statusBar.classList.add(type);
  }

  function normalizeIcao(value) {
    return String(value || '').trim().toUpperCase();
  }

  // ── Tab switching ─────────────────────────────────────────────────────────
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-' + target).classList.add('active');
    });
  });

  // ── Stands: table-based editor ────────────────────────────────────────────
  function createStandRow(stand) {
    const tr = document.createElement('tr');

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = 'e.g. A1';
    nameInput.value = stand.name || '';

    const latInput = document.createElement('input');
    latInput.type = 'number';
    latInput.step = '0.000001';
    latInput.placeholder = '47.000000';
    latInput.value = stand.lat !== undefined ? stand.lat : '';

    const lonInput = document.createElement('input');
    lonInput.type = 'number';
    lonInput.step = '0.000001';
    lonInput.placeholder = '8.000000';
    lonInput.value = stand.lon !== undefined ? stand.lon : '';

    const radiusInput = document.createElement('input');
    radiusInput.type = 'number';
    radiusInput.step = '1';
    radiusInput.min = '1';
    radiusInput.placeholder = '40';
    radiusInput.value = stand.radius !== undefined ? stand.radius : 40;

    const typeSelect = document.createElement('select');
    ['contact', 'remote'].forEach(t => {
      const opt = document.createElement('option');
      opt.value = t;
      opt.textContent = t.charAt(0).toUpperCase() + t.slice(1);
      typeSelect.appendChild(opt);
    });
    typeSelect.value = stand.type || 'contact';

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'row-remove';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => {
      tr.remove();
      updateStandsCount();
    });

    [nameInput, latInput, lonInput, radiusInput, typeSelect, removeBtn].forEach(el => {
      const td = document.createElement('td');
      td.appendChild(el);
      tr.appendChild(td);
    });

    return tr;
  }

  function renderStandsTable(stands) {
    standsTableBody.innerHTML = '';
    stands.forEach(stand => standsTableBody.appendChild(createStandRow(stand)));
    updateStandsCount();
  }

  function updateStandsCount() {
    const count = standsTableBody.querySelectorAll('tr').length;
    standsCountLabel.textContent = count > 0 ? count + ' stands' : '';
  }

  function collectStands() {
    return Array.from(standsTableBody.querySelectorAll('tr')).map(row => {
      const inputs = row.querySelectorAll('input, select');
      return {
        name:   String(inputs[0].value || '').trim(),
        lat:    parseFloat(inputs[1].value),
        lon:    parseFloat(inputs[2].value),
        radius: parseFloat(inputs[3].value) || 40,
        type:   inputs[4].value
      };
    }).filter(s => s.name && !isNaN(s.lat) && !isNaN(s.lon));
  }

  async function loadStands() {
    const icao = normalizeIcao(standsIcaoInput.value);
    if (icao.length !== 4) {
      setStatus('Enter a valid 4-letter ICAO.', 'error');
      return;
    }

    const response = await fetch('/api/admin/stands/' + icao);
    const data = await response.json();
    if (!response.ok) {
      setStatus(data.error || 'Failed to load stands.', 'error');
      return;
    }

    renderStandsTable(data.stands);
    // If the JSON toggle is open, sync it
    if (standsJsonToggle.open) {
      standsJsonEditor.value = JSON.stringify(data.stands, null, 2);
    }
    setStatus('Loaded ' + data.stands.length + ' stands for ' + icao + '.', 'ok');
  }

  async function saveStands() {
    const icao = normalizeIcao(standsIcaoInput.value);
    if (icao.length !== 4) {
      setStatus('Enter a valid 4-letter ICAO.', 'error');
      return;
    }

    const stands = collectStands();
    const response = await fetch('/api/admin/stands/' + icao, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stands })
    });

    const data = await response.json();
    if (!response.ok) {
      setStatus(data.error || 'Failed to save stands.', 'error');
      return;
    }

    setStatus('Saved ' + data.stands_count + ' stands for ' + icao + '.', 'ok');
  }

  // Sync JSON textarea when the toggle is opened
  standsJsonToggle.addEventListener('toggle', () => {
    if (standsJsonToggle.open) {
      standsJsonEditor.value = JSON.stringify(collectStands(), null, 2);
    }
  });

  // Apply raw JSON back to the table
  applyJsonBtn.addEventListener('click', () => {
    let stands;
    try {
      stands = JSON.parse(standsJsonEditor.value || '[]');
      if (!Array.isArray(stands)) throw new Error('Expected an array.');
    } catch (e) {
      setStatus('Invalid JSON: ' + e.message, 'error');
      return;
    }
    renderStandsTable(stands);
    setStatus('JSON applied to table. Remember to save.', 'ok');
  });

  // Force ICAO input to uppercase as the user types
  standsIcaoInput.addEventListener('input', () => {
    const pos = standsIcaoInput.selectionStart;
    standsIcaoInput.value = standsIcaoInput.value.toUpperCase();
    standsIcaoInput.setSelectionRange(pos, pos);
  });

  loadStandsBtn.addEventListener('click',  () => loadStands().catch(e => setStatus(e.message, 'error')));
  addStandRowBtn.addEventListener('click', () => {
    standsTableBody.appendChild(createStandRow({}));
    updateStandsCount();
    // Scroll to the new row
    standsTableBody.lastElementChild.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
  saveStandsBtn.addEventListener('click',  () => saveStands().catch(e => setStatus(e.message, 'error')));

  // ── Themes ────────────────────────────────────────────────────────────────
  function createThemeRow(icao, config) {
    const tr = document.createElement('tr');

    const icaoInput = document.createElement('input');
    icaoInput.maxLength = 4;
    icaoInput.placeholder = 'ICAO';
    icaoInput.value = normalizeIcao(icao);

    const cssSelect = document.createElement('select');
    themeOptions.forEach(option => {
      const el = document.createElement('option');
      el.value = option.css;
      el.textContent = option.name;
      cssSelect.appendChild(el);
    });
    cssSelect.value = (config && config.css) || '/static/css/themes/default.css';

    const classInput = document.createElement('input');
    classInput.placeholder = 'theme-xxxx';
    classInput.value = (config && config.class) || '';

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'row-remove';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => tr.remove());

    [icaoInput, cssSelect, classInput, removeBtn].forEach(el => {
      const td = document.createElement('td');
      td.appendChild(el);
      tr.appendChild(td);
    });

    themeTableBody.appendChild(tr);
  }

  async function loadThemeOptions() {
    const response = await fetch('/api/admin/theme_options');
    if (!response.ok) throw new Error('Failed to load theme options');
    themeOptions = await response.json();
  }

  async function loadThemeMap() {
    const response = await fetch('/api/admin/theme_map');
    if (!response.ok) throw new Error('Failed to load theme map');
    const map = await response.json();
    themeTableBody.innerHTML = '';
    Object.keys(map).sort().forEach(icao => createThemeRow(icao, map[icao]));
  }

  function collectThemeMap() {
    const map = {};
    Array.from(themeTableBody.querySelectorAll('tr')).forEach(row => {
      const inputs = row.querySelectorAll('input, select');
      const icao = normalizeIcao(inputs[0].value);
      const css = String(inputs[1].value || '').trim();
      const cssClass = String(inputs[2].value || '').trim();
      if (icao) map[icao] = { css, class: cssClass };
    });
    return map;
  }

  async function saveThemeMap() {
    const response = await fetch('/api/admin/theme_map', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme_map: collectThemeMap() })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Save failed');
    setStatus('Theme map saved.', 'ok');
    await loadThemeMap();
  }

  addThemeRowBtn.addEventListener('click', () => createThemeRow('', { css: '/static/css/themes/default.css', class: '' }));
  saveThemesBtn.addEventListener('click',  () => saveThemeMap().catch(e => setStatus(e.message, 'error')));

  // ── Traffic Stats ─────────────────────────────────────────────────────────
  function formatNumber(value) {
    return Number(value || 0).toLocaleString();
  }

  function renderTopList(listEl, items, emptyText, formatter) {
    listEl.innerHTML = '';
    if (!items || items.length === 0) {
      const li = document.createElement('li');
      li.textContent = emptyText;
      listEl.appendChild(li);
      return;
    }
    items.forEach(entry => {
      const li = document.createElement('li');
      li.textContent = formatter(entry);
      listEl.appendChild(li);
    });
  }

  function renderSevenDayTable(days) {
    trafficSevenDayBody.innerHTML = '';
    if (!days || days.length === 0) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="4">No data yet.</td>';
      trafficSevenDayBody.appendChild(tr);
      return;
    }
    days.forEach(day => {
      const tr = document.createElement('tr');
      tr.innerHTML = [
        '<td>' + day.date + '</td>',
        '<td>' + formatNumber(day.page_views) + '</td>',
        '<td>' + formatNumber(day.unique_visitors) + '</td>',
        '<td>' + formatNumber(day.airport_joins) + '</td>'
      ].join('');
      trafficSevenDayBody.appendChild(tr);
    });
  }

  async function loadTrafficStats() {
    const response = await fetch('/api/admin/traffic_stats');
    if (!response.ok) throw new Error('Failed to load traffic stats');
    const data = await response.json();

    trafficTotalPageViews.textContent      = formatNumber(data.totals && data.totals.page_views);
    trafficTotalUniqueVisitors.textContent = formatNumber(data.totals && data.totals.unique_visitors);
    trafficTodayPageViews.textContent      = formatNumber(data.today && data.today.page_views);
    trafficTodayUniqueVisitors.textContent = formatNumber(data.today && data.today.unique_visitors);

    renderTopList(
      trafficTopPaths,
      data.today && data.today.top_paths,
      'No path views tracked yet.',
      entry => entry[0] + ': ' + formatNumber(entry[1])
    );
    renderTopList(
      trafficTopAirports,
      data.top_airports_7d,
      'No airport joins tracked yet.',
      entry => entry[0] + ': ' + formatNumber(entry[1])
    );
    renderSevenDayTable(data.last_7_days);
  }

  refreshTrafficBtn.addEventListener('click', () =>
    loadTrafficStats()
      .then(() => setStatus('Traffic stats refreshed.', 'ok'))
      .catch(e => setStatus(e.message, 'error'))
  );

  // ── Init ──────────────────────────────────────────────────────────────────
  (async function init() {
    try {
      await loadThemeOptions();
      await loadThemeMap();
      await loadTrafficStats();
      setStatus('Admin ready.', 'ok');
    } catch (e) {
      setStatus(e.message, 'error');
    }
  })();
})();
