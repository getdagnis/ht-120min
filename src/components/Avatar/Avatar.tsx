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

export const Avatar: React.FC<AvatarProps> = ({ avatar, variant, size = 120, className }) => {
  if (!avatar || !avatar.backgroundImage) {
    return (
      <div
        className={`${styles.container} ${styles[variant]} ${className}`}
        style={{ width: size, height: size, backgroundColor: 'var(--borderWeak)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <span style={{ fontSize: `${size / 2}px`, color: 'var(--text60)' }}>👤</span>
      </div>
    );
  }

  // Hattrick avatar base size is typically around 100-120px depending on the assets
  const width = 120;
  const height = 138;
  const scale = size / width;

  return (
    <div 
      className={`${styles.container} ${styles[variant]} ${className}`} 
      style={{ width: size, height: size, overflow: 'hidden', position: 'relative' }}
    >
      <div
        style={{
          width: width,
          height: height,
          position: 'absolute',
          left: '50%',
          top: '55%',
          transform: `translate(-50%, -50%) scale(${scale})`,
          transformOrigin: 'center center',
        }}
      >
        {/* Background Image */}
        <img src={avatar.backgroundImage} alt="Avatar Background" />

        {/* Layers */}
        {avatar.layers?.map((layer, idx) => (
          <img
            key={idx}
            src={layer.image}
            alt={`Layer ${idx}`}
            className={styles.layer}
            style={{
              position: 'absolute',
              left: `${layer.x ?? 0}px`,
              top: `${layer.y ?? 0}px`,
            }}
          />
        ))}
      </div>
    </div>
  );
};
