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

export const Avatar: React.FC<AvatarProps> = ({ backgroundImage, layers, size = 120, className }) => {
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
      style={{ width: size, height: size }}
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
            left: layer.x ? `${(layer.x / 110) * 100}%` : 0,
            top: layer.y ? `${(layer.y / 110) * 100}%` : 0,
            width: '100%',
            height: '100%',
          }}
        />
      ))}
    </div>
  );
};
