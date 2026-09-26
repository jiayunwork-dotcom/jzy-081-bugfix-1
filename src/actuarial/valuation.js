// 核算编排层：把生存递推、寿险、年金、两全各模块按一次请求串起来。
//
// 并发隔离：每次调用都在自己的栈帧内新建 kp / deathInYear 等中间累积量，
// 全程不碰任何模块级可变状态，多个核算请求并发时各算各的、互不串写。

import { discountFactor, discountRate } from './discount.js';
import { survivalProbabilities } from './survival.js';
import { wholeLifeInsuranceAPV } from './wholeLife.js';
import { annuityDueAPV } from './annuity.js';
import {
  pureEndowmentAPV,
  termInsuranceAPV,
} from './endowment.js';

const EPS = 1e-12;

/**
 * 终身寿险 + 期初生存年金（单位保额），并回算恒等式闭合差供校算。
 * 输入必须已经过参数校验层校验。
 *
 * @param {{ qx: number[], interestRate: number }} input
 * @returns {{
 *   wholeLifeInsurance: number,
 *   annuityDue: number,
 *   identityResidual: number,
 *   discountFactor: number,
 *   discountRate: number
 * }}
 */
export function valueLifeTable({ qx, interestRate }) {
  const survival = survivalProbabilities(qx);
  const wholeLifeInsurance = wholeLifeInsuranceAPV(survival, interestRate);
  const annuityDue = annuityDueAPV(survival, interestRate);
  const d = discountRate(interestRate);

  return {
    wholeLifeInsurance,
    annuityDue,
    // 恒等式基准：1 = A_x + d * ä_x（d = i/(1+i)）
    identityResidual: 1 - (wholeLifeInsurance + d * annuityDue),
    identityClosed:
      Math.abs(1 - (wholeLifeInsurance + d * annuityDue)) < EPS,
    discountFactor: discountFactor(interestRate),
    discountRate: d,
  };
}

/**
 * 两全保险净保费及定期死亡、纯生存两个分项。
 * 同时随附终身寿险/年金现值，方便调用方一次拿全口径。
 *
 * @param {{ qx: number[], interestRate: number, years: number, sumInsured: number }} input
 * @returns {object}
 */
export function valueEndowment({ qx, interestRate, years, sumInsured }) {
  const survival = survivalProbabilities(qx);

  const wholeLifeInsurance = wholeLifeInsuranceAPV(survival, interestRate);
  const annuityDue = annuityDueAPV(survival, interestRate);
  const d = discountRate(interestRate);

  const termInsurancePerUnit = termInsuranceAPV(survival, interestRate, years);
  const pureEndowmentPerUnit = pureEndowmentAPV(survival, interestRate, years);
  const endowmentPerUnit = termInsurancePerUnit + pureEndowmentPerUnit;

  const money = (perUnit) => perUnit * sumInsured;

  return {
    years,
    sumInsured,
    // 单位保额口径
    perUnit: {
      termInsurance: termInsurancePerUnit,
      pureEndowment: pureEndowmentPerUnit,
      endowment: endowmentPerUnit,
    },
    // 乘以保额后的金额口径（保额放大几倍，各项同比例放大）
    money: {
      termInsurance: money(termInsurancePerUnit),
      pureEndowment: money(pureEndowmentPerUnit),
      netPremium: money(endowmentPerUnit),
    },
    // 随附终身口径，便于对账
    wholeLifeInsurance,
    annuityDue,
    identityResidual: 1 - (wholeLifeInsurance + d * annuityDue),
    identityClosed:
      Math.abs(1 - (wholeLifeInsurance + d * annuityDue)) < EPS,
    discountFactor: discountFactor(interestRate),
    discountRate: d,
  };
}
