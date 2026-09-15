import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Info, X } from 'lucide-react';
import { placeExplanation } from '../lib/tooltip-placement';

export function ViewportExplanation({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<ReturnType<typeof placeExplanation> | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const pinned = useRef(false);
  const suppressFocus = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const id = useId();
  const cancelClose = () => clearTimeout(timer.current);
  const close = () => {
    cancelClose(); pinned.current = false; setOpen(false); setPosition(null);
  };
  const scheduleClose = () => {
    cancelClose();
    timer.current = setTimeout(() => {
      if (!pinned.current && !panel.current?.contains(document.activeElement)) close();
    }, 200);
  };
  const show = () => { cancelClose(); setOpen(true); };
  const closeAndFocus = () => {
    close(); suppressFocus.current = true; trigger.current?.focus(); suppressFocus.current = false;
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  useLayoutEffect(() => {
    if (!open || !trigger.current || !panel.current) return;
    const update = () => {
      if (!trigger.current || !panel.current) return;
      const button = trigger.current.getBoundingClientRect();
      const card = (trigger.current.closest('.group') ?? trigger.current).getBoundingClientRect();
      const view = window.visualViewport;
      const viewport = { top: view?.offsetTop ?? 0, left: view?.offsetLeft ?? 0,
        width: view?.width ?? window.innerWidth, height: view?.height ?? window.innerHeight };
      if (button.bottom < viewport.top || button.top > viewport.top + viewport.height) { close(); return; }
      // Set width before measuring wrapped text, including on narrow phones.
      panel.current.style.width = `${Math.max(1, Math.min(card.width, viewport.width - 24))}px`;
      const next = placeExplanation({top:button.top, bottom:button.bottom, left:card.left, width:card.width},
        viewport, panel.current.scrollHeight + 2);
      setPosition(old => old && Object.keys(next).every(key => old[key as keyof typeof old] === next[key as keyof typeof next]) ? old : next);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(panel.current);
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && panel.current?.contains(event.target)) return;
      update();
    };
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !panel.current?.contains(event.target) && !trigger.current?.contains(event.target)) close();
    };
    const keyboard = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); closeAndFocus(); } };
    window.addEventListener('resize', update);
    window.addEventListener('scroll', onScroll, true);
    window.visualViewport?.addEventListener('resize', update);
    window.visualViewport?.addEventListener('scroll', update);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', keyboard);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', onScroll, true);
      window.visualViewport?.removeEventListener('resize', update);
      window.visualViewport?.removeEventListener('scroll', update);
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', keyboard);
    };
  }, [open]);
  return <>
    <button ref={trigger} type="button" aria-label={`查看${label}的詳細解釋與公式`}
      aria-expanded={open} aria-controls={open ? id : undefined} aria-haspopup="dialog"
      onPointerEnter={event => { if (event.pointerType === 'mouse') show(); }}
      onPointerLeave={scheduleClose} onFocus={() => { if (!suppressFocus.current) show(); }}
      onBlur={scheduleClose}
      onClick={() => { if (pinned.current) close(); else { pinned.current = true; show(); } }}
      className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-white/10 text-slate-400 transition hover:border-indigo-300/40 hover:text-indigo-200 focus:border-indigo-300/50 focus:text-indigo-100 focus:outline-none">
      <Info size={14} />
    </button>
    {open && createPortal(<div ref={panel} id={id} role="dialog" aria-label={`${label}詳細說明`}
      tabIndex={0} data-side={position?.side}
      onPointerEnter={cancelClose} onPointerLeave={scheduleClose} onFocus={cancelClose} onBlur={scheduleClose}
      style={{position:'fixed', zIndex:1000, top:position?.top ?? 0, left:position?.left ?? 0,
        width:position?.width ?? 320, maxHeight:position?.maxHeight ?? '70vh', visibility:position ? 'visible' : 'hidden',
        boxSizing:'border-box', overscrollBehavior:'contain'}}
      className="overflow-y-auto rounded-xl border border-indigo-300/25 bg-slate-950/95 p-4 text-left text-white shadow-2xl backdrop-blur">
      <button type="button" onClick={closeAndFocus} aria-label="關閉詳細說明"
        className="float-right ml-2 grid h-6 w-6 place-items-center rounded text-slate-300 hover:bg-white/10"><X size={16}/></button>
      {children}
    </div>, document.body)}
  </>;
}
