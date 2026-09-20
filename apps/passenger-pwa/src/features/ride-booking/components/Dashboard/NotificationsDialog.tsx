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
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import DirectionsCarOutlinedIcon from "@mui/icons-material/DirectionsCarOutlined";
import LocalOfferOutlinedIcon from "@mui/icons-material/LocalOfferOutlined";
import CampaignOutlinedIcon from "@mui/icons-material/CampaignOutlined";
import NotificationsOutlinedIcon from "@mui/icons-material/NotificationsOutlined";

import { useLanguage } from "../../../../utils/LanguageContext";

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
        return <DirectionsCarOutlinedIcon sx={{ color: '#FF6B00', fontSize: 16 }} />;
      case 'promos':
        return <LocalOfferOutlinedIcon sx={{ color: '#FF6B00', fontSize: 16 }} />;
      case 'advisories':
        return <CampaignOutlinedIcon sx={{ color: '#FF6B00', fontSize: 16 }} />;
      default:
        return <NotificationsOutlinedIcon sx={{ color: '#FF6B00', fontSize: 16 }} />;
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
      {/* 1. Sleek Top Header: Back Arrow + Centered 20px Title */}
      <DialogTitle
        sx={{
          fontWeight: 700,
          fontSize: "20px",
          color: "#0F172A",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontFamily: "Poppins, sans-serif",
          py: 1.25,
          px: 2,
          borderBottom: "1px solid #F1F5F9",
          position: "relative",
          minHeight: "52px",
        }}
      >
        <IconButton onClick={onClose} edge="start" sx={{ color: "#0F172A", p: 0.5 }}>
          <ArrowBackIcon sx={{ fontSize: 22 }} />
        </IconButton>

        <Typography
          sx={{
            fontSize: "20px",
            fontWeight: 700,
            color: "#0F172A",
            fontFamily: "Poppins, sans-serif",
            position: "absolute",
            left: "50%",
            transform: "translateX(-50%)",
          }}
        >
          {language === "tl" ? "Mga Notification" : "Notifications"}
        </Typography>

        <Box sx={{ width: 32 }} />
      </DialogTitle>

      <DialogContent sx={{ p: 0, display: "flex", flexDirection: "column" }}>
        {/* 2. Sleek Filter Pills (32px height, 13.5px font size) */}
        <Box
          className="hide-scrollbar"
          sx={{
            display: "flex",
            gap: 1,
            px: 2,
            py: 1.25,
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
                  py: 0.4,
                  borderRadius: "999px",
                  fontSize: "13.5px",
                  fontWeight: isSelected ? 700 : 500,
                  fontFamily: "Poppins, sans-serif",
                  backgroundColor: isSelected ? "#FF6B00" : "#F1F5F9",
                  color: isSelected ? "#FFFFFF" : "#64748B",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  transition: "all 0.18s ease",
                  height: "32px",
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

        {/* 3. Compact Unread Section Header (15px heading, 13.5px single-line action) */}
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            px: 2,
            pt: 1.5,
            pb: 0.75,
          }}
        >
          <Typography
            sx={{
              fontSize: "15px",
              fontWeight: 700,
              color: "#0F172A",
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
                fontSize: "13.5px",
                fontWeight: 600,
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

        {/* 4. Compact Notification List Rows (py: 1, 32x32 icon, 14px title, 13.5px body, 12px caption) */}
        {filteredNotifications.length === 0 ? (
          <Box sx={{ p: 4, textAlign: "center" }}>
            <Typography
              sx={{
                fontSize: "13.5px",
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
                      py: 1,
                      px: 2,
                      display: "flex",
                      alignItems: "center",
                      gap: 1.25,
                      backgroundColor: item.isRead ? "#FFFFFF" : "#FFF7ED",
                      cursor: "pointer",
                      transition: "background-color 0.15s ease",
                      "&:hover": {
                        backgroundColor: item.isRead ? "#F8FAFC" : "#FFEAD5",
                      },
                    }}
                  >
                    {/* Category Icon Badge (32x32px) */}
                    <Box
                      sx={{
                        width: 32,
                        height: 32,
                        borderRadius: "50%",
                        backgroundColor: "#FFF2E9",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      {getCategoryIcon(item.category)}
                    </Box>

                    {/* Title (14px 600), Body (13.5px 400), Timestamp (12px caption) */}
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 0.2 }}>
                        <Typography
                          sx={{
                            fontSize: "14px",
                            fontWeight: item.isRead ? 600 : 700,
                            color: "#0F172A",
                            fontFamily: "Poppins, sans-serif",
                            lineHeight: 1.25,
                          }}
                        >
                          {title}
                        </Typography>

                        {!item.isRead && (
                          <Box
                            sx={{
                              width: 7,
                              height: 7,
                              borderRadius: "50%",
                              backgroundColor: "#FF6B00",
                              flexShrink: 0,
                            }}
                          />
                        )}
                      </Box>

                      <Typography
                        sx={{
                          fontSize: "13.5px",
                          fontWeight: 400,
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
                          fontSize: "12px",
                          fontWeight: 400,
                          color: "#94A3B8",
                          fontFamily: "Poppins, sans-serif",
                        }}
                      >
                        {time}
                      </Typography>
                    </Box>

                    {/* Right Chevron */}
                    <ChevronRightIcon sx={{ color: "#CBD5E1", fontSize: 18, flexShrink: 0 }} />
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
