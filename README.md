# 极易合同智能脱敏系统

基于 `Tauri 2 + Vue 3 + Element Plus` 的本地化合同脱敏桌面客户端。

当前版本已经实现本地化桌面端原型，支持管理员账号登录、合同文件读取、文本脱敏、历史记录管理、个人信息维护、脱敏词库同步和成员管理，并补齐了扫描版 PDF 的本地 OCR 处理链路。

## 项目特性

- 本地账号登录
- 本地存储用户、历史记录、脱敏词库
- 支持 `PDF`、`DOC`、`DOCX` 文件读取
- 支持扫描版 PDF 的本地 OCR 识别
- 支持智能脱敏和自定义词库脱敏
- 支持原文与脱敏结果对比预览
- 支持脱敏结果按原格式归档导出
- 支持历史记录查询、查看和删除
- 支持个人资料维护与管理员成员管理

## 默认账号

- 账号：`admin`
- 密码：`123456`

## 技术栈

- `Tauri 2.x`
- `Vue 3`
- `Vite`
- `Pinia`
- `Vue Router`
- `Element Plus`
- `pdfjs-dist`
- `mammoth`
- `OCRmyPDF`（本机命令行工具，扫描 PDF OCR 兜底）
- `RapidOCR worker`（本地 Python/sidecar OCR 主链路）

## OCR 架构

当前 PDF 处理链路分为两类：

- 文本型 PDF：直接使用 `pdfjs-dist` 提取文字层，再进入现有脱敏流程
- 扫描型或混合型 PDF：优先把缺少文字层的页面渲染成图片，再交给本地 `RapidOCR worker` 做 OCR；如果 worker 暂时不可用，再回退到 `OCRmyPDF`

当前本地 OCR 设计同时兼容两种运行方式：

- 开发环境：优先使用 `/.venv-ocr-worker` 里的 Python worker 脚本
- 打包环境：优先使用随桌面应用一起分发的 `rapidocr-worker` sidecar 二进制

## 目录结构

```text
smartContract/
├── src/                   # 前端页面、路由、状态管理、工具函数
├── src-tauri/             # Tauri Rust 壳层配置
├── public/
├── package.json
├── vite.config.js
└── README.md
```

## 已实现功能

### 1. 登录

- 暂不接入企微扫码登录
- 使用本地账号密码登录
- 默认内置管理员账号
- 登录态保存到本地

### 2. 首页脱敏

- 选择并读取本地合同文件
- 自动检测 PDF 是否存在文字层
- 扫描 PDF 会优先尝试本地 OCR，再继续执行脱敏
- 支持两类脱敏方式：
  - 智能脱敏
  - 自定义脱敏词库
- 智能脱敏支持以下类别：
  - 身份证号
  - 手机号/座机
  - 邮箱
  - 银行卡号
  - 统一社会信用代码
  - 公司名称
  - 姓名标签
  - 地址文本
  - 价格金额
- 展示原文、脱敏结果、命中记录
- 支持 PDF / Word 脱敏结果归档导出

### 3. 历史记录

- 保存每次脱敏操作
- 记录操作人、时间、文件名、大小、模式、结果
- 支持按时间范围、文件名、脱敏模式筛选
- 支持查看详情、单条删除、批量删除
- 普通用户仅可查看自己的记录

### 4. 个人中心

- 编辑姓名、职位、邮箱、手机号
- 管理自己的脱敏词库
- 管理员可查看全部用户词库
- 管理员可新增成员、删除成员、设置角色
- 支持退出登录

## 本地存储说明

当前数据通过 `@tauri-apps/plugin-store` 持久化到桌面应用本地数据目录，包括：

- 当前登录用户
- 成员列表
- 脱敏历史记录
- 用户自定义脱敏词

项目没有接入服务端，也没有外部数据库。

## 开发启动

### 安装依赖

```bash
npm install
```

### 启动 Tauri 桌面端

```bash
npm run tauri dev
```

### 构建前端

```bash
npm run build
```

## RapidOCR Worker

### 1. 准备本地 worker 环境

```bash
node ./scripts/setup-ocr-worker.mjs
```

该命令会在项目根目录创建 `/.venv-ocr-worker`，并安装：

- `rapidocr_onnxruntime`
- `onnxruntime`
- `Pillow`
- `numpy`
- `pyinstaller`

完成后，开发环境下桌面应用会优先使用这个 Python worker 做扫描件 OCR。

### 2. 构建 sidecar 二进制

```bash
node ./scripts/build-ocr-worker.mjs
```

构建成功后会生成：

- macOS / Linux：`src-tauri/binaries/rapidocr-worker`
- Windows：`src-tauri/binaries/rapidocr-worker.exe`

这些文件会被 Tauri 打包流程作为应用资源带入安装包。

