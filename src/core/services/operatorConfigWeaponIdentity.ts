export interface OperatorConfigWeaponIdentity {
  id: string;
  name: string;
}

export interface OperatorConfigWeaponProduct extends OperatorConfigWeaponIdentity {
  sourceKey: string;
  raw: Record<string, unknown>;
}

export class OperatorConfigWeaponIdentityError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'OperatorConfigWeaponIdentityError';
    this.code = code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function listOperatorConfigWeaponProducts(rawLibrary: unknown): OperatorConfigWeaponProduct[] {
  if (!isRecord(rawLibrary)) return [];
  return Object.entries(rawLibrary).flatMap(([sourceKey, rawValue]) => {
    if (!isRecord(rawValue)) return [];
    const id = String(rawValue.id || sourceKey || '').trim();
    const name = String(rawValue.name || '').trim();
    return id && name ? [{ id, name, sourceKey, raw: rawValue }] : [];
  });
}

export function indexOperatorConfigWeaponProductsById(
  rawLibrary: unknown,
): Record<string, OperatorConfigWeaponProduct> {
  const products = listOperatorConfigWeaponProducts(rawLibrary);
  const counts = new Map<string, number>();
  products.forEach((product) => counts.set(product.id, (counts.get(product.id) || 0) + 1));
  return Object.fromEntries(
    products.filter((product) => counts.get(product.id) === 1).map((product) => [product.id, product]),
  );
}

export function resolveOperatorConfigWeaponIdentity(
  rawLibrary: unknown,
  requested: Partial<OperatorConfigWeaponIdentity>,
): OperatorConfigWeaponProduct {
  const id = typeof requested.id === 'string' ? requested.id.trim() : '';
  const name = typeof requested.name === 'string' ? requested.name.trim() : '';
  if (!id || !name) {
    throw new OperatorConfigWeaponIdentityError(
      'operator-config-weapon-identity-required',
      'A weapon command requires one stable id and its exact catalog name.',
    );
  }
  const matches = listOperatorConfigWeaponProducts(rawLibrary).filter((product) => product.id === id);
  if (matches.length !== 1) {
    throw new OperatorConfigWeaponIdentityError(
      matches.length > 1
        ? 'operator-config-weapon-library-ambiguous'
        : 'operator-config-weapon-library-unavailable',
      matches.length > 1
        ? `Weapon id ${id} is duplicated in the renderer product library.`
        : `Weapon id ${id} is not available in the renderer product library.`,
    );
  }
  if (matches[0].name !== name) {
    throw new OperatorConfigWeaponIdentityError(
      'operator-config-weapon-identity-mismatch',
      `Weapon id ${id} does not have the requested catalog name.`,
    );
  }
  return matches[0];
}

export function applyOperatorConfigWeaponIdentityToSnapshot<
  TWeapon extends object,
  TSnapshot extends { weapon: TWeapon },
>(
  snapshot: TSnapshot,
  rawLibrary: unknown,
  requested: Partial<OperatorConfigWeaponIdentity>,
): {
  snapshot: Omit<TSnapshot, 'weapon'> & { weapon: TWeapon & OperatorConfigWeaponIdentity };
  product: OperatorConfigWeaponProduct;
} {
  const product = resolveOperatorConfigWeaponIdentity(rawLibrary, requested);
  return {
    product,
    snapshot: {
      ...snapshot,
      weapon: {
        ...snapshot.weapon,
        id: product.id,
        name: product.name,
      },
    },
  };
}
