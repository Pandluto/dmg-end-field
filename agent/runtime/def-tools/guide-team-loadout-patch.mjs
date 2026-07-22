export function buildGuideTeamLoadoutExactPatch({
  selected,
  products,
  manifestWeapon,
  resolvedWeapon,
}) {
  const patch = {
    characterId: selected.characterId,
    characterName: selected.characterName,
    equipments: products.map((product) => ({
      slotKey: product.slotKey,
      equipmentId: product.equipmentId,
      equipmentName: product.name,
      gearSetId: product.gearSetId,
      entryLevels: Object.fromEntries(
        product.effects.map((effect) => [effect.effectId, effect.level]),
      ),
    })),
  };

  // A preserve-current manifest intentionally omits the weapon mutation.
  // Exact-name manifests must carry the reviewed weapon into the same atomic
  // operator-config preview as the four equipment slots.
  if (manifestWeapon?.mode === 'exact-name' && resolvedWeapon?.name) {
    patch.weapon = {
      id: resolvedWeapon.id || '',
      name: resolvedWeapon.name,
      level: resolvedWeapon.level ?? manifestWeapon.level ?? 1,
      potential: resolvedWeapon.potential ?? undefined,
      skillLevels: resolvedWeapon.skillLevels || {},
    };
  }

  return patch;
}
