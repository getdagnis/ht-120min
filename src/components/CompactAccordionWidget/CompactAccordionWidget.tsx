import React, { useState } from 'react';
import { CaretDown, CaretUp } from 'phosphor-react';
import { SidebarWidget } from '../SidebarWidget/SidebarWidget';
import styles from './CompactAccordionWidget.module.sass';

export interface CompactAccordionItem {
  id: string;
  title: string;
  body: string;
}

interface CompactAccordionWidgetProps {
  title: React.ReactNode;
  icon: React.ReactNode;
  items: CompactAccordionItem[];
  className?: string;
}

export const CompactAccordionWidget: React.FC<CompactAccordionWidgetProps> = ({
  title,
  icon,
  items,
  className = '',
}) => {
  const [expandedItems, setExpandedItems] = useState<Set<string>>(() => new Set());

  const toggleItem = (id: string) => {
    setExpandedItems((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <SidebarWidget title={title} icon={icon} className={`${styles.widget} ${className}`}>
      {items.map((item) => {
        const expanded = expandedItems.has(item.id);

        return (
          <div key={item.id} className={styles.item}>
            <button
              type="button"
              className={styles.toggle}
              onClick={() => toggleItem(item.id)}
              aria-expanded={expanded}
            >
              <strong>{item.title}</strong>
              {expanded ? <CaretUp size={15} weight="bold" /> : <CaretDown size={15} weight="bold" />}
            </button>
            {expanded && <p className={styles.body}>{item.body}</p>}
          </div>
        );
      })}
    </SidebarWidget>
  );
};
