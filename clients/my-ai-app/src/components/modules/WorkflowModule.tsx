import React, { useCallback, useMemo, useState } from 'react';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  Edge,
  Node,
  NodeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

// 定义节点类型
const nodeTypes: NodeTypes = {
  llmNode: LLMNode,
  toolNode: ToolNode,
  conditionNode: ConditionNode,
  vectorSearchNode: VectorSearchNode,
};

// 初始节点
const initialNodes: Node<CustomNodeData>[] = [
  {
    id: '1',
    type: 'llmNode',
    position: { x: 250, y: 25 },
    data: { label: 'LLM Call' },
  },
];

// 初始边
const initialEdges: Edge[] = [];

import { Handle, Position } from '@xyflow/react';

type BaseNodeData = {
  label: string;
};

type LLMNodeData = BaseNodeData;

type ToolNodeData = BaseNodeData & {
  toolName?: 'analyzeMedicalImage' | 'invokeRAG' | 'invokePGVector';
};

type ConditionNodeData = BaseNodeData & {
  condition?: string;
  trueTarget?: string;
  falseTarget?: string;
};

type VectorSearchNodeData = BaseNodeData & {
  kbId?: string;
  topK?: number;
};

type CustomNodeData =
  | LLMNodeData
  | ToolNodeData
  | ConditionNodeData
  | VectorSearchNodeData;

// LLM 节点组件（带连接桩）
function LLMNode({ data }: { data: LLMNodeData }) {
  return (
    <>
      <Handle type="target" position={Position.Left} className="!bg-blue-500" />
      <div className="px-4 py-2 shadow-md rounded-md bg-white border-2 border-stone-400 min-w-[200px]">
        <div className="flex items-center">
          <div className="rounded-full w-10 h-10 flex justify-center items-center bg-blue-500 text-white">
            🤖
          </div>
          <div className="ml-3">
            <div className="text-sm font-bold">{data.label}</div>
            <div className="text-xs text-gray-500">LLM 调用</div>
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-blue-500" />
    </>
  );
}

// 工具节点组件（带连接桩）
function ToolNode({ data }: { data: ToolNodeData }) {
  return (
    <>
      <Handle type="target" position={Position.Left} className="!bg-green-500" />
      <div className="px-4 py-2 shadow-md rounded-md bg-white border-2 border-stone-400 min-w-[220px]">
        <div className="flex items-center">
          <div className="rounded-full w-10 h-10 flex justify-center items-center bg-green-500 text-white">
            🔧
          </div>
          <div className="ml-3">
            <div className="text-sm font-bold">{data.label}</div>
            <div className="text-xs text-gray-500">
              工具调用 {data.toolName ? `(${data.toolName})` : ''}
            </div>
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-green-500" />
    </>
  );
}

// 条件节点组件（带连接桩）
function ConditionNode({ data }: { data: ConditionNodeData }) {
  return (
    <>
      <Handle type="target" position={Position.Left} className="!bg-yellow-500" />
      <div className="px-4 py-2 shadow-md rounded-md bg-white border-2 border-stone-400 min-w-[240px]">
        <div className="flex items-center">
          <div className="rounded-full w-10 h-10 flex justify-center items-center bg-yellow-500 text-white">
            ❓
          </div>
          <div className="ml-3">
            <div className="text-sm font-bold">{data.label}</div>
            <div className="text-xs text-gray-500">条件判断</div>
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-yellow-500" />
    </>
  );
}

// 向量检索节点组件（带连接桩）
function VectorSearchNode({ data }: { data: VectorSearchNodeData }) {
  return (
    <>
      <Handle type="target" position={Position.Left} className="!bg-purple-500" />
      <div className="px-4 py-2 shadow-md rounded-md bg-white border-2 border-stone-400 min-w-[260px]">
        <div className="flex items-center">
          <div className="rounded-full w-10 h-10 flex justify-center items-center bg-purple-500 text-white">
            🔎
          </div>
          <div className="ml-3">
            <div className="text-sm font-bold">{data.label}</div>
            <div className="text-xs text-gray-500">
              向量检索 {data.kbId ? `(kb: ${data.kbId})` : ''}
            </div>
          </div>
        </div>
      </div>
      <Handle type="source" position={Position.Right} className="!bg-purple-500" />
    </>
  );
}

