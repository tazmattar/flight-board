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
  const importCsvBtn       = document.getElementById('importCsvBtn');
  const csvFileInput       = document.getElementById('csvFileInput');
  const importBanner       = document.getElementById('importBanner');
  const importSummary      = document.getElementById('importSummary');
  const importSkipBtn      = document.getElementById('importSkipBtn');
  const importOverwriteBtn = document.getElementById('importOverwriteBtn');
  const importCancelBtn    = document.getElementById('importCancelBtn');

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

  function naturalSort(a, b) {
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  }

  function renderStandsTable(stands) {
    const sorted = [...stands].sort(naturalSort);
    standsTableBody.innerHTML = '';
    sorted.forEach(stand => standsTableBody.appendChild(createStandRow(stand)));
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

  // ── CSV import ───────────────────────────────────────────────────────────
  let _pendingImport = null; // { newStands, duplicateNames }

  function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  }

  function parseCSV(text) {
    const lines = text.split(/\r?\n/).filter(l => l.trim() && !l.startsWith('#'));
    if (lines.length < 2) throw new Error('CSV must have a header row and at least one data row.');

    const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase());
    const col = name => headers.indexOf(name);

    const nameIdx   = col('name');
    const latIdx    = col('lat');
    const lonIdx    = col('lon');
    const radiusIdx = col('radius');
    const typeIdx   = col('type');

    if (nameIdx === -1 || latIdx === -1 || lonIdx === -1) {
      throw new Error('CSV must include columns: name, lat, lon (radius and type are optional).');
    }

    const stands = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCSVLine(lines[i]);
      const name = cols[nameIdx] || '';
      const lat  = parseFloat(cols[latIdx]);
      const lon  = parseFloat(cols[lonIdx]);
      if (!name || isNaN(lat) || isNaN(lon)) continue;

      const radius = radiusIdx !== -1 ? (parseFloat(cols[radiusIdx]) || 40) : 40;
      const type   = typeIdx   !== -1 ? (cols[typeIdx] || 'contact')        : 'contact';
      stands.push({ name, lat, lon, radius, type });
    }

    if (stands.length === 0) throw new Error('No valid stands found in CSV.');
    return stands;
  }

  function getExistingNames() {
    return new Set(
      Array.from(standsTableBody.querySelectorAll('tr')).map(row => {
        const input = row.querySelector('input');
        return input ? input.value.trim().toLowerCase() : '';
      }).filter(Boolean)
    );
  }

  function applyImport(overwrite) {
    if (!_pendingImport) return;
    const { newStands, duplicateNames } = _pendingImport;

    if (overwrite && duplicateNames.size > 0) {
      // Remove existing rows whose names are being overwritten
      Array.from(standsTableBody.querySelectorAll('tr')).forEach(row => {
        const input = row.querySelector('input');
        if (input && duplicateNames.has(input.value.trim().toLowerCase())) row.remove();
      });
      newStands.forEach(s => standsTableBody.appendChild(createStandRow(s)));
    } else {
      // Skip duplicates — only add stands whose name isn't already present
      newStands
        .filter(s => !duplicateNames.has(s.name.toLowerCase()))
        .forEach(s => standsTableBody.appendChild(createStandRow(s)));
    }

    // Re-render with full sort so imported rows slot into the right positions
    renderStandsTable(collectStands());
    importBanner.hidden = true;
    _pendingImport = null;
    csvFileInput.value = '';

    const added = overwrite ? newStands.length : newStands.length - duplicateNames.size;
    setStatus(`Imported ${added} stand(s). Review the table then click Save Stands.`, 'ok');
  }

  function hideBanner() {
    importBanner.hidden = true;
    _pendingImport = null;
    csvFileInput.value = '';
  }

  importCsvBtn.addEventListener('click', () => csvFileInput.click());

  csvFileInput.addEventListener('change', () => {
    const file = csvFileInput.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = e => {
      try {
        const stands = parseCSV(e.target.result);
        const existingNames = getExistingNames();
        const duplicateNames = new Set(
          stands.map(s => s.name.toLowerCase()).filter(n => existingNames.has(n))
        );

        if (duplicateNames.size === 0) {
          // No conflicts — merge and re-sort
          stands.forEach(s => standsTableBody.appendChild(createStandRow(s)));
          renderStandsTable(collectStands());
          csvFileInput.value = '';
          setStatus(`Imported ${stands.length} stand(s) with no duplicates. Click Save Stands to apply.`, 'ok');
          return;
        }

        // Show banner for conflict resolution
        _pendingImport = { newStands: stands, duplicateNames };
        const dupList = [...duplicateNames].slice(0, 10).join(', ');
        const extra   = duplicateNames.size > 10 ? ` and ${duplicateNames.size - 10} more` : '';
        importSummary.textContent =
          `Parsed ${stands.length} stand(s) — ${duplicateNames.size} duplicate name(s) found: ${dupList}${extra}.`;
        importBanner.hidden = false;
        importBanner.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } catch (err) {
        setStatus('CSV error: ' + err.message, 'error');
        csvFileInput.value = '';
      }
    };
    reader.readAsText(file);
  });

  importSkipBtn.addEventListener('click',      () => applyImport(false));
  importOverwriteBtn.addEventListener('click', () => applyImport(true));
  importCancelBtn.addEventListener('click',    hideBanner);

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
