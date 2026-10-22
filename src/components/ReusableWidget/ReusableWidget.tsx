import React from 'react';
import styles from './ReusableWidget.module.sass';

interface SidebarWidgetProps {
  title: React.ReactNode;
  headerAction?: React.ReactNode;
  icon: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

export const ReusableWidget: React.FC<SidebarWidgetProps> = ({ title, headerAction, icon, children, footer, className = '' }) => {
  return (
    <section className={`${styles.widget} ${className}`}>
      <h3 className={styles.header}>
        <span className={styles.icon}>{icon}</span>
        <span className={styles.title}>{title}</span>
        {headerAction}
      </h3>
      <div className={styles.body}>{children}</div>
      {footer && <div className={styles.footer}>{footer}</div>}
    </section>
  );
};
