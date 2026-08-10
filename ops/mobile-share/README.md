# 国内手机版战术分享服务

该服务只保存手机版工作区 JSON，不接收或保存报告图片。二维码图片由浏览器生成和识别。

## 运行约束

- Node.js 24。
- 仅监听 `127.0.0.1:8787`，公网流量必须经过 Caddy 与 Nginx。
- SQLite 固定保存在 `/var/lib/dmg-end-field/mobile-shares.sqlite`。
- 分享永久保存；旧数据库中的限时分享会在服务升级时原地转为永久分享。
- 浏览器会收到服务端签名的匿名随机 Cookie。每个浏览器 24 小时最多创建 3 份、每个 IP 最多创建 10 份、全站最多创建 100 份。
- 该 Cookie 不是硬件指纹；清除站点数据或更换浏览器会生成新身份，但 IP 与全站限速仍然生效。
- 完全相同的工作区内容复用已有二维码，不重复占用数据库或创建名额；单份 JSON 最大 256 KiB。
- `/api/mobile-shares` 必须使用 `no-store`，不得进入静态缓存或 Service Worker。

## 首次安装

1. 创建 `/opt/dmg-end-field-share` 与 `/var/lib/dmg-end-field`，数据库目录归 `www-data:www-data`。
2. 将 `server/mobile-share-server.mjs` 安装为 `/opt/dmg-end-field-share/mobile-share-server.mjs`。
3. 将 `mobile-share.service` 安装到 `/etc/systemd/system/`，执行 daemon-reload 并启用服务。
4. 将 `nginx-location.conf` 中的两个 location 放入国内站点的 `server {}`，且位于 SPA fallback 之前。
5. 先执行 `nginx -t`，再 reload Nginx。

## 验证

```bash
curl --fail --silent --show-error http://127.0.0.1:8787/api/mobile-shares/health
curl --fail --silent --show-error http://127.0.0.1:8080/api/mobile-shares/health
curl --fail --silent --show-error http://150.158.133.176/api/mobile-shares/health
```

三个地址都应返回 `{"ok":true,...}`。数据库文件和上一版服务文件应保留为回滚点。
