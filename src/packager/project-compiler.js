import {getScaffoldingURL, loadScaffolding} from './load-scaffolding';

class ProjectCompiler {
  constructor (projectData) {
    this.projectData = projectData;
    this.scripts = [];
    this.procedures = [];
  }

  async compileScripts () {
    const scaffoldingURL = getScaffoldingURL(this.projectData.meta.platform, false);
    await loadScaffolding(scaffoldingURL);

    // We can now assume that "Scaffolding" exists on the window object.
    const scaffolding = new globalThis.Scaffolding.Scaffolding();

    scaffolding.setup();
    const vm = scaffolding.vm;

    scaffolding.setExtensionSecurityManager({
      getSandboxMode: () => 'unsandboxed',
      canLoadExtensionFromProject: () => true
    });

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
        let JSGenerator;
        if ('JSGenerator' in vm.exports) {
          JSGenerator = vm.exports.JSGenerator;
        } else if ('these_broke_before_and_will_break_again' in vm.exports) {
           JSGenerator = vm.exports.these_broke_before_and_will_break_again().JSGenerator;
        } else if ('i_will_not_ask_for_help_when_these_break' in vm.exports) {
          JSGenerator = vm.exports.i_will_not_ask_for_help_when_these_break().JSGenerator; 
        } else {
          // give up
          throw new Error('Failed to extract JSGenerator');  
        }

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
