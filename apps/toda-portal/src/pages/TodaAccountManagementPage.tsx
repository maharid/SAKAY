import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  Button,
  TextField,
  Avatar,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  IconButton,
  CircularProgress,
  Divider,
  Snackbar,
  Alert,
} from '@mui/material';
import BusinessIcon from '@mui/icons-material/Business';
import GroupsIcon from '@mui/icons-material/Groups';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import EditIcon from '@mui/icons-material/Edit';
import FolderOpenOutlinedIcon from '@mui/icons-material/FolderOpenOutlined';
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';

import { calculateDistanceKm } from '@sakay/shared';

import type { TodaChangeRequest, TodaProfile } from '../types/toda';
import { MacCenterModal } from '../components/admin/MacCenterModal';
import { DocumentReviewModal } from '../components/modals/DocumentReviewModal';
import { TerminalMapPickerModal } from '../components/modals/TerminalMapPickerModal';
import { RosterUpdateDialog } from '../components/modals/RosterUpdateDialog';
import { AccreditationCard } from '../components/common/AccreditationCard';
import { PendingChangesList } from '../components/common/PendingChangesList';
import { ComplianceDocumentCard } from '../components/common/ComplianceDocumentCard';
import { StatusPill } from '../components/common/DataTable';
import { InfoItem, SectionCard } from '../components/common/SectionCard';
import { primaryButtonSx, secondaryButtonSx } from '../components/common/pageButtons';
import { OPS_BORDER, OPS_TEXT, opsCardSx } from '../components/operations/operationsTheme';
import {
  fetchTodaProfile,
  updateTodaProfile,
  fetchTodaChangeRequests,
  withdrawTodaChangeRequest,
  recordTodaAuditAction,
  uploadTodaDocument,
  updateTodaComplianceDocument,
  resubmitTodaApplication,
} from '../services/todaApiService';
import { complianceDocumentStatus, submittedDateOfStoredFile } from '../utils/accreditation';
import { useAuth } from '../contexts/AuthContext';
import { FONT, SHELL, SPACE } from '../styles/density';
import { SakayToast } from '../components/common/SakayToast';

// the heading of a group of fields inside a form window
const FormSectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <Typography component="h3" sx={{ fontSize: FONT.heading, fontWeight: 700, color: OPS_TEXT.brand, mb: '13px' }}>{children}</Typography>
);

const CALAPAN_BARANGAYS = [
  'Balingayan', 'Balite', 'Baruyan', 'Batino', 'Bayanan I', 'Bayanan II', 'Biga', 'Bondoc', 'Bucayao', 'Buhuan',
  'Bulusan', 'Calero', 'Camansihan', 'Camilmil', 'Canubing I', 'Canubing II', 'Comunal', 'Guinobatan', 'Gulod',
  'Gutad', 'Ibaba East', 'Ibaba West', 'Ilaya', 'Lalud', 'Lazareto', 'Lumangbayan', 'Mahlabang', 'Malad',
  'Malamig', 'Managpi', 'Masipit', 'Navotas', 'Pachoca', 'Palhi', 'Panggalaan', 'Parang', 'Patas', 'Personas',
  'Puting Tubig', 'San Antonio', 'San Vicente Central', 'San Vicente East', 'San Vicente North', 'San Vicente South',
  'San Vicente West', 'Sapul', 'Silonay', 'Sta. Cruz', 'Sta. Isabel', 'Sta. Maria Village', 'Suqui', 'Tawiran', 'Tibag', 'Wawa'
].sort();

const formatPhoneNumber = (value: string): string => {
  const digits = value.replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 4) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 4)} ${digits.slice(4)}`;
  return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7, 11)}`;
};

const formatDisplayDate = (dateStr?: string | null): string => {
  if (!dateStr) return 'N/A';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  } catch {
    return dateStr;
  }
};

