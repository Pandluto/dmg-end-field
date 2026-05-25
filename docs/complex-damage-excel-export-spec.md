# Complex Damage Excel Export Spec

## Goal

Export an Excel workbook that represents the same damage data lineage as the app, not a static report and not a programmer debug trace.

The workbook should let a user follow formulas from final damage back to the hit inputs, then back to panel calculation values and normalized buff sources.

## Non-Goals

- Do not add programmer-facing trace sheets such as "program trace" or "zone trace".
- Do not make `config` a primary calculation sheet.
- Do not make `snapshot` a primary calculation dependency.
- Do not make `display` values drive formulas.
- Do not duplicate core app calculation logic in hidden code paths.

## Workbook Shape

### operator

Stores operator source data used by panel calculation.

Expected content:

- operator id
- operator name
- level
- potential
- element
- main stat
- sub stat
- base attack and other base attributes

This sheet is a source sheet. It can be referenced by panel/hit formulas, but final damage should not reference it directly.

### weapon

Stores weapon source data used by panel calculation and normalized buff generation.

Expected content:

- weapon id
- weapon name
- weapon level
- weapon potential
- attack contribution
- passive effects
- conditional effects
- skill levels

Weapon proc or conditional effects should not be handled directly in the damage sheet. They should be normalized into the `buff` sheet when they affect damage zones.

### equipment

Stores equipment and set source data used by panel calculation and normalized buff generation.

Expected content:

- gear set id
- equipment id
- equipment name
- slot/part
- fixed stats
- effect type
- effect value
- set effects

Equipment effects that act like damage modifiers should be normalized into the `buff` sheet.

### buff

The unified normalized modifier layer.

All dynamic or conditional damage modifiers should be represented here regardless of original source:

- skill buff
- weapon proc
- equipment effect
- set effect
- anomaly/state effect
- manual buff
- any other runtime modifier

Expected columns:

- buff id
- source type: `operator`, `weapon`, `equipment`, `set`, `skill`, `anomaly`, `manual`, etc.
- source id
- source name
- display name
- type, e.g. `allDmgBonus`, `physicalAmplify`, `multiplierBonus`
- value
- target mode: `all`, `damageKey`, `skillType`, `element`
- target key
- enabled
- note/condition

The `hit` sheet consumes the `buff` sheet by formula filters. It should not need to understand the original weapon/equipment/proc rules.

### snapshot

Snapshot is an export note sheet only.

It can record:

- export time
- app version
- selected operators
- selected buttons
- selected weapon/equipment summary
- raw session/local storage excerpts if useful

Snapshot is not part of the primary formula chain.

### hit

The hit sheet is the core runtime consumption sheet.

There is no separate "runtime snapshot" sheet. Runtime snapshot values are only useful because hit consumes them, so they belong in `hit`.

Each row represents one damage hit. It should include:

- hit id
- operator id
- button id
- skill name/type
- hit key/name
- element
- base multiplier
- panel calc inputs consumed by this hit
- buff-filtered zone inputs consumed by this hit
- final zone coefficients consumed by damage

The hit sheet is allowed to contain helper columns. These columns are part of the model, not programmer debug output.

### damage

The damage sheet is the final user-facing damage process table.

It should consume `hit` only for formula inputs.

Example formula lineage:

```text
damage.nonCrit
  = hit.atk
  * hit.finalMultiplier
  * hit.damageBonusRate
  * hit.defenseZone
  * hit.amplifyZone
  * hit.fragileZone
  * hit.vulnerabilityZone
  * hit.comboZone
  * hit.imbalanceZone
```

Damage should not directly reference `operator`, `weapon`, or `equipment`.

## Formula Lineage

The intended chain is:

```text
operator / weapon / equipment
        -> panel calc values
buff sources
        -> normalized buff rows
panel calc + normalized buff rows
        -> hit runtime inputs
hit runtime inputs
        -> damage process
```

## Panel Values

Use panel calculation values as formula inputs.

Do not use display values as the source of truth.

Terminology:

- `panel.calc`: calculation values used by formulas
- `panel.display`: optional values for human comparison with the app UI

If display values are exported, they should sit beside the calc values as reference only.

## Hit Zone Formulas

### Attack

`hit.atk` should be traceable to panel calculation inputs.

Depending on available source data, the formula can be:

```text
hit.atk = operator contribution + weapon contribution + equipment contribution + applicable buff contribution
```

If the current app only exposes the runtime calculated attack for a hit, the hit sheet may store that runtime value, but the source column must identify it as a runtime panel calc value.

### Multiplier Zone

```text
hit.multiplierAfterBonus = hit.baseMultiplier + matching buff.multiplierBonus
hit.finalMultiplier = hit.multiplierAfterBonus * matching buff.multiplierMultiplier
```

Matching is based on buff target mode and the current hit.

### Damage Bonus Zone

The damage bonus zone is not a single source value.

```text
hit.elementBonus =
  panel.calc element bonus for this hit element
  + matching buff element bonus
  + matching buff generic element/magic bonus

hit.skillBonus =
  panel.calc skill bonus for this hit skill type
  + matching buff skill bonus
  + matching buff all-skill bonus

hit.allDamageBonus =
  panel.calc all damage bonus
  + matching buff all damage bonus

hit.damageBonusRate =
  1 + hit.elementBonus + hit.skillBonus + hit.allDamageBonus
```

For physical hits, element matching uses physical bonus.

For elemental/magic hits, element matching includes:

- the specific element damage bonus
- magic damage bonus when the app treats the hit as magic/elemental
- all-element damage bonus if applicable

### Defense Zone

Defense zone is a hit input.

Current app behavior may be a fixed coefficient. If it remains fixed, the hit sheet should make that explicit:

```text
hit.defenseZone = 0.5
```

### Amplify / Fragile / Vulnerability Zones

Each zone follows the same pattern:

```text
hit.zoneRate =
  panel.calc zone value if present
  + matching buff zone value

hit.zoneCoefficient =
  1 + hit.zoneRate
```

Element matching follows current app logic:

- physical hit uses physical zone type
- non-physical hit uses specific element zone type plus magic zone type where applicable

### Combo Zone

```text
hit.comboZone = 1 + matching buff.comboDamageBonus
```

If panel calc later contributes combo values, add panel calc value before buff values.

### Imbalance Zone

```text
hit.imbalanceZone =
  1
  + panel.calc imbalance value if present
  + matching buff.imbalanceDmgBonus
```

If current app applies an imbalance value from operator/panel info for physical damage, that value belongs in panel calc or an explicitly named hit helper column, not in a programmer trace table.

## Buff Matching Rules

The `hit` sheet should match buff rows using the same target concept as the app:

- `all`: applies to every hit
- `damageKey`: applies when buff target key equals hit key
- `skillType`: applies when buff skill type equals hit skill type
- `element`: applies when buff element equals hit element

Disabled buff rows should not contribute.

The exact Excel implementation may use helper columns in `buff` or `hit` to avoid unreadable formulas. Helper columns are acceptable when they represent business concepts.

## Sheet Dependency Rule

Allowed primary dependencies:

```text
damage -> hit
hit -> operator / weapon / equipment / buff
snapshot -> none
```

Avoid:

```text
damage -> operator
damage -> weapon
damage -> equipment
damage -> snapshot
hit -> snapshot for main calculations
```

## Implementation Notes

The export feature remains an external add-on to the app. It reads current app state and builds an Excel model. It should not mutate core app state or replace core runtime calculation.

However, the workbook formula structure should reflect the app's business model:

```text
source data -> normalized buff/panel inputs -> hit -> damage
```

not:

```text
final JS result -> debug trace -> report
```
