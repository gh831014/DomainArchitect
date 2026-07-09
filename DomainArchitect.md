# 《领域知识工程自动化工具》部署与项目代码说明书 (DomainArchitect)

本说明书针对**领域知识工程自动化工具（英文代号：DomainArchitect）**在阿里云 Nginx 环境、Node.js 运行时及 DeepSeek 大模型驱动下的安装、配置与生产部署进行详细指导。

---

## 核心技术与持久化能力确认

### 1. 历史导出的 MD 架构规格说明书重新导入加载
* **支持状态**：**已原生支持！**
* **机制说明**：系统不仅支持在导出 Markdown 说明书时，将结构化数据以无损的 Base64 编码方式隐式嵌入在文档末尾（形如 `<!-- DOMAIN_ARCHITECT_DATA_METADATA_BASE64: ... -->`），还内置了**高度鲁棒、逐行扫描的正则语法分析器（Fallback Parser）**。即使导入完全不带 Base64 元数据的纯文本历史 Markdown 文档，系统也会智能解析并重构出：
  * **概念词典（Glossary Concepts）** 与置信度评分
  * **聚合根（Aggregate Roots）**、不变性规则与数据访问仓储模式
  * **实体与属性字段（Entities & Fields）**（含主键及类型识别）
  * **业务场景与闭环（Scenarios & Processes）**（含参与Actor、前置约束与生命周期状态流转）
  * **二级核心模块与三级业务要素（Architecture Modules & Elements）**
  * **边界对接关系（Interactions）** 与接口入站出站契约
  * **漏洞动机与探针命题验证（Hypotheses）**

### 2. 知识图谱本地持久化与单机管理能力
* **支持状态**：**已原生支持！**
* **机制说明**：系统采用 **SQLite3（配合 better-sqlite3）** 作为底层持久化引擎，所有领域图谱、业务场景、大模型运行日志等数据均保存在本地单文件数据库 `data/db.sqlite` 中。具备极高的单机管理性能和轻量化运维优势，无需额外搭建和维护繁重的关系型数据库或图数据库集群。

---

## 项目代码结构与核心架构设计

为了便于维护、修改和二次开发，以下对项目代码目录结构和核心运行流程进行深度解析：

### 1. 代码目录全景图
```text
/
├── DomainArchitect.md        # [本文件] 生产安装部署与项目代码说明书
├── package.json              # 项目配置文件，定义核心依赖（better-sqlite3, express, vite）及构建脚本
├── vite.config.ts            # Vite 配置文件，定义打包逻辑与插件生态
├── tsconfig.json             # TypeScript 编译器配置
├── server.ts                 # 全栈 Express + Vite 融合服务器入口，承载 API 路由及动态渲染中间件
├── server/
│   └── db.ts                 # 数据持久化层（基于 SQLite3 / better-sqlite3，包含表结构定义及迁移、播种数据）
├── data/                     # 数据存储目录（生产环境下由 Node 服务自动创建）
│   ├── db.sqlite             # 核心 SQLite3 单文件数据库，存储图谱数据、系统配置和迭代进度
│   └── exports/              # 物理 Markdown 导出文档存放目录
├── src/                      # 前端 React SPA 源代码
│   ├── main.tsx              # 前端页面渲染入口
│   ├── index.css             # 全局样式文件（集成 Tailwind CSS）
│   ├── App.tsx               # 领域图谱管理与大模型交互主单页（包含高抗灾可视化、图谱探索和控制中心）
│   └── types.ts              # 系统领域类型标准声明（包含域、概念、实体、聚合、场景、规则、任务定义）
└── assets/                   # 静态图片、图标与系统资产
```

### 2. 核心架构与运行原理
系统采用经典的**轻量化单机 Full-Stack 架构**设计，兼顾单机运行的便捷性与大模型处理的高吞吐量：

* **数据流向机制**：
  * **前端控制中心 (React SPA)** 收集用户建模诉求，通过 API `/api/domains`, `/api/kb_store` 等与后端交互。
  * **后端引擎 (Express)** 接收请求，将元数据实时入库至本地 **SQLite3 (better-sqlite3)**。
  * **异步推演流**：触发模型建模推演时，后端直接向 **Dual-LLM Hub** 递交推演任务，生成过程异步更新至 SQLite 中的任务状态表，前端通过轮询（Polling）保持日志同步。

