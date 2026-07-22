function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Bind the one-turn 3+1 recommendation ports to the selected immutable game
 * catalog. The Data Management service owns validation, activation and the
 * SQLite read; this adapter only narrows its result to the two business
 * readers needed by the recommendation service.
 */
export function createDefEquipment3Plus1ActiveCatalogReaders({ getDataManagementService, capturedAt = 0 } = {}) {
  if (typeof getDataManagementService !== 'function') {
    throw new TypeError('3+1 active catalog readers require getDataManagementService().');
  }

  let capturedCatalog = null;

  function readCatalog() {
    if (capturedCatalog) return capturedCatalog;
    const dataManagementService = getDataManagementService();
    if (typeof dataManagementService?.readActiveGameCatalog !== 'function') {
      throw new TypeError('Data Management service must provide readActiveGameCatalog().');
    }
    const catalog = dataManagementService.readActiveGameCatalog();
    if (!isPlainObject(catalog)
      || typeof catalog.dataVersion !== 'string'
      || !catalog.dataVersion.trim()
      || !isPlainObject(catalog.operators)
      || !isPlainObject(catalog.equipmentLibrary)) {
      throw new TypeError('readActiveGameCatalog() returned an invalid active game catalog.');
    }
    capturedCatalog = catalog;
    return capturedCatalog;
  }

  return Object.freeze({
    readOperatorCatalog() {
      return readCatalog().operators;
    },
    readEquipmentLibrarySource() {
      const catalog = readCatalog();
      return {
        library: catalog.equipmentLibrary,
        storageKey: `catalog:${catalog.dataVersion}`,
        capturedAt,
      };
    },
  });
}
