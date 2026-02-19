(function () {
  const themeTableBody = document.getElementById('themeTableBody');
  const addThemeRowBtn = document.getElementById('addThemeRowBtn');
  const saveThemesBtn = document.getElementById('saveThemesBtn');
  const standsIcaoInput = document.getElementById('standsIcaoInput');
  const loadStandsBtn = document.getElementById('loadStandsBtn');
  const saveStandsBtn = document.getElementById('saveStandsBtn');
  const standsEditor = document.getElementById('standsEditor');
  const statusBar = document.getElementById('statusBar');

  let themeOptions = [];

  function setStatus(message, type) {
    statusBar.textContent = message;
    statusBar.className = 'status';
    if (type) statusBar.classList.add(type);
  }

  function normalizeIcao(value) {
    return String(value || '').trim().toUpperCase();
  }

  function createThemeRow(icao, config) {
    const tr = document.createElement('tr');

    const tdIcao = document.createElement('td');
    const icaoInput = document.createElement('input');
    icaoInput.maxLength = 4;
    icaoInput.placeholder = 'ICAO';
    icaoInput.value = normalizeIcao(icao);
    tdIcao.appendChild(icaoInput);

    const tdCss = document.createElement('td');
    const cssSelect = document.createElement('select');
    themeOptions.forEach(option => {
      const el = document.createElement('option');
      el.value = option.css;
      el.textContent = option.name;
      cssSelect.appendChild(el);
    });
    cssSelect.value = (config && config.css) || '/static/css/themes/default.css';
    tdCss.appendChild(cssSelect);

    const tdClass = document.createElement('td');
    const classInput = document.createElement('input');
    classInput.placeholder = 'theme-xxxx';
    classInput.value = (config && config.class) || '';
    tdClass.appendChild(classInput);

    const tdAction = document.createElement('td');
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'row-remove';
    removeBtn.textContent = 'Remove';
    removeBtn.addEventListener('click', () => tr.remove());
    tdAction.appendChild(removeBtn);

    tr.appendChild(tdIcao);
    tr.appendChild(tdCss);
    tr.appendChild(tdClass);
    tr.appendChild(tdAction);
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
    const rows = Array.from(themeTableBody.querySelectorAll('tr'));
    const map = {};

    rows.forEach(row => {
      const inputs = row.querySelectorAll('input, select');
      const icao = normalizeIcao(inputs[0].value);
      const css = String(inputs[1].value || '').trim();
      const cssClass = String(inputs[2].value || '').trim();
      if (!icao) return;
      map[icao] = { css, class: cssClass };
    });

    return map;
  }

  async function saveThemeMap() {
    const payload = { theme_map: collectThemeMap() };
    const response = await fetch('/api/admin/theme_map', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Save failed');
    setStatus('Theme map saved.', 'ok');
    await loadThemeMap();
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

    standsEditor.value = JSON.stringify(data.stands, null, 2);
    setStatus('Loaded stands for ' + icao + '.', 'ok');
  }

  async function saveStands() {
    const icao = normalizeIcao(standsIcaoInput.value);
    if (icao.length !== 4) {
      setStatus('Enter a valid 4-letter ICAO.', 'error');
      return;
    }

    let stands;
    try {
      stands = JSON.parse(standsEditor.value || '[]');
    } catch (e) {
      setStatus('Stands JSON is invalid.', 'error');
      return;
    }

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

  addThemeRowBtn.addEventListener('click', () => createThemeRow('', { css: '/static/css/themes/default.css', class: '' }));
  saveThemesBtn.addEventListener('click', () => saveThemeMap().catch(err => setStatus(err.message, 'error')));
  loadStandsBtn.addEventListener('click', () => loadStands().catch(err => setStatus(err.message, 'error')));
  saveStandsBtn.addEventListener('click', () => saveStands().catch(err => setStatus(err.message, 'error')));

  (async function init() {
    try {
      await loadThemeOptions();
      await loadThemeMap();
      setStatus('Admin ready.', 'ok');
    } catch (e) {
      setStatus(e.message, 'error');
    }
  })();
})();
