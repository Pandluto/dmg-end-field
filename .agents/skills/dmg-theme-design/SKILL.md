---
name: dmg-theme-design
description: Design, extend, audit, or repair visual themes for the DMG Endfield web app. Use when adding a theme, changing theme colors or typography, styling SVGs and charts, fixing incomplete theme coverage, or reviewing screenshots of timeline, configuration, Buff, node-tree, data-sheet, damage, and PPT report surfaces.
---

# DMG Theme Design

Treat a theme as a complete semantic skin over the existing product. Preserve the application, data, and interaction model unless the user explicitly requests a structural redesign.

## Start from the theme contract

1. Read `src/styles/themes/theme-contract.css`, `src/platform/theme/appTheme.ts`, and `src/styles/global.css`.
2. Inspect the closest existing theme, but do not inherit its omissions blindly.
3. Define one mapping for canvas, panels, text levels, border levels, accent, focus, selected, disabled, main attribute, sub attribute, and chart series before writing overrides.
4. Add a dedicated `:root[data-theme="<theme-id>"]` stylesheet. Keep new-theme rules scoped to that selector.
5. Add the theme ID and option in `appTheme.ts`, then import the stylesheet from `global.css`.
6. Leave `office-excel` (the existing white theme) unchanged unless the user explicitly asks to modify it.

## Preserve these invariants

- Do not place monochrome filters, tint layers, masks, opacity washes, or blend modes over operator portraits, equipment and weapon art, skill icons, logos, or other authored full-color images.
- Do not replace or reshape an existing SVG. Keep its paths, proportions, and layer structure; change each layer's fill, stroke, opacity, glow, and state colors only. In particular, keep the potential graphic as its SVG rather than replacing it with ticks or another widget.
- Do not change business logic, persisted data, image lookup, event behavior, hit areas, or data calculations for a theme task.
- Do not change chart values, area/radius encoding, ordering, or meaning. Change chart geometry or chart type only when the user explicitly requests it.
- Do not restructure the DOM, resize the fixed workspace, or move core controls merely to achieve a look. Permit small spacing or sizing corrections only to prevent clipping, overlap, or unreadability.
- Preserve every semantic distinction: main versus sub attribute, selected versus unselected, enabled versus disabled, active versus inactive potential, source/category differences, warnings, and destructive actions.
- Map equal meanings to equal colors and treatments across the app. If A, B, and C express the same state, do not assign unrelated colors to them.
- Do not erase useful contrast by turning the entire interface gray or black. A monochrome-led theme still needs luminance hierarchy, controlled accents, and distinguishable charts.

## Visual language that may change

- Change theme tokens, background materials, fills, text colors, SVG layer colors, chart palettes, borders, shadows, focus rings, typography, translucency, and radii.
- Use solid, dotted, dashed, double, or decorative line systems when they have a consistent semantic purpose.
- Use theme-specific selected, hover, pressed, focus, and disabled treatments.
- Change border weight to restore separation. Dark themes should use several strengths of light borders instead of leaving legacy black outlines invisible.
- Use glass or frosted surfaces when appropriate, but keep large bright fills restrained and keep text crisp; avoid blurry white text, heavy glow, and unnecessary text shadow.
- On a rounded card or rounded control, do not add a lone high-contrast stripe down the left edge. Express selection with the whole border, fill, shadow, or a contained indicator.
- Treat a draggable skill button's circle and rectangular body as one composition. If outlining it, make the outer contour coherent rather than styling only the circular section.
- Recolor authored SVG layers and simple monochrome skill glyphs when the theme calls for it, while leaving full-color raster art untouched.
- Keep theme typography consistent across every route rather than changing only the main workspace.

## Cover the whole product

Audit all of these surfaces; a theme is incomplete if any visible overlay or secondary route falls back to the base styling.

- Start, data workspace, settings, authentication, and floating logo/menu surfaces.
- Timeline workspace: selection panel, operator avatars, draggable skill buttons, tool panels, hover/selected states, split surfaces, and empty/error states.
- Operator configuration: left-side operator picker, weapon and equipment sections, both existing SVG groups, potential active/inactive states, and main/sub attribute markers.
- Skill detail: selected Buff list and its scrolling, status/anomaly panels, damage calculation, target resistance, and hit tuning.
- Buff workflows: double-click editor, add-Buff dialog, batch-Buff workbench, dropdowns, tooltips, and confirmation dialogs.
- Work-node tree: grid, nodes, selection, focus, relationships, context menus, and disabled states.
- Data routes: operator, Buff, weapon, equipment, image management, tables, formula bars, explorers, modals, and context menus.
- Damage sheet and damage-calculation views.
- Export, import, recovery, resource download, and failure/empty feedback.
- PPT report: 01 summary and equipment imagery, 02 timeline preview and buttons, 03 damage charts, legends, labels, and print/export output.

Portals, popovers, modals, context menus, and full-screen overlays count as separate surfaces even when opened from a themed page.

## Design and implementation workflow

1. Capture representative screenshots with real project data before editing.
2. Write a small semantic palette table in working notes. Include at least three background levels, three text levels, three border levels, interaction accent, main/sub attributes, selected/disabled states, and a distinguishable chart palette.
3. Implement contract variables first, then add narrowly scoped component overrides only where variables cannot reach.
4. Search for hard-coded colors and global selectors in the target surfaces. Do not mechanically replace colors without identifying their meaning.
5. Verify the same meaning receives the same treatment on every route.
6. Inspect real screenshots at 100% scale. Judge hierarchy, density, readability, image fidelity, clipping, scrolling, and the visual relationship between adjacent components.
7. Iterate from visual evidence. A technically applied selector is not proof that the theme looks complete.
8. Run `npm run build` and `git diff --check`. Commit the focused theme change according to repository instructions.

## Visual acceptance checklist

- Confirm full-color assets remain clean and untinted.
- Confirm SVG geometry is unchanged and every active/inactive layer remains legible.
- Confirm main/sub attributes and selected/unselected states are immediately distinguishable without relying only on text.
- Confirm dark borders did not disappear on dark backgrounds and light borders do not become a noisy cage.
- Confirm charts communicate proportions at a glance; labels and legends must not compensate for indistinguishable segments.
- Confirm rounded containers do not use the rejected left-edge stripe treatment.
- Confirm long Buff lists scroll instead of stacking or clipping.
- Confirm typography and button language remain consistent from the main workspace through configuration, sheets, damage views, and PPT reports.
- Confirm hover, focus, pressed, disabled, modal, popover, and context-menu states.
- Confirm the original white theme still renders as before.

When a requested visual change conflicts with an invariant, stop and state the conflict before changing structure, data meaning, SVG geometry, or authored imagery.
