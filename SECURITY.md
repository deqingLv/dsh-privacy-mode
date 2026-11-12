# Security boundary

This bundle sets privacy defaults for five verified official DSH rows. It is not an egress firewall, DLP product or offline mode.

- No install lifecycle scripts. No secrets, credential files, session contents or network capture are read by the plugin.
- No global HTTP/fetch monkey patches; no shell execution, port listener or system configuration changes.
- Configuration precedence is unchanged: later bundle/profile/home/argv layers can override defaults. Invalid privacy checks fail the plugin, not the entire host.
- The product sink accepts and immediately discards records; it does not queue, retain, serialize or export them. It replaces a disabled official product exporter while retaining the official disabled analytics RPC.
- Cold start after installation is the tested privacy-default boundary. Installation itself and unloading old exporters may send already authorized/queued records. Nothing retracts past transmissions.
- Uninstall restores lower configuration layers and may re-enable reporting. Session-log re-enablement can upload events recorded while disabled.
- Cloud model calls and external plugins/MCP/tools remain independent data paths. Compromised plugins run trusted host code and can bypass application defaults.
- Unsupported host versions are rejected by the manifest and runtime audit. Do not use compatibility exemptions without re-verifying the actual contract.
- Diagnostics expose fixed rule codes and row identities only. The offline checker never evaluates YAML JavaScript expressions or prints parser excerpts.

Report problems with synthetic data and exact versions; never attach real credentials or full session logs to a public issue.
