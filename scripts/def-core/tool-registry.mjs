export function createDefCoreToolRegistry({ buildDefinitions, createRegistry }) {
  if (typeof buildDefinitions !== 'function') throw new TypeError('DEF tool registry requires buildDefinitions');
  if (typeof createRegistry !== 'function') throw new TypeError('DEF tool registry requires createRegistry');

  const registry = createRegistry(buildDefinitions());
  return Object.freeze({
    definitions: registry,
    get(name) {
      return registry.find((tool) => tool.name === name) || null;
    },
  });
}
