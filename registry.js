/* Parse Khronos gl.xml and derive the indexes used by the browser. */
((root) => {
  const unique = (xs) => [...new Set(xs)];
  const attr = (el, key) => el?.getAttribute(key) || null;
  function hydrateRegistry(xml) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.querySelector('parsererror') || doc.documentElement.nodeName !== 'registry') {
      throw new Error('Invalid gl.xml');
    }
    const all = (selector, base = doc) => [...base.querySelectorAll(selector)];
    const data = {
      source: 'gl.xml',
      registry_url: 'https://registry.khronos.org/OpenGL/index_gl.php',
      enums: [],
      commands: [],
      groups: [],
      features: [],
      extensions: [],
    };
    const enumMap = new Map();
    for (const e of all('enums > enum')) {
      const name = attr(e, 'name');
      if (!name) {
        return;
      }
      let row = enumMap.get(name);
      if (!row) {
        row = { name, value: null, alias_of: null, apis: [] };
        enumMap.set(name, row);
      }
      for (const k of ['value', 'comment', 'type']) {
        if (attr(e, k) && !row[k]) {
          row[k] = attr(e, k);
        }
      }
      if (attr(e, 'alias')) {
        row.alias_of = attr(e, 'alias');
      }
      if (attr(e, 'api')) {
        row.apis.push(attr(e, 'api'));
      }
    }
    data.enums = [...enumMap.values()];
    for (const e of all('commands > command')) {
      const proto = e.querySelector(':scope > proto'),
        name = proto?.querySelector('name')?.textContent || attr(e, 'name');
      if (!name) {
        return;
      }
      data.commands.push({
        name,
        signature: proto
          ? proto.textContent.trim().replace(/\s+/g, ' ') +
            '(' +
            all(':scope > param', e)
              .map((p) => p.textContent.trim().replace(/\s+/g, ' '))
              .join(', ') +
            ')'
          : name,
        params: all(':scope > param', e).map((p) => ({
          name: p.querySelector('name')?.textContent || '',
          groups: (attr(p, 'group') || '').split(',').filter(Boolean),
        })),
        alias_of: attr(e.querySelector(':scope > alias'), 'name'),
        aliases: [],
      });
    }
    const groupMap = new Map();
    for (const g of all('groups > group')) {
      const name = attr(g, 'name');
      if (name) {
        groupMap.set(name, {
          name,
          defined: true,
          comment: attr(g, 'comment'),
          enums: all(':scope > enum', g)
            .map((x) => attr(x, 'name'))
            .filter(Boolean),
        });
      }
    }
    for (const e of all('enums > enum[group], enum[group]')) {
      for (const name of (attr(e, 'group') || '').split(',')) {
        if (!name) {
          return;
        }
        let g = groupMap.get(name);
        if (!g) {
          g = { name, defined: false, enums: [] };
          groupMap.set(name, g);
        }
        g.enums.push(attr(e, 'name'));
      }
    }
    const blocks = (e, tag) =>
      all(`:scope > ${tag}`, e).map((b) => ({
        api: attr(b, 'api'),
        profile: attr(b, 'profile'),
        enums: all(':scope > enum', b)
          .map((x) => attr(x, 'name'))
          .filter(Boolean),
        commands: all(':scope > command', b)
          .map((x) => attr(x, 'name'))
          .filter(Boolean),
      }));
    for (const e of all('feature')) {
      const api = attr(e, 'api');
      const version = attr(e, 'number');
      const apiLabel =
        {
          gles1: 'OpenGL ES CM',
          gles2: 'OpenGL ES',
          glsc2: 'OpenGL SC',
        }[api] || 'OpenGL';
      data.features.push({
        name: attr(e, 'name'),
        version,
        api,
        display_name: `${apiLabel} ${version || ''}`.trim(),
        spec_url: glSpec(version, api),
        requires: blocks(e, 'require'),
        removes: blocks(e, 'remove'),
      });
    }
    for (const e of all('extensions > extension')) {
      data.extensions.push({
        name: attr(e, 'name'),
        supported: (attr(e, 'supported') || '').split('|'),
        url: extensionUrl(attr(e, 'name')),
        requires: blocks(e, 'require'),
      });
    }
    data.groups = [...groupMap.values()].map((g) => ({
      ...g,
      enums: unique(g.enums).sort(),
      parameters: [],
      commands: [],
    }));
    const em = new Map(data.enums.map((x) => [x.name, x])),
      cm = new Map(data.commands.map((x) => [x.name, x])),
      gm = new Map(data.groups.map((x) => [x.name, x]));
    for (const r of data.enums) {
      Object.assign(r, {
        apis: unique(r.apis),
        groups: [],
        extensions: [],
        features: [],
        removed: [],
        aliases: [],
        group_commands: [],
      });
    }
    for (const r of data.commands) {
      Object.assign(r, { extensions: [], features: [], removed: [] });
    }
    for (const g of data.groups) {
      for (const n of g.enums) {
        if (em.has(n)) {
          em.get(n).groups.push(g.name);
        }
      }
    }
    for (const c of data.commands) {
      for (const p of c.params) {
        for (const n of p.groups) {
          gm.get(n)?.parameters.push({ command: c.name, parameter: p.name });
        }
      }
    }
    for (const g of data.groups) {
      g.parameters.sort(
        (a, b) => a.command.localeCompare(b.command) || a.parameter.localeCompare(b.parameter),
      );
      g.commands = unique(g.parameters.map((p) => p.command));
    }
    const assign = (rows, field, target, api) => {
      for (const b of rows) {
        const entry = { name: field.name, api: b.api || api, profile: b.profile };
        for (const n of b.enums || []) {
          em.get(n)?.[target].push(entry);
        }
        for (const n of b.commands || []) {
          cm.get(n)?.[target].push(entry);
        }
      }
    };
    for (const f of data.features) {
      f.enums = unique(f.requires.flatMap((b) => b.enums));
      f.commands = unique(f.requires.flatMap((b) => b.commands));
      f.removed_enums = unique(f.removes.flatMap((b) => b.enums));
      f.removed_commands = unique(f.removes.flatMap((b) => b.commands));
      assign(f.requires, f, 'features', f.api);
      assign(f.removes, f, 'removed', f.api);
    }
    for (const x of data.extensions) {
      x.enums = unique(x.requires.flatMap((b) => b.enums));
      x.commands = unique(x.requires.flatMap((b) => b.commands));
      assign(x.requires, x, 'extensions', null);
    }
    for (const r of data.enums) {
      if (em.has(r.alias_of)) {
        em.get(r.alias_of).aliases.push(r.name);
      }
      r.group_commands = unique(r.groups.flatMap((n) => gm.get(n)?.commands || [])).sort();
    }
    for (const r of data.commands) {
      if (cm.has(r.alias_of)) {
        cm.get(r.alias_of).aliases.push(r.name);
      }
    }
    return data;
  }
  function extensionUrl(name) {
    const m = /^GL_([A-Za-z0-9]+)_(.+)$/.exec(name || '');
    return m ? `https://registry.khronos.org/OpenGL/extensions/${m[1]}/${m[1]}_${m[2]}.txt` : null;
  }
  function glSpec(v, api) {
    if (api === 'gles2' && /^(1\.[01]|2\.0|3\.[0-2])$/.test(v || '')) {
      return `https://registry.khronos.org/OpenGL/specs/es/${v}/es_spec_${v}.pdf`;
    }
    if (api !== 'gl') {
      return null;
    }
    const known = {
      '1.0': 'glspec10.pdf',
      1.1: 'glspec11.pdf',
      1.2: 'glspec121.pdf',
      1.3: 'glspec13.pdf',
      1.4: 'glspec14.pdf',
      1.5: 'glspec15.pdf',
      '2.0': 'glspec20.pdf',
      2.1: 'glspec21.pdf',
      '3.0': 'glspec30.pdf',
      3.1: 'glspec31.pdf',
    };
    if (v && !known[v] && /^(3\.[23]|4\.[0-6])$/.test(v)) {
      known[v] = `glspec${v.replace('.', '')}.core.pdf`;
    }
    return known[v] ? `https://registry.khronos.org/OpenGL/specs/gl/${known[v]}` : null;
  }
  root.hydrateRegistry = hydrateRegistry;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = hydrateRegistry;
  }
})(typeof window === 'undefined' ? globalThis : window);
