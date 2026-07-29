# 性能历史运行时持久化与自动追加

## 已实现边界

- `GET /api/benchmarks` 仍是唯一的 API 路径；没有 POST、PUT、SSH、DGX 命令或远端写入能力。
- 已验收的 P0–P4 摘要仍内置为基线。运行时记录只写入本机 `backend/data/benchmark-history.jsonl`，每行一个 JSON 对象。
- API 每次读取历史时重新读取 JSONL，因此已成功追加的本机记录不需要重启 8501 即可显示。
- 文件缺失等价于没有新增记录；JSONL 损坏时 API 返回不可用，而不是静默忽略或编造数据。

## 自动追加契约

未来获授权的压测脚本在**完成结果落盘后**，只需调用以下本机脚本即可追加：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\append_benchmark_history.ps1 `
  -InputPath .\artifacts\benchmark-results\<result>.json
```

该入口只接受 `artifacts/benchmark-results` 下的 `.json` 文件；Node 导入器只访问该输入文件和本机 JSONL。它不创建测试流量，也不会连接或写入 DGX。

结果必须是下列紧凑、无敏感内容的对象（数值指标可为 `null`，`source` 固定为 `dgx-real`）：

```json
{
  "id": "mtp1-10-concurrency-20260719",
  "testName": "MTP 1 十并发复验",
  "timestamp": "2026-07-19T18:00:00.000+08:00",
  "successRate": 100,
  "avgTTFT": 120.4,
  "avgThroughput": 18.1,
  "p50": 900.1,
  "p95": 1300.2,
  "p99": 1400.3,
  "peakMemory": null,
  "errorCount": 0,
  "errors": [],
  "source": "dgx-real"
}
```

导入器只接受上述字段，并校验 ID、时间、数值范围、简短错误摘要和来源；拒绝重复 ID、额外字段、控制字符、`mock` 来源及损坏 JSON。请勿把提示词、令牌、主机信息或原始日志放进结果文件。

## 验证

`backend` 的 `npm.cmd test` 覆盖了追加、运行时合并、重复/不安全输入拒绝和损坏 JSONL 的失败闭合行为。
