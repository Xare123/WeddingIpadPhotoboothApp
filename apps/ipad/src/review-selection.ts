// A thumbnail is explicit intent. Native animated scrolling emits intermediate
// frames; those frames must not change which original an immediate Retake uses.
export function createReviewSelection(initialSlot = 0) {
  let selected = initialSlot;
  let target: number | null = null;
  let lastOffset = 0;
  const visible = (width: number, slots: number[]) => slots[Math.max(0, Math.min(slots.length - 1, Math.round(lastOffset / Math.max(1, width))))];
  return {
    current: () => target ?? selected,
    isTarget: (slot: number) => target === slot,
    select(slot: number) { selected = slot; target = slot; return slot; },
    scroll(offset: number, width: number, slots: number[]) {
      lastOffset = offset;
      if (target !== null) {
        const targetIndex = slots.indexOf(target);
        if (targetIndex >= 0 && Math.abs(offset - targetIndex * width) <= 2) {
          selected = target;
          target = null;
        }
      } else {
        selected = visible(width, slots) ?? selected;
      }
      return target ?? selected;
    },
    beginDrag(width: number, slots: number[], offset?: number) {
      if (offset !== undefined) lastOffset = offset;
      target = null;
      selected = visible(width, slots) ?? selected;
      return selected;
    },
  };
}
