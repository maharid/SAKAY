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
import LocalOfferOutlinedIcon from '@mui/icons-material/LocalOfferOutlined';
import CampaignOutlinedIcon from '@mui/icons-material/CampaignOutlined';
import NotificationsOutlinedIcon from '@mui/icons-material/NotificationsOutlined';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';

import PageHeader from '../../../common/components/PageHeader';
import { fetchDriverNotifications } from '../../../services/driverApiService';
import { useLanguage } from '../../../utils/LanguageContext';

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

const DEFAULT_DRIVER_NOTIFICATIONS: NotificationItem[] = [
  {
    id: 'dn1',
    titleTl: 'Maligayang Pagdating sa SAKAY Driver!',
    titleEn: 'Welcome to SAKAY Driver!',
    bodyTl: 'Magsimulang mag-Online upang makatanggap ng mga booking sa buong Calapan City!',
    bodyEn: 'Go Online now to start receiving passenger dispatches across Calapan City!',
    createdAt: new Date().toISOString(),
    isRead: false,
    category: 'promos',
  },
  {
    id: 'dn2',
    titleTl: 'Paalala mula sa TODA Administrator',
    titleEn: 'Notice from TODA Administrator',
    bodyTl: 'Manatiling maingat sa pagmamaneho at siguraduhing updated ang inyong lisensya at MTOP permit.',
    bodyEn: 'Drive safely and keep your driver license and MTOP permit updated.',
    createdAt: new Date(Date.now() - 3600000 * 4).toISOString(),
    isRead: false,
    category: 'advisories',
  },
];

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
        if (data && data.length > 0) {
          const mapped: NotificationItem[] = data.map((d: any) => ({
            id: d.id,
            titleTl: d.title,
            titleEn: d.title,
            bodyTl: d.message,
            bodyEn: d.message,
            createdAt: d.time ? undefined : new Date().toISOString(),
            timeTl: d.time,
            timeEn: d.time,
            isRead: !d.unread,
            category: d.category === 'TODA Announcement' ? 'advisories' : 'promos',
          }));
          setFetchedNotifs(mapped);
        } else {
          setFetchedNotifs(DEFAULT_DRIVER_NOTIFICATIONS);
        }
      })
      .catch(() => {
        setFetchedNotifs(DEFAULT_DRIVER_NOTIFICATIONS);
      })
      .finally(() => setLoading(false));
  }, []);

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
        return <LocalTaxiIcon sx={{ color: '#FF6B00', fontSize: 20 }} />;
      case 'promos':
        return <LocalOfferOutlinedIcon sx={{ color: '#FF6B00', fontSize: 20 }} />;
      case 'advisories':
        return <CampaignOutlinedIcon sx={{ color: '#FF6B00', fontSize: 20 }} />;
      default:
        return <NotificationsOutlinedIcon sx={{ color: '#FF6B00', fontSize: 20 }} />;
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
                onClick={() => setActiveFilter(f.key as any)}
                sx={{
                  px: 1.75,
                  py: 0.25,
                  borderRadius: '999px',
                  fontSize: '13px',
                  fontWeight: isSelected ? 700 : 500,
                  backgroundColor: isSelected ? '#FF6B00' : '#F1F5F9',
                  color: isSelected ? '#FFFFFF' : '#64748B',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  transition: 'all 0.18s ease',
                  height: '28px',
                  display: 'flex',
                  alignItems: 'center',
                  '&:hover': {
                    backgroundColor: isSelected ? '#E66000' : '#E2E8F0',
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
                color: '#FF6B00',
                textTransform: 'none',
                p: '2px 4px',
                borderRadius: '6px',
                lineHeight: 1,
                whiteSpace: 'nowrap',
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
            <CircularProgress size={32} sx={{ color: '#FF6B00' }} />
          </Box>
        ) : filteredNotifications.length === 0 ? (
          <Box sx={{ p: 4, textAlign: 'center' }}>
            <Typography sx={{ fontSize: '13px', color: '#94A3B8' }}>
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
                    onClick={() => {
                      if (!item.isRead) handleMarkAsRead(item.id);
                    }}
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
                          color: '#64748B',
                          lineHeight: 1.35,
                          mb: 0.25,
                        }}
                      >
                        {body}
                      </Typography>

                      <Typography
                        sx={{
                          fontSize: '11px',
                          fontWeight: 400,
                          color: '#94A3B8',
                        }}
                      >
                        {time}
                      </Typography>
                    </Box>

                    {item.category === 'advisories' && (
                      <ChevronRightIcon sx={{ color: '#94A3B8', fontSize: 20, mt: 0.5, flexShrink: 0 }} />
                    )}
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
