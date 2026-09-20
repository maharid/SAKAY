import React, { useState } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import DirectionsCarOutlinedIcon from "@mui/icons-material/DirectionsCarOutlined";
import LocalOfferOutlinedIcon from "@mui/icons-material/LocalOfferOutlined";
import CampaignOutlinedIcon from "@mui/icons-material/CampaignOutlined";
import NotificationsOutlinedIcon from "@mui/icons-material/NotificationsOutlined";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";

import { useLanguage } from "../../../../utils/LanguageContext";
import { TYPOGRAPHY_TOKENS } from "@sakay/shared";

export interface NotificationItem {
  id: string;
  titleTl: string;
  titleEn: string;
  bodyTl: string;
  bodyEn: string;
  timeTl: string;
  timeEn: string;
  isRead: boolean;
  category?: 'trips' | 'promos' | 'advisories' | 'all';
}

const DEFAULT_NOTIFICATIONS: NotificationItem[] = [
  {
    id: "n1",
    titleTl: "Maligayang Pagdating sa SAKAY!",
    titleEn: "Welcome to SAKAY!",
    bodyTl: "Mabilis at tapat na pamasahe sa tricycle saan man sa Calapan City.",
    bodyEn: "Fast and fair tricycle fares anywhere in Calapan City.",
    timeTl: "Ngayon",
    timeEn: "Just now",
    isRead: false,
    category: "advisories",
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
  const [activeFilter, setActiveFilter] = useState<'all' | 'trips' | 'promos' | 'advisories'>('all');

  const unreadCount = notifications.filter((n) => !n.isRead).length;

  const filters = [
    { key: 'all', labelTl: 'Lahat', labelEn: 'All' },
    { key: 'trips', labelTl: 'Mga Biyahe', labelEn: 'Trips' },
    { key: 'promos', labelTl: 'Mga Promosyon', labelEn: 'Promotions' },
    { key: 'advisories', labelTl: 'Mga Paalala', labelEn: 'Advisories' },
  ];

  const filteredNotifications = notifications.filter((item) => {
    if (activeFilter === 'all') return true;
    return item.category === activeFilter;
  });

  const getCategoryIcon = (category?: string) => {
    switch (category) {
      case 'trips':
        return <DirectionsCarOutlinedIcon sx={{ color: '#FF6B00', fontSize: 20 }} />;
      case 'promos':
        return <LocalOfferOutlinedIcon sx={{ color: '#FF6B00', fontSize: 20 }} />;
      case 'advisories':
        return <CampaignOutlinedIcon sx={{ color: '#FF6B00', fontSize: 20 }} />;
      default:
        return <NotificationsOutlinedIcon sx={{ color: '#FF6B00', fontSize: 20 }} />;
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
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
      {/* 1. Header (Matching Image 2: ProfileEditor square rounded back button card) */}
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
          onClick={onClose}
          aria-label="Close notifications"
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
          {language === "tl" ? "Mga Notification" : "Notifications"}
        </Typography>

        <Box sx={{ width: "44px" }} /> {/* spacer */}
      </DialogTitle>

      <DialogContent sx={{ p: 0, display: "flex", flexDirection: "column" }}>
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
                onClick={() => setActiveFilter(f.key as any)}
                sx={{
                  px: 1.75,
                  py: 0.25,
                  borderRadius: "999px",
                  fontSize: TYPOGRAPHY_TOKENS.fontSize.secondary,
                  fontWeight: isSelected ? TYPOGRAPHY_TOKENS.fontWeight.bold : TYPOGRAPHY_TOKENS.fontWeight.medium,
                  fontFamily: "Poppins, sans-serif",
                  backgroundColor: isSelected ? "#FF6B00" : "#F1F5F9",
                  color: isSelected ? "#FFFFFF" : "#64748B",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  transition: "all 0.18s ease",
                  height: "28px",
                  display: "flex",
                  alignItems: "center",
                  "&:hover": {
                    backgroundColor: isSelected ? "#E66000" : "#E2E8F0",
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
              onClick={onMarkAllAsRead}
              sx={{
                fontSize: TYPOGRAPHY_TOKENS.fontSize.secondary,
                fontWeight: TYPOGRAPHY_TOKENS.fontWeight.bold,
                color: "#FF6B00",
                textTransform: "none",
                p: "2px 4px",
                borderRadius: "6px",
                fontFamily: "Poppins, sans-serif",
                lineHeight: 1,
                whiteSpace: "nowrap",
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
                color: "#94A3B8",
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
              const time = language === "tl" ? item.timeTl : item.timeEn;

              return (
                <React.Fragment key={item.id}>
                  {index > 0 && <Divider sx={{ borderColor: "#F1F5F9" }} />}
                  <Box
                    onClick={() => {
                      if (!item.isRead) onMarkAsRead(item.id);
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
                          color: "#94A3B8",
                          fontFamily: "Poppins, sans-serif",
                        }}
                      >
                        {time}
                      </Typography>
                    </Box>

                    {/* Chevron right icon only for announcements / advisories */}
                    {item.category === "advisories" && (
                      <ChevronRightIcon sx={{ color: "#94A3B8", fontSize: 20, mt: 0.5, flexShrink: 0 }} />
                    )}
                  </Box>
                </React.Fragment>
              );
            })}
          </Box>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default NotificationsDialog;
