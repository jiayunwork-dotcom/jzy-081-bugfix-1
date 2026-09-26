// 参数校验层：所有非法输入必须在这里挡下，绝不让其进入递推/计算模块。
//
// 覆盖非法情形（对应需求逐条）：
//   - 年龄越界
//   - 死亡率落到 [0,1] 之外
//   - 利率低到让贴现因子非正（i <= -1）
//   - 保额非正
// 另对类型、缺失、非整数、终龄死亡率不为 1 等结构性问题一并拦截。

import { ValidationError } from '../errors.js';

export const MIN_AGE = 0;
export const MAX_AGE = 120; // 终龄封顶：qx 最后一项对应年龄不得超过 120

const issue = (field, code, detail) => ({ field, code, detail });

const isFiniteNumber = (v) =>
  typeof v === 'number' && Number.isFinite(v);

/**
 * 校验起始年龄：必须是 [MIN_AGE, MAX_AGE] 内的整数。
 */
export function validateStartAge(startAge) {
  if (!isFiniteNumber(startAge) || !Number.isInteger(startAge)) {
    return issue('startAge', 'INVALID_AGE', '起始年龄必须是整数');
  }
  if (startAge < MIN_AGE || startAge > MAX_AGE) {
    return issue(
      'startAge',
      'AGE_OUT_OF_RANGE',
      `起始年龄越界：必须在 ${MIN_AGE} 到 ${MAX_AGE} 岁之间，收到 ${startAge}`,
    );
  }
  return null;
}

/**
 * 校验死亡率序列：
 *   - 必须是非空有限数组，每项是 [0,1] 内的有限数
 *   - 终龄（最后一项）死亡率固定为 1
 *   - 起始年龄 + 序列长度 - 1 不得超过 MAX_AGE
 */
export function validateMortalityTable(qx, startAge) {
  const issues = [];

  if (!Array.isArray(qx) || qx.length === 0) {
    issues.push(
      issue('mortalityRates', 'INVALID_TABLE', '死亡率序列必须是非空数组'),
    );
    return issues;
  }

  qx.forEach((q, idx) => {
    if (!isFiniteNumber(q)) {
      issues.push(
        issue(
          'mortalityRates',
          'INVALID_RATE',
          `第 ${idx} 项（年龄 ${startAge + idx}）死亡率不是有限数值：${String(q)}`,
        ),
      );
    } else if (q < 0 || q > 1) {
      issues.push(
        issue(
          'mortalityRates',
          'RATE_OUT_OF_RANGE',
          `第 ${idx} 项（年龄 ${startAge + idx}）死亡率落到 [0,1] 之外：${q}`,
        ),
      );
    }
  });

  const terminalAge = startAge + qx.length - 1;
  if (terminalAge > MAX_AGE) {
    issues.push(
      issue(
        'mortalityRates',
        'AGE_OUT_OF_RANGE',
        `生命表终龄 ${terminalAge} 越界：起始年龄 ${startAge} + 序列长度 ${qx.length} 不得超过 ${MAX_AGE + 1}`,
      ),
    );
  }

  const last = qx[qx.length - 1];
  if (isFiniteNumber(last) && last !== 1) {
    issues.push(
      issue(
        'mortalityRates',
        'TERMINAL_RATE_NOT_ONE',
        `生命表终龄（${terminalAge} 岁）死亡率必须固定为 1，收到 ${last}`,
      ),
    );
  }

  return issues;
}

/**
 * 校验年利率：i > -1，保证贴现因子 v = 1/(1+i) 为正且有限。
 */
export function validateInterestRate(interestRate) {
  if (!isFiniteNumber(interestRate)) {
    return issue('interestRate', 'INVALID_RATE', '年利率必须是有限数值');
  }
  if (interestRate <= -1) {
    return issue(
      'interestRate',
      'NON_POSITIVE_DISCOUNT_FACTOR',
      `利率 ${interestRate} 过低：要求 i > -1，否则贴现因子 1/(1+i) 非正`,
    );
  }
  return null;
}

/**
 * 校验保额：必须为正数。
 */
export function validateSumInsured(sumInsured) {
  if (!isFiniteNumber(sumInsured)) {
    return issue('sumInsured', 'INVALID_AMOUNT', '保额必须是有限数值');
  }
  if (sumInsured <= 0) {
    return issue(
      'sumInsured',
      'NON_POSITIVE_AMOUNT',
      `保额必须为正数，收到 ${sumInsured}`,
    );
  }
  return null;
}

/**
 * 校验保障年限：0 <= n <= 表长 的整数。
 * n = 0 是合法口径（定期死亡给付为 0），只挡负数和超出表长。
 */
export function validateYears(years, tableLength) {
  if (!isFiniteNumber(years) || !Number.isInteger(years)) {
    return issue('years', 'INVALID_YEARS', '保障年限必须是非负整数');
  }
  if (years < 0) {
    return issue('years', 'NEGATIVE_YEARS', `保障年限不得为负，收到 ${years}`);
  }
  if (years > tableLength) {
    return issue(
      'years',
      'YEARS_EXCEED_TABLE',
      `保障年限 ${years} 超过生命表可覆盖年数 ${tableLength}`,
    );
  }
  return null;
}

function reject(issues) {
  if (issues.length > 0) {
    throw new ValidationError('请求参数校验失败，未执行任何精算计算', issues);
  }
}

/**
 * 校验「终身寿险/年金」接口的完整入参，返回清洗后的入参。
 */
export function validateLifeTableInput(body = {}) {
  const { startAge, mortalityRates, interestRate } = body;
  const issues = [];

  const ageIssue = validateStartAge(startAge);
  if (ageIssue) issues.push(ageIssue);

  // 年龄无效时表内逐项年龄对不上，年龄这一项挡下后仍可单独报告表格自身问题
  const safeAge = isFiniteNumber(startAge) && Number.isInteger(startAge)
    ? startAge
    : 0;
  issues.push(...validateMortalityTable(mortalityRates, safeAge));

  const rateIssue = validateInterestRate(interestRate);
  if (rateIssue) issues.push(rateIssue);

  reject(issues);
  return { startAge, qx: mortalityRates, interestRate };
}

/**
 * 校验「两全保险」接口的完整入参，返回清洗后的入参。
 */
export function validateEndowmentInput(body = {}) {
  const { startAge, mortalityRates, interestRate, years, sumInsured } = body;
  const issues = [];

  const ageIssue = validateStartAge(startAge);
  if (ageIssue) issues.push(ageIssue);

  const safeAge = isFiniteNumber(startAge) && Number.isInteger(startAge)
    ? startAge
    : 0;
  const tableIssues = validateMortalityTable(mortalityRates, safeAge);
  issues.push(...tableIssues);

  const rateIssue = validateInterestRate(interestRate);
  if (rateIssue) issues.push(rateIssue);

  const amountIssue = validateSumInsured(sumInsured);
  if (amountIssue) issues.push(amountIssue);

  // 表本身非法时年限无法对照，避免再追加一条误导性错误
  if (Array.isArray(mortalityRates) && mortalityRates.length > 0) {
    const yearsIssue = validateYears(years, mortalityRates.length);
    if (yearsIssue) issues.push(yearsIssue);
  }

  reject(issues);
  return {
    startAge,
    qx: mortalityRates,
    interestRate,
    years,
    sumInsured,
  };
}
