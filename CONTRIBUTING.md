# Contributing to dsh-privacy-mode

这个项目的价值在于「结论可复现」，不在于「配置看起来更严格」。任何改动都要能被 `bin/check.mjs` 或测试验证。

## 可以接受的改动

- 新增一条**已在本机核验**的官方上报通道，并在 `provenance.json` 的 `reviewed_contracts` 里写清判定依据（包名、导出 id、默认值来源）。
- 修正现有规则码、错误信息、语言包或文档措辞。
- 补充测试：尤其是「配置被上层覆盖时显式失败」这类反例。
- 提升与新 DSH 版本的兼容性——但必须同时更新 `engines.dsh`、peer 版本和 `provenance.json` 的 `verified_runtime`。

## 不接受

- 未经核验的通道名、猜测的默认值，或「加上更安全」的防御性代码。
- 放宽版本校验、添加兼容豁免来消除安装报错。
- 全局 monkey patch `fetch`/`http`、启动监听端口、执行 shell、读取凭据或会话内容。
- 让插件在检查失败时终止整个宿主。失败只应让插件自身不生效。
- 在测试里使用真实账号、真实 Profile 或真实会话日志。

## 本地验证

```sh
npm ci --ignore-scripts --legacy-peer-deps
npm run check          # 语法检查 + 25 个单元测试
```

真实加载验证需要同版本官方运行时，见 README 的「开发与测试」。集成测试只使用临时 Home/Profile、合成数据和本机 HTTP 接收端。

## 提交约定

- 一个提交只做一件事；标题用 `feat:` / `fix:` / `docs:` / `test:` / `chore:` 前缀。
- 改了行为就同步 `CHANGELOG.md` 的 Unreleased 段。
- PR 里写清：改了什么、为什么、怎么验证的（贴 `npm run check` 的结果）。没有验证证据的 PR 会被要求补充。

## 报告安全问题

不要开公开 issue。按 `SECURITY.md` 的约定，用合成数据和确切版本描述问题，不要附真实凭据或完整会话日志。
