/** Preserve the server's episode order, including subsequent seasons. */
export function folgenNach(episodes, currentId) {
  const index = episodes.findIndex((e) => e.id === currentId);
  if (index < 0) return null;
  let next = null;
  for (let i = episodes.length - 1; i > index; i--) {
    const e = episodes[i];
    next = { id: e.id, title: e.title,
      se: `S${String(e.season).padStart(2, "0")}E${String(e.episode).padStart(2, "0")}`, next };
  }
  return next;
}

/** Reverse neighbours, with the same server-defined ordering across seasons. */
export function folgenVor(episodes, currentId) {
  const index = episodes.findIndex(e => e.id === currentId);
  if (index <= 0) return null;
  let prev = null;
  for (let i = 0; i < index; i++) {
    const e = episodes[i];
    prev = { id: e.id, title: e.title, se: `S${String(e.season).padStart(2,"0")}E${String(e.episode).padStart(2,"0")}`, prev };
  }
  return prev;
}
