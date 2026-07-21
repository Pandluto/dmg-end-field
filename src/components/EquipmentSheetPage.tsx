export { isEquipmentSheetPath } from './equipmentSheetPageModel';
import { useEquipmentSheetPageController } from './useEquipmentSheetPageController';
import { EquipmentSheetPageView } from './EquipmentSheetPageView';

export function EquipmentSheetPage() {
  const controller = useEquipmentSheetPageController();
  return <EquipmentSheetPageView {...controller} />;
}
