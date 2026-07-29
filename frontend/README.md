# DGX AI Control Center - 本地 UI 检测系统

基于 React + TypeScript + Vite 的前端控制台项目，用于本地管理和监控 AI 模型服务。

## 功能

- **总览 (Overview)**: 查看系统指标、模型服务状态、GPU 使用率
- **模型 (Models)**: 模型参数配置、预设管理、请求/启动级参数调整
- **请求 (Requests)**: 查看请求历史记录、状态统计
- **日志 (Logs)**: 实时日志查看、级别筛选、日志摘要
- **性能测试 (Benchmark)**: 测试模板、执行测试、结果历史
- **设置 (Settings)**: API配置、安全设置、系统偏好

## 技术栈

- React 18
- TypeScript
- Vite
- React Router DOM

## 安装

```bash
npm install
```

## 启动

```bash
# 开发服务器
npm run dev

# 生产构建
npm run build

# 预览生产构建
npm run preview

# API Client 单元测试
npm test
```

开发服务器默认运行在 `http://localhost:8501`

## 项目结构

```
src/
├── components/     # 可复用组件
├── mocks/          # 模拟数据
├── pages/          # 页面组件
├── services/       # API 服务层
└── types/          # TypeScript 类型定义
```

## 数据模式与安全边界

- 默认使用本地模拟数据，不连接真实 DGX 设备。复制 `.env.example` 为 `.env.local` 后可配置：

```env
VITE_USE_MOCK_DATA=false
VITE_API_BASE_URL=http://127.0.0.1:8501
```

- 真实模式仅调用 Codex 后端的 `GET` 只读端点；单个端点失败时，API Client 会保留最后一次有效数据并标记为过期。
- `useApiResource` 提供手动刷新和默认每 5 秒自动刷新；现有总览页也保持 5 秒轮询。
- 所有服务层写操作都返回“只读监控模式已禁用”，不会发送写请求。
- 深色主题已内置，无需额外配置
