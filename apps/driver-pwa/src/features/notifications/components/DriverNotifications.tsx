import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Button,
  Divider,
  CircularProgress,
} from '@mui/material';
import LocalTaxiIcon from '@mui/icons-material/LocalTaxi';
import CampaignOutlinedIcon from '@mui/icons-material/CampaignOutlined';
import NotificationsOutlinedIcon from '@mui/icons-material/NotificationsOutlined';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';

import PageHeader from '../../../common/components/PageHeader';
import { fetchDriverNotifications } from '../../../services/driverApiService';
import { useLanguage } from '../../../utils/LanguageContext';
import { AnnouncementEventIcon, activateWithKeyboard, formatNotificationTime, localizeSystemNotification, notificationCategory } from '@sakay/shared';

export interface NotificationItem {
  id: string;
  titleTl: string;
  titleEn: string;
  bodyTl: string;
  bodyEn: string;
  createdAt?: string;
  isRead?: boolean;
  category?: 'trips' | 'advisories' | 'all';
  /** What an announcement is about (announcement.event_type): its icon follows it */
  eventType?: string;
  /** The kind of system notice (the strike notices take the driver to his strikes and the way to appeal them) */
  notificationType?: string;
}

/** Who a notice is from: the TODA or LGU administrator for an announcement or a reminder they sent, SAKAY for everything the system wrote */
function senderOf(item: NotificationItem): string {
  if (!item.notificationType) return 'TODA Administrator';
  if (item.notificationType === 'TODA_REMINDER') return 'TODA Administrator';
  if (item.notificationType === 'LGU_RENEWAL_REMINDER') return 'LGU Administrator';
  return 'SAKAY';
}

/** How long ago the notice was sent, in the selected language (the same words as before, now shared with the other apps) */
export function getRelativeTime(createdAt: string | undefined, language: 'tl' | 'en' = 'tl'): string {
  return formatNotificationTime(createdAt, language);
}

