# Changelog

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [0.1.0] - 2026-11-12

首个公开版本。

### Added

- 插件包：安装并启用后，默认关闭五条已核验的官方上报通道（反馈触发的 OTel 会话上传、模型请求附带的规范会话日志与插件包清单、桌面产品埋点采集及其真实导出器）。
- `productTelemetry` 空实现：接受记录后立即丢弃，不排队、不落盘、不导出，仅保留官方 `productAnalytics` 的禁用状态查询能力。
- `privacyMode.status()` 只读服务：报告规则命中与存活服务状态，服务未挂载与配置禁用分开报告。
- `bin/check.mjs` 离线检查器：读取 `dsh --dump-config` 导出，校验受保护条目的默认值、来源一致性与版本，返回码 `0`/`1`/`2`。
- 显式失败：受保护条目被覆盖、模块同名不同源、额外官方上报实例或版本未验证时让插件自身不生效，不终止宿主。
- 测试：25 个单元测试 + 集成测试（临时 Home/Profile、合成数据、本机 HTTP 接收端）。
- `provenance.json`：记录验证运行时、11 条已核验契约、公开引用与已知边界。

[Unreleased]: https://github.com/deqingLv/dsh-privacy-mode/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/deqingLv/dsh-privacy-mode/releases/tag/v0.1.0
