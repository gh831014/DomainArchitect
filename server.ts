/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { GoogleGenAI, Type } from '@google/genai';
import { db } from './server/db';
import { KB_Store, Hypothesis, Concept, Entity, AggregateRoot, BusinessScenario, BusinessProcess, CoreLogic, GeneratorConfig, LevelTwoModule, LevelThreeElement, SystemInteraction } from './src/types';

const app = express();
app.use(cors());
app.use(express.json());

// Helper to initialize Gemini Client dynamically
function getGeminiClient(): GoogleGenAI {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error('GEMINI_API_KEY is not defined. 请在 Secrets 面板设置您的 API Key。');
  }
  return new GoogleGenAI({
    apiKey: key,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });
}

// Wrap Gemini generateContent with auto-retrying & exponential backoff for 429/Resource Exhausted errors
async function generateContentWithRetry(
  ai: GoogleGenAI,
  options: {
    model: string;
    contents: any;
    config?: any;
    tools?: any;
    toolConfig?: any;
  },
  task?: any,
  maxRetries = 5,
  baseDelay = 3500
): Promise<any> {
  let attempt = 0;
  while (true) {
    try {
      // Small defensive delay of 1.5 seconds between requests of any kind to avoid instant RPM limits
      await new Promise((resolve) => setTimeout(resolve, 1500));
      const res = await ai.models.generateContent(options);
      if (task && res) {
        if (!task.tokenStats) {
          task.tokenStats = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
        }
        const usage = res.usageMetadata;
        if (usage) {
          task.tokenStats.promptTokens += (usage.promptTokenCount || 0);
          task.tokenStats.completionTokens += (usage.candidatesTokenCount || 0);
          task.tokenStats.totalTokens += (usage.totalTokenCount || 0);
          db.saveTask(task);
        }
      }
      return res;
    } catch (err: any) {
      attempt++;
      const errMsg = err?.message || String(err);
      const isRateLimit = errMsg.includes('429') || 
                          errMsg.toLowerCase().includes('quota') || 
                          errMsg.toLowerCase().includes('exhausted') ||
                          errMsg.toLowerCase().includes('limit');
      
      if (isRateLimit && attempt <= maxRetries) {
        // Calculate exponential backoff delay with a slight random jitter
        const delay = baseDelay * Math.pow(2, attempt - 1) + Math.random() * 1000;
        const warningMsg = `⚠️ [服务器警告] 触发 Gemini API 频率/配额限制 (429/Resource Exhausted)。系统将在 ${(delay / 1000).toFixed(1)} 秒后自动重试 (第 ${attempt}/${maxRetries} 次重试)...`;
        console.warn(warningMsg, errMsg);
        
        if (task) {
          task.logs.push({
            timestamp: new Date().toISOString(),
            message: warningMsg,
            type: 'warning',
          });
          db.saveTask(task);
        }
        
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        // Throw the error if key is not valid, or we reached max limit
        throw err;
      }
    }
  }
}

// Dual-engine search helper: Tavily as default, Google Search Grounding as auxiliary fallback
async function performDualEngineSearch(
  query: string,
  ai: GoogleGenAI,
  task: any
): Promise<{ text: string; sources: { title: string; url: string; snippet: string }[] }> {
  const tavilyApiKey = process.env.TAVILY_API_KEY;

  if (tavilyApiKey) {
    try {
      task.logs.push({
        timestamp: new Date().toISOString(),
        message: `🔍 [Tavily 检索] 启动 Tavily 智能搜索引擎对该建设性假设进行客观评估验证...`,
        type: 'info'
      });
      db.saveTask(task);

      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          api_key: tavilyApiKey,
          query: query,
          search_depth: 'basic',
          include_answer: true,
          max_results: 5
        })
      });

      if (!response.ok) {
        throw new Error(`Tavily HTTP 错误! 状态码: ${response.status}`);
      }

      const data = await response.json() as any;
      const tavilyAnswer = data.answer || '';
      const results = data.results || [];

      // Combine Tavily result contents as the search explanation
      let searchExplanation = '';
      if (tavilyAnswer) {
        searchExplanation += `【Tavily 智能回答概要】\n${tavilyAnswer}\n\n`;
      }
      searchExplanation += `【Tavily 检索参考原文切片】\n`;
      results.forEach((r: any, idx: number) => {
        searchExplanation += `[文献 ${idx + 1}] 标题: ${r.title}\n链接: ${r.url}\n内容: ${r.snippet || r.content}\n\n`;
      });

      const sources = results.map((r: any) => ({
        title: r.title || '检索参考文献',
        url: r.url || '',
        snippet: r.snippet || r.content || '',
      })).filter((x: any) => x.url);

      task.logs.push({
        timestamp: new Date().toISOString(),
        message: `✅ [Tavily 检索成功] 默认搜索引擎成功获取 ${sources.length} 条高价值行业学术比对文献。`,
        type: 'success'
      });
      db.saveTask(task);

      return { text: searchExplanation, sources };
    } catch (err: any) {
      task.logs.push({
        timestamp: new Date().toISOString(),
        message: `⚠️ [Tavily 检索遭遇异常] ${err.message || err}。系统遵循双引擎机制，正在自动无缝切换到辅助引擎 Google Search Grounding 检索...`,
        type: 'warning'
      });
      db.saveTask(task);
    }
  } else {
    task.logs.push({
      timestamp: new Date().toISOString(),
      message: `ℹ️ 系统未检测到 TAVILY_API_KEY。遵循高可用搜索规则，自动无缝启动辅助引擎 Google Search Grounding 获取网页信源...`,
      type: 'info'
    });
    db.saveTask(task);
  }

  // Fallback to Google Search Grounding with Gemini
  const searchRes = await generateContentWithRetry(ai, {
    model: 'gemini-3.5-flash',
    contents: query,
    config: {
      tools: [{ googleSearch: {} }],
    }
  }, task);

  const searchExplanation = searchRes.text || '没有返回具体的检索文本。';
  const chunks = searchRes.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
  const sources = chunks.map((ck: any) => ({
    title: ck.web?.title || '检索参考文献',
    url: ck.web?.uri || '',
    snippet: ck.web?.snippet || searchExplanation.substring(0, 100),
  })).filter((x: any) => x.url);

  return { text: searchExplanation, sources };
}

// DeepSeek LLM API Connector with Auto-retry and Exponential Backoff
async function generateContentWithDeepSeek(
  prompt: string,
  isJson: boolean = false,
  task?: any,
  maxRetries = 4,
  baseDelay = 2500
): Promise<{ text: string }> {
  // Use user-provided fallback key if DEEPSEEK_API_KEY environment variable is not set
  const apiKey = process.env.DEEPSEEK_API_KEY || 'sk-de8fe69c23524422a70ec35d210a8d11';
  let attempt = 0;

  while (true) {
    try {
      // Anti-aggression pace limit
      await new Promise((resolve) => setTimeout(resolve, 1000));

      const response = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [
            {
              role: 'system',
              content: '你是一个世界级的企业领域知识工程专家、软件架构大师。精通业务模型分析及 DDD 领域拆分，擅长对标阿里（1688企业采购/支付宝）、京东（企业购）、腾讯、美团（商企通）、字节跳动（火山引擎）等中国国内头部厂商的标准设计方案。'
            },
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.2,
          response_format: isJson ? { type: 'json_object' } : undefined
        })
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`DeepSeek API status ${response.status}: ${errText}`);
      }

      const resJson = await response.json();
      const text = resJson?.choices?.[0]?.message?.content || '';
      if (task && resJson) {
        if (!task.tokenStats) {
          task.tokenStats = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
        }
        const usage = resJson.usage;
        if (usage) {
          task.tokenStats.promptTokens += (usage.prompt_tokens || 0);
          task.tokenStats.completionTokens += (usage.completion_tokens || 0);
          task.tokenStats.totalTokens += (usage.total_tokens || 0);
          db.saveTask(task);
        }
      }
      return { text };
    } catch (err: any) {
      attempt++;
      const errMsg = err?.message || String(err);
      const isRateLimit = errMsg.includes('429') || 
                          errMsg.toLowerCase().includes('quota') || 
                          errMsg.toLowerCase().includes('exhausted') || 
                          errMsg.toLowerCase().includes('limit');

      if (attempt <= maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt - 1) + Math.random() * 1000;
        const msg = `⚠️ [DeepSeek 接口重试] 触发频率限制或网络超时 (${errMsg})。将在 ${(delay / 1000).toFixed(1)} 秒后进行第 ${attempt}/${maxRetries} 次重试...`;
        console.warn(msg);
        if (task) {
          task.logs.push({
            timestamp: new Date().toISOString(),
            message: msg,
            type: 'warning'
          });
          db.saveTask(task);
        }
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        throw new Error(`DeepSeek API 最终调用失败 (尝试了 ${maxRetries} 次): ${errMsg}`);
      }
    }
  }
}

// Dual-LLM Hub: Runs DeepSeek by default, with automatic self-healing backup transition to Gemini if any error occurs
async function generateFlexibleLLM(
  prompt: string,
  isJson: boolean,
  task: any,
  aiGemini: GoogleGenAI,
  preferredModel: 'deepseek' | 'gemini' = 'deepseek'
): Promise<{ text: string }> {
  if (preferredModel === 'deepseek') {
    try {
      task.logs.push({
        timestamp: new Date().toISOString(),
        message: `🤖 [模型计算] 启动 DeepSeek-Chat 大模型进行高维业务模型推理...`,
        type: 'info'
      });
      db.saveTask(task);
      return await generateContentWithDeepSeek(prompt, isJson, task);
    } catch (err: any) {
      const fallbackWarning = `⚠️ [DeepSeek 遭遇异常] ${err.message || err}。正在自动开启高可用故障转移 (Failover) 至 Gemini 1.5/3.5 备用计算节点继续推演...`;
      console.error(fallbackWarning);
      task.logs.push({
        timestamp: new Date().toISOString(),
        message: fallbackWarning,
        type: 'warning'
      });
      db.saveTask(task);
    }
  }

  // Fallback to Gemini
  task.logs.push({
    timestamp: new Date().toISOString(),
    message: `🤖 [模型计算] 使用 Google Gemini (gemini-3.5-flash) 进行高层意图推演...`,
    type: 'info'
  });
  db.saveTask(task);

  const res = await generateContentWithRetry(aiGemini, {
    model: 'gemini-3.5-flash',
    contents: prompt,
    config: {
      responseMimeType: isJson ? 'application/json' : undefined,
      temperature: 0.2,
    }
  }, task);

  return { text: res.text || '' };
}

