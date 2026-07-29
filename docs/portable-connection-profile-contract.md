# 可移植连接配置合同（C-09.2）

状态：🔄 实现中  
范围：本机连接配置、固定只读能力发现；不发起 DGX 写操作，不开放浏览器 SSH。

## 首版连接方式

首版只支持已由 Windows OpenSSH 配置的 SSH 别名：用户在安装向导中选择或填写别名，例如 `dgx-home`。软件后台以固定参数调用 Windows 的 SSH 客户端；前端不接触私钥、密码或命令文本。

这样可以先兼容当前使用 SSH 别名的环境。后续可增加 UI 内的主机、用户、端口和受保护密钥选择，但必须作为独立合同扩展，不能将密码或密钥内容写入浏览器存储。

## 本机存储模型

```json
{
  "schemaVersion": 1,
  "profiles": [
    {
      "id": "opaque-id",
      "displayName": "用户可见名称",
      "transport": "openssh-alias",
      "sshAlias": "仅限安全字符的别名",
      "hostKeyFingerprint": "SHA256:... 或 null",
      "createdAt": "ISO-8601",
      "updatedAt": "ISO-8601"
    }
  ]
}
```

字段白名单拒绝 `password`、`privateKey`、`privateKeyPath`、`command`、`path`、`environment` 等任何未登记字段。文件使用原子替换写入；生产安装包将把它放在当前用户的应用数据目录，并由 Windows 权限保护。

## 当前接口与边界

- `GET /api/setup/capabilities`：已实现并实机验收，返回当前已配置连接的固定只读能力旗标；当前实测为“连接可达、监控可用、HY MT2 状态不可用、切换适配器未安装”。无配置时返回安全的 `not-configured` 状态。
- `GET /api/setup/profiles`：只返回脱敏配置元数据，且仅限本机来源。
- `POST /api/setup/profiles`：仅限本机来源，仅接受本合同的结构化资料。
- `POST /api/setup/profiles/{id}/verify`：仅限本机来源；以已保存的 OpenSSH 别名执行固定的只读能力检查并返回脱敏产品旗标。它不接收浏览器命令、主机地址、密码或密钥。

首版不自行提取或覆盖主机指纹。固定探针强制 Windows OpenSSH 使用 `StrictHostKeyChecking=yes`，只接受已有可信主机密钥，不会在验证时登记新密钥。用户填写的可选指纹仅作本机记录；后续产品化版本须新增独立的受保护指纹核验流程，不能把当前验证结果表述为指纹验证。

上述接口会与现有只读监控 API 分离，并采用本机操作者认证；LAN 查看令牌不能调用它们。
