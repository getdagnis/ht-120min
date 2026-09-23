'use client';

import React, { type CSSProperties, type ReactElement, type ReactNode, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './Tooltip.module.sass';

interface TooltipProps {
  id: string;
  content?: ReactNode;
  children?: ReactNode;
  className?: string;
  delayShow?: number;
  style?: CSSProperties;
}

interface VisibleTooltip {
  anchor: HTMLElement;
  content: ReactNode;
}

interface TooltipPosition {
  left: number;
  top: number;
  placement: 'top' | 'bottom';
}

const VIEWPORT_GUTTER = 8;
const ANCHOR_GAP = 8;

interface TooltipSubscriber {
  show: (anchor: HTMLElement) => void;
  hide: (anchor: HTMLElement) => void;
}

const subscribers = new Map<string, Set<TooltipSubscriber>>();
let removeDelegatedListeners: (() => void) | null = null;

const findTooltipAnchor = (target: EventTarget | null) =>
  target instanceof Element ? (target.closest<HTMLElement>('[data-tooltip-id]') ?? null) : null;

const notifySubscribers = (anchor: HTMLElement, action: keyof TooltipSubscriber) => {
  const tooltipId = anchor.dataset.tooltipId;
  if (!tooltipId) return;
  subscribers.get(tooltipId)?.forEach((subscriber) => subscriber[action](anchor));
};

const ensureDelegatedListeners = () => {
  if (removeDelegatedListeners) return;

  const handlePointerOver = (event: PointerEvent) => {
    const anchor = findTooltipAnchor(event.target);
    if (anchor && (!event.relatedTarget || !anchor.contains(event.relatedTarget as Node))) {
      notifySubscribers(anchor, 'show');
    }
  };
  const handlePointerOut = (event: PointerEvent) => {
    const anchor = findTooltipAnchor(event.target);
    if (anchor && (!event.relatedTarget || !anchor.contains(event.relatedTarget as Node))) {
      notifySubscribers(anchor, 'hide');
    }
  };
  const handleFocusIn = (event: FocusEvent) => {
    const anchor = findTooltipAnchor(event.target);
    if (anchor) notifySubscribers(anchor, 'show');
  };
  const handleFocusOut = (event: FocusEvent) => {
    const anchor = findTooltipAnchor(event.target);
    if (anchor && (!event.relatedTarget || !anchor.contains(event.relatedTarget as Node))) {
      notifySubscribers(anchor, 'hide');
    }
  };

  document.addEventListener('pointerover', handlePointerOver);
  document.addEventListener('pointerout', handlePointerOut);
  document.addEventListener('focusin', handleFocusIn);
  document.addEventListener('focusout', handleFocusOut);
  removeDelegatedListeners = () => {
    document.removeEventListener('pointerover', handlePointerOver);
    document.removeEventListener('pointerout', handlePointerOut);
    document.removeEventListener('focusin', handleFocusIn);
    document.removeEventListener('focusout', handleFocusOut);
    removeDelegatedListeners = null;
  };
};

const subscribe = (id: string, subscriber: TooltipSubscriber) => {
  ensureDelegatedListeners();
  const current = subscribers.get(id) ?? new Set<TooltipSubscriber>();
  current.add(subscriber);
  subscribers.set(id, current);

  return () => {
    current.delete(subscriber);
    if (current.size === 0) subscribers.delete(id);
    if (subscribers.size === 0) removeDelegatedListeners?.();
  };
};

export const Tooltip = ({ id, content, children, className, delayShow = 0, style }: TooltipProps) => {
  const [visible, setVisible] = useState<VisibleTooltip | null>(null);
  const [position, setPosition] = useState<TooltipPosition | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const childrenAreTrigger = content !== undefined && React.isValidElement(children);

  useEffect(() => {
    const clearShowTimer = () => {
      if (showTimerRef.current) {
        clearTimeout(showTimerRef.current);
        showTimerRef.current = null;
      }
    };

    const show = (anchor: HTMLElement) => {
      const tooltipContent = anchor.dataset.tooltipContent || content || children;
      if (!tooltipContent) return;

      clearShowTimer();
      const reveal = () => {
        anchor.setAttribute('aria-describedby', id);
        setPosition(null);
        setVisible({ anchor, content: tooltipContent });
      };

      if (delayShow > 0) showTimerRef.current = setTimeout(reveal, delayShow);
      else reveal();
    };

    const hide = (anchor: HTMLElement) => {
      clearShowTimer();
      if (anchor.getAttribute('aria-describedby') === id) anchor.removeAttribute('aria-describedby');
      setPosition(null);
      setVisible((current) => (current?.anchor === anchor ? null : current));
    };

    const unsubscribe = subscribe(id, { show, hide });

    return () => {
      clearShowTimer();
      unsubscribe();
    };
  }, [children, content, delayShow, id]);

  useEffect(() => {
    if (!visible) return;

    const updatePosition = () => {
      const popup = popupRef.current;
      if (!popup || !visible.anchor.isConnected) return;

      const anchorRect = visible.anchor.getBoundingClientRect();
      const popupRect = popup.getBoundingClientRect();
      const left = Math.min(
        window.innerWidth - popupRect.width - VIEWPORT_GUTTER,
        Math.max(VIEWPORT_GUTTER, anchorRect.left + anchorRect.width / 2 - popupRect.width / 2),
      );
      const fitsAbove = anchorRect.top >= popupRect.height + ANCHOR_GAP + VIEWPORT_GUTTER;
      const placement = fitsAbove ? 'top' : 'bottom';
      const top = fitsAbove
        ? anchorRect.top - popupRect.height - ANCHOR_GAP
        : anchorRect.bottom + ANCHOR_GAP;

      setPosition({ left, top, placement });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [visible]);

  const trigger = childrenAreTrigger
    ? React.cloneElement(children as ReactElement<Record<string, unknown>>, { 'data-tooltip-id': id })
    : null;
  const popup = visible
    ? createPortal(
        <div
          ref={popupRef}
          id={id}
          role="tooltip"
          className={`${styles.tooltip} ${position?.placement === 'bottom' ? styles.bottom : styles.top} ${className || ''}`}
          style={{ ...style, left: position?.left ?? 0, top: position?.top ?? 0 }}
          data-visible={position ? 'true' : 'false'}
        >
          {visible.content}
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      {trigger}
      {popup}
    </>
  );
};
