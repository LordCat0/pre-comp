class ProjectCompiler {
  constructor (projectData) {
    this.projectData = projectData;
    this.scripts = [];
  }

  getScaffoldingURL () {
    const platform = this.projectData.meta.platform;
    if (!platform) {
      return 'https://packager.turbowarp.org/scaffolding/scaffolding-min.js'
    }

    switch (platform.name) {
      // Support packaging more origins by adding more scaffolding URL's.
      case 'PenguinMod':
        return 'https://studio.penguinmod.com/PenguinMod-Packager/scaffolding/scaffolding-min.js';
      case 'NitroBolt':
        return 'https://packager.nitrobolt.org/scaffolding/scaffolding-min.js';
      default:
        return 'https://packager.turbowarp.org/scaffolding/scaffolding-min.js'
    }
  }

  loadScaffolding () {
    if ('Scaffolding' in window) {
      delete window.Scaffolding;
    }

    return new Promise(async (resolve, reject) => {
        const url = this.getScaffoldingURL();
        await import(/* webpackIgnore: true */ url);

        setTimeout(() => {
            if ('Scaffolding' in window) {
              resolve();
            } else {
              reject('Scaffolding failed to load in 100ms');
            }
        }, 100);
    });
  }

  async compileScripts () {
    await this.loadScaffolding();

    // We can now assume that "Scaffolding" exists on the window object.
    const scaffolding = new globalThis.Scaffolding.Scaffolding();

    scaffolding.setup();
    const vm = scaffolding.vm;

    await scaffolding.loadProject(this.projectData);

    // Start compiling scripts
    vm.runtime.precompile();
    vm.runtime.allScriptsDo((topBlockId, target) => {
      const compilerResult = target.blocks._cache.compiledScripts[topBlockId];
      if (!compilerResult) {
        return;
      }
      if (!compilerResult.success) {
        throw compilerResult.value;
      }

      const {startingFunction, procedures, executableHat} = compilerResult.value;

      const procedureFactories = Object.keys(procedures)
        .map(code => `${JSON.stringify(code)}: ${procedures[code].toString()}`)
        .join(',');
      this.scripts.push({
        targetName: target.getName(),
        isStage: target.isStage,
        topBlockId,
        startingFunction: startingFunction.toString(),
        procedures: `{${procedureFactories}}`,
        executableHat
      });
    });
  }

  getScript () {
    // todo: don't use unstable compiler API's to make this work.
    return `
      const scripts = [${this.scripts.map(script => `{
        targetName: ${JSON.stringify(script.targetName)},
        isStage: ${script.isStage},
        topBlockId: ${JSON.stringify(script.topBlockId)},
        startingFunction: ${script.startingFunction},
        procedures: ${script.procedures},
        executableHat: ${script.executableHat}
      }`)}];
      vm.runtime.on('RUNTIME_STARTED', () => {
        for (const ext of ${JSON.stringify(this.projectData.extensions)}) {
          vm.extensionManager.loadExtensionIdSync(ext);
        }
        const {JSGenerator} = vm.exports.these_broke_before_and_will_break_again();
        const restore = factory => JSGenerator.prototype.compile.call({
          script: {},
          stopScript() {},
          createScriptFactory() {
            return factory.toString();
          }
        });

        for (const script of scripts) {
          const target = vm.runtime.targets.find(item => (
            item.isStage === script.isStage &&
            item.getName() === script.targetName &&
            item.blocks.getBlock(script.topBlockId)
          ));
          if (!target) {
            throw new Error('Missing target for precompiled script ' + script.topBlockId);
          }
          const procedures = {};
          for (const code of Object.keys(script.procedures)) {
            procedures[code] = restore(script.procedures[code]);
          }
          target.blocks.cacheCompileResult(script.topBlockId, {
            startingFunction: restore(script.startingFunction),
            procedures,
            executableHat: script.executableHat
          });
        }
      });
    `;
  }
};

export default ProjectCompiler;
