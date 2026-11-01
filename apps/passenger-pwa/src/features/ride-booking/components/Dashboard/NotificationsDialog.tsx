import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
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
import CampaignOutlinedIcon from "@mui/icons-material/CampaignOutlined";
import NotificationsOutlinedIcon from "@mui/icons-material/NotificationsOutlined";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";

import { useLanguage } from "../../../../utils/LanguageContext";
import { AnnouncementEventIcon, TYPOGRAPHY_TOKENS, activateWithKeyboard, formatNotificationTime, noticeActions } from "@sakay/shared";
import type { NoticeAction } from "@sakay/shared";

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
  /** The kind of notice the database wrote, and the record it is about: together they decide the action under it (a trip, a strike, a report) */
  type?: string;
  subjectId?: string;
}

/** How long ago the notice was sent, in the selected language (shared with the other apps) */
export function getRelativeTime(createdAt: string | undefined, language: 'tl' | 'en' = 'tl'): string {
  return formatNotificationTime(createdAt, language);
}

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
  notifications = [],
  onMarkAsRead = () => {},
  onMarkAllAsRead = () => {},
}) => {
  const { language } = useLanguage();
  const navigate = useNavigate();
  const isTagalog = language === "tl";
  const [activeFilter, setActiveFilter] = useState<'all' | 'trips' | 'advisories'>('all');
  const [selectedNotif, setSelectedNotif] = useState<NotificationItem | null>(null);
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
    onClose();
  };

  const unreadCount = mergedNotifications.filter((n) => !n.isRead).length;

  // An action opens the page of the record the notice is about: the notice is read, the screen closes and the page opens
  const actionsOf = (item: NotificationItem): NoticeAction[] => noticeActions("passenger", { type: item.type || (item as any).notificationType, subjectId: item.subjectId });
  const runAction = (item: NotificationItem, action: NoticeAction) => {
    handleMarkAsRead(item.id);
    setSelectedNotif(null);
    onClose();
    navigate(action.to);
  };
  const renderActionButtons = (item: NotificationItem) => {
    const list = actionsOf(item);
    if (list.length === 0) return null;
    return list.map((a, i) => (
      <Button
        key={a.key}
        fullWidth
        variant={i === 0 ? "contained" : "outlined"}
        disableElevation
        onClick={() => runAction(item, a)}
        sx={{
          width: "100%",
          textTransform: "none",
          fontWeight: 700,
          fontFamily: "Poppins, sans-serif",
          fontSize: "14px",
          minHeight: 46,
          height: 46,
          borderRadius: "12px",
          ...(i === 0
            ? { backgroundColor: "#FF6600", color: "#FFFFFF", "&:hover": { backgroundColor: "#E65C00" } }
            : { borderColor: "#FF6600", color: "#C2410C", "&:hover": { backgroundColor: "#FFF7ED", borderColor: "#E65C00" } }),
        }}
      >
        {isTagalog ? a.tl : a.en}
      </Button>
    ));
  };

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

      <DialogContent sx={{ p: 0, display: "flex", flexDirection: "column", "& > *": { flexShrink: 0 }, pb: "var(--safe-area-bottom)" }}>
        {selectedNotif ? (
          <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, overflow: "hidden" }}>
            <Box sx={{ flex: 1, minHeight: 0, overflowY: "auto", px: 2, py: 2.5 }}>
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
                    {getCategoryIcon(selectedNotif.category, selectedNotif.eventType)}
                  </Box>
                  <Box>
                    <Typography sx={{ fontSize: "13px", fontWeight: 700, color: "#FF6600" }}>
                      {/* what the database wrote for this passenger comes from SAKAY; an announcement is written by the TODA / LGU administration */}
                      {selectedNotif.id.startsWith("db:")
                        ? "SAKAY"
                        : (isTagalog ? "TODA / LGU Tagapamahala" : "TODA / LGU Administration")}
                    </Typography>
                    <Typography sx={{ fontSize: "12px", color: "#64748B" }}>
                      {getRelativeTime(selectedNotif.createdAt, language)}
                    </Typography>
                  </Box>
                </Box>
              </Box>

              <Typography
                sx={{
                  fontSize: "18px",
                  fontWeight: 700,
                  color: "#0F172A",
                  lineHeight: 1.3,
                  mb: 2,
                }}
              >
                {isTagalog
                  ? (selectedNotif.titleTl || selectedNotif.titleEn)
                  : (selectedNotif.titleEn || selectedNotif.titleTl)}
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
                {isTagalog
                  ? (selectedNotif.bodyTl || selectedNotif.bodyEn)
                  : (selectedNotif.bodyEn || selectedNotif.bodyTl)}
              </Typography>
            </Box>

            {actionsOf(selectedNotif).length > 0 && (
              <Box
                sx={{
                  p: 2.5,
                  pt: 2,
                  borderTop: "1px solid #F1F5F9",
                  backgroundColor: "#FFFFFF",
                  flexShrink: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: 1.25,
                }}
              >
                {renderActionButtons(selectedNotif)}
              </Box>
            )}
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
                color: "#FF6600",
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
              const time = getRelativeTime(item.createdAt, language);

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
                      height: "88px",
                      minHeight: "88px",
                      maxHeight: "88px",
                      boxSizing: "border-box",
                      overflow: "hidden",
                      py: 1.5,
                      px: 2,
                      display: "flex",
                      alignItems: "center",
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
                        {getCategoryIcon(item.category, item.eventType)}
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

                    {/* Content area: Title, Short Description, Timestamp */}
                    <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", justifyContent: "center", height: "100%", overflow: "hidden" }}>
                      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, minWidth: 0, mb: 0.25 }}>
                        <Typography
                          sx={{
                            fontSize: TYPOGRAPHY_TOKENS.fontSize.buttonMobile,
                            fontWeight: item.isRead ? TYPOGRAPHY_TOKENS.fontWeight.semibold : TYPOGRAPHY_TOKENS.fontWeight.bold,
                            color: "#0F172A",
                            fontFamily: "Poppins, sans-serif",
                            lineHeight: 1.25,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            flex: 1,
                            minWidth: 0,
                          }}
                        >
                          {title}
                        </Typography>
                        <Typography
                          sx={{
                            fontSize: TYPOGRAPHY_TOKENS.fontSize.caption,
                            fontWeight: TYPOGRAPHY_TOKENS.fontWeight.regular,
                            color: "#64748B",
                            fontFamily: "Poppins, sans-serif",
                            whiteSpace: "nowrap",
                            flexShrink: 0,
                          }}
                        >
                          {time}
                        </Typography>
                      </Box>

                      <Typography
                        sx={{
                          fontSize: TYPOGRAPHY_TOKENS.fontSize.secondary,
                          fontWeight: TYPOGRAPHY_TOKENS.fontWeight.regular,
                          color: "#64748B",
                          fontFamily: "Poppins, sans-serif",
                          lineHeight: 1.35,
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {body}
                      </Typography>
                    </Box>

                    <ChevronRightIcon sx={{ color: "#94A3B8", fontSize: 20, flexShrink: 0 }} />
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
