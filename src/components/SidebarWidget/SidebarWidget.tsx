import React from 'react';
import styles from './SidebarWidget.module.sass';

interface SidebarWidgetProps {
  title: React.ReactNode;
  icon: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

export const SidebarWidget: React.FC<SidebarWidgetProps> = ({ title, icon, children, footer, className = '' }) => {
  return (
    <section className={`${styles.widget} ${className}`}>
      <h3 className={styles.header}>
        <span className={styles.icon}>{icon}</span>
        <span>{title}</span>
      </h3>
      <div className={styles.body}>{children}</div>
      {footer && <div className={styles.footer}>{footer}</div>}
    </section>
  );
};
