# DEF Agent 开发手记站点

这个目录只负责把 `../web/dist` 中已经生成的完整开发手记打包为
OpenAI Sites 可以部署的静态站点，不改写正文或页面设计。

部署前先在 `../web` 执行 `bun run build`，再在本目录执行：

```sh
npm run build
```
