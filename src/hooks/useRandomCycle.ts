import { useState, useEffect, useRef } from 'react';

/**
 * Standard Fisher-Yates shuffle
 */
function shuffle<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Shuffles items and ensures the first item isn't the same as the last item of the previous batch
 */
function shuffleWithoutImmediateRepeat<T>(items: T[], lastItem?: T): T[] {
  const shuffled = shuffle(items);

  if (lastItem && shuffled.length > 1 && shuffled[0] === lastItem) {
    // Swap the first and second items to prevent immediate repetition
    [shuffled[0], shuffled[1]] = [shuffled[1], shuffled[0]];
  }

  return shuffled;
}

/**
 * A hook that cycles through a list of items in a random order without repetition.
 * When all items are shown, it reshuffles and starts over, ensuring no immediate repeats.
 */
export function useRandomCycle<T>(items: T[], intervalMs: number): T {
  // The first item is rendered by both the server and the initial client
  // hydration pass. Start from the supplied order so they agree; later cycles
  // still shuffle below.
  const [queue, setQueue] = useState<T[]>(() => [...items]);
  const [index, setIndex] = useState(0);
  const hasStartedRandomCycle = useRef(false);

  // Track the previous items to detect changes and reset state during rendering
  // This is the recommended pattern for "adjusting state when props change"
  const [prevItems, setPrevItems] = useState(items);
  if (items !== prevItems) {
    setPrevItems(items);
    setQueue([...items]);
    setIndex(0);
  }

  useEffect(() => {
    hasStartedRandomCycle.current = false;
  }, [items]);

  useEffect(() => {
    if (items.length === 0) return;

    const timer = setInterval(() => {
      setIndex((prevIndex) => {
        if (!hasStartedRandomCycle.current) {
          hasStartedRandomCycle.current = true;
          setQueue(shuffleWithoutImmediateRepeat(items, queue[prevIndex]));
          return 0;
        }

        const nextIndex = prevIndex + 1;

        if (nextIndex >= queue.length) {
          // Time to reshuffle
          const lastVisibleItem = queue[queue.length - 1];
          const nextQueue = shuffleWithoutImmediateRepeat(items, lastVisibleItem);
          setQueue(nextQueue);
          return 0;
        }

        return nextIndex;
      });
    }, intervalMs);

    return () => clearInterval(timer);
  }, [queue, items, intervalMs]);

  return queue[index];
}
