/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { Domain, KB_Store, IterationProgress, GeneratorConfig } from '../src/types';

const DATA_DIR = path.join(process.cwd(), 'data');
const DB_SQLITE_FILE = path.join(DATA_DIR, 'db.sqlite');
const OLD_DB_JSON_FILE = path.join(DATA_DIR, 'db.json');
const EXPORTS_DIR = path.join(DATA_DIR, 'exports');

// Ensure directories exist
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(EXPORTS_DIR)) {
  fs.mkdirSync(EXPORTS_DIR, { recursive: true });
}

// Initialize SQLite Database
const sqlite = new Database(DB_SQLITE_FILE);
sqlite.pragma('journal_mode = WAL');

// Ensure tables exist
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS domains (
    id TEXT PRIMARY KEY,
    name TEXT,
    systemName TEXT,
    description TEXT,
    createdAt TEXT
  );

  CREATE TABLE IF NOT EXISTS kb_stores (
    domainId TEXT PRIMARY KEY,
    payload TEXT
  );

  CREATE TABLE IF NOT EXISTS configs (
    domainId TEXT PRIMARY KEY,
    payload TEXT
  );

  CREATE TABLE IF NOT EXISTS tasks (
    taskId TEXT PRIMARY KEY,
    domainId TEXT,
    payload TEXT
  );
