# 离散生命表寿险精算现值服务（APV Service）

把离散生命表下的精算现值口径固化为常驻 HTTP 服务，Node.js 20 + Fastify 实现，
供产品系统反复直接调用，统一趸缴终身寿险、期初生存年金、定期/两全净保费的计算口径。

## 口径约定（离散精算惯例，钉死）

- 贴现因子 `v = 1 / (1 + i)`；贴现率 `d = i / (1 + i)`（**不是利率 `i` 本身**）
- 活过前 k 年的概率连乘递推：`_0 p_x = 1`，`_{k+1} p_x = _k p_x · (1 − q_{x+k})`
- 第 k 年死亡概率：`_k p_x · q_{x+k}`
- 终身寿险（年末赔付）：`A_x = Σ v^(k+1) · _k p_x · q_{x+k}`
- 期初生存年金：`ä_x = Σ v^k · _k p_x`
- 定期死亡（保障年限 n）：`A¹_{x:n} = Σ_{k=0}^{n-1} v^(k+1) · _k p_x · q_{x+k}`
- 纯生存：`_n E_x = _n p_x · v^n`
- 两全净保费：`A_{x:n} = A¹_{x:n} + _n E_x`

恒等式（测试钉死）：`1 = A_x + d · ä_x`（终龄死亡率为 1 时严格闭合）。
全程逐年离散递推，不引入连续死亡力近似。

## 一条命令构建并启动（容器，基础镜像锁定 node:20）

```bash
docker build -t life-apv:latest .
docker run --rm -p 3000:3000 life-apv:latest
# 换端口： -e PORT=8080 -p 8080:8080
```

## 本地开发

```bash
npm ci          # 或 npm install
npm test        # node:test，32 项测试
npm start       # http://localhost:3000
```

## HTTP 接口（JSON）

### 1）终身寿险 + 期初年金 —— `POST /api/v1/life-table`

请求：

```json
{
  "startAge": 40,
  "mortalityRates": [0.1, 0.2, 0.25, 0.5, 1],
  "interestRate": 0.25
}
```

- `startAge`：起始整数年龄（0–120）
- `mortalityRates`：从起始年龄起逐岁死亡率，每项 [0,1]，**终龄最后一项固定为 1**
- `interestRate`：年利率，要求 `i > -1`

响应（节选）：

```json
{
  "wholeLifeInsuranceAPV": 0.4864256,
  "annuityDueAPV": 2.567872,
  "discountFactor": 0.8,
  "discountRate": 0.2,
  "identity": { "residual": -4.4e-16, "closed": true }
}
```

### 2）两全净保费（含两个分项）—— `POST /api/v1/endowment`

在上面字段基础上增加：

```json
{ "years": 3, "sumInsured": 100000 }
```

响应同时给出单位保额口径 `perUnit` 与金额口径 `money`：

```json
{
  "perUnit": {
    "termInsuranceAPV": 0.28736,
    "pureEndowmentAPV": 0.27648,
    "endowmentNetPremium": 0.56384
  },
  "money": {
    "termInsurance": 28736.0,
    "pureEndowment": 27648.0,
    "endowmentNetPremium": 56384.0
  }
}
```

### 示范生命表（手工校算）

- `GET /api/v1/sample-table`：两份示范表（40 岁起、i=25%，v=0.8/d=0.2，手算无压力）
  - `standard-40`：逐年非零，验证恒等式闭合
  - `zero-segment-40`：前三年死亡率全 0，验证定期死亡=0、纯生存退化为纯贴现 v³=0.512

`GET /api/v1/sample-table?id=standard-40` 返回含手算参考值的完整数据。

### 标准表手工复算（v=0.8）

| k | 年龄 | q   | _k p | 死亡概率 _k p·q | v^(k+1)·死亡 | v^k·_k p |
|---|------|-----|------|-----------------|--------------|----------|
| 0 | 40 | 0.10 | 1.00 | 0.10 | 0.08000 | 1.00000 |
| 1 | 41 | 0.20 | 0.90 | 0.18 | 0.11520 | 0.72000 |
| 2 | 42 | 0.25 | 0.72 | 0.18 | 0.09216 | 0.46080 |
| 3 | 43 | 0.50 | 0.54 | 0.27 | 0.110592 | 0.27648 |
| 4 | 44 | 1.00 | 0.27 | 0.27 | 0.0884736 | 0.110592 |

合计 `A_x = 0.4864256`，`ä_x = 2.567872`，`A_x + 0.2·ä_x = 1`。
n=3：定期死亡 `0.28736`、纯生存 `0.54·0.8³ = 0.27648`、两全 `0.56384`。

## 非法输入（计算前挡下，HTTP 400 结构化错误）

年龄越界、死亡率超出 [0,1]、终龄死亡率不为 1、利率 `i ≤ -1`（贴现因子非正）、
保额非正、保障年限为负或超出表长。响应形如：

```json
{
  "error": "VALIDATION_FAILED",
  "message": "请求参数校验失败，未执行任何精算计算",
  "issues": [
    { "field": "sumInsured", "code": "NON_POSITIVE_AMOUNT", "detail": "保额必须为正数，收到 0" }
  ]
}
```

## 代码结构（按职责一模块一文件）

```
src/
  actuarial/
    discount.js     # v、d 换算与贴现幂次
    survival.js     # 生存概率逐年连乘递推
    wholeLife.js    # 终身寿险现值
    annuity.js      # 期初年金现值
    endowment.js    # 定期死亡 / 纯生存 / 两全两个分项
    valuation.js    # 单次请求编排（局部中间量，无共享可变状态）
  validation/
    validate.js     # 参数校验
  http/
    routes.js       # 请求处理层（不含计算口径）
  data/sampleTable.js
  errors.js  app.js  server.js
test/               # 恒等式 / 零死亡率退化 / 利率敏感性 / 保额比例 / 非法入参 / 并发隔离
```

并发隔离：每次请求在自己的调用栈内新建 `kp`/`deathInYear` 等累积量，
无任何模块级可变状态，多个核算请求各算各的、互不串写（有 20 路并发测试钉住）。