* **双模大模型容灾技术 (Dual-LLM Hub)**：
  * **DeepSeek 优先驱动**：当触发复杂领域实体建模、限界上下文规划及场景时序推导时，默认调用 DeepSeek API 进行深度语义分析。
  * **Gemini 自动故障自愈 (Failover)**：若 DeepSeek API 遭遇瞬时网络波动、并发配额超限（429）或不可抗力故障，底层的 `Dual-LLM Hub` 会无缝捕获异常，并在毫秒级内自动热切换至 Google Gemini 计算节点，保证建模业务不中断。

* **Markdown 无损导出与秒级重构原理**：
  * **物理写盘**：用户在系统中所做的一切修改，在数据库更新的同时，后端会自动将结构化图谱序列化为格式优雅的 Markdown 文档并写入到 `data/exports/` 下。
  * **反序列化重导入**：导入模块采用双轨解析器。如果导入的文件末尾附带 Base64 压缩 of JSON，系统可以完美还原状态；若仅是普通手写或历史导出的 Markdown，正则降级解析器（Fallback Parser）也能按章节和关键字语义，重新拼装出核心领域构件，重新存入 SQLite。

---

## 一、 系统依赖与外部组件复用说明

在部署该系统前，请确认以下基础设施：

| 组件名称 | 推荐版本 | 说明与复用指南 |
| :--- | :--- | :--- |
| **Node.js** | v18.0.0+ | **可以复用**。若服务器上已有其他 Node.js 应用，可直接共用全局的 Node.js 环境。建议使用 `nvm` 管理版本。 |
| **Nginx** | 1.18+ (阿里云默认) | **可以复用**。可直接在现有的 Nginx 配置文件中，为域名 `pmlaogao.com` 新增对应的子路径 `location` 指向。 |
| **SQLite3 运行库**| 系统自带 | **无需独立安装**。打包编译时依赖 `better-sqlite3` 会通过 Node.js 原生二进制绑定自动创建/连接本地 `data/db.sqlite` 文件。 |
| **PM2 进程管理器**| 最新版 | **可以复用**。强烈建议安装 `npm install -g pm2`，用于守护 Node.js 后端服务。已有 PM2 实例可无缝复用。 |

---

## 二、 阿里云 Nginx 部署说明（域名子路径：`/domain-architect/`）

用户计划将系统安装在 `/usr/share/nginx/html/` 目录下，并以软件英文名 `domain-architect` 命名，最终通过 `pmlaogao.com/domain-architect/` 访问。

以下是针对此方案的**两种主流部署架构方案**，您可以根据运维习惯自由选择：

### 方案 A：全栈融合代理模式（强烈推荐）
在该模式下，Nginx 仅做反向代理，所有静态文件和 `/api` 接口均由 Express 后端服务统一处理，避免了配置繁琐的静态路径分流。

#### 1. 代码同步与构建
在阿里云服务器上执行：
```bash
# 1. 创建目标目录并同步代码
mkdir -p /usr/share/nginx/html/domain-architect
cd /usr/share/nginx/html/domain-architect

# 将项目代码上传或使用 git clone 至该目录中
# 确保在根目录下

# 2. 安装项目依赖
npm install --production=false

# 3. 编译打包项目 (React 前端与 Express 服务端)
npm run build
```

#### 2. PM2 后端进程守护
在项目根目录下，启动 Node.js 服务：
```bash
# 采用 PM2 守护进程启动后台服务 (绑定在本地 3000 端口)
pm2 start dist/server.cjs --name "domain-architect" --env NODE_ENV=production

# 保存 PM2 启动项以防止服务器重启丢失
pm2 save
```

#### 3. Nginx 子路径反向代理配置
编辑您的 Nginx 配置文件（通常位于 `/etc/nginx/nginx.conf` 或 `/etc/nginx/conf.d/pmlaogao.conf`）：

```nginx
server {
    listen 80;
    server_name pmlaogao.com;

    # 配置域名的 /domain-architect/ 子路径代理
    location /domain-architect/ {
        # 转发至本地 Node 服务端口
        proxy_pass http://127.0.0.1:3000/;
        
        # 传递客户端真实 IP 与主机头
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket 支持 (若后续扩展实时通信)
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # 调大上传限制以支持大体积 Markdown 文件导入
        client_max_body_size 50m;
    }
}
```

