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

### Unreleased / 未发布

### Added

- 设置页：新增「设置 → 插件 → 隐私上报」，五项通道逐项开关，展示已保存、本次启动生效与运行态三种状态，覆盖或审计问题以列表呈现；保存走宿主已鉴权的 `GET/POST /api/privacy-mode/settings`，并发写返回 `PREFS_CONFLICT` 并重新读取。
- 后端偏好：`privacy-mode/prefs.json`（0600、原子写、CAS）+ 冻结的启动快照，`cordis.patch.yml` 由快照驱动；保存只在下次冷启动生效，热重载不重新采样。
- 审计语义调整：覆盖不再让插件激活失败，改为始终发布 `privacyMode.status()` 并列出问题码（`PRIVACY_OVERRIDE_OR_UNRESOLVED` 等）。
- 测试：单元测试 25 → 68（32 种通道组合、偏好解析/权限/CAS、启动快照与 HMR、路由校验、设置页槽位与载荷）；集成测试新增保存后待重启与重新 boot 生效的 A/B 对照，共 18 项。

- Settings page under Settings → Plugins → Privacy reporting with per-channel switches, showing saved, applied and live state; overrides surface as issues instead of failing activation. Saving goes through the Host's authenticated `GET/POST /api/privacy-mode/settings`; a concurrent write returns `PREFS_CONFLICT`.
- Backend preferences (`privacy-mode/prefs.json`, 0600, atomic write, CAS) and a frozen per-boot snapshot that drives `cordis.patch.yml`; saving requires a cold restart and a reload never re-samples.
- Audit no longer fails activation: the plugin always publishes `privacyMode.status()` and reports issues.
- Tests: 25 → 68 unit tests plus an 18-check integration run with a save/reboot A/B.

Not a firewall; real Electron cold-start acceptance and the rendered settings page remain unverified.
