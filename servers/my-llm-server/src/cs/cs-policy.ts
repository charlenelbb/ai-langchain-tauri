import type { CsCitation, CsIntent, CsPrepareResult } from './cs.types';

export const REFUSE_MESSAGE =
  '抱歉，当前知识库中没有足够依据回答这个问题，我不能编造价格、政策或物流信息。你可以点击「转人工」，由人工客服继续处理。';

export const FAQ_TOPIC_RE =
  /发货|物流|时效|退货|换货|退款|无理由|套餐|价格|月费|购买|发票|保修|质保|运单|工作日/;

export const HANDOFF_CONFIRM =
  '已为您转接人工客服，工单已创建，请稍候坐席接入。';

export function isHandoffRequest(question: string): boolean {
  return /转人工|人工客服|找人工|转接人工|转接客服|真人客服|不要机器人/.test(
    question,
  );
}

export function classifyIntentByRules(question: string): CsIntent {
  const q = question;
  if (isHandoffRequest(q)) return 'complaint';
  if (/投诉|不满|催促|态度|索赔|差评/.test(q)) return 'complaint';
  if (/发货|物流|退货|换货|退款|保修|发票|运单|售后/.test(q)) return 'aftersale';
  if (/套餐|价格|多少钱|购买|怎么买|功能对比|月费|报价/.test(q)) return 'presale';
  return 'other';
}

export function hasSnippetOverlap(question: string, citations: CsCitation[]): boolean {
  const hay = citations
    .slice(0, 2)
    .map((c) => c.snippet)
    .join('\n');
  if (!hay) return false;
  if (FAQ_TOPIC_RE.test(question) && FAQ_TOPIC_RE.test(hay)) return true;
  const terms = question
    .replace(/[？?，,。！!、；;：:\s]+/g, ' ')
    .split(' ')
    .map((s) => s.trim())
    .filter((s) => s.length >= 2);
  return terms.some((t) => hay.includes(t));
}

export function shouldExtractiveAnswer(prepared: CsPrepareResult): boolean {
  if (prepared.wantHandoff) return false;
  if (!prepared.grounded) return false;
  if (prepared.intent === 'complaint') return false;
  if (prepared.historyContext?.trim()) return false;
  return hasSnippetOverlap(prepared.question, prepared.citations);
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？!?\n])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 6);
}

/** 从摘录抽出与问题相关的短句，避免把整段政策甩给用户。 */
export function rewriteFromSnippets(question: string, citations: CsCitation[]): string {
  const sentences = citations.flatMap((c) => splitSentences(c.snippet));
  const terms = [
    ...question.replace(/[？?，,。！!、；;：:\s]+/g, ' ').split(' ').filter((s) => s.length >= 2),
  ];
  const scored = sentences
    .map((s) => ({
      s,
      n: terms.filter((t) => s.includes(t)).length + (FAQ_TOPIC_RE.test(s) ? 1 : 0),
    }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);

  const picked: string[] = [];
  for (const item of scored) {
    if (picked.includes(item.s)) continue;
    picked.push(item.s);
    if (picked.length >= 3) break;
  }
  const body = (picked.length ? picked : sentences.slice(0, 2)).join('');
  const trimmed = body.slice(0, 280);
  return trimmed ? `根据知识库：${trimmed}` : '根据知识库暂未找到可直接引用的条款，建议转人工确认。';
}

export function keywordTerms(query: string): string[] {
  return query
    .replace(/[？?，,。！!、；;：:\s]+/g, ' ')
    .split(' ')
    .map((s) => s.trim())
    .filter((s) => s.length >= 2)
    .slice(0, 6);
}
