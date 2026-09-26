// 服务启动入口：端口由环境变量 PORT 覆盖，默认 3000。
import { buildApp } from './app.js';

const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';

const app = buildApp({ logger: true });

try {
  await app.listen({ port: PORT, host: HOST });
  app.log.info(`寿险精算现值服务已启动: http://${HOST}:${PORT}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}

// 优雅退出
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });
}
