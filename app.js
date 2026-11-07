(async () => {
  let data;
  try {
    const response = await fetch('data/gl.xml');
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    data = window.hydrateRegistry(await response.text());
  } catch (error) {
    document.querySelector('#result-heading').textContent = 'Data unavailable';
    document.querySelector('#detail').textContent =
      location.protocol === 'file:'
        ? 'Serve this directory over HTTP to load gl.xml. See the README for the command.'
        : `Could not load gl.xml: ${error.message}`;
    return;
  }
  const kinds = {
    enum: data.enums,
    command: data.commands,
    group: data.groups,
    extension: data.extensions,
    feature: data.features,
  };
  const maps = Object.fromEntries(
    Object.entries(kinds).map(([kind, rows]) => [
      kind,
      new Map(rows.map((row) => [row.name, row])),
    ]),
  );
  const labels = {
    enum: 'CONSTANT',
    command: 'COMMAND',
    group: 'GROUP',
    extension: 'EXTENSION',
    feature: 'VERSION',
  };
  const search = document.querySelector('#search');
  const clearSearch = document.querySelector('#clear-search');
  const results = document.querySelector('#results');
  const detail = document.querySelector('#detail');
  const more = document.querySelector('#more');
  let filter = 'all';
  let visible = 80;

  function node(tag, className, content) {
    const element = document.createElement(tag);
    if (className) {
      element.className = className;
    }
    if (content !== undefined && content !== null) {
      element.textContent = String(content);
    }
    return element;
  }
  function append(parent, ...children) {
    children.forEach((child) => parent.append(child));
    return parent;
  }
  function link(kind, name, label = name) {
    const a = node('a', 'record-link', label);
    a.href = `#${kind}/${encodeURIComponent(name)}`;
    return a;
  }
  function external(url, label) {
    const a = node('a', 'external-link', `${label} ↗`);
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    return a;
  }
  function section(title, content) {
    const container = node('section', 'detail-section');
    append(container, node('h3', '', title), content);
    return container;
  }
  function links(kind, names, empty = 'None listed in gl.xml') {
    if (!names.length) {
      return node('p', 'muted', empty);
    }
    const wrap = node('div', 'chip-list');
    names.forEach((name) => wrap.append(link(kind, name)));
    return wrap;
  }
  function itemLinks(kind, entries) {
    const list = node('div', 'stack-list');
    entries.forEach((entry) => {
      const line = node('div', 'stack-item');
      line.append(link(kind, entry.name));
      const tags = [entry.api, entry.profile].filter(Boolean);
      if (tags.length) {
        line.append(node('span', 'small-tag', tags.join(' · ')));
      }
      list.append(line);
    });
    return list.childNodes.length ? list : node('p', 'muted', 'None listed in gl.xml');
  }
  function aliasesFor(record) {
    const found = new Set([record.name]);
    const queue = [record.name];
    while (queue.length) {
      const current = queue.shift();
      const row = maps.enum.get(current);
      if (!row) {
        continue;
      }
      for (const name of [row.alias_of, ...row.aliases]) {
        if (name && !found.has(name) && maps.enum.has(name)) {
          found.add(name);
          queue.push(name);
        }
      }
    }
    return [...found];
  }
  function uniqueEntries(entries) {
    const seen = new Set();
    return entries.filter((entry) => {
      const key = [entry.name, entry.api, entry.profile].join('|');
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
  }
  function addMeta(parent, label, value) {
    const box = node('div', 'meta-box');
    append(box, node('span', 'meta-label', label), node('strong', '', value));
    parent.append(box);
  }
  function renderEnum(row, body) {
    const family = aliasesFor(row);
    const relatives = family.filter((name) => name !== row.name);
    const familyRows = family.map((name) => maps.enum.get(name));
    const extensions = uniqueEntries(familyRows.flatMap((item) => item.extensions));
    const features = uniqueEntries(familyRows.flatMap((item) => item.features));
    const removed = uniqueEntries(familyRows.flatMap((item) => item.removed));
    const core = features
      .filter((item) => item.api === 'gl' && item.profile !== 'compatibility')
      .sort((a, b) => {
        const va = maps.feature.get(a.name)?.version || '999';
        const vb = maps.feature.get(b.name)?.version || '999';
        return va.localeCompare(vb, undefined, { numeric: true });
      });
    const meta = node('div', 'meta-grid');
    addMeta(meta, 'REGISTRY VALUE', row.value || 'Alias; value unavailable');
    addMeta(
      meta,
      'FIRST CORE PROFILE REQUIREMENT',
      core.length
        ? `OpenGL ${maps.feature.get(core[0].name)?.version || core[0].name}`
        : 'Not listed',
    );
    body.append(meta);
    if (core.length) {
      const url = maps.feature.get(core[0].name)?.spec_url;
      if (url) {
        body.append(
          section(
            'Core specification',
            external(url, `OpenGL ${maps.feature.get(core[0].name).version} core specification`),
          ),
        );
      }
    }
    if (row.alias_of) {
      body.append(section('Alias of', links('enum', [row.alias_of])));
    }
    if (relatives.length) {
      body.append(section('Aliases in the registry', links('enum', relatives)));
    }
    if (row.comment) {
      body.append(section('Registry note', node('p', '', row.comment)));
    }
    body.append(section('Extensions', itemLinks('extension', extensions)));
    body.append(section('Core and API feature requirements', itemLinks('feature', features)));
    if (removed.length) {
      body.append(section('Removed by feature', itemLinks('feature', removed)));
    }
    const groups = [...new Set(familyRows.flatMap((item) => item.groups))];
    const groupCommands = [...new Set(familyRows.flatMap((item) => item.group_commands))].sort();
    if (groups.length) {
      body.append(section('Registry parameter groups', links('group', groups)));
    }
    const commandContent = node('div');
    commandContent.append(
      links(
        'command',
        groupCommands.slice(0, 5),
        'No command association is encoded through parameter groups for this constant.',
      ),
    );
    if (groupCommands.length > 5) {
      const note = node('p', 'more-context');
      note.append(node('span', 'muted', `${groupCommands.length - 5} more. See more in `));
      groups.forEach((group, index) => {
        if (index) {
          note.append(node('span', 'muted', ', '));
        }
        note.append(link('group', group));
      });
      commandContent.append(note);
    }
    body.append(section('Commands using its parameter groups', commandContent));
    const shared = [
      ...new Set(extensions.flatMap((ext) => maps.extension.get(ext.name)?.commands || [])),
    ].sort();
    if (shared.length) {
      body.append(
        section('Commands introduced by associated extensions', links('command', shared)),
      );
    }
    const specs = node('div', 'stack-list');
    extensions.forEach((ext) => {
      const url = maps.extension.get(ext.name)?.url;
      if (url) {
        specs.append(append(node('div', 'stack-item'), external(url, ext.name)));
      }
    });
    if (specs.childNodes.length) {
      body.append(section('Extension specifications', specs));
    }
  }
  function renderCommand(row, body) {
    body.append(node('pre', 'signature', row.signature));
    if (row.aliases.length) {
      body.append(section('Aliases', links('command', row.aliases)));
    }
    const groupedParams = row.params.filter((param) => param.groups.length);
    if (groupedParams.length) {
      const list = node('div', 'stack-list');
      groupedParams.forEach((param) => {
        const line = node('div', 'stack-item');
        param.groups.forEach((group) => line.append(link('group', group)));
        line.append(node('span', 'small-tag', param.name));
        list.append(line);
      });
      body.append(section('Parameter groups', list));
    }
    body.append(section('Extensions', itemLinks('extension', row.extensions)));
    body.append(section('Core and API feature requirements', itemLinks('feature', row.features)));
    if (row.removed.length) {
      body.append(section('Removed by feature', itemLinks('feature', row.removed)));
    }
  }
  function renderExtension(row, body) {
    const bar = node('div', 'action-bar');
    if (row.url) {
      bar.append(external(row.url, 'View on Khronos Registry'));
    }
    body.append(bar);
    body.append(
      section('Supported APIs', node('p', 'mono', row.supported.join(' · ') || 'Unspecified')),
    );
    body.append(section(`Constants (${row.enums.length})`, links('enum', row.enums)));
    body.append(section(`Commands (${row.commands.length})`, links('command', row.commands)));
  }
  function renderFeature(row, body) {
    const meta = node('div', 'meta-grid');
    addMeta(meta, 'VERSION', row.version || 'Unspecified');
    addMeta(meta, 'API', row.api || 'Unspecified');
    body.append(meta);
    if (row.spec_url) {
      const bar = node('div', 'action-bar');
      const apiName = row.api === 'gles2' ? 'OpenGL ES' : 'OpenGL';
      bar.append(external(row.spec_url, `View ${apiName} ${row.version} specification`));
      body.append(bar);
    }
    body.append(section(`Required constants (${row.enums.length})`, links('enum', row.enums)));
    body.append(
      section(`Required commands (${row.commands.length})`, links('command', row.commands)),
    );
    if (row.removed_enums.length) {
      body.append(section('Removed constants', links('enum', row.removed_enums)));
    }
    if (row.removed_commands.length) {
      body.append(section('Removed commands', links('command', row.removed_commands)));
    }
  }
  function renderGroup(row, body) {
    if (!row.defined) {
      body.append(
        node(
          'p',
          'muted group-note',
          'Groups are referenced in gl.xml, but have no explicit group definitions. Membership is inferred from enum and command parameter references.',
        ),
      );
    }
    if (row.comment) {
      body.append(section('Registry note', node('p', '', row.comment)));
    }
    body.append(section(`Constants (${row.enums.length})`, links('enum', row.enums)));
    const list = node('div', 'stack-list');
    row.parameters.forEach((item) => {
      const line = node('div', 'stack-item');
      append(line, link('command', item.command), node('span', 'small-tag', item.parameter));
      list.append(line);
    });
    body.append(
      section(
        `Command parameters (${row.parameters.length})`,
        list.childNodes.length
          ? list
          : node('p', 'muted', 'No command parameters use this group in gl.xml.'),
      ),
    );
  }
  function renderDetail(kind, name) {
    detail.replaceChildren();
    const row = maps[kind]?.get(name);
    if (!row) {
      detail.append(node('div', 'empty-detail', 'Select a result to inspect its registry record.'));
      return;
    }
    const heading = node('div', 'detail-heading');
    append(heading, node('span', 'eyebrow', `${labels[kind]} / GL.XML`), node('h2', '', row.name));
    detail.append(heading);
    const body = node('div', 'detail-body');
    if (kind === 'enum') {
      renderEnum(row, body);
    }
    if (kind === 'command') {
      renderCommand(row, body);
    }
    if (kind === 'extension') {
      renderExtension(row, body);
    }
    if (kind === 'feature') {
      renderFeature(row, body);
    }
    if (kind === 'group') {
      renderGroup(row, body);
    }
    detail.append(body);
  }
  function route() {
    const match = /^#(enum|command|group|extension|feature)\/(.*)$/.exec(location.hash);
    if (!match) {
      renderDetail(null, null);
      return;
    }
    let name;
    try {
      name = decodeURIComponent(match[2]);
    } catch {
      renderDetail(null, null);
      return;
    }
    renderDetail(match[1], name);
  }
  function numericMatch(value, query) {
    if (!value || !/^(?:0x[\da-f]+|\d+)$/i.test(query)) {
      return false;
    }
    try {
      return BigInt(value.replace(/[uUlL]+$/, '')) === BigInt(query);
    } catch {
      return false;
    }
  }
  function score(kind, row, query) {
    if (!query) {
      return 1;
    }
    const name = row.name.toLowerCase();
    if (name === query) {
      return 100;
    }
    if (kind === 'enum' && numericMatch(row.value, query)) {
      return 95;
    }
    if (name.startsWith(query)) {
      return 70;
    }
    if (name.includes(query)) {
      return 50;
    }
    if (kind === 'enum' && row.value?.toLowerCase().includes(query)) {
      return 30;
    }
    if (kind === 'command' && row.signature.toLowerCase().includes(query)) {
      return 15;
    }
    return 0;
  }
  function drawResults() {
    const query = search.value.trim().toLowerCase();
    const found = [];
    for (const [kind, rows] of Object.entries(kinds)) {
      if (filter !== 'all' && filter !== kind) {
        continue;
      }
      for (const row of rows) {
        const rank = score(kind, row, query);
        if (rank) {
          found.push({ kind, row, rank });
        }
      }
    }
    found.sort((a, b) => b.rank - a.rank || a.row.name.localeCompare(b.row.name));
    document.querySelector('#result-heading').textContent = query
      ? 'Search results'
      : 'Browse registry';
    document.querySelector('#result-count').textContent =
      `${found.length.toLocaleString()} records`;
    results.replaceChildren();
    for (const { kind, row } of found.slice(0, visible)) {
      const item = link(kind, row.name);
      item.className = 'result';
      const top = node('span', 'result-top');
      append(top, node('span', 'kind', labels[kind]), node('span', 'result-name', row.name));
      item.replaceChildren(top);
      const sub =
        kind === 'enum'
          ? row.value
          : kind === 'command'
            ? row.signature
            : kind === 'group'
              ? `${row.enums.length} constants · ${row.commands.length} commands`
              : kind === 'feature'
                ? `OpenGL ${row.version || ''}`
                : row.supported.join(' · ');
      item.append(node('span', 'result-sub', sub || ''));
      results.append(item);
    }
    if (!found.length) {
      results.append(
        node('p', 'no-results', 'No matching registry records. Try a name or numeric value.'),
      );
    }
    more.hidden = found.length <= visible;
    more.textContent = `Show more results (${found.length - visible} remaining)`;
    const active = location.hash;
    results.querySelectorAll('a').forEach((a) => {
      if (a.getAttribute('href') === active) {
        a.classList.add('selected');
      }
    });
  }
  for (const [kind, rows] of Object.entries(kinds)) {
    document.querySelector(`#count-${kind}`).textContent = rows.length.toLocaleString();
  }
  document.querySelector('#count-all').textContent = Object.values(kinds)
    .reduce((n, rows) => n + rows.length, 0)
    .toLocaleString();
  const source = document.querySelector('#source');
  source.textContent = 'Source: Khronos OpenGL Registry';
  fetch('data/source.json')
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response.json();
    })
    .then((provenance) => {
      if (!provenance.source_url || !provenance.revision) {
        return;
      }
      const anchor = external(
        provenance.source_url,
        `gl.xml @ ${provenance.revision.slice(0, 12)}`,
      );
      source.replaceChildren(document.createTextNode('Source: '), anchor);
    })
    .catch(() => {});
  clearSearch.hidden = !search.value;
  search.addEventListener('input', () => {
    clearSearch.hidden = !search.value;
    visible = 80;
    drawResults();
  });
  clearSearch.addEventListener('click', () => {
    search.value = '';
    clearSearch.hidden = true;
    visible = 80;
    drawResults();
    search.focus();
  });
  document.querySelectorAll('.filter').forEach((button) =>
    button.addEventListener('click', () => {
      filter = button.dataset.kind;
      visible = 80;
      document.querySelectorAll('.filter').forEach((item) => {
        const selected = item === button;
        item.classList.toggle('active', selected);
        item.setAttribute('aria-pressed', String(selected));
      });
      drawResults();
    }),
  );
  more.addEventListener('click', () => {
    visible += 80;
    drawResults();
  });
  window.addEventListener('hashchange', () => {
    route();
    drawResults();
  });
  route();
  drawResults();
})();
