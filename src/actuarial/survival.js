// 生存概率逐年递推模块
// 输入：从起始年龄 x 起逐岁的死亡率序列 qx = [q_x, q_{x+1}, ..., q_omega]
//   - 每一岁一个死亡率，0 <= q <= 1
//   - 终龄那一岁 q_omega 固定为 1（由参数校验层保证）
//
// 逐年递推（完全离散口径，不使用连续死亡力近似）：
//   p_x = 1 - q_x                  ：从年龄 x 活过一岁到 x+1 的概率
//   _0 p_x = 1
//   _k p_x = p_x * p_{x+1} * ... * p_{x+k-1}  ：活过前 k 年、到第 k 年初仍生存的概率
//
// 「在第 k 年里死亡」的概率 = _k p_x * q_{x+k}  （活到第 k 年初，再于当年死亡）

/**
 * 逐年递推生存概率与各年死亡概率。
 *
 * @param {number[]} qx 从起始年龄起逐岁死亡率，最后一项（终龄）必须为 1
 * @returns {{
 *   kp: number[],        // kp[k] = _k p_x，活过前 k 年的概率，长度 = qx.length
 *   deathInYear: number[] // deathInYear[k] = _k p_x * q_{x+k}，长度 = qx.length
 * }}
 */
export function survivalProbabilities(qx) {
  const years = qx.length;

  // 递推工作数组每次调用新建：结果只属于本次请求，
  // 不携带、也不泄漏任何历史请求的中间量（并发隔离契约见 valuation.js）
  const kp = new Array(years);
  const deathInYear = new Array(years);

  let survived = 1; // _0 p_x = 1
  for (let k = 0; k < years; k++) {
    kp[k] = survived;
    deathInYear[k] = survived * qx[k];
    survived *= 1 - qx[k]; // 连乘生存概率，得到 _{k+1} p_x
  }

  return { kp, deathInYear };
}