---

### 方案 B：动静分离部署模式
静态资源文件（React 编译结果）由 Nginx 极速托管，API 请求反向代理至 Node 服务。

#### 1. 修改构建基础路径 (Base URL)
如果使用动静分离，需要在前端打包时注入子路径前缀。在 `vite.config.ts` 中，为 `defineConfig` 配置增加 `base: '/domain-architect/'`：

```typescript
// vite.config.ts 修改示例
export default defineConfig(() => {
  return {
    base: '/domain-architect/', // 确保静态资源路径指向子路径
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    // ...
  };
});
```

#### 2. 编译并放置静态文件
```bash
# 重新编译打包静态资源
npm run build

# 此时，Vite 会在 dist/ 下生成带有 /domain-architect/ 前缀的静态资源
# 确保静态目录在 Nginx 指定的网页根目录下
```

#### 3. 启动 API 后端服务 (PM2)
```bash
pm2 start dist/server.cjs --name "domain-architect-api"
```

#### 4. Nginx 动静分离配置文件
在 Nginx 配置文件中加入如下节点：

```nginx
server {
    listen 80;
    server_name pmlaogao.com;

    # 1. 托管静态前端资源
    location /domain-architect/ {
        alias /usr/share/nginx/html/domain-architect/dist/;
        index index.html;
        try_files $uri $uri/ /domain-architect/index.html; # 支持 React 单页应用前端路由
    }

    # 2. 代理 API 请求至后台 Node 服务
    location /domain-architect/api/ {
        proxy_pass http://127.0.0.1:3000/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 50m;
    }
}
```

---

## 三、 大模型 DeepSeek V4 Pro 部署配置指引

系统底层设计了 **双大模型智能容灾架构**。默认核心推理、演绎及图谱模型推演优先调用 **DeepSeek**，并在高并发超限或接口不可用时，无缝切换至高可用辅助备份 **Google Gemini**（保证服务不中断）。

配置 DeepSeek 步骤：

1. **获取 DeepSeek API Key**：
   前往 [DeepSeek 开放平台官网](https://platform.deepseek.com/) 注册账号，充值并生成您的 API Key。

2. **配置环境变量**：
   在服务器项目根目录下创建 `.env` 文件：
   ```env
   # .env
   PORT=3000
   NODE_ENV=production
   
   # 您的 DeepSeek 官方 API 授权密钥 (必需)
   DEEPSEEK_API_KEY=sk-xxxxxxYOUR_DEEPSEEK_API_KEYxxxxxx
   
   # (可选) 若需要开启 Google Gemini 的双模容灾备份支持，可配置此项
   GEMINI_API_KEY=AIzaSyxxxxxxYOUR_GEMINI_API_KEYxxxxxx
   ```

3. **重新载入后端服务**：
   ```bash
   # 让 PM2 重新加载环境变量
   pm2 restart domain-architect --update-env
   ```

4. **验证连接**：
   启动任务后，可以在系统主界面的配置项中看到“DeepSeek (默认优先)”处于激活状态。模型推演日志中输出 `[模型计算] 启动 DeepSeek-Chat 大模型进行高维业务模型推理...` 即代表连接成功。

---

## 四、 常见问题与运维说明

1. **导入较大的 Markdown 出现 `413 Request Entity Too Large` 报错？**
   * **原因**：Nginx 默认限制客户端上传大小为 1MB。
   * **解决办法**：在 Nginx 配置文件对应的 `server` 或 `location` 中，加入 `client_max_body_size 50m;`，然后执行 `nginx -s reload`。

2. **数据备份怎么做？**
   * **方法**：由于本系统使用的是极致轻量化的 SQLite 数据库，您只需定期对 `/usr/share/nginx/html/domain-architect/data/db.sqlite` 单个文件进行冷备份或网盘异地备份即可，运维极其简便。

3. **系统性能与并发支持如何？**
   * **评估**：得益于 better-sqlite3 开启了 WAL (Write-Ahead Logging) 预写日志并发机制，单机在数千个领域实体图谱高频点对点读写时可保持接近于零的延迟，能够充分承载企业内敏捷领域设计小团队的并发协作。
