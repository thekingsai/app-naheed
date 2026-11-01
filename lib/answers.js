// Strip a stored two-doctor reply down to its final combined answer.
export function finalOf(t) {
  const s = String(t || '');
  if (!s.includes('%%SENIOR%%')) return s;
  const senior = s.split('%%SENIOR%%')[1] || '';
  return (senior.split('%%FINAL%%')[1] || senior).trim();
}

