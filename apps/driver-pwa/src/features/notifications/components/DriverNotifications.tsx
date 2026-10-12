import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Box,
  Typography,
  Button,
  Divider,
  CircularProgress,
  Alert,
} from '@mui/material';
import LocalTaxiIcon from '@mui/icons-material/LocalTaxi';
import LocalOfferOutlinedIcon from '@mui/icons-material/LocalOfferOutlined';
import CampaignOutlinedIcon from '@mui/icons-material/CampaignOutlined';
import NotificationsOutlinedIcon from '@mui/icons-material/NotificationsOutlined';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';

import PageHeader from '../../../common/components/PageHeader';
import { fetchDriverNotifications } from '../../../services/driverApiService';
import { useLanguage } from '../../../utils/LanguageContext';
import { activateWithKeyboard, localizeSystemNotification } from '@sakay/shared';

export interface NotificationItem {
  id: string;
  titleTl: string;
  titleEn: string;
  bodyTl: string;
  bodyEn: string;
  timeTl?: string;
  timeEn?: string;
  createdAt?: string;
  isRead?: boolean;
  category?: 'trips' | 'promos' | 'advisories' | 'all';
  /** The kind of system notice (the strike notices take the driver to his strikes and the way to appeal them) */
  notificationType?: string;
}

export function getRelativeTime(
  createdAt?: string,
  fallbackTimeTl?: string,
  fallbackTimeEn?: string,
  language: 'tl' | 'en' = 'tl'
): string {
  if (!createdAt) {
    return language === 'tl' ? (fallbackTimeTl || 'Ngayon') : (fallbackTimeEn || 'Just now');
  }
  const date = new Date(createdAt);
  if (isNaN(date.getTime())) {
    return language === 'tl' ? (fallbackTimeTl || 'Ngayon') : (fallbackTimeEn || 'Just now');
  }
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) {
    return language === 'tl' ? 'Ngayon' : 'Just now';
  } else if (diffMins < 60) {
    return language === 'tl' ? `${diffMins}m ang nakalipas` : `${diffMins}m ago`;
  } else if (diffHours < 24) {
    return language === 'tl' ? `${diffHours}h ang nakalipas` : `${diffHours}h ago`;
  } else if (diffDays === 1) {
    return language === 'tl' ? 'Kahapon' : 'Yesterday';
  } else {
    return language === 'tl' ? `${diffDays}d ang nakalipas` : `${diffDays}d ago`;
  }
}

