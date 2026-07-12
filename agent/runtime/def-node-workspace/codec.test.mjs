import assert from 'node:assert/strict'
import test from 'node:test'
import { decodeDefNodePayload, rebuildDefNodePayload, validateDefNodeSource } from './codec.mjs'

function payload() {
  const button = {
    id: 'button-1',
    characterId: 'operator-1',
    characterName: '干员一',
    skillType: 'E',
    staffIndex: 0,
    nodeIndex: 0,
    nodeNumber: 1,
    position: { x: 10, y: 20 },
    selectedBuff: ['buff-1'],
  }
  const timelineButton = { ...button, buffIds: ['buff-1'] }
  delete timelineButton.selectedBuff
  return {
    selectedCharacters: ['operator-1'],
    timelineData: {
      version: '1.0',
      createdAt: 1,
      updatedAt: 2,
      staffLines: [{
        staffIndex: 0,
        characterName: '干员一',
        occupiedNodes: [0],
        buttons: [timelineButton],
      }],
    },
    skillButtonTable: { 'button-1': button },
    allBuffList: [{ id: 'buff-1', displayName: '增益一' }],
    anomalyStateSnapshots: [],
    characterInputMap: {},
    characterComputedMap: { preserved: true },
    characterDisplayCacheMap: {},
    operatorConfigPageCache: {},
  }
}

test('round-trips the current payload without losing fields', () => {
  const before = payload()
  const source = decodeDefNodePayload(before)
  const rebuilt = rebuildDefNodePayload(before, source)
  assert.equal(rebuilt.ok, true)
  assert.deepEqual(rebuilt.payload, before)
})

test('one canonical slot edit regenerates timeline mirrors', () => {
  const before = payload()
  const source = decodeDefNodePayload(before)
  source.timeline.staffLines[0].buttons[0].nodeIndex = 2
  source.timeline.staffLines[0].buttons[0].nodeNumber = 3
  const rebuilt = rebuildDefNodePayload(before, source)
  assert.equal(rebuilt.ok, true)
  assert.equal(rebuilt.payload.skillButtonTable['button-1'].nodeIndex, 2)
  assert.equal(rebuilt.payload.timelineData.staffLines[0].buttons[0].nodeIndex, 2)
  assert.deepEqual(rebuilt.payload.timelineData.staffLines[0].occupiedNodes, [2])
  assert.equal(rebuilt.payload.characterComputedMap.preserved, true)
})

test('rejects duplicate slots and missing Buff references', () => {
  const source = decodeDefNodePayload(payload())
  source.timeline.staffLines[0].buttons.push({ ...source.timeline.staffLines[0].buttons[0], id: 'button-2' })
  source.timeline.staffLines[0].buttons[0].selectedBuff = ['missing']
  const codes = validateDefNodeSource(source).map((issue) => issue.code)
  assert.ok(codes.includes('button-slot-conflict'))
  assert.ok(codes.includes('button-buff-missing'))
})
