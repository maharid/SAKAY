import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import TrackChangesOutlinedIcon from "@mui/icons-material/TrackChangesOutlined";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ReportProblemOutlinedIcon from "@mui/icons-material/ReportProblemOutlined";

import PageHeader from "../../../common/components/PageHeader";
import { useLanguage } from "../../../utils/LanguageContext";
import type { IncidentReportItem } from "./TrackReportDetailPage";

const STORAGE_KEY = "sakay_passenger_incident_reports";

const TrackReportsPage: React.FC = () => {
  const { language } = useLanguage();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<"all" | "pending" | "resolved" | "cancelled">("all");

  const getReports = (): IncidentReportItem[] => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored
        ? JSON.parse(stored)
        : [
            {
              id: "INC-2026-9041",
              incidentType: "Overcharging Attempt",
              franchiseNo: "CAL-2025-0104",
              description: "Nanghingi ng sobrang ₱20 lampas sa taripa mula Calapan Port hanggang City Hall.",
              status: "Under Investigation (LGU & TODA)",
              submittedAt: "Aug 13, 2026",
              officialResponse: "Naipasa na ang reklamong ito sa TODA Grievance Committee. Ang drayber ay ipinatawag sa City Transport Office.",
            },
            {
              id: "INC-2026-8812",
              incidentType: "Rude Behavior",
              franchiseNo: "TODA-452",
              description: "Bastos at hindi nagbigay ng sukli nang maayos.",
              status: "Resolved",
              submittedAt: "Jul 28, 2026",
              officialResponse: "Ang drayber ay nagbigay ng opisyal na paumanhin at binigyan ng warning ticket ng LGU.",
            },
          ];
    } catch {
      return [];
    }
  };

  const reports = getReports();

  const filteredReports = reports.filter((r) => {
    if (activeTab === "all") return true;
    if (activeTab === "pending") return r.status === "Submitted" || r.status === "Under Investigation (LGU & TODA)";
    if (activeTab === "resolved") return r.status === "Resolved" || r.status === "Action Taken";
    if (activeTab === "cancelled") return r.status === "Cancelled";
    return true;
  });

  const getStatusChipProps = (status: string) => {
    switch (status) {
      case "Resolved":
      case "Action Taken":
        return { backgroundColor: "#ECFDF5", color: "#10B981" };
      case "Under Investigation (LGU & TODA)":
      case "Submitted":
        return { backgroundColor: "#FEF3C7", color: "#D97706" };
      case "Cancelled":
        return { backgroundColor: "#FEF2F2", color: "#EF4444" };
      default:
        return { backgroundColor: "#F1F5F9", color: "#64748B" };
    }
  };

  return (
    <Box
      sx={{
        width: "100%",
        height: "100%",
        backgroundColor: "#FFFFFF",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <PageHeader
        title={language === "tl" ? "Subaybayan ang Ulat" : "Track Reports"}
        onBack={() => navigate("/support")}
      />

      {/* History-Style Segmented Pill Tabs */}
      <Box sx={{ px: 2, pt: 1.5, pb: 0.5, backgroundColor: "#FFFFFF" }}>
        <Box
          sx={{
            display: "flex",
            backgroundColor: "#F1F5F9",
            borderRadius: "14px",
            p: 0.5,
            gap: 0.5,
          }}
        >
          {[
            { key: "all", labelTl: "Lahat", labelEn: "All" },
            { key: "pending", labelTl: "Imbestigasyon", labelEn: "Pending" },
            { key: "resolved", labelTl: "Naresolba", labelEn: "Resolved" },
            { key: "cancelled", labelTl: "Kanselado", labelEn: "Cancelled" },
          ].map((tab) => {
            const isSelected = activeTab === tab.key;
            return (
              <Button
                key={tab.key}
                fullWidth
                disableRipple
                onClick={() => setActiveTab(tab.key as any)}
                sx={{
                  py: 0.75,
                  px: 0.5,
                  borderRadius: "10px",
                  fontSize: "12px",
                  fontWeight: isSelected ? 700 : 500,
                  fontFamily: "Poppins, sans-serif",
                  textTransform: "none",
                  backgroundColor: isSelected ? "#FFFFFF" : "transparent",
                  color: isSelected ? "#FF6B00" : "#64748B",
                  boxShadow: isSelected ? "0 2px 8px rgba(0,0,0,0.06)" : "none",
                  whiteSpace: "nowrap",
                  minWidth: 0,
                  "&:hover": { backgroundColor: isSelected ? "#FFFFFF" : "rgba(0,0,0,0.02)" },
                }}
              >
                {language === "tl" ? tab.labelTl : tab.labelEn}
              </Button>
            );
          })}
        </Box>
      </Box>

      {/* Flat Notification-Style List with Dividers */}
      <Box
        className="hide-scrollbar"
        sx={{
          flexGrow: 1,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {filteredReports.length === 0 ? (
          <Box sx={{ p: 4, textAlign: "center" }}>
            <TrackChangesOutlinedIcon sx={{ fontSize: 48, color: "#CBD5E1", mb: 1 }} />
            <Typography sx={{ fontSize: "14px", fontWeight: 700, color: "#0F172A", fontFamily: "Poppins, sans-serif" }}>
              {language === "tl" ? "Wala pang ulat sa kategoryang ito" : "No reports in this category"}
            </Typography>
            <Button
              variant="contained"
              onClick={() => navigate("/incident-report")}
              sx={{
                mt: 2,
                backgroundColor: "#FF6B00",
                color: "#FFFFFF",
                borderRadius: "12px",
                height: "40px",
                fontSize: "13px",
                fontWeight: 700,
                textTransform: "none",
                fontFamily: "Poppins, sans-serif",
                boxShadow: "none",
                "&:hover": { backgroundColor: "#E66000", boxShadow: "none" },
              }}
            >
              {language === "tl" ? "+ Magsumite ng Reklamo" : "+ Submit Report"}
            </Button>
          </Box>
        ) : (
          <Box sx={{ display: "flex", flexDirection: "column" }}>
            {filteredReports.map((report, idx) => {
              const chipProps = getStatusChipProps(report.status);
              return (
                <React.Fragment key={report.id}>
                  {idx > 0 && <Divider sx={{ borderColor: "#F1F5F9" }} />}
                  <Box
                    onClick={() => navigate(`/track-reports/${report.id}`)}
                    sx={{
                      py: 1.75,
                      px: 2.5,
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 1.5,
                      backgroundColor: "#FFFFFF",
                      cursor: "pointer",
                      transition: "background-color 0.15s ease",
                      "&:hover": { backgroundColor: "#F8FAFC" },
                    }}
                  >
                    {/* Category Icon Badge */}
                    <Box
                      sx={{
                        width: 40,
                        height: 40,
                        borderRadius: "50%",
                        backgroundColor: "#FFF2E9",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                        mt: 0.25,
                      }}
                    >
                      <ReportProblemOutlinedIcon sx={{ color: "#FF6B00", fontSize: 20 }} />
                    </Box>

                    {/* Report Content Hierarchy */}
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, mb: 0.25 }}>
                        <Typography sx={{ fontSize: "13px", fontWeight: 700, color: "#0F172A", fontFamily: "Poppins, sans-serif" }}>
                          {report.id}
                        </Typography>
                        <Chip
                          label={report.status}
                          size="small"
                          sx={{
                            fontSize: "10.5px",
                            fontWeight: 700,
                            fontFamily: "Poppins, sans-serif",
                            height: "22px",
                            ...chipProps,
                          }}
                        />
                      </Box>

                      <Typography
                        sx={{
                          fontSize: "13px",
                          fontWeight: 600,
                          color: "#FF6B00",
                          fontFamily: "Poppins, sans-serif",
                          lineHeight: 1.25,
                          mb: 0.25,
                        }}
                      >
                        {report.incidentType}
                      </Typography>

                      <Typography
                        sx={{
                          fontSize: "12px",
                          color: "#64748B",
                          fontFamily: "Poppins, sans-serif",
                          lineHeight: 1.35,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          mb: 0.25,
                        }}
                      >
                        Unit: <strong>{report.franchiseNo}</strong> • {report.description}
                      </Typography>

                      <Typography sx={{ fontSize: "11px", color: "#94A3B8", fontFamily: "Poppins, sans-serif" }}>
                        {report.submittedAt}
                      </Typography>
                    </Box>

                    <ChevronRightIcon sx={{ color: "#94A3B8", fontSize: 20, mt: 1, flexShrink: 0 }} />
                  </Box>
                </React.Fragment>
              );
            })}
          </Box>
        )}
      </Box>

      {/* Floating Add Report Button */}
      <Box sx={{ p: 2, borderTop: "1px solid #F1F5F9", backgroundColor: "#FFFFFF" }}>
        <Button
          fullWidth
          variant="contained"
          onClick={() => navigate("/incident-report")}
          sx={{
            backgroundColor: "#FF6B00",
            color: "#FFFFFF",
            borderRadius: "14px",
            height: "44px",
            fontSize: "13.5px",
            fontWeight: 700,
            textTransform: "none",
            fontFamily: "Poppins, sans-serif",
            boxShadow: "none",
            "&:hover": { backgroundColor: "#E66000", boxShadow: "none" },
          }}
        >
          {language === "tl" ? "+ Magsumite ng Bagong Reklamo" : "+ Submit New Incident Report"}
        </Button>
      </Box>
    </Box>
  );
};

export default TrackReportsPage;
