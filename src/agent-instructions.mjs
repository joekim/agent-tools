export function mergeInstructions(current, block) {
  const start = '<!-- agent-tools-hub -->';
  const end = '<!-- /agent-tools-hub -->';
  if (current.includes(start)) {
    const first = current.indexOf(start), last = current.indexOf(end, first);
    if (last < 0) throw new Error('Incomplete agent-tools instruction marker; repair before updating.');
    return current.slice(0, first) + block.trimEnd() + current.slice(last + end.length);
  }
  return current.trimEnd() + '\n\n' + block.trimEnd() + '\n';
}
