import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  Layers, 
  Plus, 
  Trash2, 
  Search, 
  ArrowRight, 
  Activity, 
  Cpu, 
  Zap, 
  Compass, 
  HelpCircle, 
  ZoomIn, 
  ZoomOut, 
  Maximize2,
  Settings,
  ShieldAlert,
  CheckCircle2,
  Workflow
} from 'lucide-react';
import { KB_Store, LevelTwoModule, LevelThreeElement, SystemInteraction, AggregateRoot, ModuleDependency } from '../types';

interface DependencyTopologyProps {
  kb: KB_Store;
  onUpdateKB: (updatedKB: KB_Store) => void;
}

interface GraphNode {
  id: string;
  label: string;
  type: 'l1_aggregate' | 'l2_module' | 'l3_element' | 'external_system';
  subType?: string;
  description: string;
  x: number;
  y: number;
  fx?: number | null;
  fy?: number | null;
  originalData: any;
}

interface GraphLink {
  id: string;
  source: string;
  target: string;
  type: 'ownership' | 'system_call' | 'module_dependency';
  direction?: 'upstream' | 'downstream' | 'bidirectional';
  label?: string;
  detail?: string;
}

export default function DependencyTopology({ kb, onUpdateKB }: DependencyTopologyProps) {
  // Filters & State
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<'all' | 'l1_l2' | 'l2_only' | 'interactions'>('all');
  
  // Custom dependency form
  const [showAddDep, setShowAddDep] = useState(false);
  const [newDepFrom, setNewDepFrom] = useState('');
  const [newDepTo, setNewDepTo] = useState('');
  const [newDepType, setNewDepType] = useState<'rpc' | 'event' | 'db'>('rpc');
  const [newDepDesc, setNewDepDesc] = useState('');

  // Zoom & Pan state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState({ x: 0, y: 0 });

  // Drag node state
  const [draggedNodeId, setDraggedNodeId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Initialize nodes and links
  const initialNodes = useMemo(() => {
    const nodes: GraphNode[] = [];
    const width = 850;
    const height = 500;

    // 1. External Systems (Left tier)
    const interactions = kb.interactions || [];
    const uniqueExtSystems = Array.from(new Set(interactions.map(i => i.systemName)));
    uniqueExtSystems.forEach((sys, idx) => {
      const step = height / (uniqueExtSystems.length + 1);
      nodes.push({
        id: `ext_${sys}`,
        label: sys,
        type: 'external_system',
        description: '外部业务协同系统，通过接口、消息或集成总线实现跨应用协同契约。',
        x: 80,
        y: step * (idx + 1),
        originalData: interactions.filter(i => i.systemName === sys)
      });
    });

    // 2. L1 Aggregate Roots (Middle-Left tier)
    const aggregates = kb.aggregates || [];
    aggregates.forEach((ar, idx) => {
      const step = height / (aggregates.length + 1);
      nodes.push({
        id: `l1_${ar.id}`,
        label: ar.name,
        type: 'l1_aggregate',
        description: `领域一级聚合根界限：${ar.invariants?.join('; ') || ar.name}`,
        x: 280,
        y: step * (idx + 1),
        originalData: ar
      });
    });

    // 3. L2 Sub-modules (Center core tier)
    const modules = kb.modules || [];
    modules.forEach((mod, idx) => {
      const step = height / (modules.length + 1);
      
      // Attempt to group modules visually close to their L1 aggregate root if possible
      const arIdx = aggregates.findIndex(ar => ar.id === mod.aggregateRootId);
      let targetY = step * (idx + 1);
      if (arIdx !== -1) {
        const arStep = height / (aggregates.length + 1);
        const arY = arStep * (arIdx + 1);
        // Distribute around the L1 root center y coordinates
        targetY = arY + (idx - modules.length / 2) * 20;
      }
      // Clamping y within bounds
      targetY = Math.max(40, Math.min(height - 40, targetY));

      nodes.push({
        id: `l2_${mod.id}`,
        label: mod.name,
        type: 'l2_module',
        subType: mod.capabilityType,
        description: mod.description,
        x: 480,
        y: targetY,
        originalData: mod
      });
    });

    // 4. L3 Technical elements (Right tier, optional)
    const elements = kb.elements || [];
    elements.forEach((el, idx) => {
      const step = height / (elements.length + 1);
      
      // Group visually close to their L2 module parent
      const mIdx = modules.findIndex(m => m.id === el.moduleId);
      let targetY = step * (idx + 1);
      if (mIdx !== -1) {
        const parentNode = nodes.find(n => n.id === `l2_${el.moduleId}`);
        if (parentNode) {
          targetY = parentNode.y + (idx % 5 - 2) * 25;
        }
      }
      targetY = Math.max(30, Math.min(height - 30, targetY));

      nodes.push({
        id: `l3_${el.id}`,
        label: el.name,
        type: 'l3_element',
        subType: el.type,
        description: el.detail,
        x: 720,
        y: targetY,
        originalData: el
      });
    });

    return nodes;
  }, [kb.aggregates, kb.modules, kb.elements, kb.interactions]);

  // Positions local state so they can be dragged
  const [nodePositions, setNodePositions] = useState<Record<string, { x: number; y: number }>>({});

  useEffect(() => {
    const pos: Record<string, { x: number; y: number }> = {};
    initialNodes.forEach(node => {
      pos[node.id] = { x: node.x, y: node.y };
    });
    setNodePositions(pos);
  }, [initialNodes]);

  // Build Links
  const links = useMemo(() => {
    const graphLinks: GraphLink[] = [];

    // L1 -> L2 ownership links
    const modules = kb.modules || [];
    modules.forEach(mod => {
      graphLinks.push({
        id: `link_l1_l2_${mod.id}`,
        source: `l1_${mod.aggregateRootId}`,
        target: `l2_${mod.id}`,
        type: 'ownership',
        label: '下辖核心模块'
      });
    });

    // L2 -> L3 ownership links
    const elements = kb.elements || [];
    elements.forEach(el => {
      graphLinks.push({
        id: `link_l2_l3_${el.id}`,
        source: `l2_${el.moduleId}`,
        target: `l3_${el.id}`,
        type: 'ownership',
        label: '包含核心要素'
      });
    });

    // External System -> L2 Module Interactions
    const interactions = kb.interactions || [];
    interactions.forEach(inter => {
      graphLinks.push({
        id: `link_inter_${inter.id}`,
        source: `ext_${inter.systemName}`,
        target: `l2_${inter.targetModuleId}`,
        type: 'system_call',
        direction: inter.direction,
        label: inter.direction === 'upstream' ? '下游消费' : '同步推送',
        detail: inter.interfaceLogic
      });
    });

    // Custom Module Dependencies (Coupling)
    const dependencies = kb.dependencies || [];
    dependencies.forEach(dep => {
      graphLinks.push({
        id: `link_dep_${dep.id}`,
        source: `l2_${dep.fromModuleId}`,
        target: `l2_${dep.toModuleId}`,
        type: 'module_dependency',
        direction: 'downstream',
        label: dep.type === 'rpc' ? 'RPC调用' : dep.type === 'event' ? '订阅事件' : '共享存储',
        detail: dep.description
      });
    });

    return graphLinks;
  }, [kb.modules, kb.elements, kb.interactions, kb.dependencies]);

  // Handle Dragging
  const handleMouseDown = (nodeId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDraggedNodeId(nodeId);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (draggedNodeId && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      
      // Calculate cursor position taking zoom & pan into account
      const rawX = e.clientX - rect.left;
      const rawY = e.clientY - rect.top;
      
      const canvasX = (rawX - pan.x) / zoom;
      const canvasY = (rawY - pan.y) / zoom;

      setNodePositions(prev => ({
        ...prev,
        [draggedNodeId]: { 
          x: Math.max(10, Math.min(1200, canvasX)), 
          y: Math.max(10, Math.min(800, canvasY)) 
        }
      }));
    } else if (isPanning) {
      setPan({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y
      });
    }
  };

  const handleMouseUp = () => {
    setDraggedNodeId(null);
    setIsPanning(false);
  };

  // Pan & Zoom Controls
  const handleCanvasMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0 && !draggedNodeId) { // Left click
      setIsPanning(true);
      setPanStart({
        x: e.clientX - pan.x,
        y: e.clientY - pan.y
      });
    }
  };

  const handleZoom = (factor: number) => {
    setZoom(prev => Math.max(0.4, Math.min(3, prev * factor)));
  };

  const handleResetZoom = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  // Add Coupling Connection
  const handleAddDependency = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDepFrom || !newDepTo) return;
    if (newDepFrom === newDepTo) {
      alert('模块不能对自身建立耦合依赖。');
      return;
    }

    const newDep: ModuleDependency = {
      id: `dep_${Math.random().toString(36).substring(2, 9)}`,
      domainId: kb.domain.id,
      fromModuleId: newDepFrom,
      toModuleId: newDepTo,
      type: newDepType,
      description: newDepDesc
    };

    const updatedKB: KB_Store = {
      ...kb,
      dependencies: [...(kb.dependencies || []), newDep]
    };

    onUpdateKB(updatedKB);
    
    // Reset Form
    setNewDepTo('');
    setNewDepDesc('');
    setShowAddDep(false);
  };

  // Delete Dependency Connection
  const handleDeleteDependency = (depId: string) => {
    const updatedKB: KB_Store = {
      ...kb,
      dependencies: (kb.dependencies || []).filter(d => d.id !== depId)
    };
    onUpdateKB(updatedKB);
    if (selectedNodeId === depId) {
      setSelectedNodeId(null);
    }
  };

  // Compute Module Coupling Metrics
  const couplingMetrics = useMemo(() => {
    const modules = kb.modules || [];
    const dependencies = kb.dependencies || [];
    const interactions = kb.interactions || [];

    const metrics: Record<string, {
      afferent: number;  // Fan-in (Ca) - how many depend on this module
      efferent: number;  // Fan-out (Ce) - how many this module depends on
      instability: number; // I = Ce / (Ca + Ce)
      cohesion: number;  // L3 Element Density
      warning: 'low' | 'medium' | 'high';
      warningMsg: string;
      dependenciesFrom: string[];
      dependenciesTo: string[];
    }> = {};

    modules.forEach(m => {
      // 1. Afferent Coupling (Ca):
      // - Custom dependencies pointing to m
      // - External systems calls m (interactions upstream)
      const depIn = dependencies.filter(d => d.toModuleId === m.id);
      const interIn = interactions.filter(i => i.targetModuleId === m.id && i.direction === 'upstream');
      const ca = depIn.length + interIn.length;

      // 2. Efferent Coupling (Ce):
      // - Custom dependencies from m
      // - Calls to external systems from m (interactions downstream)
      const depOut = dependencies.filter(d => d.fromModuleId === m.id);
      const interOut = interactions.filter(i => i.targetModuleId === m.id && i.direction === 'downstream');
      const ce = depOut.length + interOut.length;

      // 3. Instability (I)
      const sum = ca + ce;
      const instability = sum === 0 ? 0 : ce / sum;

      // 4. Cohesion (number of L3 elements)
      const cohesion = (kb.elements || []).filter(el => el.moduleId === m.id).length;

      // 5. Warning Strategy
      let warning: 'low' | 'medium' | 'high' = 'low';
      let warningMsg = '模块架构耦合健康，职责清晰。';

      if (ce >= 3) {
        warning = 'high';
        warningMsg = '⚠️ [高度耦合警示] 模块扇出 (Fan-out) 过多，过度依赖其他模块。请考虑重构，抽象公共接口或使用消息队列异步化。';
      } else if (ce === 2 && instability > 0.7) {
        warning = 'medium';
        warningMsg = '⚡ [中度耦合关注] 模块极度不稳定且缺乏公共反向依赖。请留意下游变更带来的传递风险。';
      } else if (cohesion > 6) {
        warning = 'medium';
        warningMsg = '📦 [中度内聚偏重] 模块下辖业务要素过多，可能承担了过多非核心逻辑，建议拆分为两个二级微服务。';
      }

      metrics[m.id] = {
        afferent: ca,
        efferent: ce,
        instability,
        cohesion,
        warning,
        warningMsg,
        dependenciesFrom: depOut.map(d => {
          const target = modules.find(x => x.id === d.toModuleId);
          return target ? `${target.name} (${d.type === 'rpc' ? 'RPC' : 'Event'})` : '未知模块';
        }),
        dependenciesTo: depIn.map(d => {
          const src = modules.find(x => x.id === d.fromModuleId);
          return src ? `${src.name} (${d.type === 'rpc' ? 'RPC' : 'Event'})` : '未知模块';
        })
      };
    });

    return metrics;
  }, [kb.modules, kb.dependencies, kb.interactions, kb.elements]);

  // Overall coupling summary
  const systemCouplingSummary = useMemo(() => {
    const totalModules = kb.modules?.length || 0;
    if (totalModules === 0) return { avgInstability: 0, maxEfferent: 0, totalDeps: 0 };

    const list = Object.values(couplingMetrics) as any[];
    const avgInstability = list.reduce((acc: number, curr: any) => acc + curr.instability, 0) / list.length;
    const maxEfferent = Math.max(...list.map((x: any) => x.efferent), 0);
    const totalDeps = kb.dependencies?.length || 0;

    return {
      avgInstability,
      maxEfferent,
      totalDeps
    };
  }, [couplingMetrics, kb.dependencies, kb.modules]);

  // Filter nodes according to active selection
  const filteredNodes = useMemo(() => {
    return initialNodes.filter(node => {
      // Term Search filter
      if (searchTerm) {
        const matchesName = node.label.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesDesc = node.description.toLowerCase().includes(searchTerm.toLowerCase());
        if (!matchesName && !matchesDesc) return false;
      }

      // Layer Filter
      if (filterType === 'l1_l2') {
        return node.type === 'l1_aggregate' || node.type === 'l2_module';
      }
      if (filterType === 'l2_only') {
        return node.type === 'l2_module';
      }
      if (filterType === 'interactions') {
        return node.type === 'l2_module' || node.type === 'external_system';
      }

      return true; // all
    });
  }, [initialNodes, searchTerm, filterType]);

  const filteredNodeIds = useMemo(() => new Set(filteredNodes.map(n => n.id)), [filteredNodes]);

  // Filter links where both source and target are currently visible
  const filteredLinks = useMemo(() => {
    return links.filter(link => {
      if (!filteredNodeIds.has(link.source) || !filteredNodeIds.has(link.target)) {
        return false;
      }
      if (filterType === 'l2_only' && link.type !== 'module_dependency') {
        return false;
      }
      return true;
    });
  }, [links, filteredNodeIds, filterType]);

  // Highlighting relations of selected node
  const highlightElements = useMemo(() => {
    if (!selectedNodeId) return null;
    const connectedNodes = new Set<string>([selectedNodeId]);
    const connectedLinks = new Set<string>();

    filteredLinks.forEach(link => {
      if (link.source === selectedNodeId) {
        connectedNodes.add(link.target);
        connectedLinks.add(link.id);
      }
      if (link.target === selectedNodeId) {
        connectedNodes.add(link.source);
        connectedLinks.add(link.id);
      }
    });

    return { nodes: connectedNodes, links: connectedLinks };
  }, [selectedNodeId, filteredLinks]);

  // Find detailed item for selection card
  const selectedNodeData = useMemo(() => {
    if (!selectedNodeId) return null;
    return initialNodes.find(n => n.id === selectedNodeId);
  }, [selectedNodeId, initialNodes]);

  return (
    <div className="flex-1 flex flex-col gap-6" id="topology-visualizer-panel">
      {/* 📊 High-level KPIs Banner */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-4 border border-slate-200 rounded-lg shadow-sm flex items-center gap-3">
          <div className="p-2.5 bg-indigo-50 text-indigo-600 rounded">
            <Layers size={18} />
          </div>
          <div>
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">二级核心子模块</span>
            <span className="text-xl font-bold text-slate-800">{kb.modules?.length || 0} 个</span>
          </div>
        </div>

        <div className="bg-white p-4 border border-slate-200 rounded-lg shadow-sm flex items-center gap-3">
          <div className="p-2.5 bg-blue-50 text-blue-600 rounded">
            <Workflow size={18} />
          </div>
          <div>
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">模块间显式依赖关系</span>
            <span className="text-xl font-bold text-slate-800">{systemCouplingSummary.totalDeps} 条</span>
          </div>
        </div>

        <div className="bg-white p-4 border border-slate-200 rounded-lg shadow-sm flex items-center gap-3">
          <div className="p-2.5 bg-amber-50 text-amber-600 rounded">
            <Activity size={18} />
          </div>
          <div>
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">系统平均不稳定指数 (Instability)</span>
            <span className="text-xl font-bold text-slate-800">
              {systemCouplingSummary.avgInstability.toFixed(2)}
            </span>
          </div>
        </div>

        <div className="bg-white p-4 border border-slate-200 rounded-lg shadow-sm flex items-center gap-3">
          <div className="p-2.5 bg-purple-50 text-purple-600 rounded">
            <Cpu size={18} />
          </div>
          <div>
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">三级业务规则粒度</span>
            <span className="text-xl font-bold text-slate-800">{kb.elements?.length || 0} 项</span>
          </div>
        </div>
      </div>

      {/* ⚙️ Tool controls header */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400 pointer-events-none">
              <Search size={14} />
            </span>
            <input 
              id="topo-search"
              type="text"
              placeholder="搜索实体/模块/三级要素..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="bg-slate-50 border border-slate-200 rounded pl-9 pr-3 py-1.5 text-xs font-semibold focus:outline-none focus:border-indigo-500 text-slate-700 w-52"
            />
          </div>

          <div className="flex bg-slate-100 p-0.5 rounded border border-slate-200">
            <button 
              id="btn-filter-all"
              onClick={() => setFilterType('all')}
              className={`px-3 py-1 text-xs font-bold rounded transition ${filterType === 'all' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              全景拓扑图
            </button>
            <button 
              id="btn-filter-l1-l2"
              onClick={() => setFilterType('l1_l2')}
              className={`px-3 py-1 text-xs font-bold rounded transition ${filterType === 'l1_l2' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              L1 & L2 (无要素)
            </button>
            <button 
              id="btn-filter-l2-only"
              onClick={() => setFilterType('l2_only')}
              className={`px-3 py-1 text-xs font-bold rounded transition ${filterType === 'l2_only' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              仅L2依赖耦合
            </button>
            <button 
              id="btn-filter-interactions"
              onClick={() => setFilterType('interactions')}
              className={`px-3 py-1 text-xs font-bold rounded transition ${filterType === 'interactions' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              外部集成本端
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button 
            id="btn-add-coupling"
            onClick={() => setShowAddDep(true)}
            className="bg-indigo-600 hover:bg-indigo-700 text-white px-3 py-1.5 rounded text-xs font-bold cursor-pointer flex items-center gap-1 transition"
          >
            <Plus size={14} />
            添加模块间依赖耦合
          </button>
          
          <div className="flex items-center gap-1 border-l pl-2 border-slate-200">
            <button onClick={() => handleZoom(1.1)} className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-slate-50 rounded cursor-pointer" title="放大"><ZoomIn size={14}/></button>
            <button onClick={() => handleZoom(0.9)} className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-slate-50 rounded cursor-pointer" title="缩小"><ZoomOut size={14}/></button>
            <button onClick={handleResetZoom} className="p-1.5 text-slate-500 hover:text-indigo-600 hover:bg-slate-50 rounded cursor-pointer" title="重置画布"><Maximize2 size={13}/></button>
          </div>
        </div>
      </div>

      {/* 🎨 Canvas + Panel Area */}
      <div className="flex flex-col lg:flex-row gap-6">
        {/* Interactive SVG Canvas */}
        <div 
          ref={containerRef}
          className="flex-1 bg-slate-950 border border-slate-800 rounded-xl h-[520px] relative overflow-hidden select-none cursor-grab active:cursor-grabbing"
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          {/* Grid Background */}
          <div className="absolute inset-0 opacity-[0.03] pointer-events-none" style={{
            backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)',
            backgroundSize: '24px 24px',
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            transformOrigin: '0 0'
          }} />

          {/* SVG Viewport */}
          <svg className="w-full h-full absolute inset-0 pointer-events-none">
            {/* Defs for arrow markers */}
            <defs>
              <marker id="arrow-system" markerWidth="10" markerHeight="7" refX="22" refY="3.5" orient="auto">
                <polygon points="0 0, 10 3.5, 0 7" fill="#60a5fa" />
              </marker>
              <marker id="arrow-dep" markerWidth="10" markerHeight="7" refX="22" refY="3.5" orient="auto">
                <polygon points="0 0, 10 3.5, 0 7" fill="#f59e0b" />
              </marker>
              <filter id="glow-selected" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="4" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>
            </defs>

            {/* Render Link Connections */}
            <g style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0' }}>
              {filteredLinks.map(link => {
                const sourceNodePos = nodePositions[link.source];
                const targetNodePos = nodePositions[link.target];
                
                if (!sourceNodePos || !targetNodePos) return null;

                const isHighlighted = highlightElements ? highlightElements.links.has(link.id) : false;
                const isDimmed = highlightElements ? !highlightElements.links.has(link.id) : false;

                // Color based on type
                let strokeColor = '#334155'; // default grey
                let strokeWidth = 1.5;
                let isDashed = false;
                let markerId = '';

                if (link.type === 'ownership') {
                  strokeColor = '#475569';
                  strokeWidth = 1;
                  isDashed = true;
                } else if (link.type === 'system_call') {
                  strokeColor = '#3b82f6'; // blue
                  strokeWidth = 1.8;
                  markerId = 'url(#arrow-system)';
                } else if (link.type === 'module_dependency') {
                  strokeColor = '#f59e0b'; // amber
                  strokeWidth = 2;
                  markerId = 'url(#arrow-dep)';
                }

                if (isHighlighted) {
                  strokeWidth += 1.2;
                  strokeColor = link.type === 'module_dependency' ? '#f59e0b' : link.type === 'system_call' ? '#60a5fa' : '#6366f1';
                }

                // Curved paths for links
                const dx = targetNodePos.x - sourceNodePos.x;
                const dy = targetNodePos.y - sourceNodePos.y;
                const dr = Math.sqrt(dx * dx + dy * dy);
                
                // Straight ownership line, curved for dependency/interactions
                const isDependency = link.type === 'module_dependency' || link.type === 'system_call';
                const dPath = isDependency 
                  ? `M ${sourceNodePos.x} ${sourceNodePos.y} A ${dr * 1.5} ${dr * 1.5} 0 0 1 ${targetNodePos.x} ${targetNodePos.y}`
                  : `M ${sourceNodePos.x} ${sourceNodePos.y} L ${targetNodePos.x} ${targetNodePos.y}`;

                return (
                  <g key={link.id} className="transition-opacity duration-300" style={{ opacity: isDimmed ? 0.2 : 1 }}>
                    <path 
                      d={dPath}
                      fill="none"
                      stroke={strokeColor}
                      strokeWidth={strokeWidth}
                      strokeDasharray={isDashed ? '4 4' : undefined}
                      markerEnd={markerId}
                      className="transition-all duration-300"
                    />
                    {/* Floating Text Detail on hover */}
                    {isHighlighted && link.label && (
                      <text 
                        x={(sourceNodePos.x + targetNodePos.x) / 2}
                        y={((sourceNodePos.y + targetNodePos.y) / 2) - 8}
                        fill="#cbd5e1"
                        fontSize="9"
                        fontWeight="bold"
                        textAnchor="middle"
                        className="bg-slate-900 px-1 rounded"
                      >
                        {link.label}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          </svg>

          {/* Render Draggable Nodes */}
          <div 
            className="absolute inset-0 pointer-events-none" 
            style={{ 
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, 
              transformOrigin: '0 0' 
            }}
          >
            {filteredNodes.map(node => {
              const pos = nodePositions[node.id] || { x: node.x, y: node.y };
              const isSelected = selectedNodeId === node.id;
              const isHighlighted = highlightElements ? highlightElements.nodes.has(node.id) : false;
              const isDimmed = highlightElements ? !highlightElements.nodes.has(node.id) : false;

              // Styles based on Type
              let bgClass = 'bg-slate-800 border-slate-700 text-slate-300';
              let ringClass = '';
              let badgeText = '';

              if (node.type === 'external_system') {
                bgClass = 'bg-blue-950 border-blue-600/80 text-blue-200';
                badgeText = 'Ext System';
              } else if (node.type === 'l1_aggregate') {
                bgClass = 'bg-indigo-950 border-indigo-500/80 text-indigo-100';
                badgeText = 'L1 Root';
              } else if (node.type === 'l2_module') {
                const warns = couplingMetrics[node.id];
                if (warns?.warning === 'high') {
                  bgClass = 'bg-rose-950 border-rose-600 text-rose-100';
                  ringClass = 'ring-2 ring-rose-500/30';
                } else if (warns?.warning === 'medium') {
                  bgClass = 'bg-amber-950 border-amber-600 text-amber-100';
                  ringClass = 'ring-2 ring-amber-500/30';
                } else {
                  bgClass = 'bg-slate-900 border-emerald-600/70 text-emerald-100';
                }
                badgeText = node.subType === 'engine' ? '⚙️ Engine' : node.subType === 'config_center' ? '🎛️ Config' : '📄 Doc';
              } else if (node.type === 'l3_element') {
                bgClass = 'bg-slate-900 border-slate-800 text-slate-400 text-[10px] py-1 px-2.5 rounded-md';
                badgeText = 'L3';
              }

              if (isSelected) {
                ringClass = 'ring-2 ring-indigo-500 shadow-lg shadow-indigo-500/20';
              } else if (isHighlighted) {
                ringClass = 'ring-1.5 ring-indigo-400/50';
              }

              return (
                <div 
                  id={`node-${node.id}`}
                  key={node.id}
                  className={`absolute pointer-events-auto rounded-lg border px-3 py-2 text-xs font-semibold cursor-grab active:cursor-grabbing transition-all duration-200 ${bgClass} ${ringClass}`}
                  style={{
                    left: pos.x,
                    top: pos.y,
                    transform: 'translate(-50%, -50%)',
                    opacity: isDimmed ? 0.35 : 1,
                    boxShadow: isSelected ? '0 0 15px rgba(99, 102, 241, 0.4)' : undefined,
                    zIndex: isSelected ? 50 : isHighlighted ? 40 : 10
                  }}
                  onMouseDown={(e) => handleMouseDown(node.id, e)}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedNodeId(node.id === selectedNodeId ? null : node.id);
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setNodePositions(prev => ({
                      ...prev,
                      [node.id]: { x: node.x, y: node.y }
                    }));
                  }}
                >
                  <div className="flex flex-col gap-0.5 max-w-[170px] min-w-[100px]">
                    <div className="flex items-center justify-between gap-1.5 mb-1 border-b border-white/5 pb-1">
                      <span className="text-[9px] font-extrabold tracking-wider opacity-80 uppercase">{badgeText}</span>
                      {node.type === 'l2_module' && (
                        <div className="flex gap-1">
                          <span className="text-[8px] bg-slate-800 px-1 rounded font-bold" title="粉丝依数 (Ca)">Ca:{couplingMetrics[node.id]?.afferent}</span>
                          <span className="text-[8px] bg-slate-800 px-1 rounded font-bold" title="扇出依数 (Ce)">Ce:{couplingMetrics[node.id]?.efferent}</span>
                        </div>
                      )}
                    </div>
                    <span className="truncate font-bold tracking-tight block text-center select-none">{node.label}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Canvas Bottom Instructions */}
          <div className="absolute bottom-3 left-3 bg-slate-900/90 border border-slate-800 px-3 py-1.5 rounded text-[10px] text-slate-400 pointer-events-none font-sans flex items-center gap-2">
            <span className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-ping" />
            <span>鼠标左键拖拽画布，滚轮缩放，拖拽各实体卡片任意布局。双击可重定位。</span>
          </div>
        </div>

        {/* Info detail Sidebar Dashboard */}
        <div className="w-full lg:w-80 flex flex-col gap-4">
          {/* Selected element detail card */}
          {selectedNodeData ? (
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col gap-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <div className="p-2 bg-indigo-50 text-indigo-700 rounded">
                    {selectedNodeData.type === 'external_system' ? <Workflow size={16} /> : selectedNodeData.type === 'l1_aggregate' ? <Layers size={16} /> : <Cpu size={16} />}
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-slate-800 leading-tight">{selectedNodeData.label}</h3>
                    <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest block">
                      {selectedNodeData.type === 'l2_module' ? '二级系统模块' : selectedNodeData.type === 'l1_aggregate' ? '一级核心聚合根' : selectedNodeData.type === 'external_system' ? '外部协同系统' : '三级底端业务要素'}
                    </span>
                  </div>
                </div>
                <button 
                  onClick={() => setSelectedNodeId(null)} 
                  className="text-xs font-semibold text-slate-400 hover:text-slate-600 px-2 py-0.5 bg-slate-50 border border-slate-200 rounded"
                >
                  清除
                </button>
              </div>

              <div>
                <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">设计职责定位描述</span>
                <p className="text-xs text-slate-600 leading-relaxed bg-slate-50 p-2.5 rounded border border-slate-150 font-sans italic">
                  {selectedNodeData.description || '暂无详细描述信息。'}
                </p>
              </div>

              {/* L2 Coupling diagnostics dashboard */}
              {selectedNodeData.type === 'l2_module' && couplingMetrics[selectedNodeData.id] && (
                <div className="flex flex-col gap-3.5 border-t border-slate-100 pt-3">
                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-slate-50 p-2 rounded text-center border">
                      <span className="text-[9px] text-slate-400 block font-bold">扇入 (Ca)</span>
                      <span className="text-sm font-bold text-slate-700">{couplingMetrics[selectedNodeData.id].afferent}</span>
                    </div>
                    <div className="bg-slate-50 p-2 rounded text-center border">
                      <span className="text-[9px] text-slate-400 block font-bold">扇出 (Ce)</span>
                      <span className="text-sm font-bold text-slate-700">{couplingMetrics[selectedNodeData.id].efferent}</span>
                    </div>
                    <div className="bg-indigo-50/50 p-2 rounded text-center border border-indigo-100">
                      <span className="text-[9px] text-indigo-400 block font-bold">不稳定 (I)</span>
                      <span className="text-sm font-bold text-indigo-700">{couplingMetrics[selectedNodeData.id].instability.toFixed(2)}</span>
                    </div>
                  </div>

                  <div>
                    <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">下辖三级要素高内聚密度</span>
                    <div className="flex justify-between items-center bg-slate-50 px-2.5 py-1.5 rounded text-xs border">
                      <span className="text-slate-500 font-semibold">Micro-Elements 数量:</span>
                      <span className="font-extrabold text-indigo-700">{couplingMetrics[selectedNodeData.id].cohesion} 个</span>
                    </div>
                  </div>

                  {/* Explicit coupling warns list */}
                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                    <div className="flex items-center gap-1.5 mb-1">
                      {couplingMetrics[selectedNodeData.id].warning === 'high' ? (
                        <ShieldAlert size={14} className="text-rose-500" />
                      ) : couplingMetrics[selectedNodeData.id].warning === 'medium' ? (
                        <ShieldAlert size={14} className="text-amber-500" />
                      ) : (
                        <CheckCircle2 size={14} className="text-emerald-500" />
                      )}
                      <span className="text-xs font-bold text-slate-800">架构耦合度诊断反馈</span>
                    </div>
                    <p className="text-[11px] text-slate-600 leading-relaxed font-sans mt-1">
                      {couplingMetrics[selectedNodeData.id].warningMsg}
                    </p>
                  </div>

                  {/* Fan-in and Fan-out links lists */}
                  <div className="space-y-2">
                    {couplingMetrics[selectedNodeData.id].dependenciesFrom.length > 0 && (
                      <div>
                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest block mb-1">依赖下游子模块 (Outgoing Calls)</span>
                        <div className="flex flex-wrap gap-1">
                          {couplingMetrics[selectedNodeData.id].dependenciesFrom.map((depName, i) => (
                            <span key={i} className="text-[9px] bg-amber-50 text-amber-700 font-bold px-2 py-0.5 rounded border border-amber-100">{depName}</span>
                          ))}
                        </div>
                      </div>
                    )}
                    {couplingMetrics[selectedNodeData.id].dependenciesTo.length > 0 && (
                      <div>
                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest block mb-1">被上游子模块调用 (Incoming Calls)</span>
                        <div className="flex flex-wrap gap-1">
                          {couplingMetrics[selectedNodeData.id].dependenciesTo.map((depName, i) => (
                            <span key={i} className="text-[9px] bg-blue-50 text-blue-700 font-bold px-2 py-0.5 rounded border border-blue-100">{depName}</span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Module dependencies listing for management */}
              {selectedNodeData.type === 'l2_module' && (
                <div className="border-t border-slate-100 pt-3">
                  <span className="text-[10px] font-bold text-slate-400 uppercase block mb-1.5">维护以此为源的耦合关系</span>
                  {!(kb.dependencies || []).some(d => d.fromModuleId === selectedNodeData.originalData.id) ? (
                    <p className="text-[11px] text-slate-400 italic">该模块目前没有显式定义依赖下游。</p>
                  ) : (
                    <div className="space-y-1.5">
                      {(kb.dependencies || []).filter(d => d.fromModuleId === selectedNodeData.originalData.id).map(dep => {
                        const target = kb.modules?.find(m => m.id === dep.toModuleId);
                        return (
                          <div key={dep.id} className="flex items-center justify-between bg-slate-50 p-2 rounded text-xs border hover:border-indigo-200 transition">
                            <div className="flex flex-col gap-0.5">
                              <span className="font-bold text-slate-700 flex items-center gap-1">
                                <span>调用 {target ? target.name : '未知模块'}</span>
                                <span className="text-[9px] bg-slate-200 text-slate-600 px-1 py-0.2 rounded scale-90">{dep.type}</span>
                              </span>
                              {dep.description && <span className="text-[10px] text-slate-400 font-sans">{dep.description}</span>}
                            </div>
                            <button 
                              onClick={() => handleDeleteDependency(dep.id)}
                              className="text-slate-300 hover:text-rose-500 p-1 rounded cursor-pointer"
                              title="删除此项依赖关系"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 text-center flex flex-col items-center justify-center min-h-[220px] gap-2">
              <HelpCircle size={28} className="text-slate-300" />
              <h3 className="font-bold text-xs text-slate-500 uppercase tracking-wider">选择拓扑图卡片</h3>
              <p className="text-[11px] text-slate-400 font-sans leading-relaxed max-w-[180px]">
                点击拓扑图中的任意一级聚合根、二级模块、三级要素或外部系统，查看对应耦合关系明细及不稳定诊断指标。
              </p>
            </div>
          )}

          {/* Core metrics diagnostic advice checklist */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col gap-3.5">
            <h4 className="font-bold text-xs text-slate-700 uppercase tracking-widest flex items-center gap-1.5 pb-2 border-b">
              <Zap size={14} className="text-indigo-600 animate-pulse" />
              架构高内聚低耦合军规对标
            </h4>
            <div className="space-y-2.5 text-xs text-slate-600 font-sans">
              <div className="flex gap-2">
                <span className="text-indigo-600 font-bold">1.</span>
                <p className="leading-tight"><b className="text-slate-800">控制扇出：</b>核心计算引擎与配置中心的扇出 (Ce) 不宜超过 3，避免紧密耦合及逻辑纠缠。</p>
              </div>
              <div className="flex gap-2">
                <span className="text-indigo-600 font-bold">2.</span>
                <p className="leading-tight"><b className="text-slate-800">提高内聚：</b>二级模块对应的三级要素数量保持在 3~5 个，利于满足高内聚单一职责边界。</p>
              </div>
              <div className="flex gap-2">
                <span className="text-indigo-600 font-bold">3.</span>
                <p className="leading-tight"><b className="text-slate-800">高可用高稳定：</b>不稳定指数 $I$ 趋近于 0 表明该模块极为稳定（多扇入、少扇出），应优先将其提炼为底层共享通用模型服务。</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ➕ Modal: Add dependency coupler */}
      {showAddDep && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-[999] flex items-center justify-center p-4">
          <div className="bg-white rounded-lg border border-slate-200 p-6 shadow-xl w-full max-w-md flex flex-col gap-4">
            <div className="flex items-center justify-between border-b pb-3">
              <h3 className="font-bold text-sm text-slate-800 flex items-center gap-1.5">
                <Workflow size={16} className="text-indigo-600" />
                新增二级子模块间依赖耦合边界
              </h3>
              <button 
                onClick={() => setShowAddDep(false)} 
                className="text-slate-400 hover:text-slate-600 font-bold text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleAddDependency} className="flex flex-col gap-4 text-xs">
              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">源调用方 (Source L2 Module) *</label>
                <select
                  required
                  value={newDepFrom}
                  onChange={(e) => setNewDepFrom(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded p-2 focus:outline-none focus:border-indigo-500 font-semibold text-slate-800"
                >
                  <option value="">-- 请选择发起依赖调用的源模块 --</option>
                  {(kb.modules || []).map(m => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">被调用目标方 (Target L2 Module) *</label>
                <select
                  required
                  value={newDepTo}
                  onChange={(e) => setNewDepTo(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded p-2 focus:outline-none focus:border-indigo-500 font-semibold text-slate-800"
                >
                  <option value="">-- 请选择被动消费调用的目标模块 --</option>
                  {(kb.modules || []).map(m => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">接口通信交互特征 (Interaction Type) *</label>
                <div className="flex bg-slate-100 p-0.5 rounded border border-slate-200">
                  <button 
                    type="button" 
                    onClick={() => setNewDepType('rpc')}
                    className={`flex-1 py-1.5 text-xs font-bold rounded transition ${newDepType === 'rpc' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                  >
                    同步 RPC / HTTP
                  </button>
                  <button 
                    type="button" 
                    onClick={() => setNewDepType('event')}
                    className={`flex-1 py-1.5 text-xs font-bold rounded transition ${newDepType === 'event' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                  >
                    MQ 异步事件消息
                  </button>
                  <button 
                    type="button" 
                    onClick={() => setNewDepType('db')}
                    className={`flex-1 py-1.5 text-xs font-bold rounded transition ${newDepType === 'db' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                  >
                    共享 DB / 强一致
                  </button>
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-600 block mb-1.5">依赖契约内容描述 (Description of Connection)</label>
                <input 
                  type="text"
                  placeholder="例如: 调起交易限额算力校验契约，请求扣减预算"
                  value={newDepDesc}
                  onChange={(e) => setNewDepDesc(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded p-2 focus:outline-none focus:border-indigo-500 font-medium"
                />
              </div>

              <div className="flex items-center gap-2 justify-end border-t pt-3 mt-2">
                <button 
                  type="button" 
                  onClick={() => setShowAddDep(false)}
                  className="bg-slate-100 hover:bg-slate-200 px-4 py-2 rounded font-bold text-slate-600 cursor-pointer"
                >
                  取消
                </button>
                <button 
                  type="submit" 
                  className="bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded font-bold cursor-pointer"
                >
                  确认建立并保存关系
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
