const cachedScaffolding = {};

class ProjectCompiler {
  constructor (projectData) {
    this.projectData = projectData;
    this.scripts = [];
    this.procedures = [];
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

  async loadScaffolding () {
    const url = this.getScaffoldingURL();
    if (cachedScaffolding[url]) {
      globalThis.Scaffolding = cachedScaffolding[url];
      return;
    }

    delete globalThis.Scaffolding;
    await import(/* webpackIgnore: true */ url);
    if (!globalThis.Scaffolding) {
      throw new Error('Scaffolding failed to load');
    }
    cachedScaffolding[url] = globalThis.Scaffolding;
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
        .map(code => {
          const source = procedures[code].toString();
          let index = this.procedures.indexOf(source);
          if (index === -1) {
            index = this.procedures.push(source) - 1;
          }
          return `${JSON.stringify(code)}: ${index}`;
        })
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
      const procedureFactories = [${this.procedures.join(',')}];
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
        const compiledProcedureFactories = procedureFactories.map(restore);

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
            procedures[code] = compiledProcedureFactories[script.procedures[code]];
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
