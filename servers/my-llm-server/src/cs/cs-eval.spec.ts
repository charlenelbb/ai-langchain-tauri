import * as fs from 'fs';
import * as path from 'path';
import { classifyIntentByRules } from './cs-policy';

type EvalCase = {
  id: string;
  query: string;
  expectIntent: string;
  expectGrounded?: boolean;
  mustContain?: string;
};

describe('cs-eval intent set', () => {
  it('评测集意图与规则分类一致', () => {
    const file = path.join(__dirname, '../../fixtures/cs-eval.json');
    const cases = JSON.parse(fs.readFileSync(file, 'utf8')) as EvalCase[];
    expect(cases.length).toBeGreaterThanOrEqual(20);
    const misses: string[] = [];
    for (const c of cases) {
      const got = classifyIntentByRules(c.query);
      if (got !== c.expectIntent) {
        misses.push(`${c.id}: ${c.query} expect=${c.expectIntent} got=${got}`);
      }
    }
    expect(misses).toEqual([]);
  });
});
