// Fastify 应用工厂：错误处理在这一层统一挂，测试也注入这同一个 app。

import Fastify from 'fastify';
import registerRoutes from './http/routes.js';
import { ValidationError } from './errors.js';

export function buildApp(options = {}) {
  const app = Fastify({
    logger: options.logger ?? false,
  });

  // 校验错误 -> HTTP 400 结构化响应，且明确未执行计算
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ValidationError) {
      return reply.status(400).send({
        error: 'VALIDATION_FAILED',
        message: error.message,
        issues: error.issues,
      });
    }

    // JSON 解析失败等请求类错误也按 400 结构化返回
    if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
      return reply.status(error.statusCode).send({
        error: 'BAD_REQUEST',
        message: error.message,
      });
    }

    request.log.error(error);
    return reply.status(500).send({
      error: 'INTERNAL_ERROR',
      message: '服务内部错误',
    });
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send({
      error: 'NOT_FOUND',
      message: `路径不存在：${request.method} ${request.url}`,
    });
  });

  app.register(registerRoutes);
  return app;
}