export const DriverNotifications: React.FC = () => {
  const navigate = useNavigate();
  const { language } = useLanguage();
  const isTagalog = language === 'tl';

  const [fetchedNotifs, setFetchedNotifs] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<'all' | 'trips' | 'advisories'>('all');

  const [localReadIds, setLocalReadIds] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem('sakay_driver_read_notifications');
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('sakay_driver_read_notifications', JSON.stringify(localReadIds));
    } catch (e) {
      console.warn('Failed to persist driver read notifications:', e);
    }
  }, [localReadIds]);

  useEffect(() => {
    fetchDriverNotifications()
      .then((data) => {
        {
          const mapped: NotificationItem[] = (data || []).map((d: any) => {
            const tl = localizeSystemNotification(d.title, d.message, 'tl', d.notificationType);
            const en = localizeSystemNotification(d.title, d.message, 'en', d.notificationType);
            return {
              id: d.id,
              titleTl: tl.title,
              titleEn: en.title,
              bodyTl: tl.message,
              bodyEn: en.message,
              createdAt: d.sentAt || undefined,
              isRead: d.read === true,
              notificationType: d.notificationType,
              eventType: d.eventType,
              category: notificationCategory(d.notificationType),
            };
          });
          setFetchedNotifs(mapped);
        }
      })
      .catch(() => {
        // Nothing to show is shown as nothing (no made-up notifications)
        setFetchedNotifs([]);
      })
      .finally(() => setLoading(false));
  }, []);

  const [selectedNotif, setSelectedNotif] = useState<NotificationItem | null>(null);

  const mergedNotifications = fetchedNotifs.map((n) => ({
    ...n,
    isRead: n.isRead || localReadIds.includes(n.id),
  }));

  const handleMarkAsRead = (id: string) => {
    if (!localReadIds.includes(id)) {
      setLocalReadIds((prev) => [...prev, id]);
    }
  };

  const handleMarkAllAsRead = () => {
    const allIds = fetchedNotifs.map((n) => n.id);
    setLocalReadIds(Array.from(new Set([...localReadIds, ...allIds])));
  };

  const handleNotificationClick = (item: NotificationItem) => {
    handleMarkAsRead(item.id);
    setSelectedNotif(item);
  };

  const unreadCount = mergedNotifications.filter((n) => !n.isRead).length;

  const filters = [
    { key: 'all', labelTl: 'Lahat', labelEn: 'All' },
    { key: 'trips', labelTl: 'Mga Biyahe', labelEn: 'Trips' },
    { key: 'advisories', labelTl: 'Mga Paalala', labelEn: 'Advisories' },
  ];

  const filteredNotifications = mergedNotifications.filter((item) => {
    if (activeFilter === 'all') return true;
    return item.category === activeFilter;
  });

  const getCategoryIcon = (category?: string, eventType?: string) => {
    if (eventType) return <AnnouncementEventIcon type={eventType} sx={{ color: '#FF6600' }} />;
    switch (category) {
      case 'trips':
        return <LocalTaxiIcon sx={{ color: '#FF6600', fontSize: 20 }} />;
      case 'advisories':
        return <CampaignOutlinedIcon sx={{ color: '#FF6600', fontSize: 20 }} />;
      default:
        return <NotificationsOutlinedIcon sx={{ color: '#FF6600', fontSize: 20 }} />;
    }
  };

  if (selectedNotif) {
    const time = getRelativeTime(selectedNotif.createdAt, language);

    // The notice always shows in the language that is selected; there is no separate translate step.
    const displayTitle = isTagalog ? selectedNotif.titleTl : selectedNotif.titleEn;
    const displayBody = isTagalog ? selectedNotif.bodyTl : selectedNotif.bodyEn;

    return (
      <Box
        sx={{
          width: '100%',
          height: '100%',
          backgroundColor: '#FFFFFF',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <PageHeader
          title={isTagalog ? 'Detalye ng Abiso' : 'Notice Details'}
          onBack={() => setSelectedNotif(null)}
        />

        <Box sx={{ flex: 1, overflowY: 'auto', px: 2, py: 2.5 }}>
          {/* Header info */}
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5, mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Box
                sx={{
                  width: 44,
                  height: 44,
                  borderRadius: '50%',
                  backgroundColor: '#FFF2E9',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                {getCategoryIcon(selectedNotif.category, selectedNotif.eventType)}
              </Box>
              <Box>
                <Typography sx={{ fontSize: '13px', fontWeight: 700, color: '#FF6600' }}>
                  {senderOf(selectedNotif)}
                </Typography>
                <Typography sx={{ fontSize: '12px', color: '#64748B' }}>
                  {time}
                </Typography>
              </Box>
            </Box>
          </Box>

          <Typography
            sx={{
              fontSize: '18px',
              fontWeight: 700,
              color: '#0F172A',
              lineHeight: 1.3,
              mb: 2,
            }}
          >
            {displayTitle}
          </Typography>

          <Divider sx={{ mb: 2.5, borderColor: '#F1F5F9' }} />

          <Typography
            sx={{
              fontSize: '14px',
              color: '#334155',
              lineHeight: 1.6,
              whiteSpace: 'pre-line',
            }}
          >
            {displayBody}
          </Typography>

          {/* Rules 8.6 / 9.4: a strike notice (or a booking cancelled for him) leads to his strikes, where he can appeal within the window */}
          {(selectedNotif.notificationType === 'STRIKE_ISSUED' || selectedNotif.notificationType === 'BOOKING_AUTO_CANCELLED') && (
            <Button
              variant="outlined"
              onClick={() => navigate('/driver/strikes')}
              sx={{ mt: 2.5, textTransform: 'none', fontWeight: 700, borderRadius: '12px', minHeight: 44, borderColor: '#FF6600', color: '#FF6600' }}
            >
              {isTagalog ? 'Tingnan ang mga strike at mag-apela' : 'View my strikes and appeal'}
            </Button>
          )}
        </Box>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        width: '100%',
        height: '100%',
        backgroundColor: '#FFFFFF',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <PageHeader
        title={isTagalog ? 'Mga Notification' : 'Notifications'}
        onBack={() => navigate('/driver/home')}
      />

      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto' }}>
        {/* Filter Pills */}
        <Box
          className="hide-scrollbar"
          sx={{
            display: 'flex',
            gap: 1,
            px: 2,
            py: 1,
            overflowX: 'auto',
            borderBottom: '1px solid #F8FAFC',
          }}
        >
          {filters.map((f) => {
            const isSelected = activeFilter === f.key;
            return (
              <Box
                key={f.key}
                role="button"
                tabIndex={0}
                onKeyDown={activateWithKeyboard}
                aria-pressed={activeFilter === f.key}
                onClick={() => setActiveFilter(f.key as any)}
                sx={{
                  px: 1.75,
                  py: 0.25,
                  borderRadius: '999px',
                  fontSize: '13px',
                  fontWeight: isSelected ? 700 : 500,
                  backgroundColor: isSelected ? '#FF6600' : '#F1F5F9',
                  color: isSelected ? '#FFFFFF' : '#64748B',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  transition: 'all 0.18s ease',
                  height: '36px',
                  display: 'flex',
                  alignItems: 'center',
                  '&:hover': {
                    backgroundColor: isSelected ? '#E65C00' : '#E2E8F0',
                  },
                }}
              >
                {isTagalog ? f.labelTl : f.labelEn}
              </Box>
            );
          })}
        </Box>

        {/* Unread Section Header */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            px: 2,
            pt: 1.25,
            pb: 0.75,
          }}
        >
          <Typography
            sx={{
              fontSize: '14px',
              fontWeight: 500,
              color: '#64748B',
            }}
          >
            {isTagalog
              ? `Hindi pa nababasa (${unreadCount})`
              : `Unread (${unreadCount})`}
          </Typography>

          {unreadCount > 0 && (
            <Button
              size="small"
              onClick={handleMarkAllAsRead}
              sx={{
                fontSize: '13px',
                fontWeight: 700,
                color: '#FF6600',
                textTransform: 'none',
                p: '6px 8px',
                minHeight: 40,
                maxWidth: '60%',
                textAlign: 'right',
                borderRadius: '8px',
                lineHeight: 1.25,
                '&:hover': { backgroundColor: '#FFF7ED' },
              }}
            >
              {isTagalog ? 'Markahan lahat bilang nabasa' : 'Mark all as read'}
            </Button>
          )}
        </Box>

        {/* Notification List Rows */}
        {loading ? (
          <Box sx={{ p: 4, display: 'flex', justifyContent: 'center' }}>
            <CircularProgress size={32} sx={{ color: '#FF6600' }} />
          </Box>
        ) : filteredNotifications.length === 0 ? (
          <Box sx={{ p: 4, textAlign: 'center' }}>
            <Typography sx={{ fontSize: '13px', color: '#64748B' }}>
              {isTagalog
                ? 'Walang notification sa kategoryang ito'
                : 'No notifications in this category'}
            </Typography>
          </Box>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column' }}>
            {filteredNotifications.map((item, index) => {
              const title = isTagalog ? item.titleTl : item.titleEn;
              const body = isTagalog ? item.bodyTl : item.bodyEn;
              const time = getRelativeTime(item.createdAt, language);

              return (
                <React.Fragment key={item.id}>
                  {index > 0 && <Divider sx={{ borderColor: '#F1F5F9' }} />}
                  <Box
                    role="button"
                    tabIndex={0}
                    onKeyDown={activateWithKeyboard}
                    onClick={() => handleNotificationClick(item)}
                    sx={{
                      py: 1.5,
                      px: 2,
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 1.5,
                      backgroundColor: '#FFFFFF',
                      cursor: 'pointer',
                      transition: 'background-color 0.15s ease',
                      '&:hover': {
                        backgroundColor: '#F8FAFC',
                      },
                    }}
                  >
                    {/* Category Icon Circle with Red Badge Overlay */}
                    <Box sx={{ position: 'relative', flexShrink: 0 }}>
                      <Box
                        sx={{
                          width: 40,
                          height: 40,
                          borderRadius: '50%',
                          backgroundColor: '#FFF2E9',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {getCategoryIcon(item.category, item.eventType)}
                      </Box>
                      {!item.isRead && (
                        <Box
                          sx={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            backgroundColor: '#FF3B30',
                            border: '1.5px solid #FFFFFF',
                            position: 'absolute',
                            top: 0,
                            right: 0,
                          }}
                        />
                      )}
                    </Box>

                    {/* Title, Body, Timestamp */}
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography
                        sx={{
                          fontSize: '14px',
                          fontWeight: item.isRead ? 600 : 700,
                          color: '#0F172A',
                          lineHeight: 1.25,
                          mb: 0.2,
                        }}
                      >
                        {title}
                      </Typography>

                      <Typography
                        sx={{
                          fontSize: '13px',
                          fontWeight: 400,
                          color: '#475569',
                          lineHeight: 1.35,
                          mb: 0.25,
                          // a short preview: two lines; the whole notice opens when tapped
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                          overflowWrap: 'anywhere',
                        }}
                      >
                        {body}
                      </Typography>

                      <Typography
                        sx={{
                          fontSize: '12px',
                          fontWeight: 400,
                          color: '#64748B',
                        }}
                      >
                        {time}
                      </Typography>
                    </Box>

                    <ChevronRightIcon sx={{ color: '#64748B', fontSize: 20, mt: 0.5, flexShrink: 0 }} />
                  </Box>
                </React.Fragment>
              );
            })}
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default DriverNotifications;
