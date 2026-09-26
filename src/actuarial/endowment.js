// 定期死亡保险 / 纯生存保险 / 两全保险模块
//
// 给定保障年限 n（整数年）：
//   定期死亡（n-year term, 年末赔付）
//     A¹_{x:n} = Σ_{k=0}^{n-1}  v^(k+1) * (_k p_x * q_{x+k})
//   纯生存（pure endowment, 期满给付）
//     _n E_x = _n p_x * v^n
//   两全保险净保费（趸缴）
//     A_{x:n} = A¹_{x:n} + _n E_x
//
// 退化情形（测试钉死）：
//   n = 0          -> 定期死亡 = 0、纯生存 = 1（立刻期满）
//   一段死亡率全 0 -> 该段定期死亡累计为 0；纯生存退化为纯贴现 v^n（_n p_x = 1）

import { discountFactor } from './discount.js';

/**
 * 单位保额下的定期死亡保险精算现值（只累计前 n 年的死亡给付）。
 * @param {{ deathInYear: number[] }} survival
 * @param {number} i 年利率
 * @param {number} n 保障年限（整数，0 <= n <= 表长，由校验层保证）
 * @returns {number}
 */
export function termInsuranceAPV(survival, i, n) {
  const v = discountFactor(i);
  let vk = 1;
  let apv = 0;
  const { deathInYear } = survival;

  for (let k = 0; k < n; k++) {
    vk *= v; // v^(k+1)
    apv += vk * deathInYear[k];
  }

  return apv;
}

/**
 * 单位保额下的纯生存保险精算现值：活到满期的概率 × 期末贴现。
 * @param {{ kp: number[] }} survival
 * @param {number} i 年利率
 * @param {number} n 保障年限（0 <= n <= 表长）
 * @returns {number}
 */
export function pureEndowmentAPV(survival, i, n) {
  const v = discountFactor(i);
  // _n p_x：活到第 n 年初（= 活过 n 年），正好就是满期仍生存的概率
  const npx = survival.kp[n] ?? 0;
  return npx * v ** n;
}

/**
 * 两全保险：定期死亡 + 纯生存，两个分项一并返回。
 * @param {{ kp: number[], deathInYear: number[] }} survival
 * @param {number} i 年利率
 * @param {number} n 保障年限
 * @returns {{ termInsurance: number, pureEndowment: number, endowment: number }}
 *          均为单位保额下的精算现值；endowment = 两者之和
 */
export function endowmentInsuranceAPV(survival, i, n) {
  const termInsurance = termInsuranceAPV(survival, i, n);
  const pureEndowment = pureEndowmentAPV(survival, i, n);
  return {
    termInsurance,
    pureEndowment,
    endowment: termInsurance + pureEndowment,
  };
}
