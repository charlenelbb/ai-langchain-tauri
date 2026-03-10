import { Injectable } from '@nestjs/common';
import { StateGraph } from '@langchain/langgraph';
import { ChatOllama } from '@langchain/ollama';
import { HumanMessage } from '@langchain/core/messages';
import {
  analyzeMedicalImage,
  invokeRAG,
  invokePGVector,
} from './fundamentals/tools';
import { searchPGVector } from './fundamentals/pg-vector';

@Injectable()
export class WorkflowService {
  private llm = new ChatOllama({
    model: 'qwen3.5:0.8b',
  });

  async executeWorkflow(graphData: any, input: any) {
    // 从前端传来的图形数据构建 LangGraph
    const graph = new StateGraph({
      channels: {
        messages: [],
        currentNode: '',
        ...input,
      },
    });

    // 添加节点
    graphData.nodes.forEach((node: any) => {
      switch (node.type) {
        case 'llmNode':
          graph.addNode(node.id, this.createLLMNode(node));
          break;
        case 'toolNode':
          graph.addNode(node.id, this.createToolNode(node));
          break;
        case 'conditionNode':
          graph.addNode(node.id, this.createConditionNode(node));
          break;
        case 'vectorSearchNode':
          graph.addNode(node.id, this.createVectorSearchNode(node));
          break;
      }
    });

    // 添加边
    graphData.edges.forEach((edge: any) => {
      graph.addEdge(edge.source, edge.target);
    });

    // 设置入口点
    const entryNode = graphData.nodes.find((n: any) => n.id === '1');
    if (entryNode) {
      graph.setEntryPoint(entryNode.id);
    }

    // 编译并执行
    const compiledGraph = graph.compile();
    const result = await compiledGraph.invoke(input);

    return result;
  }

  private createLLMNode(node: any) {
    return async (state: any) => {
      const messages = state.messages || [];
      const response = await this.llm.invoke(messages);
      return {
        ...state,
        messages: [...messages, new HumanMessage(response.content.toString())],
        currentNode: node.id,
      };
    };
  }

  private createToolNode(node: any) {
    return async (state: any) => {
      // 根据节点数据调用相应工具
      const toolName = node.data?.toolName || 'invokeRAG';
      let result;

      switch (toolName) {
        case 'analyzeMedicalImage':
          result = await analyzeMedicalImage(state.base64Image, state.question);
          break;
        case 'invokeRAG':
          result = await invokeRAG(state.query);
          break;
        case 'invokePGVector':
          result = await invokePGVector(state.query);
          break;
        default:
          result = '未知工具';
      }

      return {
        ...state,
        toolResult: result,
        currentNode: node.id,
      };
    };
  }

  private createConditionNode(node: any) {
    return async (state: any) => {
      // 简单的条件判断逻辑
      const condition = node.data?.condition || 'true';
      const nextNode = eval(condition)
        ? node.data?.trueTarget
        : node.data?.falseTarget;

      return {
        ...state,
        conditionResult: eval(condition),
        nextNode,
        currentNode: node.id,
      };
    };
  }

  private createVectorSearchNode(node: any) {
    return async (state: any) => {
      const query = state.query || state.question || '';
      const kbId = node.data?.kbId || 'default';
      const topK = Number(node.data?.topK ?? 4);

      const results = await searchPGVector(String(query), {
        topK: Number.isFinite(topK) ? topK : 4,
        filter: { kbId },
      });

      return {
        ...state,
        retrievalResults: results,
        currentNode: node.id,
      };
    };
  }
}
