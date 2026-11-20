/**
 * Names the browser tab after what the page shows (a topic, a story) instead
 * of the route's static title, and returns a function that puts the old title
 * back. Static export means these pages can't use generateMetadata.
 */
export function showTabTitle(
  doc: { title: string },
  name: string | null | undefined,
): () => void {
  const text = name?.trim();
  if (!text) return () => {};
  const before = doc.title;
  doc.title = `${text} · Scout`;
  return () => {
    doc.title = before;
  };
}
