# 战术分享节点

同一份 Node 服务分别部署在国内、海外节点，保存两类 JSON 战术分享：

- 手机端生成的单份当前快照。
- 桌面端生成的完整 SQLite 工作树便携包，另带生成二维码时的当前展示快照。

服务不接收或保存报告图片；二维码图片仍由浏览器生成和识别。手机扫桌面码只取当前展示快照，桌面扫桌面码才迁移整棵工作树。

## 运行约束

- Node.js 24。
- 仅监听 `127.0.0.1:8787`，公网流量必须经过 Caddy 与 Nginx。
- 每个节点的 SQLite 固定保存在 `/var/lib/dmg-end-field/mobile-shares.sqlite`。
- 分享永久保存；旧数据库中的限时分享会在服务升级时原地转为永久分享。
- 浏览器会收到服务端签名的匿名随机 Cookie。每个浏览器 24 小时最多创建 3 份、每个 IP 最多创建 10 份、全站最多创建 100 份。
- 该 Cookie 不是硬件指纹；清除站点数据或更换浏览器会生成新身份，但 IP 与全站限速仍然生效。
- 完全相同的分享内容复用已有二维码，不重复占用数据库或创建名额；单份 JSON 最大 8 MiB。
- 前端只读两个写死的官方节点，并发请求后使用第一份校验通过的内容；某个节点先返回 404 不会提前结束。
- 跨站读取只允许代码中的官方 Origin，不接受二维码自带的任意服务器地址。
- `/api/mobile-shares` 必须使用 `no-store`，不得进入静态缓存或 Service Worker。

## 首次安装

1. 创建 `/opt/dmg-end-field-share` 与 `/var/lib/dmg-end-field`，数据库目录归 `www-data:www-data`。
2. 将 `server/mobile-share-server.mjs` 安装为 `/opt/dmg-end-field-share/mobile-share-server.mjs`。
3. 将 `mobile-share.service` 安装到 `/etc/systemd/system/`，执行 daemon-reload 并启用服务。
4. 将 `nginx-location.conf` 中的两个 location 放入对应站点的 `server {}`，且位于 SPA fallback 之前。
5. 先执行 `nginx -t`，再 reload Nginx。

国内、海外要分别完成上述部署，两端使用同一份服务代码，但各自保持独立 SQLite。

## 验证

```bash
curl --fail --silent --show-error http://127.0.0.1:8787/api/mobile-shares/health
curl --fail --silent --show-error http://127.0.0.1:8080/api/mobile-shares/health
curl --fail --silent --show-error http://150.158.133.176/api/mobile-shares/health
```

三个地址都应返回 `{"ok":true,...}`。数据库文件和上一版服务文件应保留为回滚点。
