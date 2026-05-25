export function q(sheetName: string, cell: string): string {
  return `'${sheetName}'!${cell}`;
}

export function buildNonCritFormula(parameterRow: number): string {
  return [
    q('参数快照', `J${parameterRow}`),
    q('参数快照', `K${parameterRow}`),
    q('参数快照', `L${parameterRow}`),
    q('参数快照', `M${parameterRow}`),
    q('参数快照', `N${parameterRow}`),
    q('参数快照', `O${parameterRow}`),
    q('参数快照', `P${parameterRow}`),
    q('参数快照', `Q${parameterRow}`),
    q('参数快照', `R${parameterRow}`),
  ].join('*');
}

export function buildCritFormula(nonCritCell: string, parameterRow: number): string {
  return `${nonCritCell}*(1+${q('参数快照', `I${parameterRow}`)})`;
}

export function buildExpectedFormula(nonCritCell: string, critCell: string, parameterRow: number): string {
  return `${nonCritCell}*(1-${q('参数快照', `H${parameterRow}`)})+${critCell}*${q('参数快照', `H${parameterRow}`)}`;
}

export function buildOverviewExpectedFormula(row: number, expectedColumn: string): string {
  return `SUMIFS('伤害过程'!$${expectedColumn}:$${expectedColumn},'伤害过程'!$A:$A,A${row},'伤害过程'!$B:$B,B${row})`;
}
