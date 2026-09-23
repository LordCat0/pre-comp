import ProjectCompiler from '../../src/packager/project-compiler';

test.each([
  [undefined, 'https://packager.turbowarp.org/scaffolding/scaffolding-min.js'],
  ['PenguinMod', 'https://studio.penguinmod.com/PenguinMod-Packager/scaffolding/scaffolding-min.js'],
  ['NitroBolt', 'https://packager.nitrobolt.org/scaffolding/scaffolding-min.js'],
  ['Other', 'https://packager.turbowarp.org/scaffolding/scaffolding-min.js']
])('selects scaffolding for %s', (platform, expected) => {
  const compiler = new ProjectCompiler({meta: {platform: platform && {name: platform}}});
  expect(compiler.getScaffoldingURL()).toBe(expected);
});

test('shares compiled custom blocks between scripts', async () => {
  const sharedA = function shared (thread) { return thread; };
  const sharedB = function shared (thread) { return thread; };
  const unique = function unique (thread) { return thread; };
  const results = {};
  const target = {
    isStage: true,
    getName: () => 'Stage',
    blocks: {
      _cache: {
        compiledScripts: {
          first: {success: true, value: {
            startingFunction: function first () {},
            procedures: {shared: sharedA, unique},
            executableHat: false
          }},
          second: {success: true, value: {
            startingFunction: function second () {},
            procedures: {shared: sharedB},
            executableHat: false
          }}
        }
      },
      getBlock: () => true,
      cacheCompileResult: (id, result) => {
        results[id] = result;
      }
    }
  };
  const listeners = {};
  const compile = jest.fn(function () {
    return new Function(`return ${this.createScriptFactory()}`)();
  });
  const vm = {
    runtime: {
      precompile: () => {},
      allScriptsDo: callback => {
        callback('first', target);
        callback('second', target);
      },
      targets: [target],
      on: (event, callback) => {
        listeners[event] = callback;
      }
    },
    extensionManager: {loadExtensionIdSync: () => {}},
    exports: {these_broke_before_and_will_break_again: () => ({JSGenerator: {prototype: {compile}}})}
  };
  const projectCompiler = new ProjectCompiler({extensions: []});
  projectCompiler.loadScaffolding = async () => {};
  const previousScaffolding = globalThis.Scaffolding;
  globalThis.Scaffolding = {Scaffolding: class {
    constructor () {
      this.vm = vm;
    }
    setup () {}
    async loadProject () {}
  }};

  try {
    await projectCompiler.compileScripts();
    new Function('vm', projectCompiler.getScript())(vm);
    expect(compile).not.toHaveBeenCalled();
    listeners.RUNTIME_STARTED();

    expect(projectCompiler.procedures).toHaveLength(2);
    expect(compile).toHaveBeenCalledTimes(4);
    expect(results.first.procedures.shared).toBe(results.second.procedures.shared);
    expect(results.first.procedures.unique).not.toBe(results.first.procedures.shared);
  } finally {
    globalThis.Scaffolding = previousScaffolding;
  }
});

test('skips scripts without a compile result and propagates compilation errors', async () => {
  const error = new Error('compile failed');
  const target = {
    blocks: {_cache: {compiledScripts: {failed: {success: false, value: error}}}}
  };
  const vm = {
    runtime: {
      precompile: jest.fn(),
      allScriptsDo: callback => {
        callback('missing', target);
        callback('failed', target);
      }
    }
  };
  const compiler = new ProjectCompiler({extensions: []});
  compiler.loadScaffolding = async () => {};
  const previousScaffolding = globalThis.Scaffolding;
  globalThis.Scaffolding = {Scaffolding: class {
    constructor () {
      this.vm = vm;
    }
    setup () {}
    async loadProject () {}
  }};

  try {
    await expect(compiler.compileScripts()).rejects.toBe(error);
    expect(vm.runtime.precompile).toHaveBeenCalledTimes(1);
    expect(compiler.scripts).toEqual([]);
    expect(compiler.procedures).toEqual([]);
  } finally {
    globalThis.Scaffolding = previousScaffolding;
  }
});

test('restores scripts to the matching target after extensions load', () => {
  const compiler = new ProjectCompiler({extensions: ['example']});
  compiler.scripts = [{
    targetName: 'Same name',
    isStage: false,
    topBlockId: 'hat',
    startingFunction: 'function start () {}',
    procedures: '{}',
    executableHat: true
  }];
  const stageCache = jest.fn();
  const spriteCache = jest.fn();
  const targets = [
    {isStage: true, getName: () => 'Same name', blocks: {getBlock: () => true, cacheCompileResult: stageCache}},
    {isStage: false, getName: () => 'Same name', blocks: {getBlock: () => true, cacheCompileResult: spriteCache}}
  ];
  const listeners = {};
  let extensionsLoaded = false;
  const compile = jest.fn(function () {
    expect(extensionsLoaded).toBe(true);
    return new Function(`return ${this.createScriptFactory()}`)();
  });
  const vm = {
    runtime: {
      targets,
      on: (event, callback) => {
        listeners[event] = callback;
      }
    },
    extensionManager: {loadExtensionIdSync: id => {
      expect(id).toBe('example');
      extensionsLoaded = true;
    }},
    exports: {these_broke_before_and_will_break_again: () => ({JSGenerator: {prototype: {compile}}})}
  };

  new Function('vm', compiler.getScript())(vm);
  expect(spriteCache).not.toHaveBeenCalled();
  listeners.RUNTIME_STARTED();
  expect(stageCache).not.toHaveBeenCalled();
  expect(spriteCache).toHaveBeenCalledWith('hat', {
    startingFunction: expect.any(Function),
    procedures: {},
    executableHat: true
  });
});
