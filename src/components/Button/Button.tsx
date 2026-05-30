import React from 'react';
import styles from './Button.module.scss';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'outlineWhite' | 'danger' | 'hero';
  size?: 'sm' | 'md' | 'lg';
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
