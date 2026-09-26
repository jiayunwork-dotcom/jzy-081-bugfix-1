// 示范生命表：数据刻意取简单小数，方便手工复算、对账口径。
//
// 两份都从 40 岁起截一段，年利率均取 25%（v = 0.8、d = 0.2，幂次手算无压力）。

export const SAMPLE_TABLES = [
  {
    id: 'standard-40',
    description:
      '标准示范表（40 岁起 5 岁）：逐年死亡率均非零，用于验证恒等式 1 = A_x + d·ä_x',
    startAge: 40,
    interestRate: 0.25,
    mortalityRates: [0.1, 0.2, 0.25, 0.5, 1],
    suggestedYears: 3,
    suggestedSumInsured: 100000,
    // 手算参考值（v=0.8, d=0.2），随附便于校算：
    handCheck: {
      survival: [1, 0.9, 0.72, 0.54, 0.27],
      wholeLifeInsurance: 0.4864256,
      annuityDue: 2.567872,
      identityA_plus_d_annuity: 1,
      term3: 0.28736,
      pureEndowment3: 0.27648,
      endowment3: 0.56384,
    },
  },
  {
    id: 'zero-segment-40',
    description:
      '零死亡率段示范表（40 岁起）：前三年死亡率全为 0，用于验证定期死亡给付为 0、纯生存退化为纯贴现',
    startAge: 40,
    interestRate: 0.25,
    mortalityRates: [0, 0, 0, 0.5, 1],
    suggestedYears: 3,
    suggestedSumInsured: 100000,
    // 手算参考值：
    handCheck: {
      survival: [1, 1, 1, 1, 0.5],
      term3: 0, // 零死亡率段内没有死亡给付
      pureEndowment3: 0.512, // 退化为纯贴现 v^3 = 0.8^3
      endowment3: 0.512,
    },
  },
];

export function getSampleTable(id) {
  return SAMPLE_TABLES.find((t) => t.id === id) || null;
}
