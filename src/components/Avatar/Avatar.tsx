import React from 'react';
import styles from './Avatar.module.sass';

interface AvatarLayer {
  x?: number;
  y?: number;
  image: string;
}

interface AvatarProps {
  backgroundImage?: string;
  layers?: AvatarLayer[];
  size?: 'lg' | 'md' | 'sm' | 'xs';
  className?: string;
}

export const Avatar: React.FC<AvatarProps> = ({ backgroundImage, layers, size = 'lg', className }) => {
  const sizeMap = {
    lg: 1,
    md: 0.8,
    sm: 0.6,
    xs: 0.3,
  };
  const sizeInt = sizeMap[size];

  if (!backgroundImage && (!layers || layers.length === 0)) {
    return (
      <div className={`${styles.avatarPlaceholder} ${className}`} style={{ scale: sizeInt }}>
        ?
      </div>
    );
  }

  return (
    <div className={`${styles.avatarWrapper} ${className}`} style={{ scale: sizeInt, position: 'relative' }}>
      {backgroundImage && (
        <img src={backgroundImage} alt="Avatar Background" className={styles.layer} style={{ left: 0, top: 0 }} />
      )}
      {layers?.map((layer, index) => (
        <img
          key={index}
          src={layer.image.startsWith('http') ? layer.image : `https://www.hattrick.org${layer.image}`}
          alt={`Avatar Layer ${index}`}
          className={styles.layer}
          style={{
            left: `${layer.x || 0}px`,
            top: `${layer.y || 0}px`,
          }}
        />
      ))}
    </div>
  );
};
