// 供 HTTP 回归测试使用：在一个全新的 Node 进程里起 app、只处理一个请求。
// 用法：node fresh-inject.mjs <url> <payloadJson>
// 输出：JSON.stringify({ statusCode, body })
//
// 刻意用独立进程而不是同进程再 buildApp()：模块级状态会随模块缓存被同进程
// 所有 app 共享，只有独立进程才算「全新启动、只算过这一单」的干净基准。

import { buildApp } from '../../src/app.js';

const [url, payloadJson] = process.argv.slice(2);

const app = buildApp();
try {
  const res = await app.inject({
    method: 'POST',
    url,
    payload: JSON.parse(payloadJson),
  });
  process.stdout.write(
    JSON.stringify({ statusCode: res.statusCode, body: res.body }),
  );
} finally {
  await app.close();
}
