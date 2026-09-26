// 期初生存年金精算现值模块（annuity-due）
//
// ä_x = Σ_{k>=0}  v^k * _k p_x
//
// 每一项对应「第 k 年初仍生存」并在年初领取 1，按年初（v^k）贴现。
// 生命表到终龄为止：第 0 笔（当前立即领取，贴现 1）到最后一个可能的年初。

import { discountFactor } from './discount.js';

/**
 * @param {{ kp: number[] }} survival
 *        survival 模块的逐年递推结果，kp[k] = _k p_x
 * @param {number} i 年利率
 * @returns {number} 单位给付期初生存年金精算现值 ä_x
 */
export function annuityDueAPV(survival, i) {
  const v = discountFactor(i);
  let vk = 1; // v^0
  let apv = 0;
  const { kp } = survival;

  for (let k = 0; k < kp.length; k++) {
    apv += vk * kp[k];
    vk *= v;
  }

  return apv;
}
