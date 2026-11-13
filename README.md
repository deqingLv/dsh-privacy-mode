# dsh-privacy-mode

DSH 原生插件包：安装并启用后，默认关闭已核验的官方上报通道。**不是网络防火墙，也不是离线模式。**

## 支持范围

当前仅声明兼容 **DSH 0.2.1-rc.5 / Cordis 4.0.5**，与开发时本机桌面版一致。其他版本未经验收，DSH 安装器会拒绝；不要为消除报错直接添加版本豁免。

| 通道 | 默认行为 |
| --- | --- |
| 反馈触发的 OTel 会话上传 | `session-telemetry-otel.mode: DISABLED` |
| 模型 HTTP 请求附带的规范会话日志 | `session-log-deepseek.enabled: false` |
| 模型 HTTP 请求附带的插件包清单 | `plugin-package-inventory-deepseek.enabled: false` |
| 桌面产品埋点采集 | `product-analytics.enabled: false` |
| 桌面产品埋点真实导出器 | `desktop-product-telemetry.disabled: true` |

提供一个不存储、不发送记录的 `productTelemetry` 空实现，以保留官方 `productAnalytics` RPC 的禁用状态查询能力，避免其依赖缺失导致桌面报错。插件增加本地只读 `privacyMode.status()` 服务、一条已鉴权的设置读写路由（复用宿主现有 `/api` 连接，不新开端口）和“设置 → 插件”里的设置页；不增加模型工具、计时器或外部监听端口。

## 安装

源码在 GitHub：<https://github.com/deqingLv/dsh-privacy-mode>。尚未发布到 npm，请从仓库克隆后按目录安装。

```sh
git clone https://github.com/deqingLv/dsh-privacy-mode.git
cd dsh-privacy-mode
npm ci --ignore-scripts --legacy-peer-deps
```

在 DSH 的“插件 → 添加插件”中填写上面这个克隆目录的绝对路径，或用 `npm pack --ignore-scripts` 生成 `.tgz` 后填包路径。

**桌面版**：使用“插件 → 添加插件”安装本地目录或 `.tgz`；桌面 Profile 由 Electron 独占管理，CLI 对 `desktop` 的操作会被拒绝。本次已验证同版本真实安装器与桌面配置组合，但未操作正式桌面 GUI。

**Web 版** CLI 示例（使用自己现有的 dsh，不会下载另一个宿主）：

```sh
dsh plugin --profile web add /path/to/dsh-privacy-mode
```

每个 Profile 需要独立安装，不自动影响其他 Profile。

**安装到正在运行的 Profile 后，重启该 Profile 才视为冷启动隐私默认生效。** 安装动作自身可能已被原来的桌面埋点采集；已经发送、已经准备好的模型请求或遥测队列不能追回。HMR 停止原导出器时也可能清空其既有队列。因此本插件不承诺“点击安装瞬间已无数据外传”。

## 验证

插件包层在宿主启动前参与组合。DSH 的 Profile patch、Home patch、命令行 patch，以及后加入的其他 bundle 可以覆盖它的默认值。**默认关闭不是强制锁定。** 本插件发现受保护条目被覆盖、模块同名不同源、额外官方上报实例或版本未验证时，会把问题列进 `ctx.privacyMode.status().issues` 并在页面显示，但不会让插件自身失效、不会停止整个 dsh、也不会自动改写配置。DSH 本身可能继续启动，不能把“装了插件”当安全边界。

Web / 自定义 Profile 可导出组合配置，再离线检查；桌面版不应照搬这条 CLI 命令，需通过其插件检查入口查看本包的加载状态，完整状态可由受信任本地 Cordis 检查器读取 `ctx.privacyMode.status()`。桌面 GUI 的检查入口尚未实测。

```sh
dsh --profile web --dump-config > /tmp/dsh-privacy-config.yml
node ./bin/check.mjs \
  --config /tmp/dsh-privacy-config.yml --dsh-version 0.2.1-rc.5 \
  --profile-dir ~/.dsh/profiles/web
# 对已取得的桌面组合配置快照，在检查命令最后加 --desktop。
```

`dump-config` 按设计**不求值 `!!js`**，所以本包五项目标在 dump 里只是表达式。`--profile-dir` 让检查器用该 Profile 的偏好文件求出这五项（以及 sink）自己的期望值，再逐项比对；其他插件的表达式一律不执行，仍是未解析值。**省略 `--profile-dir` 时这五项必然报 `EXPRESSION_REQUIRES_RUNTIME`**，不能据此判定配置被覆盖。

配置 dump 可能包含你其他配置中的敏感信息；仅本地保存，不外发。本检查工具不打印配置内容、不执行 `!!js`、不读账号或凭据、不运行 dsh。

返回码：`0` 表示已知配置检查通过；`2` 表示存在覆盖/缺失/未知版本；`1` 表示输入或文件不合法。**检查通过只是配置证据，不是抓包证据。**

`ctx.privacyMode.status()` 返回值还附带观察到的存活服务状态；服务未挂载与配置禁用分开报告。需要更强保证时，结合企业批准的出站控制与冷启动流量检查。

## 卸载与回退

桌面版在插件页面卸载本包；Web / 自定义 Profile 使用：

```sh
dsh plugin --profile web remove dsh-privacy-mode
```

