// HTTP 接口测试：两个核算口子、结构化错误、示范表、并发请求互不串写。
import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';

import { buildApp } from '../src/app.js';

const EPS = 1e-9;

function withApp(run) {
  return async () => {
    const app = buildApp();
    try {
      await run(app);
    } finally {
      await app.close();
    }
  };
}

test('GET /health', withApp(async (app) => {
  const res = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { status: 'ok' });
}));

test('GET /api/v1/sample-table 返回示范表', withApp(async (app) => {
  const res = await app.inject({ method: 'GET', url: '/api/v1/sample-table' });
  assert.equal(res.statusCode, 200);
  assert.ok(res.json().tables.length >= 2);
}));

test('POST /api/v1/life-table：终身寿险 + 年金，恒等式闭合', withApp(async (app) => {
  const body = {
    startAge: 40,
    mortalityRates: [0.1, 0.2, 0.25, 0.5, 1],
    interestRate: 0.25,
  };
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/life-table',
    payload: body,
  });
  assert.equal(res.statusCode, 200);
  const j = res.json();
  assert.ok(Math.abs(j.wholeLifeInsuranceAPV - 0.4864256) < EPS);
  assert.ok(Math.abs(j.annuityDueAPV - 2.567872) < EPS);
  assert.ok(Math.abs(j.discountRate - 0.2) < EPS);
  assert.ok(Math.abs(j.identity.residual) < EPS);
  assert.equal(j.identity.closed, true);
}));

test('POST /api/v1/endowment：两全净保费及两个分项（单位与金额口径）', withApp(async (app) => {
  const body = {
    startAge: 40,
    mortalityRates: [0.1, 0.2, 0.25, 0.5, 1],
    interestRate: 0.25,
    years: 3,
    sumInsured: 100000,
  };
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/endowment',
    payload: body,
  });
  assert.equal(res.statusCode, 200);
  const j = res.json();
  assert.ok(Math.abs(j.perUnit.termInsuranceAPV - 0.28736) < EPS);
  assert.ok(Math.abs(j.perUnit.pureEndowmentAPV - 0.27648) < EPS);
  assert.ok(Math.abs(j.perUnit.endowmentNetPremium - 0.56384) < EPS);
  assert.ok(Math.abs(j.money.endowmentNetPremium - 56384) < 1e-6);
  // 净保费 = 两个分项之和
  assert.ok(
    Math.abs(
      j.money.endowmentNetPremium -
        (j.money.termInsurance + j.money.pureEndowment),
    ) < 1e-6,
  );
}));

test('零死亡率段表走接口：定期为 0、纯生为纯贴现', withApp(async (app) => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/endowment',
    payload: {
      startAge: 40,
      mortalityRates: [0, 0, 0, 0.5, 1],
      interestRate: 0.25,
      years: 3,
      sumInsured: 100000,
    },
  });
  assert.equal(res.statusCode, 200);
  const j = res.json();
  assert.equal(j.money.termInsurance, 0);
  assert.ok(Math.abs(j.perUnit.pureEndowmentAPV - 0.512) < EPS);
}));

test('非法入参返回 400 结构化错误且含清晰说明', withApp(async (app) => {
  const cases = [
    { startAge: -1, mortalityRates: [1], interestRate: 0.05 },
    { startAge: 40, mortalityRates: [0.1, 0.9], interestRate: 0.05 }, // 终龄 q≠1
    { startAge: 40, mortalityRates: [1], interestRate: -1 },
  ];
  for (const payload of cases) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/life-table',
      payload,
    });
    assert.equal(res.statusCode, 400);
    const j = res.json();
    assert.equal(j.error, 'VALIDATION_FAILED');
    assert.ok(Array.isArray(j.issues) && j.issues.length > 0);
    assert.ok(j.issues[0].detail.length > 0);
  }
}));

test('endowment 保额非正返回 400', withApp(async (app) => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/endowment',
    payload: {
      startAge: 40,
      mortalityRates: [0.1, 1],
      interestRate: 0.05,
      years: 1,
      sumInsured: 0,
    },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, 'VALIDATION_FAILED');
}));

test('非法 JSON 返回 400 结构化错误', withApp(async (app) => {
  const res = await app.inject({
    method: 'POST',
    url: '/api/v1/life-table',
    headers: { 'content-type': 'application/json' },
    payload: '{ not json',
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error, 'BAD_REQUEST');
}));

test('未知路径返回 404', withApp(async (app) => {
  const res = await app.inject({ method: 'GET', url: '/nope' });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error, 'NOT_FOUND');
}));

test('并发核算：不同生命表与利率的请求互不串写', withApp(async (app) => {
  const requests = [];
  // 同一时刻灌进多份不同表 / 不同利率 / 不同保额，结果必须各自独立
  for (let k = 0; k < 20; k++) {
    const q = [(k % 5) * 0.02 + 0.01, 0.3, 1];
    requests.push(
      app.inject({
        method: 'POST',
        url: '/api/v1/endowment',
        payload: {
          startAge: 40 + (k % 30),
          mortalityRates: q,
          interestRate: 0.01 * (k + 1),
          years: 1 + (k % 2),
          sumInsured: 1000 * (k + 1),
        },
      }),
    );
  }
  const responses = await Promise.all(requests);
  responses.forEach((res, k) => {
    assert.equal(res.statusCode, 200, `第 ${k} 个请求失败: ${res.body}`);
    const j = res.json();
    // 每份响应的回显参数必须与它自己的请求一致（无共享状态串写）
    assert.equal(j.sumInsured, 1000 * (k + 1));
    assert.equal(j.years, 1 + (k % 2));
    assert.ok(Math.abs(j.interestRate - 0.01 * (k + 1)) < 1e-12);
    // 金额口径 = 单位口径 × 该请求自己的保额
    assert.ok(
      Math.abs(
        j.money.endowmentNetPremium -
          j.perUnit.endowmentNetPremium * j.sumInsured,
      ) < 1e-6,
    );
  });
}));

