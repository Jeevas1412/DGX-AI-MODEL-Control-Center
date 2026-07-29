# 本机只读服务稳定性验收

适用范围：仅回环的 DGX AI Control Center 后端 `127.0.0.1:8501`。脚本只发起 `GET /api/health` 与 `GET /api/services`，不改变 DGX、本机服务或计划任务。

## 短时预检

```powershell
cd <project-root>
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\test_readonly_service_stability.ps1 -SampleCount 3 -IntervalSeconds 15
```

## 24 小时验收

每 5 分钟采样一次，共 288 次：

```powershell
cd <project-root>
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\test_readonly_service_stability.ps1 -SampleCount 288 -IntervalSeconds 300
```

如需持续写入每次采样记录，可附加 `-OutputPath .\artifacts\local-stability\stability-YYYYMMDD.jsonl`。

通过条件：每个样本均为 HTTP 200、health 为 `ok`，且 CORS 精确为 `http://127.0.0.1:5173`。任何失败将以非零退出码结束，并保留已打印的样本结果和（如指定）JSONL 日志。

## 汇总结果

在观测期间可查看部分结果：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\summarize_readonly_stability.ps1 -InputPath .\artifacts\local-stability\2026-07-19_24h-readonly-stability.jsonl
```

24 小时结束后加入 `-RequireComplete`，它会同时检查 288 个样本是否齐全且没有失败。

如需同时生成可归档的 Markdown 汇总，追加 `-ReportPath`：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\summarize_readonly_stability.ps1 `
  -InputPath .\artifacts\local-stability\on-demand-readiness-YYYYMMDD.jsonl `
  -ExpectedSamples 288 -RequireComplete `
  -ReportPath .\artifacts\local-stability\on-demand-readiness-summary.md
```

汇总会单列首检图像未就绪次数、窗口内恢复次数、最大预热尝试和可用时的实测预热耗时。旧格式 JSONL 没有实测耗时字段时会显示为空，不会伪造为 0。

## 按需图像服务的受限预热模式

默认 `-ImageWarmupSeconds 0` 保持严格可用性：任一次首检不是 `ok` 即失败。DGX 图像代理当前被明确配置为按需启动、闲置后自动释放显存；如验收目标改为“在受限窗口内恢复即就绪”，可**显式**启用预热复查：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\test_readonly_service_stability.ps1 `
  -SampleCount 288 -IntervalSeconds 300 -ImageWarmupSeconds 60 -ImageWarmupPollSeconds 5 `
  -OutputPath .\artifacts\local-stability\on-demand-readiness-YYYYMMDD.jsonl
```

该模式仍只调用本机的 `GET /api/health` 和 `GET /api/services`，并额外记录首检状态、预热尝试次数和是否恢复；它不会隐藏首检冷启动。必须以新的完整 24 小时窗口验收，不能覆盖已失败的严格窗口。

## 后台监测存活性检查

观测期间可运行以下命令，确认后台 PowerShell 进程仍存在，且 JSONL 的最后样本没有超过“采样间隔 + 宽限期”。该检查只读取本机进程元数据和 JSONL，不访问 DGX，也不会重启监测。

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\test_readonly_stability_monitor_liveness.ps1 `
  -OutputPath .\artifacts\local-stability\2026-07-19_24h-on-demand-readiness.jsonl `
  -ExpectedIntervalSeconds 300 -GraceSeconds 120
```
