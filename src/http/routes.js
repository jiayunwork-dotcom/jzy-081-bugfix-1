// 请求处理层（HTTP 路由）：只做入参接收、校验委派、结果组装，
// 递推核心与精算逻辑全部在 src/actuarial/* 各模块，路由层不含任何计算口径。

import {
  validateLifeTableInput,
  validateEndowmentInput,
} from '../validation/validate.js';
import { valueLifeTable, valueEndowment } from '../actuarial/valuation.js';
import { SAMPLE_TABLES, getSampleTable } from '../data/sampleTable.js';

export default async function registerRoutes(app) {
  // 健康检查
  app.get('/health', async () => ({ status: 'ok' }));

  // 示范生命表（不加 id 时返回列表）
  app.get('/api/v1/sample-table', async (request) => {
    const { id } = request.query;
    if (id) {
      const table = getSampleTable(id);
      if (!table) {
        return {
          tables: SAMPLE_TABLES.map((t) => t.id),
        };
      }
      return table;
    }
    return { tables: SAMPLE_TABLES };
  });

  // 口子一：生命表 + 起始年龄 + 利率 -> 终身寿险现值、期初年金现值
  app.post('/api/v1/life-table', async (request, reply) => {
    const input = validateLifeTableInput(request.body);
    const result = valueLifeTable(input);

    reply.code(200);
    return {
      startAge: input.startAge,
      terminalAge: input.startAge + input.qx.length - 1,
      interestRate: input.interestRate,
      discountFactor: result.discountFactor,
      discountRate: result.discountRate,
      wholeLifeInsuranceAPV: result.wholeLifeInsurance,
      annuityDueAPV: result.annuityDue,
      identity: {
        formula: '1 = A_x + d * a_due_x, d = i/(1+i)',
        residual: result.identityResidual,
        closed: result.identityClosed,
      },
    };
  });

  // 口子二：再加保障年限与保额 -> 两全净保费及定期死亡、纯生存两个分项
  app.post('/api/v1/endowment', async (request, reply) => {
    const input = validateEndowmentInput(request.body);
    const result = valueEndowment(input);

    reply.code(200);
    return {
      startAge: input.startAge,
      terminalAge: input.startAge + input.qx.length - 1,
      interestRate: input.interestRate,
      discountFactor: result.discountFactor,
      discountRate: result.discountRate,
      years: result.years,
      sumInsured: result.sumInsured,
      perUnit: {
        termInsuranceAPV: result.perUnit.termInsurance,
        pureEndowmentAPV: result.perUnit.pureEndowment,
        endowmentNetPremium: result.perUnit.endowment,
      },
      money: {
        termInsurance: result.money.termInsurance,
        pureEndowment: result.money.pureEndowment,
        endowmentNetPremium: result.money.netPremium,
      },
      wholeLifeInsuranceAPV: result.wholeLifeInsurance,
      annuityDueAPV: result.annuityDue,
      identity: {
        formula: '1 = A_x + d * a_due_x, d = i/(1+i)',
        residual: result.identityResidual,
        closed: result.identityClosed,
      },
    };
  });
}
