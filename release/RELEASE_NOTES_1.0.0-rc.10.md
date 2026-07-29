# DGX AI Control Center 1.0.0-rc.10

候选构建日期：2026-07-21。

rc.10 包含 rc.8 严格复审后的账本迁移门禁、受验证模型目录、固定服务两阶段拓扑检查，以及实际随安装包交付的陈旧锁审计恢复工具。恢复工具位于安装目录 `resources/tools/recover-operation-ledger-lock.ps1`，仅供桌面程序已退出且人工确认后的本机恢复使用。

验收：后端 94/94、桌面 20/20、前端 85/85、前端 lint 与生产构建通过。产物 SHA-256 与边界见 `release/manifests/1.0.0-rc.10.json`。
