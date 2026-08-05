# Changelog

## [0.2.0] - 2026-08-05

- 新增只读双节点概览（B-lite，按 Copilot 方案）：连接资料 schema 升至 v4，新增 `monitoredProfileIds`（只读监控范围），`activeProfileId` 保持单值（单机操作语义不变）。
- 后端抽取 NodeProbeService（`node-probe.mjs`）：`createNodeProbe` / `createNodeSnapshotProvider`，`Promise.allSettled` 并行探活、partial-success（单节点失败返回 200 + 节点级错误）。
- 新增只读接口：`GET /api/nodes`（四态聚合：healthy/degraded/unreachable/unknown）与 `GET /api/nodes/:profileId`（单节点快照）；总览不含完整日志。
- 新增 `emptyNodeOverview` 兜底；`server.mjs` 共享 `createSessionForProfile` 工厂，聚合与单机会话同源。
- 前端总览页新增双节点总览区块：节点卡展示 hostname / SSH 别名 / 四态徽章 / GPU / 驱动 / 统一内存 / 服务数 / 采集时间，点击卡片切换当前操作节点（`activeProfileId` 保持单值）。
- 互联层只读探针（快照新增 `interconnect`）：集群口 enp1s0f1np1 状态/MTU、RDMA link（rocep1s0f1 ACTIVE）、RoCEv2 GID idx3、RX/TX 与 error/drop 计数器、对端可达（固定 Spark 双机集群网互 ping，不做带宽测试）。
- vLLM 服务层摘要（快照新增 `vllm`）：发现 vLLM 运行时端口并做 `/healthz` + `/v1/models` 只读探活（PROCESS_UP / API_READY 分层；真实推理探针留作低频后续任务，不随前端刷新运行）。
- 本版本为开发候选，未晋级、未安装为正式版。

## [0.1.0] - 2026-07-22

- Rebased the active product and installer version on the internal-test line. This version is not a 1.0.0 release.
- Added versioned, fixed-adapter model registration and user-confirmed control flows for supported DGX services.
- Added desktop-only direct IPC, explicit DGX connection state, runtime data isolation, hardware telemetry and remote-desktop status foundations.
- Replaced the third-party router with a small internal history/hash router so the production dependency audit has no route-library findings.
- This line remains an internal candidate until the isolated Windows VM lifecycle gate and GitHub Actions artifact validation pass.

## [1.0.0-rc.19] - 2026-07-21

- Reworked the model area into a portable local model library and a separate, target-first parameter view; removed the product-facing HY MT2-specific adapter and switch narrative.
- Replaced historical benchmark presentation with portable validation templates that do not simulate results or start services.
- Reframed resource capacity, service labels, degraded status, logs and connection capability wording for a clean environment; removed the stale mock “recent errors” panel.
- Fixed connection-reverification state so the visible Chinese error still exposes the real read-only reverify action.
- Added a real packaged-desktop shortcut IPC route and clarified that the LAN token protects only an exposed LAN API.

## [1.0.0-rc.18] - 2026-07-21

- 修复固定服务控制的验证证据边界：动态监控端口状态不再使已验证的连接资料失效；固定适配器完整性仍会重新核验。
- 中文界面统一翻译服务操作计划、执行阶段、服务状态和已知后端失败；未知后端实现文本不再直接显示给用户。
- 连接资料、模型库、日志、请求、性能测试和设置页的运行时错误均改为中文安全提示；服务名称中的图像服务与兼容代理也改为中文显示。

## [1.0.0-rc.17] - 2026-07-21

- 修正 LLM 启动容量门禁：改用 DGX Linux `MemAvailable` 减系统安全余量，不再把 ComfyUI 的私有推理池当作全机 LLM 可用上限。
- 图像服务的实际占用仍单独展示，但不享有优先权且不会锁定模型控制。当前实机可安全分配约 104.9 GiB，NVFP4 的 66.9 GiB 配置预留可通过前检。

