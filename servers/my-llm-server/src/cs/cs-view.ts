/** 会话列表预览：压空白后截到 max 字。 */
export function previewLastMessage(text: string, max = 40): string {
  const t = (text || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

/** 仅客户、且已转人工后，可留言给坐席（不走机器人）。 */
export function canCustomerFollowUp(role: string, botPaused: boolean): boolean {
  return role === 'customer' && botPaused === true;
}
