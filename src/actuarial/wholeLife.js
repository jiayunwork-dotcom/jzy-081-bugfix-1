// 终身寿险趸缴精算现值模块（年末赔付，discrete whole life）
//
// A_x = Σ_{k>=0}  v^(k+1) * (_k p_x * q_{x+k})
//
// 每一项对应「活过前 k 年、年初仍生存、再于第 k 年内死亡」并在年末给付 1。
// 加总覆盖整张表，终龄那一项 v^m * _{m-1} p_x（q=1）一并计入。

import { discountFactor } from './discount.js';

/**
 * @param {{ kp: number[], deathInYear: number[] }} survival
 *        survival 模块的逐年递推结果
 * @param {number} i 年利率
 * @returns {number} 单位保额终身寿险精算现值 A_x
 */
export function wholeLifeInsuranceAPV(survival, i) {
  const v = discountFactor(i);
  let vk = 1; // v^0；乘当年死亡概率后再补一个 v 得到 v^(k+1)
  let apv = 0;
  const { deathInYear } = survival;

  for (let k = 0; k < deathInYear.length; k++) {
    vk *= v; // 第 k 年首次进入时 vk = v^(k+1)
    apv += vk * deathInYear[k];
  }

  return apv;
}
