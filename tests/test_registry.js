const assert = require('node:assert/strict');
const hydrate = require('../site_assets/registry.js');

const data = hydrate({
  schema_version: 2,
  enums: [
    {name: 'GL_FOO', value: '0x84FE'},
    {name: 'GL_FOO_EXT', value: '0x84FE', alias_of: 'GL_FOO'},
  ],
  commands: [{
    name: 'glSetFoo', signature: 'void glSetFoo(GLenum pname)',
    params: [{name: 'pname', groups: ['FooParameter']}],
  }],
  groups: [{name: 'FooParameter', defined: true, enums: ['GL_FOO']}],
  features: [{
    name: 'GL_VERSION_4_6', version: '4.6', api: 'gl',
    requires: [{enums: ['GL_FOO'], commands: ['glSetFoo']}],
    removes: [{profile: 'core', enums: ['GL_FOO']}],
  }],
  extensions: [
    {name: 'GL_ARB_foo', supported: ['gl'], requires: [{enums: ['GL_FOO']}]},
    {name: 'GL_EXT_foo', supported: ['gl'], requires: [{enums: ['GL_FOO_EXT']}]},
  ],
});

const [constant, alias] = data.enums;
const group = data.groups[0];
assert.deepEqual(constant.aliases, ['GL_FOO_EXT']);
assert.deepEqual(constant.groups, ['FooParameter']);
assert.deepEqual(constant.group_commands, ['glSetFoo']);
assert.equal(constant.features[0].name, 'GL_VERSION_4_6');
assert.equal(constant.removed[0].profile, 'core');
assert.equal(constant.extensions[0].name, 'GL_ARB_foo');
assert.equal(alias.extensions[0].name, 'GL_EXT_foo');
assert.deepEqual(group.parameters, [{command: 'glSetFoo', parameter: 'pname'}]);
assert.deepEqual(group.commands, ['glSetFoo']);
assert.deepEqual(data.features[0].commands, ['glSetFoo']);
console.log('Registry relationships reconstructed correctly');
