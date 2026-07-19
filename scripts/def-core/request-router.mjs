export const DEF_CORE_ROUTE_FAMILIES = Object.freeze([
  '/api/ai-timeline-worknodes*',
  '/api/timeline-*',
  '/api/def-tools/*',
  '/api/main-workbench/*',
]);

export function createDefCoreRequestRouter(dependencies) {
  const {
    handleAiTimelineWorkNodeRequest,
    handleTimelineRepositoryRequest,
    handleDefToolRequest,
    handleMainWorkbenchRequest,
  } = dependencies;

  for (const [name, value] of Object.entries({
    handleAiTimelineWorkNodeRequest,
    handleTimelineRepositoryRequest,
    handleDefToolRequest,
    handleMainWorkbenchRequest,
  })) {
    if (typeof value !== 'function') throw new TypeError(`DEF core router requires ${name}`);
  }

  return async function routeDefCoreRequest(request) {
    const { method, pathname, searchParams, body, rawInvocation } = request;

    const workNodeResponse = await handleAiTimelineWorkNodeRequest(method, pathname, body, rawInvocation);
    if (workNodeResponse) return workNodeResponse;

    const timelineResponse = await handleTimelineRepositoryRequest(method, pathname, searchParams, body, rawInvocation);
    if (timelineResponse) return timelineResponse;

    const toolResponse = await handleDefToolRequest(method, pathname, searchParams, body, rawInvocation);
    if (toolResponse) return toolResponse;

    return handleMainWorkbenchRequest(method, pathname, searchParams, body, rawInvocation);
  };
}
