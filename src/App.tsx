/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { 
  Compass, 
  Settings, 
  FileText, 
  Play, 
  RotateCw, 
  Trash2, 
  Plus, 
  Download, 
  Upload,
  CheckCircle2, 
  XCircle, 
  AlertTriangle, 
  Layers, 
  Search, 
  Cpu, 
  ChevronRight, 
  Database,
  Eye,
  Edit3,
  Lightbulb,
  X,
  PlusCircle,
  Clock,
  ExternalLink,
  BookOpen,
  Menu,
  Network
} from 'lucide-react';
import DependencyTopology from './components/DependencyTopology';
import { 
  Domain, 
  KB_Store, 
  GeneratorConfig, 
  IterationProgress, 
  Concept, 
  Entity, 
  AggregateRoot, 
  BusinessScenario, 
  BusinessProcess, 
  CoreLogic, 
  Hypothesis 
} from './types';

const formatTokens = (val?: number) => {
  if (!val) return '0';
  if (val >= 1000000) {
    return (val / 1000000).toFixed(2) + ' M';
  }
  if (val >= 1000) {
    return (val / 1000).toFixed(1) + ' k';
  }
  return val.toString();
};

export default function App() {
  // Navigation & View control
  const [activeTab, setActiveTab] = useState<'iteration' | 'glossary' | 'entities' | 'exports' | 'topology'>('iteration');
  const [showLeftPanel, setShowLeftPanel] = useState(true);
  const [showRightPanel, setShowRightPanel] = useState(true);
  const [showMobileMenu, setShowMobileMenu] = useState(false);
  const [showProbesModal, setShowProbesModal] = useState(false);
  const [showCapabilityModal, setShowCapabilityModal] = useState(false);
  
  // Storage state loaders
  const [domains, setDomains] = useState<Domain[]>([]);
  const [selectedDomainId, setSelectedDomainId] = useState<string>('');
  const [kb, setKb] = useState<KB_Store | null>(null);
  const [config, setConfig] = useState<GeneratorConfig | null>(null);
  
  // Form dialogs controls
  const [showCreateDomainModal, setShowCreateDomainModal] = useState(false);
  const [domainNameInput, setDomainNameInput] = useState('');
  const [domainSysNameInput, setDomainSysNameInput] = useState('');
  const [domainDescInput, setDomainDescInput] = useState('');
  const [isAnalyzingStructure, setIsAnalyzingStructure] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<{
    trackType: 'double' | 'single';
    systemName: string;
    reasoning: string;
    suggestedDescription: string;
  } | null>(null);
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState<string | null>(null);
  
  // Custom editing modal controls
  const [selectedConcept, setSelectedConcept] = useState<Concept | null>(null);
  const [selectedAggregate, setSelectedAggregate] = useState<AggregateRoot | null>(null);
  const [selectedEntity, setSelectedEntity] = useState<Entity | null>(null);
  const [selectedScenario, setSelectedScenario] = useState<BusinessScenario | null>(null);
  
  // Quick additions inline UI
  const [editMode, setEditMode] = useState<boolean>(false);
  const [newConceptForm, setNewConceptForm] = useState({ 
    name: '', 
    definition: '', 
    attributesStr: '', 
    confidence: 0.9, 
    sourceUrl: '',
    treeType: 'system' as 'system' | 'industry',
    conceptType: 'system_concept' as 'system_concept' | 'industry_general' | 'industry_rule' | 'industry_pain_point',
    subIndustry: ''
  });
  const [selectedConceptId, setSelectedConceptId] = useState<string | null>(null);
  const [editingConceptId, setEditingConceptId] = useState<string | null>(null);
  const [editingConceptForm, setEditingConceptForm] = useState({
    name: '',
    definition: '',
    attributesStr: '',
    sourceUrl: '',
    conceptType: 'system_concept' as 'system_concept' | 'industry_general' | 'industry_rule' | 'industry_pain_point',
    subIndustry: ''
  });
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({
    system: true,
    ind_general: true,
    ind_rule: true,
    ind_pain: true,
    ind_academic: true,
    ind_event: true,
    ind_special: true,
    ind_roles: true,
    ind_elite: true,
    ind_jargon: true,
    ind_taboo: true
  });
  const [glossarySearch, setGlossarySearch] = useState('');
  const [selectedSubIndustryFilter, setSelectedSubIndustryFilter] = useState<string>('all');
  const [isIdentifyingSubindustries, setIsIdentifyingSubindustries] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importStatusMsg, setImportStatusMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [expandedSubIndustries, setExpandedSubIndustries] = useState<Record<string, boolean>>({});
  const [newAggregateForm, setNewAggregateForm] = useState({ name: '', invariantsStr: '', repository: '' });
  const [newEntityForm, setNewEntityForm] = useState({ name: '', fieldsStr: '', arId: '' });
  const [newScenarioForm, setNewScenarioForm] = useState({ name: '', dimension: 'execution', actorsStr: '', preconditionsStr: '', stepsStr: '', exceptionsStr: '', arId: '' });
  const [newModuleForm, setNewModuleForm] = useState({ name: '', capabilityType: 'engine', description: '', arId: '' });
  const [newElementForm, setNewElementForm] = useState({ name: '', type: 'sub_process', detail: '', moduleId: '' });
  const [newInteractionForm, setNewInteractionForm] = useState({ systemName: '', direction: 'upstream', targetModuleId: '', coreWorkflow: '', interfaceLogic: '' });

  // Task & Polling states
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [taskProgress, setTaskProgress] = useState<IterationProgress | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  
  // Auto-scroller for log window
  const logsEndRef = useRef<HTMLDivElement>(null);

  // Safe Fetch Helper with robust auto-retry to withstand network glitches or dev-server restarts
  const safeFetchJson = async (url: string, options?: RequestInit, retries = 3, delay = 250) => {
    for (let i = 0; i < retries; i++) {
      try {
        const res = await fetch(url, options);
        if (!res.ok) {
          let msg = `Server returned status ${res.status}`;
          try {
            const body = await res.json();
            if (body && body.error) msg = body.error;
          } catch {}
          throw new Error(msg);
        }
        const contentType = res.headers.get('content-type') || '';
        if (!contentType.includes('application/json')) {
          throw new Error('Server returned non-JSON response');
        }
        return await res.json();
      } catch (err: any) {
        const isLast = i === retries - 1;
        if (isLast) {
          console.warn(`[API] safeFetchJson exhausted all ${retries} attempts for ${url}:`, err.message || err);
          throw err;
        }
        // Wait before next attempt with exponential backoff
        await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i)));
      }
    }
  };

  // Load all domains initially
  useEffect(() => {
    fetchDomains();
  }, []);

  // Fetch the active domains
  const fetchDomains = async () => {
    try {
      const data = await safeFetchJson('/api/domains');
      setDomains(data);
      if (data.length > 0 && !selectedDomainId) {
        setSelectedDomainId(data[0].id);
      }
    } catch (e: any) {
      console.warn('Error loading domains:', e?.message || e);
    }
  };

  // Trigger when selected domain shifts or resets
  useEffect(() => {
    if (selectedDomainId) {
      fetchDomainDetails(selectedDomainId);
      // Auto-fetch active tasks matching this domain name
      checkActiveTasks();
    }
  }, [selectedDomainId]);

  // Fetch KB & config details
  const fetchDomainDetails = async (id: string) => {
    try {
      const kbData = await safeFetchJson(`/api/domains/${id}/kb`);
      setKb(kbData);

      const cfgData = await safeFetchJson(`/api/domains/${id}/config`);
      setConfig(cfgData);
    } catch (e: any) {
      console.warn('Error fetching domain details:', e?.message || e);
    }
  };

  // Detect and synchronize active workflows running for this domain
  const checkActiveTasks = async () => {
    try {
      const data: IterationProgress[] = await safeFetchJson('/api/tasks');
      const currentDomainName = domains.find(d => d.id === selectedDomainId)?.name;
      
      const runningTask = data.find(t => t.domainName === currentDomainName && t.status === 'running');
      if (runningTask) {
        setActiveTaskId(runningTask.taskId);
        setTaskProgress(runningTask);
        setIsPolling(true);
      }
    } catch (e: any) {
      console.warn('Error checking active tasks:', e?.message || e);
    }
  };

  // Continuous loop checker for background execution status
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (isPolling && activeTaskId) {
      timer = setInterval(async () => {
        try {
          const data: IterationProgress = await safeFetchJson(`/api/tasks/${activeTaskId}`);
          setTaskProgress(data);
          
          // Re-fetch KB data continuously during active run to show live incremental knowledge updates
          if (selectedDomainId) {
            try {
              const kbData = await safeFetchJson(`/api/domains/${selectedDomainId}/kb`);
              setKb(kbData);
            } catch (kbErr) {
              console.warn('Live KB sync skipped due to network glitch:', kbErr);
            }
          }

          if (data.status === 'completed' || data.status === 'failed' || data.status === 'paused') {
            setIsPolling(false);
            setActiveTaskId(null);
            // final refresh
            if (selectedDomainId) {
              fetchDomainDetails(selectedDomainId);
            }
          }
        } catch (e: any) {
          console.warn('Polling error (likely transient):', e?.message || e);
          // Don't stop polling on a temporary single network blip, just log it, unless it persists
        }
      }, 2000);
    }
    return () => clearInterval(timer);
  }, [isPolling, activeTaskId, selectedDomainId]);

  // Scoll logs to bottom
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [taskProgress?.logs]);

  // Compute if the domain has no technical software system model
  const isIndustryOnly = !kb || !kb.domain.systemName || ['无', 'none', 'industry', '纯行业', '行业', '无系统', '暂无系统'].includes(kb.domain.systemName.trim().toLowerCase());

  useEffect(() => {
    if (isIndustryOnly && activeTab === 'entities') {
      setActiveTab('glossary');
    }
  }, [isIndustryOnly, activeTab]);

  // Handle Domain creation
  const handleCreateDomain = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!domainNameInput || !domainSysNameInput) return;
    try {
      const newDomain = await safeFetchJson('/api/domains', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: domainNameInput,
          systemName: domainSysNameInput,
          description: domainDescInput
        })
      });
      setDomains(prev => [...prev, newDomain]);
      setSelectedDomainId(newDomain.id);
      setShowCreateDomainModal(false);
      setDomainNameInput('');
      setDomainSysNameInput('');
      setDomainDescInput('');
    } catch (err: any) {
      console.error('Failed to create domain:', err);
    }
  };

  // Handle Domain delete
  const handleDeleteDomain = async (id: string) => {
    setShowDeleteConfirmModal(id);
  };

  const handleConfirmDeleteDomain = async () => {
    if (!showDeleteConfirmModal) return;
    const id = showDeleteConfirmModal;
    try {
      const res = await fetch(`/api/domains/${id}`, { method: 'DELETE' });
      if (res.ok) {
        const remaining = domains.filter(d => d.id !== id);
        setDomains(remaining);
        if (remaining.length > 0) {
          setSelectedDomainId(remaining[0].id);
        } else {
          setKb(null);
          setConfig(null);
          setSelectedDomainId('');
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setShowDeleteConfirmModal(null);
    }
  };

  // Perform intelligent domain track-type parsing
  const handleAnalyzeStructure = async () => {
    if (!domainNameInput.trim()) return;
    setIsAnalyzingStructure(true);
    setAnalysisResult(null);
    try {
      const data = await safeFetchJson('/api/domains/analyze-structure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: domainNameInput })
      });
      setAnalysisResult(data);
      if (data.systemName) {
        setDomainSysNameInput(data.systemName);
      }
      if (data.suggestedDescription) {
        setDomainDescInput(data.suggestedDescription);
      }
    } catch (err) {
      console.error('Failed to parse structure', err);
    } finally {
      setIsAnalyzingStructure(false);
    }
  };

  // Trigger iterative modeling loop
  const handleTriggerBuild = async () => {
    if (!selectedDomainId) return;
    try {
      // First save configuration changes to respect slider configurations
      if (config) {
        await safeFetchJson(`/api/domains/${selectedDomainId}/config`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(config)
        });
      }

      const data = await safeFetchJson(`/api/domains/${selectedDomainId}/build`, {
        method: 'POST'
      });
      setActiveTaskId(data.taskId);
      setIsPolling(true);
      // Start showing progress
      setTaskProgress({
        taskId: data.taskId,
        domainName: kb?.domain.name || '',
        status: 'running',
        currentRound: 1,
        maxRounds: config?.iteration.maxRounds || 5,
        completeness: 0,
        message: '正在初始化领域探针与检索器...',
        logs: [{ timestamp: new Date().toISOString(), message: '开始在后台建立认知推理通道，这可能需要两到三分钟...', type: 'info' }]
      });
    } catch (err: any) {
      alert(err.message || '无法启动生成循环。请检查 API Key 状态或连接服务器异常。');
    }
  };

  // Pause or Stop task
  const handleCancelTask = async () => {
    if (!activeTaskId) return;
    try {
      await fetch(`/api/tasks/${activeTaskId}/cancel`, { method: 'POST' });
      setIsPolling(false);
      setActiveTaskId(null);
      if (selectedDomainId) {
        fetchDomainDetails(selectedDomainId);
      }
    } catch (err) {
      console.error(err);
    }
  };

  // Handle Configuration Sliders & Focus Inputs
  const handleConfigChange = (key: string, value: any) => {
    if (!config) return;
    const updated = { ...config, [key]: value };
    setConfig(updated);
  };

  // Submit newly added manual concept
  const handleAddManualConcept = () => {
    if (!kb || !newConceptForm.name || !newConceptForm.definition) return;
    const isIndustryOnly = !kb.domain.systemName || ['无', 'none', 'industry', '纯行业', '行业', '无系统', '暂无系统'].includes(kb.domain.systemName.trim().toLowerCase());
    
    // Auto align based on mode constraints
    const treeType = isIndustryOnly ? 'industry' : (newConceptForm.treeType || 'system');
    const conceptType = isIndustryOnly 
      ? (newConceptForm.conceptType === 'system_concept' ? 'industry_general' : (newConceptForm.conceptType || 'industry_general'))
      : (newConceptForm.conceptType || 'system_concept');

    const newConceptObj: Concept = {
      id: `c_man_${Date.now()}`,
      domainId: kb.domain.id,
      name: newConceptForm.name,
      definition: newConceptForm.definition,
      attributes: newConceptForm.attributesStr.split(/[，,]/).map(s => s.trim()).filter(Boolean),
      confidence: Number(newConceptForm.confidence),
      sourceUrl: newConceptForm.sourceUrl || undefined,
      treeType,
      conceptType,
      subIndustry: newConceptForm.subIndustry || ''
    };

    const updatedKB = { ...kb, concepts: [...kb.concepts, newConceptObj] };
    saveKBDirectly(updatedKB);
    setNewConceptForm({ 
      name: '', 
      definition: '', 
      attributesStr: '', 
      confidence: 0.9, 
      sourceUrl: '',
      treeType: 'system',
      conceptType: 'system_concept',
      subIndustry: ''
    });
  };

  // Save manual modifications to existing standard glossary concept
  const handleSaveEditedConcept = () => {
    if (!kb || !editingConceptId || !editingConceptForm.name || !editingConceptForm.definition) return;
    const isIndustryOnly = !kb.domain.systemName || ['无', 'none', 'industry', '纯行业', '行业', '无系统', '暂无系统'].includes(kb.domain.systemName.trim().toLowerCase());
    
    // Auto align treeType depending on category classification
    const treeType = isIndustryOnly ? 'industry' : (editingConceptForm.conceptType === 'system_concept' ? 'system' : 'industry');

    const updatedConcepts = kb.concepts.map(c => {
      if (c.id === editingConceptId) {
        return {
          ...c,
          name: editingConceptForm.name,
          definition: editingConceptForm.definition,
          attributes: editingConceptForm.attributesStr.split(/[，,]/).map(s => s.trim()).filter(Boolean),
          sourceUrl: editingConceptForm.sourceUrl || undefined,
          treeType,
          conceptType: editingConceptForm.conceptType,
          subIndustry: editingConceptForm.subIndustry
        };
      }
      return c;
    });

    const updatedKB = { ...kb, concepts: updatedConcepts };
    saveKBDirectly(updatedKB);
    setEditingConceptId(null);
  };

  const [subIndustryStatusMsg, setSubIndustryStatusMsg] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Call server to automatically categorize concepts by sub-industry using Gemini AI and update local KB
  const handleIdentifySubIndustries = async () => {
    if (!selectedDomainId) return;
    setIsIdentifyingSubindustries(true);
    setSubIndustryStatusMsg({ text: '正在召唤行业分析专家智能提取子行业属性分类...', type: 'success' });
    try {
      const data = await safeFetchJson(`/api/domains/${selectedDomainId}/identify-subindustries`, {
        method: 'POST',
      });
      if (data.success && data.kb) {
        setKb(data.kb);
        setSubIndustryStatusMsg({ text: '🎉 行业公认子行业概念属性与所属类别全自动对标归网成功！已完成高精度结构化对齐。', type: 'success' });
        setTimeout(() => setSubIndustryStatusMsg(null), 6000);
      } else {
        setSubIndustryStatusMsg({ text: '自动识别二级子行业失败: ' + (data.error || '未知错误'), type: 'error' });
      }
    } catch (err: any) {
      setSubIndustryStatusMsg({ text: '自动分类网络请求异常: ' + err.message, type: 'error' });
    } finally {
      setIsIdentifyingSubindustries(false);
    }
  };

  // Handle uploading and importing of a domain Markdown specification file
  const handleImportMarkdown = async (file: File) => {
    if (!selectedDomainId) return;
    setIsImporting(true);
    setImportStatusMsg({ text: '正在读取并解析上传的 Markdown 架构说明书...', type: 'success' });
    
    try {
      const text = await file.text();
      const data = await safeFetchJson(`/api/domains/${selectedDomainId}/import`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ markdown: text }),
      });
      if (data.success && data.kb) {
        setKb(data.kb);
        // Refresh domains list in case domain name/description changed
        fetchDomains();
        setImportStatusMsg({ text: '🎉 领域知识架构文件成功导入，相关实体、聚合根及不变性校验校验已重新加载！', type: 'success' });
        setTimeout(() => setImportStatusMsg(null), 6000);
      } else {
        setImportStatusMsg({ text: '导入失败：' + (data.error || '解析未通过'), type: 'error' });
      }
    } catch (err: any) {
      setImportStatusMsg({ text: '网络请求或读取文件异常：' + err.message, type: 'error' });
    } finally {
      setIsImporting(false);
    }
  };

  // Submit newly added aggregate
  const handleAddManualAggregate = () => {
    if (!kb || !newAggregateForm.name) return;
    const newAR: AggregateRoot = {
      id: `ar_man_${Date.now()}`,
      domainId: kb.domain.id,
      name: newAggregateForm.name,
      invariants: newAggregateForm.invariantsStr.split(/[;\n]/).map(s => s.trim()).filter(Boolean),
      repository: newAggregateForm.repository || `${newAggregateForm.name}Repository`,
      capExecution: true,
      capSupervision: false,
      capStatistics: false
    };

    const updatedKB = { ...kb, aggregates: [...kb.aggregates, newAR] };
    saveKBDirectly(updatedKB);
    setNewAggregateForm({ name: '', invariantsStr: '', repository: '' });
  };

  // Submit newly added entity
  const handleAddManualEntity = () => {
    if (!kb || !newEntityForm.name) return;
    // parse fields from fieldsStr (format: name:type:desc)
    const fields = newEntityForm.fieldsStr.split('\n').map(line => {
      const parts = line.split(':');
      if (parts.length >= 2) {
        return {
          name: parts[0].trim(),
          type: parts[1].trim(),
          description: parts[2] ? parts[2].trim() : parts[0].trim(),
          isIdentifier: parts[0].toLowerCase().includes('id') || parts[3]?.trim().toLowerCase() === 'true'
        };
      }
      return null;
    }).filter(Boolean) as any[];

    const newEnt: Entity = {
      id: `e_man_${Date.now()}`,
      domainId: kb.domain.id,
      aggregateRootId: newEntityForm.arId || undefined,
      name: newEntityForm.name,
      fields: fields.length > 0 ? fields : [{ name: 'id', type: 'String', description: '唯一标识', isIdentifier: true }]
    };

    const updatedKB = { ...kb, entities: [...kb.entities, newEnt] };
    saveKBDirectly(updatedKB);
    setNewEntityForm({ name: '', fieldsStr: '', arId: '' });
  };

  // Submit newly added scenario
  const handleAddManualScenario = () => {
    if (!kb || !newScenarioForm.name || !newScenarioForm.arId) return;

    const newSc: BusinessScenario = {
      id: `s_man_${Date.now()}`,
      aggregateRootId: newScenarioForm.arId,
      name: newScenarioForm.name,
      capabilityDimension: newScenarioForm.dimension as any,
      actors: newScenarioForm.actorsStr.split(/[，,]/).map(s => s.trim()).filter(Boolean),
      preconditions: newScenarioForm.preconditionsStr.split('\n').map(s => s.trim()).filter(Boolean),
      steps: newScenarioForm.stepsStr.split('\n').map(s => s.trim()).filter(Boolean),
      exceptionHandling: newScenarioForm.exceptionsStr ? [newScenarioForm.exceptionsStr] : []
    };

    const updatedKB = { ...kb, scenarios: [...kb.scenarios, newSc] };
    
    // Auto sync aggregate capabilities flags
    const arIdx = updatedKB.aggregates.findIndex(a => a.id === newScenarioForm.arId);
    if (arIdx !== -1) {
      if (newScenarioForm.dimension === 'execution') updatedKB.aggregates[arIdx].capExecution = true;
      if (newScenarioForm.dimension === 'supervision') updatedKB.aggregates[arIdx].capSupervision = true;
      if (newScenarioForm.dimension === 'statistics') updatedKB.aggregates[arIdx].capStatistics = true;
    }

    saveKBDirectly(updatedKB);
    setNewScenarioForm({ name: '', dimension: 'execution', actorsStr: '', preconditionsStr: '', stepsStr: '', exceptionsStr: '', arId: '' });
  };

  // Submit newly added manual Level 2 module
  const handleAddManualModule = () => {
    if (!kb || !newModuleForm.name || !newModuleForm.arId) return;
    const newL2 = {
      id: `m_man_${Date.now()}`,
      domainId: kb.domain.id,
      aggregateRootId: newModuleForm.arId,
      name: newModuleForm.name,
      capabilityType: newModuleForm.capabilityType,
      description: newModuleForm.description || ''
    };
    const updatedKB = {
      ...kb,
      modules: [...(kb.modules || []), newL2]
    };
    saveKBDirectly(updatedKB);
    setNewModuleForm({ name: '', capabilityType: 'engine', description: '', arId: '' });
  };

  // Submit newly added manual Level 3 element
  const handleAddManualElement = () => {
    if (!kb || !newElementForm.name || !newElementForm.moduleId) return;
    const newL3 = {
      id: `el_man_${Date.now()}`,
      domainId: kb.domain.id,
      moduleId: newElementForm.moduleId,
      name: newElementForm.name,
      type: newElementForm.type,
      detail: newElementForm.detail || ''
    };
    const updatedKB = {
      ...kb,
      elements: [...(kb.elements || []), newL3]
    };
    saveKBDirectly(updatedKB);
    setNewElementForm({ name: '', type: 'sub_process', detail: '', moduleId: '' });
  };

  // Submit newly added manual Interaction
  const handleAddManualInteraction = () => {
    if (!kb || !newInteractionForm.systemName || !newInteractionForm.targetModuleId) return;
    const newInter = {
      id: `i_man_${Date.now()}`,
      domainId: kb.domain.id,
      systemName: newInteractionForm.systemName,
      direction: newInteractionForm.direction,
      targetModuleId: newInteractionForm.targetModuleId,
      coreWorkflow: newInteractionForm.coreWorkflow || '',
      interfaceLogic: newInteractionForm.interfaceLogic || ''
    };
    const updatedKB = {
      ...kb,
      interactions: [...(kb.interactions || []), newInter]
    };
    saveKBDirectly(updatedKB);
    setNewInteractionForm({ systemName: '', direction: 'upstream', targetModuleId: '', coreWorkflow: '', interfaceLogic: '' });
  };

  // General deletion helper for nodes to respect "artificial modification"
  const handleDeleteNode = (type: 'concept' | 'aggregate' | 'entity' | 'scenario' | 'module' | 'element' | 'interaction', nodeId: string) => {
    if (!kb) return;
    let updatedKB = { ...kb };
    if (type === 'concept') {
      updatedKB.concepts = kb.concepts.filter(x => x.id !== nodeId);
    } else if (type === 'aggregate') {
      updatedKB.aggregates = kb.aggregates.filter(x => x.id !== nodeId);
      updatedKB.entities = kb.entities.filter(x => x.aggregateRootId !== nodeId);
      updatedKB.scenarios = kb.scenarios.filter(x => x.aggregateRootId !== nodeId);
    } else if (type === 'entity') {
      updatedKB.entities = kb.entities.filter(x => x.id !== nodeId);
    } else if (type === 'scenario') {
      updatedKB.scenarios = kb.scenarios.filter(x => x.id !== nodeId);
    } else if (type === 'module') {
      updatedKB.modules = (kb.modules || []).filter(x => x.id !== nodeId);
      updatedKB.elements = (kb.elements || []).filter(x => x.moduleId !== nodeId);
    } else if (type === 'element') {
      updatedKB.elements = (kb.elements || []).filter(x => x.id !== nodeId);
    } else if (type === 'interaction') {
      updatedKB.interactions = (kb.interactions || []).filter(x => x.id !== nodeId);
    }
    saveKBDirectly(updatedKB);
  };

  // Call API directly to update domain's KB store
  const saveKBDirectly = async (updatedKB: KB_Store) => {
    if (!selectedDomainId) return;
    setKb(updatedKB);
    try {
      await fetch(`/api/domains/${selectedDomainId}/kb`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedKB)
      });
    } catch (err) {
      console.error('Failed to save KB directly:', err);
    }
  };

  // Calculate 3D Dimensions Progress Bars percentages dynamically
  const getDimensionStats = () => {
    if (!kb) return { execution: 0, supervision: 0, statistics: 0 };
    
    // Default fallback if nothing generated yet
    if (kb.aggregates.length === 0 && kb.scenarios.length === 0) {
      return { execution: 0, supervision: 0, statistics: 0 };
    }

    let executionCount = 0;
    let supervisionCount = 0;
    let statisticsCount = 0;

    if (kb.aggregates.length > 0) {
      for (const ar of kb.aggregates) {
        if (ar.capExecution) executionCount++;
        if (ar.capSupervision) supervisionCount++;
        if (ar.capStatistics) statisticsCount++;
      }
      const total = kb.aggregates.length;
      return {
        execution: Math.round((executionCount / total) * 100),
        supervision: Math.round((supervisionCount / total) * 100),
        statistics: Math.round((statisticsCount / total) * 100)
      };
    } else {
      // Fallback/Calculation based on scenarios
      for (const s of kb.scenarios) {
        if (s.capabilityDimension === 'execution') executionCount++;
        else if (s.capabilityDimension === 'supervision') supervisionCount++;
        else if (s.capabilityDimension === 'statistics') statisticsCount++;
      }
      const total = kb.scenarios.length || 1;
      return {
        execution: Math.round((executionCount / total) * 100),
        supervision: Math.round((supervisionCount / total) * 100),
        statistics: Math.round((statisticsCount / total) * 100)
      };
    }
  };

  const dimStats = getDimensionStats();

  return (
    <div id="app" className="w-full min-h-screen bg-slate-50 flex flex-col lg:flex-row font-sans text-slate-900 select-none overflow-x-hidden">
      
      {/* MOBILE HEADER - Visible only on mobile/tablet */}
      <header id="mobile-header" className="lg:hidden h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 sticky top-0 z-30 shrink-0">
        <div className="flex items-center gap-2">
          <button 
            id="mobile-hamburger"
            onClick={() => setShowMobileMenu(true)}
            className="p-2 text-slate-600 hover:bg-slate-50 rounded cursor-pointer"
          >
            <Menu size={20} />
          </button>
          <div className="flex flex-col">
            <span className="font-bold text-sm text-slate-800 leading-none">DomainArchitect</span>
            <span className="text-[10px] text-slate-400 font-medium">LLM Engine</span>
          </div>
        </div>

        {kb && (
          <div className="flex items-center gap-1.5">
            <button 
              onClick={() => setShowProbesModal(true)}
              className="flex items-center gap-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-100 px-2 py-1 rounded text-[11px] font-bold transition-all cursor-pointer"
            >
              <Compass size={13} />
              <span>探针 ({kb.hypotheses.length})</span>
            </button>
            <button 
              onClick={() => setShowCapabilityModal(true)}
              className="flex items-center gap-1 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-100 px-2 py-1 rounded text-[11px] font-bold transition-all cursor-pointer"
            >
              <Layers size={13} />
              <span>3D能力 ({dimStats.execution}%)</span>
            </button>
          </div>
        )}
      </header>

      {/* MOBILE MENU DRAWER */}
      {showMobileMenu && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-50 flex lg:hidden">
          <div className="w-72 bg-white h-full shadow-2xl flex flex-col">
            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
              <span className="font-bold text-slate-800 text-sm">操作菜单</span>
              <button 
                onClick={() => setShowMobileMenu(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-full hover:bg-slate-50 cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-4 bg-slate-50 border-b border-slate-100">
              <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest block mb-1.5">Active Workspace</span>
              <select 
                value={selectedDomainId}
                onChange={(e) => {
                  setSelectedDomainId(e.target.value);
                  setShowMobileMenu(false);
                }}
                className="w-full bg-white border border-slate-200 rounded p-2 text-sm text-slate-800 font-medium"
              >
                {domains.map((dom) => (
                  <option key={dom.id} value={dom.id}>
                    {dom.name} ({dom.systemName})
                  </option>
                ))}
              </select>
            </div>

            <nav className="flex-1 py-4 overflow-y-auto space-y-1">
              <button 
                onClick={() => { setActiveTab('iteration'); setShowMobileMenu(false); }}
                className={`w-full flex items-center gap-3 px-6 py-3 text-left font-medium text-sm transition-all border-l-4 ${activeTab === 'iteration' ? 'bg-indigo-50 border-indigo-600 text-indigo-700 font-bold' : 'text-slate-600 hover:bg-slate-50 border-transparent'}`}
              >
                <Compass size={16} />
                <span>认知状态 & 推演</span>
              </button>
              
              <button 
                onClick={() => { setActiveTab('glossary'); setShowMobileMenu(false); }}
                className={`w-full flex items-center gap-3 px-6 py-3 text-left font-medium text-sm transition-all border-l-4 ${activeTab === 'glossary' ? 'bg-indigo-50 border-indigo-600 text-indigo-700 font-bold' : 'text-slate-600 hover:bg-slate-50 border-transparent'}`}
              >
                <BookOpen size={16} />
                <span>领域通用语汇表</span>
              </button>

              {!isIndustryOnly && (
                <button 
                  onClick={() => { setActiveTab('entities'); setShowMobileMenu(false); }}
                  className={`w-full flex items-center gap-3 px-6 py-3 text-left font-medium text-sm transition-all border-l-4 ${activeTab === 'entities' ? 'bg-indigo-50 border-indigo-600 text-indigo-700 font-bold' : 'text-slate-600 hover:bg-slate-50 border-transparent'}`}
                >
                  <Layers size={16} />
                  <span>聚合根与子级实体</span>
                </button>
              )}

              <button 
                onClick={() => { setActiveTab('exports'); setShowMobileMenu(false); }}
                className={`w-full flex items-center gap-3 px-6 py-3 text-left font-medium text-sm transition-all border-l-4 ${activeTab === 'exports' ? 'bg-indigo-50 border-indigo-600 text-indigo-700 font-bold' : 'text-slate-600 hover:bg-slate-50 border-transparent'}`}
              >
                <FileText size={16} />
                <span>配置微调 & 导出 MD</span>
              </button>

              <button 
                onClick={() => { setActiveTab('topology'); setShowMobileMenu(false); }}
                className={`w-full flex items-center gap-3 px-6 py-3 text-left font-medium text-sm transition-all border-l-4 ${activeTab === 'topology' ? 'bg-indigo-50 border-indigo-600 text-indigo-700 font-bold' : 'text-slate-600 hover:bg-slate-50 border-transparent'}`}
              >
                <Network size={16} />
                <span>架构拓扑与耦合分析</span>
              </button>
            </nav>

            <div className="p-4 border-t border-slate-200 bg-slate-50 text-[10.5px] text-slate-500 font-mono space-y-1">
              <div className="flex justify-between">
                <span>Rounds:</span>
                <span className="font-semibold text-slate-700">{taskProgress ? `${taskProgress.currentRound}/${taskProgress.maxRounds}` : '0/0'}</span>
              </div>
              <div className="flex justify-between">
                <span>Tokens:</span>
                <span className="font-semibold text-indigo-700">{formatTokens(taskProgress?.tokenStats?.totalTokens)}</span>
              </div>
            </div>
          </div>
          <div className="flex-1" onClick={() => setShowMobileMenu(false)} />
        </div>
      )}

      {/* 1. SIDEBAR ASYMMETRICAL COLUMN */}
      <aside id="aside-menu" className="hidden lg:flex w-72 bg-white border-r border-slate-200 flex flex-col h-screen sticky top-0 shrink-0">
        <div className="p-6 border-b border-slate-200">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-8 h-8 bg-indigo-600 flex items-center justify-center rounded-sm">
              <div className="w-4 h-4 border-2 border-white rotate-45"></div>
            </div>
            <span className="font-bold text-lg tracking-tight">DomainArchitect</span>
          </div>
          <p className="text-xs text-slate-400 uppercase tracking-widest font-semibold">LLM Knowledge Engine</p>
        </div>

        {/* Dynamic Domain selector */}
        <div className="p-4 border-b border-slate-100 bg-slate-50">
          <div className="flex justify-between items-center mb-2">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Active Workspace</span>
            <button 
              id="btn-create-domain-modal"
              onClick={() => setShowCreateDomainModal(true)}
              className="text-indigo-600 hover:text-indigo-800 flex items-center gap-1 text-xs font-medium cursor-pointer"
            >
              <PlusCircle size={14} />
              新建领域
            </button>
          </div>
          
          <select 
            id="workspace-select"
            value={selectedDomainId}
            onChange={(e) => setSelectedDomainId(e.target.value)}
            className="w-full bg-white border border-slate-200 rounded p-2 text-sm text-slate-800 font-medium focus:outline-none focus:border-indigo-500"
          >
            {domains.map((dom) => (
              <option key={dom.id} value={dom.id}>
                {dom.name} ({dom.systemName})
              </option>
            ))}
          </select>
        </div>

        {/* Navigation tabs */}
        <nav className="flex-1 py-4 overflow-y-auto">
          <div className="px-6 mb-2 text-xs font-bold text-slate-400 uppercase tracking-wider">Navigation</div>
          
          <button 
            id="nav-tab-iteration"
            onClick={() => setActiveTab('iteration')}
            className={`w-full flex items-center gap-3 px-6 py-3 text-left font-medium text-sm transition-all border-r-4 ${activeTab === 'iteration' ? 'bg-indigo-50 border-indigo-600 text-indigo-700' : 'text-slate-600 hover:bg-slate-50 border-transparent'}`}
          >
            <Compass size={16} className={`${activeTab === 'iteration' ? 'text-indigo-600' : 'text-slate-400'}`} />
            <span>认知状态 & 推演</span>
          </button>
          
          <button 
            id="nav-tab-glossary"
            onClick={() => setActiveTab('glossary')}
            className={`w-full flex items-center gap-3 px-6 py-3 text-left font-medium text-sm transition-all border-r-4 ${activeTab === 'glossary' ? 'bg-indigo-50 border-indigo-600 text-indigo-700' : 'text-slate-600 hover:bg-slate-50 border-transparent'}`}
          >
            <BookOpen size={16} className={`${activeTab === 'glossary' ? 'text-indigo-600' : 'text-slate-400'}`} />
            <span>领域通用语汇表</span>
          </button>

          {!isIndustryOnly && (
            <button 
              id="nav-tab-entities"
              onClick={() => setActiveTab('entities')}
              className={`w-full flex items-center gap-3 px-6 py-3 text-left font-medium text-sm transition-all border-r-4 ${activeTab === 'entities' ? 'bg-indigo-50 border-indigo-600 text-indigo-700' : 'text-slate-600 hover:bg-slate-50 border-transparent'}`}
            >
              <Layers size={16} className={`${activeTab === 'entities' ? 'text-indigo-600' : 'text-slate-400'}`} />
              <span>聚合根与子级实体</span>
            </button>
          )}

          <button 
            id="nav-tab-exports"
            onClick={() => setActiveTab('exports')}
            className={`w-full flex items-center gap-3 px-6 py-3 text-left font-medium text-sm transition-all border-r-4 ${activeTab === 'exports' ? 'bg-indigo-50 border-indigo-600 text-indigo-700' : 'text-slate-600 hover:bg-slate-50 border-transparent'}`}
          >
            <FileText size={16} className={`${activeTab === 'exports' ? 'text-indigo-600' : 'text-slate-400'}`} />
            <span>配置微调 & 导出 MD</span>
          </button>

          <button 
            id="nav-tab-topology"
            onClick={() => setActiveTab('topology')}
            className={`w-full flex items-center gap-3 px-6 py-3 text-left font-medium text-sm transition-all border-r-4 ${activeTab === 'topology' ? 'bg-indigo-50 border-indigo-600 text-indigo-700' : 'text-slate-600 hover:bg-slate-50 border-transparent'}`}
          >
            <Network size={16} className={`${activeTab === 'topology' ? 'text-indigo-600' : 'text-slate-400'}`} />
            <span>架构拓扑与耦合分析</span>
          </button>

          {/* Delete active workspace buttons */}
          {selectedDomainId && (
            <div className="px-6 mt-6">
              <button 
                id="btn-delete-workspace"
                onClick={() => handleDeleteDomain(selectedDomainId)}
                className="text-xs text-rose-500 hover:text-rose-700 font-medium flex items-center gap-1.5 cursor-pointer border border-rose-100 hover:border-rose-300 rounded px-2.5 py-1.5 transition-all w-full justify-center"
              >
                <Trash2 size={13} />
                删除当前项目域
              </button>
            </div>
          )}
        </nav>

        {/* Worker Status Indicators Area */}
        <div className="p-5 bg-slate-50 border-t border-slate-200">
          <div className="flex justify-between items-center mb-2">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-widest">Cognitive State</span>
            <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded ${isPolling ? 'bg-emerald-100 text-emerald-700 animate-pulse' : 'bg-slate-200 text-slate-600'}`}>
              {isPolling ? 'Working' : 'IDLE'}
            </span>
          </div>
          <div className="text-[11px] font-medium text-slate-600 flex items-center gap-1.5 mb-2">
            <Cpu size={14} className="text-slate-500" />
            <span>Gemini-3.5-Flash • Hybrid Grounding</span>
          </div>
          <div className="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
            <div 
              className={`h-full rounded-full transition-all duration-500 ${isPolling ? 'bg-indigo-600 animate-pulse' : 'bg-emerald-500'}`} 
              style={{ width: `${taskProgress ? (taskProgress.currentRound / taskProgress.maxRounds) * 100 : 100}%` }}
            ></div>
          </div>
          <div className="flex justify-between text-[10px] text-slate-400 mt-1">
            <span>Rounds: {taskProgress ? `${taskProgress.currentRound}/${taskProgress.maxRounds}` : '0/0'}</span>
            <span>Completeness: {taskProgress ? Math.round(taskProgress.completeness*100) : 0}%</span>
          </div>

          {/* Token Usage Stats Card */}
          <div className="mt-4 pt-3 border-t border-slate-200">
            <div className="flex justify-between items-center mb-1.5 text-[10px] uppercase font-bold text-slate-400 tracking-wider">
              <span className="flex items-center gap-1">📊 Token Usage</span>
              <span className="text-[9px] text-indigo-600 bg-indigo-50 border border-indigo-100 px-1.5 py-0.2 rounded font-mono font-medium">Stats</span>
            </div>
            <div className="bg-white rounded border border-slate-150 p-2 font-mono text-[10px] space-y-1 text-slate-600 shadow-2xs">
              <div className="flex justify-between items-center">
                <span>Prompt:</span>
                <span className="font-bold text-slate-700">{formatTokens(taskProgress?.tokenStats?.promptTokens)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span>Completion:</span>
                <span className="font-bold text-indigo-600">{formatTokens(taskProgress?.tokenStats?.completionTokens)}</span>
              </div>
              <div className="flex justify-between items-center border-t border-slate-100 pt-1 mt-1 font-bold text-[10.5px]">
                <span>Total Tokens:</span>
                <span className="text-slate-800">{formatTokens(taskProgress?.tokenStats?.totalTokens)}</span>
              </div>
              {taskProgress?.tokenStats?.totalTokens ? (
                <div className="flex justify-between items-center text-[9px] text-emerald-600 font-extrabold pt-0.5 border-t border-dashed border-slate-100 mt-1">
                  <span>Est. Cost:</span>
                  <span>
                    ${((taskProgress.tokenStats.promptTokens * 1.5 + taskProgress.tokenStats.completionTokens * 2.5) / 1000000).toFixed(4)} USD
                  </span>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </aside>

      {/* 2. MAIN WORKSPACE CONTENT */}
      <main className="flex-1 flex flex-col min-h-screen">
        
        {/* TOP BAR INFORMATION FRAME */}
        <header id="stage-header" className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8 sticky top-0 z-10 shrink-0">
          <div className="flex items-center gap-4 text-sm">
            <span className="text-slate-400 font-medium">目标领域:</span>
            <span className="font-bold text-slate-800">{kb?.domain.name || '空'}</span>
            <span className="text-slate-200">|</span>
            <span className="text-slate-400 font-medium">系统标识:</span>
            <span className="font-mono bg-indigo-50 border border-indigo-100 text-indigo-700 px-2 py-0.5 rounded text-xs font-semibold">
              {kb?.domain.systemName || 'SRM Pro'}
            </span>
          </div>
          {config && (
            <div className="flex items-center gap-3">
              {/* PC VIEW PANEL DISPLAY CONTROLS */}
              <div className="hidden lg:flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200 mr-2 md:mr-4 shrink-0">
                <button
                  onClick={() => setShowLeftPanel(prev => !prev)}
                  className={`px-2.5 py-1.5 rounded text-xs font-bold transition-all flex items-center gap-1 cursor-pointer select-none ${
                    showLeftPanel 
                      ? 'bg-white text-indigo-700 shadow-xs' 
                      : 'text-slate-500 hover:text-slate-700 shadow-none'
                  }`}
                  title="开关左侧探针列表"
                >
                  <Compass size={12} />
                  <span>左探针 {showLeftPanel ? '开' : '关'}</span>
                </button>
                <button
                  onClick={() => setShowRightPanel(prev => !prev)}
                  className={`px-2.5 py-1.5 rounded text-xs font-bold transition-all flex items-center gap-1 cursor-pointer select-none ${
                    showRightPanel 
                      ? 'bg-white text-indigo-700 shadow-xs' 
                      : 'text-slate-500 hover:text-slate-700 shadow-none'
                  }`}
                  title="开关右侧3D大盘"
                >
                  <Layers size={12} />
                  <span>右大盘 {showRightPanel ? '开' : '关'}</span>
                </button>
              </div>

              <span className="text-xs text-slate-400 font-mono hidden sm:inline">等级: <b className="text-slate-700 font-semibold">{config.targetLevel.toUpperCase()}</b></span>
              <div className="flex items-center gap-2 text-xs font-mono bg-slate-100 px-3 py-1.5 rounded border border-slate-200">
                <span className="text-slate-500 uppercase font-semibold">迭代目标:</span>
                <span className="text-indigo-600 font-extrabold">{config.iteration.maxRounds} 轮</span>
              </div>
            </div>
          )}
        </header>

        {/* FULL BENTO LAYOUT SWITCHER */}
        {kb ? (
          <div className="flex-1 flex flex-col lg:grid lg:grid-cols-12 overflow-hidden w-full">
            
            {/* COLUMN A (LEFT COLUMN): COGNITIVE PROBE MONITOR */}
            <div id="cognitive-col" className={`col-span-3 bg-white border-r border-slate-200 p-6 flex flex-col gap-6 max-h-[calc(100vh-4rem)] overflow-y-auto ${showLeftPanel ? 'lg:flex' : 'lg:hidden'} hidden lg:flex`}>
              <div>
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Cognitive Loop PROBES</h3>
                <p className="text-[11px] text-slate-500">“假设-验证-推导”闭环探针追踪日志</p>
              </div>

              {/* Hypotheses List */}
              <div className="flex-1 flex flex-col gap-4 overflow-y-auto">
                <h4 className="text-xs font-bold text-slate-700 border-b border-slate-100 pb-1 flex items-center gap-1.5">
                  <Compass size={14} className="text-indigo-600" />
                  建模假设 ({kb.hypotheses.length})
                </h4>
                
                {kb.hypotheses.length === 0 ? (
                  <div className="text-center py-8 text-slate-300">
                    <Lightbulb size={24} className="mx-auto mb-2 opacity-50" />
                    <p className="text-xs">暂无建模探索命题</p>
                    <p className="text-[10px] mt-1">启动认知引擎进行自动探索</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {kb.hypotheses.map((h) => {
                      const isVerified = h.status === 'verified';
                      const isRejected = h.status === 'rejected';
                      return (
                        <div 
                          key={h.id} 
                          className={`relative p-3.5 rounded border transition-all ${
                            isVerified ? 'bg-emerald-50/50 border-emerald-100' :
                            isRejected ? 'bg-rose-50/30 border-rose-100' :
                            'bg-slate-50 border-slate-200'
                          }`}
                        >
                          <div className="flex justify-between items-start mb-1.5">
                            <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 rounded ${
                              isVerified ? 'bg-emerald-100 text-emerald-800' :
                              isRejected ? 'bg-rose-100 text-rose-800' :
                              'bg-slate-200 text-slate-700'
                            }`}>
                              {h.type === 'best_practice_gap' ? '最优对标' :
                               h.type === 'dimension_missing' ? '三维缺陷' : '闭环补全'}
                            </span>
                            <span className="text-[10px] font-mono font-bold text-slate-400">
                              置信: {(h.confidence * 100).toFixed(0)}%
                            </span>
                          </div>

                          <p className={`text-xs font-medium leading-relaxed ${isRejected ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
                            {h.statement}
                          </p>

                          <div className="mt-2 pt-2 border-t border-dashed border-slate-200">
                            <p className="text-[10px] text-slate-500 leading-relaxed italic">
                              依据: {h.reason}
                            </p>
                          </div>

                          {/* Sources list */}
                          {h.sources && h.sources.length > 0 && (
                            <div className="mt-2 space-y-1">
                              <p className="text-[9px] font-bold text-indigo-600 uppercase tracking-wider">参考研讨出处:</p>
                              {h.sources.slice(0, 2).map((s, idx) => (
                                <a 
                                  key={idx} 
                                  href={s.url} 
                                  target="_blank" 
                                  rel="noopener noreferrer" 
                                  className="text-[9px] text-slate-400 hover:text-indigo-600 underline truncate block flex items-center gap-1"
                                >
                                  <ExternalLink size={8} />
                                  <span>{s.title || '基准资料'}</span>
                                </a>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* COLUMN B (MIDDLE COLUMN): THE ACTIVE ENGINE OR SPECS DISPLAY */}
            <div id="main-specs-col" className={`${(showLeftPanel && showRightPanel) ? 'lg:col-span-6' : (showLeftPanel || showRightPanel) ? 'lg:col-span-9' : 'lg:col-span-12'} col-span-12 bg-slate-50 p-4 lg:p-6 flex flex-col gap-6 max-h-[calc(100vh-4rem)] overflow-y-auto border-r border-slate-200 w-full`}>
              
              {/* Tabs list */}
              <div className="flex justify-between items-center bg-white p-1 rounded-lg border border-slate-200 shadow-sm shrink-0">
                <div className="flex gap-1 w-full">
                  <button 
                    id="btn-active-tab-iteration"
                    onClick={() => setActiveTab('iteration')}
                    className={`flex-1 py-2 text-xs font-bold rounded transition-all text-center ${activeTab === 'iteration' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'}`}
                  >
                    建模实时控制
                  </button>
                  <button 
                    id="btn-active-tab-glossary"
                    onClick={() => setActiveTab('glossary')}
                    className={`flex-1 py-2 text-xs font-bold rounded transition-all text-center ${activeTab === 'glossary' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'}`}
                  >
                    领域通用语汇 ({kb.concepts.length})
                  </button>
                  {!isIndustryOnly && (
                    <button 
                      id="btn-active-tab-entities"
                      onClick={() => setActiveTab('entities')}
                      className={`flex-1 py-2 text-xs font-bold rounded transition-all text-center ${activeTab === 'entities' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'}`}
                    >
                      架构拓扑 ({kb ? kb.aggregates.length : 0})
                    </button>
                  )}
                  <button 
                    id="btn-active-tab-exports"
                    onClick={() => setActiveTab('exports')}
                    className={`flex-1 py-2 text-xs font-bold rounded transition-all text-center ${activeTab === 'exports' ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'}`}
                  >
                    配置与导出
                  </button>
                </div>
              </div>

              {/* TAB 1: MODELING AND LOGGING REALTIME INTERACTION */}
              {activeTab === 'iteration' && (
                <div className="flex-1 flex flex-col gap-6">
                  
                  {/* Action core trigger */}
                  <div className="bg-white p-6 border border-slate-200 rounded-lg shadow-sm flex flex-col gap-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <h3 className="text-sm font-bold text-slate-800">启动“假设-验证-推导”全链路引擎</h3>
                        <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                          系统将全自动扫描当前模型弱点，通过搜索引擎与大厂标准进行交互，生成置信度评分通过的实体，形成严谨架构说明文件。
                        </p>
                      </div>
                      <Cpu size={24} className="text-indigo-600 shrink-0" />
                    </div>

                    <div className="border border-slate-100 bg-slate-50 p-3 rounded text-xs text-slate-600 leading-relaxed font-mono">
                      <b>对标基准</b>: SAP Ariba, Oracle Cloud srm, SCOR供应链模型 以及 3D 执行/监管/统计 闭环矩阵。
                    </div>

                    <div className="flex gap-3 mt-2">
                      {isPolling ? (
                        <button 
                          id="btn-stop-generation"
                          onClick={handleCancelTask}
                          className="flex-1 bg-rose-600 hover:bg-rose-700 text-white font-bold py-2.5 px-4 rounded text-sm flex items-center justify-center gap-2 cursor-pointer transition-all"
                        >
                          <XCircle size={16} />
                          停止/暂停执行
                        </button>
                      ) : (
                        <button 
                          id="btn-start-generation"
                          onClick={handleTriggerBuild}
                          className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 px-4 rounded text-sm flex items-center justify-center gap-2 cursor-pointer transition-all shadow-md group border-b-2 border-indigo-800"
                        >
                          <Play size={16} className="group-hover:scale-110 transition-transform" />
                          开始下一轮迭代推演
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Token usage dashboard card */}
                  {taskProgress && (
                    <div className="bg-white p-5 border border-slate-200 rounded-lg shadow-sm">
                      <h4 className="text-xs font-bold text-slate-700 uppercase tracking-widest mb-3 flex items-center gap-1.5 border-b border-slate-100 pb-2">
                        <Cpu size={14} className="text-indigo-600 animate-pulse" />
                        深度建模演绎大模型 Token 算力吞吐大盘 (Cognitive Engine Run-time Token Stats)
                      </h4>

                      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                        <div className="bg-slate-50 p-3.5 rounded border border-slate-200/60">
                          <span className="text-[10px] text-slate-400 uppercase block font-bold mb-1">输入提示 (Prompt Input)</span>
                          <span className="text-xl font-mono font-extrabold text-slate-700">{formatTokens(taskProgress.tokenStats?.promptTokens)}</span>
                          <span className="text-[9px] text-slate-400 block mt-1">系统提示、三层模型框架与对标规则输入</span>
                        </div>

                        <div className="bg-slate-50 p-3.5 rounded border border-slate-200/60">
                          <span className="text-[10px] text-slate-400 uppercase block font-bold mb-1">模型输出 (Completion Output)</span>
                          <span className="text-xl font-mono font-extrabold text-indigo-650">{formatTokens(taskProgress.tokenStats?.completionTokens)}</span>
                          <span className="text-[9px] text-slate-400 block mt-1">元数据结构推演、因果追溯与对标校验</span>
                        </div>

                        <div className="bg-slate-50 p-3.5 rounded border border-slate-200/60">
                          <span className="text-[10px] text-slate-400 uppercase block font-bold mb-1">总吞吐负载 (Throughput)</span>
                          <span className="text-xl font-mono font-extrabold text-slate-800">{formatTokens(taskProgress.tokenStats?.totalTokens)}</span>
                          <span className="text-[9px] text-slate-400 block mt-1">当前建模任务链全环节承载负载合算</span>
                        </div>

                        <div className="bg-indigo-50/40 p-3.5 rounded border border-indigo-150/50">
                          <span className="text-[10px] text-indigo-700 uppercase block font-bold mb-1">折合算力成本 (Est. Model USD)</span>
                          <span className="text-xl font-mono font-extrabold text-emerald-600">
                            ${(((taskProgress.tokenStats?.promptTokens || 0) * 1.5 + (taskProgress.tokenStats?.completionTokens || 0) * 2.5) / 1000000).toFixed(4)}
                          </span>
                          <span className="text-[9px] text-indigo-500 block mt-1">DeepSeek / Gemini 混合定价推理成本</span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Engine log output container */}
                  <div className="flex-1 bg-slate-900 border border-slate-800 rounded-lg shadow-inner overflow-hidden flex flex-col min-h-[350px]">
                    <div className="bg-slate-850 px-4 py-2 border-b border-slate-800 flex justify-between items-center">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span>
                        <span className="text-[10px] font-mono text-slate-400">MODELING COGNITIVE LOG</span>
                      </div>
                      {taskProgress && (
                        <span className="text-[10px] font-mono text-indigo-400 font-bold">
                          Completeness: {(taskProgress.completeness * 100).toFixed(1)}%
                        </span>
                      )}
                    </div>

                    <div className="flex-1 p-5 overflow-y-auto font-mono text-xs text-slate-300 space-y-2.5 leading-relaxed max-h-[400px]">
                      {taskProgress ? (
                        taskProgress.logs.map((log, idx) => {
                          const isSuccess = log.type === 'success';
                          const isWarning = log.type === 'warning';
                          const isError = log.type === 'error';
                          return (
                            <div key={idx} className="border-b border-slate-900 pb-1.5 last:border-0">
                              <span className="text-slate-500 text-[10px] shrink-0 mr-2">
                                [{new Date(log.timestamp).toLocaleTimeString()}]
                              </span>
                              <span className={
                                isSuccess ? 'text-emerald-400 font-semibold' :
                                isWarning ? 'text-amber-400 font-semibold' :
                                isError ? 'text-rose-400 font-semibold' : 'text-slate-300'
                              }>
                                {log.message}
                              </span>
                            </div>
                          );
                        })
                      ) : (
                        <div className="text-slate-500 text-center py-24 italic">
                          <Clock size={20} className="mx-auto mb-2 opacity-30" />
                          <span>引擎静止中。点击上方启动按钮，即可激活领域工程智能分析。</span>
                        </div>
                      )}
                      <div ref={logsEndRef} />
                    </div>
                  </div>

                </div>
              )}

              {/* TAB 2: GENERAL GLOSSARY/DICTIONARY & MAN_IN_THE_MIDDLE CORRECTIONS */}
              {activeTab === 'glossary' && (
                <div className="flex-1 flex flex-col gap-4 font-sans">
                  
                  {/* Top search & statistics strip */}
                  <div className="bg-white p-4 border border-slate-200 rounded-lg shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="flex items-center gap-2">
                      <BookOpen size={20} className="text-indigo-600 animate-pulse" />
                      <div>
                        <h3 className="text-sm font-extrabold text-slate-800">领域及行业知识树标准归集字典</h3>
                        <p className="text-[11px] text-slate-400">目前共沉淀了 {kb ? kb.concepts.length : 0} 个专业概念元素。支持系统限界名词标准、行业规范SOP、作业现场痛点交叉比对。</p>
                      </div>
                    </div>
                    
                    {/* Inline Filter Search Box */}
                    <div className="relative w-full md:w-72 shrink-0">
                      <Search className="absolute left-3 top-2.5 text-slate-400" size={14} />
                      <input 
                        type="text"
                        placeholder="输入术语名称/定义快速智能检索..."
                        value={glossarySearch}
                        onChange={(e) => {
                          setGlossarySearch(e.target.value);
                          // Clear selected if filtered out
                          setSelectedConceptId(null);
                        }}
                        className="w-full bg-slate-50 border border-slate-200 rounded-full pl-9 pr-4 py-1.5 text-xs focus:outline-none focus:border-indigo-500 font-medium"
                      />
                      {glossarySearch && (
                        <button 
                          onClick={() => setGlossarySearch('')} 
                          className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 cursor-pointer"
                        >
                          <X size={12} />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Bento columns framework */}
                  <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-[500px]">
                    
                    {/* LEFT PANEL: Interactive Tree Explorer (Col span 5) */}
                    <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg shadow-sm p-5 flex flex-col gap-4">
                      <div className="border-b border-slate-100 pb-3">
                        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider block">🌳 树级别分类脑图浏览器 (Tree Explorer)</span>
                        <p className="text-[10px] text-slate-400 mt-1">点击分类夹以折叠，选中节点以进行语义精细校正。</p>
                      </div>

                      <div className="flex-1 overflow-y-auto space-y-3 pr-2" style={{ maxHeight: '600px' }}>
                        
                        {/* 1. System Domain Tree (Only render if there is system coverage) */}
                        {!isIndustryOnly && (
                          <div className="border border-slate-100 rounded-lg p-2.5 bg-slate-50/50">
                            {/* System Folder Header */}
                            <div 
                              onClick={() => setExpandedFolders(prev => ({ ...prev, system: !prev.system }))}
                              className="flex items-center gap-2 cursor-pointer hover:bg-slate-100/80 p-1.5 rounded transition-colors"
                            >
                              <ChevronRight 
                                className={`text-slate-500 transition-transform duration-200 ${expandedFolders.system ? 'rotate-90' : ''}`} 
                                size={14} 
                              />
                              <Database size={15} className="text-blue-600" />
                              <span className="text-xs font-bold text-slate-800">系统领域知识树 (System Tree)</span>
                              <span className="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded-full font-mono font-bold ml-auto">
                                {kb ? kb.concepts.filter(c => (c.treeType || 'system') === 'system').length : 0}
                              </span>
                            </div>

                            {/* System Leaf Nodes */}
                            {expandedFolders.system && (
                              <div className="pl-6 pt-1.5 space-y-1 border-l border-dashed border-slate-200 ml-3.5 mt-1">
                                {kb && kb.concepts.filter(c => {
                                  const matchesSearch = !glossarySearch || c.name.toLowerCase().includes(glossarySearch.toLowerCase()) || c.definition.toLowerCase().includes(glossarySearch.toLowerCase());
                                  return matchesSearch && (c.treeType || 'system') === 'system';
                                }).map(c => {
                                  const isSelected = selectedConceptId === c.id;
                                  return (
                                    <div 
                                      key={c.id}
                                      onClick={() => {
                                        setSelectedConceptId(c.id);
                                        setEditingConceptId(null);
                                      }}
                                      className={`flex items-center gap-1.5 p-1.5 rounded text-xs cursor-pointer transition-colors ${
                                        isSelected 
                                          ? 'bg-blue-50 text-blue-700 font-bold border-l-2 border-blue-500 pl-1' 
                                          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-800'
                                      }`}
                                    >
                                      <FileText size={12} className={isSelected ? "text-blue-600" : "text-slate-400"} />
                                      <span className="truncate">{c.name}</span>
                                    </div>
                                  );
                                })}
                                {kb && kb.concepts.filter(c => (c.treeType || 'system') === 'system').length === 0 && (
                                  <div className="text-[11px] text-slate-400 italic py-1">暂无系统专属概念</div>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        {/* 2. Industry Domain Tree */}
                        <div className="border border-slate-100 rounded-lg p-2.5 bg-slate-50/50">
                          <div className="flex items-center gap-2 p-1.5 border-b border-slate-100 pb-2 mb-2">
                            <Compass size={15} className="text-violet-600" />
                            <span className="text-xs font-bold text-slate-800">行业领域及痛点树 (Industry Tree)</span>
                            <span className="text-[10px] bg-violet-50 text-violet-700 px-1.5 py-0.5 rounded-full font-mono font-bold ml-auto">
                              {kb ? kb.concepts.filter(c => {
                                const isInd = isIndustryOnly;
                                const tree = c.treeType || (isInd ? 'industry' : 'system');
                                return tree === 'industry';
                              }).length : 0}
                            </span>
                          </div>

                          {/* 2.1 Industry General Folder Branch */}
                          <div className="mb-2">
                            <div 
                              onClick={() => setExpandedFolders(prev => ({ ...prev, ind_general: !prev.ind_general }))}
                              className="flex items-center gap-1.5 cursor-pointer hover:bg-slate-100/80 p-1 rounded transition-colors"
                            >
                              <ChevronRight 
                                className={`text-slate-500 transition-transform duration-200 ${expandedFolders.ind_general ? 'rotate-90' : ''}`} 
                                size={12} 
                              />
                              <span className="text-xs font-medium text-slate-700">📂 行业通识与业务下钻</span>
                              <span className="text-[9px] text-slate-400 font-mono font-semibold ml-auto">
                                {kb ? kb.concepts.filter(c => {
                                  const isInd = isIndustryOnly;
                                  const tree = c.treeType || (isInd ? 'industry' : 'system');
                                  const concept = c.conceptType || (isInd ? 'industry_general' : 'system_concept');
                                  return tree === 'industry' && concept === 'industry_general';
                                }).length : 0}
                              </span>
                            </div>

                            {expandedFolders.ind_general && (() => {
                              const generalConcepts = kb ? kb.concepts.filter(c => {
                                const isInd = isIndustryOnly;
                                const tree = c.treeType || (isInd ? 'industry' : 'system');
                                const concept = c.conceptType || (isInd ? 'industry_general' : 'system_concept');
                                const matchesSearch = !glossarySearch || c.name.toLowerCase().includes(glossarySearch.toLowerCase()) || c.definition.toLowerCase().includes(glossarySearch.toLowerCase());
                                return matchesSearch && tree === 'industry' && concept === 'industry_general';
                              }) : [];

                              const subIndustryGroups: Record<string, typeof generalConcepts> = {};
                              generalConcepts.forEach(c => {
                                const sub = (c.subIndustry && c.subIndustry.trim()) ? c.subIndustry.trim() : '通用/通用行业通识';
                                if (!subIndustryGroups[sub]) {
                                  subIndustryGroups[sub] = [];
                                }
                                subIndustryGroups[sub].push(c);
                              });

                              return (
                                <div className="pl-2 pt-1.5 space-y-2 border-l border-dashed border-slate-200 ml-2.5 mt-0.5">
                                  
                                  {/* AI Batch auto detection trigger banner */}
                                  <div className="bg-gradient-to-br from-indigo-50/70 to-slate-50 border border-indigo-100 rounded-lg p-2.5 mb-1.5 shadow-sm text-[11px]">
                                    <div className="flex items-center justify-between gap-1.5 mb-1">
                                      <span className="font-bold text-slate-700 flex items-center gap-1">
                                        <span>🧬 行业通识子行业归网</span>
                                      </span>
                                      <button
                                        type="button"
                                        onClick={handleIdentifySubIndustries}
                                        disabled={isIdentifyingSubindustries || !kb}
                                        className="text-[10px] bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white font-extrabold px-2 py-0.5 rounded cursor-pointer transition-all border border-b border-indigo-800"
                                      >
                                        {isIdentifyingSubindustries ? 'AI对标中...' : '🤖 智能自动识别'}
                                      </button>
                                    </div>
                                    <p className="text-[10px] text-slate-505 leading-normal">
                                      支持<strong>自动识别</strong>和<strong>人工配置</strong>双重驱动，轻松将通识元素按二级细分子行业精细切分。
                                    </p>
                                    {subIndustryStatusMsg && (
                                      <div className={`mt-1.5 p-1 px-1.5 rounded text-[10px] font-semibold leading-relaxed ${subIndustryStatusMsg.type === 'error' ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-705'}`}>
                                        {subIndustryStatusMsg.text}
                                      </div>
                                    )}
                                  </div>

                                  {Object.keys(subIndustryGroups).length === 0 ? (
                                    <div className="text-[11px] text-slate-400 italic py-1 pl-2">暂无匹配的行业通识概念</div>
                                  ) : (
                                    Object.entries(subIndustryGroups).map(([subName, list]) => {
                                      const isSubExpanded = expandedSubIndustries[subName] !== false;
                                      return (
                                        <div key={subName} className="border border-slate-100 rounded-md p-1 bg-white shadow-xs">
                                          <div 
                                            onClick={() => {
                                              setExpandedSubIndustries(prev => ({ ...prev, [subName]: prev[subName] === false ? true : false }));
                                            }}
                                            className="flex items-center gap-1.5 cursor-pointer hover:bg-indigo-50/55 p-1 rounded transition-colors text-[10px] bg-slate-50 font-semibold"
                                          >
                                            <ChevronRight 
                                              className={`text-indigo-500 transition-transform duration-200 ${isSubExpanded ? 'rotate-90' : ''}`} 
                                              size={10} 
                                            />
                                            <span className="text-slate-700 font-bold">🏷 {subName}</span>
                                            <span className="text-[9px] bg-slate-100 text-slate-500 px-1.5 py-0.2 rounded-full font-mono font-bold ml-auto">{list.length}</span>
                                          </div>
                                          {isSubExpanded && (
                                            <div className="pl-3 pt-1 space-y-0.5 border-l border-slate-100 ml-1.5 mt-0.5">
                                              {list.map(c => {
                                                const isSelected = selectedConceptId === c.id;
                                                return (
                                                  <div 
                                                    key={c.id}
                                                    onClick={() => {
                                                      setSelectedConceptId(c.id);
                                                      setEditingConceptId(null);
                                                    }}
                                                    className={`flex items-center gap-1.5 p-1 rounded text-[11px] cursor-pointer transition-all ${
                                                      isSelected 
                                                        ? 'bg-indigo-50 text-indigo-700 font-bold border-l-2 border-indigo-500 pl-1.5' 
                                                        : 'text-slate-650 hover:bg-slate-100 hover:text-slate-900'
                                                    }`}
                                                  >
                                                    <span>🗎</span>
                                                    <span className="truncate">{c.name}</span>
                                                  </div>
                                                );
                                              })}
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })
                                  )}
                                </div>
                              );
                            })()}
                          </div>

                          {/* 2.2 Industry SOP Rule Folder Branch */}
                          <div className="mb-2">
                            <div 
                              onClick={() => setExpandedFolders(prev => ({ ...prev, ind_rule: !prev.ind_rule }))}
                              className="flex items-center gap-1.5 cursor-pointer hover:bg-slate-100/80 p-1 rounded transition-colors"
                            >
                              <ChevronRight 
                                className={`text-slate-500 transition-transform duration-200 ${expandedFolders.ind_rule ? 'rotate-90' : ''}`} 
                                size={12} 
                              />
                              <span className="text-xs font-medium text-slate-700">📂 企业级 SOP 规范</span>
                              <span className="text-[9px] text-slate-400 font-mono font-semibold ml-auto">
                                {kb ? kb.concepts.filter(c => c.treeType === 'industry' && c.conceptType === 'industry_rule').length : 0}
                              </span>
                            </div>

                            {expandedFolders.ind_rule && (
                              <div className="pl-4 pt-1 space-y-0.5 border-l border-dashed border-slate-200 ml-2.5 mt-0.5">
                                {kb && kb.concepts.filter(c => {
                                  const matchesSearch = !glossarySearch || c.name.toLowerCase().includes(glossarySearch.toLowerCase()) || c.definition.toLowerCase().includes(glossarySearch.toLowerCase());
                                  return matchesSearch && c.treeType === 'industry' && c.conceptType === 'industry_rule';
                                }).map(c => {
                                  const isSelected = selectedConceptId === c.id;
                                  return (
                                    <div 
                                      key={c.id}
                                      onClick={() => {
                                        setSelectedConceptId(c.id);
                                        setEditingConceptId(null);
                                      }}
                                      className={`flex items-center gap-1.5 p-1 rounded text-[11px] cursor-pointer transition-colors ${
                                        isSelected 
                                          ? 'bg-violet-50 text-violet-700 font-bold border-l border-violet-500 pl-1' 
                                          : 'text-slate-600 hover:bg-slate-100'
                                      }`}
                                    >
                                      <span>🗎</span>
                                      <span className="truncate">{c.name}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>

                          {/* 2.3 Industry Pain points Folder Branch */}
                          <div className="mb-2">
                            <div 
                              onClick={() => setExpandedFolders(prev => ({ ...prev, ind_pain: !prev.ind_pain }))}
                              className="flex items-center gap-1.5 cursor-pointer hover:bg-slate-100/80 p-1 rounded transition-colors"
                            >
                              <ChevronRight 
                                className={`text-slate-500 transition-transform duration-200 ${expandedFolders.ind_pain ? 'rotate-90' : ''}`} 
                                size={12} 
                              />
                              <span className="text-xs font-medium text-slate-700">📂 现场操作风险痛点</span>
                              <span className="text-[9px] text-slate-400 font-mono font-semibold ml-auto">
                                {kb ? kb.concepts.filter(c => c.treeType === 'industry' && c.conceptType === 'industry_pain_point').length : 0}
                              </span>
                            </div>

                            {expandedFolders.ind_pain && (
                              <div className="pl-4 pt-1 space-y-0.5 border-l border-dashed border-slate-200 ml-2.5 mt-0.5">
                                {kb && kb.concepts.filter(c => {
                                  const matchesSearch = !glossarySearch || c.name.toLowerCase().includes(glossarySearch.toLowerCase()) || c.definition.toLowerCase().includes(glossarySearch.toLowerCase());
                                  return matchesSearch && c.treeType === 'industry' && c.conceptType === 'industry_pain_point';
                                }).map(c => {
                                  const isSelected = selectedConceptId === c.id;
                                  return (
                                    <div 
                                      key={c.id}
                                      onClick={() => {
                                        setSelectedConceptId(c.id);
                                        setEditingConceptId(null);
                                      }}
                                      className={`flex items-center gap-1.5 p-1 rounded text-[11px] cursor-pointer transition-colors ${
                                        isSelected 
                                          ? 'bg-amber-50 text-amber-700 font-bold border-l border-amber-500 pl-1' 
                                          : 'text-slate-600 hover:bg-slate-100'
                                      }`}
                                    >
                                      <span>🗎</span>
                                      <span className="truncate">{c.name}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>

                          {/* 2.4 Academic Disciplines Folder Branch */}
                          <div className="mb-2">
                            <div 
                              onClick={() => setExpandedFolders(prev => ({ ...prev, ind_academic: !prev.ind_academic }))}
                              className="flex items-center gap-1.5 cursor-pointer hover:bg-slate-100/80 p-1 rounded transition-colors"
                            >
                              <ChevronRight 
                                className={`text-slate-500 transition-transform duration-200 ${expandedFolders.ind_academic ? 'rotate-90' : ''}`} 
                                size={12} 
                              />
                              <span className="text-xs font-medium text-slate-700">📂 对应一级与二级学科</span>
                              <span className="text-[9px] text-slate-400 font-mono font-semibold ml-auto">
                                {kb ? kb.concepts.filter(c => c.treeType === 'industry' && (c.conceptType === 'academic_discipline' || c.conceptType === 'sub_academic_discipline')).length : 0}
                              </span>
                            </div>

                            {expandedFolders.ind_academic && (
                              <div className="pl-4 pt-1 space-y-0.5 border-l border-dashed border-slate-200 ml-2.5 mt-0.5">
                                {kb && kb.concepts.filter(c => {
                                  const matchesSearch = !glossarySearch || c.name.toLowerCase().includes(glossarySearch.toLowerCase()) || c.definition.toLowerCase().includes(glossarySearch.toLowerCase());
                                  return matchesSearch && c.treeType === 'industry' && (c.conceptType === 'academic_discipline' || c.conceptType === 'sub_academic_discipline');
                                }).map(c => {
                                  const isSelected = selectedConceptId === c.id;
                                  return (
                                    <div 
                                      key={c.id}
                                      onClick={() => {
                                        setSelectedConceptId(c.id);
                                        setEditingConceptId(null);
                                      }}
                                      className={`flex items-center gap-1.5 p-1 rounded text-[11px] cursor-pointer transition-colors ${
                                        isSelected 
                                          ? 'bg-emerald-50 text-emerald-700 font-bold border-l border-emerald-500 pl-1' 
                                          : 'text-slate-600 hover:bg-slate-100'
                                      }`}
                                    >
                                      <span>🗎</span>
                                      <span className="truncate">{c.conceptType === 'sub_academic_discipline' ? '↳ ' : ''}{c.name}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>

                          {/* 2.5 Historical Events & Influential Figures Branch */}
                          <div className="mb-2">
                            <div 
                              onClick={() => setExpandedFolders(prev => ({ ...prev, ind_event: !prev.ind_event }))}
                              className="flex items-center gap-1.5 cursor-pointer hover:bg-slate-100/80 p-1 rounded transition-colors"
                            >
                              <ChevronRight 
                                className={`text-slate-500 transition-transform duration-200 ${expandedFolders.ind_event ? 'rotate-90' : ''}`} 
                                size={12} 
                              />
                              <span className="text-xs font-medium text-slate-700">📂 重大影响事件/法规/人物</span>
                              <span className="text-[9px] text-slate-400 font-mono font-semibold ml-auto">
                                {kb ? kb.concepts.filter(c => c.treeType === 'industry' && c.conceptType === 'influential_event_person').length : 0}
                              </span>
                            </div>

                            {expandedFolders.ind_event && (
                              <div className="pl-4 pt-1 space-y-0.5 border-l border-dashed border-slate-200 ml-2.5 mt-0.5">
                                {kb && kb.concepts.filter(c => {
                                  const matchesSearch = !glossarySearch || c.name.toLowerCase().includes(glossarySearch.toLowerCase()) || c.definition.toLowerCase().includes(glossarySearch.toLowerCase());
                                  return matchesSearch && c.treeType === 'industry' && c.conceptType === 'influential_event_person';
                                }).map(c => {
                                  const isSelected = selectedConceptId === c.id;
                                  return (
                                    <div 
                                      key={c.id}
                                      onClick={() => {
                                        setSelectedConceptId(c.id);
                                        setEditingConceptId(null);
                                      }}
                                      className={`flex items-center gap-1.5 p-1 rounded text-[11px] cursor-pointer transition-colors ${
                                        isSelected 
                                          ? 'bg-rose-50 text-rose-700 font-bold border-l border-rose-500 pl-1' 
                                          : 'text-slate-600 hover:bg-slate-100'
                                      }`}
                                    >
                                      <span>🗎</span>
                                      <span className="truncate">{c.name}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>

                          {/* 2.6 Special Processes & Requirements Branch */}
                          <div className="mb-2">
                            <div 
                              onClick={() => setExpandedFolders(prev => ({ ...prev, ind_special: !prev.ind_special }))}
                              className="flex items-center gap-1.5 cursor-pointer hover:bg-slate-100/80 p-1 rounded transition-colors"
                            >
                              <ChevronRight 
                                className={`text-slate-500 transition-transform duration-200 ${expandedFolders.ind_special ? 'rotate-90' : ''}`} 
                                size={12} 
                              />
                              <span className="text-xs font-medium text-slate-700">📂 行业特殊流程与要求</span>
                              <span className="text-[9px] text-slate-400 font-mono font-semibold ml-auto">
                                {kb ? kb.concepts.filter(c => c.treeType === 'industry' && c.conceptType === 'special_process_requirement').length : 0}
                              </span>
                            </div>

                            {expandedFolders.ind_special && (
                              <div className="pl-4 pt-1 space-y-0.5 border-l border-dashed border-slate-200 ml-2.5 mt-0.5">
                                {kb && kb.concepts.filter(c => {
                                  const matchesSearch = !glossarySearch || c.name.toLowerCase().includes(glossarySearch.toLowerCase()) || c.definition.toLowerCase().includes(glossarySearch.toLowerCase());
                                  return matchesSearch && c.treeType === 'industry' && c.conceptType === 'special_process_requirement';
                                }).map(c => {
                                  const isSelected = selectedConceptId === c.id;
                                  return (
                                    <div 
                                      key={c.id}
                                      onClick={() => {
                                        setSelectedConceptId(c.id);
                                        setEditingConceptId(null);
                                      }}
                                      className={`flex items-center gap-1.5 p-1 rounded text-[11px] cursor-pointer transition-colors ${
                                        isSelected 
                                          ? 'bg-indigo-50 text-indigo-700 font-bold border-l border-indigo-500 pl-1' 
                                          : 'text-slate-600 hover:bg-slate-100'
                                      }`}
                                    >
                                      <span>🗎</span>
                                      <span className="truncate">{c.name}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>

                          {/* 2.7 Industry Roles & Position Responsibilities Branch */}
                          <div className="mb-1">
                            <div 
                              onClick={() => setExpandedFolders(prev => ({ ...prev, ind_roles: !prev.ind_roles }))}
                              className="flex items-center gap-1.5 cursor-pointer hover:bg-slate-100/80 p-1 rounded transition-colors"
                            >
                              <ChevronRight 
                                className={`text-slate-500 transition-transform duration-200 ${expandedFolders.ind_roles ? 'rotate-90' : ''}`} 
                                size={12} 
                              />
                              <span className="text-xs font-medium text-slate-700">📂 职业岗位与角色/位置说明</span>
                              <span className="text-[9px] text-slate-400 font-mono font-semibold ml-auto">
                                {kb ? kb.concepts.filter(c => c.treeType === 'industry' && c.conceptType === 'industry_role_position').length : 0}
                              </span>
                            </div>

                            {expandedFolders.ind_roles && (
                              <div className="pl-4 pt-1 space-y-0.5 border-l border-dashed border-slate-200 ml-2.5 mt-0.5">
                                {kb && kb.concepts.filter(c => {
                                  const matchesSearch = !glossarySearch || c.name.toLowerCase().includes(glossarySearch.toLowerCase()) || c.definition.toLowerCase().includes(glossarySearch.toLowerCase());
                                  return matchesSearch && c.treeType === 'industry' && c.conceptType === 'industry_role_position';
                                }).map(c => {
                                  const isSelected = selectedConceptId === c.id;
                                  return (
                                    <div 
                                      key={c.id}
                                      onClick={() => {
                                        setSelectedConceptId(c.id);
                                        setEditingConceptId(null);
                                      }}
                                      className={`flex items-center gap-1.5 p-1 rounded text-[11px] cursor-pointer transition-colors ${
                                        isSelected 
                                          ? 'bg-orange-50 text-orange-700 font-bold border-l border-orange-500 pl-1' 
                                          : 'text-slate-600 hover:bg-slate-100'
                                      }`}
                                    >
                                      <span>🗎</span>
                                      <span className="truncate">{c.name}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>

                          {/* 2.8 Single-Track Exclusive: Industry Elite, Stars & Masterpieces Branch */}
                          <div className="mb-1">
                            <div 
                              onClick={() => setExpandedFolders(prev => ({ ...prev, ind_elite: !prev.ind_elite }))}
                              className="flex items-center gap-1.5 cursor-pointer hover:bg-slate-100/80 p-1 rounded transition-colors"
                            >
                              <ChevronRight 
                                className={`text-slate-500 transition-transform duration-200 ${expandedFolders.ind_elite ? 'rotate-90' : ''}`} 
                                size={12} 
                              />
                              <span className="text-xs font-medium text-slate-700">📂 单轨精英/球星/代表作/招牌菜</span>
                              <span className="text-[9px] text-slate-400 font-mono font-semibold ml-auto">
                                {kb ? kb.concepts.filter(c => c.treeType === 'industry' && c.conceptType === 'industry_elite_masterpiece').length : 0}
                              </span>
                            </div>

                            {expandedFolders.ind_elite && (
                              <div className="pl-4 pt-1 space-y-0.5 border-l border-dashed border-slate-200 ml-2.5 mt-0.5">
                                {kb && kb.concepts.filter(c => {
                                  const matchesSearch = !glossarySearch || c.name.toLowerCase().includes(glossarySearch.toLowerCase()) || c.definition.toLowerCase().includes(glossarySearch.toLowerCase());
                                  return matchesSearch && c.treeType === 'industry' && c.conceptType === 'industry_elite_masterpiece';
                                }).map(c => {
                                  const isSelected = selectedConceptId === c.id;
                                  return (
                                    <div 
                                      key={c.id}
                                      onClick={() => {
                                        setSelectedConceptId(c.id);
                                        setEditingConceptId(null);
                                      }}
                                      className={`flex items-center gap-1.5 p-1 rounded text-[11px] cursor-pointer transition-colors ${
                                        isSelected 
                                          ? 'bg-amber-50 text-amber-700 font-bold border-l border-amber-500 pl-1' 
                                          : 'text-slate-600 hover:bg-slate-100'
                                      }`}
                                    >
                                      <span>🗎</span>
                                      <span className="truncate">{c.name}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>

                          {/* 2.9 Industry Jargon & Inner-Circle Slang Branch */}
                          <div className="mb-1">
                            <div 
                              onClick={() => setExpandedFolders(prev => ({ ...prev, ind_jargon: !prev.ind_jargon }))}
                              className="flex items-center gap-1.5 cursor-pointer hover:bg-slate-100/80 p-1 rounded transition-colors"
                            >
                              <ChevronRight 
                                className={`text-slate-500 transition-transform duration-200 ${expandedFolders.ind_jargon ? 'rotate-90' : ''}`} 
                                size={12} 
                              />
                              <span className="text-xs font-medium text-slate-700">📂 行业黑话/行话与角色切口</span>
                              <span className="text-[9px] text-slate-400 font-mono font-semibold ml-auto">
                                {kb ? kb.concepts.filter(c => c.treeType === 'industry' && c.conceptType === 'industry_jargon').length : 0}
                              </span>
                            </div>

                            {expandedFolders.ind_jargon && (
                              <div className="pl-4 pt-1 space-y-0.5 border-l border-dashed border-slate-200 ml-2.5 mt-0.5">
                                {kb && kb.concepts.filter(c => {
                                  const matchesSearch = !glossarySearch || c.name.toLowerCase().includes(glossarySearch.toLowerCase()) || c.definition.toLowerCase().includes(glossarySearch.toLowerCase());
                                  return matchesSearch && c.treeType === 'industry' && c.conceptType === 'industry_jargon';
                                }).map(c => {
                                  const isSelected = selectedConceptId === c.id;
                                  return (
                                    <div 
                                      key={c.id}
                                      onClick={() => {
                                        setSelectedConceptId(c.id);
                                        setEditingConceptId(null);
                                      }}
                                      className={`flex items-center gap-1.5 p-1 rounded text-[11px] cursor-pointer transition-colors ${
                                        isSelected 
                                          ? 'bg-purple-50 text-purple-700 font-bold border-l border-purple-500 pl-1' 
                                          : 'text-slate-600 hover:bg-slate-100'
                                      }`}
                                    >
                                      <span>🗎</span>
                                      <span className="truncate">{c.name}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>

                          {/* 2.10 Industry Taboos & Unwritten Rules Branch */}
                          <div className="mb-1">
                            <div 
                              onClick={() => setExpandedFolders(prev => ({ ...prev, ind_taboo: !prev.ind_taboo }))}
                              className="flex items-center gap-1.5 cursor-pointer hover:bg-slate-100/80 p-1 rounded transition-colors"
                            >
                              <ChevronRight 
                                className={`text-slate-500 transition-transform duration-200 ${expandedFolders.ind_taboo ? 'rotate-90' : ''}`} 
                                size={12} 
                              />
                              <span className="text-xs font-medium text-slate-700">📂 行业禁忌与约定俗成规矩</span>
                              <span className="text-[9px] text-slate-400 font-mono font-semibold ml-auto">
                                {kb ? kb.concepts.filter(c => c.treeType === 'industry' && c.conceptType === 'industry_taboo').length : 0}
                              </span>
                            </div>

                            {expandedFolders.ind_taboo && (
                              <div className="pl-4 pt-1 space-y-0.5 border-l border-dashed border-slate-200 ml-2.5 mt-0.5">
                                {kb && kb.concepts.filter(c => {
                                  const matchesSearch = !glossarySearch || c.name.toLowerCase().includes(glossarySearch.toLowerCase()) || c.definition.toLowerCase().includes(glossarySearch.toLowerCase());
                                  return matchesSearch && c.treeType === 'industry' && c.conceptType === 'industry_taboo';
                                }).map(c => {
                                  const isSelected = selectedConceptId === c.id;
                                  return (
                                    <div 
                                      key={c.id}
                                      onClick={() => {
                                        setSelectedConceptId(c.id);
                                        setEditingConceptId(null);
                                      }}
                                      className={`flex items-center gap-1.5 p-1 rounded text-[11px] cursor-pointer transition-colors ${
                                        isSelected 
                                          ? 'bg-rose-50 text-rose-700 font-bold border-l border-rose-500 pl-1' 
                                          : 'text-slate-600 hover:bg-slate-100'
                                      }`}
                                    >
                                      <span>🗎</span>
                                      <span className="truncate">{c.name}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>

                        </div>

                      </div>
                    </div>

                    {/* RIGHT PANEL: Detail Panel or Add Element Form (Col span 7) */}
                    <div className="lg:col-span-7 flex flex-col gap-4">
                      
                      {selectedConceptId ? (() => {
                        const conceptObj = kb?.concepts.find(c => c.id === selectedConceptId);
                        if (!conceptObj) return (
                          <div className="bg-white p-8 rounded-lg border border-slate-200 text-center text-slate-400">
                            概念未找到，可能已被删除
                          </div>
                        );

                        const isEditingThis = editingConceptId === selectedConceptId;

                        // Concept category identifiers
                        const isSystemType = (conceptObj.treeType || 'system') === 'system';
                        const conceptCategory = conceptObj.conceptType || (isIndustryOnly ? 'industry_general' : 'system_concept');
                        
                        let categoryTagLabel = '系统核心术语';
                        let tagColorClass = 'bg-blue-50 text-blue-700 border-blue-200';
                        if (conceptCategory === 'industry_general') {
                          categoryTagLabel = '当前行业及通识规范';
                          tagColorClass = 'bg-sky-50 text-sky-700 border-sky-200';
                        } else if (conceptCategory === 'industry_rule') {
                          categoryTagLabel = '行业 SOP 合规控制规则';
                          tagColorClass = 'bg-purple-50 text-purple-700 border-purple-200';
                        } else if (conceptCategory === 'industry_pain_point') {
                          categoryTagLabel = '现场作业痛点/风险防范';
                          tagColorClass = 'bg-amber-50 text-amber-700 border-amber-200';
                        } else if (conceptCategory === 'academic_discipline') {
                          categoryTagLabel = '对应核心一级学科';
                          tagColorClass = 'bg-emerald-50 text-emerald-700 border-emerald-200';
                        } else if (conceptCategory === 'sub_academic_discipline') {
                          categoryTagLabel = '下钻二级学科/理论模型';
                          tagColorClass = 'bg-teal-50 text-teal-700 border-teal-200';
                        } else if (conceptCategory === 'influential_event_person') {
                          categoryTagLabel = '重大影响事件/核心人物/法规';
                          tagColorClass = 'bg-rose-50 text-rose-700 border-rose-200';
                        } else if (conceptCategory === 'special_process_requirement') {
                          categoryTagLabel = '行业特殊流程/高约束要求';
                          tagColorClass = 'bg-indigo-50 text-indigo-700 border-indigo-200';
                        } else if (conceptCategory === 'industry_role_position') {
                          categoryTagLabel = '行业职业岗位与角色/位置说明';
                          tagColorClass = 'bg-orange-50 text-orange-700 border-orange-200';
                        } else if (conceptCategory === 'industry_elite_masterpiece') {
                          categoryTagLabel = '单轨精英/球星/代表作/招牌菜';
                          tagColorClass = 'bg-amber-50 text-amber-700 border-amber-200';
                        } else if (conceptCategory === 'industry_jargon') {
                          categoryTagLabel = '行业黑话与行话切口';
                          tagColorClass = 'bg-purple-50 text-purple-700 border-purple-200';
                        } else if (conceptCategory === 'industry_taboo') {
                          categoryTagLabel = '行业禁忌与约定俗成规矩';
                          tagColorClass = 'bg-rose-50 text-rose-700 border-rose-200';
                        }

                        if (isEditingThis) {
                          // Inline editing form
                          return (
                            <div className="bg-white p-6 border border-slate-200 rounded-lg shadow-sm flex flex-col gap-4">
                              <div className="flex justify-between items-center border-b border-slate-100 pb-3">
                                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-widest flex items-center gap-1.5">
                                  <Edit3 size={14} className="text-indigo-600 animate-pulse" />
                                  人工修剪改良中：标准语义精修
                                </h4>
                                <button 
                                  onClick={() => setEditingConceptId(null)}
                                  className="text-slate-400 hover:text-slate-600 text-xs px-2 py-1 rounded hover:bg-slate-50 cursor-pointer"
                                >
                                  取消精修
                                </button>
                              </div>

                              <div className="space-y-4">
                                <div>
                                  <label className="text-[10px] font-bold text-slate-400 block mb-1 uppercase tracking-widest">概念词汇术语项</label>
                                  <input 
                                    type="text"
                                    value={editingConceptForm.name}
                                    onChange={(e) => setEditingConceptForm(prev => ({ ...prev, name: e.target.value }))}
                                    className="w-full bg-slate-50 border border-slate-205 rounded p-2 text-xs font-bold text-slate-800"
                                  />
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                  <div>
                                    <label className="text-[10px] font-bold text-slate-400 block mb-1 uppercase tracking-widest block">对标知识分类</label>
                                    <select 
                                      value={editingConceptForm.conceptType}
                                      onChange={(e) => setEditingConceptForm(prev => ({ ...prev, conceptType: e.target.value as any }))}
                                      className="w-full bg-slate-50 border border-slate-200 rounded p-1.5 text-xs font-medium text-slate-700"
                                    >
                                      {!isIndustryOnly && <option value="system_concept">系统核心主单据/技术概念</option>}
                                      <option value="industry_general">当前行业及通识规范 (词汇/标准)</option>
                                      <option value="industry_rule">企业级业务 SOP 规章与规则</option>
                                      <option value="industry_pain_point">具体现场操作痛点/防控红线</option>
                                      <option value="academic_discipline">对应一级学科知识</option>
                                      <option value="sub_academic_discipline">下钻二级学科/理论模型</option>
                                      <option value="influential_event_person">行业重大影响事件/人物/法规</option>
                                      <option value="special_process_requirement">行业特殊流程与高难度要求</option>
                                      <option value="industry_role_position">行业岗位/职业与角色说明 (如店长、女巫、边后卫等)</option>
                                      <option value="industry_elite_masterpiece">单轨特有: 行业精英/热点人物/代表作/招牌菜</option>
                                      <option value="industry_jargon">行业黑话/行话与角色切口 (如对齐/翻台/甩柜/挂机等)</option>
                                      <option value="industry_taboo">行业禁忌/约定俗成规矩 (如急诊闲话/缺口碗盘/跳单等)</option>
                                    </select>
                                  </div>
                                  <div>
                                    <label className="text-[10px] font-bold text-slate-400 block mb-1 uppercase tracking-widest">检索依据源链接 (可选)</label>
                                    <input 
                                      type="text"
                                      value={editingConceptForm.sourceUrl}
                                      onChange={(e) => setEditingConceptForm(prev => ({ ...prev, sourceUrl: e.target.value }))}
                                      placeholder="https://..."
                                      className="w-full bg-slate-50 border border-slate-200 rounded p-1.5 text-xs font-mono font-medium text-slate-600"
                                    />
                                  </div>
                                </div>

                                <div>
                                  <label className="text-[10px] font-bold text-slate-400 block mb-1 uppercase tracking-widest">终极标准业务释义 (标准定义)</label>
                                  <textarea 
                                    rows={4}
                                    value={editingConceptForm.definition}
                                    onChange={(e) => setEditingConceptForm(prev => ({ ...prev, definition: e.target.value }))}
                                    className="w-full bg-slate-50 border border-slate-205 rounded p-2 text-xs font-medium text-slate-700 leading-relaxed"
                                  />
                                </div>

                                <div>
                                  <label className="text-[10px] font-bold text-slate-400 block mb-1 uppercase tracking-widest">属性词汇大纲字典 (以逗号分隔)</label>
                                  <input 
                                    type="text"
                                    value={editingConceptForm.attributesStr}
                                    onChange={(e) => setEditingConceptForm(prev => ({ ...prev, attributesStr: e.target.value }))}
                                    className="w-full bg-slate-50 border border-slate-200 rounded p-2 text-xs font-mono text-slate-650"
                                  />
                                </div>

                                <div>
                                  <label className="text-[10px] font-bold text-indigo-400 block mb-1 uppercase tracking-widest flex items-center gap-1">
                                    <span>⚙ 关联细分子行业 (实现行业树分类深度下钻)</span>
                                  </label>
                                  <input 
                                    type="text"
                                    value={editingConceptForm.subIndustry || ''}
                                    onChange={(e) => setEditingConceptForm(prev => ({ ...prev, subIndustry: e.target.value }))}
                                    placeholder="例如: 生鲜零售、医药零售、直播电商、仓储物流 (可自填或点击下方推荐，非行业通识可填通用或留空)"
                                    className="w-full bg-slate-50 border border-slate-250 rounded p-2 text-xs font-bold text-slate-800"
                                  />
                                  <div className="flex flex-wrap gap-1 mt-1.5">
                                    {['生鲜零售', '医药零售', '直播电商', '跨境供应链', '仓储物流', '网约车出行'].map((pill) => (
                                      <button
                                        key={pill}
                                        type="button"
                                        onClick={() => setEditingConceptForm(prev => ({ ...prev, subIndustry: pill }))}
                                        className="text-[10px] px-2 py-0.5 rounded bg-slate-105 hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-200 text-slate-600 transition-all cursor-pointer border border-slate-200 select-none font-medium"
                                      >
                                        {pill}
                                      </button>
                                    ))}
                                    {(editingConceptForm.subIndustry) && (
                                      <button
                                        type="button"
                                        onClick={() => setEditingConceptForm(prev => ({ ...prev, subIndustry: '' }))}
                                        className="text-[10px] px-2 py-0.5 rounded bg-rose-50 hover:bg-rose-100 text-rose-600 transition-all cursor-pointer border border-rose-150 select-none font-bold"
                                      >
                                        清除当前子行业
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>

                              <button 
                                onClick={handleSaveEditedConcept}
                                disabled={!editingConceptForm.name || !editingConceptForm.definition}
                                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold py-2 px-4 rounded text-xs mt-3 flex items-center justify-center gap-2 cursor-pointer shadow disabled:opacity-40"
                              >
                                <span>✔ 写入最新修正，合并更新</span>
                              </button>
                            </div>
                          );
                        }

                        // Read-only Details View
                        return (
                          <div className="bg-white p-6 border border-slate-200 rounded-lg shadow-sm flex flex-col gap-6 relative animate-fade-in animate-duration-200">
                            <button 
                              onClick={() => setSelectedConceptId(null)}
                              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 p-1.5 rounded-full hover:bg-slate-50 cursor-pointer animate-none"
                              title="关闭详情"
                            >
                              <X size={16} />
                            </button>

                            <div className="flex flex-col gap-2">
                              <div className="flex items-center gap-1.5 animate-none">
                                <span className={`text-[10px] px-2 py-0.5 rounded border font-bold ${tagColorClass}`}>
                                  {categoryTagLabel}
                                </span>
                                <span className="text-[10px] bg-indigo-50 text-indigo-700 font-mono font-bold px-1.5 py-0.5 rounded-full ml-auto">
                                  构建置信度: {Math.round(conceptObj.confidence * 100)}%
                                </span>
                              </div>
                              <h3 className="text-lg font-extrabold text-slate-900 border-b border-slate-100 pb-2">
                                {conceptObj.name}
                              </h3>
                            </div>

                            <div>
                              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-2 font-mono">✦ 标准业务释义 (BUSINESS SPECIFICATION)</span>
                              <div className="bg-slate-50/70 py-4 px-5 border-l-4 border-indigo-500 rounded text-xs text-slate-800 leading-relaxed font-sans italic">
                                "{conceptObj.definition}"
                              </div>
                            </div>

                            {conceptObj.attributes && conceptObj.attributes.length > 0 && (
                              <div>
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block mb-2 font-mono ml-0.5">✦ 标准化核心特征属性字典</span>
                                <div className="flex flex-wrap gap-2 pt-1">
                                  {conceptObj.attributes.map((attr, idx) => (
                                    <span key={idx} className="text-xs bg-indigo-50 border border-indigo-100 text-indigo-800 px-3 py-1 rounded font-mono font-medium">
                                      {attr}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Reference citations */}
                            {conceptObj.sourceUrl && (
                              <div className="border-t border-dashed border-slate-150 pt-4 mt-2">
                                <span className="text-[9px] uppercase tracking-widest font-extrabold text-slate-400 block mb-2 font-mono">✦ 对标标准引用/实证来源检索:</span>
                                <a 
                                  href={conceptObj.sourceUrl} 
                                  target="_blank" 
                                  rel="noopener noreferrer" 
                                  className="inline-flex items-center gap-1.5 text-xs text-indigo-600 hover:underline max-w-full truncate font-mono font-semibold"
                                >
                                  <ExternalLink size={12} />
                                  <span>{conceptObj.sourceUrl}</span>
                                </a>
                              </div>
                            )}

                            {/* Active Action Row */}
                            <div className="flex gap-3 justify-end border-t border-slate-100 pt-4 mt-4">
                              <button 
                                onClick={() => {
                                  setEditingConceptId(conceptObj.id);
                                  setEditingConceptForm({
                                    name: conceptObj.name,
                                    definition: conceptObj.definition,
                                    attributesStr: conceptObj.attributes.join(', '),
                                    sourceUrl: conceptObj.sourceUrl || '',
                                    conceptType: conceptCategory as any,
                                    subIndustry: conceptObj.subIndustry || ''
                                  });
                                }}
                                className="px-3.5 py-1.5 border border-indigo-150 hover:border-indigo-300 text-indigo-600 bg-indigo-50/30 font-bold rounded text-xs flex items-center gap-1.5 cursor-pointer transition-all"
                              >
                                <Edit3 size={12} />
                                语义精修
                              </button>
                              <button 
                                onClick={() => {
                                  handleDeleteNode('concept', conceptObj.id);
                                  setSelectedConceptId(null);
                                }}
                                className="px-3.5 py-1.5 border border-rose-100 hover:bg-rose-50 text-rose-600 font-bold rounded text-xs flex items-center gap-1.5 cursor-pointer transition-all ml-auto"
                              >
                                <Trash2 size={12} />
                                进行删除
                              </button>
                            </div>
                          </div>
                        );
                      })() : (
                        <div className="bg-slate-50 border border-dashed border-slate-200 rounded-lg p-6 text-center text-slate-400 flex flex-col items-center justify-center gap-2 py-12 shadow-inner">
                          <Eye size={24} className="text-slate-300" />
                          <h4 className="text-xs font-bold text-slate-500">双轨知识节点浏览器</h4>
                          <p className="text-[10px] text-slate-400 max-w-xs mt-1 leading-relaxed">您可在左侧按分类夹下钻浏览器节点，选中任何单个概念以在右侧执行语义校对。也可使用下方的人工入口快速进行语汇注入。</p>
                        </div>
                      )}

                      {/* ALWAYS VISIBLE OR COLLAPSIBLE INJECTOR (unless editing) */}
                      {editingConceptId === null && (
                        <div className="bg-white p-5 border border-slate-200 rounded-lg shadow-sm">
                          <h4 className="text-xs font-bold text-slate-700 uppercase tracking-widest mb-3 flex items-center gap-1.5 border-b border-slate-100 pb-2">
                            <PlusCircle size={14} className="text-indigo-600" />
                            人工修正入口：注入核心概念项
                          </h4>
                          
                          <div className="grid grid-cols-2 gap-3 mb-3">
                            <div>
                              <label className="text-[10px] font-bold text-slate-400 block mb-1 uppercase tracking-widest">概念词表名称 (术语)</label>
                              <input 
                                id="manual-concept-name"
                                type="text" 
                                placeholder="例如: 采购合同"
                                value={newConceptForm.name}
                                onChange={(e) => setNewConceptForm(prev => ({ ...prev, name: e.target.value }))}
                                className="w-full bg-slate-50 border border-slate-200 rounded p-1.5 text-xs focus:outline-none focus:border-indigo-500 font-medium text-slate-850"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] font-bold text-slate-400 block mb-1 uppercase tracking-widest">检索依据源链接 (可选)</label>
                              <input 
                                id="manual-concept-url"
                                type="text" 
                                placeholder="例如: RFC, SAP 或 wiki"
                                value={newConceptForm.sourceUrl}
                                onChange={(e) => setNewConceptForm(prev => ({ ...prev, sourceUrl: e.target.value }))}
                                className="w-full bg-slate-50 border border-slate-200 rounded p-1.5 text-xs focus:outline-none focus:border-indigo-500 font-medium"
                              />
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-3 mb-3">
                            <div>
                              <label className="text-[10px] font-bold text-slate-400 block mb-1 uppercase tracking-widest">对标知识分类</label>
                              <select 
                                id="manual-concept-tree-selector"
                                value={newConceptForm.conceptType}
                                onChange={(e) => {
                                  const cType = e.target.value as any;
                                  const tType = cType === 'system_concept' ? 'system' : 'industry';
                                  setNewConceptForm(prev => ({ ...prev, conceptType: cType, treeType: tType }));
                                }}
                                className="w-full bg-slate-50 border border-slate-200 rounded p-1.5 text-xs focus:outline-none focus:border-indigo-500 font-semibold text-slate-700"
                              >
                                {!isIndustryOnly && <option value="system_concept">系统核心主单据/概念词汇</option>}
                                <option value="industry_general">当前行业及通识规范 (词汇/标准)</option>
                                <option value="industry_rule">企业级业务 SOP 规章与规则</option>
                                <option value="industry_pain_point">具体现场操作痛点/防控红线</option>
                                <option value="academic_discipline">对应一级学科知识</option>
                                <option value="sub_academic_discipline">下钻二级学科/理论模型</option>
                                <option value="influential_event_person">行业重大影响事件/人物/法规</option>
                                <option value="special_process_requirement">行业特殊流程与高难度要求</option>
                                <option value="industry_role_position">行业岗位/职业与角色说明 (如店长、女巫、边后卫等)</option>
                                <option value="industry_elite_masterpiece">单轨特有: 行业精英/热点人物/代表作/招牌菜</option>
                                <option value="industry_jargon">行业黑话/行话与角色切口 (如对齐/翻台/甩柜/挂机等)</option>
                                <option value="industry_taboo">行业禁忌/约定俗成规矩 (如急诊闲话/缺口碗盘/跳单等)</option>
                              </select>
                            </div>
                            <div>
                              <label className="text-[10px] font-bold text-slate-400 block mb-1 uppercase tracking-widest">评分置信度分段 ({newConceptForm.confidence})</label>
                              <input 
                                id="manual-concept-confidence animate-none"
                                type="range" 
                                min="0.5" 
                                max="1.0" 
                                step="0.05"
                                value={newConceptForm.confidence}
                                onChange={(e) => setNewConceptForm(prev => ({ ...prev, confidence: Number(e.target.value) }))}
                                className="w-full bg-slate-50 mt-2"
                              />
                            </div>
                          </div>

                          <div className="mb-3">
                            <label className="text-[10px] font-bold text-slate-400 block mb-1 uppercase tracking-widest">概念标准语意定义</label>
                            <textarea 
                              id="manual-concept-definition"
                              rows={2}
                              placeholder="例如: 专门限制生鲜冷链多维交接中的在途异常温控红线规则..."
                              value={newConceptForm.definition}
                              onChange={(e) => setNewConceptForm(prev => ({ ...prev, definition: e.target.value }))}
                              className="w-full bg-slate-50 border border-slate-200 rounded p-2 text-xs focus:outline-none focus:border-indigo-500 font-medium text-slate-700 leading-relaxed"
                            />
                          </div>

                          <div className="mb-3">
                            <label className="text-[10px] font-bold text-slate-400 block mb-1 uppercase tracking-widest">特征属性字典 (逗号分隔)</label>
                            <input 
                              id="manual-concept-attributes"
                              type="text" 
                              placeholder="例如: 温湿度监测点, 异常处理时限, 责任确认状态"
                              value={newConceptForm.attributesStr}
                              onChange={(e) => setNewConceptForm(prev => ({ ...prev, attributesStr: e.target.value }))}
                              className="w-full bg-slate-50 border border-slate-200 rounded p-1.5 text-xs focus:outline-none focus:border-indigo-500 font-medium"
                            />
                          </div>

                          <div className="mb-3">
                            <label className="text-[10px] font-bold text-indigo-500 block mb-1 uppercase tracking-widest">关联细分子行业 (实现通识下钻分类)</label>
                            <input 
                              type="text"
                              placeholder="例如: 生鲜零售、医药零售、直播电商 (非通识概念可留空)"
                              value={newConceptForm.subIndustry || ''}
                              onChange={(e) => setNewConceptForm(prev => ({ ...prev, subIndustry: e.target.value }))}
                              className="w-full bg-slate-50 border border-slate-200 rounded p-1.5 text-xs focus:outline-none focus:border-indigo-500 font-bold text-slate-800 animate-none"
                            />
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {['生鲜零售', '医药零售', '直播电商', '跨境供应链', '仓储物流'].map((pill) => (
                                <button
                                  key={pill}
                                  type="button"
                                  onClick={() => setNewConceptForm(prev => ({ ...prev, subIndustry: pill }))}
                                  className="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 hover:bg-indigo-50 hover:text-indigo-600 hover:border-indigo-150 text-slate-600 transition-all cursor-pointer border border-slate-200 font-medium"
                                >
                                  {pill}
                                </button>
                              ))}
                            </div>
                          </div>

                          <button 
                            id="btn-add-manual-concept"
                            onClick={handleAddManualConcept}
                            disabled={!newConceptForm.name || !newConceptForm.definition}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold py-2 px-4 rounded text-xs ml-auto block disabled:opacity-40 cursor-pointer shadow border-b-2 border-indigo-800 transition-all font-sans"
                          >
                            写入到双轨知识库
                          </button>
                        </div>
                      )}

                    </div>

                  </div>

                </div>
              )}

              {/* TAB 3: AGGREGATE ROOTS AND TOPO LOGS CHANGER */}
              {activeTab === 'entities' && (
                <div className="flex-1 flex flex-col gap-6">

                  {/* Manual addition of aggregates to respect checklist roadmaps */}
                  <div className="bg-white p-5 border border-slate-200 rounded-lg shadow-sm">
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-1.5 border-b border-slate-100 pb-1.5">
                      <PlusCircle size={14} className="text-indigo-600" />
                      人工边界校正：注入聚合根
                    </h4>

                    <div className="grid grid-cols-2 gap-3 mb-3">
                      <div>
                        <label className="text-[10px] font-bold text-slate-400 block mb-1">聚合根英文/中文名</label>
                        <input 
                          id="manual-ar-name"
                          type="text" 
                          placeholder="例如: 采购订单"
                          value={newAggregateForm.name}
                          onChange={(e) => setNewAggregateForm(prev => ({ ...prev, name: e.target.value }))}
                          className="w-full bg-slate-50 border border-slate-200 rounded p-1.5 text-xs focus:outline-none focus:border-indigo-500 font-medium"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-400 block mb-1">仓储交互类名称 (Repository)</label>
                        <input 
                          id="manual-ar-repository"
                          type="text" 
                          placeholder="例如: OrderRepository"
                          value={newAggregateForm.repository}
                          onChange={(e) => setNewAggregateForm(prev => ({ ...prev, repository: e.target.value }))}
                          className="w-full bg-slate-50 border border-slate-200 rounded p-1.5 text-xs focus:outline-none focus:border-indigo-500 font-medium"
                        />
                      </div>
                    </div>

                    <div className="mb-3">
                      <label className="text-[10px] font-bold text-slate-400 block mb-1">不变性物理业务约束条件 (英文或中文，每行或分号分隔)</label>
                      <textarea 
                        id="manual-ar-invariants"
                        rows={2}
                        placeholder="例如: 订单明细中数量不能小于等于0"
                        value={newAggregateForm.invariantsStr}
                        onChange={(e) => setNewAggregateForm(prev => ({ ...prev, invariantsStr: e.target.value }))}
                        className="w-full bg-slate-50 border border-slate-200 rounded p-1.5 text-xs focus:outline-none focus:border-indigo-500 font-medium"
                      />
                    </div>

                    <button 
                      id="btn-add-manual-ar"
                      onClick={handleAddManualAggregate}
                      disabled={!newAggregateForm.name}
                      className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-1.5 px-3 rounded text-xs ml-auto block disabled:opacity-40 cursor-pointer"
                    >
                      增加聚合根
                    </button>
                  </div>

                  {/* Manual addition of entities */}
                  {kb.aggregates.length > 0 && (
                    <div className="bg-white p-5 border border-slate-200 rounded-lg shadow-sm">
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-1.5 border-b border-slate-100 pb-1.5">
                        <PlusCircle size={14} className="text-indigo-600" />
                        添加子实体或值对象
                      </h4>

                      <div className="grid grid-cols-2 gap-3 mb-3">
                        <div>
                          <label className="text-[10px] font-bold text-slate-400 block mb-1">属于哪个聚合边界</label>
                          <select 
                            id="manual-entity-arId"
                            value={newEntityForm.arId}
                            onChange={(e) => setNewEntityForm(prev => ({ ...prev, arId: e.target.value }))}
                            className="w-full bg-slate-50 border border-slate-200 rounded p-1.5 text-xs focus:outline-none focus:border-indigo-500 font-medium"
                          >
                            <option value="">-- 选择聚合根 --</option>
                            {kb.aggregates.map(ar => (
                              <option key={ar.id} value={ar.id}>{ar.name}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-slate-400 block mb-1">子实体中文/英文名称</label>
                          <input 
                            id="manual-entity-name"
                            type="text" 
                            placeholder="例如: 订交货行"
                            value={newEntityForm.name}
                            onChange={(e) => setNewEntityForm(prev => ({ ...prev, name: e.target.value }))}
                            className="w-full bg-slate-50 border border-slate-200 rounded p-1.5 text-xs focus:outline-none focus:border-indigo-500 font-medium"
                          />
                        </div>
                      </div>

                      <div className="mb-3">
                        <label className="text-[10px] font-bold text-slate-400 block mb-1">字段清单（一行一条，例如 name:String:主实体说明:true）</label>
                        <textarea 
                          id="manual-entity-fields"
                          rows={2}
                          placeholder="每一行填入 字段名:属性类型:业务语义含义 (例如 amount:Decimal:应支付金额)"
                          value={newEntityForm.fieldsStr}
                          onChange={(e) => setNewEntityForm(prev => ({ ...prev, fieldsStr: e.target.value }))}
                          className="w-full bg-slate-50 border border-slate-200 rounded p-1.5 text-xs focus:outline-none focus:border-indigo-500 font-medium"
                        />
                      </div>

                      <button 
                        id="btn-add-manual-entity"
                        onClick={handleAddManualEntity}
                        disabled={!newEntityForm.name}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-1.5 px-3 rounded text-xs ml-auto block disabled:opacity-40 cursor-pointer"
                      >
                        增加子实体
                      </button>
                    </div>
                  )}

                  {/* Manual addition of scenarios */}
                  {kb.aggregates.length > 0 && (
                    <div className="bg-white p-5 border border-slate-200 rounded-lg shadow-sm">
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-1.5 border-b border-slate-100 pb-1.5">
                        <PlusCircle size={14} className="text-indigo-600" />
                        注入三维业务应用场景 (3D Capabilities)
                      </h4>

                      <div className="grid grid-cols-3 gap-3 mb-3">
                        <div>
                          <label className="text-[10px] font-bold text-slate-400 block mb-1">绑定聚合根</label>
                          <select 
                            id="manual-scenario-arId"
                            value={newScenarioForm.arId}
                            onChange={(e) => setNewScenarioForm(prev => ({ ...prev, arId: e.target.value }))}
                            className="w-full bg-slate-50 border border-slate-200 rounded p-1.5 text-xs focus:outline-none focus:border-indigo-500 font-medium"
                          >
                            <option value="">-- 聚合根 --</option>
                            {kb.aggregates.map(ar => (
                              <option key={ar.id} value={ar.id}>{ar.name}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-slate-400 block mb-1">场景名称</label>
                          <input 
                            id="manual-scenario-name"
                            type="text" 
                            placeholder="例如: 多级审核"
                            value={newScenarioForm.name}
                            onChange={(e) => setNewScenarioForm(prev => ({ ...prev, name: e.target.value }))}
                            className="w-full bg-slate-50 border border-slate-200 rounded p-1.5 text-xs focus:outline-none focus:border-indigo-500 font-medium"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-slate-400 block mb-1">三维等级划分</label>
                          <select 
                            id="manual-scenario-dimension"
                            value={newScenarioForm.dimension}
                            onChange={(e) => setNewScenarioForm(prev => ({ ...prev, dimension: e.target.value }))}
                            className="w-full bg-slate-50 border border-slate-200 rounded p-1.5 text-xs focus:outline-none focus:border-indigo-500 font-medium"
                          >
                            <option value="execution">操作执行层 (Execution)</option>
                            <option value="supervision">监控规则层 (Supervision)</option>
                            <option value="statistics">量化BI层 (Statistics)</option>
                          </select>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3 mb-3">
                        <div>
                          <label className="text-[10px] font-bold text-slate-400 block mb-1">参与主角Actor</label>
                          <input 
                            id="manual-scenario-actors"
                            type="text" 
                            placeholder="审批人, 采购人..."
                            value={newScenarioForm.actorsStr}
                            onChange={(e) => setNewScenarioForm(prev => ({ ...prev, actorsStr: e.target.value }))}
                            className="w-full bg-slate-50 border border-slate-200 rounded p-1.5 text-xs focus:outline-none focus:border-indigo-500 font-medium"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-slate-400 block mb-1">运行契约前置说明 (One line)</label>
                          <input 
                            id="manual-scenario-preconditions"
                            type="text" 
                            placeholder="采购订单状态等于待审"
                            value={newScenarioForm.preconditionsStr}
                            onChange={(e) => setNewScenarioForm(prev => ({ ...prev, preconditionsStr: e.target.value }))}
                            className="w-full bg-slate-50 border border-slate-200 rounded p-1.5 text-xs focus:outline-none focus:border-indigo-500 font-medium"
                          />
                        </div>
                      </div>

                      <div className="mb-3">
                        <label className="text-[10px] font-bold text-slate-400 block mb-1">核心操作步骤 (一行一步骤)</label>
                        <textarea 
                          id="manual-scenario-steps"
                          rows={2}
                          placeholder="例如: 1. 提交订单 \n 2. 检查额度"
                          value={newScenarioForm.stepsStr}
                          onChange={(e) => setNewScenarioForm(prev => ({ ...prev, stepsStr: e.target.value }))}
                          className="w-full bg-slate-50 border border-slate-200 rounded p-1.5 text-xs focus:outline-none focus:border-indigo-500 font-medium"
                        />
                      </div>

                      <button 
                        id="btn-add-manual-scenario"
                        onClick={handleAddManualScenario}
                        disabled={!newScenarioForm.name || !newScenarioForm.arId}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-1.5 px-3 rounded text-xs ml-auto block disabled:opacity-40 cursor-pointer"
                      >
                        增加业务场景
                      </button>
                    </div>
                  )}

                  {/* Manual addition of Level 2 Modules, Level 3 Elements, and System Interactions */}
                  {kb.aggregates.length > 0 && (
                    <div className="bg-white p-5 border border-slate-200 rounded-lg shadow-sm">
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-1.5 border-b border-slate-100 pb-1.5">
                        <PlusCircle size={14} className="text-indigo-600" />
                        微调三层领域体系及接口集成契约 (3-Level Architecture & System Integrations)
                      </h4>

                      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                        {/* L2 Module Form */}
                        <div className="border border-slate-150 rounded p-3 bg-slate-50/50 flex flex-col justify-between">
                          <div className="space-y-2 text-xs">
                            <span className="text-xs font-bold text-slate-700 block mb-1 pb-1 border-b border-slate-200">⚙️ 注入二级领域功能子模块</span>
                            <div>
                              <label className="text-[10px] text-slate-400 block font-bold">绑定一级聚合</label>
                              <select 
                                value={newModuleForm.arId}
                                onChange={(e) => setNewModuleForm(prev => ({ ...prev, arId: e.target.value }))}
                                className="w-full bg-white border border-slate-200 rounded p-1 text-xs focus:outline-none"
                              >
                                <option value="">-- 请选择一级聚合根 --</option>
                                {kb.aggregates.map(ar => (
                                  <option key={ar.id} value={ar.id}>{ar.name}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="text-[10px] text-slate-400 block font-bold">模块中文/英文名称</label>
                              <input 
                                type="text"
                                placeholder="例如: 阶梯折扣核算引擎"
                                value={newModuleForm.name}
                                onChange={(e) => setNewModuleForm(prev => ({ ...prev, name: e.target.value }))}
                                className="w-full bg-white border border-slate-200 rounded p-1 text-xs focus:outline-none"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] text-slate-400 block font-bold">子模块能力特征分类</label>
                              <select 
                                value={newModuleForm.capabilityType}
                                onChange={(e) => setNewModuleForm(prev => ({ ...prev, capabilityType: e.target.value }))}
                                className="w-full bg-white border border-slate-200 rounded p-1 text-xs focus:outline-none"
                              >
                                <option value="engine">⚙️ 核心流程计算引擎 (engine)</option>
                                <option value="config_center">🎛️ 基础预算配置中心 (config_center)</option>
                                <option value="document_mgmt">📄 实体交易单据管理 (document_mgmt)</option>
                                <option value="other">🌀 其他业务配套子模块 (other)</option>
                              </select>
                            </div>
                            <div>
                              <label className="text-[10px] text-slate-400 block font-bold">架构职责描述</label>
                              <textarea 
                                rows={1}
                                placeholder="描述在系统中所处职责..."
                                value={newModuleForm.description}
                                onChange={(e) => setNewModuleForm(prev => ({ ...prev, description: e.target.value }))}
                                className="w-full bg-white border border-slate-200 rounded p-1 text-xs focus:outline-none"
                              />
                            </div>
                          </div>
                          <button
                            onClick={handleAddManualModule}
                            disabled={!newModuleForm.name || !newModuleForm.arId}
                            className="w-full mt-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-1 rounded text-xs disabled:opacity-40"
                          >
                            增加二级模块
                          </button>
                        </div>

                        {/* L3 Element Form */}
                        <div className="border border-slate-150 rounded p-3 bg-slate-50/50 flex flex-col justify-between">
                          <div className="space-y-2 text-xs">
                            <span className="text-xs font-bold text-slate-700 block mb-1 pb-1 border-b border-slate-200">📌 注入三级操作要素与特定规则</span>
                            <div>
                              <label className="text-[10px] text-slate-400 block font-bold">隶属二级业务子模块</label>
                              <select 
                                value={newElementForm.moduleId}
                                onChange={(e) => setNewElementForm(prev => ({ ...prev, moduleId: e.target.value }))}
                                className="w-full bg-white border border-slate-200 rounded p-1 text-xs focus:outline-none"
                              >
                                <option value="">-- 请选择二级子模块 --</option>
                                {(kb.modules || []).map(m => (
                                  <option key={m.id} value={m.id}>{m.name}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="text-[10px] text-slate-400 block font-bold">要素名称/事务动作</label>
                              <input 
                                type="text"
                                placeholder="例如: 应付对账三单全自动比对"
                                value={newElementForm.name}
                                onChange={(e) => setNewElementForm(prev => ({ ...prev, name: e.target.value }))}
                                className="w-full bg-white border border-slate-200 rounded p-1 text-xs focus:outline-none"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] text-slate-400 block font-bold">特定要素规则类型</label>
                              <select 
                                value={newElementForm.type}
                                onChange={(e) => setNewElementForm(prev => ({ ...prev, type: e.target.value }))}
                                className="w-full bg-white border border-slate-200 rounded p-1 text-xs focus:outline-none"
                              >
                                <option value="sub_process">⛓️ 细分子流程 (sub_process)</option>
                                <option value="lifecycle_node">📌 生命周期生命状态节点 (lifecycle_node)</option>
                                <option value="calculation_logic">📊 逻辑公式/计算机制 (calculation_logic)</option>
                                <option value="decision_logic">🚦 校验和决策逻辑分支 (decision_logic)</option>
                              </select>
                            </div>
                            <div>
                              <label className="text-[10px] text-slate-400 block font-bold">规则公式算法细节描述</label>
                              <textarea 
                                rows={1}
                                placeholder="细节或计算公式算法细节描述..."
                                value={newElementForm.detail}
                                onChange={(e) => setNewElementForm(prev => ({ ...prev, detail: e.target.value }))}
                                className="w-full bg-white border border-slate-200 rounded p-1 text-xs focus:outline-none"
                              />
                            </div>
                          </div>
                          <button
                            onClick={handleAddManualElement}
                            disabled={!newElementForm.name || !newElementForm.moduleId}
                            className="w-full mt-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-1 rounded text-xs disabled:opacity-40"
                          >
                            增加三级要素
                          </button>
                        </div>

                        {/* Integration Form */}
                        <div className="border border-slate-150 rounded p-3 bg-slate-50/50 flex flex-col justify-between">
                          <div className="space-y-2 text-xs">
                            <span className="text-xs font-bold text-slate-700 block mb-1 pb-1 border-b border-slate-200">🌐 注入系统集成关系与边界协议</span>
                            <div>
                              <label className="text-[10px] text-slate-400 block font-bold">本端靶向对接二级子模块</label>
                              <select 
                                value={newInteractionForm.targetModuleId}
                                onChange={(e) => setNewInteractionForm(prev => ({ ...prev, targetModuleId: e.target.value }))}
                                className="w-full bg-white border border-slate-200 rounded p-1 text-xs focus:outline-none"
                              >
                                <option value="">-- 请选择二级子模块 --</option>
                                {(kb.modules || []).map(m => (
                                  <option key={m.id} value={m.id}>{m.name}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="text-[10px] text-slate-400 block font-bold">对方对接支撑外部系统名称</label>
                              <input 
                                type="text"
                                placeholder="例如: 集团用友NCC / SAP ERP"
                                value={newInteractionForm.systemName}
                                onChange={(e) => setNewInteractionForm(prev => ({ ...prev, systemName: e.target.value }))}
                                className="w-full bg-white border border-slate-200 rounded p-1 text-xs focus:outline-none"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] text-slate-400 block font-bold">边界协议传输方向</label>
                              <select 
                                value={newInteractionForm.direction}
                                onChange={(e) => setNewInteractionForm(prev => ({ ...prev, direction: e.target.value }))}
                                className="w-full bg-white border border-slate-200 rounded p-1 text-xs focus:outline-none"
                              >
                                <option value="upstream">📥 入站 Upstream (对方推送数据到本端)</option>
                                <option value="downstream">📤 出站 Downstream (本端发起数据同步推送)</option>
                              </select>
                            </div>
                            <div>
                              <label className="text-[10px] text-slate-400 block font-bold">关联核心协同业务对账流</label>
                              <input 
                                type="text"
                                placeholder="同步采购计划等业务名称..."
                                value={newInteractionForm.coreWorkflow}
                                onChange={(e) => setNewInteractionForm(prev => ({ ...prev, coreWorkflow: e.target.value }))}
                                className="w-full bg-white border border-slate-200 rounded p-1 text-xs focus:outline-none"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] text-slate-400 block font-bold">系统接口与数据逻辑契约</label>
                              <textarea 
                                rows={1}
                                placeholder="接口触发逻辑、协议规范、或核心转换逻辑..."
                                value={newInteractionForm.interfaceLogic}
                                onChange={(e) => setNewInteractionForm(prev => ({ ...prev, interfaceLogic: e.target.value }))}
                                className="w-full bg-white border border-slate-200 rounded p-1 text-xs focus:outline-none"
                              />
                            </div>
                          </div>
                          <button
                            onClick={handleAddManualInteraction}
                            disabled={!newInteractionForm.systemName || !newInteractionForm.targetModuleId}
                            className="w-full mt-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-1 rounded text-xs disabled:opacity-40"
                          >
                            增加接口集成
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Rendering active structures */}
                  <div className="space-y-6">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">已推衍的上下文聚合图谱 ({kb.aggregates.length})</h3>
                    
                    {kb.aggregates.length === 0 ? (
                      <div className="bg-white p-8 text-center text-slate-400 rounded-lg border border-slate-200 shadow-sm">
                        暂无核心聚合，运行建模探索获得
                      </div>
                    ) : (
                      kb.aggregates.map((ar) => {
                        const boundEnt = kb.entities.filter(e => e.aggregateRootId === ar.id);
                        const boundScen = kb.scenarios.filter(sc => sc.aggregateRootId === ar.id);
                        const boundRule = kb.rules.filter(rl => rl.aggregateRootId === ar.id);
                        return (
                          <div key={ar.id} className="bg-white border border-slate-200 rounded-lg shadow-sm relative group overflow-hidden">
                            
                            {/* Inner header */}
                            <div className="bg-slate-50 border-b border-slate-200 px-5 py-4 flex justify-between items-center">
                              <div className="flex items-center gap-2">
                                <Database size={16} className="text-indigo-600" />
                                <h4 className="font-extrabold text-sm text-slate-800">{ar.name}</h4>
                                <span className="text-[10px] font-mono text-slate-400">({ar.repository})</span>
                              </div>
                              <button 
                                id={`btn-delete-ar-${ar.id}`}
                                onClick={() => handleDeleteNode('aggregate', ar.id)}
                                className="text-slate-400 hover:text-rose-600 cursor-pointer text-xs"
                                title="删除聚合"
                              >
                                <Trash2 size={13} />
                              </button>
                            </div>

                            <div className="p-5 flex flex-col gap-4">
                              {/* Invariants */}
                              <div>
                                <h5 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                                  一、领域不变性强制规则 (Business Invariants)
                                </h5>
                                <ul className="list-disc list-inside text-xs text-slate-600 space-y-1 bg-slate-50/50 p-2.5 rounded border border-slate-100">
                                  {ar.invariants.map((inv, idx) => (
                                    <li key={idx} className="leading-relaxed">{inv}</li>
                                  ))}
                                  {ar.invariants.length === 0 && <span className="text-slate-400 italic">暂无固定约束，采用充血自检校验。</span>}
                                </ul>
                              </div>

                              {/* Multi-entities */}
                              <div>
                                <h5 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                                  二、绑定的子主实体及属性词条 ({boundEnt.length})
                                </h5>
                                {boundEnt.length === 0 ? (
                                  <p className="text-xs text-slate-400 italic bg-slate-50 py-2 text-center rounded border border-dashed border-slate-200">
                                    暂无子实体
                                  </p>
                                ) : (
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    {boundEnt.map((ent) => (
                                      <div key={ent.id} className="border border-slate-150 p-3 rounded bg-slate-50 relative group/ent">
                                        <button 
                                          id={`btn-delete-ent-${ent.id}`}
                                          onClick={() => handleDeleteNode('entity', ent.id)}
                                          className="absolute top-2 right-2 text-slate-300 hover:text-rose-500 cursor-pointer hidden group-hover/ent:block"
                                          title="删除子实体"
                                        >
                                          <X size={12} />
                                        </button>
                                        <p className="text-xs font-bold text-slate-700 mb-1">{ent.name}</p>
                                        <div className="space-y-1">
                                          {ent.fields.map((f, i) => (
                                            <div key={i} className="flex justify-between text-[10px] font-mono text-slate-500 border-b border-slate-100 pb-0.5 last:border-0 last:pb-0">
                                              <span>{f.name} {f.isIdentifier && '🔑'}</span>
                                              <span className="text-indigo-600 font-bold">{f.type}</span>
                                            </div>
                                          ))}
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>

                              {/* Business Scenarios */}
                              <div>
                                <h5 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                                  三、对应的业务契约场景 ({boundScen.length})
                                </h5>
                                {boundScen.length === 0 ? (
                                  <p className="text-xs text-slate-400 italic bg-slate-50 py-2 text-center rounded border border-dashed border-slate-200">
                                    暂无业务应用场景
                                  </p>
                                ) : (
                                  <div className="space-y-3">
                                    {boundScen.map((sc) => {
                                      const dimLabels = {
                                        execution: '操作执行层',
                                        supervision: '风控检验层',
                                        statistics: '量化审计层'
                                      };
                                      return (
                                        <div key={sc.id} className="border border-slate-150 p-3.5 rounded bg-white relative group/sc">
                                          <button 
                                            id={`btn-delete-scen-${sc.id}`}
                                            onClick={() => handleDeleteNode('scenario', sc.id)}
                                            className="absolute top-2 right-2 text-slate-300 hover:text-rose-500 cursor-pointer hidden group-hover/sc:block"
                                            title="删除场景"
                                          >
                                            <X size={12} />
                                          </button>
                                          <div className="flex items-center gap-2 mb-1.5">
                                            <span className="text-xs font-extrabold text-slate-800">{sc.name}</span>
                                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                                              sc.capabilityDimension === 'execution' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' :
                                              sc.capabilityDimension === 'supervision' ? 'bg-amber-50 text-amber-700 border border-amber-100' :
                                              'bg-rose-50 text-rose-700 border border-rose-100'
                                            }`}>
                                              {dimLabels[sc.capabilityDimension]}
                                            </span>
                                          </div>
                                          <p className="text-[10px] text-slate-500 mb-1"><b>运行角色(Actors)</b>: {sc.actors.join(', ')}</p>
                                          <div className="pl-2 space-y-0.5 text-[11px] text-slate-600">
                                            {sc.steps.map((st, i) => (
                                              <p key={i}>- 第一步 {st}</p>
                                            ))}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>

                              {/* Core Rules */}
                              {boundRule.length > 0 && (
                                <div>
                                  <h5 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                                    四、高防线业务计算逻辑规则 ({boundRule.length})
                                  </h5>
                                  <div className="space-y-2">
                                    {boundRule.map((rl) => (
                                      <div key={rl.id} className="border border-dashed border-indigo-200 p-2.5 bg-indigo-50/20 rounded">
                                        <p className="text-xs font-bold text-slate-700 mb-1">{rl.name}</p>
                                        <p className="text-[11px] text-slate-600 leading-relaxed mb-1.5">{rl.rule}</p>
                                        <pre className="p-2 bg-slate-900 text-slate-300 text-[10px] font-mono rounded overflow-x-auto select-text">
                                          {rl.implementationHint}
                                        </pre>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Level 2 & Level 3 Depth */}
                              <div>
                                <h5 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                                  五、提炼的二级领域模块与三级业务要素 ({(kb.modules || []).filter(m => m.aggregateRootId === ar.id).length})
                                </h5>
                                {((kb.modules || []).filter(m => m.aggregateRootId === ar.id)).length === 0 ? (
                                  <p className="text-xs text-slate-400 italic bg-slate-50 py-2 text-center rounded border border-dashed border-slate-200">
                                    暂无二级业务场景模块和三级操作要素，通过 AI 迭代演绎获取模型数据
                                  </p>
                                ) : (
                                  <div className="grid grid-cols-1 gap-3">
                                    {((kb.modules || []).filter(m => m.aggregateRootId === ar.id)).map((mod) => {
                                      const modElements = (kb.elements || []).filter(el => el.moduleId === mod.id);
                                      const capTypeLabels: Record<string, string> = {
                                        engine: '⚙️ 规则计算引擎',
                                        config_center: '🎛️ 预算配置中心',
                                        document_mgmt: '📄 交易单据管理',
                                        other: '🌀 辅助模块'
                                      };
                                      return (
                                        <div key={mod.id} className="border border-slate-200 p-3.5 rounded bg-slate-50/30 hover:bg-slate-50/60 transition relative group/mod">
                                          <button 
                                            id={`btn-delete-mod-${mod.id}`}
                                            onClick={() => handleDeleteNode('module', mod.id)}
                                            className="absolute top-3 right-3 text-slate-300 hover:text-rose-500 cursor-pointer hidden group-hover/mod:block"
                                            title="删除核心子模块"
                                          >
                                            <X size={12} />
                                          </button>
                                          
                                          <div className="flex items-center gap-2 mb-1.5">
                                            <span className="text-xs font-bold text-indigo-950 font-sans">{mod.name}</span>
                                            <span className="text-[9px] bg-indigo-50 text-indigo-700 px-1.5 py-0.5 rounded border border-indigo-100 font-bold">
                                              {capTypeLabels[mod.capabilityType] || mod.capabilityType}
                                            </span>
                                          </div>
                                          <p className="text-xs text-slate-600 leading-relaxed font-sans">{mod.description}</p>

                                          {/* Level 3 technical elements */}
                                          {modElements.length > 0 && (
                                            <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
                                              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">📌 下辖具体三级业务要素 (Subflows, Calculations & Lifecycles)</span>
                                              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                                {modElements.map(el => {
                                                  const typeLabels: Record<string, string> = {
                                                    sub_process: '⛓️ 细分子流程',
                                                    lifecycle_node: '📌 关键状态生命期节点',
                                                    calculation_logic: '📊 核心算力校验/折扣公式',
                                                    decision_logic: '🚦 约束断定/分支决策'
                                                  };
                                                  return (
                                                    <div key={el.id} className="bg-white p-2.5 border border-slate-200 rounded text-xs hover:border-indigo-300 transition relative group/el">
                                                      <button 
                                                        id={`btn-delete-el-${el.id}`}
                                                        onClick={() => handleDeleteNode('element', el.id)}
                                                        className="absolute top-1.5 right-1.5 text-slate-300 hover:text-rose-500 cursor-pointer hidden group-hover/el:block"
                                                        title="删除要素"
                                                      >
                                                        <X size={11} />
                                                      </button>
                                                      <div className="flex items-center gap-1.5 mb-1 text-[11px] font-bold text-slate-800">
                                                        <span>{el.name}</span>
                                                      </div>
                                                      <span className="text-[9px] text-indigo-700 bg-indigo-50/60 px-1.5 py-0.2 rounded font-extrabold">{typeLabels[el.type] || el.type}</span>
                                                      <p className="text-[11px] text-slate-500 mt-1 pl-1 border-l-2 border-slate-200 leading-normal font-sans italic">{el.detail}</p>
                                                    </div>
                                                  );
                                                })}
                                              </div>
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>

                              {/* Upstream/Downstream system maps */}
                              <div>
                                <h5 className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">
                                  六、物理上下游系统协同与跨系统契约交互矩阵 (Upstream/Downstream Matrix)
                                </h5>
                                {((kb.interactions || []).filter(inter => 
                                  ((kb.modules || []).filter(m => m.aggregateRootId === ar.id)).some(bm => bm.id === inter.targetModuleId)
                                )).length === 0 ? (
                                  <p className="text-xs text-slate-400 italic bg-slate-50 py-2 text-center rounded border border-dashed border-slate-200">
                                    暂无关联的外部系统交互契约层设计，可通过推理或补充填报沉淀
                                  </p>
                                ) : (
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    {((kb.interactions || []).filter(inter => 
                                      ((kb.modules || []).filter(m => m.aggregateRootId === ar.id)).some(bm => bm.id === inter.targetModuleId)
                                    )).map((inter) => {
                                      const alignedMod = (kb.modules || []).find(bm => bm.id === inter.targetModuleId);
                                      return (
                                        <div key={inter.id} className="border border-slate-200 p-3.5 rounded bg-slate-50/40 relative group/inter hover:bg-slate-50 transition">
                                          <button 
                                            id={`btn-delete-inter-${inter.id}`}
                                            onClick={() => handleDeleteNode('interaction', inter.id)}
                                            className="absolute top-2 right-2 text-slate-300 hover:text-rose-500 cursor-pointer hidden group-hover/inter:block"
                                            title="删除外部交互对账接口"
                                          >
                                            <X size={12} />
                                          </button>
                                          
                                          <div className="flex items-center gap-2 mb-1.5">
                                            <span className="text-xs font-bold text-indigo-950 font-sans">{inter.systemName}</span>
                                            <span className={`text-[9px] px-1.5 py-0.5 rounded font-extrabold border ${
                                              inter.direction === 'upstream' ? 'bg-blue-50 text-blue-700 border-blue-100' : 'bg-teal-50 text-teal-700 border-teal-100'
                                            }`}>
                                              {inter.direction === 'upstream' ? '📥 入站 Upstream (对方发起)' : '📤 出站 Downstream (本端推送)'}
                                            </span>
                                          </div>
                                          
                                          <div className="text-[11px] text-slate-600 space-y-1 font-sans">
                                            <p><b>对齐核心流程</b>: {inter.coreWorkflow}</p>
                                            <p><b>对应本端二级子模块</b>: <span className="font-bold text-indigo-700">{alignedMod ? alignedMod.name : '全部模块'}</span></p>
                                            <div className="bg-white p-2.5 rounded border border-slate-100 text-[10.5px] text-slate-500 font-medium leading-relaxed italic mt-1">
                                              {inter.interfaceLogic}
                                            </div>
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>

                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>

                </div>
              )}

              {/* TAB 4: SYSTEM CONFIG PANEL & MD GENERATION */}
              {activeTab === 'exports' && config && (
                <div className="flex-1 flex flex-col gap-6">
                  
                  {/* YAML Config adjusters */}
                  <div className="bg-white p-6 border border-slate-200 rounded-lg shadow-sm flex flex-col gap-5">
                    <div>
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5">一、高阶系统设定调解盘 (YAML Tuning Board)</h4>
                      <p className="text-xs text-slate-400">在此实时修改，将直接反应至下一轮迭代探针提出中。</p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs font-bold text-slate-600 block mb-1.5">系统深度定级 (Target Level)</label>
                        <select 
                          id="config-targetLevel"
                          value={config.targetLevel}
                          onChange={(e) => handleConfigChange('targetLevel', e.target.value)}
                          className="w-full bg-slate-50 border border-slate-200 rounded p-2 text-xs focus:outline-none focus:border-indigo-500 font-semibold"
                        >
                          <option value="mvp">最小化验证版 (MVP)</option>
                          <option value="standard">标准商用版 (Standard)</option>
                          <option value="enterprise">高并发企业级 (Enterprise)</option>
                        </select>
                      </div>

                      <div>
                        <label className="text-xs font-bold text-slate-600 block mb-1.5">探索模型设定 (Methodology Focus)</label>
                        <select 
                          id="config-focusType"
                          value={config.focusType}
                          onChange={(e) => handleConfigChange('focusType', e.target.value)}
                          className="w-full bg-slate-50 border border-slate-200 rounded p-2 text-xs focus:outline-none focus:border-indigo-500 font-semibold"
                        >
                          <option value="none">全局全网面扫描对标 (Global Sweep)</option>
                          <option value="aggregate_root">定位到具体内部边界 (Aggregate Focus)</option>
                        </select>
                      </div>
                    </div>

                    {config.focusType === 'aggregate_root' && (
                      <div className="border-t border-slate-100 pt-3">
                        <label className="text-xs font-bold text-slate-600 block mb-1.5">聚焦定位聚合根名/实体名</label>
                        <input 
                          id="config-focusName"
                          type="text"
                          placeholder="例如: 采购订单"
                          value={config.focusName}
                          onChange={(e) => handleConfigChange('focusName', e.target.value)}
                          className="w-full bg-slate-50 border border-slate-200 rounded p-2 text-xs focus:outline-none focus:border-indigo-500 font-medium"
                        />
                      </div>
                    )}

                    <div className="grid grid-cols-3 gap-3 border-t border-slate-100 pt-4">
                      <div>
                        <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">执行权重 (W_Exec)</label>
                        <input 
                          id="config-weight-exec"
                          type="number"
                          step="0.05"
                          min="0.1"
                          max="0.8"
                          value={config.capabilityMatrix.execution.weight}
                          onChange={(e) => {
                            const updated = { ...config.capabilityMatrix };
                            updated.execution.weight = Number(e.target.value);
                            handleConfigChange('capabilityMatrix', updated);
                          }}
                          className="w-full bg-slate-50 border border-slate-200 rounded p-2 text-xs font-mono"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">监管权重 (W_Superv)</label>
                        <input 
                          id="config-weight-superv"
                          type="number"
                          step="0.05"
                          min="0.1"
                          max="0.8"
                          value={config.capabilityMatrix.supervision.weight}
                          onChange={(e) => {
                            const updated = { ...config.capabilityMatrix };
                            updated.supervision.weight = Number(e.target.value);
                            handleConfigChange('capabilityMatrix', updated);
                          }}
                          className="w-full bg-slate-50 border border-slate-200 rounded p-2 text-xs font-mono"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1">监控权重 (W_Stat)</label>
                        <input 
                          id="config-weight-stat"
                          type="number"
                          step="0.05"
                          min="0.1"
                          max="0.8"
                          value={config.capabilityMatrix.statistics.weight}
                          onChange={(e) => {
                            const updated = { ...config.capabilityMatrix };
                            updated.statistics.weight = Number(e.target.value);
                            handleConfigChange('capabilityMatrix', updated);
                          }}
                          className="w-full bg-slate-50 border border-slate-200 rounded p-2 text-xs font-mono"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 border-t border-slate-100 pt-4">
                      <div>
                        <label className="text-xs font-bold text-slate-600 block mb-1">最大迭代轮次 (Max Rounds)</label>
                        <input 
                          id="config-iteration-maxRounds"
                          type="number"
                          min="2"
                          max="10"
                          value={config.iteration.maxRounds}
                          onChange={(e) => {
                            const updated = { ...config.iteration, maxRounds: Number(e.target.value) };
                            handleConfigChange('iteration', updated);
                          }}
                          className="w-full bg-slate-50 border border-slate-200 rounded p-2 text-xs font-medium"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-bold text-slate-600 block mb-1">收敛通过阈值分 (Completeness Threshold)</label>
                        <input 
                          id="config-iteration-completenessThreshold"
                          type="number"
                          step="0.05"
                          min="0.6"
                          max="0.95"
                          value={config.iteration.completenessThreshold}
                          onChange={(e) => {
                            const updated = { ...config.iteration, completenessThreshold: Number(e.target.value) };
                            handleConfigChange('iteration', updated);
                          }}
                          className="w-full bg-slate-50 border border-slate-200 rounded p-2 text-xs font-medium"
                        />
                      </div>
                    </div>

                     <div className="border-t border-slate-100 pt-4">
                      <label className="text-xs font-bold text-slate-600 block mb-1.5">核心 LLM 推理大模型 (Core AI Engine)</label>
                      <select 
                        id="config-preferredModel"
                        value={config.preferredModel || 'gemini'}
                        onChange={(e) => handleConfigChange('preferredModel', e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded p-2 text-xs focus:outline-none focus:border-indigo-500 font-semibold text-slate-800"
                      >
                        <option value="gemini">♊ Google Gemini 3.5 Flash (官方推荐高可用默认)</option>
                        <option value="deepseek">🔵 DeepSeek-Chat (备选推理模型)</option>
                      </select>
                      <p className="text-[11px] text-slate-400 mt-1">
                        系统默认优先使用 <b>Gemini</b>。开启任务后，引擎将在演绎推理、冲突融合等核心逻辑调用 Google Gemini 接口。检索实证环节采用双引擎设计，默认直连 <b>Tavily</b> 搜索引擎进行行业标准深度对标，并智能运用 Google Search Grounding 作为高可用辅助备份，为架构探针提供双重实证 and 精确溯源支持。
                      </p>
                    </div>

                  </div>

                  {/* Reference Architecture Import Card */}
                  <div className="bg-white p-6 border border-slate-200 rounded-lg shadow-sm flex flex-col gap-5">
                    <div>
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1.5">二、企业参考架构与重点方向导入 (Optional Reference Architecture)</h4>
                      <p className="text-xs text-slate-400">导入公司现有架构或产品架构信息。系统在推演建模时，将主动对标并融入导入的设定，重点弥补现有短板与倾向性补全。（非必选，不导入则按通用最佳实践与大厂对标进行建模）</p>
                    </div>

                    <div className="flex flex-col gap-4">
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-xs font-bold text-slate-600 block">公司架构信息参考 (Company Architecture Context)</label>
                          <span className="text-[10px] text-slate-400 font-medium">支持多行文本或草稿</span>
                        </div>
                        <textarea
                          id="config-companyArch"
                          rows={3}
                          placeholder="例如：公司目前采用微服务架构，包含基础用户中心、OMS订单系统、WMS仓库管理。但缺乏统一的履约调度层和温控质检能力..."
                          value={config.referenceArch?.companyArchitecture || ''}
                          onChange={(e) => {
                            const ref = config.referenceArch || { companyArchitecture: '', productArchitecture: '', keyDirections: '' };
                            handleConfigChange('referenceArch', { ...ref, companyArchitecture: e.target.value });
                          }}
                          className="w-full bg-slate-50 border border-slate-200 rounded p-2 text-xs focus:outline-none focus:border-indigo-500 font-medium font-sans text-slate-800 placeholder-slate-400 focus:bg-white transition-colors resize-y"
                        />
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-xs font-bold text-slate-600 block">现有产品架构参考 (Product Architecture Reference)</label>
                          <span className="text-[10px] text-slate-400 font-medium">支持核心模块及API契约参考</span>
                        </div>
                        <textarea
                          id="config-productArch"
                          rows={3}
                          placeholder="例如：核心单据包含：采购申请单、采购入库单。产品目前支持的基础流程是“采购-入库-核销”，但亟需增加合规资质审查和自动结转流程..."
                          value={config.referenceArch?.productArchitecture || ''}
                          onChange={(e) => {
                            const ref = config.referenceArch || { companyArchitecture: '', productArchitecture: '', keyDirections: '' };
                            handleConfigChange('referenceArch', { ...ref, productArchitecture: e.target.value });
                          }}
                          className="w-full bg-slate-50 border border-slate-200 rounded p-2 text-xs focus:outline-none focus:border-indigo-500 font-medium font-sans text-slate-800 placeholder-slate-400 focus:bg-white transition-colors resize-y"
                        />
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <label className="text-xs font-bold text-slate-600 block text-indigo-600">🎯 重点补全的方向与倾斜特征 (Key Directions & Focus Features)</label>
                          <span className="text-[10px] text-indigo-500 font-bold">高亮倾向性</span>
                        </div>
                        <textarea
                          id="config-keyDirections"
                          rows={3}
                          placeholder="例如：重点弥补医药GSP合规性，在采购入库环节强融合处方核对和温湿度探针。模型推演时，需向冷链温控和GSP资质强审核方向倾斜..."
                          value={config.referenceArch?.keyDirections || ''}
                          onChange={(e) => {
                            const ref = config.referenceArch || { companyArchitecture: '', productArchitecture: '', keyDirections: '' };
                            handleConfigChange('referenceArch', { ...ref, keyDirections: e.target.value });
                          }}
                          className="w-full bg-slate-50 border border-slate-200 rounded p-2 text-xs focus:outline-none focus:border-indigo-500 font-medium font-sans text-slate-800 placeholder-slate-400 focus:bg-white transition-colors border-indigo-100 focus:border-indigo-500 resize-y"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Manual artifacts file downloads export & import */}
                  <div className="bg-white p-6 border border-slate-200 rounded-lg shadow-sm flex flex-col gap-6">
                    {/* Header */}
                    <div className="flex items-center gap-3">
                      <FileText className="text-indigo-600" size={24} />
                      <div>
                        <h4 className="text-sm font-extrabold text-slate-800">领域架构规范说明书 (Markdown 文件)</h4>
                        <p className="text-xs text-slate-400 mt-1">
                          支持将系统模型导出为标准规范说明书，或将之前导出的 Markdown 文件重新导入，加载、还原对应的领域知识。
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Export Area */}
                      <div className="border border-slate-100 rounded-lg p-4 bg-slate-50 flex flex-col justify-between gap-4">
                        <div>
                          <span className="text-xs font-bold text-slate-700 block mb-1">导出领域架构 (Export)</span>
                          <p className="text-[11px] text-slate-400 leading-relaxed">
                            导出包含词汇字典、聚合根、不变性校验、深度三层架构及接口契约等完整维度的 Markdown 说明书。
                          </p>
                        </div>
                        <a 
                          id="link-export-md"
                          href={`/api/domains/${selectedDomainId}/export`} 
                          download
                          className="bg-slate-900 hover:bg-black text-white font-bold py-2.5 px-4 rounded text-xs flex items-center justify-center gap-2 cursor-pointer transition-all border-b-2 border-slate-700"
                        >
                          <Download size={14} />
                          下载 领域架构说明书.md Artifact
                        </a>
                      </div>

                      {/* Import Area */}
                      <div className="border border-slate-100 rounded-lg p-4 bg-slate-50 flex flex-col justify-between gap-4">
                        <div>
                          <span className="text-xs font-bold text-slate-700 block mb-1">导入领域架构 (Import)</span>
                          <p className="text-[11px] text-slate-400 leading-relaxed">
                            支持拖拽或选择曾经导出的 Markdown 规格说明书文件，系统将重新解析所有模型规格及元数据。
                          </p>
                        </div>

                        {/* Drag and Drop Zone */}
                        <div 
                          id="md-dropzone"
                          onDragOver={(e) => {
                            e.preventDefault();
                            e.currentTarget.classList.add('border-indigo-400', 'bg-indigo-50/30');
                          }}
                          onDragLeave={(e) => {
                            e.preventDefault();
                            e.currentTarget.classList.remove('border-indigo-400', 'bg-indigo-50/30');
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            e.currentTarget.classList.remove('border-indigo-400', 'bg-indigo-50/30');
                            if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                              handleImportMarkdown(e.dataTransfer.files[0]);
                            }
                          }}
                          className="border-2 border-dashed border-slate-200 hover:border-indigo-400 rounded-lg p-3 text-center flex flex-col items-center justify-center gap-1 cursor-pointer transition-all bg-white"
                          onClick={() => document.getElementById('md-file-input')?.click()}
                        >
                          <Upload className="text-slate-400 hover:text-indigo-500 transition-colors" size={20} />
                          <span className="text-[11px] font-bold text-slate-600">
                            {isImporting ? '正在解析导入...' : '拖拽文件至此 或 点击上传'}
                          </span>
                          <span className="text-[9px] text-slate-400">支持 .md 后缀的架构说明书文件</span>
                          <input 
                            type="file" 
                            id="md-file-input" 
                            accept=".md" 
                            className="hidden" 
                            onChange={(e) => {
                              if (e.target.files && e.target.files[0]) {
                                handleImportMarkdown(e.target.files[0]);
                              }
                            }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Status Message */}
                    {importStatusMsg && (
                      <div className={`p-3 rounded text-xs flex items-start gap-2 ${
                        importStatusMsg.type === 'success' 
                          ? 'bg-emerald-50 text-emerald-800 border border-emerald-100' 
                          : 'bg-rose-50 text-rose-800 border border-rose-100'
                      }`}>
                        {importStatusMsg.type === 'success' ? (
                          <CheckCircle2 size={16} className="text-emerald-600 shrink-0 mt-0.5" />
                        ) : (
                          <XCircle size={16} className="text-rose-600 shrink-0 mt-0.5" />
                        )}
                        <span className="font-medium">{importStatusMsg.text}</span>
                      </div>
                    )}
                  </div>

                </div>
              )}

              {/* TAB 5: ARCHITECTURE TOPOLOGY VISUALIZER */}
              {activeTab === 'topology' && kb && (
                <DependencyTopology 
                  kb={kb} 
                  onUpdateKB={(updatedKB) => {
                    setKb(updatedKB);
                    if (selectedDomainId) {
                      fetch(`/api/domains/${selectedDomainId}/kb`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(updatedKB)
                      })
                      .then(res => res.json())
                      .then(data => {
                        if (data.success) {
                          console.log('Successfully persisted topology updates');
                        } else {
                          console.error('Failed to persist topology updates:', data.error);
                        }
                      })
                      .catch(err => {
                        console.error('Error persisting topology updates:', err);
                      });
                    }
                  }}
                />
              )}

            </div>

            {/* COLUMN C (RIGHT COLUMN): 3D CAPABILITY MATRIX GRAPH FOR CHALK CHECKS */}
            <div id="capability-col" className={`col-span-3 bg-white p-6 flex flex-col gap-8 max-h-[calc(100vh-4rem)] overflow-y-auto ${showRightPanel ? 'lg:flex' : 'lg:hidden'} hidden lg:flex`}>
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">3D Capability Matrix</h3>
              
              <div className="space-y-6">
                
                {/* 1. EXECUTION */}
                <div className="flex flex-col gap-2">
                  <div className="flex justify-between text-xs font-semibold">
                    <span className="text-slate-750">Execution Operations (操作层)</span> 
                    <span className="text-emerald-500 font-bold">{dimStats.execution}%</span>
                  </div>
                  <div className="h-10 grid grid-cols-10 gap-1">
                    {[...Array(10)].map((_, i) => (
                      <div 
                        key={i} 
                        className={`transition-colors duration-300 ${i < Math.round(dimStats.execution / 10) ? 'bg-emerald-500 animate-pulse' : 'bg-slate-100'}`}
                      />
                    ))}
                  </div>
                  <p className="text-[10px] text-slate-400">领域内基础业务动作与操作事件覆盖程度</p>
                </div>

                {/* 2. SUPERVISION */}
                <div className="flex flex-col gap-2">
                  <div className="flex justify-between text-xs font-semibold">
                    <span className="text-slate-750">Supervision Audit (风控层)</span> 
                    <span className="text-amber-500 font-bold">{dimStats.supervision}%</span>
                  </div>
                  <div className="h-10 grid grid-cols-10 gap-1">
                    {[...Array(10)].map((_, i) => (
                      <div 
                        key={i} 
                        className={`transition-colors duration-300 ${i < Math.round(dimStats.supervision / 10) ? 'bg-amber-500' : 'bg-slate-100'}`}
                      />
                    ))}
                  </div>
                  <p className="text-[10px] text-slate-400">多级合规审批，大额受控以及不变性约束级别</p>
                </div>

                {/* 3. STATISTICS */}
                <div className="flex flex-col gap-2">
                  <div className="flex justify-between text-xs font-semibold">
                    <span className="text-slate-750">Statistics CFO/BI (决策层)</span> 
                    <span className="text-rose-500 font-bold">{dimStats.statistics}%</span>
                  </div>
                  <div className="h-10 grid grid-cols-10 gap-1">
                    {[...Array(10)].map((_, i) => (
                      <div 
                        key={i} 
                        className={`transition-colors duration-300 ${i < Math.round(dimStats.statistics / 10) ? 'bg-rose-500' : 'bg-slate-100'}`}
                      />
                    ))}
                  </div>
                  <p className="text-[10px] text-slate-400">应付流动性预测、履约时效统计与量化决策指标</p>
                </div>

                {/* Cognitive Deduction direction card */}
                <div className="bg-indigo-900 p-4 rounded text-white mt-4 relative overflow-hidden shadow-md">
                  <div className="absolute right-0 bottom-0 opacity-10 font-bold text-7xl select-none translate-y-4 translate-x-4">
                    3D
                  </div>
                  <div className="text-xs font-extrabold uppercase mb-1 flex items-center gap-1">
                    <Cpu size={12} className="text-indigo-400" />
                    <span>Deduction Guidance Priority</span>
                  </div>
                  <p className="text-[11px] text-indigo-200 leading-relaxed">
                    应根据上述覆盖率，优先配置或由系统自动针对 <b>
                      {dimStats.execution <= dimStats.supervision && dimStats.execution <= dimStats.statistics ? '操作执行层 (Execution)' :
                       dimStats.supervision <= dimStats.statistics ? '风控监管层 (Supervision)' : '决策量化层 (Statistics)'}
                    </b> 相关的业务假设进行查验！
                  </p>
                </div>

              </div>
            </div>

          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center p-12 text-slate-400 bg-slate-50">
            <div className="text-center max-w-sm">
              <Compass size={48} className="mx-auto mb-4 text-slate-300 animate-spin" />
              <p className="text-sm font-semibold">加载领域知识工程配置中...</p>
              <p className="text-xs text-slate-400 mt-1">若是新项目，点击左上侧“新建领域”创建一个新的项目边界。</p>
            </div>
          </div>
        )}

        {/* RECTILINEAR FOOTER */}
        <footer id="stage-footer" className="h-12 bg-white border-t border-slate-200 px-8 flex items-center justify-between text-[11px] font-mono text-slate-400 shrink-0">
          <div className="flex gap-6 uppercase">
            <span>Session Code: 2026-SRM-PRO-ENGINE</span>
            <span>STORAGE: SQLITE MEMORY DB</span>
            <span>Search Grounding: ACTIVE</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> 
            <span>SYSTEM RUNNING</span>
          </div>
        </footer>

      </main>

      {/* CREATE NEW DOMAIN MODAL */}
      {showCreateDomainModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl border border-slate-200 max-w-md w-full p-6 animate-in fade-in-80 duration-150">
            <div className="flex justify-between items-center mb-4 pb-3 border-b border-slate-100">
              <h3 className="font-bold text-slate-800 text-sm tracking-tight flex items-center gap-1.5">
                <Database size={16} className="text-indigo-600" />
                初始化新业务领域智能建模
              </h3>
              <button 
                id="btn-close-create-modal"
                onClick={() => setShowCreateDomainModal(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleCreateDomain} className="space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1">领域业务实体名称 (例如: 电商订单系统、生鲜配送行业)</label>
                <div className="flex gap-2">
                  <input 
                    id="create-domain-name"
                    type="text" 
                    placeholder="请输入中文领域名称"
                    value={domainNameInput}
                    onChange={(e) => setDomainNameInput(e.target.value)}
                    className="flex-1 bg-slate-50 border border-slate-250 rounded p-2 text-xs font-medium focus:outline-none focus:border-indigo-500 font-bold"
                    required
                  />
                  <button
                    type="button"
                    onClick={handleAnalyzeStructure}
                    disabled={isAnalyzingStructure || !domainNameInput.trim()}
                    className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white font-bold p-2 text-xs rounded transition-all cursor-pointer whitespace-nowrap"
                    title="高精度诊断领域属性并智能对标大厂系统"
                  >
                    {isAnalyzingStructure ? '分析中...' : '🔍 对标识别'}
                  </button>
                </div>
                <p className="text-[10px] text-slate-450 mt-1">
                  输入名称后点击对标识别，将自动对标大厂系统论证并决定复合双轨或单轨模式。
                </p>
              </div>

              {analysisResult && (
                <div className={`p-3 rounded border text-xs space-y-1.5 transition-all ${analysisResult.trackType === 'double' ? 'bg-indigo-50/50 border-indigo-150' : 'bg-amber-50/50 border-amber-100'}`}>
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-700">智能对标评估：</span>
                    <span className={`px-2 py-0.5 rounded text-[9px] font-extrabold tracking-wider ${analysisResult.trackType === 'double' ? 'bg-indigo-100 text-indigo-700 border border-indigo-200' : 'bg-amber-100 text-amber-700 border border-amber-150'}`}>
                      {analysisResult.trackType === 'double' ? '✦ 推荐：双轨复合模型 (包含系统级主概念)' : '✦ 推荐：单轨纯行业及知识体系'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-600 leading-normal">
                    <strong>对标详情: </strong>{analysisResult.reasoning}
                  </p>
                  {analysisResult.trackType === 'single' ? (
                    <div className="bg-amber-100/30 p-1.5 rounded text-[10px] text-amber-800 leading-normal font-medium">
                      💡 物理行业分类已锚定。核心系统代码标识自动对标为 <strong>无/None</strong>，后续的低阶技术细节（如工程代码或聚合根表）将智能精简开启，协助聚焦在纯物理领域的 SOP 与风险痛点推演树上。
                    </div>
                  ) : (
                    <div className="bg-indigo-100/30 p-1.5 rounded text-[10px] text-indigo-800 leading-normal font-medium">
                      💡 复合软件资产已锚定。核心系统代码标识自动对标为 <strong>{analysisResult.systemName}</strong>，适合同时搭建行业树和系统树（系统核心代码边界已对齐大厂标准）。
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1">
                  核心系统代码标示 (双轨填核心软件简称，单轨识别填 "无")
                </label>
                <input 
                  id="create-domain-sysname"
                  type="text" 
                  placeholder="系统代码如 OrderSystem、TradeCore、MESPro (或填：无)"
                  value={domainSysNameInput}
                  onChange={(e) => setDomainSysNameInput(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-250 rounded p-2 text-xs font-semibold focus:outline-none focus:border-indigo-500 font-mono text-slate-700"
                  required
                />
              </div>

              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1">项目目标描述与聚焦领域上下文</label>
                <textarea 
                  id="create-domain-desc"
                  rows={3} 
                  placeholder="请详细描述此领域的商业场景与功能闭环意图等。"
                  value={domainDescInput}
                  onChange={(e) => setDomainDescInput(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-250 rounded p-2 text-xs font-medium focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="flex gap-3 pt-4 border-t border-slate-100">
                <button 
                  id="btn-cancel-create"
                  type="button" 
                  onClick={() => {
                    setShowCreateDomainModal(false);
                    setAnalysisResult(null);
                  }}
                  className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold py-2 rounded text-xs cursor-pointer transition-all"
                >
                  取消
                </button>
                <button 
                  id="btn-submit-create"
                  type="submit"
                  disabled={!domainNameInput || !domainSysNameInput}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2 rounded text-xs cursor-pointer transition-all disabled:opacity-40"
                >
                  确定构建初始化
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* DELETE CONFIRM MODAL */}
      {showDeleteConfirmModal && (
        <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center z-[100] p-4">
          <div className="bg-white rounded-lg shadow-xl border border-rose-150 max-w-sm w-full p-6 animate-in fade-in-80 duration-150">
            <div className="flex items-center gap-3 mb-4 text-rose-600">
              <div className="p-2 bg-rose-50 rounded-full">
                <Trash2 size={20} />
              </div>
              <h3 className="font-bold text-slate-805 text-sm tracking-tight">
                确认删除此领域知识工程吗？
              </h3>
            </div>
            
            <p className="text-xs text-slate-500 leading-relaxed mb-6">
              您正在试图删除领域 <strong>{domains.find(d => d.id === showDeleteConfirmModal)?.name || '当前领域'}</strong>。此操作将永久清空该域下的双轨建模、实体树、行业规则、自动推演日志等资产，且<strong>绝对无法恢复或撤销</strong>。
            </p>

            <div className="flex gap-3">
              <button 
                type="button" 
                onClick={() => setShowDeleteConfirmModal(null)}
                className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold py-2 rounded text-xs cursor-pointer transition-all border border-slate-200"
              >
                关闭
              </button>
              <button 
                type="button"
                onClick={handleConfirmDeleteDomain}
                className="flex-1 bg-rose-600 hover:bg-rose-700 text-white font-bold py-2 rounded text-xs cursor-pointer transition-all border border-b border-rose-800"
              >
                确认彻底销毁
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MOBILE HYPOTHESIS PROBES OVERLAY */}
      {showProbesModal && kb && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl border border-slate-200 max-w-lg w-full max-h-[85vh] flex flex-col animate-in fade-in zoom-in-95 duration-150">
            <div className="flex justify-between items-center p-4 border-b border-slate-100 shrink-0">
              <h3 className="font-bold text-slate-800 text-sm tracking-tight flex items-center gap-1.5">
                <Compass size={16} className="text-indigo-600" />
                探针闭环假设日志 ({kb.hypotheses.length})
              </h3>
              <button 
                onClick={() => setShowProbesModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-full hover:bg-slate-50 cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-4 overflow-y-auto flex-1 space-y-4">
              {kb.hypotheses.length === 0 ? (
                <div className="text-center py-12 text-slate-300">
                  <Lightbulb size={32} className="mx-auto mb-2 opacity-50" />
                  <p className="text-sm font-semibold">暂无建模探索命题</p>
                  <p className="text-xs mt-1">启动认知状态或迭代即可提取对标假设</p>
                </div>
              ) : (
                kb.hypotheses.map((h) => {
                  const isVerified = h.status === 'verified';
                  const isRejected = h.status === 'rejected';
                  return (
                    <div 
                      key={h.id} 
                      className={`relative p-4 rounded-lg border transition-all ${
                        isVerified ? 'bg-emerald-50/60 border-emerald-100' :
                        isRejected ? 'bg-rose-50/40 border-rose-100 pointer-events-none opacity-60' :
                        'bg-slate-50 border-slate-200'
                      }`}
                    >
                      <div className="flex justify-between items-start mb-2">
                        <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded ${
                          isVerified ? 'bg-emerald-100 text-emerald-800' :
                          isRejected ? 'bg-rose-100 text-rose-800' :
                          'bg-slate-200 text-slate-700'
                        }`}>
                          {h.type === 'best_practice_gap' ? '最优对标' :
                           h.type === 'dimension_missing' ? '三维缺陷' : '闭环补全'}
                        </span>
                        <span className="text-[10px] font-mono font-extrabold text-slate-400">
                          置信层: {(h.confidence * 100).toFixed(0)}%
                        </span>
                      </div>

                      <p className={`text-xs font-semibold leading-relaxed ${isRejected ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
                        {h.statement}
                      </p>

                      <div className="mt-2.5 pt-2 border-t border-dashed border-slate-200/80">
                        <p className="text-[11px] text-slate-500 leading-relaxed italic">
                          <b>探索依据:</b> {h.reason}
                        </p>
                      </div>

                      {h.sources && h.sources.length > 0 && (
                        <div className="mt-2.5 space-y-1">
                          <p className="text-[10px] font-bold text-indigo-600 uppercase tracking-widest">研讨标准出处:</p>
                          {h.sources.slice(0, 3).map((s, idx) => (
                            <a 
                              key={idx} 
                              href={s.url} 
                              target="_blank" 
                              rel="noopener noreferrer" 
                              className="text-[10.5px] text-slate-400 hover:text-indigo-600 underline truncate flex items-center gap-1"
                            >
                              <ExternalLink size={9} />
                              <span>{s.title || '对标溯源出处'}</span>
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            <div className="p-4 border-t border-slate-100 shrink-0">
              <button 
                onClick={() => setShowProbesModal(false)}
                className="w-full bg-slate-900 hover:bg-black text-white py-2 rounded text-xs font-bold cursor-pointer"
              >
                我知道了
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MOBILE 3D CAPABILITY OVERLAY */}
      {showCapabilityModal && kb && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl border border-slate-200 max-w-md w-full max-h-[85vh] flex flex-col animate-in fade-in zoom-in-95 duration-150">
            <div className="flex justify-between items-center p-4 border-b border-slate-100 shrink-0">
              <h3 className="font-bold text-slate-800 text-sm tracking-tight flex items-center gap-1.5">
                <Layers size={16} className="text-indigo-600" />
                3D能力覆盖成熟度大盘
              </h3>
              <button 
                onClick={() => setShowCapabilityModal(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-full hover:bg-slate-50 cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1 space-y-6">
              {/* 1. EXECUTION */}
              <div className="flex flex-col gap-2">
                <div className="flex justify-between text-xs font-semibold">
                  <span className="text-slate-755">Execution Operations (操作层)</span> 
                  <span className="text-emerald-500 font-bold">{dimStats.execution}%</span>
                </div>
                <div className="h-10 grid grid-cols-10 gap-1">
                  {[...Array(10)].map((_, i) => (
                    <div 
                      key={i} 
                      className={`transition-colors duration-300 ${i < Math.round(dimStats.execution / 10) ? 'bg-emerald-500 animate-pulse' : 'bg-slate-100'}`}
                    />
                  ))}
                </div>
                <p className="text-[11px] text-slate-400">领域内基础业务动作与操作事件覆盖程度</p>
              </div>

              {/* 2. SUPERVISION */}
              <div className="flex flex-col gap-2">
                <div className="flex justify-between text-xs font-semibold">
                  <span className="text-slate-755">Supervision Audit (风控层)</span> 
                  <span className="text-amber-500 font-bold">{dimStats.supervision}%</span>
                </div>
                <div className="h-10 grid grid-cols-10 gap-1">
                  {[...Array(10)].map((_, i) => (
                    <div 
                      key={i} 
                      className={`transition-colors duration-300 ${i < Math.round(dimStats.supervision / 10) ? 'bg-amber-500' : 'bg-slate-100'}`}
                    />
                  ))}
                </div>
                <p className="text-[11px] text-slate-400">多级合规审批，大额受控以及不变性约束级别</p>
              </div>

              {/* 3. STATISTICS */}
              <div className="flex flex-col gap-2">
                <div className="flex justify-between text-xs font-semibold">
                  <span className="text-slate-755">Statistics CFO/BI (决策层)</span> 
                  <span className="text-rose-500 font-bold">{dimStats.statistics}%</span>
                </div>
                <div className="h-10 grid grid-cols-10 gap-1">
                  {[...Array(10)].map((_, i) => (
                    <div 
                      key={i} 
                      className={`transition-colors duration-300 ${i < Math.round(dimStats.statistics / 10) ? 'bg-rose-500' : 'bg-slate-100'}`}
                    />
                  ))}
                </div>
                <p className="text-[11px] text-slate-400">应付流动性预测、履约时效统计与量化决策指标</p>
              </div>

              {/* Priority Warning Card */}
              <div className="bg-indigo-900 p-4 rounded-lg text-white relative overflow-hidden shadow-md">
                <div className="text-xs font-extrabold uppercase mb-1 flex items-center gap-1">
                  <Cpu size={12} className="text-indigo-400" />
                  <span>Deduction Guidance Priority</span>
                </div>
                <p className="text-[11px] text-indigo-150 leading-relaxed">
                  应根据上述覆盖率，优先配置或由系统自动针对 <b>
                    {dimStats.execution <= dimStats.supervision && dimStats.execution <= dimStats.statistics ? '操作执行层 (Execution)' :
                     dimStats.supervision <= dimStats.statistics ? '风控监管层 (Supervision)' : '决策量化层 (Statistics)'}
                  </b> 相关的业务假设进行查验！
                </p>
              </div>
            </div>

            <div className="p-4 border-t border-slate-100 shrink-0">
              <button 
                onClick={() => setShowCapabilityModal(false)}
                className="w-full bg-slate-955 hover:bg-black text-white py-2 rounded text-xs font-bold cursor-pointer"
              >
                我知道了
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