const WorkflowModule: React.FC = () => {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<CustomNodeData>>(
    initialNodes
  );
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [generatedCode] = useState<string>('');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const onConnect = useCallback(
    (params: Connection) => setEdges((eds) => addEdge(params, eds)),
    [setEdges]
  );

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId]
  );

  const updateNodeData = (id: string, data: Partial<CustomNodeData>) => {
    setNodes((nds) =>
      nds.map((n) =>
        n.id === id
          ? {
              ...n,
              data: {
                ...(n.data as CustomNodeData),
                ...data,
              },
            }
          : n
      )
    );
  };

  const deleteSelectedNode = () => {
    if (!selectedNodeId) return;
    setNodes((nds) => nds.filter((n) => n.id !== selectedNodeId));
    setEdges((eds) =>
      eds.filter((e) => e.source !== selectedNodeId && e.target !== selectedNodeId)
    );
    setSelectedNodeId(null);
  };

  // 添加新节点
  const addNode = (type: Node['type']) => {
    const id = `${nodes.length + 1}`;
    const baseData: CustomNodeData = {
      label:
        type === 'llmNode'
          ? `LLM 节点 ${id}`
          : type === 'toolNode'
          ? `工具节点 ${id}`
          : type === 'vectorSearchNode'
          ? `向量检索节点 ${id}`
          : `条件节点 ${id}`,
    };

    const extraData: Partial<CustomNodeData> =
      type === 'toolNode'
        ? { toolName: 'invokeRAG' }
        : type === 'conditionNode'
        ? {
            condition: 'true',
            trueTarget: '',
            falseTarget: '',
          }
        : type === 'vectorSearchNode'
        ? {
            kbId: 'default',
            topK: 4,
          }
        : {};

    const newNode: Node<CustomNodeData> = {
      id,
      type,
      position: {
        x: 150 + Math.random() * 300,
        y: 100 + Math.random() * 200,
      },
      data: { ...baseData, ...extraData } as CustomNodeData,
    };

    setNodes((nds) => nds.concat(newNode));
    setSelectedNodeId(id);
  };

  // 执行工作流
  const executeWorkflow = async () => {
    const graphData = { nodes, edges };
    try {
      const response = await fetch('http://localhost:3000/workflow/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          graphData,
          input: { messages: [], query: '测试查询' },
        }),
      });
      const result = await response.json();
      alert('执行结果: ' + JSON.stringify(result, null, 2));
    } catch (error) {
      console.error('执行失败:', error);
      alert('执行失败');
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex gap-2 p-4 border-b">
        <button
          onClick={() => addNode('llmNode')}
          className="px-4 py-2 bg-blue-500 text-white rounded"
        >
          添加 LLM 节点
        </button>
        <button
          onClick={() => addNode('toolNode')}
          className="px-4 py-2 bg-green-500 text-white rounded"
        >
          添加工具节点
        </button>
        <button
          onClick={() => addNode('conditionNode')}
          className="px-4 py-2 bg-yellow-500 text-white rounded"
        >
          添加条件节点
        </button>
        <button
          onClick={() => addNode('vectorSearchNode')}
          className="px-4 py-2 bg-purple-600 text-white rounded"
        >
          添加向量检索节点
        </button>
        <button
          onClick={executeWorkflow}
          className="px-4 py-2 bg-red-500 text-white rounded"
        >
          执行工作流
        </button>
      </div>

      <div className="flex-1 flex">
        <div className="flex-1 bg-slate-50">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            nodeTypes={nodeTypes}
            onNodeClick={(_, node) => setSelectedNodeId(node.id)}
            onPaneClick={() => setSelectedNodeId(null)}
            fitView
          >
            <Controls />
            <MiniMap />
            <Background gap={12} size={1} />
          </ReactFlow>
        </div>

        <div className="w-1/3 p-4 border-l bg-gray-50 flex flex-col gap-4">
          <div>
            <h3 className="text-lg font-bold mb-2">节点属性</h3>
            {selectedNode ? (
              <div className="space-y-3 text-sm">
                <div>
                  <label className="block text-gray-600 mb-1">节点 ID</label>
                  <div className="px-2 py-1 bg-gray-100 rounded border text-xs">
                    {selectedNode.id}
                  </div>
                </div>

                <div>
                  <label className="block text-gray-600 mb-1">名称</label>
                  <input
                    className="w-full px-2 py-1 border rounded text-sm"
                    value={(selectedNode.data as CustomNodeData).label || ''}
                    onChange={(e) =>
                      updateNodeData(selectedNode.id, { label: e.target.value })
                    }
                  />
                </div>

                {selectedNode.type === 'toolNode' && (
                  <div>
                    <label className="block text-gray-600 mb-1">工具类型</label>
                    <select
                      className="w-full px-2 py-1 border rounded text-sm"
                      value={
                        (selectedNode.data as ToolNodeData).toolName || 'invokeRAG'
                      }
                      onChange={(e) =>
                        updateNodeData(selectedNode.id, {
                          toolName: e.target.value as ToolNodeData['toolName'],
                        })
                      }
                    >
                      <option value="invokeRAG">invokeRAG（知识库检索）</option>
                      <option value="invokePGVector">invokePGVector（向量库）</option>
                      <option value="analyzeMedicalImage">
                        analyzeMedicalImage（医学影像）
                      </option>
                    </select>
                  </div>
                )}

                {selectedNode.type === 'conditionNode' && (
                  <>
                    <div>
                      <label className="block text-gray-600 mb-1">条件表达式</label>
                      <input
                        className="w-full px-2 py-1 border rounded text-sm font-mono"
                        placeholder="例如: toolResult.score > 0.5"
                        value={(selectedNode.data as ConditionNodeData).condition || ''}
                        onChange={(e) =>
                          updateNodeData(selectedNode.id, {
                            condition: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div>
                      <label className="block text-gray-600 mb-1">
                        条件为真时跳转节点 ID
                      </label>
                      <input
                        className="w-full px-2 py-1 border rounded text-sm"
                        placeholder="例如: 2"
                        value={(selectedNode.data as ConditionNodeData).trueTarget || ''}
                        onChange={(e) =>
                          updateNodeData(selectedNode.id, {
                            trueTarget: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div>
                      <label className="block text-gray-600 mb-1">
                        条件为假时跳转节点 ID
                      </label>
                      <input
                        className="w-full px-2 py-1 border rounded text-sm"
                        placeholder="例如: 3"
                        value={
                          (selectedNode.data as ConditionNodeData).falseTarget || ''
                        }
                        onChange={(e) =>
                          updateNodeData(selectedNode.id, {
                            falseTarget: e.target.value,
                          })
                        }
                      />
                    </div>
                  </>
                )}

                {selectedNode.type === 'vectorSearchNode' && (
                  <>
                    <div>
                      <label className="block text-gray-600 mb-1">知识库 ID</label>
                      <input
                        className="w-full px-2 py-1 border rounded text-sm"
                        placeholder="例如: default"
                        value={(selectedNode.data as VectorSearchNodeData).kbId || ''}
                        onChange={(e) =>
                          updateNodeData(selectedNode.id, {
                            kbId: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div>
                      <label className="block text-gray-600 mb-1">topK</label>
                      <input
                        type="number"
                        className="w-full px-2 py-1 border rounded text-sm"
                        value={(selectedNode.data as VectorSearchNodeData).topK ?? 4}
                        onChange={(e) =>
                          updateNodeData(selectedNode.id, {
                            topK: parseInt(e.target.value || '4', 10),
                          })
                        }
                      />
                    </div>
                  </>
                )}

                <button
                  onClick={deleteSelectedNode}
                  className="mt-2 w-full px-3 py-1.5 bg-red-500 text-white rounded text-sm hover:bg-red-600"
                >
                  删除该节点
                </button>
              </div>
            ) : (
              <div className="text-xs text-gray-500">
                在画布中点击一个节点，在这里编辑属性。
              </div>
            )}
          </div>

          <div className="flex-1 flex flex-col min-h-0">
            <h3 className="text-lg font-bold mb-2">生成的 LangGraph 代码</h3>
            <pre className="text-xs bg-white p-2 rounded border overflow-auto flex-1">
              {generatedCode || '后续可在这里展示从当前工作流编译出来的 LangGraph 代码。'}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WorkflowModule;
