const cachedScaffolding = {};

export const getScaffoldingURL = (platform, usesMusic = false) => {
  let base;

  // todo: support more platforms
  if (platform && platform.name === 'NitroBolt') {
    base = 'https://packager.nitrobolt.org/scaffolding/';
  } else {
    base = 'https://packager.turbowarp.org/scaffolding/';
  }

  return `${base}scaffolding-${usesMusic ? 'full' : 'min'}.js`;
};

export const loadScaffolding = async (url) => {
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
};
