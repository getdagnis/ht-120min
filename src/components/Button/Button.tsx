import React from 'react';
import styles from './Button.module.sass';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?:
    | 'primary' // the actual secondary (neutral green)
    | 'primaryDanger'
    | 'secondary'
    | 'secondaryInverse'
    | 'secondaryHero'
    | 'secondaryYellow' // the actual primary (bright yellow)
    | 'outline'
    | 'outlineWhite'
    | 'outlineModal'
    | 'danger'
    | 'grey'
    | 'hero'
    | 'tinder'
    | 'tinderOutline'
    | 'zero'
    | 'action'
    | 'primaryAction'
    | 'secondaryAction';
  size?: 'xxs' | 'xs' | 'sm' | 'md' | 'lg';
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
