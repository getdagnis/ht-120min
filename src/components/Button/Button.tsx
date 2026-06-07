import React from 'react';
import styles from './Button.module.sass';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'secondaryYellow' | 'outline' | 'outlineWhite' | 'danger' | 'hero' | 'zero';
  size?: 'xs' | 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  className = '',
  ...props
}) => {
  const buttonClass = [styles.button, styles[variant], styles[size], fullWidth ? styles.fullWidth : '', className].join(
    ' ',
  );

  return (
    <button className={buttonClass} {...props}>
      {children}
    </button>
  );
};
