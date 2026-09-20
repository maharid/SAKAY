import React from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Box from "@mui/material/Box";
import Divider from "@mui/material/Divider";
import CloseIcon from "@mui/icons-material/Close";
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
  const { language, t } = useLanguage();
  const hasUnread = notifications.some((n) => !n.isRead);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      slotProps={{
        paper: {
          sx: {
            borderRadius: "20px",
            padding: "8px 4px",
            maxWidth: "380px",
            width: "92%",
            boxShadow: "0 20px 40px rgba(15, 23, 42, 0.18)",
          },
        },
      }}
    >
      <DialogTitle
        sx={{
          fontWeight: 800,
          fontSize: "16px",
          color: "#0F172A",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontFamily: "Poppins, sans-serif",
          pb: 1,
          px: 2,
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <NotificationsOutlinedIcon sx={{ color: "#FF6B00", fontSize: 22 }} />
          <span>{t.notificationsTitle}</span>
        </Box>
        <IconButton size="small" onClick={onClose} sx={{ color: "#64748B" }}>
          <CloseIcon sx={{ fontSize: 20 }} />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ px: 2, py: 1 }}>
        {hasUnread && (
          <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 1 }}>
            <Button
              size="small"
              onClick={onMarkAllAsRead}
              sx={{
                fontSize: "11.5px",
                fontWeight: 600,
                color: "#FF6B00",
                textTransform: "none",
                p: "2px 8px",
                borderRadius: "8px",
                "&:hover": { backgroundColor: "#FFF7ED" },
              }}
            >
              {t.markAllAsRead}
            </Button>
          </Box>
        )}

        {notifications.length === 0 ? (
          <Typography
            sx={{
              fontSize: "13px",
              color: "#94A3B8",
              textAlign: "center",
              py: 3,
              fontFamily: "Poppins, sans-serif",
            }}
          >
            {t.noNotifications}
          </Typography>
        ) : (
          <Box sx={{ display: "flex", flexDirection: "column" }}>
            {notifications.map((item, index) => {
              const title = language === "tl" ? item.titleTl : item.titleEn;
              const body = language === "tl" ? item.bodyTl : item.bodyEn;
              const time = language === "tl" ? item.timeTl : item.timeEn;

              return (
                <React.Fragment key={item.id}>
                  {index > 0 && <Divider sx={{ borderColor: "#F1F5F9", my: 0.5 }} />}
                  <Box
                    onClick={() => {
                      if (!item.isRead) onMarkAsRead(item.id);
                    }}
                    sx={{
                      py: 1.25,
                      px: 1,
                      borderRadius: "10px",
                      backgroundColor: item.isRead ? "transparent" : "#FFF7ED",
                      cursor: item.isRead ? "default" : "pointer",
                      transition: "background-color 0.2s ease",
                      "&:hover": {
                        backgroundColor: item.isRead ? "#F8FAFC" : "#FFEAD5",
                      },
                    }}
                  >
                    <Box sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "8px" }}>
                      <Box sx={{ display: "flex", alignItems: "center", gap: "6px" }}>
                        {!item.isRead && (
                          <Box
                            sx={{
                              width: "7px",
                              height: "7px",
                              borderRadius: "50%",
                              backgroundColor: "#FF6B00",
                              flexShrink: 0,
                            }}
                          />
                        )}
                        <Typography
                          sx={{
                            fontSize: "13px",
                            fontWeight: item.isRead ? 600 : 700,
                            color: "#0F172A",
                            fontFamily: "Poppins, sans-serif",
                            lineHeight: 1.3,
                          }}
                        >
                          {title}
                        </Typography>
                      </Box>
                      <Typography
                        sx={{
                          fontSize: "10.5px",
                          color: "#94A3B8",
                          whiteSpace: "nowrap",
                          fontFamily: "Poppins, sans-serif",
                          mt: "2px",
                        }}
                      >
                        {time}
                      </Typography>
                    </Box>

                    <Typography
                      sx={{
                        fontSize: "12px",
                        color: item.isRead ? "#64748B" : "#475569",
                        mt: 0.5,
                        pl: !item.isRead ? "13px" : "0px",
                        fontFamily: "Poppins, sans-serif",
                        lineHeight: 1.45,
                      }}
                    >
                      {body}
                    </Typography>
                  </Box>
                </React.Fragment>
              );
            })}
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 2, pb: 1, pt: 0.5 }}>
        <Button
          fullWidth
          variant="contained"
          onClick={onClose}
          sx={{
            backgroundColor: "#FF6B00",
            color: "#FFFFFF",
            borderRadius: "12px",
            fontWeight: 700,
            textTransform: "none",
            height: "40px",
            fontSize: "13.5px",
            fontFamily: "Poppins, sans-serif",
            boxShadow: "none",
            "&:hover": { backgroundColor: "#E66000", boxShadow: "none" },
          }}
        >
          {t.close}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default NotificationsDialog;
