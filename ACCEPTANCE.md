# dsh-privacy-mode 0.1.0 验收说明

## 结论

插件包已通过源码策略测试、真实 DSH 原生 patch 组合、安装器和官方模块的隔离验收。支持 DSH **0.2.1-rc.5** / Cordis **4.0.5**。

本包仅保证在已验证组合、无更高优先级覆盖且冷启动生效后，默认关闭指定官方上报通道。它不是全网出站阻断器，也未完成正式 Electron 桌面 GUI 安装验收。

## 验证证据

- `npm run check`：**69 项**单元测试通过，0 失败；覆盖 32 种通道组合的审计期望、偏好文件的严格解析/权限/CAS/失败回滚/锁竞争与陈旧锁回收、启动快照的冻结与 HMR 语义、HTTP 路由校验，以及设置页的槽位注册与请求载荷。
- 设置页：注册为「设置 → 插件 → 隐私上报」标签页（`plugins.item`，`id: privacy-mode`），只依赖 `slots` 与 `locale`；页面读取 `GET /api/privacy-mode/settings`、保存 `POST` 同一路径，错误码 `PREFS_CONFLICT` 触发重新读取。**未在真实 Electron GUI 中渲染验收**——本机无可用 React 运行时，只做了模块加载、槽位与数据层测试。
- 真实插件 CLI：在全新临时 HOME/DSH_HOME 的自定义 Profile 中安装 `.tgz`，原生安装器默认加入 bundle 选择列表；导出包含官方 base/web-app 桌面条目的配置，并通过离线检查器。
- 真实加载：从最终安装包加载 `privacy-mode` 与 sink，实际启动所需官方模块；没有启动完整 Desktop/Web 应用、云模型、真实登录态或其他网络工具。
- 官方产品 OTel 导出正向对照：本机 HTTP 接收端收到 **1 次**合成事件请求。
- 官方反馈会话 OTel 正向对照：通过真实 Session 追加规范 `feedback/record`，接收端收到 **1 次**请求。
- 隐私模式：规范反馈、本地产品事件、直接 sink 调用及资源释放后，接收端新增请求 **0 次**；产品身份读取 **0 次**；Session OTel reporter 未创建。
- 请求扩展真实 API：隐私模式下不产生 `dsh_session_log` 和 `dsh_plugin_packages`，且无准备失败。只在隔离测试内重新开启同一官方模块时，两字段恢复，证明并非测试链路无效。
- 状态与覆盖：隔离 Loader 更高优先级重新开启 `product-analytics` 时，插件**仍发布** `privacyMode.status()`，`policy.ok === false` 且列出 `PRIVACY_OVERRIDE_OR_UNRESOLVED`；启动不再因审计失败而中断（旧版行为已废弃）。
- 选择性上报 A/B：保存 `feedback: true` 后 `pendingRestart === true`、`applied.channels.feedback` 仍为 `false`、`sessionTelemetry.sharing` 仍是 `disabled`；用同一份偏好文件重新 boot 后 `sharing === 'feedback-only'`、`pendingRestart === false`；最后保存全关复原。
- 真实 CLI 卸载：本包从选择列表移除，原组合默认值恢复，隐私条目消失；不覆盖用户原有 patch。
- 集成测试共 **18 项**全部通过（`passed: true`，摘要写入 `DSH_TEST_RESULT`，最近一次为 `/tmp/privacy-integration-result2.json`），其中第 12、13 项正是「保存后本次不生效 / 重新 boot 才生效」的 A/B。
- 设置页展示三层状态：已保存的选择、本次启动实际生效值（每行“本次启动”）、当前运行态；保存后仍显示“待重启生效”。

## 本机正式环境边界

正式 dsh 的 `desktop` 和 `web` 均未安装本包。测试仅在临时 Home 进行，没有修改正式 Profile、系统防火墙、hosts、代理、MDM/EDR/DLP 或模型设置；没有创建或推送远端仓库。

## 必须保留的限制

1. 桌面 Profile 由 Electron 独占管理，真实 CLI 会拒绝 `--profile desktop`。请从桌面插件页面安装；CLI 验收采用自定义空 Profile + 原生桌面配置层，不将其表述为完整 Electron 验收。
2. 已发送、已入队或已准备的请求不能追回；安装动作本身可能被旧埋点采集，热卸载旧 exporter 时还可能发送其既有队列。**安装后冷启动**才是默认配置验收边界。
3. 更高优先级 patch / 后续 bundle 可以覆盖默认值。审计失败只拒绝本插件，不保证阻止整个 DSH 启动；不要以安装成功替代检查。
4. 云模型输入、上下文和工具结果、第三方插件/MCP/子进程网络、更新、认证和市场查询不在控制范围内。
5. 卸载可能恢复开启，重新开启 Session Log 可能补传关闭期间记录。
6. 只验证本机 macOS ARM64 与指定版本；其他平台/版本需另行验证。

Selective reporting acceptance: the settings page lives under Settings → Plugins → Privacy reporting and only touches `privacy-mode/prefs.json` through the authenticated settings route. Saving affects the next cold start only; a reload never re-samples the boot snapshot. Collection and export are separate switches, and an override is reported as a page issue instead of failing the boot. The page itself was not rendered in a real Electron GUI. This is not a firewall; start with an isolated profile and every channel off.

选择性上报验收：设置页位于「设置 → 插件 → 隐私上报」，只通过已鉴权的设置路由读写 `privacy-mode/prefs.json`。保存仅在下次冷启动生效，热重载不会重新采样启动快照；采集与导出分别控制，覆盖情况以页面问题列表呈现而不再中断启动。设置页本身尚未在真实 Electron GUI 渲染验收。此功能不是防火墙，请先使用隔离 profile 并保持全部关闭。
