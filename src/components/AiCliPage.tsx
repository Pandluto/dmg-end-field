import { APP_ROUTE_PATHS, navigateToAppPath } from '../utils/appRoute';
import { DefOpenCodeView } from './def-opencode/DefOpenCodeView';

export function isAiCliPath(pathname: string) {
  return pathname === APP_ROUTE_PATHS.aiCli;
}

export function AiCliPage() {
  return (
    <main style={{ width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <DefOpenCodeView
        host="ai-cli"
        title="DEF /AI CLI"
        onClose={() => navigateToAppPath(APP_ROUTE_PATHS.home)}
      />
    </main>
  );
}