## [1.0.0-rc.16] - 2026-07-21

- 连接页改为只管理 OpenSSH 连接资料与桌面本机的 DGX 数据访问会话；移除将 NVFP4 `8091` 健康误表述为“DGX 监控连接”的能力卡。
- 模型服务健康统一在“总览”呈现，模型服务控制统一在“设置”管理；连接页不再显示或探测这些服务状态。

## [1.0.0-rc.15] - 2026-07-21

- 新增 HY MT2 服务适配器向导：先以只读方式验证 DGX 上已登记的固定适配器，再检查本机控制会话；只有两项均通过后才显示“创建计划”入口。
- 明确展示“只读验证 → 本机控制 → 二次确认”的边界；重新验证不执行模型操作，安装与页面刷新也不会启动任何模型。

## [1.0.0-rc.14] - 2026-07-21

- 更正控制优先级：移除图像服务对 LLM 操作的 UI 锁定。所有受控模型仍只可由客户端用户创建计划并二次确认后操作，绝不自动启动。

## [1.0.0-rc.13] - 2026-07-21

- 区分 Linux 系统可用内存与 ComfyUI 推理池可用内存；LLM 启动评估明确采用后者的保守安全额度。
- 图像服务运行时，UI 锁定 NVFP4/VLM 的启动和重启入口，避免生图流程期间误触发 LLM 加载。

## [1.0.0-rc.12] - 2026-07-21

- 已登记 HY MT2 现在显示受保护固定适配器 UI；本机控制会话启用时，可执行计划、二次确认、真实固定动作、状态复核与审计。

## [1.0.0-rc.11] - 2026-07-21

- 修复模型登记可见性：添加成功后立即显示反馈，并将已登记模型固定显示在发现结果之前。

## [1.0.0-rc.10] - 2026-07-21

- 修复 rc.9 打包核对发现的资源遗漏：陈旧账本锁恢复工具改由安装器 `extraResources` 显式携带，避免安装包声明与实际内容不一致。

## [1.0.0-rc.9] - 2026-07-21

- 修复旧控制账本升级：含活动租约、未知状态或不可判定旧数据时，迁移后持久化人工恢复门禁，绝不以空账本继续控制。
- 模型目录改为后端签发的短时、一次性发现结果；DGX 路径不再暴露给前端，未发现条目不能登记。
- 补齐 HY MT2 专用本地目录发现；Hugging Face 缓存使用不含路径的公开显示名和不透明目录 ID。
- 固定服务控制在计划与确认阶段执行只读部署拓扑兼容检查；不匹配即禁用控制。
- 增加带审计的陈旧账本锁人工恢复工具，安装包随附。

## [1.0.0-rc.2] - 2026-07-21

### Changed

- Removed HY MT2 trial language and capability cards from production Setup, Connection and Models user flows.
- Reframed the connection prerequisite as a remote management session, with model service control explicitly enabled from Settings.
- Kept model start, restart and stop on the existing verified-profile, capacity-preflight, explicit-confirmation and fixed-adapter control path.

## [1.0.0-rc.1] - 2026-07-21

### Added

- Version/environment isolation with distinct development, test, staging and production user-data namespaces.
- SemVer release metadata, public configuration templates and a release-manifest workflow.
- Apache-2.0 licensing for GitHub source distribution.

### Changed

- Desktop production identity now uses the production application identifier.
- Release delivery is gated by immutable artifact hashes, clean-install acceptance and manual promotion.

### Known limitations

- Windows code signing is intentionally out of scope for this GitHub-only release channel.
- This is a release candidate, not the final `1.0.0` publication.

## Unreleased

- Began public-delivery remediation following the 2026-07-20 architecture audit.
- Added public-tree exclusion rules, a denylist scanner and initial public governance documents.
- Public release remains blocked pending active-profile targeting, runtime data separation, Electron hardening, durable operations and clean-environment validation.
