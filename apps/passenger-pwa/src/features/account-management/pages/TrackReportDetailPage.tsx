import React, { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Alert from "@mui/material/Alert";
import CancelOutlinedIcon from "@mui/icons-material/CancelOutlined";

import PageHeader from "../../../common/components/PageHeader";
import { useLanguage } from "../../../utils/LanguageContext";
import { RegisterInput } from "../../../common/components/RegisterInput";
import { fetchMyIncidentReport, withdrawIncidentReport, incidentEvidenceFiles, type IncidentReportItem } from "../../../services/incidentService";

export const TrackReportDetailPage: React.FC = () => {
  const { language } = useLanguage();
  const navigate = useNavigate();
  const { reportId } = useParams<{ reportId: string }>();

  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelSuccess, setCancelSuccess] = useState(false);

  const [report, setReport] = useState<IncidentReportItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [evidenceUrls, setEvidenceUrls] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    if (!reportId) {
      setLoading(false);
      return;
    }
    fetchMyIncidentReport(reportId)
      .then((item) => alive && setReport(item))
      .catch((err) => alive && setLoadError(err instanceof Error ? err.message : String(err)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [reportId]);

  // Sign the attached photos when the report is opened (links last 10 minutes).
  useEffect(() => {
    let alive = true;
    const paths = report?.evidencePaths ?? [];
    if (paths.length === 0) {
      setEvidenceUrls([]);
      return;
    }
    incidentEvidenceFiles(paths).then((files) => alive && setEvidenceUrls(files.map((f) => f.url)));
    return () => {
      alive = false;
    };
  }, [report?.evidencePaths]);

  const handleConfirmCancel = async () => {
    if (!report || !cancelReason.trim() || cancelling) return;
    setCancelling(true);
    setCancelError(null);
    try {
      await withdrawIncidentReport(report.id, cancelReason);
    } catch (err) {
      setCancelError(err instanceof Error ? err.message : String(err));
      setCancelling(false);
      return;
    }
    setCancelling(false);
    setReport({ ...report, status: "Cancelled", cancellationReason: cancelReason.trim() });
    setCancelModalOpen(false);
    setCancelSuccess(true);
  };

  // Only a report nobody has started reviewing can be withdrawn (the database enforces it too).
  const canCancel = report?.status === "Submitted";

  const getStatusChipProps = (status: string) => {
    switch (status) {
      case "Resolved":
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

  if (loading) {
    return (
      <Box sx={{ width: "100%", height: "100%", backgroundColor: "#FAFAFA", display: "flex", flexDirection: "column" }}>
        <PageHeader title={language === "tl" ? "Detalye ng Ulat" : "Report Details"} onBack={() => navigate("/track-reports")} />
        <Box sx={{ p: 4, textAlign: "center" }}>
          <Typography sx={{ fontSize: "13px", color: "#64748B", fontFamily: "Poppins, sans-serif" }}>
            {language === "tl" ? "Kinukuha ang ulat..." : "Loading the report..."}
          </Typography>
        </Box>
      </Box>
    );
  }

  if (!report) {
    return (
      <Box sx={{ width: "100%", height: "100%", backgroundColor: "#FAFAFA", display: "flex", flexDirection: "column" }}>
        <PageHeader title={language === "tl" ? "Detalye ng Ulat" : "Report Details"} onBack={() => navigate("/track-reports")} />
        <Box sx={{ p: 4, textAlign: "center" }}>
          <Typography sx={{ fontSize: "14px", color: "#64748B", fontFamily: "Poppins, sans-serif" }}>
            {loadError || (language === "tl" ? "Hindi nahanap ang ulat." : "Report not found.")}
          </Typography>
        </Box>
      </Box>
    );
  }

  const chipProps = getStatusChipProps(report.status);

  return (
    <Box sx={{ width: "100%", height: "100%", backgroundColor: "#FAFAFA", display: "flex", flexDirection: "column" }}>
      <PageHeader
        title={language === "tl" ? "Detalye ng Ulat" : "Report Details"}
        onBack={() => navigate("/track-reports")}
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
        {cancelSuccess && (
          <Alert severity="info" sx={{ borderRadius: "14px", fontSize: "12px", fontFamily: "Poppins, sans-serif" }}>
            {language === "tl" ? "Matagumpay na nakansela ang iyong ulat." : "Report has been successfully cancelled."}
          </Alert>
        )}

        {/* Report ID & Status Header */}
        <Paper
          elevation={0}
          sx={{
            p: 2,
            borderRadius: "16px",
            backgroundColor: "#FFFFFF",
            border: "1px solid #F1F5F9",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Box>
            <Typography sx={{ fontSize: "11px", fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.5px" }}>
              {language === "tl" ? "Reference ID" : "Reference ID"}
            </Typography>
            <Typography sx={{ fontSize: "16px", fontWeight: 800, color: "#0F172A", fontFamily: "Poppins, sans-serif" }}>
              {report.id}
            </Typography>
          </Box>
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
        </Paper>

        {/* Incident Summary Card */}
        <Paper
          elevation={0}
          sx={{
            p: 2,
            borderRadius: "16px",
            backgroundColor: "#FFFFFF",
            border: "1px solid #F1F5F9",
            display: "flex",
            flexDirection: "column",
            gap: 1.5,
          }}
        >
          <Box>
            <Typography sx={{ fontSize: "11px", color: "#94A3B8", fontWeight: 700, textTransform: "uppercase" }}>
              {language === "tl" ? "Kategorya" : "Category"}
            </Typography>
            <Typography sx={{ fontSize: "14px", fontWeight: 700, color: "#FF6B00", fontFamily: "Poppins, sans-serif", mt: 0.25 }}>
              {report.incidentType}
            </Typography>
          </Box>

          <Box>
            <Typography sx={{ fontSize: "11px", color: "#94A3B8", fontWeight: 700, textTransform: "uppercase" }}>
              {language === "tl" ? "Inirereklamong Biyahe & Petsa" : "Reported Trip & Date"}
            </Typography>
            <Typography sx={{ fontSize: "13px", fontWeight: 600, color: "#0F172A", fontFamily: "Poppins, sans-serif", mt: 0.25 }}>
              {report.tripSummary} • {report.submittedAt}
            </Typography>
          </Box>

          <Box>
            <Typography sx={{ fontSize: "11px", color: "#94A3B8", fontWeight: 700, textTransform: "uppercase" }}>
              {language === "tl" ? "Detalyadong Salaysay" : "Detailed Narrative"}
            </Typography>
            <Typography sx={{ fontSize: "13px", color: "#334155", fontFamily: "Poppins, sans-serif", mt: 0.5, lineHeight: 1.45 }}>
              {report.description}
            </Typography>
          </Box>
        </Paper>

        {/* Attached photo evidence */}
        {evidenceUrls.length > 0 && (
          <Paper elevation={0} sx={{ p: 2, borderRadius: "16px", backgroundColor: "#FFFFFF", border: "1px solid #F1F5F9", display: "flex", flexDirection: "column", gap: 1 }}>
            <Typography sx={{ fontSize: "11px", color: "#94A3B8", fontWeight: 700, textTransform: "uppercase" }}>
              {language === "tl" ? "Naka-attach na Larawan" : "Attached Photo"}
            </Typography>
            <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
              {evidenceUrls.map((url) => (
                <Box
                  key={url}
                  component="a"
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  sx={{ display: "block", lineHeight: 0 }}
                >
                  <Box component="img" src={url} alt="Evidence" sx={{ width: 96, height: 96, objectFit: "cover", borderRadius: "12px", border: "1px solid #E2E8F0" }} />
                </Box>
              ))}
            </Box>
          </Paper>
        )}

        {/* Official LGU / TODA Response */}
        {report.officialResponse && (
          <Paper
            elevation={0}
            sx={{
              p: 2,
              borderRadius: "16px",
              backgroundColor: "#EFF6FF",
              border: "1px solid #BFDBFE",
              display: "flex",
              flexDirection: "column",
              gap: 0.75,
            }}
          >
            <Typography sx={{ fontSize: "11px", color: "#1D4ED8", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px" }}>
              {language === "tl" ? "Tugon mula sa LGU & TODA" : "Official LGU & TODA Response"}
            </Typography>
            <Typography sx={{ fontSize: "13px", color: "#1E3A8A", fontFamily: "Poppins, sans-serif", lineHeight: 1.45 }}>
              {report.officialResponse}
            </Typography>
          </Paper>
        )}

        {/* Cancellation Reason if Cancelled */}
        {report.cancellationReason && (
          <Paper
            elevation={0}
            sx={{
              p: 2,
              borderRadius: "16px",
              backgroundColor: "#FEF2F2",
              border: "1px solid #FECACA",
              display: "flex",
              flexDirection: "column",
              gap: 0.75,
            }}
          >
            <Typography sx={{ fontSize: "11px", color: "#DC2626", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px" }}>
              {language === "tl" ? "Dahilan ng Pagkakansela" : "Cancellation Reason"}
            </Typography>
            <Typography sx={{ fontSize: "13px", color: "#991B1B", fontFamily: "Poppins, sans-serif", lineHeight: 1.45 }}>
              {report.cancellationReason}
            </Typography>
          </Paper>
        )}

        {/* Cancel Report Action Button */}
        {canCancel && (
          <Button
            fullWidth
            variant="outlined"
            onClick={() => setCancelModalOpen(true)}
            startIcon={<CancelOutlinedIcon />}
            sx={{
              borderColor: "#EF4444",
              color: "#EF4444",
              borderRadius: "14px",
              height: "46px",
              fontSize: "14px",
              fontWeight: 700,
              textTransform: "none",
              fontFamily: "Poppins, sans-serif",
              mt: 1,
              "&:hover": { borderColor: "#DC2626", backgroundColor: "#FEF2F2" },
            }}
          >
            {language === "tl" ? "Kanselahin ang Ulat" : "Cancel Report"}
          </Button>
        )}
      </Box>

      {/* Cancellation Confirmation Modal */}
      <Dialog
        open={cancelModalOpen}
        onClose={() => setCancelModalOpen(false)}
        slotProps={{
          paper: { sx: { borderRadius: "20px", p: 1, width: "92%", maxWidth: "380px" } },
        }}
      >
        <DialogTitle sx={{ fontWeight: 700, fontSize: "16px", color: "#0F172A", fontFamily: "Poppins, sans-serif" }}>
          {language === "tl" ? "Kanselahin ang Ulat" : "Cancel Incident Report"}
        </DialogTitle>
        <DialogContent sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 1 }}>
          <Typography sx={{ fontSize: "12.5px", color: "#64748B", fontFamily: "Poppins, sans-serif" }}>
            {language === "tl"
              ? "Sigurado ka bang nais mong kanselahin ang ulat na ito? Pakisulat ang dahilan."
              : "Are you sure you want to cancel this report? Please state your reason."}
          </Typography>

          {cancelError && (
            <Alert severity="error" sx={{ borderRadius: "12px", fontSize: "12px", fontFamily: "Poppins, sans-serif" }}>
              {cancelError}
            </Alert>
          )}

          <RegisterInput
            label={language === "tl" ? "Dahilan ng Pagkakansela" : "Reason for Cancellation"}
            value={cancelReason}
            onChange={(val) => setCancelReason(val)}
            multiline
            rows={2}
            required
            placeholder={
              language === "tl"
                ? "hal. Naresolba na nang maayos sa drayber..."
                : "e.g. Resolved directly with driver..."
            }
          />
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setCancelModalOpen(false)} sx={{ color: "#64748B", fontFamily: "Poppins, sans-serif" }}>
            {language === "tl" ? "Bumalik" : "Back"}
          </Button>
          <Button
            onClick={handleConfirmCancel}
            variant="contained"
            disabled={!cancelReason.trim() || cancelling}
            sx={{
              backgroundColor: "#EF4444",
              color: "#FFFFFF",
              borderRadius: "12px",
              fontWeight: 700,
              textTransform: "none",
              boxShadow: "none",
              fontFamily: "Poppins, sans-serif",
              "&:hover": { backgroundColor: "#DC2626", boxShadow: "none" },
            }}
          >
            {language === "tl" ? "Kumpirmahin ang Pagkakansela" : "Confirm Cancel"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default TrackReportDetailPage;