export const TodaAccountManagementPage: React.FC = () => {
  const { todaAdminProfile } = useAuth();
  const targetTodaId = todaAdminProfile?.toda_id;

  const [profile, setProfile] = useState<TodaProfile | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [logoImage, setLogoImage] = useState<string | null>(null);

  // Modals & Dialogs
  const [editProfileModalOpen, setEditProfileModalOpen] = useState(false);
  const [uploadDocModalOpen, setUploadDocModalOpen] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // Document Review Modal State (Identical to TodaRegistrationPage review display)
  const [reviewModalState, setReviewModalState] = useState<{
    open: boolean;
    title: string;
    fileName: string;
    fileUrl: string;
  }>({
    open: false,
    title: '',
    fileName: '',
    fileUrl: '',
  });

  // Organizational Profile Form State
  const [editTodaName, setEditTodaName] = useState('');
  const [editTodaAcronym, setEditTodaAcronym] = useState('');
  const [editBarangay, setEditBarangay] = useState('');
  const [editDateEst, setEditDateEst] = useState('');
  const [editTerminalLoc, setEditTerminalLoc] = useState('');
  // Panel comment (D-P4): the terminal is a pin on the map, never typed. Moving it is a request the LGU decides, and it needs a reason.
  const [editPin, setEditPin] = useState<{ lat: number; lng: number } | null>(null);
  const [pinMapOpen, setPinMapOpen] = useState(false);
  // Decision D-P9: a newer roster file of an Active TODA is a new version; the TODA reconciles it with the Master Roster member by member
  const [rosterUpdateFile, setRosterUpdateFile] = useState<{ path: string; name: string } | null>(null);
  const [editRelocationReason, setEditRelocationReason] = useState('');
  // an accredited TODA's change of name, acronym, barangay or date is a request the LGU decides; this is why (optional)
  const [editChangeReason, setEditChangeReason] = useState('');
  const [changeRequests, setChangeRequests] = useState<TodaChangeRequest[]>([]);
  const [withdrawingId, setWithdrawingId] = useState<string | null>(null);

  // Officers Form State
  const [editPresident, setEditPresident] = useState('');
  const [editPresidentContact, setEditPresidentContact] = useState('');
  const [editVicePresident, setEditVicePresident] = useState('');
  const [editVicePresidentContact, setEditVicePresidentContact] = useState('');
  const [editSecretary, setEditSecretary] = useState('');
  const [editSecretaryContact, setEditSecretaryContact] = useState('');
  const [editTreasurer, setEditTreasurer] = useState('');
  const [editTreasurerContact, setEditTreasurerContact] = useState('');

  // Document Upload Form State (Real File Picker)
  const [docCategory, setDocCategory] = useState<'Barangay Clearance' | 'Driver Roster' | 'Internal Bylaws'>('Barangay Clearance');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploadingDoc, setIsUploadingDoc] = useState(false);
  /** the date a new Barangay Clearance is valid until (YYYY-MM-DD); the LGU confirms it against the document */
  const [clearanceValidUntil, setClearanceValidUntil] = useState('');

  // Drag & Drop Feedback States
  const [isDraggingModalZone, setIsDraggingModalZone] = useState(false);
  const modalDragCounter = React.useRef(0);
  const [activeDropCategory, setActiveDropCategory] = useState<string | null>(null);

  // Snackbar Alert State
  const [uploadSnackbar, setUploadSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: 'success' | 'error' | 'info';
  }>({
    open: false,
    message: '',
    severity: 'success',
  });

  // Global window drop listener to prevent browser opening dropped files
  useEffect(() => {
    const handleWindowDrag = (e: DragEvent) => {
      e.preventDefault();
    };
    window.addEventListener('dragover', handleWindowDrag);
    window.addEventListener('drop', handleWindowDrag);
    return () => {
      window.removeEventListener('dragover', handleWindowDrag);
      window.removeEventListener('drop', handleWindowDrag);
    };
  }, []);

  const handleDroppedFileForCategory = (file: File, category: 'Barangay Clearance' | 'Driver Roster' | 'Internal Bylaws') => {
    const ext = `.${file.name.split('.').pop()?.toLowerCase()}`;
    let isValid = false;
    if (category === 'Driver Roster') {
      isValid = ['.csv', '.xlsx', '.xls', '.pdf'].includes(ext);
    } else {
      isValid = ['.pdf', '.png', '.jpg', '.jpeg'].includes(ext);
    }

    if (!isValid) {
      setUploadSnackbar({
        open: true,
        message: `Invalid file format for ${category}. Allowed: ${category === 'Driver Roster' ? 'CSV, Excel, or PDF' : 'PDF, PNG, or JPG'} (Max 10MB)`,
        severity: 'error',
      });
      return;
    }

    setDocCategory(category);
    setSelectedFile(file);
    setUploadDocModalOpen(true);
  };

  const getCategoryFileSupport = () => {
    switch (docCategory) {
      case 'Barangay Clearance':
        return {
          accept: '.pdf,.png,.jpg,.jpeg',
          text: 'Supports PDF, PNG, or JPG (Max 10MB)',
        };
      case 'Driver Roster':
        return {
          accept: '.csv,.xlsx,.xls,.pdf',
          text: 'Supports CSV, Excel, or PDF (Max 10MB)',
        };
      case 'Internal Bylaws':
        return {
          accept: '.pdf,.png,.jpg,.jpeg',
          text: 'Supports PDF, PNG, or JPG (Max 10MB)',
        };
      default:
        return {
          accept: '.pdf,.png,.jpg,.jpeg',
          text: 'Supports PDF, PNG, or JPG (Max 10MB)',
        };
    }
  };

  const populateFormFields = (p: TodaProfile) => {
    setEditTodaName(p.name || '');
    setEditTodaAcronym(p.acronym || '');
    setEditBarangay(p.barangay || 'San Vicente Central');
    setEditDateEst(p.dateEstablished || '');
    setEditTerminalLoc(p.terminalLocation || '');
    setEditPin(p.terminalLatitude && p.terminalLongitude ? { lat: p.terminalLatitude, lng: p.terminalLongitude } : null);
    setEditRelocationReason('');
    setEditPresident(p.officers?.president || '');
    setEditPresidentContact(p.officers?.presidentContact || '');
    setEditVicePresident(p.officers?.vicePresident || '');
    setEditVicePresidentContact(p.officers?.vicePresidentContact || '');
    setEditSecretary(p.officers?.secretary || '');
    setEditSecretaryContact(p.officers?.secretaryContact || '');
    setEditTreasurer(p.officers?.treasurer || '');
    setEditTreasurerContact(p.officers?.treasurerContact || '');
  };

  const loadProfile = async () => {
    setIsLoading(true);
    try {
      const [p, requests] = await Promise.all([fetchTodaProfile(targetTodaId), fetchTodaChangeRequests(targetTodaId)]);
      setChangeRequests(requests);
      if (p) {
        setProfile(p);
        populateFormFields(p);
      }
    } catch (err) {
      console.error('[TodaAccount] Error fetching TODA profile from database:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadProfile();
  }, [targetTodaId]);

  // Logo Change Handler
  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const imageUrl = URL.createObjectURL(file);
      setLogoImage(imageUrl);

      if (profile) {
        recordTodaAuditAction({
          actionType: 'TODA_PROFILE_UPDATED',
          targetId: profile.id,
          targetName: profile.name,
          details: `Updated TODA Organization logo icon (${file.name}).`,
          category: 'Account',
        });
      }
    }
  };

  // File Picker Handler for Document Renewal
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (file.size > 10 * 1024 * 1024) {
        alert('File size exceeds the 10MB limit. Please upload a file smaller than 10MB.');
        e.target.value = '';
        return;
      }
      setSelectedFile(file);
    }
  };

  // Has the pin been moved away from the terminal on record (25 m or more)? Only then is there anything to ask the LGU.
  const pinMoved = Boolean(
    editPin && profile
    && (profile.terminalLatitude == null || profile.terminalLongitude == null
        || calculateDistanceKm(profile.terminalLatitude, profile.terminalLongitude, editPin.lat, editPin.lng) * 1000 >= 25)
  );

  // Did the person change something that identifies the TODA (name, acronym, barangay, date established)?
  const identityChanged = Boolean(
    profile && (
      editTodaName.trim() !== (profile.name || '').trim()
      || editTodaAcronym.trim().toUpperCase() !== (profile.acronym || '').trim().toUpperCase()
      || editBarangay !== (profile.barangay || '')
      || editDateEst !== String(profile.dateEstablished || '').slice(0, 10)
    )
  );

  // Submit Organizational Profile Edit
  const handleEditProfileSubmit = async () => {
    if (!profile) return;
    setIsSavingEdit(true);

    const lat = editPin?.lat ?? null;
    const lng = editPin?.lng ?? null;
    // a moved pin is a request to the LGU, which reads the reason before it decides
    if (pinMoved && editRelocationReason.trim().length < 10) {
      setIsSavingEdit(false);
      setUploadSnackbar({ open: true, message: 'Say why the terminal is moving (at least 10 characters). The LGU reads it before it decides.', severity: 'error' });
      return;
    }

    try {
      const saved = await updateTodaProfile(profile.id, {
        name: editTodaName.trim(),
        acronym: editTodaAcronym.trim(),
        barangay: editBarangay,
        dateEstablished: editDateEst,
        // the name of the terminal place travels with the pin: it is sent only when the pin moved (the LGU approves both together)
        terminalLocation: pinMoved ? editTerminalLoc.trim() : undefined,
        terminalLatitude: lat,
        terminalLongitude: lng,
        relocationReason: editRelocationReason.trim(),
        changeReason: editChangeReason.trim(),
        officers: {
          president: editPresident.trim(),
          presidentContact: editPresidentContact.trim(),
          vicePresident: editVicePresident.trim(),
          vicePresidentContact: editVicePresidentContact.trim(),
          secretary: editSecretary.trim(),
          secretaryContact: editSecretaryContact.trim(),
          treasurer: editTreasurer.trim(),
          treasurerContact: editTreasurerContact.trim(),
        },
      });

      await loadProfile();
      setEditProfileModalOpen(false);
      setUploadSnackbar({
        open: true,
        message: saved.relocationRequested && saved.profileChangeRequested
          ? 'Saved. The terminal move and the change to the TODA details were sent to the LGU; the current ones stay in force until it decides.'
          : saved.relocationRequested
          ? 'Profile saved. The terminal move was sent to the LGU for approval; the current terminal stays in force until it decides.'
          : saved.profileChangeRequested
          ? 'Saved. The change to the TODA details was sent to the LGU for approval; the current details stay in force until it decides.'
          : 'Successfully updated TODA organizational profile!',
        severity: 'success',
      });
    } catch (err: any) {
      console.error('[TodaAccount] Error updating profile in database:', err);
      setUploadSnackbar({
        open: true,
        message: err?.message || 'Failed to update organizational profile. Please try again.',
        severity: 'error',
      });
    } finally {
      setIsSavingEdit(false);
    }
  };

  // Submit a compliance document: a correction of a returned application, or the renewed Barangay Clearance of an Active TODA
  const handleDocumentUploadSubmit = async () => {
    if (!selectedFile || !profile) return;
    if (docCategory === 'Barangay Clearance' && !clearanceValidUntil) {
      setUploadSnackbar({ open: true, message: 'Enter the date the Barangay Clearance is valid until.', severity: 'error' });
      return;
    }
    setIsUploadingDoc(true);

    try {
      const targetBucket =
        docCategory === 'Barangay Clearance'
          ? 'barangay-clearances'
          : docCategory === 'Driver Roster'
          ? 'toda-accredited-driver-lists'
          : 'toda-bylaws';

      const uploadResult = await uploadTodaDocument(selectedFile, targetBucket as any);

      // The database function replaces the file for the LGU and says what it means (a correction, or a renewal for an accredited TODA)
      const { renewal, rosterUpdate } = await updateTodaComplianceDocument(
        profile.id,
        docCategory,
        uploadResult.url,
        selectedFile.name,
        docCategory === 'Barangay Clearance' ? clearanceValidUntil : null
      );

      setUploadSnackbar({
        open: true,
        message: renewal
          ? `The renewed Barangay Clearance ("${selectedFile.name}") was sent to the LGU. Your accreditation stays as it is until the LGU records the renewal.`
          : rosterUpdate
          ? `Your new roster file ("${selectedFile.name}") was saved as a new version. The file you registered with stays as it was; choose which members to add or mark as left.`
          : profile.accreditationStatus === 'Resubmission Required'
          ? `${docCategory} ("${selectedFile.name}") was replaced. When every correction is done, press Resubmit for LGU review.`
          : profile.accreditationStatus === 'Active' && docCategory === 'Internal Bylaws'
          ? `The new Internal Bylaws ("${selectedFile.name}") were sent to the LGU. The bylaws in force stay as they are until the LGU approves.`
          : `${docCategory} ("${selectedFile.name}") was sent to the LGU for review.`,
        severity: 'success',
      });

      if (rosterUpdate) setRosterUpdateFile({ path: uploadResult.url, name: selectedFile.name });
      await loadProfile();
      setSelectedFile(null);
      setClearanceValidUntil('');
      setUploadDocModalOpen(false);
    } catch (err: any) {
      console.error('[TodaAccount] Error uploading compliance document:', err);
      setUploadSnackbar({
        open: true,
        message: err?.message || 'Failed to upload compliance document. Please try again.',
        severity: 'error',
      });
    } finally {
      setIsUploadingDoc(false);
    }
  };

  // Send a returned application back to the LGU
  const handleResubmit = async (note: string) => {
    await resubmitTodaApplication(note);
    await loadProfile();
    setUploadSnackbar({ open: true, message: 'The application was resubmitted. It is back with the LGU for review.', severity: 'success' });
  };

  if (isLoading) {
    return (
      <Box sx={{ maxWidth: SHELL.contentMaxWidth, margin: '0 auto', pb: '38px', display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 320 }}>
        <Box role="status" sx={{ textAlign: 'center' }}>
          <CircularProgress size={29} sx={{ color: 'var(--sakay-orange)', mb: '13px' }} />
          <Typography sx={{ fontSize: FONT.body, color: OPS_TEXT.secondary, fontWeight: 500 }}>
            Loading association account records...
          </Typography>
        </Box>
      </Box>
    );
  }

  // the records could not be read: say so and let the president try again
  if (!profile) {
    return (
      <Box sx={{ maxWidth: SHELL.contentMaxWidth, margin: '0 auto', pb: '38px', display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 320 }}>
        <Box sx={{ textAlign: 'center', maxWidth: 420 }}>
          <Typography sx={{ fontSize: FONT.heading, fontWeight: 700, color: OPS_TEXT.primary }}>Your account details could not be loaded</Typography>
          <Typography sx={{ fontSize: FONT.body, color: OPS_TEXT.secondary, mt: '4px', mb: '14px' }}>Check your internet connection, then try again.</Typography>
          <Button variant="outlined" onClick={loadProfile} sx={secondaryButtonSx}>Try Again</Button>
        </Box>
      </Box>
    );
  }

  // the three compliance files: what each one is called, the file that was sent, its status, and what it says under the name
  const renewalPending = Boolean(profile.renewalSubmittedAt);
  const bylawsPending = changeRequests.some((r) => r.kind === 'bylaws' && r.status === 'Pending');
  const sentOn = (fileName: string, savedDate: string) => submittedDateOfStoredFile(fileName) || savedDate;
  const submittedLine = (date: string) => (date ? `Submitted ${date}` : 'No file submitted yet');
  const documents = [
    {
      key: 'clearance',
      category: 'Barangay Clearance' as const,
      title: 'Barangay Clearance for TODA Accreditation',
      fileName: profile.barangayClearanceFile.name,
      fileUrl: profile.barangayClearanceFile.url || '',
      status: complianceDocumentStatus('clearance', profile.accreditationStatus, renewalPending),
      details: [submittedLine(profile.barangayClearanceFile.date)],
    },
    {
      key: 'roster',
      category: 'Driver Roster' as const,
      title: 'Driver Roster',
      fileName: profile.rosterFile.name,
      fileUrl: profile.rosterFile.url || '',
      status: complianceDocumentStatus('roster', profile.accreditationStatus, renewalPending),
      details: [submittedLine(sentOn(profile.rosterFile.name, profile.rosterFile.date)), `${profile.rosterFile.count} accredited members`],
    },
    {
      key: 'bylaws',
      category: 'Internal Bylaws' as const,
      title: 'Internal TODA Bylaws & Constitution',
      fileName: profile.bylawsFile?.name || 'TODA_Bylaws.pdf',
      fileUrl: profile.bylawsFile?.url || '',
      status: bylawsPending ? { label: 'New file waiting for the LGU', tone: 'warning' as const } : complianceDocumentStatus('bylaws', profile.accreditationStatus, renewalPending),
      details: [submittedLine(profile.bylawsFile?.name ? sentOn(profile.bylawsFile.name, profile.bylawsFile.date) : '')],
    },
  ];

  const officers = [
    { role: 'President', name: profile.officers?.president, contact: profile.officers?.presidentContact },
    { role: 'Vice President', name: profile.officers?.vicePresident, contact: profile.officers?.vicePresidentContact },
    { role: 'Secretary', name: profile.officers?.secretary, contact: profile.officers?.secretaryContact },
    { role: 'Treasurer', name: profile.officers?.treasurer, contact: profile.officers?.treasurerContact },
  ];

  const openUploadFor = (category: 'Barangay Clearance' | 'Driver Roster' | 'Internal Bylaws') => {
    setDocCategory(category);
    setSelectedFile(null);
    setUploadDocModalOpen(true);
  };

  return (
    <Box sx={{ maxWidth: SHELL.contentMaxWidth, margin: '0 auto', pb: '38px' }}>
      {/* 1. Who this account is, and the one thing to do with it */}
      <Card elevation={0} sx={{ ...opsCardSx, p: SPACE.cardLarge, mb: SPACE.gapLarge }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '13px' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: '16px', minWidth: 0 }}>
            <Box sx={{ position: 'relative', flexShrink: 0 }}>
              <Avatar
                src={logoImage || undefined}
                sx={{ width: 52, height: 52, background: 'linear-gradient(135deg, var(--sakay-orange) 0%, #ff8a47 100%)', fontSize: '20px', fontWeight: 700 }}
              >
                {!logoImage && (profile.acronym ? profile.acronym.charAt(0) : 'T')}
              </Avatar>
              <IconButton
                component="label"
                aria-label="Change the TODA logo"
                size="small"
                sx={{
                  position: 'absolute',
                  bottom: -4,
                  right: -4,
                  backgroundColor: '#FFFFFF',
                  border: `1px solid ${OPS_BORDER}`,
                  p: '5px',
                  color: OPS_TEXT.brand,
                  '&:hover': { backgroundColor: 'var(--sakay-orange-soft)' },
                  '&:focus-within': { outline: `2px solid ${OPS_TEXT.brand}`, outlineOffset: '2px' },
                }}
              >
                <PhotoCameraIcon aria-hidden sx={{ fontSize: 14 }} />
                <input type="file" hidden accept="image/*" onChange={handleLogoChange} />
              </IconButton>
            </Box>

            <Typography component="h2" sx={{ fontSize: FONT.pageTitle, fontWeight: 700, color: OPS_TEXT.primary, overflowWrap: 'anywhere' }}>
              {profile.name}
            </Typography>
          </Box>

          <Button
            variant="contained"
            disableElevation
            startIcon={<EditIcon sx={{ fontSize: 16 }} />}
            onClick={() => {
              populateFormFields(profile);
              setEditProfileModalOpen(true);
            }}
            sx={primaryButtonSx}
          >
            Edit TODA Profile
          </Button>
        </Box>
      </Card>

      {/* 2. Accreditation: status, certificate, validity, and the Resubmit step when the LGU returned the application */}
      <AccreditationCard profile={profile} onResubmit={handleResubmit} />

      {/* 3. The organisation and its officers, side by side */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))' }, gap: SPACE.gapLarge, mb: SPACE.gapLarge }}>
        <SectionCard icon={<BusinessIcon aria-hidden sx={{ color: OPS_TEXT.brand, fontSize: 19 }} />} title="TODA information">
          <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px 16px' }}>
            <InfoItem label="Date established">{formatDisplayDate(profile.dateEstablished)}</InfoItem>
            <InfoItem label="Operating barangay">{profile.barangay || 'San Vicente Central'}</InfoItem>
            <InfoItem label="Terminal location">{profile.terminalLocation || 'Calapan City Terminal'}</InfoItem>
            <InfoItem label="Terminal coordinates">
              {profile.terminalLatitude && profile.terminalLongitude ? `${profile.terminalLatitude}, ${profile.terminalLongitude}` : 'None specified'}
            </InfoItem>
          </Box>
          {profile.terminalRelocationStatus === 'Pending LGU Re-approval' && (
            <Alert severity="warning" sx={{ mt: SPACE.gap, fontSize: FONT.body }}>
              <strong>Terminal move waiting for the LGU.</strong> Requested: {profile.pendingTerminalLocation || 'new terminal'} ({profile.pendingTerminalLatitude}, {profile.pendingTerminalLongitude}).
              {profile.pendingTerminalReason ? ` Your reason: ${profile.pendingTerminalReason}` : ''} The current terminal stays in force until the LGU decides.
            </Alert>
          )}
          {profile.terminalRelocationStatus === 'Rejected' && profile.terminalRelocationDecisionNote && (
            <Alert severity="error" sx={{ mt: SPACE.gap, fontSize: FONT.body }}>
              <strong>The LGU did not approve the terminal move.</strong> {profile.terminalRelocationDecisionNote}
            </Alert>
          )}
          <PendingChangesList
            requests={changeRequests}
            busyId={withdrawingId}
            onWithdraw={async (id) => {
              setWithdrawingId(id);
              try {
                await withdrawTodaChangeRequest(id);
                await loadProfile();
                setUploadSnackbar({ open: true, message: 'Your request was taken back. Nothing changed.', severity: 'success' });
              } catch (err: any) {
                setUploadSnackbar({ open: true, message: err?.message || 'The request could not be taken back.', severity: 'error' });
              } finally {
                setWithdrawingId(null);
              }
            }}
          />
          {profile.terminalRelocationStatus === 'Approved' && profile.terminalRelocationDecisionNote && (
            <Alert severity="success" sx={{ mt: SPACE.gap, fontSize: FONT.body }}>
              <strong>The LGU approved the terminal move.</strong> {profile.terminalRelocationDecisionNote}
            </Alert>
          )}
        </SectionCard>

        <SectionCard icon={<GroupsIcon aria-hidden sx={{ color: OPS_TEXT.brand, fontSize: 19 }} />} title="Authorized TODA officers">
          <Box component="dl" sx={{ m: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px 16px' }}>
            {officers.map((officer) => (
              <InfoItem key={officer.role} label={officer.role}>
                {officer.name || 'Not provided'}
                {officer.contact && (
                  <Typography component="span" sx={{ display: 'block', fontSize: FONT.small, fontWeight: 400, color: OPS_TEXT.secondary }}>
                    {officer.contact}
                  </Typography>
                )}
              </InfoItem>
            ))}
          </Box>
        </SectionCard>
      </Box>

      {/* 4. The compliance files: three cards side by side, one line of file name each (the last block of the page) */}
      <Box>
        <SectionCard
          icon={<FolderOpenOutlinedIcon aria-hidden sx={{ color: OPS_TEXT.brand, fontSize: 19 }} />}
          title="Compliance documents"
          action={
            <Button variant="outlined" startIcon={<UploadFileIcon sx={{ fontSize: 16 }} />} onClick={() => openUploadFor('Barangay Clearance')} sx={secondaryButtonSx}>
              Upload a Document
            </Button>
          }
        >
          <Typography sx={{ fontSize: FONT.small, color: OPS_TEXT.secondary, lineHeight: 1.5, mb: '13px' }}>
            Files you send go to the City LGU Franchising Office. Press View to read a file, or Replace file to send a new one. You can also drag a new file onto a document.
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '12px' }}>
            {documents.map((doc) => (
              <ComplianceDocumentCard
                key={doc.key}
                title={doc.title}
                statusLabel={doc.status.label}
                statusTone={doc.status.tone}
                fileName={doc.fileName}
                details={doc.details}
                dragging={activeDropCategory === doc.key}
                onDragActive={(active) => setActiveDropCategory(active ? doc.key : null)}
                onDropFile={(file) => handleDroppedFileForCategory(file, doc.category)}
                onView={() => setReviewModalState({ open: true, title: doc.title, fileName: doc.fileName, fileUrl: doc.fileUrl })}
                onReplace={() => openUploadFor(doc.category)}
              />
            ))}
          </Box>
        </SectionCard>
      </Box>

      {/* Decision D-P9: the newer roster file next to the Master Roster; nothing changes until the TODA applies */}
      <RosterUpdateDialog
        open={Boolean(rosterUpdateFile)}
        onClose={() => setRosterUpdateFile(null)}
        file={rosterUpdateFile}
        onApplied={(summary) => setUploadSnackbar({ open: true, message: `Master Roster updated: ${summary}`, severity: 'success' })}
      />

      {/* Panel comment (D-P4): the terminal is chosen with a pin; the picker keeps it on a road inside the city */}
      <TerminalMapPickerModal
        open={pinMapOpen}
        onClose={() => setPinMapOpen(false)}
        initialLat={editPin?.lat ?? null}
        initialLng={editPin?.lng ?? null}
        onConfirmLocation={({ lat, lng, locationName }) => {
          setEditPin({ lat, lng });
          // a place chosen by search (or a quick jump) names the terminal; a pin placed by hand leaves the name to the person, and an old name is not left standing for a new place
          if (locationName) setEditTerminalLoc(locationName);
          else if (profile && editTerminalLoc.trim() === (profile.terminalLocation || '').trim()
            && (profile.terminalLatitude == null || profile.terminalLongitude == null
              || calculateDistanceKm(profile.terminalLatitude, profile.terminalLongitude, lat, lng) * 1000 >= 25)) setEditTerminalLoc('');
        }}
      />

      {/* Edit the organisation and its officers */}
      <MacCenterModal
        open={editProfileModalOpen}
        onClose={() => setEditProfileModalOpen(false)}
        title="Edit TODA Organizational Profile"
        subtitle={`Update official TODA records and authorized officers for ${profile.name}`}
        maxWidth={624}
        primaryActionLabel={isSavingEdit ? 'Saving...' : 'Save Organizational Profile'}
        onPrimaryAction={handleEditProfileSubmit}
        secondaryActionLabel="Cancel"
        onSecondaryAction={() => setEditProfileModalOpen(false)}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: SPACE.gapLarge, pt: '6px' }}>
          <Box>
            <FormSectionTitle>Association information</FormSectionTitle>
            {profile.accreditationStatus === 'Active' && (
              <Alert severity="info" sx={{ mb: SPACE.gap, fontSize: FONT.body }}>
                Your TODA is accredited. A new name, acronym, barangay or date established is sent to the LGU for approval, and the current details stay in force until it decides.
                Officer names and contact numbers are saved at once.
              </Alert>
            )}

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: SPACE.gap, mb: SPACE.gap }}>
              <TextField
                label="Official Association / TODA Name"
                placeholder="e.g. Calapan Central Tricycle Operators & Drivers Association"
                value={editTodaName}
                onChange={(e) => setEditTodaName(e.target.value)}
                required
                fullWidth
                size="small"
              />
              <TextField
                label="TODA Acronym"
                placeholder="e.g. CCTODA"
                value={editTodaAcronym}
                onChange={(e) => setEditTodaAcronym(e.target.value.toUpperCase())}
                required
                fullWidth
                size="small"
              />
            </Box>

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: SPACE.gap, mb: SPACE.gap }}>
              <FormControl fullWidth size="small" required>
                <InputLabel id="edit-barangay-label">Operating Barangay</InputLabel>
                <Select
                  labelId="edit-barangay-label"
                  label="Operating Barangay"
                  value={editBarangay}
                  onChange={(e) => setEditBarangay(e.target.value)}
                >
                  {CALAPAN_BARANGAYS.map((brgy) => (
                    <MenuItem key={brgy} value={brgy}>
                      {brgy}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>

              <TextField
                label="Date Established"
                type="date"
                value={editDateEst}
                onChange={(e) => setEditDateEst(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
                required
                fullWidth
                size="small"
              />
            </Box>

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: SPACE.gap }}>
              <TextField
                label={pinMoved ? 'Name of the new terminal place' : 'Terminal Location'}
                placeholder="e.g. Calapan Public Market, J.P. Rizal St."
                value={editTerminalLoc}
                onChange={(e) => setEditTerminalLoc(e.target.value)}
                required={pinMoved}
                disabled={!pinMoved}
                helperText={pinMoved ? 'Street and barangay of the new place. It is sent with the pin.' : 'Move the pin on the map to propose a new terminal place; the LGU approves the place and the pin together.'}
                fullWidth
                size="small"
              />
              <Box>
                <TextField
                  label="Terminal Coordinates (from the map pin)"
                  placeholder="Use Pin on Map"
                  value={editPin ? `${editPin.lat.toFixed(6)}, ${editPin.lng.toFixed(6)}` : ''}
                  fullWidth
                  size="small"
                  slotProps={{ input: { readOnly: true } }}
                  onClick={() => setPinMapOpen(true)}
                />
                <Button onClick={() => setPinMapOpen(true)} sx={{ ...secondaryButtonSx, mt: '8px' }}>
                  {editPin ? 'Move the pin on the map' : 'Pin on Map'}
                </Button>
              </Box>
            </Box>
            {profile.accreditationStatus === 'Active' && identityChanged && (
              <TextField
                label="Why are the details changing? (optional)"
                placeholder="e.g. The association was renamed at the general assembly."
                value={editChangeReason}
                onChange={(e) => setEditChangeReason(e.target.value)}
                fullWidth
                multiline
                minRows={2}
                size="small"
                slotProps={{ htmlInput: { maxLength: 500 } }}
                sx={{ mt: SPACE.gap }}
              />
            )}
            {pinMoved && (
              <Box sx={{ mt: SPACE.gap }}>
                <Alert severity="info" sx={{ mb: '8px', fontSize: FONT.body }}>
                  The terminal is moving. The LGU has to approve the move; the current terminal stays in force until it decides.
                </Alert>
                <TextField
                  label="Why is the terminal moving?"
                  placeholder="e.g. The old terminal lot was sold; the TODA now queues at the new lot beside the market."
                  value={editRelocationReason}
                  onChange={(e) => setEditRelocationReason(e.target.value)}
                  required
                  fullWidth
                  multiline
                  minRows={2}
                  size="small"
                />
              </Box>
            )}
          </Box>

          <Divider sx={{ borderColor: OPS_BORDER }} />

          <Box>
            <FormSectionTitle>Executive officers</FormSectionTitle>

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: SPACE.gap, mb: SPACE.gap }}>
              <TextField
                label="President Full Name"
                placeholder="e.g. Roberto Alcantara"
                value={editPresident}
                onChange={(e) => setEditPresident(e.target.value)}
                required
                fullWidth
                size="small"
              />
              <TextField
                label="President Mobile Contact"
                placeholder="e.g. 0917 555 1001"
                value={editPresidentContact}
                onChange={(e) => setEditPresidentContact(formatPhoneNumber(e.target.value))}
                required
                fullWidth
                size="small"
              />
            </Box>

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: SPACE.gap, mb: SPACE.gap }}>
              <TextField
                label="Vice President Name"
                placeholder="e.g. Eduardo Perez"
                value={editVicePresident}
                onChange={(e) => setEditVicePresident(e.target.value)}
                fullWidth
                size="small"
              />
              <TextField
                label="Vice President Contact"
                placeholder="e.g. 0917 555 1002"
                value={editVicePresidentContact}
                onChange={(e) => setEditVicePresidentContact(formatPhoneNumber(e.target.value))}
                fullWidth
                size="small"
              />
            </Box>

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: SPACE.gap, mb: SPACE.gap }}>
              <TextField
                label="Secretary Name"
                placeholder="e.g. Leticia Cruz"
                value={editSecretary}
                onChange={(e) => setEditSecretary(e.target.value)}
                fullWidth
                size="small"
              />
              <TextField
                label="Secretary Contact"
                placeholder="e.g. 0917 555 1003"
                value={editSecretaryContact}
                onChange={(e) => setEditSecretaryContact(formatPhoneNumber(e.target.value))}
                fullWidth
                size="small"
              />
            </Box>

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: SPACE.gap }}>
              <TextField
                label="Treasurer Name"
                placeholder="e.g. Mario Hernandez"
                value={editTreasurer}
                onChange={(e) => setEditTreasurer(e.target.value)}
                fullWidth
                size="small"
              />
              <TextField
                label="Treasurer Contact"
                placeholder="e.g. 0917 555 1004"
                value={editTreasurerContact}
                onChange={(e) => setEditTreasurerContact(formatPhoneNumber(e.target.value))}
                fullWidth
                size="small"
              />
            </Box>
          </Box>
        </Box>
      </MacCenterModal>

      {/* Send a compliance document to the LGU */}
      <MacCenterModal
        open={uploadDocModalOpen}
        onClose={() => setUploadDocModalOpen(false)}
        title={profile.accreditationStatus === 'Active' ? 'Submit a Renewed Document' : 'Submit a Compliance Document'}
        subtitle={profile.accreditationStatus === 'Resubmission Required' ? 'Replace a document the LGU returned for correction' : 'Submit accreditation compliance files for City LGU review'}
        maxWidth={528}
        primaryActionLabel={isUploadingDoc ? 'Uploading...' : selectedFile ? 'Submit Document for LGU Review' : undefined}
        onPrimaryAction={selectedFile && !isUploadingDoc && (docCategory !== 'Barangay Clearance' || clearanceValidUntil) ? handleDocumentUploadSubmit : undefined}
        secondaryActionLabel="Cancel"
        onSecondaryAction={() => setUploadDocModalOpen(false)}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: SPACE.gap }}>
          <FormControl fullWidth size="small">
            <InputLabel id="doc-select-label">Document</InputLabel>
            <Select
              labelId="doc-select-label"
              label="Document"
              value={docCategory}
              onChange={(e) => {
                setDocCategory(e.target.value as any);
                setSelectedFile(null);
              }}
            >
              <MenuItem value="Barangay Clearance">Barangay Clearance</MenuItem>
              <MenuItem value="Driver Roster">Driver Roster</MenuItem>
              <MenuItem value="Internal Bylaws">Internal Bylaws</MenuItem>
            </Select>
          </FormControl>

          <Box>
            <Typography sx={{ fontSize: FONT.body, fontWeight: 600, color: OPS_TEXT.primary, mb: '6px' }}>
              Attach the file
            </Typography>

            <Box
              component="label"
              onDragEnter={(e) => {
                e.preventDefault();
                e.stopPropagation();
                modalDragCounter.current += 1;
                setIsDraggingModalZone(true);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = 'copy';
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                e.stopPropagation();
                modalDragCounter.current -= 1;
                if (modalDragCounter.current <= 0) {
                  modalDragCounter.current = 0;
                  setIsDraggingModalZone(false);
                }
              }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                modalDragCounter.current = 0;
                setIsDraggingModalZone(false);
                if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                  const file = e.dataTransfer.files[0];
                  if (file.size > 10 * 1024 * 1024) {
                    setUploadSnackbar({
                      open: true,
                      message: 'File size exceeds the 10MB limit. Please upload a file smaller than 10MB.',
                      severity: 'error',
                    });
                    return;
                  }
                  handleDroppedFileForCategory(file, docCategory);
                }
              }}
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '22px 16px',
                borderRadius: '10px',
                border: isDraggingModalZone ? '2px solid var(--sakay-orange)' : '2px dashed var(--sakay-orange-border)',
                backgroundColor: isDraggingModalZone ? 'rgba(255, 102, 0, 0.12)' : 'var(--sakay-orange-soft)',
                cursor: 'pointer',
                transition: 'background-color 0.2s ease',
                textAlign: 'center',
                '&:hover': { backgroundColor: 'rgba(255, 102, 0, 0.12)', borderColor: 'var(--sakay-orange)' },
                '&:focus-within': { outline: `2px solid ${OPS_TEXT.brand}`, outlineOffset: '2px' },
                '& > *': { pointerEvents: 'none' },
              }}
            >
              <input
                type="file"
                hidden
                style={{ display: 'none' }}
                accept={getCategoryFileSupport().accept}
                onChange={handleFileSelect}
              />
              <UploadFileIcon aria-hidden sx={{ fontSize: 30, color: OPS_TEXT.brand, mb: '6px' }} />
              <Typography sx={{ fontSize: FONT.body, fontWeight: 700, color: OPS_TEXT.primary, overflowWrap: 'anywhere' }}>
                {isDraggingModalZone ? 'Drop file to attach' : selectedFile ? selectedFile.name : 'Click or drag a file here'}
              </Typography>
              <Typography sx={{ fontSize: FONT.small, color: OPS_TEXT.secondary, mt: '3px' }}>
                {selectedFile
                  ? `${(selectedFile.size / 1024).toFixed(1)} KB • Ready for upload`
                  : getCategoryFileSupport().text}
              </Typography>
            </Box>

            {selectedFile && (
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '10px',
                  mt: '10px',
                  p: '10px 12px',
                  borderRadius: '8px',
                  backgroundColor: '#FAFAF8',
                  border: `1px solid ${OPS_BORDER}`,
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                  <InsertDriveFileIcon aria-hidden sx={{ color: OPS_TEXT.brand, fontSize: 18, flexShrink: 0 }} />
                  <Typography sx={{ fontSize: FONT.body, fontWeight: 600, color: OPS_TEXT.primary, overflowWrap: 'anywhere' }}>
                    {selectedFile.name}
                  </Typography>
                </Box>
                <StatusPill label="Selected file" tone="neutral" />
              </Box>
            )}
          </Box>

          {docCategory === 'Barangay Clearance' && (
            <TextField
              fullWidth
              size="small"
              type="date"
              label="Barangay Clearance valid until"
              value={clearanceValidUntil}
              onChange={(e) => setClearanceValidUntil(e.target.value)}
              helperText="Copy the date printed on the clearance. The LGU Administrator checks it against the document before recording it."
              slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10) } }}
            />
          )}

          <Typography sx={{ fontSize: FONT.small, color: OPS_TEXT.secondary, lineHeight: 1.5 }}>
            {profile.accreditationStatus === 'Active'
              ? 'A renewed Barangay Clearance goes to the City LGU Franchising Office. Your accreditation stays as it is until the LGU records the renewal.'
              : 'Submitted compliance files go directly to the City LGU Franchising Office for review.'}
          </Typography>
        </Box>
      </MacCenterModal>

      {/* Read one of the documents */}
      <DocumentReviewModal
        open={reviewModalState.open}
        onClose={() => setReviewModalState((prev) => ({ ...prev, open: false }))}
        documentTitle={reviewModalState.title}
        fileName={reviewModalState.fileName}
        fileUrl={reviewModalState.fileUrl}
      />

      {/* What just happened */}
      <SakayToast open={uploadSnackbar.open} message={uploadSnackbar.message} severity={uploadSnackbar.severity} autoHideDuration={6000} onClose={() => setUploadSnackbar((prev) => ({ ...prev, open: false }))} />
    </Box>
  );
};
