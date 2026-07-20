export function buildDefOperatorConfigInput(args = {}) {
  const weapon = typeof args.weaponName === 'string' && args.weaponName.trim()
    ? {
        name: args.weaponName.trim(),
        ...(typeof args.weaponPotential === 'string' ? { potential: args.weaponPotential } : {}),
        ...(args.weaponLevel !== undefined ? { level: args.weaponLevel } : {}),
        skillLevels: {
          ...(args.weaponSkill1Level !== undefined ? { skill1: args.weaponSkill1Level } : {}),
          ...(args.weaponSkill2Level !== undefined ? { skill2: args.weaponSkill2Level } : {}),
          ...(args.weaponSkill3Level !== undefined ? { skill3: args.weaponSkill3Level } : {}),
        },
      }
    : undefined
  return {
    ...(typeof args.characterId === 'string' && args.characterId.trim() ? { characterId: args.characterId.trim() } : {}),
    ...(typeof args.characterName === 'string' && args.characterName.trim() ? { characterName: args.characterName.trim() } : {}),
    ...(weapon ? { weapon } : {}),
    ...(typeof args.gearSetName === 'string' && args.gearSetName.trim() ? { gearSetName: args.gearSetName.trim() } : {}),
    ...(typeof args.gearSetId === 'string' && args.gearSetId.trim() ? { gearSetId: args.gearSetId.trim() } : {}),
    ...(typeof args.equipmentName === 'string' && args.equipmentName.trim() ? { equipmentName: args.equipmentName.trim() } : {}),
    ...(typeof args.equipmentId === 'string' && args.equipmentId.trim() ? { equipmentId: args.equipmentId.trim() } : {}),
    ...(typeof args.slotKey === 'string' && args.slotKey.trim() ? { slotKey: args.slotKey.trim() } : {}),
    ...(args.fillSlots === true ? { fillSlots: true } : {}),
    ...(args.equipmentEntryLevel !== undefined ? { equipmentEntryLevel: args.equipmentEntryLevel } : {}),
    ...((args.equipmentEntry1Level !== undefined || args.equipmentEntry2Level !== undefined || args.equipmentEntry3Level !== undefined)
      ? { equipmentEntryLevels: {
          ...(args.equipmentEntry1Level !== undefined ? { effect1: args.equipmentEntry1Level } : {}),
          ...(args.equipmentEntry2Level !== undefined ? { effect2: args.equipmentEntry2Level } : {}),
          ...(args.equipmentEntry3Level !== undefined ? { effect3: args.equipmentEntry3Level } : {}),
        } }
      : {}),
    ...(Array.isArray(args.equipments) && args.equipments.length
      ? { equipments: args.equipments.map((equipment) => ({
          equipmentId: equipment.equipmentId.trim(),
          ...(typeof equipment.equipmentName === 'string' && equipment.equipmentName.trim() ? { equipmentName: equipment.equipmentName.trim() } : {}),
          slotKey: equipment.slotKey,
          ...(equipment.equipmentEntryLevel !== undefined ? { entryLevel: equipment.equipmentEntryLevel } : {}),
          ...((equipment.equipmentEntry1Level !== undefined || equipment.equipmentEntry2Level !== undefined || equipment.equipmentEntry3Level !== undefined)
            ? { entryLevels: {
                ...(equipment.equipmentEntry1Level !== undefined ? { effect1: equipment.equipmentEntry1Level } : {}),
                ...(equipment.equipmentEntry2Level !== undefined ? { effect2: equipment.equipmentEntry2Level } : {}),
                ...(equipment.equipmentEntry3Level !== undefined ? { effect3: equipment.equipmentEntry3Level } : {}),
              } }
            : {}),
        })) }
      : {}),
    ...((args.operatorSkillA || args.operatorSkillB || args.operatorSkillE || args.operatorSkillQ)
      ? { operatorSkillLevels: {
          ...(args.operatorSkillA ? { A: args.operatorSkillA } : {}),
          ...(args.operatorSkillB ? { B: args.operatorSkillB } : {}),
          ...(args.operatorSkillE ? { E: args.operatorSkillE } : {}),
          ...(args.operatorSkillQ ? { Q: args.operatorSkillQ } : {}),
        } }
      : {}),
  }
}

export function hasDefOperatorConfigSelection(input = {}) {
  return Boolean(input.weapon || input.gearSetName || input.gearSetId || input.equipmentName || input.equipmentId || input.equipments?.length)
}

export async function executeDefOperatorConfigAtomic(args, context, dependencies) {
  const input = buildDefOperatorConfigInput(args)
  if (!hasDefOperatorConfigSelection(input)) {
    throw new Error('Provide an exact weapon or equipment selection before applying operator configuration.')
  }
  const prepared = await dependencies.callDefTool('def.operator.config.prepare', input, context)
  let approval
  try {
    approval = await dependencies.askWithApproval(context, {
      action: 'Apply operator configuration',
      summary: `Apply reviewed operator weapon/equipment configuration for ${input.characterName || input.characterId || 'selected operator'}`,
      permission: 'def_operator_config_patch',
      nodeId: prepared.nodeId,
      revision: prepared.nodeRevision,
      timelineId: prepared.timelineId,
      axisBindingId: prepared.axisBindingId,
      parentNodeId: prepared.parentNodeId,
      parentRevision: prepared.parentRevision,
      candidateNodeId: prepared.nodeId,
      candidateRevision: prepared.nodeRevision,
      workingHash: prepared.workingHash,
      patterns: dependencies.formatApprovalPatterns(prepared),
      diff: { type: 'operator-config', requested: input, finalConfig: prepared.finalConfig, checkout: prepared.checkout },
      riskFlags: [{ severity: 'warning', code: 'operator-config-mutation', message: 'Changes the visible operator weapon and/or equipment configuration.' }],
      consequence: 'The approved child Work Node is committed and applied only if its checkout and revision still match this exact preview.',
    })
  } catch (error) {
    await dependencies.callDefTool('def.operator.config.discard_prepared', prepared, context)
    throw error
  }
  return dependencies.callDefTool('def.operator.config.apply_prepared', {
    ...prepared,
    input,
    approvalCapability: approval.approvalCapability,
  }, context)
}
