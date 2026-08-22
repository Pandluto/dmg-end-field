import { buildRdpsOverviewModel } from './rdpsOverviewModel';
import { buildFourCharacterSummaryFixture } from './rdpsTestFixtures';

function assertEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`);
  }
}

function assertClose(actual: number, expected: number, message: string): void {
  if (Math.abs(actual - expected) > 1e-9) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

const summary = buildFourCharacterSummaryFixture();
const model = buildRdpsOverviewModel(summary);

assertEqual(model.actualTotal, 1000, 'pie denominator uses actual total');
assertEqual(model.teamTotal, 870, 'team total sums the four displayed characters');
assertEqual(model.otherDamage, 130, 'other fills the actual-total remainder');
assertEqual(model.parts.length, 5, 'the four characters and other are all visible');
assertEqual(model.parts[4]?.name, '其他', 'the remainder has the requested label');
assertClose(model.parts[0]?.shareOfActual ?? 0, 0.48, 'character share matches chart 4');
assertClose(model.parts[4]?.shareOfActual ?? 0, 0.13, 'other share uses actual total');
assertClose(
  model.parts.reduce((sum, part) => sum + part.shareOfActual, 0),
  1,
  'pie shares reconcile to 100%',
);
assertEqual(model.canRenderPie, true, 'non-negative reconciled values render as a pie');

const negativeOther = buildFourCharacterSummaryFixture();
negativeOther.actualTotal = 800;
const signedModel = buildRdpsOverviewModel(negativeOther);
assertEqual(signedModel.otherDamage, -70, 'negative remainder remains signed');
assertEqual(signedModel.canRenderPie, false, 'negative remainder disables the pie encoding');

const rounded = buildFourCharacterSummaryFixture();
rounded.actualTotal = 870 + 1e-10;
const roundedModel = buildRdpsOverviewModel(rounded);
assertEqual(roundedModel.otherDamage, 0, 'floating-point dust does not create an other slice');
