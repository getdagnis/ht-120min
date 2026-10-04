import React from 'react';
import styles from './Avatar.module.sass';

interface AvatarLayer {
  x?: number;
  y?: number;
  image: string;
}

interface AvatarData {
  backgroundImage: string;
  layers?: AvatarLayer[];
}

interface AvatarProps {
  avatar: AvatarData | null;
  variant: 'circle' | 'rect';
  size?: number; // Size for the container
  className?: string;
}

const fixedSizeClasses: Record<number, string> = {
  22: styles.size22,
  36: styles.size36,
  50: styles.size50,
  52: styles.size52,
  120: styles.size120,
};

export const Avatar: React.FC<AvatarProps> = ({ avatar, variant, size = 120, className }) => {
  const sizeClass = fixedSizeClasses[size] || styles.sizeCustom;
  const customSizeStyle =
    sizeClass === styles.sizeCustom
      ? ({
          '--avatar-size': `${size}px`,
          '--avatar-scale': String(size / 138),
        } as React.CSSProperties)
      : undefined;
  const rootClassName = [styles.container, styles[variant], sizeClass, className].filter(Boolean).join(' ');

  if (!avatar || !avatar.backgroundImage) {
    return (
      <div className={`${rootClassName} ${styles.fallback}`} style={customSizeStyle}>
        <span className={styles.fallbackIcon}>👤</span>
      </div>
    );
  }

  return (
    <div className={rootClassName} style={customSizeStyle}>
      <div className={styles.canvas}>
        {/* Layers */}
        {avatar.layers?.map((layer, idx) => (
          <img
            key={idx}
            src={layer.image}
            alt={`Layer ${idx}`}
            className={styles.layer}
            style={{
              '--layer-x': `${layer.x ?? 0}px`,
              '--layer-y': `${layer.y ?? 0}px`,
            }}
          />
        ))}
      </div>
    </div>
  );
};
