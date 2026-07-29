# 性能测试 dry-run 本机操作示例

以下是只含元数据的计划示例；不包含 prompt、端点、命令或凭据。将其保存到 `artifacts/performance-plans` 后，可调用受限脚本生成一条本机 `not-executed` 审计记录：

```json
{
  "planId": "p3-dryrun-20260720",
  "tier": "P3",
  "templateId": "p3-short-concurrency",
  "targetServices": ["nvfp4"],
  "concurrency": 10,
  "durationSeconds": 60,
  "windowStart": "2026-07-20T10:00:00.000+08:00",
  "windowEnd": "2026-07-20T10:05:00.000+08:00",
  "approvalId": "approval-20260720",
  "actor": "operator-a",
  "approver": "approver-b",
  "snapshotId": "snapshot-20260720",
  "scriptHash": "script-hash-20260720"
}
```

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\plan_performance_dry_run.ps1 `
  -PlanPath .\artifacts\performance-plans\p3-dryrun-20260720.json
```

输出只能是 `not-executed`；审计文件固定写入本机 `artifacts/performance-audits/dry-run-audit.jsonl`。该脚本不拥有真实执行能力，也不会访问 DGX。
