import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..', '..', '..');
const declaration = join(root, 'docs', 'fork', 'rule-pack-api.d.ts');

/** Type-checks `source` (placed beside the declaration) with the repository's compiler options; the messages of its errors. */
function errorsOf(source: string): string[] {
  const config = ts.readConfigFile(join(root, 'tsconfig.json'), ts.sys.readFile);
  const { options } = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const probe = join(root, 'docs', 'fork', '__probe.ts');
  const host = ts.createCompilerHost(options);
  const read = host.getSourceFile.bind(host);
  host.getSourceFile = (name, ...rest): ts.SourceFile | undefined =>
    name === probe ? ts.createSourceFile(name, source, options.target ?? ts.ScriptTarget.ES2022) : read(name, ...rest);
  const program = ts.createProgram([probe], options, host);
  const file = program.getSourceFile(probe);
  return program.getSemanticDiagnostics(file).map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n'));
}

describe('docs/fork/rule-pack-api.d.ts', () => {
  it('is self-contained: no imports', () => {
    expect(readFileSync(declaration, 'utf8')).not.toMatch(/^\s*import\s|from\s+['"]/m);
  });

  it('describes the real interface: each is assignable to the other', () => {
    const errors = errorsOf(`
      import type { RulePackApi as Declared, CheckRule as DeclaredRule, CheckResult as DeclaredResult } from './rule-pack-api';
      import type { RulePackApi as Real } from '../../src/app/rulePacks/rulePackApi';
      import type { CheckRule as RealRule, CheckResult as RealResult } from '../../src/app/dice/checkTypes';
      declare const real: Real; declare const declared: Declared;
      export const a: Declared = real;
      export const b: Real = declared;
      declare const realRule: RealRule; declare const declaredRule: DeclaredRule;
      export const c: DeclaredRule = realRule;
      export const d: RealRule = declaredRule;
      declare const realResult: RealResult; declare const declaredResult: DeclaredResult;
      export const e: DeclaredResult = realResult;
      export const f: RealResult = declaredResult;
      import type { ContestRule as DeclaredContest, ContestVerdict as DeclaredVerdict, RollContest as DeclaredRollContest } from './rule-pack-api';
      import type { ContestRule as RealContest, ContestVerdict as RealVerdict, RollContest as RealRollContest } from '../../src/app/dice/contestTypes';
      declare const realContest: RealContest; declare const declaredContest: DeclaredContest;
      export const g: DeclaredContest = realContest;
      export const h: RealContest = declaredContest;
      declare const realVerdict: RealVerdict; declare const declaredVerdict: DeclaredVerdict;
      export const i: DeclaredVerdict = realVerdict;
      export const j: RealVerdict = declaredVerdict;
      declare const realRc: RealRollContest; declare const declaredRc: DeclaredRollContest;
      export const k: DeclaredRollContest = realRc;
      export const l: RealRollContest = declaredRc;
    `);
    expect(errors).toEqual([]);
  });

  it('declares the ready event name, which is the real one', () => {
    const text = readFileSync(declaration, 'utf8');
    expect(text).toContain("'atlas-vtt:rule-packs-ready'");
    expect(text).toMatch(/RULE_PACKS_READY_EVENT/);
  });

  it('would notice a drift (the check is live)', () => {
    const errors = errorsOf(`
      import type { RulePackApi as Declared } from './rule-pack-api';
      declare const wrong: { apiVersion: 2 };
      export const a: Declared = wrong;
    `);
    expect(errors.length).toBeGreaterThan(0);
  });
});
