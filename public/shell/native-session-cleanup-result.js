(function exposeNativeSessionCleanupResult(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.defNativeSessionCleanupResult = api;
})(typeof window === 'object' ? window : null, function createNativeSessionCleanupResultApi() {
  function summarize(payload, expectedKeepSessionID) {
    if (
      payload?.host !== 'ai-cli'
      || payload.keptSessionID !== expectedKeepSessionID
      || !Number.isInteger(payload.targetCount)
      || !Number.isInteger(payload.deletedCount)
      || !Number.isInteger(payload.alreadyDeletedCount)
      || !Array.isArray(payload.failed)
    ) {
      throw new Error('会话清理服务返回了无效结果。');
    }

    const failedCount = payload.failed.length;
    return {
      failedCount,
      summary: `${payload.ok && failedCount === 0 ? '清理完成' : '清理未完全完成'}：已删除 ${payload.deletedCount}，已不存在 ${payload.alreadyDeletedCount}，失败 ${failedCount}。当前会话已保留。`,
    };
  }

  function appendRefreshWarning(summary, error) {
    const detail = error instanceof Error ? error.message : String(error);
    return `${summary} 清理结果已确认；刷新会话列表失败：${detail}`;
  }

  return {
    appendRefreshWarning,
    summarize,
  };
});