`);

// Migrate from old DB JSON if it exists, or Seed standard data
function initializeDatabase() {
  const domainCount = sqlite.prepare('SELECT COUNT(*) as count FROM domains').get() as any;
  if (domainCount && domainCount.count > 0) {
    // Already initialized
    return;
  }

  // Check if old JSON file exists
  if (fs.existsSync(OLD_DB_JSON_FILE)) {
    try {
      console.log('Migrating existing database from db.json to SQLite...');
      const raw = fs.readFileSync(OLD_DB_JSON_FILE, 'utf-8');
      const data = JSON.parse(raw);

      sqlite.transaction(() => {
        // Migrate domains
        if (data.domains) {
          for (const d of Object.values(data.domains) as Domain[]) {
            sqlite.prepare('INSERT OR REPLACE INTO domains (id, name, systemName, description, createdAt) VALUES (?, ?, ?, ?, ?)').run(
              d.id, d.name, d.systemName, d.description || '', d.createdAt || new Date().toISOString()
            );
          }
        }
        // Migrate kbStores
        if (data.kbStores) {
          for (const [id, value] of Object.entries(data.kbStores)) {
            sqlite.prepare('INSERT OR REPLACE INTO kb_stores (domainId, payload) VALUES (?, ?)').run(
              id, JSON.stringify(value)
            );
            // Write initial physical Markdown exports for existing KBs
            try {
              const md = generateMarkdown(value as KB_Store);
              const filename = `${id}_${(value as KB_Store).domain.systemName.replace(/[^a-zA-Z0-9_\u4e00-\u9fa5]/g, '_')}_architecture.md`;
              fs.writeFileSync(path.join(EXPORTS_DIR, filename), md, 'utf-8');
            } catch (mdErr) {
              console.error('Failed to write migrated markdown export:', mdErr);
            }
          }
        }
        // Migrate configs
        if (data.configs) {
          for (const [id, value] of Object.entries(data.configs)) {
            sqlite.prepare('INSERT OR REPLACE INTO configs (domainId, payload) VALUES (?, ?)').run(
              id, JSON.stringify(value)
            );
          }
        }
        // Migrate tasks
        if (data.tasks) {
          for (const t of Object.values(data.tasks) as IterationProgress[]) {
            sqlite.prepare('INSERT OR REPLACE INTO tasks (taskId, domainId, payload) VALUES (?, ?, ?)').run(
              t.taskId, '', JSON.stringify(t)
            );
          }
        }
      })();

      console.log('Successfully migrated db.json into SQLite. Archiving old file to db.json.bak.');
      fs.renameSync(OLD_DB_JSON_FILE, OLD_DB_JSON_FILE + '.bak');
      return;
    } catch (err) {
      console.error('Failed to migrate db.json to SQLite. Standard seeding will be triggered instead:', err);
    }
  }

  // Seed with standard data
  console.log('Seeding SQLite database with default enterprise data...');
  const seed = getSeedDB();
  sqlite.transaction(() => {
    for (const d of Object.values(seed.domains)) {
      sqlite.prepare('INSERT OR REPLACE INTO domains (id, name, systemName, description, createdAt) VALUES (?, ?, ?, ?, ?)').run(
        d.id, d.name, d.systemName, d.description, d.createdAt
      );
    }
    for (const [id, value] of Object.entries(seed.kbStores)) {
      sqlite.prepare('INSERT OR REPLACE INTO kb_stores (domainId, payload) VALUES (?, ?)').run(
        id, JSON.stringify(value)
      );
      // Write initial physical Markdown exports
      try {
        const md = generateMarkdown(value as KB_Store);
        const filename = `${id}_${(value as KB_Store).domain.systemName.replace(/[^a-zA-Z0-9_\u4e00-\u9fa5]/g, '_')}_architecture.md`;
        fs.writeFileSync(path.join(EXPORTS_DIR, filename), md, 'utf-8');
      } catch (mdErr) {
        console.error('Failed to write seed markdown export:', mdErr);
      }
    }
    for (const [id, value] of Object.entries(seed.configs)) {
      sqlite.prepare('INSERT OR REPLACE INTO configs (domainId, payload) VALUES (?, ?)').run(
        id, JSON.stringify(value)
      );
    }
    for (const [id, value] of Object.entries(seed.tasks)) {
      sqlite.prepare('INSERT OR REPLACE INTO tasks (taskId, domainId, payload) VALUES (?, ?, ?)').run(
        id, '', JSON.stringify(value)
      );
    }
  })();
}

// Expose helper API methods
export const db = {
  getDomains(): Domain[] {
    initializeDatabase();
    try {
      const rows = sqlite.prepare('SELECT id, name, systemName, description, createdAt FROM domains ORDER BY createdAt DESC').all() as any[];
      return rows.map(r => ({
        id: r.id,
        name: r.name,
        systemName: r.systemName,
        description: r.description || '',
        createdAt: r.createdAt
      }));
    } catch (err) {
      console.error('Failed to query domains:', err);
      return [];
    }
  },

  getDomainKB(domainId: string): KB_Store | undefined {
    initializeDatabase();
    try {
      const row = sqlite.prepare('SELECT payload FROM kb_stores WHERE domainId = ?').get(domainId) as any;
      if (!row) return undefined;
      return JSON.parse(row.payload) as KB_Store;
    } catch (err) {
      console.error('Failed to get domain KB:', err);
      return undefined;
    }
  },

  getDomainConfig(domainId: string): GeneratorConfig | undefined {
    initializeDatabase();
    try {
      const row = sqlite.prepare('SELECT payload FROM configs WHERE domainId = ?').get(domainId) as any;
      if (!row) return undefined;
      return JSON.parse(row.payload) as GeneratorConfig;
    } catch (err) {
      console.error('Failed to get domain config:', err);
      return undefined;
    }
  },

  saveDomainConfig(domainId: string, config: GeneratorConfig): void {
    initializeDatabase();
    try {
      sqlite.prepare(`
        INSERT INTO configs (domainId, payload)
        VALUES (?, ?)
        ON CONFLICT(domainId) DO UPDATE SET payload = excluded.payload
      `).run(domainId, JSON.stringify(config));
    } catch (err) {
      console.error('Failed to save domain config:', err);
    }
  },

  saveDomainKB(domainId: string, store: KB_Store): void {
    initializeDatabase();
    try {
      sqlite.transaction(() => {
        // Save domain basic info too, in case elements of it changed
        sqlite.prepare(`
          INSERT INTO domains (id, name, systemName, description, createdAt)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET name = excluded.name, systemName = excluded.systemName, description = excluded.description
        `).run(
          store.domain.id,
          store.domain.name,
          store.domain.systemName,
          store.domain.description || '',
          store.domain.createdAt || new Date().toISOString()
        );

        sqlite.prepare(`
          INSERT INTO kb_stores (domainId, payload)
          VALUES (?, ?)
          ON CONFLICT(domainId) DO UPDATE SET payload = excluded.payload
        `).run(domainId, JSON.stringify(store));
      })();

      // PHYSICAL MD PERSISTENCE: Write generated markdown to /data/exports/
      try {
        const md = generateMarkdown(store);
        const filename = `${domainId}_${store.domain.systemName.replace(/[^a-zA-Z0-9_\u4e00-\u9fa5]/g, '_')}_architecture.md`;
        const filePath = path.join(EXPORTS_DIR, filename);
        fs.writeFileSync(filePath, md, 'utf-8');
        console.log(`Successfully persisted physical markdown file: ${filePath}`);
      } catch (mdErr) {
        console.error('Failed to write physical markdown file:', mdErr);
      }
    } catch (err) {
      console.error('Failed to save domain KB:', err);
    }
  },

  createDomain(name: string, systemName: string, description: string): Domain {
    initializeDatabase();
    const id = 'domain_' + Math.random().toString(36).substring(2, 11);
    const newDomain: Domain = {
      id,
      name,
      systemName,
      description,
      createdAt: new Date().toISOString(),
    };

    const newKB: KB_Store = {
      domain: newDomain,
      concepts: [],
      entities: [],
      aggregates: [],
      scenarios: [],
      processes: [],
      rules: [],
      hypotheses: [],
    };

    const newConfig: GeneratorConfig = {
      domain: name,
      systemName,
      focusType: 'none',
      focusName: '',
      targetLevel: 'standard',
      industryBenchmarks: {
        enabled: true,
        sources: ['阿里1688企业采购平台', '京东企业购供应链模型', '美团商企通', '字节跳动火山引擎企业服务', 'SAP Ariba', 'Salesforce'],
      },
      capabilityMatrix: {
        execution: { required: true, weight: 0.4 },
        supervision: { required: true, weight: 0.4 },
        statistics: { required: true, weight: 0.2 },
      },
      iteration: {
        maxRounds: 4,
        completenessThreshold: 0.85,
        perRoundMaxHypotheses: 3,
      },
      preferredModel: 'deepseek',
      referenceArch: {
        companyArchitecture: '',
        productArchitecture: '',
        keyDirections: '',
      },
    };

    try {
      sqlite.transaction(() => {
        sqlite.prepare('INSERT INTO domains (id, name, systemName, description, createdAt) VALUES (?, ?, ?, ?, ?)').run(
          newDomain.id,
          newDomain.name,
          newDomain.systemName,
          newDomain.description,
          newDomain.createdAt
        );
        sqlite.prepare('INSERT INTO kb_stores (domainId, payload) VALUES (?, ?)').run(id, JSON.stringify(newKB));
        sqlite.prepare('INSERT INTO configs (domainId, payload) VALUES (?, ?)').run(id, JSON.stringify(newConfig));
      })();

      // PHYSICAL MD PERSISTENCE: Write generated markdown to /data/exports/
      try {
        const md = generateMarkdown(newKB);
        const filename = `${id}_${systemName.replace(/[^a-zA-Z0-9_\u4e00-\u9fa5]/g, '_')}_architecture.md`;
        const filePath = path.join(EXPORTS_DIR, filename);
        fs.writeFileSync(filePath, md, 'utf-8');
      } catch (mdErr) {
        console.error('Failed to write physical markdown file for new domain:', mdErr);
      }
    } catch (err) {
      console.error('Failed to create domain:', err);
    }

    return newDomain;
  },

  deleteDomain(domainId: string): void {
    initializeDatabase();
    try {
      // Get domain name to delete its tasks
      const dRow = sqlite.prepare('SELECT name FROM domains WHERE id = ?').get(domainId) as any;
      const dName = dRow?.name;

      sqlite.transaction(() => {
        sqlite.prepare('DELETE FROM domains WHERE id = ?').run(domainId);
        sqlite.prepare('DELETE FROM kb_stores WHERE domainId = ?').run(domainId);
        sqlite.prepare('DELETE FROM configs WHERE domainId = ?').run(domainId);

        if (dName) {
          // Find and delete tasks
          const tasksRows = sqlite.prepare('SELECT taskId, payload FROM tasks').all() as any[];
          for (const row of tasksRows) {
            try {
              const taskObj = JSON.parse(row.payload) as IterationProgress;
              if (taskObj.domainName === dName) {
                sqlite.prepare('DELETE FROM tasks WHERE taskId = ?').run(row.taskId);
              }
            } catch (e) {}
          }
        }
      })();

      // Delete physical markdown file
      try {
        const files = fs.readdirSync(EXPORTS_DIR);
        for (const file of files) {
          if (file.startsWith(domainId)) {
            fs.unlinkSync(path.join(EXPORTS_DIR, file));
          }
        }
      } catch (e) {
        console.error('Failed to remove physical files:', e);
      }
    } catch (err) {
      console.error('Failed to delete domain:', err);
    }
  },

  getTasks(): IterationProgress[] {
    initializeDatabase();
    try {
      const rows = sqlite.prepare('SELECT payload FROM tasks').all() as any[];
      return rows.map(r => JSON.parse(r.payload) as IterationProgress);
    } catch (err) {
      console.error('Failed to query tasks:', err);
      return [];
    }
  },

  getTask(taskId: string): IterationProgress | undefined {
    initializeDatabase();
    try {
      const row = sqlite.prepare('SELECT payload FROM tasks WHERE taskId = ?').get(taskId) as any;
      if (!row) return undefined;
      return JSON.parse(row.payload) as IterationProgress;
    } catch (err) {
      console.error('Failed to query single task:', err);
      return undefined;
    }
  },

  saveTask(task: IterationProgress): void {
    initializeDatabase();
    try {
      sqlite.prepare(`
        INSERT INTO tasks (taskId, domainId, payload)
        VALUES (?, ?, ?)
        ON CONFLICT(taskId) DO UPDATE SET payload = excluded.payload
      `).run(task.taskId, '', JSON.stringify(task));
    } catch (err) {
      console.error('Failed to save task:', err);
    }
  },

  createTask(domainId: string): IterationProgress {
    initializeDatabase();
    try {
      const dRow = sqlite.prepare('SELECT name FROM domains WHERE id = ?').get(domainId) as any;
      const dName = dRow ? dRow.name : 'Unknown';

      const configRow = sqlite.prepare('SELECT payload FROM configs WHERE domainId = ?').get(domainId) as any;
      let maxRounds = 5;
      if (configRow) {
        try {
          const cfg = JSON.parse(configRow.payload) as GeneratorConfig;
          maxRounds = cfg.iteration.maxRounds || 5;
        } catch (e) {}
      }

      const taskId = 'task_' + Math.random().toString(36).substring(2, 11);
      const newTask: IterationProgress = {
        taskId,
        domainName: dName,
        status: 'idle',
        currentRound: 0,
        maxRounds: maxRounds,
        completeness: 0,
        message: '任务已创建，等待启动',
        logs: [{ timestamp: new Date().toISOString(), message: '任务创建成功。', type: 'info' }],
      };

      sqlite.prepare('INSERT INTO tasks (taskId, domainId, payload) VALUES (?, ?, ?)').run(taskId, domainId, JSON.stringify(newTask));
      return newTask;
    } catch (err: any) {
      console.error('Failed to create task:', err);
      throw err;
    }
  },
};

// Seeding standard data
function getSeedDB() {
  const domainId = 'domain_srm_pro';
  const domain: Domain = {
    id: domainId,
    name: '企业采购管理系统',
    systemName: 'SRM Pro',
    description: '一个标准的企业级供应商关系管理与智能采购协同平台，覆盖从采购申请、询价比价、订单下发到入库账期管理的完整价值链。',
    createdAt: new Date().toISOString(),
  };

  const config: GeneratorConfig = {
    domain: domain.name,
    systemName: domain.systemName,
    focusType: 'aggregate_root',
    focusName: '采购订单',
    targetLevel: 'enterprise',
    industryBenchmarks: {
      enabled: true,
      sources: ['阿里1688企业采购平台', '京东企业购供应链模型', '美团商企通', '字节跳动火山引擎企业服务', 'SAP Ariba', 'Salesforce'],
    },
    capabilityMatrix: {
      execution: { required: true, weight: 0.4 },
      supervision: { required: true, weight: 0.4 },
      statistics: { required: true, weight: 0.2 },
    },
    iteration: {
      maxRounds: 5,
      completenessThreshold: 0.85,
      perRoundMaxHypotheses: 3,
    },
    preferredModel: 'deepseek',
  };

  const seedKB: KB_Store = {
    domain,
    concepts: [
      {
        id: 'c_po',
        domainId,
        name: '采购订单(Purchase Order)',
        definition: '企业买方向供方发出的商业文件，指出采购的数量、约定单价等，作为双方约束合同的主要执行凭证。符合阿里巴巴1688企业采购与京东大客户业务规范。',
        attributes: ['订单编号', '供应商信息', '交货日期', '总账科目', '付款条件'],
        confidence: 0.95,
        sourceUrl: 'https://b.1688.com/',
        treeType: 'system',
        conceptType: 'system_concept',
        sources: [
          {
            title: '阿里巴巴1688大型企业数字化采购规范',
            url: 'https://b.1688.com/',
            snippet: '采购订单（PO）是建立数字化连接与结算的重要凭证，包含完整的财务预算科目关联与采购合规流。'
          }
        ]
      },
      {
        id: 'c_pr',
        domainId,
        name: '采购申请(Purchase Requisition)',
        definition: '企业内部部门向采购部申请购买商品或服务的内部电子请求，对标美团商企通预算与美团企业消费控制级闭环体系。',
        attributes: ['申请部门', '物料类型', '预估单价', '预算编号', '审批级别'],
        confidence: 0.92,
        sourceUrl: 'https://b.meituan.com/',
        treeType: 'system',
        conceptType: 'system_concept',
        sources: [
          {
            title: '美团商企通企业消费与费控白皮书',
            url: 'https://b.meituan.com/',
            snippet: '通过企业内采购请求与审批限制不当支出，是大型企业费用管控和数字化财税流程的起点。'
          }
        ]
      },
      {
        id: 'c_ind_gen',
        domainId,
        name: '供应链下钻-生鲜生鲜冷链采购 (Cold-Chain Fast-moving Food Sourcing)',
        definition: '零售行业的子行业生鲜零售在采购协同中所需遵循的冷链流转通识。冷链物流要求在特定温区持续存储与交付，涉及温控合规资质审核与动态承运交接标准流程。',
        attributes: ['预冷温区', '承运商冷链资质', '在途温度监控频率', '生鲜腐损率限制'],
        confidence: 0.90,
        sourceUrl: 'https://www.sap.com/products/scm/ariba.html',
        treeType: 'industry',
        conceptType: 'industry_general',
        sources: [
          {
            title: 'SAP Ariba 全球食品与生鲜零售供应链合规指南',
            url: 'https://www.sap.com/products/scm/ariba.html',
            snippet: '针对生鲜食品等特殊下钻子行业，采购结算流必须深度集成第三方冷链物流的温度轨迹节点审核，作为质量确认的前置条件。'
          }
        ]
      },
      {
        id: 'c_ind_rule',
        domainId,
        name: '两票制数字化流向合规追溯准则 (Two-Ticket Pharma Regulation Standard)',
        definition: '医药零售、器械分销等特定敏感子行业高标准合规中的典型SOP规则。从生产厂家到流通企业开一次发票，再到公立医疗机构、门店开一次发票，供应链全程严密核对发票及销售凭证的一致性。',
        attributes: ['一票开票方', '二票开票方', '两票一致合规率', '随货同行单'],
        confidence: 0.94,
        sourceUrl: 'https://www.oracle.com/industries/life-sciences/',
        treeType: 'industry',
        conceptType: 'industry_rule',
        sources: [
          {
            title: '医药零售与供应链GSP合规白皮书',
            url: 'https://www.oracle.com/industries/life-sciences/',
            snippet: '两票制 SOP 包含出库发票校验、同行单拍照归档、以及向国家药品监督管理平台的数字化合规报送。'
          }
        ]
      },
      {
        id: 'c_ind_pain',
        domainId,
        name: '溯源码出库及批次校验纠纷 (Traceability Code Lot Check Mechanism)',
        definition: '解决医药零售和高精尖零售商品等“药品溯源”和“效期纠纷”痛点场景的核心手段。由于药品防伪标签一物一码的高敏感性，门店出库时需物理验证每一盒随货溯源码的有效性，防止串货、水货、假药或临近效期药混入。',
        attributes: ['溯源码格式校验', '批次效期预警红线', '门店出库扫码成功率', '异常抽检退票率'],
        confidence: 0.95,
        sourceUrl: 'https://b.1688.com/',
        treeType: 'industry',
        conceptType: 'industry_pain_point',
        sources: [
          {
            title: '国家智慧监管药品电子溯源标准体系',
            url: 'https://b.1688.com/',
            snippet: '面向零售门店的终端零售，药品溯源码在出库、返仓时的多重扫码与追溯审计是行业防范假冒伪劣的核心痛点场景。'
          }
        ]
      }
    ],
    entities: [
      {
        id: 'e_po_head',
        domainId,
        aggregateRootId: 'ar_po',
        name: '采购订单头 (Order Header)',
        fields: [
          { name: 'orderId', type: 'String', description: '唯一订单标示', isIdentifier: true },
          { name: 'supplierId', type: 'String', description: '供应商ID', isIdentifier: false },
          { name: 'totalAmount', type: 'Decimal', description: '订单总金额', isIdentifier: false },
          { name: 'status', type: 'Enum', description: '草稿|待批|未发|执行|完成', isIdentifier: false }
        ]
      },
      {
        id: 'e_po_item',
        domainId,
        aggregateRootId: 'ar_po',
        name: '采购订单行 (Order Item Line)',
        fields: [
          { name: 'lineNum', type: 'Integer', description: '项次行号', isIdentifier: true },
          { name: 'materialCode', type: 'String', description: '物料或服务编码', isIdentifier: false },
          { name: 'quantity', type: 'Decimal', description: '采购数量', isIdentifier: false },
          { name: 'price', type: 'Decimal', description: '单价', isIdentifier: false }
        ]
      }
    ],
    aggregates: [
      {
        id: 'ar_po',
        domainId,
        name: '采购订单聚合根 (PurchaseOrder)',
        invariants: [
          '订单总金额必须等于所有订单行单价乘以数量的总和',
          '已付款金额不能大于订单总金额',
          '生效状态订单不可包含负数金额行'
        ],
        repository: 'PurchaseOrderRepository',
        capExecution: true,
        capSupervision: true,
        capStatistics: true,
      }
    ],
    scenarios: [
      {
        id: 's_po_create',
        aggregateRootId: 'ar_po',
        name: '采购员下达采购订单',
        capabilityDimension: 'execution',
        actors: ['采购员', '供应商协同端'],
        preconditions: ['采购申请(PR)已审批通过', '物料行配额与价格字典生效'],
        steps: [
          '采购员载入已审批PR行生成订单草稿',
          '系统关联对应供应商及贸易通道、自动回填价格',
          '采购员核对交期与税率，一键提审或自动下发'
        ],
        exceptionHandling: ['若价格已失效，提示价格协议超期，冻结下发并推荐进入临时比价流程。']
      },
      {
        id: 's_po_approve',
        aggregateRootId: 'ar_po',
        name: '采购订单多级预警审批',
        capabilityDimension: 'supervision',
        actors: ['部门主管', '财务总监', '合规中心'],
        preconditions: ['订单进入“待审批”状态', '相关主体额度在预算红线内'],
        steps: [
          '规则引擎按订单总额（大额触发总裁审批）与偏账预警分转相应流',
          '审批人在审批端查看该订单比价背书与执行偏差度',
          '审批人点击通过，订单状态标志位变更为“已审批未下发”'
        ],
        exceptionHandling: ['若主管在48h内未批，系统启动逾期邮件催办或代办自动挂起。']
      },
      {
        id: 's_po_analysis',
        aggregateRootId: 'ar_po',
        name: '采购订单执行率与资金计划分析',
        capabilityDimension: 'statistics',
        actors: ['采购总监', 'CFO'],
        preconditions: ['分析周期内已有历史执行数据'],
        steps: [
          '抽取一段时间内生效订单总金额、供应商履约及按期入库占比',
          '按部门与采购类别汇聚计算订单转化率',
          '输出未来三个月根据交货 and 账期计算的采购资金应付流动预测看盘'
        ],
        exceptionHandling: ['源数据空缺时，给出默认统计置信度为0的标识，提醒用户维护期初值。']
      }
    ],
    processes: [
      {
        id: 'p_po_lifecycle',
        scenarioId: 's_po_create',
        name: '采购订单全生命周期闭环流程',
        steps: [
          '采购员创建订单草稿 (Draft)',
          '提审并核准 (Approved)',
          '下发并发送给供应商接单确认 (Acknowledged)',
          '供应商分批发货入库 (Partially Received / Received)',
          '财务对账三单匹配 (Invoice Matched)',
          '清算付款结案 (Closed)'
        ],
        normalFlow: [
          '草稿 -> 提审 -> 审批通过 -> 发放供应商 -> 全额入库 -> 对账确认 -> 完成付款'
        ],
        alternateFlow: [
          '供应商拒签 -> 撤回并允许采购员修改数量交期后重新提审下发',
          '入库发生品质异常 -> 挂起异常流程，启动退货或拒付差额对账单'
        ]
      }
    ],
    rules: [
      {
        id: 'rl_po_1',
        aggregateRootId: 'ar_po',
        name: '分合单拼盘折扣规则',
        rule: '在相同自然日内，流向同一家供应商的相同类目订单行总和超过50万元，系统强制重构获取拼单特惠折扣，节省物流摊派。',
        implementationHint: '在 OrderDraftService 中加入 PreSubmitInterceptor，通过供应商ID聚集物料行判断限额，返写优惠金额项。'
      }
    ],
    hypotheses: [
      {
        id: 'h_s_1',
        domainId,
        statement: '采购订单必须有“收货单(Goods Receipt)”与“发票(Invoice)”的三单匹配(Three-Way Matching)监督机制。',
        type: 'best_practice_gap',
        status: 'verified',
        confidence: 0.94,
        reason: '对标美团商企通、阿里1688企业数字化采购规范及京东企业购供应链模型，三单匹配（订单、收货单、供应商发票）是保障大中型企业采购预算扣减合规及账期清算正确的核心控制规范。',
        createdAt: new Date().toISOString(),
        verifiedAt: new Date().toISOString(),
        sources: [
          {
            title: '阿里巴巴大客户数字化采购与财务对账机制',
            url: 'https://b.1688.com/',
            snippet: '三单匹配比对逻辑能自动比对采购订单量、实际入库数量及开票金额，确保大型集团每笔资金流出的合规性。'
          }
        ]
      }
    ],
    modules: [
      {
        id: 'm_price_engine',
        domainId,
        aggregateRootId: 'ar_po',
        name: '智能采购核算与比价引擎',
        capabilityType: 'engine',
        description: '负责核心订单物料的价格汇总、全网智能询价比价及阶梯采购折扣批处理计算。'
      },
      {
        id: 'm_config_ctr',
        domainId,
        aggregateRootId: 'ar_po',
        name: '采购合同与预算配置中心',
        capabilityType: 'config_center',
        description: '集中控管各大供应商协议起止期、各层级交易条款、部门主管可支用采购预算与动态审计额度划线。'
      },
      {
        id: 'm_doc_mgmt',
        domainId,
        aggregateRootId: 'ar_po',
        name: '采购单据生命周期协同中心',
        capabilityType: 'document_mgmt',
        description: '对接及协同内部采购申请单(PR)、采购订单(PO)和入库单(GR)的状态，并管理各对账结算单。'
      }
    ],
    elements: [
      {
        id: 'el_step_calc',
        domainId,
        moduleId: 'm_price_engine',
        name: '拼单大额阶梯计费与折扣扣减算法',
        type: 'calculation_logic',
        detail: '在相同触发日内若多单向同一合作商采购相同品类超过50万元，引擎自动启动拼盘特惠计重公式拉低总价。'
      },
      {
        id: 'el_triple_check',
        domainId,
        moduleId: 'm_doc_mgmt',
        name: '订单量、入库数与发票额（三单比对）自动化对齐流程',
        type: 'sub_process',
        detail: '清算开始时，系统将主动对比订单总数量明细、入库实收数明细和供应商入账发票。三项完全一致才触发结案并允许支付。'
      },
      {
        id: 'el_budget_node',
        domainId,
        moduleId: 'm_config_ctr',
        name: '采购预算消耗阀值触红监督节点',
        type: 'lifecycle_node',
        detail: '实时盘点待审单与已签合同流。当逼近该年度部门预算额度上限达80%时触发警报，达95%时拒绝该流程提审并强制升级到CFO会签。'
      }
    ],
    interactions: [
      {
        id: 'i_erp_pr',
        domainId,
        systemName: 'SAP ERP 系统',
        direction: 'upstream',
        targetModuleId: 'm_doc_mgmt',
        coreWorkflow: '采购申请计划(PR)及预算大盘同步',
        interfaceLogic: '通过RFC中间件或者WebHook实时调用，定时将ERP端核决通过的产品请购明细，拉取转换到SRM的草稿库，进行供应链比价比选。'
      },
      {
        id: 'i_fin_pay',
        domainId,
        systemName: '企业共享财金系统',
        direction: 'downstream',
        targetModuleId: 'm_price_engine',
        coreWorkflow: '采购款项支付及到账状态状态回写',
        interfaceLogic: '当三单一致过账完成后，SRM下达一键支付API到财金共享接口（支持银行加密直联）。财金付款就绪后回调该接口返还支付成功标识并结案。'
      }
    ]
  };

  return {
    domains: { [domainId]: domain },
    kbStores: { [domainId]: seedKB },
    tasks: {},
    configs: { [domainId]: config }
  };
}

// Helper to calculate score of KB_Store completeness
function calculateCompleteness(kb: KB_Store, config: GeneratorConfig): number {
  if (kb.aggregates.length === 0) return 0.2;

  let totalPoints = 0;
  let earnedPoints = 0;

  const weights = config.capabilityMatrix || {
    execution: { required: true, weight: 0.4 },
    supervision: { required: true, weight: 0.4 },
    statistics: { required: true, weight: 0.2 }
  };

  for (const ar of kb.aggregates) {
    totalPoints += (weights.execution.weight + weights.supervision.weight + weights.statistics.weight);
    if (ar.capExecution) earnedPoints += weights.execution.weight;
    if (ar.capSupervision) earnedPoints += weights.supervision.weight;
    if (ar.capStatistics) earnedPoints += weights.statistics.weight;
  }

  const dimensionScore = totalPoints > 0 ? (earnedPoints / totalPoints) : 0.5;

  const conceptWeight = Math.min(kb.concepts.length / 5, 1.0) * 0.1;
  const entityWeight = Math.min(kb.entities.length / 8, 1.0) * 0.1;
  const processWeight = Math.min(kb.processes.length / 3, 1.0) * 0.1;
  const rulesWeight = Math.min(kb.rules.length / 3, 1.0) * 0.1;

  const rawCompleteness = (dimensionScore * 0.6) + conceptWeight + entityWeight + processWeight + rulesWeight;
  return Math.min(Math.max(rawCompleteness, 0.2), 1.0);
}

// Markdown Formatter for exporting .md file
function generateMarkdown(kb: KB_Store): string {
  const dummyCfg: GeneratorConfig = {
    domain: '',
    systemName: '',
    focusType: 'none',
    focusName: '',
    targetLevel: 'standard',
    industryBenchmarks: { enabled: true, sources: [] },
    capabilityMatrix: {
      execution: { required: true, weight: 0.4 },
      supervision: { required: true, weight: 0.4 },
      statistics: { required: true, weight: 0.2 }
    },
    iteration: { maxRounds: 5, completenessThreshold: 0.85, perRoundMaxHypotheses: 3 }
  };
  const score = calculateCompleteness(kb, dummyCfg);
  let md = '';
  md += `# 《${kb.domain.name}》系统架构与领域模型规格说明书\n\n`;
  md += `> 本规格说明书由 **领域知识工程自动化建模引擎** (DomainArchitect Engine) 通过“假设-迭代-逻辑推演-多维校验”循环推理校验生成。\n`;
  md += `> 建模标杆对标：阿里巴巴1688企业采购、京东数字化供应链、美团商企通、SAP Ariba、Salesforce等行业旗舰标准。\n`;
  md += `> 生成时间: ${new Date().toLocaleDateString()} | 完备度评级约: ${(score * 100).toFixed(0)}%\n\n`;

  md += `## 1. 领域全局概述 (Executive Overview)\n\n`;
  md += `**目标领域**：${kb.domain.name}\n\n`;
  md += `**系统名称**：${kb.domain.systemName}\n\n`;
  md += `**业务特征简述**：${kb.domain.description}\n\n`;

  md += `## 2. 核心通用语意字典词表 (Domain Glossary)\n\n`;
  if (kb.concepts.length === 0) {
    md += `*暂无解析词表数据.*\n\n`;
  } else {
    for (const c of kb.concepts) {
      md += `### ✦ 术语：${c.name}\n`;
      md += `- **标准定义**：${c.definition}\n`;
      md += `- **核心词表属性特征**：${c.attributes.join(', ') || '根据上下文推演'}\n`;
      md += `- **建模置信度评估评分**：${(c.confidence * 100).toFixed(0)}%\n`;
      if (c.sourceUrl) {
        md += `- **最佳实践对标依据引用**：[查看参考源链接](${c.sourceUrl})\n`;
      }
      md += `\n`;
    }
  }

  md += `## 3. 聚合根与边界上下文设计 (Aggregate Roots & Context Bounds)\n\n`;
  if (kb.aggregates.length === 0) {
    md += `*暂无核心聚合根定义.*\n\n`;
  } else {
    for (const ar of kb.aggregates) {
      md += `### ✦ 聚合根: ${ar.name}\n`;
      md += `> 作为事务一致性保障边界与持久化数据交互中心。\n\n`;
      md += `- **不变性检查机制约束 (Business Invariants)**:\n`;
      for (const inv of ar.invariants) {
        md += `  - *规则*：${inv}\n`;
      }
      if (ar.invariants.length === 0) {
        md += `  - 内部无显式约束，通过领域服务校验。\n`;
      }
      md += `- **数据访问仓储模式**：\`${ar.repository}\`\n`;
      md += `- **三维治理覆盖矩阵**：\n`;
      md += `  - **[执行维度]**：${ar.capExecution ? '✅ 完整覆盖 (操作流、事务性实体建模就绪)' : '❌ 未完备'}\n`;
      md += `  - **[监管维度]**：${ar.capSupervision ? '✅ 完整覆盖 (风控审批、预警校验、合规检查已落实)' : '❌ 未完备'}\n`;
      md += `  - **[统计维度]**：${ar.capStatistics ? '✅ 完整覆盖 (BI看板、应付预测、履约分析模型已配置)' : '❌ 未完备'}\n`;
      md += `\n`;

      const boundEntities = kb.entities.filter(e => e.aggregateRootId === ar.id);
      md += `#### 3.1 内部包含子主实体和值对象 (Internal Entities & Value Objects)\n\n`;
      if (boundEntities.length === 0) {
        md += `*该聚合未对外暴露复杂的子级实体关系，属于单一充血模型。*\n\n`;
      } else {
        for (const ent of boundEntities) {
          md += `* 包含实体：**${ent.name}**\n`;
          md += `  | 字段名 | 强类型数据格式 | 核心业务职责定义与描述 | 唯一主键标志 |\n`;
          md += `  | :--- | :--- | :--- | :---: |\n`;
          for (const fd of ent.fields) {
            md += `  | \`${fd.name}\` | \`${fd.type}\` | ${fd.description} | ${fd.isIdentifier ? '🔑' : ''} |\n`;
          }
          md += `\n`;
        }
      }

      const boundScenarios = kb.scenarios.filter(s => s.aggregateRootId === ar.id);
      md += `#### 3.2 覆盖业务应用场景及多维能力定义 (Capability Scenarios)\n\n`;
      if (boundScenarios.length === 0) {
        md += `*暂无场景定义.*\n\n`;
      } else {
        for (const sc of boundScenarios) {
          const dimLabel = sc.capabilityDimension === 'execution' ? '执行操作维度(Execution)' : 
                           sc.capabilityDimension === 'supervision' ? '监管审批/风控维度(Supervision)' : '汇总统计析/决策BI维度(Statistics)';
          md += `##### ➢ 场景：${sc.name} [等级：${dimLabel}]\n`;
          md += `- **参与Actor业务角色**：${sc.actors.join(', ') || '默认外部服务'}\n`;
          md += `- **契约前置约束**：${sc.preconditions.join('，') || '无'}\n`;
          md += `- **交互操作执行序列**：\n`;
          sc.steps.forEach((st, idx) => {
            md += `  ${idx + 1}. ${st}\n`;
          });
          if (sc.exceptionHandling.length > 0) {
            md += `- **合规异常应急分支处理 (Exception Handlers)**:\n`;
            for (const eh of sc.exceptionHandling) {
              md += `  - *防线*：${eh}\n`;
            }
          }
          md += `\n`;
        }
      }

      const boundRules = kb.rules.filter(r => r.aggregateRootId === ar.id);
      if (boundRules.length > 0) {
        md += `#### 3.3 限界上下文高精度校验规则 (In-Context Core Rules)\n\n`;
        for (const rule of boundRules) {
          md += `##### ➢ 规则: ${rule.name}\n`;
          md += `- **规则契约逻辑**：${rule.rule}\n`;
          md += `- **后端程序实现契约架构提示**：\n  \`\`\`typescript\n  // ${rule.implementationHint}\n  \`\`\`\n\n`;
        }
      }
    }
  }

  // 4. 三层领域深度架构
  md += `## 4. 三层领域深度架构 (3-Level Domain Deep Architecture)\n\n`;
  md += `本限界上下文严格根据三大业务层次进行能力下沉与业务职责划分定位：\n\n`;

  md += `### 4.1 一级领域 (Level 1: Aggregate Roots)\n`;
  md += `各核心聚合根作为事务一致性保障边界与持久化数据交互中心，在 Section 3 限界上下文设计中已进行深度建模。\n\n`;

  md += `### 4.2 二级领域核心业务模块 (Level 2: Business Capability Modules)\n\n`;
  const modules = kb.modules || [];
  if (modules.length === 0) {
    md += `*暂无解析沉淀之二级核心业务领域模块记录。可运行 AI 迭代探针推理收敛提炼模块体系。*\n\n`;
  } else {
    md += `| 二级核心模块名称 | 归属一级聚合根 | 模块能力特征属性 | 模块核心设计职责与应用场景对标 |\n`;
    md += `| :--- | :--- | :--- | :--- |\n`;
    for (const m of modules) {
      const ar = kb.aggregates.find(a => a.id === m.aggregateRootId);
      const capTypeLabels: Record<string, string> = {
        engine: '⚙️ 核心计算校验引擎 (Engine)',
        config_center: '🎛️ 业务参数及限额配置中心 (Config Center)',
        document_mgmt: '📄 交易流程与单据协同 (Doc Management)',
        other: '🌀 辅助设计配套组件 (Other)'
      };
      md += `| **${m.name}** | \`${ar ? ar.name : '跨聚合/全局'}\` | ${capTypeLabels[m.capabilityType] || m.capabilityType} | ${m.description} |\n`;
    }
    md += `\n`;
  }

  md += `### 4.3 三级领域细分业务要素 (Level 3: Micro Operational Elements)\n\n`;
  const elements = kb.elements || [];
  if (elements.length === 0) {
    md += `*暂无解析沉淀之三级细分操作要素、核心计算及生命状态节点记录。*\n\n`;
  } else {
    md += `| 三级细分业务要素名称 | 隶属二级核心模块 | 业务规则/要素类型 | 特定计算公式、状态流转节点或分支决策校验逻辑 |\n`;
    md += `| :--- | :--- | :--- | :--- |\n`;
    for (const el of elements) {
      const mod = modules.find(m => m.id === el.moduleId);
      const typeLabels: Record<string, string> = {
        sub_process: '⛓️ 业务细分子流程 (Sub-Process)',
        lifecycle_node: '📌 关键状态/生命周期过渡节点 (Lifecycle Node)',
        calculation_logic: '📊 核心算力校验与计算规则 (Calculation Logic)',
        decision_logic: '🚦 约束断定与逻辑分支决策 (Decision Rule)'
      };
      md += `| **${el.name}** | \`${mod ? mod.name : '通用模块'}\` | ${typeLabels[el.type] || el.type} | ${el.detail} |\n`;
    }
    md += `\n`;
  }

  // 5. 跨系统边界与上下游接口交互矩阵
  md += `## 5. 跨系统边界与上下游接口交互矩阵 (System Integrations & API Contracts)\n\n`;
  md += `详细剖析本限界应用与外部大平台分布式系统中各二级模块通信及核心数据交互契约：\n\n`;
  const interactions = kb.interactions || [];
  if (interactions.length === 0) {
    md += `*暂无外部三方集成和数据交互。可以使用探索假设探查各流向断口。*\n\n`;
  } else {
    md += `| 外部对接服务系统 | 业务数据传输方向 | 本端接收二级模块 | 隶属核心业务协同流程 | 数据流向、交互协议契约及接口业务逻辑规范描述 |\n`;
    md += `| :--- | :--- | :--- | :--- | :--- |\n`;
    for (const inter of interactions) {
      const mod = modules.find(m => m.id === inter.targetModuleId);
      const directionLabel = inter.direction === 'upstream' ? '📥 入站 upstream (对方请起本端消费)' : '📤 出站 downstream (本端同步对方消费)';
      md += `| **${inter.systemName}** | \`${directionLabel}\` | ${mod ? mod.name : '全部模块对接'} | ${inter.coreWorkflow} | ${inter.interfaceLogic} |\n`;
    }
    md += `\n`;
  }

  md += `## 6. 全价值链闭环流程设计 (End-to-End Business Workflows)\n\n`;
  if (kb.processes.length === 0) {
    md += `*暂无关联流程建模.*\n\n`;
  } else {
    for (const pr of kb.processes) {
      md += `### ✦ 闭环流程项：${pr.name}\n`;
      md += `- **生命周期完整状态变更**：${pr.steps.map(s => `[${s}]`).join(' → ') || '待定'}\n`;
      md += `- **标准主业务流向 (Happy Path)**：\n`;
      pr.normalFlow.forEach((nf, idx) => {
        md += `  - \`Normal流程分支-${idx+1}\`: ${nf}\n`;
      });
      if (pr.alternateFlow.length > 0) {
        md += `- **异常异常、侧流分路向 (Alternate Paths)**：\n`;
        pr.alternateFlow.forEach((af, idx) => {
          md += `  - \`Alternate异常重试分支-${idx+1}\`: ${af}\n`;
        });
      }
      md += `\n`;
    }
  }

  md += `## 7. 探针假设及校验日志 (HVD Verification Traceability Log)\n\n`;
  md += `> 记录本阶段系统在构建时提出、查证、并被最终收录和舍弃的领域探针命题，体现知识防伪可追溯。 \n\n`;
  
  const verifiedHyp = kb.hypotheses.filter(h => h.status === 'verified');
  const rejectedHyp = kb.hypotheses.filter(h => h.status === 'rejected');

  md += `### 5.1 已经通过校验并演绎的科学事实 (Verified Premises)\n\n`;
  for (const h of verifiedHyp) {
    md += `- **命题**："${h.statement}"\n`;
    md += `  - **漏洞动机**：${h.reason}\n`;
    if (h.sources && h.sources.length > 0) {
      md += `  - **标杆行业实际标准检索出处**：\n`;
      for (const s of h.sources) {
        md += `    - [${s.title}](${s.url}) : "${s.snippet.substring(0, 100)}..."\n`;
      }
    }
    md += `\n`;
  }

  md += `### 5.2 已经排除、驳回的防伪认知噪音 (Rejected Hypotheses)\n\n`;
  if (rejectedHyp.length === 0) {
    md += `*暂无驳回之探针案例.*\n\n`;
  } else {
    for (const h of rejectedHyp) {
      md += `- **排除命题**："${h.statement}"\n`;
      md += `  - **驳回与审计排外考证原因**：${h.reason}\n\n`;
    }
  }

  return md;
}
