# 战术分享节点

国内主节点与退役海外站的兼容节点提供同一套 REST 契约，保存两类 JSON 战术分享：

- 手机端生成的单份当前快照。
- 桌面端生成的完整 SQLite 工作树便携包，另带生成二维码时的当前展示快照。

服务不接收或保存报告图片；二维码图片仍由浏览器生成和识别。手机扫桌面码只取当前展示快照，桌面扫桌面码才迁移整棵工作树。

两端持久化相互独立：国内使用 Node.js + SQLite；海外 UI 已跳转国内，但 Sites Worker 暂留 D1/R2 API 以读取历史分享。前端并发读取两个节点，因此旧二维码无需先做数据库复制。

## 共同约束

- 分享永久保存。
- 浏览器会收到服务端签名的匿名随机 Cookie。每个浏览器 24 小时最多创建 3 份、每个 IP 最多创建 10 份、每个节点最多创建 100 份。
- 该 Cookie 不是硬件指纹；清除站点数据或更换浏览器会生成新身份，但 IP 与节点限速仍然生效。
- 完全相同的分享内容复用已有二维码，不重复占用存储或创建名额；单份 JSON 最大 8 MiB。
- 前端只读两个写死的官方节点，并发请求后使用第一份校验通过的内容；某个节点先返回 404 不会提前结束。
- 跨站读取只允许代码中的官方 Origin，不接受二维码自带的任意服务器地址。
- `/api/mobile-shares` 必须使用 `no-store`，不得进入静态缓存或 Service Worker。

## 国内 Node 节点

- Node.js 24。
- 仅监听 `127.0.0.1:8787`，公网流量必须经过 Caddy 与 Nginx。
- SQLite 固定保存在 `/var/lib/dmg-end-field/mobile-shares.sqlite`。
- 分享永久保存；旧数据库中的限时分享会在服务升级时原地转为永久分享。

### 首次安装

1. 创建 `/opt/dmg-end-field-share` 与 `/var/lib/dmg-end-field`，数据库目录归 `www-data:www-data`。
2. 将 `server/mobile-share-server.mjs` 安装为 `/opt/dmg-end-field-share/mobile-share-server.mjs`。
3. 将 `mobile-share.service` 安装到 `/etc/systemd/system/`，执行 daemon-reload 并启用服务。
4. 将 `nginx-location.conf` 中的两个 location 放入对应站点的 `server {}`，且位于 SPA fallback 之前。
5. 先执行 `nginx -t`，再 reload Nginx。

## 海外 Sites 历史兼容节点

- `.openai/hosting.json` 声明 `DB` 与 `MOBILE_SHARES` 两个逻辑绑定。
- `drizzle/` 保存 D1 建表迁移；Worker 启动时仍执行幂等建表，避免首次请求依赖迁移时序。
- D1 只保存分享 ID、内容哈希、大小、创建时间与限流事件；最大 8 MiB 的完整 JSON 放在 R2。
- Sites 仅在修复退役跳转或历史分享兼容层时发布，必须携带 `dist/.openai/hosting.json` 和 `dist/.openai/drizzle/`，不得创建第二个 Sites 项目。

## 验证

```bash
curl --fail --silent --show-error http://127.0.0.1:8787/api/mobile-shares/health
curl --fail --silent --show-error http://127.0.0.1:8080/api/mobile-shares/health
curl --fail --silent --show-error https://dmgendfield.cloud/api/mobile-shares/health
curl --fail --silent --show-error https://dmgendfield.online/api/mobile-shares/health
```

四个地址都应返回 `{"ok":true,...}`。国内数据库文件、上一版服务文件、海外 D1/R2 和 Sites 上一版都应保留为回滚点。
