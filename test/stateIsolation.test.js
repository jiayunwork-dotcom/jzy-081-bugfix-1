// 请求间状态隔离回归测试：
// 每次核算的结果只由本次请求自带的生命表 / 利率 / 年限 / 保额决定，
// 与服务之前算过什么、同时在算什么无关。
//
// 钉住的缺陷：survival 模块曾把 kp / deathInYear 放在模块级数组里
// 「按需增长后复用」，先算长表再算短表时，短表只覆写数组头部，
// 残留的长表尾巴被下游按 length 遍历吸进结果
// （寿险现值 > 1、恒等式不闭合、保到终龄纯生存非 0）。
import test from 'node:test';
import assert from 'node:assert/strict';

import { survivalProbabilities } from '../src/actuarial/survival.js';
import { valueLifeTable, valueEndowment } from '../src/actuarial/valuation.js';
import { buildApp } from '../src/app.js';

const EPS = 1e-12;

// 对账时复现问题的两张表（i = 0.05）
const SHORT = { startAge: 60, mortalityRates: [0.1, 0.2, 1], interestRate: 0.05 };
const LONG = {
  startAge: 40,
  mortalityRates: [0.01, 0.02, 0.03, 0.05, 0.1, 0.2, 1],
  interestRate: 0.05,
};
const MEDIUM = {
  startAge: 50,
  mortalityRates: [0.05, 0.1, 0.3, 1],
  interestRate: 0.03,
};
const SAMPLE = {
  startAge: 40,
  mortalityRates: [0.1, 0.2, 0.25, 0.5, 1],
  interestRate: 0.25,
};

// 短表首次核算的手算基准（服务全新启动时的正确结果）
const SHORT_WHOLE_LIFE = 0.880466472303207;
const SHORT_ANNUITY = 2.5102040816326534;

/** 在全新启动的服务上单独算一次，拿到「不受任何历史影响」的基准响应 */
async function freshAppResult(url, payload) {
  const app = buildApp();
  try {
    const res = await app.inject({ method: 'POST', url, payload });
    assert.equal(res.statusCode, 200, `基准请求失败: ${res.body}`);
    return res.json();
  } finally {
    await app.close();
  }
}

test('survivalProbabilities：长表之后再算短表，返回数组不残留上一张表的尾巴', () => {
  survivalProbabilities(LONG.mortalityRates); // 先把历史状态撑长
  const { kp, deathInYear } = survivalProbabilities(SHORT.mortalityRates);

  // 数组长度必须等于本次表长，不得带着长表的残留项
  assert.equal(kp.length, SHORT.mortalityRates.length);
  assert.equal(deathInYear.length, SHORT.mortalityRates.length);

  // 内容逐项等于全新递推：kp = [1, 0.9, 0.72]
  const expectedKp = [1, 0.9, 0.72];
  kp.forEach((v, k) => assert.ok(Math.abs(v - expectedKp[k]) < EPS));
  assert.ok(Math.abs(deathInYear[2] - 0.72) < EPS); // 0.72 * q=1
});

test('编排层：短表 -> 长表 -> 短表，第二次短表与首次完全一致', () => {
  const short1 = valueLifeTable({
    qx: SHORT.mortalityRates,
    interestRate: SHORT.interestRate,
  });
  valueLifeTable({ qx: LONG.mortalityRates, interestRate: LONG.interestRate });
  const short2 = valueLifeTable({
    qx: SHORT.mortalityRates,
    interestRate: SHORT.interestRate,
  });

  assert.deepEqual(short2, short1);
  assert.ok(Math.abs(short2.wholeLifeInsurance - SHORT_WHOLE_LIFE) < EPS);
  assert.ok(Math.abs(short2.annuityDue - SHORT_ANNUITY) < EPS);
  assert.equal(short2.identityClosed, true);

  // 两全保到终龄（n = 表长）：纯生存必须为 0，不受之前长表影响
  valueLifeTable({ qx: LONG.mortalityRates, interestRate: LONG.interestRate });
  const endo = valueEndowment({
    qx: SHORT.mortalityRates,
    interestRate: SHORT.interestRate,
    years: SHORT.mortalityRates.length,
    sumInsured: 1000,
  });
  assert.equal(endo.money.pureEndowment, 0);
  assert.ok(Math.abs(endo.money.netPremium - SHORT_WHOLE_LIFE * 1000) < 1e-6);
});