重启 Profile。移除的是本插件包选择层，原有 Profile/Home patch 不被改写；原组合默认值自然恢复。没有“恢复整个旧文件”的覆盖操作，用户之后的其他编辑得以保留。**原来默认为开启的通道可能重新开启**；DSH Session Log 重新开启后可能补传关闭期间的本地记录。确认这一点再卸载。

## 不覆盖的边界

- 正常云模型消息、上下文、工具结果仍会传给你选的模型服务。
- 第三方插件/MCP/浏览器/子进程的网络请求、独立遥测不受本插件控制。
- 自动更新、插件市场查询、账号认证等业务网络仍保留。
- 不修改系统安全软件、EDR/DLP/MDM、防火墙、hosts 或代理。
- 不删除本地反馈与会话，不撤销已经发生的上传。
- 不保证未知新版本或自定义嵌套组合被全部覆盖。

## 开发与测试

```sh
npm ci --ignore-scripts --legacy-peer-deps
npm run check
# 真实加载验证需要已安装的、同版本官方运行时路径：
npm pack --ignore-scripts
DSH_TEST_RUNTIME=/path/to/dsh-runtime \
DSH_TEST_TARBALL="$PWD/dsh-privacy-mode-0.1.0.tgz" \
DSH_TEST_PNPM=/path/to/existing/pnpm.cjs npm run test:integration
```

集成测试只用临时 Home/Profile、合成数据和本机 HTTP 接收端；不读取真实用户登录态，不调用云模型，不更改正式 Profile。

## 贡献

欢迎提交 issue 与 PR。改配置默认值、放宽版本校验或新增通道覆盖前，请先读 `CONTRIBUTING.md` 的边界约定：本项目的结论必须可被 `bin/check.mjs` 复现，不接受「大概更安全」的改动。

详见 `ACCEPTANCE.md`、`SECURITY.md`、`CHANGELOG.md` 与 `provenance.json`。

## 选择性上报（默认全关，可逐项放开）

安装后，在 DSH 的 **设置 → 插件 → 隐私上报** 里可以看到五项开关。默认全部关闭；打开某一项表示你明确要求恢复该通道，而不是放宽整个插件的校验。

- 保存立即写盘，但**只影响下一次冷启动**。当前进程和配置热重载都不会因此打开通道，页面会显示“待重启生效”。
- 产品埋点拆成两个开关：`产品分析采集` 决定是否采集（可能读取系统与身份信息），`产品分析导出` 决定是否真的发往 OTLP 端点。只开采集、不开导出时，事件会被零传输接收器直接丢弃（不排队、不补传）。
- 页面同时显示**已保存的选择**（开关本身）、**本次启动实际生效的值**（每行下方的“本次启动”）和**当前运行态**（反馈导出模式、采集是否开启、零传输接收器是否在位）。三者不一致时以“待重启”提示，不假装已经生效。
- 审计仍然生效：如果其他 Profile/Home patch 覆盖了受保护条目，页面会列出问题码（`PRIVACY_OVERRIDE_OR_UNRESOLVED` 等），但插件不会因此让整个 DSH 启动失败——它只报告，不接管。
- 设置走宿主已鉴权的 `GET/POST /api/privacy-mode/settings`，只写 `privacy-mode/prefs.json`，绝不调用配置编辑器或热重载 Loader。并发修改会返回 `PREFS_CONFLICT`，页面重新读取最新状态而不是覆盖别人的改动；另一个保存正在进行时返回 `PREFS_BUSY`（同样 409），页面提示稍后重试并重新读取。锁文件不会自动回收（读持有者再改名或删除不是原子操作），崩溃遗留的锁需人工删除 `privacy-mode/.prefs.lock`。

**边界不变**：这是配置控制，不是抓包，也不是出站防火墙。真实 Electron 冷启动验收尚未执行；在完成之前请使用隔离 Profile，并保持全关。

### Selective reporting

After installation, **Settings → Plugins → Privacy reporting** lists the five channels. They all start off; enabling one is an explicit request to restore that channel, not a relaxation of the plugin's audit.

Saving writes the profile's `privacy-mode/prefs.json` and only affects the **next cold start** — the running process and configuration reloads never turn a channel on, and the page says so. Collection (`productAnalytics`) and export (`productExport`) are separate switches: with export off, the zero-transport sink drops collected events instead of queueing or retrying them. The page shows the saved selection (the switches), the value this boot actually applied (a “This boot” line under each row), and the live runtime state, so a pending change is never presented as active.

The audit still reports overrides (`PRIVACY_OVERRIDE_OR_UNRESOLVED` and friends) as page issues without failing the whole DSH boot. Settings travel over the Host's authenticated `GET/POST /api/privacy-mode/settings`, which only writes preferences — it never calls the config editor or hot-reloads the loader; a concurrent write returns `PREFS_CONFLICT` and the page reloads instead of overwriting, while a save already in flight returns `PREFS_BUSY` (also 409) so the page can ask for a retry. Lock files are never reclaimed automatically (reading the owner and then renaming or unlinking is not atomic); a lock left by a crash must be removed by hand at `privacy-mode/.prefs.lock`.

This is still a configuration control, not packet capture and not an egress firewall. A real Electron cold-start acceptance test has not been performed; use an isolated profile and keep every channel off until it is.
