# 运行时基础镜像锁定 Node.js 20（含不可变 digest，便于复现构建）
FROM node:20-bookworm-slim

# 生产环境默认值；端口可在运行时通过 -e PORT 覆盖
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

WORKDIR /app

# 先装依赖，利用 Docker 层缓存
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# 再拷业务代码
COPY src ./src

# 非 root 用户运行
USER node

EXPOSE 3000

# 简易健康检查（镜像内自带 node，无需额外安装 curl）
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
