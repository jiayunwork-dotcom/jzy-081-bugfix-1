// 贴现率换算模块
// 口径钉死（离散精算惯例，不引入连续死亡力）：
//   贴现因子 v = 1 / (1 + i)
//   贴现率   d = i / (1 + i) = 1 - v
// 注意：恒等式里用的是 d，不是利率 i 本身。

/**
 * 年度贴现因子 v = 1 / (1 + i)
 * @param {number} i 年利率（要求 i > -1，由参数校验层保证）
 * @returns {number}
 */
export function discountFactor(i) {
  return 1 / (1 + i);
}

/**
 * 贴现率 d = i / (1 + i)
 * @param {number} i 年利率
 * @returns {number}
 */
export function discountRate(i) {
  return i / (1 + i);
}

/**
 * 逐年生成贴现幂次 v^k，k = 0, 1, 2, ...
 * 用递推（vPow *= v）保证各年幂次与生存概率递推步调一致，
 * 避免直接调用 Math.pow 在口径复算时产生差异。
 * @param {number} i 年利率
 * @returns {() => number} 每调用一次返回下一个 k 的 v^k
 */
export function vPowerSeries(i) {
  const v = discountFactor(i);
  let power = 1; // v^0
  return () => {
    const current = power;
    power *= v;
    return current;
  };
}
