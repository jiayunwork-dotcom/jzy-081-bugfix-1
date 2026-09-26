// 核心精算计算测试：恒等式、零死亡率退化、利率敏感性、保额比例、n=0 等基准行为。
import test from 'node:test';
import assert from 'node:assert/strict';

import { discountFactor, discountRate } from '../src/actuarial/discount.js';
import { survivalProbabilities } from '../src/actuarial/survival.js';
import { wholeLifeInsuranceAPV } from '../src/actuarial/wholeLife.js';
import { annuityDueAPV } from '../src/actuarial/annuity.js';
import {
  termInsuranceAPV,
  pureEndowmentAPV,
  endowmentInsuranceAPV,
} from '../src/actuarial/endowment.js';
import { valueLifeTable, valueEndowment } from '../src/actuarial/valuation.js';

const EPS = 1e-10;

// 标准示范表（40 岁起，i=25%，v=0.8，d=0.2）
const STD = { qx: [0.1, 0.2, 0.25, 0.5, 1], i: 0.25 };
// 零死亡率段表：前三年 q=0
const ZERO = { qx: [0, 0, 0, 0.5, 1], i: 0.25 };

test('贴现因子与贴现率换算：v=1/(1+i)，d=i/(1+i)（不能误用 i）', () => {
  assert.ok(Math.abs(discountFactor(0.25) - 0.8) < EPS);
  assert.ok(Math.abs(discountRate(0.25) - 0.2) < EPS);
  assert.ok(Math.abs(discountRate(0.05) - 0.05 / 1.05) < EPS);
  // d 绝不能退化成利率本身
  assert.ok(Math.abs(discountRate(0.25) - 0.25) > EPS);
});

test('生存概率逐年递推：连乘 p、当年死亡概率 = _k p · q', () => {
  const { kp, deathInYear } = survivalProbabilities(STD.qx);
  const expectedKp = [1, 0.9, 0.72, 0.54, 0.27];
  kp.forEach((v, k) => assert.ok(Math.abs(v - expectedKp[k]) < EPS));
  // 终龄后不剩生存概率
  assert.ok(Math.abs(kp[4] * (1 - STD.qx[4])) < EPS);
  // 死亡概率抽查：k=1 为 0.9*0.2 = 0.18
  assert.ok(Math.abs(deathInYear[1] - 0.18) < EPS);
});

test('终身寿险与年金手算值一致（v=0.8）', () => {
  const s = survivalProbabilities(STD.qx);
  const A = wholeLifeInsuranceAPV(s, STD.i);
  const ann = annuityDueAPV(s, STD.i);
  assert.ok(Math.abs(A - 0.4864256) < EPS, `A=${A}`);
  assert.ok(Math.abs(ann - 2.567872) < EPS, `ann=${ann}`);
});

test('恒等式 1 = A_x + d·ä_x 在标准表整数年龄上严格闭合', () => {
  const r = valueLifeTable({ qx: STD.qx, interestRate: STD.i });
  assert.ok(Math.abs(r.identityResidual) < EPS, `residual=${r.identityResidual}`);
  assert.equal(r.identityClosed, true);
});

test('零死亡率段：定期死亡给付为 0、纯生存退化为纯贴现', () => {
  const s = survivalProbabilities(ZERO.qx);
  const term3 = termInsuranceAPV(s, ZERO.i, 3);
  const pure3 = pureEndowmentAPV(s, ZERO.i, 3);
  assert.equal(term3, 0);
  // _3 p = 1，故 _3 E = v^3 = 0.512
  assert.ok(Math.abs(pure3 - 0.512) < EPS);
  // 两全 = 0 + 纯贴现
  const e = endowmentInsuranceAPV(s, ZERO.i, 3);
  assert.ok(Math.abs(e.endowment - 0.512) < EPS);
  assert.ok(Math.abs(e.termInsurance) < EPS);
});

test('保障年限 n=0：定期死亡给付为 0（纯生存为 1）', () => {
  const s = survivalProbabilities(STD.qx);
  assert.equal(termInsuranceAPV(s, STD.i, 0), 0);
  assert.ok(Math.abs(pureEndowmentAPV(s, STD.i, 0) - 1) < EPS);
  const e = endowmentInsuranceAPV(s, STD.i, 0);
  assert.ok(Math.abs(e.endowment - 1) < EPS);
});

test('利率抬高：寿险现值与年金现值同时下降', () => {
  const s = survivalProbabilities(STD.qx);
  const levels = [0.0, 0.05, 0.25, 0.6];
  const As = levels.map((i) => wholeLifeInsuranceAPV(s, i));
  const anns = levels.map((i) => annuityDueAPV(s, i));
  for (let k = 1; k < levels.length; k++) {
    assert.ok(As[k] < As[k - 1], `A 未随利率下降: ${As.join(',')}`);
    assert.ok(anns[k] < anns[k - 1], `年金未随利率下降: ${anns.join(',')}`);
  }
});

test('保额放大几倍：两全净保费及两个分项同比例放大', () => {
  const base = valueEndowment({
    qx: STD.qx,
    interestRate: STD.i,
    years: 3,
    sumInsured: 1,
  });
  const factor = 7;
  const scaled = valueEndowment({
    qx: STD.qx,
    interestRate: STD.i,
    years: 3,
    sumInsured: factor,
  });
  for (const key of ['termInsurance', 'pureEndowment', 'netPremium']) {
    const expected = base.money[key] * factor;
    assert.ok(
      Math.abs(scaled.money[key] - expected) < EPS * Math.max(1, expected),
      `${key}: ${scaled.money[key]} != ${expected}`,
    );
  }
  // 单位保额口径不受保额影响
  assert.equal(scaled.perUnit.endowment, base.perUnit.endowment);
});

test('定期 + 纯生存在满年限（n=表长）时与终身口径闭合', () => {
  const s = survivalProbabilities(STD.qx);
  const n = STD.qx.length;
  const e = endowmentInsuranceAPV(s, STD.i, n);
  const A = wholeLifeInsuranceAPV(s, STD.i);
  // n 取满表长：定期死亡累计全部死亡年，_n p = 0
  assert.ok(Math.abs(e.termInsurance - A) < EPS);
  assert.ok(Math.abs(e.pureEndowment) < EPS);
});

test('两全分项手算值（标准表 n=3）', () => {
  const s = survivalProbabilities(STD.qx);
  const e = endowmentInsuranceAPV(s, STD.i, 3);
  assert.ok(Math.abs(e.termInsurance - 0.28736) < EPS, `term=${e.termInsurance}`);
  assert.ok(Math.abs(e.pureEndowment - 0.27648) < EPS, `pure=${e.pureEndowment}`);
  assert.ok(Math.abs(e.endowment - 0.56384) < EPS);
});

test('所有死亡率序列求和不超过 1（概率质量合理）', () => {
  const { deathInYear } = survivalProbabilities(STD.qx);
  const total = deathInYear.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - 1) < EPS);
});
