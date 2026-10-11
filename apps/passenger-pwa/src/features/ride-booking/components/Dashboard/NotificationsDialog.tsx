import React, { useState, useEffect } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import LocalTaxiIcon from "@mui/icons-material/LocalTaxi";
import LocalOfferOutlinedIcon from "@mui/icons-material/LocalOfferOutlined";
import CampaignOutlinedIcon from "@mui/icons-material/CampaignOutlined";
import NotificationsOutlinedIcon from "@mui/icons-material/NotificationsOutlined";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import Alert from "@mui/material/Alert";

import { useLanguage } from "../../../../utils/LanguageContext";
import { TYPOGRAPHY_TOKENS, activateWithKeyboard } from "@sakay/shared";

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

const DEFAULT_NOTIFICATIONS: NotificationItem[] = [
  {
    id: "n1",
    titleTl: "Maligayang Pagdating sa SAKAY!",
    titleEn: "Welcome to SAKAY!",
    bodyTl: "Mabilis at tapat na pamasahe sa tricycle saan man sa Calapan City. Mag-book ng iyong unang biyahe ngayon!",
    bodyEn: "Fast and fair tricycle fares anywhere in Calapan City. Start booking your ride today!",
    createdAt: new Date().toISOString(),
    isRead: false,
    category: "promos",
  },
];

interface NotificationsDialogProps {
  open: boolean;
  onClose: () => void;
  notifications?: NotificationItem[];
  onMarkAsRead?: (id: string) => void;
  onMarkAllAsRead?: () => void;
}

