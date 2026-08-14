# Security Policy

## Supported versions

Security fixes are provided for the latest `main` branch and the most recent release.

## Reporting a vulnerability

Do not open a public Issue for a vulnerability. Do not include real API keys, user data, signing material, or a directly exploitable public proof of concept.

Use the repository's **Security -> Report a vulnerability** flow to contact the maintainer privately. Include the affected version, impact, minimal reproduction steps, and any proposed remediation. The maintainer will acknowledge the report as soon as practical, assess its scope, and coordinate disclosure after a fix is available.

If GitHub private vulnerability reporting is unavailable, open a public Issue without vulnerability details and ask the maintainer to provide a private contact channel.

## Security scope

Civil AI combines a local Agent runtime, model-provider adapters, imported learning material, Web research, native iOS capabilities, and local persistence. Security reports are especially useful when they concern:

- prompt injection or untrusted instructions entering through model output, imported documents, Web content, or conversation memory;
- Tool or Skill calls that bypass confirmation, authorization, ownership, idempotency, cancellation, or completion checks;
- API credentials, signing material, logs, exports, backups, or other sensitive data leaving their intended boundary;
- server-side request forgery, unsafe redirects, private-network access, or unrestricted native HTTP requests;
- path traversal, destructive file operations, unbounded document processing, or workspace and storage exhaustion;
- SQLite or IndexedDB migration, recovery, deletion, import, and export failures that can corrupt or expose learning data;
- iOS native plugins, application signing, dependency updates, GitHub Actions, or other software-supply-chain paths.

Please distinguish a reproducible security boundary failure from model-quality disagreement. Reports should use synthetic data and the smallest safe proof needed to demonstrate impact.

## 中文说明

安全修复面向最新的 `main` 分支和最新发布版本。请勿为安全漏洞创建公开 Issue，也不要公开真实 API Key、用户数据、签名材料或可直接利用的 PoC。

请优先使用仓库的 **Security -> Report a vulnerability** 功能私密报告，并提供受影响版本、影响范围、最小复现步骤和建议修复方向。如果该功能不可用，可创建不包含漏洞细节的普通 Issue，请求维护者提供私密沟通渠道。

重点安全边界包括：Prompt Injection、工具与 Skill 授权、凭证和签名材料、原生网络与 SSRF、文件和文档处理、SQLite/IndexedDB 数据治理、iOS 原生插件以及依赖和 GitHub Actions 供应链。报告请使用合成数据和最小安全复现，不要提交真实用户数据或可直接滥用的攻击材料。
