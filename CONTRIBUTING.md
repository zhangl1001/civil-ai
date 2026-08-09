# Contributing

感谢你参与 Civil AI。

## 开始之前

1. 对较大的功能或架构调整，请先创建 Issue 说明目标、用户价值和设计边界。
2. 不要提交真实 API Key、个人学习数据、考试机构的非公开材料或无权再分发的题目。
3. 新代码应遵守 `docs/architecture-constitution.md` 和现有模块边界。

## 本地开发

```bash
npm install
cd web && npm install
npm run dev
```

## Pull Request

- 从 `main` 创建聚焦单一目标的分支。
- 为行为变化增加或更新验证脚本。
- 在提交前运行 `npm test`；如果只运行了部分检查，请在 PR 中说明。
- 清楚描述用户影响、风险、验证结果和必要的迁移步骤。
- 保持提交中不含生成产物、编辑器配置和本地签名材料。

提交贡献即表示你有权按本项目的 ISC License 提供相关内容。