test('长短表顺序复现：短表→长表→短表，第二次短表必须与首次逐项一致（回归）', withApp(async (app) => {
  const short = {
    startAge: 60,
    mortalityRates: [0.1, 0.2, 1],
    interestRate: 0.05,
  };
  const longer = {
    startAge: 40,
    mortalityRates: [0.01, 0.02, 0.03, 0.05, 0.1, 0.2, 1],
    interestRate: 0.05,
  };

  const post = (url, payload) =>
    app.inject({ method: 'POST', url, payload }).then((r) => r.json());

  const first = await post('/api/v1/life-table', short);
  assert.ok(Math.abs(first.wholeLifeInsuranceAPV - 0.880466472303207) < EPS);
  assert.ok(Math.abs(first.annuityDueAPV - 2.5102040816326534) < EPS);
  assert.equal(first.identity.closed, true);

  await post('/api/v1/life-table', longer);

  const again = await post('/api/v1/life-table', short);
  assert.deepEqual(again, first);

  // 两全保到终龄：纯生存必须为 0、净保费 = 880.466...
  await post('/api/v1/life-table', longer);
  const endowment = await post('/api/v1/endowment', {
    ...short,
    years: 3,
    sumInsured: 1000,
  });
  assert.equal(endowment.money.pureEndowment, 0);
  assert.ok(
    Math.abs(endowment.money.endowmentNetPremium - 880.466472303207) < EPS,
  );
}));

// 构造长度各异的一批合法表（终龄 q=1）
function mixedPayloads() {
  const payloads = [];
  for (let len = 3; len <= 9; len++) {
    const mortalityRates = Array.from({ length: len }, (_, k) =>
      k === len - 1 ? 1 : 0.01 * (k + 1),
    );
    // 同一 app 内并发：life-table 与 endowment 两个口子都覆盖
    payloads.push({
      url: '/api/v1/life-table',
      body: { startAge: 60, mortalityRates, interestRate: 0.05 },
    });
    payloads.push({
      url: '/api/v1/endowment',
      body: {
        startAge: 60,
        mortalityRates,
        interestRate: 0.05,
        years: len,
        sumInsured: 1000,
      },
    });
  }
  // 打乱顺序，让长短表在并发中交错
  for (let k = payloads.length - 1; k > 0; k--) {
    const j = (k * 7 + 3) % (k + 1);
    [payloads[k], payloads[j]] = [payloads[j], payloads[k]];
  }
  return payloads;
}

// 在一个全新的 Node 子进程里起服务、只处理这一个请求，得到「全新启动单独
// 核算」的干净基准（独立进程连模块缓存都不与主测试进程共享）。
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const FRESH_INJECT = join(
  dirname(fileURLToPath(import.meta.url)),
  'support',
  'fresh-inject.mjs',
);

function freshResponse(url, body) {
  const out = execFileSync(
    process.execPath,
    [FRESH_INJECT, url, JSON.stringify(body)],
    { encoding: 'utf8' },
  );
  const { statusCode, body: rawBody } = JSON.parse(out);
  assert.equal(statusCode, 200, rawBody);
  return JSON.parse(rawBody);
}

// 每种入参只起一次全新进程取基准，多轮复用时共享
const baselineCache = new Map();
function baselineResponse(url, body) {
  const key = `${url}|${JSON.stringify(body)}`;
  if (!baselineCache.has(key)) {
    baselineCache.set(key, freshResponse(url, body));
  }
  return baselineCache.get(key);
}

test('不同长度的表混在一起并发提交：每份结果与全新服务单独核算逐项对上（回归）', withApp(async (app) => {
  const payloads = mixedPayloads();

  // 同一 app 同时灌入所有请求（长表与短表交错）
  const responses = await Promise.all(
    payloads.map(({ url, body }) => app.inject({ method: 'POST', url, payload: body })),
  );

  // 每份响应都与「只处理过这一个请求的全新服务进程」结果逐项严格相等
  for (let k = 0; k < payloads.length; k++) {
    assert.equal(responses[k].statusCode, 200, responses[k].body);
    const expected = baselineResponse(payloads[k].url, payloads[k].body);
    assert.deepEqual(responses[k].json(), expected);
  }
}));

test('长短表串行多轮交错：每轮结果与全新服务基准一致（回归）', withApp(async (app) => {
  const payloads = mixedPayloads();
  for (let round = 0; round < 3; round++) {
    for (const { url, body } of payloads) {
      const res = await app.inject({ method: 'POST', url, payload: body });
      assert.equal(res.statusCode, 200, res.body);
      const expected = baselineResponse(url, body);
      assert.deepEqual(res.json(), expected);
    }
  }
}));

test('真实 HTTP 监听也能正常服务（listen + fetch）', async () => {
  const app = buildApp();
  try {
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address();
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: 'ok' });
  } finally {
    await app.close();
  }
});
