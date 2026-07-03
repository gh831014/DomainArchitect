# DomainArchitect 领域知识工程建模系统 - 安装与部署说明

本系统是一个高精度的 **双轨/单轨闭环限界上下文与领域知识工程矩阵推演平台**。支持结合学术搜索、大厂系统标准（阿里、腾讯、京东、美团、字节跳动等）对核心业务及系统架构进行深度自动化建模与探针求证。

---

## 1. 依赖环境 (System Environment Requirements)

在安直部署本项目之前，请确保您的计算设备底座配备以下基础设施：

- **操作系统 (OS)**: Linux (Ubuntu 20.04+ / CentOS 等), macOS, 或 Windows 10/11 (推荐配合 Subsystem WSL2 使用)。
- **运行时环境 (Runtime)**: **Node.js (v18 及以上推荐 / v20 LTS 最佳)** 
- **包管理工具 (Package Managers)**: **npm (v9 及以上)** 或 **yarn / pnpm**。
- **构建编译工具**: JavaScript 编译器 `esbuild` 默认内置捆绑支持，无外部 C 编译器依赖。

---

## 2. 目录结构 (Directory & Project Layout Structure)

项目采用现代 **全栈极简模块化架构 (Full-Stack Monolith with Express & Vite)**，开发期支持全自动热加载服务，生产期可完美一键打造成高密度单体：

```text
├── server/
│   └── db.ts                 # 嵌入式本地持久化数据库 (采用高吞吐 SQLITE 架构 & better-sqlite3)
├── src/                      # 核心前端单页应用程序 (React v19 + TypeScript + Vite)
│   ├── components/           # (自主扩展) UI 细颗粒度组件目录
│   ├── App.tsx               # 系统核心主干 UI (架构大盘面板, 认知推演台, 3D 黄金矩阵等)
│   ├── index.css             # 全局样式控制 (全面搭载最新 Tailwind CSS)
│   ├── main.tsx              # 前端单页代码渲染锚定入口
│   └── types.ts              # 共享类型与数据契约定义 (双轨配置、探针、演绎链)
├── assets/                   # 媒体与标志等静态资产目录
├── data/                     # SQLite 数据库持久化存储目录 (自动生成 domains.db)
├── .env.example              # 容器环境变量配制骨架模板
├── .gitignore                # 自动忽略编译产物、本地私密密钥与测试日志
├── index.html                # Vite 渲染用单一页面主骨架 
├── metadata.json             # AI Studio 系统集成与权限声明配置
├── package.json              # 平台声明文件 (定义核心微服务、高并发中间件、脚本命令与三方依赖)
├── server.ts                 # 全栈统一入口 (搭载 Vite 中间件开发服务器 & Express API 事务接口)
├── tsconfig.json             # TypeScript 项目静态类型校验规范
└── vite.config.ts            # Vite 前端高速度合并、分包及编译配置
```

---

## 3. 环境变量配制 (.env)

项目目录下附带了 `.env.example` 样例。部署前，请将其拷贝重命名为本地 `.env` 并填入相应的 API Secret Key：

```bash
cp .env.example .env
```

环境变量定义及说明：
```env
# 核心大语言模型 API 密钥 (用于领域通识推理、实体合并推理以及决策推演)
GEMINI_API_KEY="您的_Gemini_API_Key"

# 备选 DeepSeek API 密钥 (如果在系统配置中选择了 DeepSeek 大模型)
DEEPSEEK_API_KEY="您的_DeepSeek_API_Key"

# 高级学术/实时搜索引擎密钥 (强烈推荐！用于对标、常识搜索以及真实事故/合规规则校验)
TAVILY_API_KEY="您的_Tavily_API_Key"

# 服务的公开 URL (在容器托管或反向代理网关下使用，本地开发无需严格指定)
APP_URL="http://localhost:3000"
```

---

## 4. 安装与运行指令 (Installation & Run Commands)

### 步骤一：拉取并解压代码
将包含本项目的所有文件解压缩至您的干净本地工作空间文件夹内。

### 步骤二：安装核心三方依赖
在命令行中切换到项目根目录，运行命令执行安装（安装将自动匹配 `Better-SQLite3` 的二进制编译构建）：
```bash
npm install
```

### 步骤三：启动开发环境运行服务器 (Development Mode)
开发模式下，系统会在 Node.js/tsx 运行时下引导 Express 微服务启动，并通过 Vite Middleware 直接托管前端热加载更新，端口统一绑定在 `3000`：
```bash
npm run dev
```
- **访问入口**: 打开浏览器，在地址栏输入：[http://localhost:3000](http://localhost:3000)

### 步骤四：生产环境编译与启动 (Production Delivery Setup)
若需对系统进行正式上线部署或容器化打包交付，请执行生产编译脚本：
```bash
# 1. 统一构建编译：打包前端静态资产至 dist/，并使用 esbuild 极速打包融合后台 server.ts 至 dist/server.cjs
npm run build

# 2. 启动高可用独立静态生产服务
npm run start
```

---

## 5. 项目架构亮点

1. **零冷启动开销**: 采用 SQLite 嵌入式内存级高吞吐数据库作为存储底座，无需外部安装和配置大型 PostgreSQL 或 MySQL，极度适合本地及云单体容器秒级启动。
2. **严防 API 密钥泄露 (API Security Protection)**: 所有对 AI 大模型（Gemini / DeepSeek）以及学术搜索平台（Tavily）的请求，均通过 Express 后台 `/api/*` 服务进行代理。浏览器端不接触任何敏感密钥。
3. **极简运维**: 通过 `esbuild` 自动把后端 TypeScript 文件打包成了单一、自闭合、无路径依赖的 CommonJS 格式的 `dist/server.cjs` 规范。
