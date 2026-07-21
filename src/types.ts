/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Domain {
  id: string;
  name: string;
  systemName: string;
  description: string;
  createdAt: string;
}

export interface Concept {
  id: string;
  domainId: string;
  name: string;
  definition: string;
  attributes: string[];
  confidence: number;
  sourceUrl?: string; // Reference link
  sources?: { title: string; url: string; snippet: string }[];
  treeType?: 'system' | 'industry';
  conceptType?: 'system_concept' | 'industry_general' | 'industry_rule' | 'industry_pain_point';
  subIndustry?: string; // Optional sub-industry categorizer for industry knowledge
}

export interface Entity {
  id: string;
  domainId: string;
  aggregateRootId?: string; // Belongs to which aggregate root
  name: string;
  fields: {
    name: string;
    type: string;
    description: string;
    isIdentifier: boolean;
  }[];
}

export interface AggregateRoot {
  id: string;
  domainId: string;
  name: string;
  invariants: string[];
  repository: string;
  capExecution: boolean;    // Execution dimension
  capSupervision: boolean;  // Supervision dimension
  capStatistics: boolean;   // Statistics dimension
}

export interface BusinessScenario {
  id: string;
  aggregateRootId: string;
  name: string;
  capabilityDimension: 'execution' | 'supervision' | 'statistics';
  actors: string[];
  preconditions: string[];
  steps: string[];
  exceptionHandling: string[];
}

export interface BusinessProcess {
  id: string;
  scenarioId: string;
  name: string;
  steps: string[];
  normalFlow: string[];
  alternateFlow: string[];
}

export interface CoreLogic {
  id: string;
  aggregateRootId: string;
  name: string;
  rule: string;
  implementationHint: string;
}

export interface Hypothesis {
  id: string;
  domainId: string;
  statement: string;
  type: 'best_practice_gap' | 'dimension_missing' | 'closure_gap';
  status: 'pending' | 'verified' | 'rejected';
  confidence: number;
  reason: string;
  createdAt: string;
  verifiedAt?: string;
  sources?: { title: string; url: string; snippet: string }[];
}

export interface KB_Store {
  domain: Domain;
  concepts: Concept[];
  entities: Entity[];
  aggregates: AggregateRoot[];
  scenarios: BusinessScenario[];
  processes: BusinessProcess[];
  rules: CoreLogic[];
  hypotheses: Hypothesis[];
  modules?: LevelTwoModule[];
  elements?: LevelThreeElement[];
  interactions?: SystemInteraction[];
  dependencies?: ModuleDependency[];
  isolatedNodeSearchAttempts?: Record<string, number>;
  lastBuiltConfig?: GeneratorConfig;
  checkpoints?: {
    phase1_1?: boolean;
    phase1_2?: boolean;
    phase1_3?: boolean;
    phase1_4?: boolean;
    phase2_round?: number;
    phase2_rounds?: Record<number, boolean>;
  };
}

export interface LevelTwoModule {
  id: string;
  domainId: string;
  aggregateRootId: string; // 关联一级领域 (聚合根 ID)
  name: string; // e.g., 价格核算引擎、基础配置中心、采购流程中心等
  capabilityType: 'engine' | 'config_center' | 'document_mgmt' | 'other' | string; // 引擎、配置中心、单据管理、其他
  description: string;
}

export interface LevelThreeElement {
  id: string;
  domainId: string;
  moduleId: string; // 关联二级领域 (模块 ID)
  name: string;
  type: 'sub_process' | 'lifecycle_node' | 'calculation_logic' | 'decision_logic' | string; // 子流程, 状态或生命周期节点、逻辑-计算、决策/判断
  detail: string;
}

export interface SystemInteraction {
  id: string;
  domainId: string;
  systemName: string; // e.g., ERP, OA, HR, WMS...
  direction: 'upstream' | 'downstream';
  targetModuleId: string; // 关联二级模块 ID
  coreWorkflow: string; // 二级领域核心流程
  interfaceLogic: string; // 交互及接口核心逻辑/API契约说明
}

export interface ModuleDependency {
  id: string;
  domainId: string;
  fromModuleId: string;
  toModuleId: string;
  type: 'rpc' | 'event' | 'db' | string; // 同步RPC, 异步事件, 共享DB, 等等
  description?: string;
}

export interface GeneratorConfig {
  domain: string;
  systemName: string;
  focusType: 'none' | 'entity' | 'aggregate_root';
  focusName: string;
  targetLevel: 'mvp' | 'standard' | 'enterprise';
  industryBenchmarks: {
    enabled: boolean;
    sources: string[];
  };
  capabilityMatrix: {
    execution: { required: boolean; weight: number };
    supervision: { required: boolean; weight: number };
    statistics: { required: boolean; weight: number };
  };
  iteration: {
    maxRounds: number;
    completenessThreshold: number;
    perRoundMaxHypotheses: number;
  };
  preferredModel?: 'deepseek' | 'gemini';
  referenceArch?: {
    companyArchitecture?: string;
    productArchitecture?: string;
    keyDirections?: string;
  };
}

export interface TokenStats {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface IterationProgress {
  taskId: string;
  domainName: string;
  status: 'idle' | 'running' | 'completed' | 'failed' | 'paused';
  currentRound: number;
  maxRounds: number;
  completeness: number;
  message: string;
  logs: { timestamp: string; message: string; type: 'info' | 'success' | 'warning' | 'error' }[];
  tokenStats?: TokenStats;
}