### 3. 当前运行优先级

- 优先使用 `RapidOCR worker`
- worker 不可用时回退到 `OCRmyPDF`
- `OCRmyPDF` 成功后会尽量补充 PDF 文字层，便于后续预览和导出

## GitHub Actions 发布

项目已经预置 GitHub Actions 工作流：

- 工作流文件：[.github/workflows/release.yml](/Users/zhangzheng/project/ecmax/smartContract/.github/workflows/release.yml)
- 触发方式：
  - 手动触发 `workflow_dispatch`
  - 推送形如 `v0.1.0` 的 Git tag

该工作流会自动构建并上传：

- macOS 安装包
- Windows 安装包

当前工作流会分别在这些原生 runner 上构建 OCR sidecar 后再执行 Tauri 打包：

- `macos-14`：Apple Silicon macOS 包
- `macos-13`：Intel macOS 包
- `windows-latest`：Windows x64 包

CI 流程会自动执行：

1. 安装 Node、Python、Rust
2. 安装前端依赖
3. 创建 `RapidOCR worker` 虚拟环境
4. 构建当前平台对应的 worker sidecar
5. 调用 `tauri-action` 生成安装包并上传 Release 草稿

推荐发布方式：

```bash
git tag v0.1.0
git push origin v0.1.0
```

推送后可在 GitHub Actions 和 Releases 页面查看构建结果。

## 运行说明

- 当前项目按桌面客户端方式运行，文件选择和结果导出使用 Tauri v2 插件
- 文件读取与保存使用 `@tauri-apps/plugin-fs` 和 `@tauri-apps/plugin-dialog`
- 本地业务数据使用 `@tauri-apps/plugin-store`
- 扫描件 PDF 会优先尝试走本地 `RapidOCR worker`
- 如果 worker 暂不可用，会自动回退到 `OCRmyPDF`
- 打包版会优先读取应用资源目录里的 `rapidocr-worker` sidecar

## 已验证内容

- `npm install`
- `npm run build`
- `cargo check`
- `node ./scripts/build-ocr-worker.mjs`
- 本地 `RapidOCR worker` 依赖安装完成，并可成功构建 macOS arm64 sidecar

## 当前限制

- 企微登录尚未实现
- `DOC` 文件目前为兼容性文本提取方案，复杂老式 Word 文档解析能力有限
- 扫描件 PDF 依赖本机已安装 `ocrmypdf`、`tesseract`、`ghostscript`，中文合同建议提供 `chi_sim` 语言包
- `RapidOCR worker` 当前本地已验证 `macOS arm64` 打包；Windows 和 Intel Mac 的 worker 将通过 GitHub Actions 在各自原生 runner 上构建
- 脱敏规则以文本正则和标签识别为主，复杂合同版式仍可继续优化
- 历史记录分页当前为前端本地分页
- 首次运行 `npm run tauri dev` 需要 Rust 能正常访问 `crates.io`
- PyInstaller 产出的 sidecar 体积较大，当前 `rapidocr-worker` 单文件大约在数十 MB 级别

## 后续可扩展方向

- 接入真实企微登录
- 增强合同结构化识别能力
- 增加规则配置中心
- 增加文件批量处理
- 支持导出为原格式文档
- 增加本地数据库存储，如 `SQLite`

## 相关文件

- 前端入口：[src/main.js](/Users/zhangzheng/project/ecmax/smartContract/src/main.js)
- 路由配置：[src/router/index.js](/Users/zhangzheng/project/ecmax/smartContract/src/router/index.js)
- 脱敏逻辑：[src/utils/desensitize.js](/Users/zhangzheng/project/ecmax/smartContract/src/utils/desensitize.js)
- 文件处理：[src/utils/file.js](/Users/zhangzheng/project/ecmax/smartContract/src/utils/file.js)
- PDF 工具：[src/utils/pdf.js](/Users/zhangzheng/project/ecmax/smartContract/src/utils/pdf.js)
- OCR 调用：[src/utils/ocr.js](/Users/zhangzheng/project/ecmax/smartContract/src/utils/ocr.js)
- 本地存储：[src/utils/storage.js](/Users/zhangzheng/project/ecmax/smartContract/src/utils/storage.js)
- OCR worker 脚本：[src-tauri/resources/ocr-worker/rapidocr_worker.py](/Users/zhangzheng/project/ecmax/smartContract/src-tauri/resources/ocr-worker/rapidocr_worker.py)
- OCR worker 构建脚本：[scripts/build-ocr-worker.mjs](/Users/zhangzheng/project/ecmax/smartContract/scripts/build-ocr-worker.mjs)
- Tauri 配置：[src-tauri/tauri.conf.json](/Users/zhangzheng/project/ecmax/smartContract/src-tauri/tauri.conf.json)
