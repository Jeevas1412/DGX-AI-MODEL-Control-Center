# DGX AI Control Center Desktop Runtime

> 运行时数据以 Electron 的 `app.getPath('userData')` 为唯一根目录；首次启动只复制已登记的历史数据，绝不删除来源或覆盖现有目标。开发态目录名称由 Electron 的应用 ID 决定，正式安装包将由产品元数据固定。

本目录是阶段 8 的 Electron 桌面运行时。它将取代开发期的“浏览器 + Vite + PowerShell”启动方式；正式安装包仍由 C-09.5 / C-11.4 完成。

## 当前已实现

- 受保护主进程：`contextIsolation: true`、`nodeIntegration: false`、sandbox 开启。
- 白名单预加载桥：只提供偏好读取/更新和运行时状态，不暴露 Node、SSH、Token、路径或任意命令。
- 关闭窗口后台常驻、托盘显示/退出、单实例锁。
- 默认通信为 renderer → typed IPC → 主进程 → application core；不启动回环 HTTP 监听，也不向 renderer 暴露 Token、Node、SSH、路径或任意命令。
- HTTP 适配器保留给未来由用户显式启用的 LAN 只读查看；它不再是桌面默认链路。
- 原子偏好存储：仅 `zh-CN` / `en-US`、`dark` / `light`、`keepRunningWhenWindowClosed`。

## 本地验证

```powershell
cd <project-root>\desktop
npm.cmd run check
npm.cmd test
```

Electron 首次运行会下载平台二进制。下载完成后，才可运行窗口与托盘 smoke test；不得通过开发 Vite 页面替代该验收。

## 打包验证

```powershell
cd <project-root>\desktop
npm.cmd run pack      # 只生成 win-unpacked 目录包
npm.cmd run dist:win  # 生成当前用户 NSIS 安装器，不执行安装
```

安装器为辅助安装模式。安装目录选择页之后会显示“创建桌面快捷方式”选项，默认勾选；取消勾选不会影响开始菜单快捷方式。更新和静默安装会保留既有快捷方式行为。

正式打包会自动构建前端、生成 Windows ICO，并将已构建前端和本机后端复制到应用资源目录。当前安装器未数字签名，Windows 可能提示未知发布者；不要把它当作已完成的发布版。

## 当前未完成

- 干净环境的安装、升级、卸载、数据保留与登录启动验收。
- Windows 通知区“打开/退出”的人工点按复验，以及正式代码签名。