const NotificationsDialog: React.FC<NotificationsDialogProps> = ({
  open,
  onClose,
  notifications = DEFAULT_NOTIFICATIONS,
  onMarkAsRead = () => {},
  onMarkAllAsRead = () => {},
}) => {
  const { language } = useLanguage();
  const isTagalog = language === "tl";
  const [activeFilter, setActiveFilter] = useState<'all' | 'trips' | 'promos' | 'advisories'>('all');
  const [selectedNotif, setSelectedNotif] = useState<NotificationItem | null>(null);
  const [showingTranslation, setShowingTranslation] = useState(false);
  const [translationNotice, setTranslationNotice] = useState<string | null>(null);

  const [localReadIds, setLocalReadIds] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem("sakay_read_notifications");
      return stored ? JSON.parse(stored) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("sakay_read_notifications", JSON.stringify(localReadIds));
    } catch (e) {
      console.warn("Failed to persist read notifications:", e);
    }
  }, [localReadIds]);

  const mergedNotifications = notifications.map((n) => ({
    ...n,
    isRead: n.isRead || localReadIds.includes(n.id),
  }));

  const handleMarkAsRead = (id: string) => {
    if (!localReadIds.includes(id)) {
      setLocalReadIds((prev) => [...prev, id]);
    }
    onMarkAsRead(id);
  };

  const handleMarkAllAsRead = () => {
    const allIds = notifications.map((n) => n.id);
    setLocalReadIds(Array.from(new Set([...localReadIds, ...allIds])));
    onMarkAllAsRead();
  };

  const handleNotificationClick = (item: NotificationItem) => {
    handleMarkAsRead(item.id);
    setSelectedNotif(item);
  };

  const handleCloseDialog = () => {
    setSelectedNotif(null);
    setShowingTranslation(false);
    setTranslationNotice(null);
    onClose();
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

  const hasDistinctTranslation = Boolean(
    selectedNotif &&
    ((selectedNotif.titleEn && selectedNotif.titleTl && selectedNotif.titleEn !== selectedNotif.titleTl) ||
     (selectedNotif.bodyEn && selectedNotif.bodyTl && selectedNotif.bodyEn !== selectedNotif.bodyTl))
  );

  const handleToggleTranslation = () => {
    setTranslationNotice(null);
    if (showingTranslation) {
      setShowingTranslation(false);
      return;
    }

    const apiUrl = (import.meta as any).env?.VITE_TRANSLATION_API_URL;
    const apiKey = (import.meta as any).env?.VITE_TRANSLATION_API_KEY;

    if (apiUrl || apiKey) {
      setShowingTranslation(true);
    } else if (hasDistinctTranslation) {
      setShowingTranslation(true);
    } else {
      setTranslationNotice(
        isTagalog
          ? "Hindi pa nakakonekta ang panlabas na serbisyo ng pagsasalin (Translation service is not configured)."
          : "External translation service is not configured."
      );
    }
  };

  return (
    <Dialog
      open={open}
      onClose={handleCloseDialog}
      fullScreen
      slotProps={{
        paper: {
          sx: {
            backgroundColor: "#FFFFFF",
            padding: 0,
          },
        },
      }}
    >
      {/* 1. Header */}
      <DialogTitle
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
          pt: "calc(var(--safe-area-top) + 12px)",
          pb: 1.5,
          px: 2,
          backgroundColor: "#FFFFFF",
          borderBottom: "1px solid #F1F5F9",
        }}
      >
        <IconButton
          onClick={() => {
            if (selectedNotif) {
              setSelectedNotif(null);
              setShowingTranslation(false);
              setTranslationNotice(null);
            } else {
              handleCloseDialog();
            }
          }}
          aria-label={selectedNotif ? (isTagalog ? "Bumalik sa listahan" : "Back to list") : "Close notifications"}
          sx={{
            backgroundColor: "#FFFFFF",
            border: "1px solid #E2E8F0",
            boxShadow: "0 4px 12px rgba(0, 0, 0, 0.05)",
            color: "#1A1A1A",
            borderRadius: "14px",
            width: "44px",
            height: "44px",
            "&:hover": { backgroundColor: "#F8FAFC" },
          }}
        >
          <ArrowBackIcon sx={{ fontSize: 20 }} />
        </IconButton>

        <Typography
          sx={{
            fontSize: TYPOGRAPHY_TOKENS.fontSize.pageTitle,
            fontWeight: TYPOGRAPHY_TOKENS.fontWeight.bold,
            color: "#0F172A",
            fontFamily: "Poppins, sans-serif",
          }}
        >
          {selectedNotif
            ? (isTagalog ? "Detalye ng Abiso" : "Notice Details")
            : (language === "tl" ? "Mga Notification" : "Notifications")}
        </Typography>

        <Box sx={{ width: "44px" }} /> {/* spacer */}
      </DialogTitle>

      <DialogContent sx={{ p: 0, display: "flex", flexDirection: "column" }}>
        {selectedNotif ? (
          <Box sx={{ flex: 1, overflowY: "auto", p: 2.5 }}>
            {/* Header info */}
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1.5, mb: 2 }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                <Box
                  sx={{
                    width: 44,
                    height: 44,
                    borderRadius: "50%",
                    backgroundColor: "#FFF2E9",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    flexShrink: 0,
                  }}
                >
                  {getCategoryIcon(selectedNotif.category)}
                </Box>
                <Box>
                  <Typography sx={{ fontSize: "13px", fontWeight: 700, color: "#C2410C" }}>
                    {selectedNotif.category === "advisories"
                      ? (isTagalog ? "TODA / LGU Tagapamahala" : "TODA / LGU Administration")
                      : "SAKAY"}
                  </Typography>
                  <Typography sx={{ fontSize: "12px", color: "#64748B" }}>
                    {getRelativeTime(selectedNotif.createdAt, selectedNotif.timeTl, selectedNotif.timeEn, language)}
                  </Typography>
                </Box>
              </Box>

              {selectedNotif.category === "advisories" && (
                <Button
                  variant="outlined"
                  size="small"
                  onClick={handleToggleTranslation}
                  sx={{
                    fontSize: "12px",
                    fontWeight: 600,
                    textTransform: "none",
                    borderRadius: "10px",
                    borderColor: "#E2E8F0",
                    color: "#C2410C",
                    py: 0.5,
                    px: 1.25,
                    minHeight: 34,
                    "&:hover": { backgroundColor: "#FFF7ED", borderColor: "#FF6600" },
                  }}
                >
                  {showingTranslation
                    ? (isTagalog ? "Ipakita ang orihinal" : "Show original")
                    : (isTagalog ? "Isalin sa Tagalog" : "Translate to English")}
                </Button>
              )}
            </Box>

            {translationNotice && (
              <Alert severity="info" sx={{ mb: 2, borderRadius: "12px", fontSize: "13px" }}>
                {translationNotice}
              </Alert>
            )}

            {showingTranslation && (
              <Box sx={{ mb: 1.5, display: "inline-block", px: 1, py: 0.25, borderRadius: "6px", backgroundColor: "#F1F5F9" }}>
                <Typography sx={{ fontSize: "11px", color: "#64748B", fontWeight: 600 }}>
                  {isTagalog ? "Pagsasalin sa Tagalog" : "English Translation"}
                </Typography>
              </Box>
            )}

            <Typography
              sx={{
                fontSize: "18px",
                fontWeight: 700,
                color: "#0F172A",
                lineHeight: 1.3,
                mb: 2,
              }}
            >
              {showingTranslation
                ? (isTagalog ? selectedNotif.titleTl : selectedNotif.titleEn)
                : (selectedNotif.titleTl || selectedNotif.titleEn)}
            </Typography>

            <Divider sx={{ mb: 2.5, borderColor: "#F1F5F9" }} />

            <Typography
              sx={{
                fontSize: "14px",
                color: "#334155",
                lineHeight: 1.6,
                whiteSpace: "pre-line",
              }}
            >
              {showingTranslation
                ? (isTagalog ? selectedNotif.bodyTl : selectedNotif.bodyEn)
                : (selectedNotif.bodyTl || selectedNotif.bodyEn)}
            </Typography>
          </Box>
        ) : (
          <>
            {/* 2. Compact Filter Pills (28px height, 13px font size) */}
        <Box
          className="hide-scrollbar"
          sx={{
            display: "flex",
            gap: 1,
            px: 2,
            py: 1,
            overflowX: "auto",
            borderBottom: "1px solid #F8FAFC",
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
                  borderRadius: "999px",
                  fontSize: TYPOGRAPHY_TOKENS.fontSize.secondary,
                  fontWeight: isSelected ? TYPOGRAPHY_TOKENS.fontWeight.bold : TYPOGRAPHY_TOKENS.fontWeight.medium,
                  fontFamily: "Poppins, sans-serif",
                  backgroundColor: isSelected ? "#FF6600" : "#F1F5F9",
                  color: isSelected ? "#FFFFFF" : "#64748B",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  transition: "all 0.18s ease",
                  height: "36px",
                  display: "flex",
                  alignItems: "center",
                  "&:hover": {
                    backgroundColor: isSelected ? "#E65C00" : "#E2E8F0",
                  },
                }}
              >
                {language === "tl" ? f.labelTl : f.labelEn}
              </Box>
            );
          })}
        </Box>

        {/* 3. Unread Section Header (Medium weight non-bold heading, 13px action link) */}
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            px: 2,
            pt: 1.25,
            pb: 0.75,
          }}
        >
          <Typography
            sx={{
              fontSize: TYPOGRAPHY_TOKENS.fontSize.buttonMobile,
              fontWeight: 500,
              color: "#64748B",
              fontFamily: "Poppins, sans-serif",
            }}
          >
            {language === "tl"
              ? `Hindi pa nababasa (${unreadCount})`
              : `Unread (${unreadCount})`}
          </Typography>

          {unreadCount > 0 && (
            <Button
              size="small"
              onClick={handleMarkAllAsRead}
              sx={{
                fontSize: TYPOGRAPHY_TOKENS.fontSize.secondary,
                fontWeight: TYPOGRAPHY_TOKENS.fontWeight.bold,
                color: "#C2410C",
                textTransform: "none",
                p: "6px 8px",
                minHeight: 40,
                maxWidth: "60%",
                textAlign: "right",
                borderRadius: "8px",
                fontFamily: "Poppins, sans-serif",
                lineHeight: 1.25,
                "&:hover": { backgroundColor: "#FFF7ED" },
              }}
            >
              {language === "tl" ? "Markahan lahat bilang nabasa" : "Mark all as read"}
            </Button>
          )}
        </Box>

        {/* 4. Notification List Rows (Matching Image 1: soft light-orange icon circle with red unread badge) */}
        {filteredNotifications.length === 0 ? (
          <Box sx={{ p: 4, textAlign: "center" }}>
            <Typography
              sx={{
                fontSize: TYPOGRAPHY_TOKENS.fontSize.secondary,
                color: "#64748B",
                fontFamily: "Poppins, sans-serif",
              }}
            >
              {language === "tl"
                ? "Walang notification sa kategoryang ito"
                : "No notifications in this category"}
            </Typography>
          </Box>
        ) : (
          <Box sx={{ display: "flex", flexDirection: "column" }}>
            {filteredNotifications.map((item, index) => {
              const title = language === "tl" ? item.titleTl : item.titleEn;
              const body = language === "tl" ? item.bodyTl : item.bodyEn;
              const time = getRelativeTime(item.createdAt, item.timeTl, item.timeEn, language);

              return (
                <React.Fragment key={item.id}>
                  {index > 0 && <Divider sx={{ borderColor: "#F1F5F9" }} />}
                  <Box
                    role="button"
                    tabIndex={0}
                    onKeyDown={activateWithKeyboard}
                    onClick={() => {
                      handleNotificationClick(item);
                    }}
                    sx={{
                      py: 1.5,
                      px: 2,
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 1.5,
                      backgroundColor: "#FFFFFF",
                      cursor: "pointer",
                      transition: "background-color 0.15s ease",
                      "&:hover": {
                        backgroundColor: "#F8FAFC",
                      },
                    }}
                  >
                    {/* Category Icon Circle with Red Badge Overlay */}
                    <Box sx={{ position: "relative", flexShrink: 0 }}>
                      <Box
                        sx={{
                          width: 40,
                          height: 40,
                          borderRadius: "50%",
                          backgroundColor: "#FFF2E9",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        {getCategoryIcon(item.category)}
                      </Box>
                      {!item.isRead && (
                        <Box
                          sx={{
                            width: 8,
                            height: 8,
                            borderRadius: "50%",
                            backgroundColor: "#FF3B30",
                            border: "1.5px solid #FFFFFF",
                            position: "absolute",
                            top: 0,
                            right: 0,
                          }}
                        />
                      )}
                    </Box>

                    {/* Title (14px), Body (13px), Timestamp (12px caption) */}
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography
                        sx={{
                          fontSize: TYPOGRAPHY_TOKENS.fontSize.buttonMobile,
                          fontWeight: item.isRead ? TYPOGRAPHY_TOKENS.fontWeight.semibold : TYPOGRAPHY_TOKENS.fontWeight.bold,
                          color: "#0F172A",
                          fontFamily: "Poppins, sans-serif",
                          lineHeight: 1.25,
                          mb: 0.2,
                        }}
                      >
                        {title}
                      </Typography>

                      <Typography
                        sx={{
                          fontSize: TYPOGRAPHY_TOKENS.fontSize.secondary,
                          fontWeight: TYPOGRAPHY_TOKENS.fontWeight.regular,
                          color: "#64748B",
                          fontFamily: "Poppins, sans-serif",
                          lineHeight: 1.35,
                          mb: 0.25,
                        }}
                      >
                        {body}
                      </Typography>

                      <Typography
                        sx={{
                          fontSize: TYPOGRAPHY_TOKENS.fontSize.caption,
                          fontWeight: TYPOGRAPHY_TOKENS.fontWeight.regular,
                          color: "#64748B",
                          fontFamily: "Poppins, sans-serif",
                        }}
                      >
                        {time}
                      </Typography>
                    </Box>

                    {/* Chevron right icon only for announcements / advisories */}
                    {item.category === "advisories" && (
                      <ChevronRightIcon sx={{ color: "#64748B", fontSize: 20, mt: 0.5, flexShrink: 0 }} />
                    )}
                  </Box>
                </React.Fragment>
              );
            })}
          </Box>
        )}
        </>
      )}
      </DialogContent>
    </Dialog>
  );
};

export default NotificationsDialog;
