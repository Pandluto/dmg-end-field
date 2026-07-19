export function createDefCoreRuntimeComposition(options) {
  const {
    createAiTimelineWorkNodeStore,
    createTimelineRepository,
    createDataManagementService,
    aiTimelineWorkNodesPath,
    legacyAiTimelineWorkNodesPath,
    timelineRepositoryPath,
    dataManagementRuntimeRoot,
    builtinCatalogPath,
  } = options;

  let aiTimelineWorkNodeStore;
  let timelineRepository;
  let dataManagementService;

  function getAiTimelineWorkNodeStore() {
    if (!aiTimelineWorkNodeStore) {
      aiTimelineWorkNodeStore = createAiTimelineWorkNodeStore({
        databasePath: aiTimelineWorkNodesPath,
        legacyJsonPath: legacyAiTimelineWorkNodesPath,
      });
    }
    return aiTimelineWorkNodeStore;
  }

  function getTimelineRepository() {
    if (!timelineRepository) {
      timelineRepository = createTimelineRepository({ databasePath: timelineRepositoryPath });
      timelineRepository.migrateLegacyWorkNodeArchive(getAiTimelineWorkNodeStore().readArchive());
    }
    return timelineRepository;
  }

  function getDataManagementService() {
    if (!dataManagementService) {
      dataManagementService = createDataManagementService({
        runtimeDataRoot: dataManagementRuntimeRoot,
        builtinCatalogPath,
      });
      dataManagementService.ensureUserDatabase();
    }
    return dataManagementService;
  }

  return Object.freeze({
    getAiTimelineWorkNodeStore,
    getTimelineRepository,
    getDataManagementService,
  });
}
