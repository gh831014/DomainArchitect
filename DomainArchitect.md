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
