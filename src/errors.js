// 统一的结构化校验错误。
// 路由层把它转成 HTTP 400 + 结构化 JSON；任何计算都在其之前被挡下。
export class ValidationError extends Error {
  /**
   * @param {string} message 人类可读的总说明
   * @param {{ field?: string, code: string, detail?: string }[]} issues
   *        逐条错误，字段名 / 错误码 / 具体说明
   */
  constructor(message, issues) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = 400;
    this.issues = issues;
  }
}
