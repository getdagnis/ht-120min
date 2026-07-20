import React, { useCallback, useState } from 'react';
import { X } from 'phosphor-react';

import { Button } from '../../Button/Button';
import { ANNOUNCEMENT_TEMPLATES, type TournamentAnnouncementVisibility } from '../../../utils/tournament-announcements';
import adminStyles from '../../../pages/Public/TournamentAdmin.module.sass';
import styles from '../../../pages/Public/TournamentView.module.sass';

interface AnnouncementPublishPayload {
  content: string;
  templateKey: string | null;
  visibility: TournamentAnnouncementVisibility;
}

interface AdminAnnouncementComposerProps {
  onPublishAnnouncement: (payload: AnnouncementPublishPayload) => Promise<void>;
}

export const AdminAnnouncementComposer = React.memo(function AdminAnnouncementComposer({
  onPublishAnnouncement,
}: AdminAnnouncementComposerProps) {
  const [announcementContent, setAnnouncementContent] = useState('');
  const [selectedAnnouncementTemplate, setSelectedAnnouncementTemplate] = useState<string | null>(null);
  const [isPublicAnnouncement, setIsPublicAnnouncement] = useState(false);
  const [isPublishingAnnouncement, setIsPublishingAnnouncement] = useState(false);

  const selectedAnnouncement =
    ANNOUNCEMENT_TEMPLATES.find((template) => template.id === selectedAnnouncementTemplate) || null;
  const hasAnnouncementPreview = announcementContent.trim().length > 0;

  const handleAnnouncementPublish = useCallback(async () => {
    const trimmedContent = announcementContent.trim();
    if (!trimmedContent) return;

    setIsPublishingAnnouncement(true);
    try {
      await onPublishAnnouncement({
        content: trimmedContent,
        templateKey: selectedAnnouncementTemplate,
        visibility: isPublicAnnouncement ? 'public' : 'participants',
      });
      setAnnouncementContent('');
      setSelectedAnnouncementTemplate(null);
      setIsPublicAnnouncement(false);
    } catch (error: unknown) {
      alert(error instanceof Error ? error.message : 'Failed to publish announcement.');
    } finally {
      setIsPublishingAnnouncement(false);
    }
  }, [announcementContent, isPublicAnnouncement, onPublishAnnouncement, selectedAnnouncementTemplate]);

  return (
    <div className={adminStyles.inviteActionArea}>
      <textarea
        value={announcementContent}
        onChange={(e) => setAnnouncementContent(e.target.value)}
        placeholder="Write announcement..."
        className={adminStyles.inviteTextarea}
      />

      <div className={adminStyles.announcementChips}>
        Templates:{' '}
        {ANNOUNCEMENT_TEMPLATES.map((template) => (
          <button
            key={template.id}
            type="button"
            className={selectedAnnouncementTemplate === template.id ? adminStyles.activeChip : ''}
            onClick={() => {
              setSelectedAnnouncementTemplate(template.id);
              setAnnouncementContent(template.content);
            }}
          >
            {template.label}
          </button>
        ))}
      </div>

      <label className={adminStyles.checkboxLabel}>
        <input
          type="checkbox"
          checked={isPublicAnnouncement}
          onChange={(event) => setIsPublicAnnouncement(event.target.checked)}
        />
        Public. Visible to guest visitors
      </label>

      <div className={adminStyles.smallNote}>
        {selectedAnnouncement ? `${selectedAnnouncement.label} template selected` : ''}
      </div>

      <div
        className={`${styles.joinedNotice} ${adminStyles.announcementPreview} ${
          hasAnnouncementPreview ? '' : adminStyles.announcementPreviewMuted
        }`}
      >
        <div className={styles.joinedNoticeContent}>
          <span>{announcementContent.trim() || 'Message preview will appear here.'}</span>
        </div>
        <button className={styles.dismissBtn} type="button" disabled>
          <X size={18} weight="bold" />
        </button>
      </div>

      <div className={styles.formActionRow}>
        <Button
          variant="primary"
          size="sm"
          onClick={handleAnnouncementPublish}
          disabled={isPublishingAnnouncement || !announcementContent.trim()}
        >
          {isPublishingAnnouncement ? 'Publishing...' : 'Publish'}
        </Button>
      </div>
    </div>
  );
});
