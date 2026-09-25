import optimizeSb3 from '../../src/packager/minify/sb3';

const clone = (obj) => JSON.parse(JSON.stringify(obj));

const emptyTarget = () => ({
  name: '',
  blocks: {},
  comments: {},
  variables: {},
  lists: {},
  broadcasts: {},
});

test('does not throw if project does not have monitors', () => {
  const data = {
    targets: [],
    meta: {}
  };
  optimizeSb3(clone(data));
});

test('removes comments', () => {
  const data = {
    targets: [
      {
        ...emptyTarget(),
        comments: {
          "a": {
            "text": "wregoiujji"
          },
          "b": {
            "text": "Configuration for https://turbowarp.org/\nDo not edit by hand\n{\"framerate\":30,\"runtimeOptions\":{\"maxClones\":300,\"miscLimits\":false,\"fencing\":true},\"interpolation\":false,\"turbo\":false,\"hq\":true} // _twconfig_"
          },
          "c": {
            "text": " // _gamepad_"
          }
        }
      }
    ]
  };
  const optimized = optimizeSb3(clone(data));
  expect(Object.values(optimized.targets[0].comments)).toEqual([
    {
      "text": "Configuration for https://turbowarp.org/\nDo not edit by hand\n{\"framerate\":30,\"runtimeOptions\":{\"maxClones\":300,\"miscLimits\":false,\"fencing\":true},\"interpolation\":false,\"turbo\":false,\"hq\":true} // _twconfig_"
    },
    {
      text: " // _gamepad_"
    }
  ]);
});

test('optimizes names and their references', () => {
  const target = emptyTarget();
  target.variables.variableId = ['long variable name', 0];
  target.variables.sensedId = ['sensed variable', 0];
  target.variables.cloudId = ['☁ cloud name', 0, true];
  target.broadcasts.broadcastId = 'Long Broadcast Name';
  target.blocks = {
    variable: [12, 'long variable name', 'variableId', 0, 0],
    field: {opcode: 'data_setvariableto', fields: {VARIABLE: ['long variable name', 'variableId']}},
    input: {opcode: 'operator_add', inputs: {NUM1: [1, [12, 'long variable name', 'variableId']]}},
    of: {opcode: 'sensing_of', fields: {PROPERTY: ['sensed variable', null]}},
    broadcast: {opcode: 'event_whenbroadcastreceived', fields: {BROADCAST_OPTION: ['Long Broadcast Name', 'broadcastId']}},
    broadcastInput: {opcode: 'event_broadcast', inputs: {BROADCAST_INPUT: [1, [11, 'Long Broadcast Name', 'broadcastId']]}},
    prototype: {opcode: 'procedures_prototype', mutation: {proccode: 'long custom block %s %b %x %Y'}},
    call: {opcode: 'procedures_call', mutation: {proccode: 'long custom block %s %b %x %Y'}},
    addon: {opcode: 'procedures_call', mutation: {proccode: 'tw:debugger;'}}
  };
  const data = {targets: [target], monitors: [{opcode: 'data_variable', id: 'variableId', params: {VARIABLE: 'long variable name'}, value: 0}]};

  optimizeSb3(data);

  expect(target.variables.variableId[0]).toBe('a');
  expect(target.variables.sensedId[0]).toBe('sensed variable');
  expect(target.variables.cloudId[0]).toBe('☁ cloud name');
  expect(target.broadcasts.broadcastId).toBe('a');
  expect(data.monitors[0].params.VARIABLE).toBe('a');
  expect(target.blocks.a[1]).toBe('a');
  expect(target.blocks.b.fields.VARIABLE[0]).toBe('a');
  expect(target.blocks.c.inputs.NUM1[1][1]).toBe('a');
  expect(target.blocks.d.fields.PROPERTY[0]).toBe('sensed variable');
  expect(target.blocks.e.fields.BROADCAST_OPTION[0]).toBe('a');
  expect(target.blocks.f.inputs.BROADCAST_INPUT[1][1]).toBe('a');
  expect(target.blocks.g.mutation.proccode).toBe('a %s %b %x');
  expect(target.blocks.h.mutation.proccode).toBe('a %s %b %x');
  expect(target.blocks.i.mutation.proccode).toBe('tw:debugger;');
});

test('keeps broadcast names when a script can broadcast a computed name', () => {
  const target = emptyTarget();
  target.broadcasts.id = 'Long Broadcast Name';
  target.blocks = {
    send: {opcode: 'event_broadcast', inputs: {BROADCAST_INPUT: [1, 'text']}},
    text: {opcode: 'text', fields: {TEXT: ['Long Broadcast Name']}}
  };

  optimizeSb3({targets: [target]});

  expect(target.broadcasts.id).toBe('Long Broadcast Name');
});

test('broadcast names remain distinct ignoring case', () => {
  const target = emptyTarget();
  for (let i = 0; i < 27; i++) {
    target.broadcasts[`id${i}`] = `broadcast ${i}`;
  }

  optimizeSb3({targets: [target]});

  expect(target.broadcasts.id0.toLowerCase()).not.toBe(target.broadcasts.id26.toLowerCase());
});
