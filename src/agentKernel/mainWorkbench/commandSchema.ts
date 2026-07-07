import type { MainWorkbenchCommand } from '../../utils/mainWorkbenchControl';
import {
  MAIN_WORKBENCH_SUPPORTED_OPS as MAIN_WORKBENCH_SUPPORTED_OPS_RUNTIME,
  isMainWorkbenchCommandOp as isMainWorkbenchCommandOpRuntime,
  normalizeMainWorkbenchCommand as normalizeMainWorkbenchCommandRuntime,
  validateMainWorkbenchCommand as validateMainWorkbenchCommandRuntime,
  validateMainWorkbenchCommands as validateMainWorkbenchCommandsRuntime,
} from './commandSchemaRuntime.mjs';

export const MAIN_WORKBENCH_SUPPORTED_OPS = MAIN_WORKBENCH_SUPPORTED_OPS_RUNTIME as readonly MainWorkbenchCommand['op'][];

export type MainWorkbenchCommandValidation =
  | { ok: true; command: MainWorkbenchCommand }
  | { ok: false; code: string; message: string };

export function isMainWorkbenchCommandOp(op: unknown): op is MainWorkbenchCommand['op'] {
  return isMainWorkbenchCommandOpRuntime(op);
}

export function normalizeMainWorkbenchCommand(command: unknown) {
  return normalizeMainWorkbenchCommandRuntime(command) as unknown;
}

export function validateMainWorkbenchCommand(command: unknown): MainWorkbenchCommandValidation {
  return validateMainWorkbenchCommandRuntime(command) as MainWorkbenchCommandValidation;
}

export function validateMainWorkbenchCommands(commands: unknown[]): MainWorkbenchCommandValidation {
  return validateMainWorkbenchCommandsRuntime(commands) as MainWorkbenchCommandValidation;
}
