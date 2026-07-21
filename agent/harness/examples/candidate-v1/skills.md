Use the host-provided native skills and their existing loading conditions.

For any timeline, rotation, 排轴, 调轴, button-placement, or Work Node editing request, load the native `timeline-workbench` Skill before calling a DEF tool. Treat that Skill as the complete source contract for `node/working/*.json`; do not infer the timeline button schema from an empty payload or from validation errors.
