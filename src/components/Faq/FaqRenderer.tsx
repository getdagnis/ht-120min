import React, { useEffect, useState } from 'react';
import { CaretDown, ChatCircleDots } from 'phosphor-react';
import type { FaqSection } from '../../constants/faq-revised';
import styles from './FaqRenderer.module.sass';

interface FaqRendererProps {
  sections: FaqSection[];
  className?: string;
}

function renderInlineMarkdown(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    if (token.startsWith('**')) {
      parts.push(<strong key={`strong-${key++}`}>{token.slice(2, -2)}</strong>);
    } else {
      const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      if (linkMatch) {
        parts.push(
          <a key={`link-${key++}`} href={linkMatch[2]} target="_blank" rel="noreferrer">
            {linkMatch[1]}
          </a>,
        );
      } else {
        parts.push(token);
      }
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  return parts;
}

function renderAnswer(answer: string) {
  const blocks = answer.trim().split(/\n\s*\n/);

  return blocks.map((block, blockIndex) => {
    const lines = block
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    const listItems = lines.filter((line) => line.startsWith('- ') || line.startsWith('* '));
    if (listItems.length === lines.length && listItems.length > 0) {
      return (
        <ul key={blockIndex} className={styles.list}>
          {listItems.map((line, itemIndex) => (
            <li key={itemIndex}>{renderInlineMarkdown(line.replace(/^[-*]\s+/, ''))}</li>
          ))}
        </ul>
      );
    }

    return (
      <p key={blockIndex} className={styles.paragraph}>
        {renderInlineMarkdown(block.replace(/\n/g, ' '))}
      </p>
    );
  });
}

export const FaqRenderer: React.FC<FaqRendererProps> = ({ sections, className = '' }) => {
  const firstItemId = sections[0]?.items[0]?.id ?? '';
  const [openItemId, setOpenItemId] = useState(firstItemId);

  useEffect(() => {
    setTimeout(() => {
      setOpenItemId(firstItemId);
    }, 0);
  }, [firstItemId]);

  return (
    <div className={`${styles.faqSurface} ${className}`}>
      <div className={styles.faqTop}>
        <div className={styles.faqTitleWrap}>
          <ChatCircleDots size={56} weight="regular" className={styles.faqTitleIcon} />
          <h2 className={styles.faqTitle}>FAQ</h2>
        </div>
      </div>

      {sections.map((section) => (
        <section key={section.id} className={styles.section}>
          <h3 className={styles.sectionTitle}>{section.title}</h3>
          <div className={styles.items}>
            {section.items.map((item) => {
              const isOpen = openItemId === item.id;
              return (
                <article key={item.id} className={`${styles.item} ${isOpen ? styles.itemExpanded : ''}`}>
                  <button
                    type="button"
                    className={styles.summary}
                    aria-expanded={isOpen}
                    onClick={() => setOpenItemId(isOpen ? '' : item.id)}
                  >
                    <span className={styles.question}>{item.question}</span>
                    <CaretDown size={26} weight="bold" className={styles.chevron} />
                  </button>
                  {isOpen && <div className={styles.answer}>{renderAnswer(item.answer)}</div>}
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
};
