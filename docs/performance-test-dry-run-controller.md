# 性能测试控制器：仅本地 dry-run 原型

## 目的与边界

`backend/src/performance-test-controller.mjs` 是一个计划校验与审计原型，不是压测执行器。

- 不含网络客户端、SSH、子进程、模型请求或 DGX 写入能力。
- 不导出 `execute` 方法，唯一操作是 `dryRun(plan)`。
- 不接受 prompt、响应、端点、命令、凭据或原始日志字段。
- 可选审计存储仅接受既有的本机、追加式、`not-executed` JSONL 记录。

## 固定计划契约

计划必须同时提供：计划 ID、分级、模板 ID、精确目标服务、允许并发、时限、测试窗口、授权 ID、操作者、审批者、快照 ID 和脚本哈希。

| 分级 | 固定模板 | 精确服务 | 允许并发 | 最大时限 |
|---|---|---|---:|---:|
| P0 | `p0-short-prompt` | NVFP4 | 1 | 60 秒 |
| P1 | `p1-tool-call` | NVFP4 | 1 | 90 秒 |
| P2 | `p2-long-context-cold` / `p2-long-context-hot` | NVFP4 | 1 | 180 秒 |
| P3 | `p3-short-concurrency` | NVFP4 | 10 / 20 / 50 | 300 秒 |
| P4 | `p4-minimal-joint` | NVFP4 + VLM | 1 | 120 秒 |

任何额外字段、服务顺序变化、超限并发/时限、无效窗口或非白名单模板都会被拒绝。

## dry-run 产物

成功 dry-run 仅返回：已校验的计划、`executionAllowed=false`、`executionResult=not-executed`、脱敏审计记录和性能历史允许/禁止字段契约。它不产生性能数据，也不会写入性能历史。

未来若要增加真实执行器，必须另建经过认证的组件，并单独完成限流、取消、测试窗口、实时停止条件、DGX 契约回归和逐次授权；不得在此原型上添加隐式执行路径。
