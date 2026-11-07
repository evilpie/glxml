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
  const enumsByValue = new Map();
  for (const row of data.enums) {
    if (!row.value) {
      continue;
    }
    const matches = enumsByValue.get(row.value) || [];
    matches.push(row.name);
    enumsByValue.set(row.value, matches);
  }
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
    for (const child of children) {
      parent.append(child);
    }
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
    for (const name of names) {
      wrap.append(link(kind, name));
    }
    return wrap;
  }
  function itemLinks(kind, entries) {
    const list = node('div', 'stack-list');
    for (const entry of entries) {
      const line = node('div', 'stack-item');
      line.append(link(kind, entry.name));
      const tags = [entry.api, entry.profile].filter(Boolean);
      if (tags.length) {
        line.append(node('span', 'small-tag', tags.join(' · ')));
      }
      if (kind === 'extension') {
        const url = maps.extension.get(entry.name)?.url;
        if (url) {
          const specification = external(url, 'Khronos');
          specification.classList.add('specification-link');
          line.append(specification);
        }
      }
      list.append(line);
    }
    return list.childNodes.length ? list : node('p', 'muted', 'None listed in gl.xml');
  }
  function commandSignature(row) {
    const signature = node('pre', 'signature');
    const argumentStart = row.signature.indexOf('(');
    const linkedParams = row.params
      .map((param) => ({
        name: param.name,
        group: param.groups.find((group) => maps.group.has(group)),
      }))
      .filter((param) => param.name && param.group);
    const matches = [];
    for (const param of linkedParams) {
      const pattern = new RegExp(`\\b${RegExp.escape(param.name)}\\b`, 'g');
      for (const match of row.signature.matchAll(pattern)) {
        if (match.index > argumentStart) {
          matches.push({ start: match.index, end: match.index + param.name.length, ...param });
          break;
        }
      }
    }
    matches.sort((a, b) => a.start - b.start);
    let offset = 0;
    for (const match of matches) {
      if (match.start < offset) {
        continue;
      }
      signature.append(document.createTextNode(row.signature.slice(offset, match.start)));
      signature.append(link('group', match.group, match.name));
      offset = match.end;
    }
    signature.append(document.createTextNode(row.signature.slice(offset)));
    return signature;
  }
  function aliasesFor(record) {
    const found = new Set([record.name]);
    const queue = [record.name];
    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index];
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
  function firstRequirements(features) {
    const byApi = new Map();
    for (const item of features) {
      if (!['gl', 'gles2'].includes(item.api) || (item.api === 'gl' && item.profile === 'compatibility')) {
        continue;
      }
      const current = byApi.get(item.api);
      const version = maps.feature.get(item.name)?.version || '999';
      const currentVersion = current ? maps.feature.get(current.name)?.version || '999' : null;
      if (!current || version.localeCompare(currentVersion, undefined, { numeric: true }) < 0) {
        byApi.set(item.api, item);
      }
    }
    return [...byApi.values()];
  }
  function addRequirementMeta(parent, requirements, removed) {
    const apiLabels = { gl: 'OpenGL', gles2: 'OpenGL ES' };
    const profileLabels = { core: 'Core', compatibility: 'Compatibility' };
    for (const requirement of requirements) {
      const api = requirement.api;
      const removals = removed
        .filter((item) => item.api === api && (api !== 'gl' || item.profile === 'core'))
        .sort((a, b) => {
          const va = maps.feature.get(a.name)?.version || '999';
          const vb = maps.feature.get(b.name)?.version || '999';
          return va.localeCompare(vb, undefined, { numeric: true });
        });
      const requiredVersion = maps.feature.get(requirement.name)?.version || requirement.name;
      const removedVersion = removals.length ? maps.feature.get(removals[0].name)?.version : null;
      const box = node('div', removedVersion ? 'meta-box historical-meta' : 'meta-box');
      box.append(node('span', 'meta-label', api === 'gl' ? 'CORE SINCE' : 'ES SINCE'));
      box.append(node('strong', '', `${apiLabels[api] || api} ${requiredVersion}`));
      parent.append(box);
      if (removedVersion) {
        const profile = removals[0].profile;
        const label = profile
          ? `REMOVED FROM ${profileLabels[profile] || profile} (${apiLabels[api] || api})`
          : `REMOVED IN ${apiLabels[api] || api}`;
        addMeta(parent, label, `${apiLabels[api] || api} ${removedVersion}`);
      }
    }
  }
  function renderEnum(row, body) {
    const family = aliasesFor(row);
    const relatives = family.filter((name) => name !== row.name);
    const familyRows = family.map((name) => maps.enum.get(name));
    const extensions = uniqueEntries(familyRows.flatMap((item) => item.extensions));
    const features = uniqueEntries(familyRows.flatMap((item) => item.features));
    const removed = uniqueEntries(familyRows.flatMap((item) => item.removed));
    const requirements = firstRequirements(features);
    if (requirements.length) {
      const meta = node('div', 'meta-grid');
      addRequirementMeta(meta, requirements, removed);
      body.append(meta);
    }
    const suffix = row.type && row.type !== 'i' ? row.type : '';
    body.append(
      node('pre', 'signature', `#define ${row.name.padEnd(33)} ${row.value || ''}${suffix}`),
    );
    if (row.alias_of) {
      body.append(section('Alias of', links('enum', [row.alias_of])));
    }
    if (relatives.length) {
      body.append(section('Aliases in the registry', links('enum', relatives)));
    }
    if (row.comment) {
      body.append(section('Registry note', node('p', '', row.comment)));
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
      for (const [index, group] of groups.entries()) {
        if (index) {
          note.append(node('span', 'muted', ', '));
        }
        note.append(link('group', group));
      }
      commandContent.append(note);
    }
    body.append(section('Commands using its parameter groups', commandContent));
    body.append(section('Extensions', itemLinks('extension', extensions)));
    body.append(section('Core and API feature requirements', itemLinks('feature', features)));
    if (removed.length) {
      body.append(section('Removed by feature', itemLinks('feature', removed)));
    }
    const sameValue = (enumsByValue.get(row.value) || []).filter((name) => name !== row.name);
    if (sameValue.length) {
      const content = node('div');
      content.append(links('enum', sameValue));
      content.append(
        node('p', 'muted', 'Matching values do not necessarily mean the constants are aliases.'),
      );
      body.append(section('Other constants with the same value', content));
    }
    const shared = [
      ...new Set(extensions.flatMap((ext) => maps.extension.get(ext.name)?.commands || [])),
    ].sort();
    if (shared.length) {
      body.append(
        section('Commands introduced by associated extensions', links('command', shared)),
      );
    }
  }
  function renderCommand(row, body) {
    const requirements = firstRequirements(row.features);
    if (requirements.length) {
      const meta = node('div', 'meta-grid');
      addRequirementMeta(meta, requirements, row.removed);
      body.append(meta);
    }
    body.append(commandSignature(row));
    if (row.aliases.length) {
      body.append(section('Aliases', links('command', row.aliases)));
    }
    const groupedParams = row.params.filter((param) => param.groups.length);
    if (groupedParams.length) {
      const list = node('div', 'stack-list');
      for (const param of groupedParams) {
        const line = node('div', 'stack-item');
        for (const group of param.groups) {
          line.append(link('group', group));
        }
        line.append(node('span', 'small-tag', param.name));
        list.append(line);
      }
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
    for (const item of row.parameters) {
      const line = node('div', 'stack-item');
      append(line, link('command', item.command), node('span', 'small-tag', item.parameter));
      list.append(line);
    }
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
    switch (kind) {
      case 'enum':
        renderEnum(row, body);
        break;
      case 'command':
        renderCommand(row, body);
        break;
      case 'extension':
        renderExtension(row, body);
        break;
      case 'feature':
        renderFeature(row, body);
        break;
      case 'group':
        renderGroup(row, body);
        break;
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
    const displayName = row.display_name?.toLowerCase();
    if (name === query) {
      return 100;
    }
    if (displayName === query) {
      return 100;
    }
    if (kind === 'enum' && numericMatch(row.value, query)) {
      return 95;
    }
    if (name.startsWith(query)) {
      return 70;
    }
    if (displayName?.startsWith(query)) {
      return 70;
    }
    if (name.includes(query)) {
      return 50;
    }
    if (displayName?.includes(query)) {
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
  function resultSubtitle(kind, row) {
    switch (kind) {
      case 'enum':
        return row.value;
      case 'command':
        return row.signature;
      case 'group':
        return `${row.enums.length} constants · ${row.commands.length} commands`;
      case 'feature':
        return row.display_name;
      case 'extension':
        return row.supported.join(' · ');
      default:
        return '';
    }
  }
  function drawResults() {
    const query = search.value.trim().toLowerCase();
    const found = [];
    for (const [kind, rows] of Object.entries(kinds)) {
      if ((filter === 'all' && kind === 'group') || (filter !== 'all' && filter !== kind)) {
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
      if (row.alias_of || row.removed?.length) {
        item.classList.add('result-secondary');
      }
      const top = node('span', 'result-top');
      append(top, node('span', 'kind', labels[kind]), node('span', 'result-name', row.name));
      item.replaceChildren(top);
      item.append(node('span', 'result-sub', resultSubtitle(kind, row) || ''));
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
    for (const a of results.querySelectorAll('a')) {
      if (a.getAttribute('href') === active) {
        a.classList.add('selected');
      }
    }
  }
  for (const [kind, rows] of Object.entries(kinds)) {
    document.querySelector(`#count-${kind}`).textContent = rows.length.toLocaleString();
  }
  document.querySelector('#count-all').textContent = Object.entries(kinds)
    .filter(([kind]) => kind !== 'group')
    .map(([, rows]) => rows)
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
  for (const button of document.querySelectorAll('.filter')) {
    button.addEventListener('click', () => {
      filter = button.dataset.kind;
      visible = 80;
      for (const item of document.querySelectorAll('.filter')) {
        const selected = item === button;
        item.classList.toggle('active', selected);
        item.setAttribute('aria-pressed', String(selected));
      }
      drawResults();
    });
  }
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