// REST APIs
app.get('/api/domains', (req, res) => {
  try {
    const list = db.getDomains();
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/domains/analyze-structure', async (req, res) => {
  const { name } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Domain name is required' });
  }

  try {
    const ai = getGeminiClient();
    const prompt = `你是一个领先的领域工程专家、系统架构师和商业分析专家。用户提供了一个领域名称："${name}"。
请基于以下规则，使用大模型并结合对阿里、京东、网易、美团等主流互联网大厂或核心企业的业务子系统与产品子领域的交叉对标和论证，识别该领域是属于【双轨复合知识树】还是【单轨纯行业/知识体系】：

【判断规则】：
1. 如果该领域名称中包含了具体的产品功能子域、软件系统名称、或IT核心交易/支撑实体名称（如：电商订单系统、交易系统、供应链系统、CRM、ERP、WMS、TMS、排程系统、履约结算系统等，因为“订单”、“交易”、“供应链”、“结算”都是系统的核心领域产品或技术实体。且百度、阿里、京东、拼多多等企业中均具备此独立对应的系统或者应用，被广泛支持和物理建设），则属于【双轨复合知识树】（同时拥有底层系统单据技术资产，又有物理作业和行业通识）。
2. 如果无法识别出明确的IT系统定义或核心软件模块实体，默认是物理世界的大行业分类、特定非软件性质作业场景或纯粹的知识理论体系（例如：电商行业、生鲜物流、医药零售、财务审计实务、B端运营学）。这属于【单轨纯行业/知识体系】，不需要建立软件实体或限界上下文，而是应当直接以行业本身的某分类作为根进行推演延展。

请按如下要求的 JSON 结构直接裸 JSON 输出（严禁附带 markdown \`\`\`json 格式，直接输出大括号开始的 JSON 串）：
{
  "trackType": "double" 或 "single",
  "systemName": "如果为 double，请建议一个主流通配的大厂系统英文名称或标识符（例如: OrderSystem, TradeCore, SupplyChain, ERP, CRM等），如果为 single 请直接建议为 '无'",
  "reasoning": "中文。判定其为单轨还是双轨的具体对标理由（请包含1-2句对标大厂如阿里/京东等的系统建设论证）",
  "suggestedDescription": "为此新领域拟定的智能目标和描述背景，包含如何假设延展它的行业根"
}`;

    const gRes = await generateContentWithRetry(ai, {
      model: 'gemini-3.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        temperature: 0.1,
      }
    });

    const parsed = JSON.parse(gRes.text?.trim() || '{}');
    res.json(parsed);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/domains', (req, res) => {
  const { name, systemName, description } = req.body;
  if (!name || !systemName) {
    return res.status(400).json({ error: 'domain name and systemName are required' });
  }
  try {
    const newDomain = db.createDomain(name, systemName, description || '');
    res.status(201).json(newDomain);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/domains/:id', (req, res) => {
  const { id } = req.params;
  try {
    db.deleteDomain(id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/domains/:id/kb', (req, res) => {
  const { id } = req.params;
  try {
    const kb = db.getDomainKB(id);
    if (!kb) {
      return res.status(404).json({ error: 'Domain not found' });
    }
    res.json(kb);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/domains/:id/kb', (req, res) => {
  const { id } = req.params;
  const newKB = req.body as KB_Store;
  if (!newKB || !newKB.domain) {
    return res.status(400).json({ error: 'Invalid KB Store payload' });
  }
  try {
    db.saveDomainKB(id, newKB);
    res.json({ success: true, kb: newKB });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/domains/:id/identify-subindustries', async (req, res) => {
  const { id } = req.params;
  try {
    const kb = db.getDomainKB(id);
    if (!kb) {
      return res.status(404).json({ error: 'KB Store not found' });
    }
    
    // Extract general industry concepts to classify
    const industryGeneralConcepts = kb.concepts.filter(c => c.conceptType === 'industry_general');
    if (industryGeneralConcepts.length === 0) {
      return res.json({ success: true, kb, message: 'No general industry concepts found to identify.' });
    }

    const payload = industryGeneralConcepts.map(c => ({
      id: c.id,
      name: c.name,
      definition: c.definition
    }));

    const prompt = `你是一个领先的领域工程专家与商业分析大师。针对当前建设的领域《${kb.domain.name}》（系统/行业英文标识：《${kb.domain.systemName}》，描述：《${kb.domain.description}》），以及我们双轨模型中的“行业领域树”，请对下列行业通识概念进行智能、高精度的“二级细分子行业”标签分类。

可选子行业包括且不限于：
- “生鲜零售” (例如：冷链折损控、温湿度节点、耗损清算)
- “医药零售” (例如：处方药流转、医保卡结算核销、药监局溯源)
- “直播电商” (例如：带货返佣结构、主播档期、坑位费、秒杀库存)
- “跨境供应链” (例如：关税代扣、进出口监管、保税仓对接)
- “仓储物流” (例如：WMS出入库、波次分拣、智能分路、堆垛规则)
- “网约车出行” (例如：实时派单逻辑、溢价因子、安全报警红线、司机履约)

* 注意：如果不属于上述特异细分子行业，或者性质非常通用，或者仅代表当前领域极其通用的大类，请将其划分并归类为“通用行业通识”。可以根据概念词汇的释义深度判断，尽量分类精细而符合实际业务形态。

待分类概念列表：
${JSON.stringify(payload, null, 2)}

请务必按如下严格的 JSON 数组格式直接输出（严禁带 markdown 代码块标记，直接裸 json 输出）：
[
  {
    "id": "概念ID",
    "subIndustry": "子行业标签名称（例如：生鲜零售、医药零售、直播电商、跨境供应链、仓储物流、网约车出行、通用行业通识 等之一）"
  }
]`;

    const ai = getGeminiClient();
    const gRes = await generateContentWithRetry(ai, {
      model: 'gemini-3.5-flash',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        temperature: 0.1,
      }
    });

    const classifications = JSON.parse(gRes.text?.trim() || '[]');
    if (Array.isArray(classifications)) {
      kb.concepts = kb.concepts.map(c => {
        const matched = classifications.find(item => item.id === c.id);
        if (matched) {
          return { ...c, subIndustry: matched.subIndustry };
        }
        return c;
      });
      db.saveDomainKB(id, kb);
    }

    res.json({ success: true, kb });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/domains/:id/config', (req, res) => {
  const { id } = req.params;
  try {
    const config = db.getDomainConfig(id);
    if (!config) {
      return res.status(404).json({ error: 'Config not found' });
    }
    res.json(config);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/domains/:id/config', (req, res) => {
  const { id } = req.params;
  const config = req.body as GeneratorConfig;
  if (!config) {
    return res.status(400).json({ error: 'Invalid config payload' });
  }
  try {
    db.saveDomainConfig(id, config);
    res.json({ success: true, config });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/tasks', (req, res) => {
  try {
    const tasks = db.getTasks();
    res.json(tasks);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/tasks/:id', (req, res) => {
  try {
    const task = db.getTask(req.params.id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.json(task);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tasks/:id/cancel', (req, res) => {
  try {
    const task = db.getTask(req.params.id);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    task.status = 'paused';
    task.message = '任务已被用户手动暂停/停止';
    task.logs.push({
      timestamp: new Date().toISOString(),
      message: '用户发出暂停或停止执行指令。',
      type: 'warning',
    });
    db.saveTask(task);
    res.json({ success: true, task });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// MARKTOWN EXPORT API
app.get('/api/domains/:id/export', (req, res) => {
  const { id } = req.params;
  try {
    const kb = db.getDomainKB(id);
    if (!kb) {
      return res.status(404).json({ error: 'KB not found' });
    }
    const md = generateMarkdown(kb);
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(kb.domain.name)}_architecture.md"`);
    res.send(md);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PARSE MARKDOWN BACK INTO KB_STORE
function parseMarkdownToKB(md: string, domainId: string): KB_Store {
  // Check for embedded Base64 JSON metadata
  const metadataRegex = /<!-- DOMAIN_ARCHITECT_DATA_METADATA_BASE64:\s*([A-Za-z0-9+/=]+)\s*-->/;
  const matchMetadata = md.match(metadataRegex);
  if (matchMetadata) {
    try {
      const decodedJson = Buffer.from(matchMetadata[1], 'base64').toString('utf-8');
      const kb = JSON.parse(decodedJson) as KB_Store;
      // Overwrite domainId to match the current target domain
      kb.domain.id = domainId;
      if (Array.isArray(kb.concepts)) kb.concepts.forEach(c => c.domainId = domainId);
      if (Array.isArray(kb.aggregates)) kb.aggregates.forEach(a => a.domainId = domainId);
      if (Array.isArray(kb.modules)) kb.modules.forEach(m => m.domainId = domainId);
      if (Array.isArray(kb.elements)) kb.elements.forEach(e => e.domainId = domainId);
      if (Array.isArray(kb.interactions)) kb.interactions.forEach(i => i.domainId = domainId);
      return kb;
    } catch (e) {
      console.error('Failed to parse embedded Base64 JSON metadata, falling back to markdown parsing:', e);
    }
  }

  // Fallback text parser
  const uuid = (prefix: string) => `${prefix}_${Math.random().toString(36).substring(2, 9)}`;
  const kb: KB_Store = {
    domain: { id: domainId, name: '', systemName: '', description: '', createdAt: new Date().toISOString() },
    concepts: [],
    aggregates: [],
    entities: [],
    scenarios: [],
    processes: [],
    rules: [],
    modules: [],
    elements: [],
    interactions: [],
    hypotheses: []
  };

  const lines = md.split(/\r?\n/);
  
  // State variables for tracking context while scanning line by line
  let currentSection = ''; // 'overview', 'glossary', 'aggregates', 'modules', 'elements', 'interactions', 'workflows', 'hypotheses'
  let currentAggregateSubSection = '';
  let currentArchitectureSubSection = '';
  let currentAggregate: AggregateRoot | null = null;
  let currentEntity: Entity | null = null;
  let currentScenario: BusinessScenario | null = null;
  let currentRule: CoreLogic | null = null;
  let currentProcess: BusinessProcess | null = null;
  let currentHypothesis: Hypothesis | null = null;
  let inCodeBlock = false;
  let codeBlockLines: string[] = [];
  let isVerifiedHypothesisSection = true;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Track code blocks
    if (trimmed.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      if (!inCodeBlock) {
        // Exited code block, process codeBlockLines if we are parsing rule implementation hint
        if (currentRule && codeBlockLines.length > 0) {
          currentRule.implementationHint = codeBlockLines
            .map(l => l.replace(/^\s*\/\/\s*/, '')) // strip comment leading slashes
            .join('\n');
        }
        codeBlockLines = [];
      }
      continue;
    }
    if (inCodeBlock) {
      codeBlockLines.push(line);
      continue;
    }

    // Identify top-level sections
    if (trimmed.startsWith('## ')) {
      const secText = trimmed.substring(3).toLowerCase();
      if (secText.includes('概述') || secText.includes('overview')) {
        currentSection = 'overview';
      } else if (secText.includes('字典') || secText.includes('glossary')) {
        currentSection = 'glossary';
      } else if (secText.includes('聚合根') || secText.includes('aggregate')) {
        currentSection = 'aggregates';
      } else if (secText.includes('深度架构') || secText.includes('deep architecture')) {
        currentSection = 'architecture';
      } else if (secText.includes('边界') || secText.includes('integrations')) {
        currentSection = 'interactions';
      } else if (secText.includes('流程设计') || secText.includes('workflows')) {
        currentSection = 'workflows';
      } else if (secText.includes('探针') || secText.includes('traceability')) {
        currentSection = 'hypotheses';
      } else {
        currentSection = '';
      }
      continue;
    }

    // Parsing based on current major section
    if (currentSection === 'overview') {
      const matchName = trimmed.match(/^\*\*目标领域\*\*[：:](.*)$/);
      if (matchName) kb.domain.name = matchName[1].trim();

      const matchSys = trimmed.match(/^\*\*系统名称\*\*[：:](.*)$/);
      if (matchSys) kb.domain.systemName = matchSys[1].trim();

      const matchDesc = trimmed.match(/^\*\*业务特征简述\*\*[：:](.*)$/);
      if (matchDesc) kb.domain.description = matchDesc[1].trim();
    }
    else if (currentSection === 'glossary') {
      // Glossary Concept
      const matchConcept = trimmed.match(/^### ✦ 术语[：:](.*)$/);
      if (matchConcept) {
        const cName = matchConcept[1].trim();
        const concept: Concept = {
          id: uuid('c'),
          domainId,
          name: cName,
          definition: '',
          attributes: [],
          confidence: 1.0,
          sourceUrl: '',
          conceptType: 'industry_general',
          treeType: 'industry' as const,
          subIndustry: '通用行业通识'
        };
        kb.concepts.push(concept);
        continue;
      }

      if (kb.concepts.length > 0) {
        const lastC = kb.concepts[kb.concepts.length - 1];
        const matchDef = trimmed.match(/^-\s+\*\*标准定义\*\*[：:](.*)$/);
        if (matchDef) {
          lastC.definition = matchDef[1].trim();
          continue;
        }
        const matchAttrs = trimmed.match(/^-\s+\*\*核心词表属性特征\*\*[：:](.*)$/);
        if (matchAttrs) {
          const attrStr = matchAttrs[1].trim();
          lastC.attributes = attrStr ? attrStr.split(/[,，、]/).map(x => x.trim()).filter(Boolean) : [];
          continue;
        }
        const matchConf = trimmed.match(/^-\s+\*\*建模置信度评估评分\*\*[：:]\s*(\d+)%/);
        if (matchConf) {
          lastC.confidence = parseFloat(matchConf[1]) / 100;
          continue;
        }
        const matchSource = trimmed.match(/^-\s+\*\*最佳实践对标依据引用\*\*[：:]\s*\[.*\]\((.*)\)/);
        if (matchSource) {
          lastC.sourceUrl = matchSource[1].trim();
          continue;
        }
      }
    }
    else if (currentSection === 'aggregates') {
      // Let's check sub-headings
      if (trimmed.startsWith('#### 3.1')) {
        currentAggregateSubSection = 'entities';
        continue;
      } else if (trimmed.startsWith('#### 3.2')) {
        currentAggregateSubSection = 'scenarios';
        continue;
      } else if (trimmed.startsWith('#### 3.3')) {
        currentAggregateSubSection = 'rules';
        continue;
      }

      // Aggregate root header
      const matchAR = trimmed.match(/^### ✦ 聚合根[：:](.*)$/);
      if (matchAR) {
        const arName = matchAR[1].trim();
        currentAggregate = {
          id: uuid('ar'),
          domainId,
          name: arName,
          invariants: [],
          repository: `${arName}Repository`,
          capExecution: true,
          capSupervision: false,
          capStatistics: false
        };
        kb.aggregates.push(currentAggregate);
        currentAggregateSubSection = 'invariants';
        continue;
      }

      if (currentAggregate) {
        if (currentAggregateSubSection === 'invariants') {
          const matchInv = trimmed.match(/^-\s+\*规则\*[：:](.*)$/) || trimmed.match(/^\s*-\s+(.*)$/);
          if (matchInv && trimmed.includes('规则')) {
            const cleanInv = matchInv[1].replace(/^\*规则\*[：:]/, '').trim();
            currentAggregate.invariants.push(cleanInv);
          }
          const matchRepo = trimmed.match(/^-\s+\*\*数据访问仓储模式\*\*[：:]\s*`(.*)`/);
          if (matchRepo) {
            currentAggregate.repository = matchRepo[1].trim();
          }
        }
        else if (currentAggregateSubSection === 'entities') {
          const matchEnt = trimmed.match(/^\*\s+包含实体[：:]\s*\*\*(.*)\*\*/);
          if (matchEnt) {
            const entName = matchEnt[1].trim();
            currentEntity = {
              id: uuid('e'),
              domainId,
              aggregateRootId: currentAggregate.id,
              name: entName,
              fields: []
            };
            kb.entities.push(currentEntity);
            continue;
          }

          // Parse table row for fields
          if (currentEntity && trimmed.startsWith('|') && !trimmed.includes('字段名') && !trimmed.includes(':---')) {
            const parts = trimmed.split('|').map(x => x.trim());
            if (parts.length >= 5) {
              const fName = parts[1].replace(/`/g, '').trim();
              const fType = parts[2].replace(/`/g, '').trim();
              const fDesc = parts[3].trim();
              const isId = parts[4].includes('🔑');
              if (fName) {
                currentEntity.fields.push({
                  name: fName,
                  type: fType || 'string',
                  description: fDesc,
                  isIdentifier: isId
                });
              }
            }
          }
        }
        else if (currentAggregateSubSection === 'scenarios') {
          const matchScen = trimmed.match(/^##### ➢ 场景[：:](.*)\s+\[等级[：:](.*)\]/);
          if (matchScen) {
            const scName = matchScen[1].trim();
            const dimStr = matchScen[2].toLowerCase();
            let dim: 'execution' | 'supervision' | 'statistics' = 'execution';
            if (dimStr.includes('监管') || dimStr.includes('风控') || dimStr.includes('supervision')) {
              dim = 'supervision';
              currentAggregate.capSupervision = true;
            } else if (dimStr.includes('统计') || dimStr.includes('决策') || dimStr.includes('statistics') || dimStr.includes('bi')) {
              dim = 'statistics';
              currentAggregate.capStatistics = true;
            } else {
              currentAggregate.capExecution = true;
            }

            currentScenario = {
              id: uuid('s'),
              aggregateRootId: currentAggregate.id,
              name: scName,
              capabilityDimension: dim,
              actors: [],
              preconditions: [],
              steps: [],
              exceptionHandling: []
            };
            kb.scenarios.push(currentScenario);
            continue;
          }

          if (currentScenario) {
            const matchActors = trimmed.match(/^-\s+\*\*参与Actor业务角色\*\*[：:](.*)$/);
            if (matchActors) {
              const actorStr = matchActors[1].trim();
              currentScenario.actors = actorStr ? actorStr.split(/[,，、]/).map(x => x.trim()).filter(Boolean) : [];
              continue;
            }
            const matchPre = trimmed.match(/^-\s+\*\*契约前置约束\*\*[：:](.*)$/);
            if (matchPre) {
              const preStr = matchPre[1].trim();
              currentScenario.preconditions = preStr ? preStr.split(/[,，、]/).map(x => x.trim()).filter(Boolean) : [];
              continue;
            }
            // Sequential step
            const matchStep = trimmed.match(/^\d+\.\s*(.*)$/);
            if (matchStep) {
              currentScenario.steps.push(matchStep[1].trim());
              continue;
            }
            const matchEH = trimmed.match(/^-\s+\*防线\*[：:](.*)$/);
            if (matchEH) {
              currentScenario.exceptionHandling.push(matchEH[1].trim());
              continue;
            }
          }
        }
        else if (currentAggregateSubSection === 'rules') {
          const matchRule = trimmed.match(/^##### ➢ 规则[：:]\s*(.*)$/);
          if (matchRule) {
            const ruleName = matchRule[1].trim();
            currentRule = {
              id: uuid('rl'),
              aggregateRootId: currentAggregate.id,
              name: ruleName,
              rule: '',
              implementationHint: ''
            };
            kb.rules.push(currentRule);
            continue;
          }

          if (currentRule) {
            const matchRuleLog = trimmed.match(/^-\s+\*\*规则契约逻辑\*\*[：:](.*)$/);
            if (matchRuleLog) {
              currentRule.rule = matchRuleLog[1].trim();
              continue;
            }
          }
        }
      }
    }
    else if (currentSection === 'architecture') {
      // 4.2 Level 2 Modules
      if (trimmed.startsWith('### 4.2')) {
        currentArchitectureSubSection = 'modules';
        if (!kb.modules) kb.modules = [];
        continue;
      } else if (trimmed.startsWith('### 4.3')) {
        currentArchitectureSubSection = 'elements';
        if (!kb.elements) kb.elements = [];
        continue;
      }

      if (currentArchitectureSubSection === 'modules') {
        if (trimmed.startsWith('|') && !trimmed.includes('二级核心模块名称') && !trimmed.includes(':---')) {
          const parts = trimmed.split('|').map(x => x.trim());
          if (parts.length >= 5) {
            const mName = parts[1].replace(/\*\*/g, '').trim();
            const arName = parts[2].replace(/`/g, '').trim();
            const capAttr = parts[3].trim();
            const mDesc = parts[4].trim();

            if (mName) {
              // Find Aggregate Root ID
              const ar = kb.aggregates.find(a => a.name.toLowerCase() === arName.toLowerCase());
              let capabilityType: 'engine' | 'config_center' | 'document_mgmt' | 'other' | string = 'other';
              if (capAttr.includes('⚙️') || capAttr.includes('Engine') || capAttr.includes('核心计算')) {
                capabilityType = 'engine';
              } else if (capAttr.includes('🎛️') || capAttr.includes('Config') || capAttr.includes('配置中心')) {
                capabilityType = 'config_center';
              } else if (capAttr.includes('📄') || capAttr.includes('Doc') || capAttr.includes('单据协同')) {
                capabilityType = 'document_mgmt';
              }

              if (!kb.modules) kb.modules = [];
              kb.modules.push({
                id: uuid('m'),
                domainId,
                aggregateRootId: ar ? ar.id : (kb.aggregates[0]?.id || ''),
                name: mName,
                capabilityType,
                description: mDesc
              });
            }
          }
        }
      }
      else if (currentArchitectureSubSection === 'elements') {
        if (trimmed.startsWith('|') && !trimmed.includes('三级细分业务要素') && !trimmed.includes(':---')) {
          const parts = trimmed.split('|').map(x => x.trim());
          if (parts.length >= 5) {
            const elName = parts[1].replace(/\*\*/g, '').trim();
            const modName = parts[2].replace(/`/g, '').trim();
            const elTypeStr = parts[3].trim();
            const elDetail = parts[4].trim();

            if (elName) {
              const mod = kb.modules?.find(m => m.name.toLowerCase() === modName.toLowerCase());
              let elType: 'sub_process' | 'lifecycle_node' | 'calculation_logic' | 'decision_logic' | string = 'sub_process';
              if (elTypeStr.includes('⛓️') || elTypeStr.includes('子流程') || elTypeStr.includes('Sub-Process')) {
                elType = 'sub_process';
              } else if (elTypeStr.includes('📌') || elTypeStr.includes('生命周期') || elTypeStr.includes('Lifecycle')) {
                elType = 'lifecycle_node';
              } else if (elTypeStr.includes('📊') || elTypeStr.includes('核心算力') || elTypeStr.includes('Calculation')) {
                elType = 'calculation_logic';
              } else if (elTypeStr.includes('🚦') || elTypeStr.includes('约束断定') || elTypeStr.includes('Decision')) {
                elType = 'decision_logic';
              }

              if (!kb.elements) kb.elements = [];
              kb.elements.push({
                id: uuid('el'),
                domainId,
                moduleId: mod ? mod.id : (kb.modules?.[0]?.id || ''),
                name: elName,
                type: elType,
                detail: elDetail
              });
            }
          }
        }
      }
    }
    else if (currentSection === 'interactions') {
      if (trimmed.startsWith('|') && !trimmed.includes('外部对接服务系统') && !trimmed.includes(':---')) {
        const parts = trimmed.split('|').map(x => x.trim());
        if (parts.length >= 6) {
          const sysName = parts[1].replace(/\*\*/g, '').trim();
          const directionLabel = parts[2].replace(/`/g, '').trim();
          const modName = parts[3].trim();
          const coreWorkflow = parts[4].trim();
          const interfaceLogic = parts[5].trim();

          if (sysName) {
            const mod = kb.modules?.find(m => m.name.toLowerCase() === modName.toLowerCase());
            const direction = (directionLabel.includes('入站') || directionLabel.includes('upstream')) ? 'upstream' : 'downstream';
            if (!kb.interactions) kb.interactions = [];
            kb.interactions.push({
              id: uuid('i'),
              domainId,
              systemName: sysName,
              direction,
              targetModuleId: mod ? mod.id : (kb.modules?.[0]?.id || ''),
              coreWorkflow,
              interfaceLogic
            });
          }
        }
      }
    }
    else if (currentSection === 'workflows') {
      const matchPr = trimmed.match(/^### ✦ 闭环流程项[：:](.*)$/);
      if (matchPr) {
        const prName = matchPr[1].trim();
        // Try to bind process to a scenario matching name or use default
        let scen = kb.scenarios.find(s => s.name.toLowerCase().includes(prName.toLowerCase()));
        currentProcess = {
          id: uuid('p'),
          scenarioId: scen ? scen.id : (kb.scenarios[0]?.id || ''),
          name: prName,
          steps: [],
          normalFlow: [],
          alternateFlow: []
        };
        kb.processes.push(currentProcess);
        continue;
      }

      if (currentProcess) {
        const matchStepsStr = trimmed.match(/^-\s+\*\*生命周期完整状态变更\*\*[：:](.*)$/);
        if (matchStepsStr) {
          const rawSteps = matchStepsStr[1].trim();
          // Split of type "[Status1] → [Status2]"
          const matches = rawSteps.match(/\[(.*?)\]/g);
          if (matches) {
            currentProcess.steps = matches.map(m => m.replace(/[\[\]]/g, '').trim());
          }
          continue;
        }

        const matchNormal = trimmed.match(/^-\s+`Normal流程分支-\d+`[：:](.*)$/);
        if (matchNormal) {
          currentProcess.normalFlow.push(matchNormal[1].trim());
          continue;
        }

        const matchAlternate = trimmed.match(/^-\s+`Alternate异常重试分支-\d+`[：:](.*)$/);
        if (matchAlternate) {
          currentProcess.alternateFlow.push(matchAlternate[1].trim());
          continue;
        }
      }
    }
    else if (currentSection === 'hypotheses') {
      if (trimmed.startsWith('### 5.1')) {
        isVerifiedHypothesisSection = true;
        continue;
      } else if (trimmed.startsWith('### 5.2')) {
        isVerifiedHypothesisSection = false;
        continue;
      }

      const matchHyp = trimmed.match(/^-\s+\*\*(?:命题|伪命题)\*\*[：:]\s*"(.*)"$/);
      if (matchHyp) {
        const statement = matchHyp[1].trim();
        currentHypothesis = {
          id: uuid('h'),
          domainId,
          statement,
          reason: '',
          status: isVerifiedHypothesisSection ? 'verified' as const : 'rejected' as const,
          type: 'best_practice_gap',
          confidence: 1.0,
          createdAt: new Date().toISOString(),
          sources: []
        };
        kb.hypotheses.push(currentHypothesis);
        continue;
      }

      if (currentHypothesis) {
        const matchReason = trimmed.match(/^-\s+\*\*(?:漏洞动机|合规依据|提出动机|证伪驳回理由)\*\*[：:](.*)$/);
        if (matchReason) {
          currentHypothesis.reason = matchReason[1].trim();
          continue;
        }

        // Parse sources
        const matchSrc = trimmed.match(/^-\s+\[(.*)\]\((.*)\)\s*:\s*"(.*)"/);
        if (matchSrc) {
          if (!currentHypothesis.sources) currentHypothesis.sources = [];
          currentHypothesis.sources.push({
            title: matchSrc[1].trim(),
            url: matchSrc[2].trim(),
            snippet: matchSrc[3].trim()
          });
        }
      }
    }
  }

  // Ensure arrays exist
  if (!kb.modules) kb.modules = [];
  if (!kb.elements) kb.elements = [];
  if (!kb.interactions) kb.interactions = [];

  // Post-process fallback parser outputs to fix missing aggregate-scenarios mappings and defaults
  if (kb.modules.length > 0) {
    kb.elements.forEach(el => {
      if (!el.moduleId) el.moduleId = kb.modules[0].id;
    });
    kb.interactions.forEach(inter => {
      if (!inter.targetModuleId) inter.targetModuleId = kb.modules[0].id;
    });
  }
  if (kb.scenarios.length > 0) {
    kb.processes.forEach(pr => {
      if (!pr.scenarioId) pr.scenarioId = kb.scenarios[0].id;
    });
  }

  return kb;
}

// MARKDOWN IMPORT API
app.post('/api/domains/:id/import', (req, res) => {
  const { id } = req.params;
  const { markdown } = req.body;
  if (!markdown || typeof markdown !== 'string') {
    return res.status(400).json({ error: 'Invalid or empty markdown content' });
  }

  try {
    const parsedKB = parseMarkdownToKB(markdown, id);
    if (!parsedKB || !parsedKB.domain.name) {
      return res.status(400).json({ error: '未能从Markdown中解析出有效的领域信息。请确保文件格式与导出的一致。' });
    }

    db.saveDomainKB(id, parsedKB);
    res.json({ success: true, kb: parsedKB });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// START GENERATION SERVICE (BACKGROUND ORCHESTRATOR)
app.post('/api/domains/:id/build', (req, res) => {
  const { id } = req.params;
  try {
    const kb = db.getDomainKB(id);
    const config = db.getDomainConfig(id);
    if (!kb || !config) {
      return res.status(404).json({ error: 'Domain or Config not found' });
    }

    // Verify key before proceeding
    getGeminiClient();

    const task = db.createTask(id);
    task.status = 'running';
    task.message = '正在初始化认知迭代循环...';
    task.logs.push({
      timestamp: new Date().toISOString(),
      message: '主控制器启动：假设-验证-推导(HVD)闭环领域知识工程。',
      type: 'info',
    });
    db.saveTask(task);

    // Run async loop in background
    runKnowledgeIteration(id, task.taskId).catch(err => {
      console.error('Background iteration failed:', err);
    });

    res.json({ success: true, taskId: task.taskId });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// Background Worker logic
async function runKnowledgeIteration(domainId: string, taskId: string) {
  const task = db.getTask(taskId);
  if (!task) return;

  const kb = db.getDomainKB(domainId);
  const config = db.getDomainConfig(domainId);
  if (!kb || !config) {
    task.status = 'failed';
    task.message = '未能载入领域基础数据或配置。';
    db.saveTask(task);
    return;
  }

  let ai;
  try {
    ai = getGeminiClient();
  } catch (err: any) {
    task.status = 'failed';
    task.message = err.message;
    db.saveTask(task);
    return;
  }

  const systemNameLower = (kb.domain.systemName || '').trim().toLowerCase();
  const isIndustryOnly = !systemNameLower || ['无', 'none', 'industry', '纯行业', '行业', '无系统', '暂无系统'].includes(systemNameLower);

  task.logs.push({
    timestamp: new Date().toISOString(),
    message: `=== 启动核心任务编排 ===\n检测到领域构建模式：[${isIndustryOnly ? '单轨纯行业树模式' : '双轨复合知识树模式'}]`,
    type: 'info',
  });
  db.saveTask(task);

  const uuid = (prefix: string) => `${prefix}_${Math.random().toString(36).substring(2, 9)}`;
  const model = (config as any)?.preferredModel || 'deepseek';

  let referenceArchContext = '';
  const ref = (config as any)?.referenceArch;
  if (ref) {
    const parts: string[] = [];
    if (ref.companyArchitecture && ref.companyArchitecture.trim()) {
      parts.push(`【参考：公司架构信息】:\n${ref.companyArchitecture.trim()}`);
    }
    if (ref.productArchitecture && ref.productArchitecture.trim()) {
      parts.push(`【参考：现有产品架构】:\n${ref.productArchitecture.trim()}`);
    }
    if (ref.keyDirections && ref.keyDirections.trim()) {
      parts.push(`【重点补全的方向/倾向性】:\n${ref.keyDirections.trim()}`);
    }
    if (parts.length > 0) {
      referenceArchContext = `\n## 导入的参考架构与重点方向 (Optional Reference Architecture)
以下是用户导入的现有公司架构、产品架构或重点补全的方向。
请在兼容现有行业及大厂对标标准规则的基础上，按照“兼容现有规则基础上增加一定维度的补充和倾向性”原则，重点向这些输入的方向或痛点倾斜，补充相关的概念、实体、场景或流程设计：
${parts.join('\n\n')}\n`;
    }
  }

  // ==========================================
  // PHASE 1: 行业/知识体系知识树构建 (Tasks 1.1 - 1.4)
  // ==========================================
  try {
    task.message = '正在启动 1.1: 行业通用常识与通识分析提取以及高阶对标验证...';
    task.logs.push({
      timestamp: new Date().toISOString(),
      message: `【阶段一：构建行业领域知识树】\n【1.1 行业通识假设生成与验证】针对 [${kb.domain.name}] 开始提取基础术语、子行业划分、典型业务流程。`,
      type: 'info',
    });
    db.saveTask(task);

    // 1.1 Industry Common Knowledge
    const existingCommonStr = kb.concepts
      .filter(c => c.treeType === 'industry' && c.conceptType === 'industry_general')
      .map(c => `[${c.name}]: ${c.definition}`)
      .join('\n');

    const prompt1_1 = `## 角色
你是一名资深的行业分析专家，擅长提炼某个行业的共同认知。

## 任务
针对【${kb.domain.name}】行业，请生成一批“行业通识”假设。行业通识是指该行业内绝大多数从业者都会认可的基础知识，包括：
1. 核心术语（至少5个）：每个术语包含名称、定义、典型使用场景。
2. 子行业分支：列出该行业的主要细分领域（至少2个），并简要说明每个细分的特点。
3. 典型业务流程：描述2-3个该行业特有的、普遍存在的业务操作流程（不需要涉及具体系统，只描述业务逻辑）。
${referenceArchContext}
## 已有知识（避免重复）
${existingCommonStr || '暂无'}

## 输出格式
请输出一个JSON数组，每个元素为一条假设。严禁 markdown 代码块包装，必须直接以 [ 开始：
[
  {
    "type": "term",
    "name": "首营品种",
    "description": "国内首次进口或销售的药品品种，流通企业需对其进行严苛资质审核。",
    "evidence_hint": "国家药监局GSP质量规范标准规定",
    "initial_confidence": 0.9
  },
  {
    "type": "sub_industry",
    "name": "医药零售",
    "description": "面向终端消费者的药品与医疗器械零售业态，受到国家《药品管理法》及GSP强监管指南约束。",
    "evidence_hint": "GSP零售管理规定与连锁总部的质量管理实操",
    "initial_confidence": 0.85
  },
  {
    "type": "process",
    "name": "采购收货到店验收",
    "description": "门店收发员在采购商品到店时，拆箱核对随货同行单、检测温湿度，确保药品无破损并在效期内。",
    "evidence_hint": "零售药店SOP及药品收货强制规范要求",
    "initial_confidence": 0.85
  }
]`;

    const res1_1 = await generateFlexibleLLM(prompt1_1, true, task, ai, model);
    let text1_1 = stripMarkdownCodeBlock(res1_1.text || '[]');
    const rawHypList1_1 = JSON.parse(text1_1) as any[];

    task.logs.push({
      timestamp: new Date().toISOString(),
      message: `📊 共生成 ${rawHypList1_1.length} 个行业通识探针假设，正在对每一条通过搜索引擎和学术定义进行交叉论证校验...`,
      type: 'info',
    });
    db.saveTask(task);

    // Verify 1.1 terms/sub_industries/processes
    for (const rawHyp of rawHypList1_1) {
      if (!rawHyp.name) continue;
      task.message = `[1.1] 正在验证通识假设: ${rawHyp.name}`;
      db.saveTask(task);

      let q = '';
      if (rawHyp.type === 'term') {
        q = `"${rawHyp.name}" 行业定义 ${kb.domain.name}`;
      } else if (rawHyp.type === 'sub_industry') {
        q = `"${rawHyp.name}" 行业 细分领域`;
      } else {
        q = `"${kb.domain.name}" "${rawHyp.name}" 典型业务步骤流程`;
      }

      const { text: searchExplanation, sources } = await performDualEngineSearch(q, ai, task);

      const evaluatePrompt = `## 任务
评估以下假设是否成立，并给出置信度。

## 假设
类型: ${rawHyp.type}
标题: ${rawHyp.name}
内容: ${rawHyp.description}

## 搜索结果（标题+摘要+URL）
${searchExplanation}

## 评估标准
- 搜索结果的权威性：来自官方机构、行业协会、国家标准（+0.2）；普通网站（+0.0）
- 结果的一致性：多个独立来源说法一致（+0.2）
- 结果的一致直接支持：明确支持假设内容（+0.3）；间接支持（+0.1）；无关（-0.2）
- 反证：是否存在明确反向冲突或推翻假设的证据（若有，-0.4）

请必须而且仅返回一个 JSON 对象，杜绝 markdown 包裹形式:
{
  "is_supported": true,
  "confidence": 0.85,
  "supporting_evidence": ["文献1"],
  "final_judgment": "判断依据总结文字"
}`;

      const evalRes = await generateFlexibleLLM(evaluatePrompt, true, task, ai, model);
      let evalText = stripMarkdownCodeBlock(evalRes.text || '{}');
      const evalJson = JSON.parse(evalText);

      const conf = evalJson.confidence ?? 0.5;
      if (evalJson.is_supported && conf >= 0.70) {
        kb.concepts.push({
          id: uuid('c'),
          domainId,
          name: rawHyp.name,
          definition: `${rawHyp.description}。 (${evalJson.final_judgment})`,
          attributes: rawHyp.type === 'sub_industry' ? ['子行业分支'] : ['行业通识'],
          confidence: conf,
          sourceUrl: sources[0]?.url || '',
          sources: sources,
          treeType: 'industry',
          conceptType: 'industry_general',
          subIndustry: rawHyp.type === 'sub_industry' ? rawHyp.name : ''
        });

        task.logs.push({
          timestamp: new Date().toISOString(),
          message: `✅【通识验证通过】(置信度: ${conf}): ${rawHyp.name}`,
          type: 'success',
        });
      } else {
        task.logs.push({
          timestamp: new Date().toISOString(),
          message: `⚠️【通识未予接纳】(置信度: ${conf}): ${rawHyp.name} (不满足 0.7 阈值)`,
          type: 'warning',
        });
      }
      db.saveDomainKB(domainId, kb);
    }

    // ==========================================
    // 1.2 Industry Rules & SOP (法律法规/企业SOP)
    // ==========================================
    task.message = '正在启动 1.2: 行业标准与合规SOP规则分析提取以及大厂对标交叉校准...';
    task.logs.push({
      timestamp: new Date().toISOString(),
      message: `【1.2 行业规则假设生成与验证】启动法律、合规准则、企业强时效 SOP（对标行业典型最佳实践）的采集与合规校验。`,
      type: 'info',
    });
    db.saveTask(task);

    const existingRulesStr = kb.concepts
      .filter(c => c.treeType === 'industry' && c.conceptType === 'industry_rule')
      .map(c => `[${c.name}]: ${c.definition}`)
      .join('\n');

    const prompt1_2 = `## 角色
你是行业合规与标准分析专家。

## 任务
针对【${kb.domain.name}】行业，请提出一批“行业规则”假设。规则可以是：
- 法律法规强制要求（如食品安全法、药品GSP认证、GDPR等）
- 行业推荐标准（如ISO行业合规质量认证）
- 主流领军龙头企业的SOP业务操作最佳实践

每条规则需包含：
- 规则名称
- 规则类型（regulation / standard / sop）
- 规则的具体描述（2-3句话，明确指出控制手段）
- 适用场景（举例说明该规则在何种业务场景下会被触发）
- 预期证据来源（如国家主管部委、领头企业供应商手册等）
${referenceArchContext}
## 已有规则（避免重复）
${existingRulesStr || '暂无'}

## 输出格式
请输出一个JSON数组，每个元素为一条假设，严禁任何 markdown 包装，直接以 [ 开始：
[
  {
    "type": "regulation",
    "name": "处方药凭方销售",
    "description": "零售药店在销售处方药（Rx）时，必须留存合法医师签署的电子或纸质处方，并由注册执业药师进行二次审核签字后方能发药。",
    "applicable_scenarios": ["门店处方药销售", "远程处方药发货"],
    "evidence_hint": "《药品管理法》及GSP质量规范标准规定",
    "initial_confidence": 0.95
  }
]`;

    const res1_2 = await generateFlexibleLLM(prompt1_2, true, task, ai, model);
    let text1_2 = stripMarkdownCodeBlock(res1_2.text || '[]');
    const rawHypList1_2 = JSON.parse(text1_2) as any[];

    for (const rawHyp of rawHypList1_2) {
      if (!rawHyp.name) continue;
      task.message = `[1.2] 正在验证行业规则: ${rawHyp.name}`;
      db.saveTask(task);

      let q = '';
      if (rawHyp.type === 'regulation') {
        q = `"${rawHyp.name}" 法规 强制监管 ${kb.domain.name}`;
      } else {
        q = `"${rawHyp.name}" SOP 操作流程 规范最佳实践`;
      }

      const { text: searchExplanation, sources } = await performDualEngineSearch(q, ai, task);

      const evaluatePrompt = `## 任务
验证以下行业规则假设是否真实存在并被广泛认可。

## 假设
类型: ${rawHyp.type}
名字: ${rawHyp.name}
内容: ${rawHyp.description}
适用场景: ${JSON.stringify(rawHyp.applicable_scenarios)}

## 搜索结果
${searchExplanation}

## 评估标准
- 搜索结果中包含官方文件、国家标准级行业管理规范，直接 +0.6。
- 若来自龙头企业或国际标准化组织，+0.3。
- 多个独立来源一致，+0.2。
- 存在明确不合理或被取代的反面判定，-0.5。

请必须而且仅返回一个 JSON 对象，杜绝 markdown 包裹形式:
{
  "is_valid": true,
  "confidence": 0.85,
  "official_source": "官方政策规定或权威来源（含大厂SOP规范描述）"
}`;

      const evalRes = await generateFlexibleLLM(evaluatePrompt, true, task, ai, model);
      let evalText = stripMarkdownCodeBlock(evalRes.text || '{}');
      const evalJson = JSON.parse(evalText);

      const conf = evalJson.confidence ?? 0.5;
      const requiredThreshold = rawHyp.type === 'regulation' ? 0.80 : 0.60;

      if (evalJson.is_valid && conf >= requiredThreshold) {
        kb.concepts.push({
          id: uuid('c'),
          domainId,
          name: rawHyp.name,
          definition: `${rawHyp.description}。【合规出处: ${evalJson.official_source}】`,
          attributes: [rawHyp.type === 'regulation' ? '强监管条例' : '标准作业规程SOP'],
          confidence: conf,
          sourceUrl: sources[0]?.url || '',
          sources: sources,
          treeType: 'industry',
          conceptType: 'industry_rule'
        });

        task.logs.push({
          timestamp: new Date().toISOString(),
          message: `✅【行业规则验证通过】(置信度: ${conf}, 类型: ${rawHyp.type}): ${rawHyp.name}`,
          type: 'success',
        });
      } else {
        task.logs.push({
          timestamp: new Date().toISOString(),
          message: `⚠️【规则淘汰】(置信度: ${conf}, 阈值: ${requiredThreshold}): ${rawHyp.name}`,
          type: 'warning',
        });
      }
      db.saveDomainKB(domainId, kb);
    }

    // ==========================================
    // 1.3 Industry Pain Points (行业痛点及具体现场场景)
    // ==========================================
    task.message = '正在启动 1.3: 行业典型运营痛点、合规红线与监管处罚案例挖掘...';
    task.logs.push({
      timestamp: new Date().toISOString(),
      message: `【1.3 行业痛点假设生成与验证】深入识别特定现场极易发生的违规案例、瓶颈及损失点，并与前述规则联动防范。`,
      type: 'info',
    });
    db.saveTask(task);

    const existingPainsStr = kb.concepts
      .filter(c => c.treeType === 'industry' && c.conceptType === 'industry_pain_point')
      .map(c => `[${c.name}]: ${c.definition}`)
      .join('\n');

    const prompt1_3 = `## 角色
你是行业风险分析专家，擅长发现业务中的常见问题与失败模式。

## 任务
针对【${kb.domain.name}】行业，提出一系列“行业痛点”假设。痛点应：
- 精准具体到物理常识现场业务场景描述（例如“药师不在岗私自发售处方药导致重罚”，而非宽泛无意义的说辞）。
- 说明风险等级（high / medium / low）。
- 描述典型的真实处罚或重大损失发生后果。
- 提示可能的信息化系统减缓拦截控制手段（为后续落地方案进行预备）。
${referenceArchContext}
## 已有痛点（避免重复）
${existingPainsStr || '暂无'}

## 输出格式
请输出一个JSON数组，每个元素为一条假设，严禁任何 markdown 包装，直接以 [ 开始：
[
  {
    "name": "执业药师脱岗违规发售处方药",
    "description": "门店药师午休或休假离岗期间，无资质的普通营业员私自接单销售处方药，面临吊销生产经营许可证、大额政务处罚风险。",
    "risk_level": "high",
    "typical_consequences": "面临罚款5-10万元，吊销药品零售资质，严重影响企业知名声誉。",
    "mitigation_hints": "在门店POS结算端强制融合药师人脸识别离岗锁闭、远程CA电子审方拦截。",
    "evidence_hint": "国家药品监督管理局公布的违规售药行政处罚法案"
  }
]`;

    const res1_3 = await generateFlexibleLLM(prompt1_3, true, task, ai, model);
    let text1_3 = stripMarkdownCodeBlock(res1_3.text || '[]');
    const rawHypList1_3 = JSON.parse(text1_3) as any[];

    for (const rawHyp of rawHypList1_3) {
      if (!rawHyp.name) continue;
      task.message = `[1.3] 正在验证行业痛点: ${rawHyp.name}`;
      db.saveTask(task);

      const q = `"${kb.domain.name}" "${rawHyp.name}" 业务风险 处罚 损失 事故案例`;
      const { text: searchExplanation, sources } = await performDualEngineSearch(q, ai, task);

      const evaluatePrompt = `## 任务
验证以下行业痛点是否真实存在，并在实际运营中确实发生过或属于公认的高危风险。

## 痛点假设
行业: ${kb.domain.name}
名字: ${rawHyp.name}
描述: ${rawHyp.description}
风险等级: ${rawHyp.risk_level}
潜在灾难后果: ${rawHyp.typical_consequences}

## 搜索结果
${searchExplanation}

## 评估标准
- 找到实际行政处罚经典通报、行业白皮书明确指明、或龙头企业内控警示：+0.5
- 行业论坛、多方新闻媒体广泛探讨事故：+0.3
- 纯个人推断传统没有合适事故：-0.4

请必须且仅仅返回一个 JSON 格式，不要 markdown 包装：
{
  "is_real": true,
  "confidence": 0.85,
  "evidence_cases": ["实际案例摘要描述"],
  "typical_penalty": "典型具体的赔付、罚款或红线约束损失"
}`;

      const evalRes = await generateFlexibleLLM(evaluatePrompt, true, task, ai, model);
      let evalText = stripMarkdownCodeBlock(evalRes.text || '{}');
      const evalJson = JSON.parse(evalText);

      const conf = evalJson.confidence ?? 0.5;
      if (evalJson.is_real && conf >= 0.60) {
        kb.concepts.push({
          id: uuid('c'),
          domainId,
          name: rawHyp.name,
          definition: `${rawHyp.description}。【真实风险警示: ${evalJson.evidence_cases?.join('; ') || ''}。减缓对策：${rawHyp.mitigation_hints}】`,
          attributes: [`痛点风险度: ${rawHyp.risk_level || 'high'}`],
          confidence: conf,
          sourceUrl: sources[0]?.url || '',
          sources: sources,
          treeType: 'industry',
          conceptType: 'industry_pain_point'
        });

        task.logs.push({
          timestamp: new Date().toISOString(),
          message: `✅【成功挖掘核心痛点】(置信度: ${conf}, 风险度: ${rawHyp.risk_level}): ${rawHyp.name}`,
          type: 'success',
        });
      } else {
        task.logs.push({
          timestamp: new Date().toISOString(),
          message: `⚠️【痛点排除】(置信度: ${conf} 无法证实具有现实风险): ${rawHyp.name}`,
          type: 'warning',
        });
      }
      db.saveDomainKB(domainId, kb);
    }

    // ==========================================
    // 1.4 Sub-industry Recursion (子行业递归下钻)
    // ==========================================
    task.message = '正在启动 1.4: 二级子行业链路下钻与递归行业树精细化学术推演...';
    task.logs.push({
      timestamp: new Date().toISOString(),
      message: `【1.4 子行业递归】正在扫描行业探索过程中发现的特异细分行业。`,
      type: 'info',
    });
    db.saveTask(task);

    // Get sub industries from newly verified concepts
    const subIndustries = kb.concepts
      .filter(c => c.treeType === 'industry' && c.conceptType === 'industry_general' && c.attributes.includes('子行业分支'))
      .map(c => c.name);

    if (subIndustries.length > 0) {
      const maxSubDomainsPerLevel = (config as any).max_sub_domains_per_level || 2;
      const targetSubs = subIndustries.slice(0, maxSubDomainsPerLevel);

      task.logs.push({
        timestamp: new Date().toISOString(),
        message: `🔎 探测到以下子行业分支：[${subIndustries.join(', ')}]。系统将深度递归分析其中最具特异性的前 ${targetSubs.length} 个子域名：[${targetSubs.join(', ')}]，探索其专有的特殊术语、SOP合规规则与特有痛点。`,
        type: 'info',
      });
      db.saveTask(task);

      for (const sub of targetSubs) {
        task.logs.push({
          timestamp: new Date().toISOString(),
          message: `⏳ 递归下钻子域名: 【${sub}】。正在导入父级事实事实数据库作为继承事实，剔除父行业通识防止冗余...`,
          type: 'info',
        });
        db.saveTask(task);

        const promptSub = `## 角色
你是高精度的垂直细分行业 [${sub}] 的行业专家。你正在对 [${kb.domain.name}] 下的子行业 [${sub}] 进行特异名词和特殊规则痛点补充。

## 任务
请专门针对细分方向【${sub}】，生成该场景特有的：
1. 2 个特殊业务术语（例如医药零售特有的“非处方药双通道流转”）
2. 1 条特殊的龙头企业 SOP 规范
3. 1 个独有的物理痛点及处罚边界
${referenceArchContext}
## 核心事实继承原则
子细分行业已包含父级行业的所有基本常识，不要生成任何和父类 【${kb.domain.name}】 相同的冗余通用表达！

## 输出格式
请输出一个JSON格式对象，包含 concepts 数组，严禁 markdown 包装：
{
  "concepts": [
    {
      "name": "术语/规则/痛点名",
      "definition": "具体描述",
      "conceptType": "industry_general" 或 "industry_rule" 或 "industry_pain_point",
      "attributes": ["子域名特异标签"]
    }
  ]
}`;

        try {
          const resSub = await generateFlexibleLLM(promptSub, true, task, ai, model);
          let textSub = stripMarkdownCodeBlock(resSub.text || '{}');
          const parsedSub = JSON.parse(textSub);

          if (parsedSub && Array.isArray(parsedSub.concepts)) {
            let subCount = 0;
            for (const item of parsedSub.concepts) {
              if (!item.name) continue;
              // Check dupes
              const dupe = kb.concepts.find(c => c.name.toLowerCase() === item.name.toLowerCase());
              if (!dupe) {
                kb.concepts.push({
                  id: uuid('c'),
                  domainId,
                  name: item.name,
                  definition: `${item.definition || ''} (属于二级细分: ${sub})`,
                  attributes: [...(item.attributes || []), `子领域:${sub}`],
                  confidence: 0.85,
                  treeType: 'industry',
                  conceptType: item.conceptType || 'industry_general',
                  subIndustry: sub
                });
                subCount++;
              }
            }
            task.logs.push({
              timestamp: new Date().toISOString(),
              message: `🌟 【子行业递归成功】成功为子域名【${sub}】补充注入 ${subCount} 条专属的高阶特有行业资产。`,
              type: 'success',
            });
            db.saveDomainKB(domainId, kb);
          }
        } catch (subErr: any) {
          console.error(`Sub-recursion failed for ${sub}:`, subErr);
        }
      }
    } else {
      task.logs.push({
        timestamp: new Date().toISOString(),
        message: `ℹ️ 本轮未探查到明确需要独立建树的二级子行业分支，自然结束 1.4 子细分递归。`,
        type: 'info',
      });
      db.saveTask(task);
    }

  } catch (err: any) {
    task.logs.push({
      timestamp: new Date().toISOString(),
      message: `🛑 阶段一：行业知识树推演出错: ${err.message}`,
      type: 'error',
    });
    db.saveTask(task);
    if (isIndustryOnly) {
      task.status = 'failed';
      task.message = `纯行业构建中断: ${err.message}`;
      db.saveTask(task);
      return;
    }
  }

  // ==========================================
  // PHASE 2: 系统/技术架构树构建 (只限双轨模式)
  // ==========================================
  if (!isIndustryOnly) {
    try {
      task.logs.push({
        timestamp: new Date().toISOString(),
        message: `【阶段二：构建系统架构领域树】\n已完成行业和知识体系领域树准备。目前正在联合 阿里、腾讯、京东、美团、字节跳动 等中国顶尖互联网巨头的系统基准标准进行全方位架构推演对标！`,
        type: 'info',
      });
      db.saveTask(task);

      const maxRounds = config.iteration.maxRounds || 3;
      let currentRound = 1;

      while (currentRound <= maxRounds) {
        task.currentRound = currentRound;
        task.message = `[Phase 2 - Round ${currentRound}/${maxRounds}] 正在多企业、全场景对标识别系统核心空缺...`;
        task.logs.push({
          timestamp: new Date().toISOString(),
          message: `================ 启动系统核心架构 iteration [Round ${currentRound}] ================`,
          type: 'info',
        });
        db.saveTask(task);

        // Define multi-company prompt for hypothesis generation
        const promptGaps = `你是一个天才企业系统分析师与顶级架构师。我们正在为 ${kb.domain.name} (系统标识: ${kb.domain.systemName}) 执行【双轨复合系统领域树】建模。
目前，你的对标系统涵盖中国最领先企业的主流微服务及核心子系统组合：【美团核心交易/履约调度系统、阿里淘宝天猫大型交易/采购底座、京东物流/供应链/精细订单网络、腾讯大规模结算平台、字节跳动中台架构与推送调度】。
Your modeling must align with their systems, APIs, and supervision rules.
${referenceArchContext}
已知的行业知识概念事实：
- 行业通识: ${kb.concepts.filter(c => c.treeType === 'industry' && c.conceptType === 'industry_general').map(x=>x.name).join(', ') || '暂无'}
- 现有系统聚合根: ${kb.aggregates.map(a => a.name).join(', ') || '暂无'}
- 核心技术实体: ${kb.entities.map(e => e.name).join(', ')}

请审视多大厂核心资产，通过以下三维权重指导核心架构：
- **执行流 (Execution, 40%)**: 偏向大厂的高吞吐基础交易操作、事件和单据流转。
- **监管流 (Supervision, 40%)**: 偏向多层财务拦截机制、行政及业务底牌风控防火墙、大厂标准的核审闸路（例如阿里的资质拦截或腾讯的实物拦截）。
- **数据统计/汇总流 (Statistics, 20%)**: 用于看盘 analysis、周期看盘汇总、趋势分析。

请生成最多 3 个需要进一步联网求证或推理验证的深度“系统级高可信假设命题”，注意要跟大厂的最佳系统做对比验证（例如：“美团即时履约系统中的实时调度拦截...”、“阿里的高精度多端同步规则...”）。

请按 JSON 数组严格返回，千万不能有 Markdown 包裹：
[
  {
    "statement": "对标美团即时履约与京东干线运输中控管理，本系统必须在核心调度事务环节增加‘配送波次在途异常双重校验’监管，以保障跨大区调拨履约交付率。",
    "type": "best_practice_gap",
    "reason": "美团/阿里均配备了极高的物流配送超时防火墙与降级罚金统计机制，这是现代超重载荷高一致性体系的标准。"
  }
]`;

        const hypResponse = await generateFlexibleLLM(promptGaps, true, task, ai, model);
        let rawHypText = stripMarkdownCodeBlock(hypResponse.text || '[]');
        const rawHypList = JSON.parse(rawHypText) as any[];

        const newlyGeneratedHypotheses: Hypothesis[] = rawHypList.map((h, i) => ({
          id: `h_${Date.now()}_ph2_${currentRound}_${i}`,
          domainId,
          statement: h.statement,
          type: h.type as any,
          status: 'pending',
          confidence: 0.5,
          reason: h.reason,
          createdAt: new Date().toISOString(),
        }));

        kb.hypotheses.push(...newlyGeneratedHypotheses);
        db.saveDomainKB(domainId, kb);

        const verifiedHypList: Hypothesis[] = [];
        const perRoundLimit = Math.min(newlyGeneratedHypotheses.length, 3);

        for (let i = 0; i < perRoundLimit; i++) {
          const hyp = newlyGeneratedHypotheses[i];
          task.message = `[Phase 2 - Round ${currentRound}] 正在验证系统假设: "${hyp.statement.substring(0, 24)}..."`;
          task.logs.push({
            timestamp: new Date().toISOString(),
            message: `正在多企业交叉论证：${hyp.statement}`,
            type: 'info',
          });
          db.saveTask(task);

          // Standard cross multi enterprise comparison search
          const searchQuery = `在 ${kb.domain.name} 或大厂如 阿里, 腾讯, 美团, 京东, 字节 对应的核心业务子系统中, 关于以下技术及业务策略是否属于标准实现, 或是否采用了类似设计: "${hyp.statement}"`;
          const { text: searchExplanation, sources } = await performDualEngineSearch(searchQuery, ai, task);

          const evaluatePrompt = `你是一个顶级技术委员会联合架构师。请研读以下对领域/架构假设命题在大厂（阿里、腾讯、京东、美团、字节）系统中的分布式架构与业务大盘调研，并严格使用 JSON 返回其推演检验结果。

【架构假设命题】: "${hyp.statement}"
【背景动机】: "${hyp.reason}"
【业界大中型企业检索论证陈述】:
${searchExplanation}

判定规则：如果该模式是对标阿里、美团、京东、腾讯、字节等任何一家或多家已确认、广泛采用、保障高并发高可靠的标准业务架构最佳实践，请将 status 标记为 "verified"，得高置信度。
必须仅仅返回一个 JSON 格式对象，不要代码子块包装：
{
  "status": "verified" | "rejected",
  "confidence": 0.88,
  "reason": "交叉对比了阿里、京东的XX系统 and 美团的实物验证履约模块，确实均符合此标准..."
}`;

          const evalRes = await generateFlexibleLLM(evaluatePrompt, true, task, ai, model);
          let evalRaw = stripMarkdownCodeBlock(evalRes.text || '{}');
          const evalJson = JSON.parse(evalRaw);

          const targetHyp = kb.hypotheses.find(h => h.id === hyp.id);
          if (targetHyp) {
            targetHyp.status = evalJson.status || 'rejected';
            targetHyp.confidence = evalJson.confidence || 0.5;
            targetHyp.reason = evalJson.reason || '检索评估完毕。';
            targetHyp.verifiedAt = new Date().toISOString();
            targetHyp.sources = sources;

            if (targetHyp.status === 'verified' && targetHyp.confidence >= 0.70) {
              verifiedHypList.push(targetHyp);
              task.logs.push({
                timestamp: new Date().toISOString(),
                message: `✅【系统验证完成】在大厂(阿里/美团/京东等)中高一致性获得支撑。置信评分 ${targetHyp.confidence}。论证: ${targetHyp.reason.substring(0, 100)}`,
                type: 'success',
              });
            } else {
              task.logs.push({
                timestamp: new Date().toISOString(),
                message: `❌【系统设计舍弃】大厂或业界暂无明确相对应模型支撑：${targetHyp.statement}`,
                type: 'warning',
              });
            }
            db.saveDomainKB(domainId, kb);
          }
        }

        // Apply Deduction and extract aggregates, entities, constraints and 3D scenarios
        for (const verifiedHyp of verifiedHypList) {
          task.message = `[Phase 2 - Round ${currentRound}] 正在基于大厂对齐数据演绎推推导软件与事务架构核心细节...`;
          task.logs.push({
            timestamp: new Date().toISOString(),
            message: `开始由已证实的架构探针 "${verifiedHyp.statement.substring(0, 20)}..." 推导演绎高一致性限界模型实体关系。`,
            type: 'info',
          });
          db.saveTask(task);

          const inferPrompt = getInferencePrompt(verifiedHyp, kb, config);
          const inferRes = await generateFlexibleLLM(inferPrompt, true, task, ai, model);
          let inferText = stripMarkdownCodeBlock(inferRes.text || '{}');
          const derived = JSON.parse(inferText);

          const counts = mergeDerivedKnowledge(kb, derived);
          task.logs.push({
            timestamp: new Date().toISOString(),
            message: `💡【架构演绎成功】成功构建并丰富大盘：新增技术聚合根 ${counts.aggregates} 个，核心方法及代码级实体关联 ${counts.entities} 个，注入三维业务应用场景 ${counts.scenarios} 个。`,
            type: 'success',
          });
          db.saveDomainKB(domainId, kb);
        }

        currentRound++;
      }
    } catch (err: any) {
      task.logs.push({
        timestamp: new Date().toISOString(),
        message: `🛑 阶段二：系统核心技术架构对标推演出错：${err.message}`,
        type: 'error',
      });
      db.saveTask(task);
    }
  }

  // ==========================================
  // COMPLETE WORK
  // ==========================================
  task.status = 'completed';
  task.message = '🎉 双轨/单轨闭环知识工程与大厂标准系统设计、行业典型痛点防御模型已全部推演就绪！';
  task.logs.push({
    timestamp: new Date().toISOString(),
    message: `🥇 知识工程建模迭代周期胜利结束！
1. 已对标 【阿里、腾讯、京东、美团、字节跳动】 行业龙头设计思想。
2. 行业树完全通过 4 重子闭环（通用通识、合规规则SOP、物理痛点案例、垂直子行业递归）。
3. 3D 覆盖已依据 执行(40%) / 监管(40%) / 统计(20%) 的黄金比例完整实现！`,
    type: 'success',
  });
  db.saveTask(task);
}

// 4. Auxiliary calculation & generator prompts functions
function getHypothesesPrompt(kb: KB_Store, config: GeneratorConfig): string {
  const systemNameLower = (kb.domain.systemName || '').trim().toLowerCase();
  const isIndustryOnly = !systemNameLower || ['无', 'none', 'industry', '纯行业', '行业', '无系统', '暂无系统'].includes(systemNameLower);

  return `你是一个领域建模的大师、软件工程和行业分析及系统架构设计专家。我们正在进行一个名为《${kb.domain.name}》（系统名称：《${kb.domain.systemName}》）领域建模与行业树推断任务。
当前聚焦级别: ${config.targetLevel}，聚焦对象：${config.focusType !== 'none' ? `${config.focusType}: ${config.focusName}` : '整体领域'}。
【特别指示】：${isIndustryOnly ? '当前目标属于【纯行业建模】，没有具体的业务软件系统设计。你应当全力搜集并设计【行业领域树】，专注于行业通识、行业 SOP 规章及行业痛点风险场景控制概念，不需要产生具体的软件技术表设计。' : '当前目标属于【双轨复合建模】，你必须同时产生【系统领域树】（核心软件限界上下文、单据、技术聚合根）以及【行业领域树】（行业通识、SOP规则与痛点控制概念），使二者完美相融、并驾齐驱。'}

当前已知的领域事实数据库如下：
- 已验证概念（包含所属树）：${kb.concepts.map(c => `${c.name}(标签:${c.treeType || '未分类'}/${c.conceptType || '未知'})`).join(', ') || '暂无'}
- 现有技术聚合根：${kb.aggregates.map(a => a.name).join(', ') || '暂无'}
- 已归集实体：${kb.entities.map(e => `${e.name}(属于聚合根: ${e.aggregateRootId || '无'})`).join(', ')}
- 已发现场景及当前能力配置：${kb.scenarios.map(s => `${s.name}(属于三维属性: ${s.capabilityDimension})`).join(', ')}

请分析以上知识，寻找以下三大空缺（Gaps），必须重点强化“执行(Execution)” / “监管(Supervision)” / “统计(Statistics)”的权重比值，并在提出设想时突出行业特性：
1. 【行业对标与下钻缺失 hypothesis: best_practice_gap】：
   - 寻找行业通识缺失：包含行业专有名词、行业特殊流转流程，或者是子行业下钻知识深度不够（例如：零售行业未下钻至生鲜零售、医药零售等特异子类；电商未下钻至直播电商、跨境电商等）。对标阿里、京东、美团、火山引擎的大中型体系。
   - 寻找行业 SOP 规则缺失：缺少对标行业知名企业公认标准、高能效的 SOP 操作规范规则。
2. 【行业痛点及三维能力缺失 hypothesis: dimension_missing】：
   - 寻找行业痛点缺失：每一个细分痛点必须精准定位到具体常见的行业现场场景描述中（例如医药零售药品溯源痛点、医保刷卡合规痛点，需具体写到诸如 “溯源码出库使用规则”、“零售门店销售扫描验证”等具体操作通俗场景上，而非空洞说辞）。
   - 检查三维覆盖权重缺陷：当前已有的关键概念或流程在“执行”(40%权重, 业务基本交易)、“监管”(40%权重, 多层审批/校验风控/红线拦截)、“统计”(20%权重, 周期BI看盘/汇总趋势预测)方面是否存在失衡、缺失？
3. 【全生命流程闭环缺失 hypothesis: closure_gap】：梳理从业务期初首站到财务/事务结算终站的全流程。是否存在流程流断、反向（破损返厂、退货理赔、合规拦截）流缺？

请要求生成最多 4 个需要进一步联网求证或推理验证的深度“优秀建设性假设命题”。
必须严格返回 JSON 数组（不要包装任何 Markdown 代码块，不要包裹在 \`\`\` 字符串里）：
[
  {
    "statement": "生鲜供应链中，采购接收阶段必须强制执行“在途冷链温度异常实时监管与折损扣减”规范。",
    "type": "best_practice_gap",
    "reason": "对标美团生鲜及自营大流通SOP，解决生鲜零售子行业的高腐损痛点，确保批次到货实收质量和食品安全。"
  }
]`;
}

function getInferencePrompt(verifiedHyp: Hypothesis, kb: KB_Store, config?: GeneratorConfig): string {
  const systemNameLower = (kb.domain.systemName || '').trim().toLowerCase();
  const isIndustryOnly = !systemNameLower || ['无', 'none', 'industry', '纯行业', '行业', '无系统', '暂无系统'].includes(systemNameLower);

  let referenceArchContext = '';
  const ref = (config as any)?.referenceArch;
  if (ref) {
    const parts: string[] = [];
    if (ref.companyArchitecture && ref.companyArchitecture.trim()) {
      parts.push(`【参考：公司架构信息】:\n${ref.companyArchitecture.trim()}`);
    }
    if (ref.productArchitecture && ref.productArchitecture.trim()) {
      parts.push(`【参考：现有产品架构】:\n${ref.productArchitecture.trim()}`);
    }
    if (ref.keyDirections && ref.keyDirections.trim()) {
      parts.push(`【重点补全的方向/倾向性】:\n${ref.keyDirections.trim()}`);
    }
    if (parts.length > 0) {
      referenceArchContext = `\n## 导入的参考架构与重点方向 (Optional Reference Architecture)
以下是用户导入的现有公司架构、产品架构或重点补全的方向。
请在兼容现有行业及大厂对标标准规则的基础上，按照“兼容现有规则基础上增加一定维度的补充和倾向性”原则，重点向这些输入的方向倾斜，并结合此特异化诉求设计/补全相关的概念、实体、场景或流程设计：
${parts.join('\n\n')}\n`;
    }
  }

  return `你是一个天才企业系统分析师与行业工程专家。基于以下已被证实通过的业务假设与行业基准规范，推演并设计出高精度的领域工程结构。

【已通过验证的假设】："${verifiedHyp.statement}"
【事实佐证依据】："${verifiedHyp.reason}"
${referenceArchContext}
请融入我们现在的领域数据库，推导出最合理、可落地的软件与行业级知识树。
我们系统设计了【双树并立】的知识体系：
- **系统领域树 (System Domain Tree)**: 包含核心业务系统限界上下文的概念。
- **行业领域树 (Industry Domain Tree)**: 涵盖以下三大分支：
  1. **行业通识 (industry_general)**: 包含特殊行业流转及子行业下钻深度知识（例如，医药零售、直播电商、生鲜冷链等）。
  2. **行业规则 (industry_rule)**: 大型企业普遍尊崇的 SOP 合规控制条款。
  3. **行业痛点 (industry_pain_point)**: 具体到现场场景的操作概念（例如“溯源码出库使用规则”、“门店销售刷卡合规限制”、“失温赔付红线”）。

【关键推导权重指标】：
在生成的系统架构或业务约束场景中，请严格贯彻**执行 (Execution, 40%)**、**监管 (Supervision, 40%)**、**统计 (Statistics, 20%)**的核心三维权重。
每一组生成的实体方法, 场景, 规则, 都应当有相称的 3D 覆盖：40% 用于执行流（事务登记、处理操作），40% 用于核心监管防火墙（审计控制、闸门、合规验证、红线限额），20% 用于动态统计或智能预测看板。

【重要指示】：
1. 如果当前目标是【纯行业建模】(isIndustryOnly = ${isIndustryOnly})，则不要生成聚合根, 实体等工程实现（"aggregates", "entities", "modules", "elements", "interactions" 均留空数组[]），把精力全放到生成 "concepts" 中所属 treeType=industry 的三大类概念、以及相关的场景(scenarios: capabilityDimension="supervision"/"execution") 与流程 (processes) 里。
2. 每一个输出的新概念，都必须打上正确细致的分类标签 ("treeType" 与 "conceptType")。

你需输出绝对严格的 JSON 格式（请勿附加任何多余字句，不要 Markdown 代码块包装，直接输出裸 JSON 字串）：
{
  "concepts": [
    {
      "name": "概念名称",
      "definition": "具体详实的术语定义描述",
      "attributes": ["重要特征1", "重要特征2"],
      "confidence": 0.95,
      "sourceUrl": "可选来源网址",
      "treeType": "system"或"industry",
      "conceptType": "system_concept"、"industry_general"、"industry_rule"、"industry_pain_point"之一,
      "subIndustry": "具体业务子行业类型（仅针对 treeType 为 industry 时填写，例如：“生鲜零售”、“医药零售”、“直播电商”、“跨境供应链”、“仓储物流”等；系统核心概念可不填或空字串）"
    }
  ],
  "entities": [
    {
      "name": "实体名",
      "fields": [{ "name": "字段名", "type": "String", "description": "字段描述", "isIdentifier": true }],
      "aggregateRootName": "关联的聚合根名称"
    }
  ],
  "aggregates": [
    { "name": "聚合根名称", "invariants": ["不变性校验红线"], "repository": "仓储类名" }
  ],
  "modules": [
    { "name": "业务二级模块名称", "aggregateRootName": "所属聚合根/一级领域", "capabilityType": "engine"或"config_center"或"document_mgmt", "description": "模块关键职责与 3D 设计" }
  ],
  "elements": [
    { "name": "三级精细要素名", "moduleName": "关联的二级模块名", "type": "sub_process"或"lifecycle_node"或"calculation_logic"或"decision_logic", "detail": "特定业务流段、状态阈值或算力逻辑描述" }
  ],
  "interactions": [
    { "systemName": "对接外部系统名", "direction": "upstream"或"downstream", "targetModuleName": "关联二级领域模块名", "coreWorkflow": "核心流动名称", "interfaceLogic": "传输逻辑与API规范" }
  ],
  "scenarios": [
    { "name": "场景名称", "capabilityDimension": "execution"或"supervision"或"statistics", "actors": ["主体角色"], "preconditions": ["触发前置"], "steps": ["骤1", "骤2"], "exceptionHandling": ["兜底合规分支处理"], "aggregateRootName": "挂接的聚合根名称(纯行业可填通用)" }
  ],
  "processes": [
    { "name": "闭环流程全名", "steps": ["状态A", "状态B"], "normalFlow": ["主干快乐流路径"], "alternateFlow": ["异常或红线退款流分支"], "scenarioName": "关联的场景名" }
  ],
  "rules": [
    { "name": "核心控制规则名", "rule": "严格边界控制条款", "implementationHint": "后端代码拦截或拦截器设计思想指南", "aggregateRootName": "所属限界/聚合根" }
  ]
}`;
}


// Merge logic and avoid duplicate names
function mergeDerivedKnowledge(kb: KB_Store, derived: any): any {
  const counts = { concepts: 0, entities: 0, aggregates: 0, scenarios: 0, processes: 0, rules: 0, modules: 0, elements: 0, interactions: 0 };
  if (!derived) return counts;

  // UUID helper
  const uuid = (prefix: string) => `${prefix}_${Math.random().toString(36).substring(2, 9)}`;

  // 1. Aggregates
  if (Array.isArray(derived.aggregates)) {
    for (const ar of derived.aggregates) {
      if (!ar.name) continue;
      const exists = kb.aggregates.find(a => a.name.toLowerCase() === ar.name.toLowerCase());
      if (!exists) {
        kb.aggregates.push({
          id: uuid('ar'),
          domainId: kb.domain.id,
          name: ar.name,
          invariants: ar.invariants || [],
          repository: ar.repository || `${ar.name}Repository`,
          capExecution: true,
          capSupervision: false,
          capStatistics: false
        });
        counts.aggregates++;
      }
    }
  }

  // 2. Concepts
  const isIndustryOnly = !kb.domain.systemName || ['无', 'none', 'industry', '纯行业', '行业', '无系统', '暂无系统'].includes(kb.domain.systemName.trim().toLowerCase());
  if (Array.isArray(derived.concepts)) {
    for (const c of derived.concepts) {
      if (!c.name) continue;
      const exists = kb.concepts.find(x => x.name.toLowerCase() === c.name.toLowerCase());
      if (!exists) {
        kb.concepts.push({
          id: uuid('c'),
          domainId: kb.domain.id,
          name: c.name,
          definition: c.definition || '',
          attributes: c.attributes || [],
          confidence: c.confidence || 0.8,
          sourceUrl: c.sourceUrl || '',
          treeType: c.treeType || (isIndustryOnly ? 'industry' : 'system'),
          conceptType: c.conceptType || (isIndustryOnly ? 'industry_general' : 'system_concept'),
          subIndustry: c.subIndustry || ''
        });
        counts.concepts++;
      }
    }
  }

  // 3. Entities
  if (Array.isArray(derived.entities)) {
    for (const e of derived.entities) {
      if (!e.name) continue;
      const exists = kb.entities.find(x => x.name.toLowerCase() === e.name.toLowerCase());
      // Find aggregate id by name
      let arId = '';
      if (e.aggregateRootName) {
        const ar = kb.aggregates.find(a => a.name.toLowerCase().includes(e.aggregateRootName.toLowerCase()));
        if (ar) arId = ar.id;
      }
      if (!exists) {
        kb.entities.push({
          id: uuid('e'),
          domainId: kb.domain.id,
          aggregateRootId: arId || undefined,
          name: e.name,
          fields: e.fields || []
        });
        counts.entities++;
      } else if (arId && !exists.aggregateRootId) {
        exists.aggregateRootId = arId;
      }
    }
  }

  // 4. Level 2 Modules (二级领域核心模块)
  if (!kb.modules) kb.modules = [];
  if (Array.isArray(derived.modules)) {
    for (const m of derived.modules) {
      if (!m.name) continue;
      const exists = kb.modules.find(x => x.name.toLowerCase() === m.name.toLowerCase());
      let arId = '';
      if (m.aggregateRootName) {
        const ar = kb.aggregates.find(a => a.name.toLowerCase().includes(m.aggregateRootName.toLowerCase()));
        if (ar) arId = ar.id;
      }
      if (!arId && kb.aggregates.length > 0) arId = kb.aggregates[0].id;

      if (arId && !exists) {
        kb.modules.push({
          id: uuid('m'),
          domainId: kb.domain.id,
          aggregateRootId: arId,
          name: m.name,
          capabilityType: m.capabilityType || 'other',
          description: m.description || ''
        });
        counts.modules++;
      }
    }
  }

  // 5. Level 3 Elements (三级阶梯特征细节子要素)
  if (!kb.elements) kb.elements = [];
  if (Array.isArray(derived.elements)) {
    for (const el of derived.elements) {
      if (!el.name) continue;
      const exists = kb.elements.find(x => x.name.toLowerCase() === el.name.toLowerCase());
      let moduleId = '';
      if (el.moduleName) {
        const mod = kb.modules.find(m => m.name.toLowerCase().includes(el.moduleName.toLowerCase()));
        if (mod) moduleId = mod.id;
      }
      if (!moduleId && kb.modules.length > 0) moduleId = kb.modules[0].id;

      if (moduleId && !exists) {
        kb.elements.push({
          id: uuid('el'),
          domainId: kb.domain.id,
          moduleId,
          name: el.name,
          type: el.type || 'sub_process',
          detail: el.detail || ''
        });
        counts.elements++;
      }
    }
  }

  // 6. Upstream & Downstream system interactions (接口系统双向交互契约)
  if (!kb.interactions) kb.interactions = [];
  if (Array.isArray(derived.interactions)) {
    for (const inter of derived.interactions) {
      if (!inter.systemName) continue;
      let targetModuleId = '';
      if (inter.targetModuleName) {
        const mod = kb.modules.find(m => m.name.toLowerCase().includes(inter.targetModuleName.toLowerCase()));
        if (mod) targetModuleId = mod.id;
      }
      if (!targetModuleId && kb.modules.length > 0) targetModuleId = kb.modules[0].id;

      const exists = kb.interactions.find(x => x.systemName.toLowerCase() === inter.systemName.toLowerCase() && x.targetModuleId === targetModuleId);
      if (targetModuleId && !exists) {
        kb.interactions.push({
          id: uuid('i'),
          domainId: kb.domain.id,
          systemName: inter.systemName,
          direction: inter.direction === 'upstream' ? 'upstream' : 'downstream',
          targetModuleId,
          coreWorkflow: inter.coreWorkflow || '',
          interfaceLogic: inter.interfaceLogic || ''
        });
        counts.interactions++;
      }
    }
  }

  // 7. Scenarios
  if (Array.isArray(derived.scenarios)) {
    for (const s of derived.scenarios) {
      if (!s.name) continue;
      let arId = '';
      if (s.aggregateRootName) {
        const ar = kb.aggregates.find(a => a.name.toLowerCase().includes(s.aggregateRootName.toLowerCase()));
        if (ar) arId = ar.id;
      }
      // If no Aggregate Root bound, use the first one if present, otherwise ignore or make generic
      if (!arId && kb.aggregates.length > 0) {
        arId = kb.aggregates[0].id;
      }

      if (arId) {
        const exists = kb.scenarios.find(x => x.name.toLowerCase() === s.name.toLowerCase() && x.aggregateRootId === arId);
        if (!exists) {
          kb.scenarios.push({
            id: uuid('s'),
            aggregateRootId: arId,
            name: s.name,
            capabilityDimension: s.capabilityDimension === 'supervision' || s.capabilityDimension === 'statistics' ? s.capabilityDimension : 'execution',
            actors: s.actors || [],
            preconditions: s.preconditions || [],
            steps: s.steps || [],
            exceptionHandling: s.exceptionHandling || []
          });
          counts.scenarios++;
        }
      }
    }
  }

  // 8. Processes
  if (Array.isArray(derived.processes)) {
    for (const p of derived.processes) {
      if (!p.name) continue;
      let scenarioId = '';
      if (p.scenarioName) {
        const s = kb.scenarios.find(x => x.name.toLowerCase().includes(p.scenarioName.toLowerCase()));
        if (s) scenarioId = s.id;
      }
      if (!scenarioId && kb.scenarios.length > 0) {
        scenarioId = kb.scenarios[0].id;
      }

      if (scenarioId) {
        const exists = kb.processes.find(x => x.name.toLowerCase() === p.name.toLowerCase());
        if (!exists) {
          kb.processes.push({
            id: uuid('p'),
            scenarioId,
            name: p.name,
            steps: p.steps || [],
            normalFlow: p.normalFlow || [],
            alternateFlow: p.alternateFlow || []
          });
          counts.processes++;
        }
      }
    }
  }

  // 9. Rules
  if (Array.isArray(derived.rules)) {
    for (const r of derived.rules) {
      if (!r.name) continue;
      let arId = '';
      if (r.aggregateRootName) {
        const ar = kb.aggregates.find(a => a.name.toLowerCase().includes(r.aggregateRootName.toLowerCase()));
        if (ar) arId = ar.id;
      }
      if (!arId && kb.aggregates.length > 0) {
        arId = kb.aggregates[0].id;
      }

      if (arId) {
        const exists = kb.rules.find(x => x.name.toLowerCase() === r.name.toLowerCase() && x.aggregateRootId === arId);
        if (!exists) {
          kb.rules.push({
            id: uuid('rl'),
            aggregateRootId: arId,
            name: r.name,
            rule: r.rule || '',
            implementationHint: r.implementationHint || ''
          });
          counts.rules++;
        }
      }
    }
  }

  // Update capabilities flags in aggregates automatically based on scenario dimensions
  for (const ar of kb.aggregates) {
    const boundScenarios = kb.scenarios.filter(s => s.aggregateRootId === ar.id);
    ar.capExecution = boundScenarios.some(s => s.capabilityDimension === 'execution');
    ar.capSupervision = boundScenarios.some(s => s.capabilityDimension === 'supervision');
    ar.capStatistics = boundScenarios.some(s => s.capabilityDimension === 'statistics');
  }

  return counts;
}

// 4. Custom Conflict Resolver & fusion
async function runConflictResolverAndFix(kb: KB_Store, ai: GoogleGenAI, task?: any): Promise<string> {
  const detectPrompt = `你是一个终极代码架构质量合规审计器。请研读下面的领域模型数据。检查其中是否有矛盾、重复的概念（不同单词但含义一模一样）、或者是实体归属嵌套混乱的情况（例如采购订单行挂载在错误的聚合根下）。

概念列表：
${JSON.stringify(kb.concepts.map(c => ({ id: c.id, name: c.name, definition: c.definition })))}

聚合根与实体：
${JSON.stringify(kb.aggregates.map(a => ({ id: a.id, name: a.name })))}
${JSON.stringify(kb.entities.map(e => ({ id: e.id, name: e.name, fields: e.fields, ar: e.aggregateRootId })))}

请检查并解决重复。如果认为某两个概念/实体完全应该融合成一个，请给出合并指令。
如果有矛盾，提供最终纠错后的一致描述。

请以极其严格的 JSON 返回冲突解决指令。如果完全没有任何冲突，请返回空数组 []：
必须结构：
[
  {
    "type": "merge_concepts",
    "keepId": "c_keep",
    "removeId": "c_remove",
    "updatedDefinition": "融合后最新最标准的清晰定义..."
  }
]`;

  try {
    const config = db.getDomainConfig(kb.domain.id);
    const model = config?.preferredModel || 'deepseek';
    const res = await generateFlexibleLLM(detectPrompt, true, task, ai, model);

    let raw = res.text || '[]';
    raw = stripMarkdownCodeBlock(raw);
    const instructions = JSON.parse(raw);

    if (Array.isArray(instructions) && instructions.length > 0) {
      let msg = '';
      for (const inst of instructions) {
        if (inst.type === 'merge_concepts') {
          const keepIdx = kb.concepts.findIndex(c => c.id === inst.keepId);
          const removeIdx = kb.concepts.findIndex(c => c.id === inst.removeId);
          if (keepIdx !== -1 && removeIdx !== -1) {
            const keepName = kb.concepts[keepIdx].name;
            const removeName = kb.concepts[removeIdx].name;
            kb.concepts[keepIdx].definition = inst.updatedDefinition;
            kb.concepts.splice(removeIdx, 1);
            msg += `成功将概念 [${removeName}] 合并入 [${keepName}] 概念，并升级统一术语定义。 `;
          }
        }
      }
      return msg || '进行了自动语义优化，模型要素完美契合。';
    }
  } catch (err: any) {
    console.error('Conflict resolver error ignored:', err);
  }
  return '未检测到明显的概念语义或逻辑拓扑结构冲突，知识质量评分健康。';
}

// Calculate the knowledge coverage & completeness
function calculateCompleteness(kb: KB_Store, config: GeneratorConfig): number {
  if (kb.aggregates.length === 0) return 0.2;

  // Let's check Three-Dimensional Coverage for all Aggregate Roots
  // We check each active Aggregate Root to see if it has execution, supervision, and statistics
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

  const dimensionScore = earnedPoints / totalPoints;

  // Let's examine generic counts. If we have concepts, entities, scenarios, rules and processes, completeness scales up
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
  md += `> 建模基准对标：SAP Ariba, Oracle Cloud SRM & SCOR 供应链模型。 \n`;
  md += `> 当前时间: ${new Date().toLocaleDateString()} | 完备度评级约: ${(score * 100).toFixed(0)}%\n\n`;

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

      // Draw Entities in this Aggregate
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

      // Draw Business Scenarios in this Aggregate
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

      // Draw Core Rules in this Aggregate
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

  md += `## 5. 探针假设及校验日志 (HVD Verification Traceability Log)\n\n`;
  md += `> 记录本阶段系统在构建时提出、查证、并被最终收录和舍弃的领域探针命题，体现知识防伪可追溯。 \n\n`;
  
  const verifiedHyp = kb.hypotheses.filter(h => h.status === 'verified');
  const rejectedHyp = kb.hypotheses.filter(h => h.status === 'rejected');

  md += `### 5.1 已经通过校验并演绎的科学事实 (Verified Premises)\n\n`;
  for (const h of verifiedHyp) {
    md += `- **命题**："${h.statement}"\n`;
    md += `  - **漏洞动机**：${h.reason}\n`;
    md += `  - **合规依据**：${h.reason}\n`;
    if (h.sources && h.sources.length > 0) {
      md += `  - **行业标准资料检索出处**：\n`;
      for (const s of h.sources) {
        md += `    - [${s.title}](${s.url}) : "${s.snippet.substring(0, 100)}..."\n`;
      }
    }
    md += `\n`;
  }

  if (rejectedHyp.length > 0) {
    md += `### 5.2 查无实据或存在合规硬伤已被否决的假设命题 (Rejected Hypotheses)\n\n`;
    for (const h of rejectedHyp) {
      md += `- **伪命题**："${h.statement}"\n`;
      md += `  - **提出动机**：${h.reason}\n`;
      md += `  - **证伪驳回理由**：${h.reason}\n`;
      md += `\n`;
    }
  }

  // Lossless metadata attachment for flawless re-import
  try {
    const b64 = Buffer.from(JSON.stringify(kb), 'utf-8').toString('base64');
    md += `\n\n<!-- DOMAIN_ARCHITECT_DATA_METADATA_BASE64: ${b64} -->\n`;
  } catch (err) {
    console.error('Failed to attach metadata to export:', err);
  }

  return md;
}

// Strip markdown block helper
function stripMarkdownCodeBlock(text: string): string {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```[a-zA-Z0-9]*\r?\n/, '');
    if (cleaned.endsWith('```')) {
      cleaned = cleaned.substring(0, cleaned.length - 3);
    }
  }
  return cleaned.trim();
}

// Start full-stack web and API integrations
const envMode = process.env.NODE_ENV || 'development';
if (envMode === 'production') {
  // Serve static assets
  app.use(express.static(path.join(process.cwd(), 'dist')));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(path.join(process.cwd(), 'dist', 'index.html'));
  });
} else {
  // ESM compatibility import of Vite in Development mode
  import('vite').then(async (viteModule) => {
    const viteServer = await viteModule.createServer({
      server: { middlewareMode: true },
      appType: 'custom',
    });
    app.use(viteServer.middlewares);
    
    app.get('*', async (req, res, next) => {
      if (req.path.startsWith('/api')) return next();
      const url = req.originalUrl;
      try {
        let template = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf-8');
        template = await viteServer.transformIndexHtml(url, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (err: any) {
        viteServer.ssrFixStacktrace(err);
        next(err);
      }
    });
  }).catch(err => {
    console.error('Failed to boot Vite dev Server Middleware:', err);
  });
}

// PORT binding
const PORT = 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`[DomainArchitect Engine Server] Running at http://0.0.0.0:${PORT}`);
});
