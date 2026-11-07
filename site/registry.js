/* Build browser-friendly reverse indexes from the normalized registry JSON. */
(function (root) {
  'use strict';

  function unique(names) { return [...new Set(names)]; }
  function expand(blocks, key) { return unique(blocks.flatMap(block => block[key] || [])); }

  function hydrateRegistry(data) {
    if (data.schema_version !== 2) throw new Error('Unsupported registry data format');
    const enums = new Map(data.enums.map(row => [row.name, row]));
    const commands = new Map(data.commands.map(row => [row.name, row]));
    const groups = new Map(data.groups.map(row => [row.name, row]));

    for (const row of data.enums) {
      row.groups = [];
      row.extensions = [];
      row.features = [];
      row.removed = [];
      row.aliases = [];
      row.group_commands = [];
    }
    for (const row of data.commands) {
      row.params ||= [];
      row.aliases ||= [];
      row.extensions = [];
      row.features = [];
      row.removed = [];
    }
    for (const row of data.groups) {
      row.enums ||= [];
      row.parameters = [];
      row.commands = [];
      for (const name of row.enums) {
        const constant = enums.get(name);
        if (constant) constant.groups.push(row.name);
      }
    }
    for (const row of data.commands) {
      for (const param of row.params) {
        param.groups ||= [];
        for (const name of param.groups) {
          const group = groups.get(name);
          if (group) group.parameters.push({command: row.name, parameter: param.name});
        }
      }
    }
    for (const row of data.groups) {
      row.parameters.sort((a, b) => a.command.localeCompare(b.command) || a.parameter.localeCompare(b.parameter));
      row.commands = unique(row.parameters.map(item => item.command));
    }

    function assign(blocks, source, target, api) {
      for (const block of blocks) {
        const entry = {name: source.name, api: block.api || api || null, profile: block.profile || null};
        for (const name of block.enums || []) {
          const record = enums.get(name);
          if (record) record[target].push(entry);
        }
        for (const name of block.commands || []) {
          const record = commands.get(name);
          if (record) record[target].push(entry);
        }
      }
    }
    for (const row of data.features) {
      row.requires ||= [];
      row.removes ||= [];
      row.enums = expand(row.requires, 'enums');
      row.commands = expand(row.requires, 'commands');
      row.removed_enums = expand(row.removes, 'enums');
      row.removed_commands = expand(row.removes, 'commands');
      assign(row.requires, row, 'features', row.api);
      assign(row.removes, row, 'removed', row.api);
    }
    for (const row of data.extensions) {
      row.requires ||= [];
      row.enums = expand(row.requires, 'enums');
      row.commands = expand(row.requires, 'commands');
      assign(row.requires, row, 'extensions', null);
    }
    for (const row of data.enums) {
      const parent = enums.get(row.alias_of);
      if (parent) parent.aliases.push(row.name);
      row.groups.sort();
      row.group_commands = unique(row.groups.flatMap(name => groups.get(name)?.commands || [])).sort();
    }
    for (const row of data.commands) {
      for (const alias of [...row.aliases]) {
        const other = commands.get(alias);
        if (other && !other.aliases.includes(row.name)) other.aliases.push(row.name);
      }
      row.aliases.sort();
    }
    return data;
  }

  root.hydrateRegistry = hydrateRegistry;
  if (typeof module !== 'undefined' && module.exports) module.exports = hydrateRegistry;
})(typeof window === 'undefined' ? globalThis : window);
