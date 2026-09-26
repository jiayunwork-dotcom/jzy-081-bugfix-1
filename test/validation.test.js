// 参数校验测试：非法生命表与参数必须在任何计算之前被挡下，错误结构化。
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  validateLifeTableInput,
  validateEndowmentInput,
} from '../src/validation/validate.js';
import { ValidationError } from '../src/errors.js';

const goodBody = {
  startAge: 40,
  mortalityRates: [0.1, 0.2, 0.25, 0.5, 1],
  interestRate: 0.05,
};

function expectValidation(fn) {
  assert.throws(fn, (err) => {
    assert.ok(err instanceof ValidationError);
    assert.equal(err.statusCode, 400);
    assert.ok(Array.isArray(err.issues) && err.issues.length > 0);
    assert.ok(err.issues.every((x) => x.field && x.code && x.detail));
    return true;
  });
}

test('合法入参通过校验并返回清洗结果', () => {
  const r = validateLifeTableInput(goodBody);
  assert.equal(r.startAge, 40);
  assert.equal(r.interestRate, 0.05);
  assert.deepEqual(r.qx, goodBody.mortalityRates);
});

test('年龄越界被挡（负数 / 超上限 / 非整数 / 缺失）', () => {
  expectValidation(() => validateLifeTableInput({ ...goodBody, startAge: -1 }));
  expectValidation(() => validateLifeTableInput({ ...goodBody, startAge: 121 }));
  expectValidation(() => validateLifeTableInput({ ...goodBody, startAge: 40.5 }));
  expectValidation(() =>
    validateLifeTableInput({ ...goodBody, startAge: undefined }));
});

test('生命表超龄（startAge + 长度 - 1 > 120）被挡', () => {
  const qx = new Array(82).fill(0);
  qx[81] = 1; // 40 + 82 - 1 = 121
  expectValidation(() =>
    validateLifeTableInput({ startAge: 40, mortalityRates: qx, interestRate: 0.05 }));
});

test('死亡率落到 [0,1] 之外被挡', () => {
  expectValidation(() =>
    validateLifeTableInput({ ...goodBody, mortalityRates: [0.1, 1.2, 1] }));
  expectValidation(() =>
    validateLifeTableInput({ ...goodBody, mortalityRates: [-0.01, 0.5, 1] }));
  expectValidation(() =>
    validateLifeTableInput({ ...goodBody, mortalityRates: [0.1, NaN, 1] }));
});

test('终龄死亡率不为 1 被挡', () => {
  expectValidation(() =>
    validateLifeTableInput({ ...goodBody, mortalityRates: [0.1, 0.2, 0.9] }));
});

test('死亡率序列为空 / 非数组被挡', () => {
  expectValidation(() =>
    validateLifeTableInput({ ...goodBody, mortalityRates: [] }));
  expectValidation(() =>
    validateLifeTableInput({ ...goodBody, mortalityRates: null }));
});

test('利率低到贴现因子非正（i <= -1）被挡', () => {
  expectValidation(() => validateLifeTableInput({ ...goodBody, interestRate: -1 }));
  expectValidation(() => validateLifeTableInput({ ...goodBody, interestRate: -1.5 }));
});

test('保额非正被挡（0 / 负数 / NaN）', () => {
  const mk = (sumInsured) =>
    () =>
      validateEndowmentInput({
        ...goodBody,
        years: 3,
        sumInsured,
      });
  expectValidation(mk(0));
  expectValidation(mk(-100));
  expectValidation(mk(NaN));
});

test('保障年限非法被挡（负数 / 非整数 / 超过表长），n=0 合法', () => {
  const mk = (years) =>
    () =>
      validateEndowmentInput({
        ...goodBody,
        years,
        sumInsured: 1000,
      });
  expectValidation(mk(-1));
  expectValidation(mk(2.5));
  expectValidation(mk(99));
  assert.doesNotThrow(mk(0));
  assert.doesNotThrow(mk(goodBody.mortalityRates.length));
});

test('多个问题一次性收集到多条 issue', () => {
  try {
    validateEndowmentInput({
      startAge: -5,
      mortalityRates: [2, -1],
      interestRate: -2,
      years: -3,
      sumInsured: 0,
    });
    assert.fail('应当抛出 ValidationError');
  } catch (err) {
    assert.ok(err instanceof ValidationError);
    const fields = new Set(err.issues.map((x) => x.field));
    assert.ok(fields.has('startAge'));
    assert.ok(fields.has('mortalityRates'));
    assert.ok(fields.has('interestRate'));
    assert.ok(fields.has('years'));
    assert.ok(fields.has('sumInsured'));
  }
});
