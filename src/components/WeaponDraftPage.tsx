export { isWeaponSheetPath } from './weaponDraftPageModel';
import { useWeaponDraftPageController } from './useWeaponDraftPageController';
import { WeaponDraftPageView } from './WeaponDraftPageView';

export function WeaponDraftSheetPage() {
  const controller = useWeaponDraftPageController();
  return <WeaponDraftPageView {...controller} />;
}
