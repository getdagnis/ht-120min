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
  size?: number;
  className?: string;
}

export const Avatar: React.FC<AvatarProps> = ({ backgroundImage, layers, size = 110, className }) => {
  if (!backgroundImage && (!layers || layers.length === 0)) {
    return (
      <div 
        className={`${styles.avatarPlaceholder} ${className}`} 
        style={{ width: size, height: size }}
      >
        ?
      </div>
    );
  }

  return (
    <div 
      className={`${styles.avatarWrapper} ${className}`} 
      style={{ width: 110, height: 110 }} // Fixed 110x110 canvas
    >
      {backgroundImage && (
        <img src={backgroundImage} alt="Avatar Background" className={styles.layer} />
      )}
      {layers?.map((layer, index) => (
        <img
          key={index}
          src={layer.image}
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
