import Image from 'next/image';
import { useTranslations } from 'next-intl';
import discordIcon from '../../assets/discord-bubble.svg';
import styles from './DiscordInvite.module.sass';

export function DiscordInvite() {
  const t = useTranslations('Home');

  return (
    <a
      className={styles.discordInvite}
      href="https://discord.gg/5brBQTYxk"
      target="_blank"
      rel="noopener noreferrer"
    >
      <Image src={discordIcon} alt="" className={styles.discordIcon} />
      <span>{t('chatDiscordInvite')}</span>
    </a>
  );
}
