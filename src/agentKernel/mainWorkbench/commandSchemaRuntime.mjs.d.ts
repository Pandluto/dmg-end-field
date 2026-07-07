import type { MainWorkbenchCommand } from '../../utils/mainWorkbenchControl';

export const MAIN_WORKBENCH_SUPPORTED_OPS: readonly MainWorkbenchCommand['op'][];

export type MainWorkbenchCommandValidation =
  | { ok: true; command: MainWorkbenchCommand }
  | { ok: false; code: string; message: string };

export function isMainWorkbenchCommandOp(op: unknown): op is MainWorkbenchCommand['op'];

export function normalizeMainWorkbenchCommand(command: unknown): unknown;

export function validateMainWorkbenchCommand(command: unknown): MainWorkbenchCommandValidation;

export function validateMainWorkbenchCommands(commands: unknown[]): MainWorkbenchCommandValidation;
