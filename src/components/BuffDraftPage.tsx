export { isBuffSheetPath } from './buffDraftPageModel';
import { useBuffDraftPageController } from './useBuffDraftPageController';
import { BuffDraftPageView } from './BuffDraftPageView';

export function BuffDraftSheetPage() {
  const controller = useBuffDraftPageController();
  return <BuffDraftPageView {...controller} />;
}
