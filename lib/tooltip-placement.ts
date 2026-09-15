/** All coordinates are CSS pixels relative to the layout viewport. */
export function placeExplanation(
  anchor: { top: number; bottom: number; left: number; width: number },
  viewport: { top: number; left: number; width: number; height: number },
  contentHeight: number,
) {
  const margin = 12;
  const gap = 8;
  const width = Math.max(1, Math.min(anchor.width, viewport.width - margin * 2));
  const left = Math.max(viewport.left + margin,
    Math.min(anchor.left, viewport.left + viewport.width - margin - width));
  const minTop = viewport.top + margin;
  const maxBottom = viewport.top + viewport.height - margin;
  const below = Math.max(0, maxBottom - anchor.bottom - gap);
  const above = Math.max(0, anchor.top - gap - minTop);
  const desired = Math.min(contentHeight, viewport.height * 0.7);
  const side = below >= desired || below >= above ? 'bottom' : 'top';
  const maxHeight = Math.max(1, Math.min(viewport.height * 0.7, side === 'bottom' ? below : above));
  const height = Math.min(contentHeight, maxHeight);
  const top = Math.max(minTop, Math.min(
    side === 'bottom' ? anchor.bottom + gap : anchor.top - gap - height,
    maxBottom - height,
  ));
  return { top, left, width, maxHeight, side };
}