test('HTTP：长短不一的表轮流提交，每份结果与全新服务单独计算逐项一致', async () => {
  const app = buildApp();
  try {
    // 刻意交错：短 -> 长 -> 短 -> 中 -> 长 -> 短 -> 示范表
    const sequence = [SHORT, LONG, SHORT, MEDIUM, LONG, SHORT, SAMPLE];
    for (const payload of sequence) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/life-table',
        payload,
      });
      assert.equal(res.statusCode, 200, `请求失败: ${res.body}`);
      const reference = await freshAppResult('/api/v1/life-table', payload);
      assert.deepEqual(
        res.json(),
        reference,
        `表长 ${payload.mortalityRates.length} 的结果受历史请求影响`,
      );
    }
  } finally {
    await app.close();
  }
});

test('HTTP：用户复现序列走接口，第二次短表回到首次结果且恒等式闭合', async () => {
  const app = buildApp();
  try {
    const post = (url, payload) =>
      app.inject({ method: 'POST', url, payload }).then((r) => {
        assert.equal(r.statusCode, 200, `请求失败: ${r.body}`);
        return r.json();
      });

    const first = await post('/api/v1/life-table', SHORT);
    await post('/api/v1/life-table', LONG);
    const second = await post('/api/v1/life-table', SHORT);

    assert.deepEqual(second, first);
    assert.ok(Math.abs(second.wholeLifeInsuranceAPV - SHORT_WHOLE_LIFE) < EPS);
    assert.ok(Math.abs(second.annuityDueAPV - SHORT_ANNUITY) < EPS);
    assert.equal(second.identity.closed, true);
    assert.ok(Math.abs(second.identity.residual) < EPS);

    // 两全保到终龄：纯生存回到 0、净保费回到 880.466472303207
    const endo = await post('/api/v1/endowment', {
      ...SHORT,
      years: 3,
      sumInsured: 1000,
    });
    assert.equal(endo.money.pureEndowment, 0);
    assert.ok(Math.abs(endo.money.endowmentNetPremium - 880.466472303207) < 1e-6);
    assert.equal(endo.identity.closed, true);
  } finally {
    await app.close();
  }
});

test('HTTP：不同长度的表混在一起并发提交，各结果与全新服务单独计算逐项一致', async () => {
  const app = buildApp();
  try {
    // 两个接口、不同表长 / 利率 / 年限 / 保额混在同一批里并发灌入
    const batch = [
      { url: '/api/v1/life-table', payload: SHORT },
      { url: '/api/v1/life-table', payload: LONG },
      { url: '/api/v1/life-table', payload: MEDIUM },
      { url: '/api/v1/life-table', payload: SAMPLE },
      { url: '/api/v1/endowment', payload: { ...SHORT, years: 3, sumInsured: 1000 } },
      { url: '/api/v1/endowment', payload: { ...LONG, years: 5, sumInsured: 250000 } },
      { url: '/api/v1/endowment', payload: { ...MEDIUM, years: 2, sumInsured: 5000 } },
      { url: '/api/v1/endowment', payload: { ...SAMPLE, years: 3, sumInsured: 100000 } },
      { url: '/api/v1/life-table', payload: SHORT }, // 批内重复短表，同样必须干净
    ];

    const responses = await Promise.all(
      batch.map(({ url, payload }) => app.inject({ method: 'POST', url, payload })),
    );

    for (let k = 0; k < batch.length; k++) {
      assert.equal(responses[k].statusCode, 200, `第 ${k} 个请求失败: ${responses[k].body}`);
      const reference = await freshAppResult(batch[k].url, batch[k].payload);
      assert.deepEqual(
        responses[k].json(),
        reference,
        `第 ${k} 个并发请求（${batch[k].url}，表长 ${batch[k].payload.mortalityRates.length}）的结果与其他请求串扰`,
      );
    }
  } finally {
    await app.close();
  }
});
