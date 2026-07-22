export function normalizeRequiredDefToolString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function expandDefTypedFailureDetails(failure) {
  if (!failure || typeof failure !== 'object') return failure;
  return failure.details && typeof failure.details === 'object' && !Array.isArray(failure.details)
    ? { ...failure, ...failure.details }
    : failure;
}

export function compactTypedFailureDetails(failure) {
  if (!failure || typeof failure !== 'object') return null;
  const effective = expandDefTypedFailureDetails(failure);
  const diagnostics = effective.diagnostics;
  const compactIssues = (issues) => (Array.isArray(issues)
    ? issues.slice(0, 8).map((issue) => ({
      code: issue?.code,
      path: issue?.path,
      stableId: issue?.stableId,
      message: issue?.message,
    }))
    : []);
  if (!diagnostics || typeof diagnostics !== 'object') {
    return effective.nextAction || effective.retryable !== undefined || Array.isArray(effective.catalogIssues)
      ? {
        retryable: effective.retryable,
        failureStage: effective.failureStage,
        nextAction: effective.nextAction,
        catalogIssues: compactIssues(effective.catalogIssues),
      }
      : null;
  }
  return {
    retryable: effective.retryable,
    failureStage: effective.failureStage,
    nextAction: effective.nextAction,
    stage: diagnostics.stage,
    beforeCanonicalHash: diagnostics.beforeCanonicalHash,
    afterCanonicalHash: diagnostics.afterCanonicalHash,
    changedPaths: Array.isArray(diagnostics.changedPaths) ? diagnostics.changedPaths.slice(0, 24) : [],
    validatorIssues: {
      before: compactIssues(diagnostics.validatorIssues?.before),
      after: compactIssues(diagnostics.validatorIssues?.after),
    },
    catalogIssues: compactIssues(diagnostics.catalogIssues || effective.catalogIssues),
  };
}