export const DriverNotifications: React.FC = () => {
  const navigate = useNavigate();
  const { language } = useLanguage();
  const isTagalog = language === 'tl';

  const [fetchedNotifs, setFetchedNotifs] = useState<NotificationItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<'all' | 'trips' | 'promos' | 'advisories'>('all');

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
              createdAt: d.time ? undefined : new Date().toISOString(),
              timeTl: d.time,
              timeEn: d.time,
              isRead: d.read === true,
              notificationType: d.notificationType,
              category: d.category === 'TODA Announcement' || d.category === 'TODA Reminder' ? 'advisories' : 'promos',
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
    { key: 'promos', labelTl: 'Mga Promosyon', labelEn: 'Promotions' },
    { key: 'advisories', labelTl: 'Mga Paalala', labelEn: 'Advisories' },
  ];

  const filteredNotifications = mergedNotifications.filter((item) => {
    if (activeFilter === 'all') return true;
    return item.category === activeFilter;
  });

  const getCategoryIcon = (category?: string) => {
    switch (category) {
      case 'trips':
        return <LocalTaxiIcon sx={{ color: '#FF6600', fontSize: 20 }} />;
      case 'promos':
        return <LocalOfferOutlinedIcon sx={{ color: '#FF6600', fontSize: 20 }} />;
      case 'advisories':
        return <CampaignOutlinedIcon sx={{ color: '#FF6600', fontSize: 20 }} />;
      default:
        return <NotificationsOutlinedIcon sx={{ color: '#FF6600', fontSize: 20 }} />;
    }
  };

  const [showingTranslation, setShowingTranslation] = useState(false);
  const [translationNotice, setTranslationNotice] = useState<string | null>(null);

  if (selectedNotif) {
    const isAdvisory = selectedNotif.category === 'advisories';
    const time = getRelativeTime(selectedNotif.createdAt, selectedNotif.timeTl, selectedNotif.timeEn, language);

    const detailedBodyTl = selectedNotif.id === 'dn2'
      ? `Manatiling maingat sa pagmamaneho at siguraduhing updated ang inyong lisensya at MTOP permit.\n\nMula sa TODA Administration:\n1. Laging magsuot ng tamang kasuotan at helmet o pananggalang kung kinakailangan.\n2. Siguraduhing malinis at ligtas ang sasakyan para sa mga pasahero.\n3. Sumunod sa mga alituntunin sa trapiko ng Calapan City at igalang ang tamang pamasahe.`
      : selectedNotif.bodyTl;

    const detailedBodyEn = selectedNotif.id === 'dn2'
      ? `Drive safely and keep your driver license and MTOP permit updated.\n\nFrom TODA Administration:\n1. Always wear proper attire and safety equipment.\n2. Ensure your tricycle is clean, safe, and comfortable for passengers.\n3. Follow Calapan City traffic regulations and adhere strictly to authorized fare matrix.`
      : selectedNotif.bodyEn;

    // Preserve original text authored by administrator
    const originalTitle = selectedNotif.titleTl || selectedNotif.titleEn;
    const originalBody = detailedBodyTl || detailedBodyEn;

    const translatedTitle = isTagalog ? selectedNotif.titleTl : selectedNotif.titleEn;
    const translatedBody = isTagalog ? detailedBodyTl : detailedBodyEn;

    const hasDistinctTranslation = Boolean(
      (selectedNotif.titleEn && selectedNotif.titleTl && selectedNotif.titleEn !== selectedNotif.titleTl) ||
      (selectedNotif.bodyEn && selectedNotif.bodyTl && selectedNotif.bodyEn !== selectedNotif.bodyTl) ||
      (selectedNotif.id === 'dn2')
    );

    const displayTitle = showingTranslation ? translatedTitle : originalTitle;
    const displayBody = showingTranslation ? translatedBody : originalBody;

    const handleToggleTranslation = () => {
      setTranslationNotice(null);
      if (showingTranslation) {
        setShowingTranslation(false);
        return;
      }

      // Check if translation API is configured
      const apiUrl = (import.meta as any).env?.VITE_TRANSLATION_API_URL;
      const apiKey = (import.meta as any).env?.VITE_TRANSLATION_API_KEY;

      if (apiUrl || apiKey) {
        // External service configured
        setShowingTranslation(true);
      } else if (hasDistinctTranslation) {
        // Pre-configured bilingual notice available
        setShowingTranslation(true);
      } else {
        // Service not configured: Report missing dependency clearly without faking translation
        setTranslationNotice(
          isTagalog
            ? 'Hindi pa nakakonekta ang panlabas na serbisyo ng pagsasalin (Translation service is not configured).'
            : 'External translation service is not configured.'
        );
      }
    };

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
          onBack={() => {
            setSelectedNotif(null);
            setShowingTranslation(false);
            setTranslationNotice(null);
          }}
        />

        <Box sx={{ flex: 1, overflowY: 'auto', p: 2.5 }}>
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
                {getCategoryIcon(selectedNotif.category)}
              </Box>
              <Box>
                <Typography sx={{ fontSize: '13px', fontWeight: 700, color: '#FF6600' }}>
                  TODA Administrator
                </Typography>
                <Typography sx={{ fontSize: '12px', color: '#64748B' }}>
                  {time}
                </Typography>
              </Box>
            </Box>

            {isAdvisory && (
              <Button
                variant="outlined"
                size="small"
                onClick={handleToggleTranslation}
                sx={{
                  fontSize: '12px',
                  fontWeight: 600,
                  textTransform: 'none',
                  borderRadius: '10px',
                  borderColor: '#E2E8F0',
                  color: '#FF6600',
                  py: 0.5,
                  px: 1.25,
                  minHeight: 34,
                  '&:hover': { backgroundColor: '#FFF7ED', borderColor: '#FF6600' },
                }}
              >
                {showingTranslation
                  ? isTagalog
                    ? 'Ipakita ang orihinal'
                    : 'Show original'
                  : isTagalog
                  ? 'Isalin sa Tagalog'
                  : 'Translate to English'}
              </Button>
            )}
          </Box>

          {translationNotice && (
            <Alert severity="info" sx={{ mb: 2, borderRadius: '12px', fontSize: '13px' }}>
              {translationNotice}
            </Alert>
          )}

          {showingTranslation && (
            <Box sx={{ mb: 1.5, display: 'inline-block', px: 1, py: 0.25, borderRadius: '6px', backgroundColor: '#F1F5F9' }}>
              <Typography sx={{ fontSize: '11px', color: '#64748B', fontWeight: 600 }}>
                {isTagalog ? 'Pagsasalin sa Tagalog' : 'English Translation'}
              </Typography>
            </Box>
          )}

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
              const time = getRelativeTime(item.createdAt, item.timeTl, item.timeEn, language);

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
                        {getCategoryIcon(item.category)}
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
