import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import TrackChangesOutlinedIcon from "@mui/icons-material/TrackChangesOutlined";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";

import PageHeader from "../../../common/components/PageHeader";
import { useLanguage } from "../../../utils/LanguageContext";

export interface IncidentReportItem {
  id: string;
  incidentType: string;
  franchiseNo: string;
  description: string;
  status: "Submitted" | "Under Investigation (LGU & TODA)" | "Resolved" | "Action Taken";
  submittedAt: string;
  officialResponse?: string;
}

const STORAGE_KEY = "sakay_passenger_incident_reports";

const TrackReportsPage: React.FC = () => {
  const { language } = useLanguage();
  const navigate = useNavigate();

  const [selectedReport, setSelectedReport] = useState<IncidentReportItem | null>(null);

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

  const getStatusChipProps = (status: string) => {
    switch (status) {
      case "Resolved":
      case "Action Taken":
        return { backgroundColor: "#E6F4EA", color: "#10B981" };
      case "Under Investigation (LGU & TODA)":
        return { backgroundColor: "#FEF3C7", color: "#D97706" };
      default:
        return { backgroundColor: "#F1F5F9", color: "#64748B" };
    }
  };

  return (
    <Box
      sx={{
        width: "100%",
        height: "100%",
        backgroundColor: "#FAFAFA",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <PageHeader
        title={language === "tl" ? "Subaybayan ang Ulat" : "Track Reports"}
        onBack={() => navigate("/support")}
      />

      <Box
        className="hide-scrollbar"
        sx={{
          flexGrow: 1,
          overflowY: "auto",
          p: 2.5,
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        <Button
          fullWidth
          variant="contained"
          onClick={() => navigate("/incident-report")}
          sx={{
            backgroundColor: "#FF6B00",
            color: "#FFFFFF",
            borderRadius: "14px",
            height: "46px",
            fontSize: "14px",
            fontWeight: 700,
            textTransform: "none",
            fontFamily: "Poppins, sans-serif",
            boxShadow: "none",
            "&:hover": { backgroundColor: "#E66000", boxShadow: "none" },
          }}
        >
          {language === "tl" ? "+ Magsumite ng Bagong Reklamo" : "+ Submit New Incident Report"}
        </Button>

        {reports.length === 0 ? (
          <Paper
            elevation={0}
            sx={{
              p: 4,
              textAlign: "center",
              borderRadius: "20px",
              backgroundColor: "#FFFFFF",
              border: "1px solid #F1F5F9",
              mt: 2,
            }}
          >
            <TrackChangesOutlinedIcon sx={{ fontSize: 48, color: "#CBD5E1", mb: 1 }} />
            <Typography sx={{ fontSize: "15px", fontWeight: 700, color: "#0F172A", fontFamily: "Poppins, sans-serif" }}>
              {language === "tl" ? "Wala pang naipasa na ulat" : "No reports submitted yet"}
            </Typography>
            <Typography sx={{ fontSize: "13px", color: "#64748B", mt: 0.5, fontFamily: "Poppins, sans-serif" }}>
              {language === "tl"
                ? "Dito mo makikita ang status ng iyong mga isinumitang reklamo sa LGU."
                : "Your submitted incident reports and official LGU responses will appear here."}
            </Typography>
          </Paper>
        ) : (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
            {reports.map((report) => {
              const chipProps = getStatusChipProps(report.status);
              return (
                <Paper
                  key={report.id}
                  elevation={0}
                  onClick={() => setSelectedReport(report)}
                  sx={{
                    p: 2,
                    borderRadius: "16px",
                    backgroundColor: "#FFFFFF",
                    border: "1px solid #F1F5F9",
                    cursor: "pointer",
                    boxShadow: "0 2px 10px rgba(0,0,0,0.03)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 1.5,
                    transition: "transform 0.15s ease",
                    "&:active": { transform: "scale(0.99)" },
                  }}
                >
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
                      <Typography sx={{ fontSize: "13px", fontWeight: 700, color: "#0F172A", fontFamily: "Poppins, sans-serif" }}>
                        {report.id}
                      </Typography>
                      <Chip
                        label={report.status}
                        size="small"
                        sx={{
                          fontSize: "11px",
                          fontWeight: 700,
                          fontFamily: "Poppins, sans-serif",
                          ...chipProps,
                        }}
                      />
                    </Box>

                    <Typography sx={{ fontSize: "13px", fontWeight: 600, color: "#FF6B00", fontFamily: "Poppins, sans-serif" }}>
                      {report.incidentType}
                    </Typography>

                    <Typography sx={{ fontSize: "12px", color: "#64748B", fontFamily: "Poppins, sans-serif", mt: 0.25 }}>
                      Unit: <strong>{report.franchiseNo}</strong> • {report.submittedAt}
                    </Typography>
                  </Box>

                  <ChevronRightIcon sx={{ color: "#94A3B8", fontSize: 20 }} />
                </Paper>
              );
            })}
          </Box>
        )}
      </Box>

      {/* Report Detail Modal */}
      <Dialog
        open={Boolean(selectedReport)}
        onClose={() => setSelectedReport(null)}
        slotProps={{
          paper: { sx: { borderRadius: "20px", p: 1, width: "90%", maxWidth: "380px" } },
        }}
      >
        {selectedReport && (
          <>
            <DialogTitle sx={{ fontWeight: 700, fontSize: "16px", color: "#0F172A", fontFamily: "Poppins, sans-serif" }}>
              {language === "tl" ? "Detalye ng Ulat" : "Report Details"} — {selectedReport.id}
            </DialogTitle>
            <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <Typography sx={{ fontSize: "12px", color: "#64748B", fontFamily: "Poppins, sans-serif" }}>
                  {language === "tl" ? "Petsa ng Pagpasa:" : "Date Submitted:"} <strong>{selectedReport.submittedAt}</strong>
                </Typography>
                <Chip
                  label={selectedReport.status}
                  size="small"
                  sx={{
                    fontSize: "11px",
                    fontWeight: 700,
                    fontFamily: "Poppins, sans-serif",
                    ...getStatusChipProps(selectedReport.status),
                  }}
                />
              </Box>

              <Box sx={{ p: 1.5, borderRadius: "12px", backgroundColor: "#F8FAFC", border: "1px solid #E2E8F0" }}>
                <Typography sx={{ fontSize: "11px", color: "#94A3B8", fontWeight: 700, textTransform: "uppercase" }}>
                  {language === "tl" ? "Kategorya at Inirereklamong Unit" : "Category & Reported Unit"}
                </Typography>
                <Typography sx={{ fontSize: "13px", fontWeight: 700, color: "#0F172A", mt: 0.25 }}>
                  {selectedReport.incidentType} ({selectedReport.franchiseNo})
                </Typography>
              </Box>

              <Box sx={{ p: 1.5, borderRadius: "12px", backgroundColor: "#F8FAFC", border: "1px solid #E2E8F0" }}>
                <Typography sx={{ fontSize: "11px", color: "#94A3B8", fontWeight: 700, textTransform: "uppercase" }}>
                  {language === "tl" ? "Salaysay ng Insidente" : "Narrative"}
                </Typography>
                <Typography sx={{ fontSize: "12px", color: "#334155", mt: 0.5, lineHeight: 1.4 }}>
                  {selectedReport.description}
                </Typography>
              </Box>

              {selectedReport.officialResponse && (
                <Box sx={{ p: 1.5, borderRadius: "12px", backgroundColor: "#EFF6FF", border: "1px solid #BFDBFE" }}>
                  <Typography sx={{ fontSize: "11px", color: "#1D4ED8", fontWeight: 700, textTransform: "uppercase" }}>
                    {language === "tl" ? "Tugon mula sa LGU & TODA" : "Official LGU & TODA Response"}
                  </Typography>
                  <Typography sx={{ fontSize: "12px", color: "#1E3A8A", mt: 0.5, lineHeight: 1.4 }}>
                    {selectedReport.officialResponse}
                  </Typography>
                </Box>
              )}
            </DialogContent>
            <DialogActions sx={{ px: 2, pb: 2 }}>
              <Button
                fullWidth
                variant="contained"
                onClick={() => setSelectedReport(null)}
                sx={{
                  backgroundColor: "#FF6B00",
                  color: "#FFFFFF",
                  borderRadius: "12px",
                  fontWeight: 700,
                  textTransform: "none",
                  boxShadow: "none",
                  "&:hover": { backgroundColor: "#E66000", boxShadow: "none" },
                }}
              >
                {language === "tl" ? "Isara" : "Close"}
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </Box>
  );
};

export default TrackReportsPage;
