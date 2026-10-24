import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Card,
  Button,
  TextField,
  Chip,
  Avatar,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  IconButton,
  CircularProgress,
  Divider,
  Paper,
  Snackbar,
  Alert,
} from '@mui/material';
import VerifiedIcon from '@mui/icons-material/Verified';
import BusinessIcon from '@mui/icons-material/Business';
import GroupsIcon from '@mui/icons-material/Groups';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import EditIcon from '@mui/icons-material/Edit';
import DescriptionIcon from '@mui/icons-material/Description';
import ShieldIcon from '@mui/icons-material/Shield';
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera';
import VisibilityIcon from '@mui/icons-material/Visibility';
import InsertDriveFileIcon from '@mui/icons-material/InsertDriveFile';
import LocationOnIcon from '@mui/icons-material/LocationOn';

import { TodaProfile } from '../types/toda';
import { MacCenterModal } from '../components/admin/MacCenterModal';
import { DocumentReviewModal } from '../components/modals/DocumentReviewModal';
import {
  fetchTodaProfile,
  updateTodaProfile,
  recordTodaAuditAction,
  uploadTodaDocument,
  updateTodaComplianceDocument,
  resubmitTodaApplication,
} from '../services/todaApiService';
import { AccreditationCard } from '../components/common/AccreditationCard';
import { ChangePasswordCard } from '../components/common/ChangePasswordCard';
import { accreditationChip, documentChip } from '../utils/accreditation';
import { useAuth } from '../contexts/AuthContext';

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
  const [editTerminalCoordinates, setEditTerminalCoordinates] = useState('');

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
    setEditTerminalCoordinates(
      p.terminalLatitude && p.terminalLongitude
        ? `${p.terminalLatitude}, ${p.terminalLongitude}`
        : ''
    );
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
      const p = await fetchTodaProfile(targetTodaId);
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

  // Submit Organizational Profile Edit
  const handleEditProfileSubmit = async () => {
    if (!profile) return;
    setIsSavingEdit(true);

    let lat: number | null = null;
    let lng: number | null = null;
    if (editTerminalCoordinates.trim()) {
      const parts = editTerminalCoordinates.split(',').map((s) => parseFloat(s.trim()));
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        lat = parts[0];
        lng = parts[1];
      }
    }

    try {
      await updateTodaProfile(profile.id, {
        name: editTodaName.trim(),
        acronym: editTodaAcronym.trim(),
        barangay: editBarangay,
        dateEstablished: editDateEst,
        terminalLocation: editTerminalLoc.trim(),
        terminalLatitude: lat,
        terminalLongitude: lng,
        serviceArea: editTerminalLoc.trim(),
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
        message: 'Successfully updated TODA organizational profile!',
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
      const { renewal } = await updateTodaComplianceDocument(
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
          : profile.accreditationStatus === 'Resubmission Required'
          ? `${docCategory} ("${selectedFile.name}") was replaced. When every correction is done, press Resubmit for LGU review.`
          : `${docCategory} ("${selectedFile.name}") was sent to the LGU for review.`,
        severity: 'success',
      });

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

  if (isLoading || !profile) {
    return (
      <Box sx={{ maxWidth: 1280, margin: '0 auto', pb: '38px', display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 320 }}>
        <Box sx={{ textAlign: 'center' }}>
          <CircularProgress size={29} sx={{ color: 'var(--sakay-orange)', mb: '13px' }} />
          <Typography sx={{ fontSize: '12px', color: 'var(--mac-text-muted)', fontWeight: 500 }}>
            Loading association account records...
          </Typography>
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 1280, margin: '0 auto', pb: '38px' }}>
      {/* 1. Header Banner & Status Summary with Interactive TODA Logo Upload */}
      <Card
        elevation={0}
        sx={{
          p: '22px',
          borderRadius: '14px',
          border: '1px solid var(--mac-border-color)',
          backgroundColor: '#FFFFFF',
          boxShadow: 'var(--mac-shadow-card)',
          mb: '22px',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '13px' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            {/* Interactive TODA Avatar Logo with Upload Overlay */}
            <Box sx={{ position: 'relative' }}>
              <Avatar
                src={logoImage || undefined}
                sx={{
                  width: 58,
                  height: 58,
                  background: 'linear-gradient(135deg, var(--sakay-orange) 0%, #ff8a47 100%)',
                  fontSize: '22px',
                  fontWeight: 700,
                  boxShadow: '0 10px 24px rgba(255, 102, 0, 0.22)',
                }}
              >
                {!logoImage && (profile.acronym ? profile.acronym.charAt(0) : 'T')}
              </Avatar>
              <IconButton
                component="label"
                size="small"
                sx={{
                  position: 'absolute',
                  bottom: -3,
                  right: -3,
                  backgroundColor: '#FFFFFF',
                  border: '1px solid var(--mac-border-color)',
                  boxShadow: 'var(--mac-shadow-subtle)',
                  p: '5px',
                  color: 'var(--sakay-orange)',
                  '&:hover': { backgroundColor: 'var(--sakay-orange-soft)' },
                }}
              >
                <PhotoCameraIcon sx={{ fontSize: 13 }} />
                <input type="file" hidden accept="image/*" onChange={handleLogoChange} />
              </IconButton>
            </Box>

            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <Typography sx={{ fontSize: '19px', fontWeight: 700, color: 'var(--mac-text-primary)' }}>
                  {profile.name}
                </Typography>
                <Chip
                  icon={<VerifiedIcon sx={{ fontSize: 14, color: accreditationChip(profile.accreditationStatus).color }} />}
                  label={accreditationChip(profile.accreditationStatus).label}
                  size="small"
                  sx={{
                    backgroundColor: accreditationChip(profile.accreditationStatus).bg,
                    color: accreditationChip(profile.accreditationStatus).color,
                    fontWeight: 600,
                    fontSize: '11px',
                  }}
                />
              </Box>
            </Box>
          </Box>

          <Box sx={{ display: 'flex', gap: '10px' }}>
            <Button
              variant="contained"
              startIcon={<EditIcon />}
              onClick={() => {
                populateFormFields(profile);
                setEditProfileModalOpen(true);
              }}
              sx={{
                height: 34,
                px: '16px',
                borderRadius: '8px',
                fontSize: '12px',
                fontWeight: 600,
                textTransform: 'none',
                backgroundColor: 'var(--sakay-orange)',
                '&:hover': { backgroundColor: 'var(--sakay-orange-hover)' },
              }}
            >
              Edit TODA Profile
            </Button>
            <Button
              variant="outlined"
              startIcon={<UploadFileIcon />}
              onClick={() => setUploadDocModalOpen(true)}
              sx={{
                height: 34,
                px: '16px',
                borderRadius: '8px',
                fontSize: '12px',
                fontWeight: 600,
                textTransform: 'none',
                color: 'var(--mac-text-primary)',
                borderColor: 'var(--mac-border-color)',
                '&:hover': { backgroundColor: 'var(--sakay-orange-soft)', borderColor: 'var(--sakay-orange-border)' },
              }}
            >
              Annual Compliance Upload
            </Button>
          </Box>
        </Box>
      </Card>

      {/* 1b. Accreditation status, the LGU's reason, and the Resubmit step */}
      <AccreditationCard profile={profile} onResubmit={handleResubmit} />

      {/* 2. Balanced 2-Column Grid Layout for TODA Information */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 1fr' }, gap: '19px', alignItems: 'start' }}>
        {/* Left Column: TODA Organization Information & Authorized Officers */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '19px' }}>
          {/* TODA Organization Information Card */}
          <Card
            elevation={0}
            sx={{
              p: '19px',
              borderRadius: '14px',
              border: '1px solid var(--mac-border-color)',
              backgroundColor: '#FFFFFF',
              boxShadow: 'none',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px', mb: '16px' }}>
              <BusinessIcon sx={{ color: 'var(--sakay-orange)', fontSize: 19 }} />
              <Typography sx={{ fontSize: '14px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>
                TODA Organization Information
              </Typography>
            </Box>

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <Box>
                <Typography sx={{ fontSize: '11px', color: 'var(--mac-text-muted)' }}>Official TODA Name</Typography>
                <Typography sx={{ fontSize: '13px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>
                  {profile.name}
                </Typography>
              </Box>

              <Box>
                <Typography sx={{ fontSize: '11px', color: 'var(--mac-text-muted)' }}>Date Established</Typography>
                <Typography sx={{ fontSize: '13px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>
                  {formatDisplayDate(profile.dateEstablished)}
                </Typography>
              </Box>

              <Box>
                <Typography sx={{ fontSize: '11px', color: 'var(--mac-text-muted)' }}>Terminal Location</Typography>
                <Typography sx={{ fontSize: '13px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>
                  {profile.terminalLocation || 'Calapan City Terminal'}
                </Typography>
              </Box>

              <Box>
                <Typography sx={{ fontSize: '11px', color: 'var(--mac-text-muted)' }}>Terminal Coordinates</Typography>
                <Typography sx={{ fontSize: '13px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>
                  {profile.terminalLatitude && profile.terminalLongitude
                    ? `${profile.terminalLatitude}, ${profile.terminalLongitude}`
                    : 'None specified'}
                </Typography>
              </Box>

              <Box>
                <Typography sx={{ fontSize: '11px', color: 'var(--mac-text-muted)' }}>Operating Barangay</Typography>
                <Typography sx={{ fontSize: '13px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>
                  {profile.barangay || 'San Vicente Central'}
                </Typography>
              </Box>
            </Box>
          </Card>

          {/* Officers Card */}
          <Card
            elevation={0}
            sx={{
              p: '19px',
              borderRadius: '14px',
              border: '1px solid var(--mac-border-color)',
              backgroundColor: '#FFFFFF',
              boxShadow: 'none',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px', mb: '13px' }}>
              <GroupsIcon sx={{ color: 'var(--sakay-orange)', fontSize: 19 }} />
              <Typography sx={{ fontSize: '14px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>
                Authorized TODA Officers
              </Typography>
            </Box>

            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '13px' }}>
              <Box>
                <Typography sx={{ fontSize: '11px', color: 'var(--mac-text-muted)' }}>President</Typography>
                <Typography sx={{ fontSize: '13px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>
                  {profile.officers?.president || 'N/A'}
                </Typography>
                {profile.officers?.presidentContact && (
                  <Typography sx={{ fontSize: '11px', color: 'var(--mac-text-muted)' }}>
                    {profile.officers.presidentContact}
                  </Typography>
                )}
              </Box>

              <Box>
                <Typography sx={{ fontSize: '11px', color: 'var(--mac-text-muted)' }}>Vice President</Typography>
                <Typography sx={{ fontSize: '13px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>
                  {profile.officers?.vicePresident || 'N/A'}
                </Typography>
                {profile.officers?.vicePresidentContact && (
                  <Typography sx={{ fontSize: '11px', color: 'var(--mac-text-muted)' }}>
                    {profile.officers.vicePresidentContact}
                  </Typography>
                )}
              </Box>

              <Box>
                <Typography sx={{ fontSize: '11px', color: 'var(--mac-text-muted)' }}>Secretary</Typography>
                <Typography sx={{ fontSize: '13px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>
                  {profile.officers?.secretary || 'N/A'}
                </Typography>
                {profile.officers?.secretaryContact && (
                  <Typography sx={{ fontSize: '11px', color: 'var(--mac-text-muted)' }}>
                    {profile.officers.secretaryContact}
                  </Typography>
                )}
              </Box>

              <Box>
                <Typography sx={{ fontSize: '11px', color: 'var(--mac-text-muted)' }}>Treasurer</Typography>
                <Typography sx={{ fontSize: '13px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>
                  {profile.officers?.treasurer || 'N/A'}
                </Typography>
                {profile.officers?.treasurerContact && (
                  <Typography sx={{ fontSize: '11px', color: 'var(--mac-text-muted)' }}>
                    {profile.officers.treasurerContact}
                  </Typography>
                )}
              </Box>
            </Box>
          </Card>
        </Box>

        {/* Right Column: Annual Compliance & Accreditation Renewal */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '19px' }}>
          <Card
            elevation={0}
            sx={{
              p: '19px',
              borderRadius: '14px',
              border: '1px solid var(--mac-border-color)',
              backgroundColor: '#FFFFFF',
              boxShadow: 'none',
              height: '100%',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: '13px', flexWrap: 'wrap', gap: '13px' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <ShieldIcon sx={{ color: '#059669', fontSize: 19 }} />
                <Typography sx={{ fontSize: '14px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>
                  Annual Compliance & Accreditation Renewal
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
                <Chip
                  label={accreditationChip(profile.accreditationStatus).label}
                  size="small"
                  sx={{
                    backgroundColor: documentChip(profile.accreditationStatus, Boolean(profile.renewalSubmittedAt)).bg,
                    color: documentChip(profile.accreditationStatus, Boolean(profile.renewalSubmittedAt)).color,
                    fontWeight: 600,
                    fontSize: '11px',
                  }}
                />
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<UploadFileIcon fontSize="small" />}
                  onClick={() => {
                    setDocCategory('Barangay Clearance');
                    setSelectedFile(null);
                    setUploadDocModalOpen(true);
                  }}
                  sx={{
                    textTransform: 'none',
                    backgroundColor: 'var(--sakay-orange)',
                    fontWeight: 700,
                    borderRadius: '6.5px',
                    fontSize: '11px',
                    px: '13px',
                    height: 27,
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                    boxShadow: 'none',
                    '&:hover': {
                      backgroundColor: '#E65C00',
                      boxShadow: 'none',
                    },
                  }}
                >
                  Re-upload Document
                </Button>
              </Box>
            </Box>

            <Typography sx={{ fontSize: '11.5px', color: 'var(--mac-text-muted)', mb: '13px' }}>
              Official compliance files forwarded to City LGU Franchising Office for accreditation review. You can view, drag-and-drop, or re-upload updated files anytime.
            </Typography>

            <Box sx={{ display: 'flex', flexDirection: 'column', gap: '13px' }}>
              {/* Document 1: Barangay Clearance */}
              <Box
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  e.dataTransfer.dropEffect = 'copy';
                }}
                onDragEnter={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setActiveDropCategory('clearance');
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setActiveDropCategory(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setActiveDropCategory(null);
                  if (e.dataTransfer.files?.[0]) {
                    handleDroppedFileForCategory(e.dataTransfer.files[0], 'Barangay Clearance');
                  }
                }}
                sx={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  p: '14px',
                  borderRadius: '10px',
                  backgroundColor: activeDropCategory === 'clearance' ? '#FFF7ED' : '#FAFAFC',
                  border: activeDropCategory === 'clearance' ? '2px dashed var(--sakay-orange)' : '1px solid var(--mac-border-color)',
                  transition: 'all 0.2s ease',
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: '10px', flex: 1, minWidth: 0, mr: '19px', pointerEvents: 'none' }}>
                  <DescriptionIcon sx={{ color: 'var(--sakay-orange)', fontSize: 19, flexShrink: 0, mt: '2.5px' }} />
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography sx={{ fontSize: '12px', fontWeight: 700, color: 'var(--mac-text-primary)', mb: '6px' }}>
                      Barangay Clearance for TODA Accreditation
                    </Typography>

                    <Box sx={{ mb: '6px' }}>
                      <Chip
                        label={documentChip(profile.accreditationStatus, Boolean(profile.renewalSubmittedAt)).label}
                        size="small"
                        sx={{
                          height: 18,
                          fontSize: '11px',
                          fontWeight: 600,
                          backgroundColor: documentChip(profile.accreditationStatus, Boolean(profile.renewalSubmittedAt)).bg,
                          color: documentChip(profile.accreditationStatus, Boolean(profile.renewalSubmittedAt)).color,
                          borderRadius: '5px',
                        }}
                      />
                    </Box>

                    <Typography sx={{ fontSize: '11px', fontWeight: 600, color: '#334155', wordBreak: 'break-all' }}>
                      {profile.barangayClearanceFile.name}
                    </Typography>
                    <Typography sx={{ fontSize: '11px', color: '#64748B', mt: '3px' }}>
                      {profile.barangayClearanceFile.date ? `Submitted ${profile.barangayClearanceFile.date}` : 'No file submitted yet'}
                    </Typography>
                  </Box>
                </Box>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: '6px', flexShrink: 0, minWidth: '88px' }}>
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={<VisibilityIcon fontSize="small" />}
                    onClick={() =>
                      setReviewModalState({
                        open: true,
                        title: 'Barangay Clearance for TODA Accreditation',
                        fileName: profile.barangayClearanceFile.name,
                        fileUrl: profile.barangayClearanceFile.url || '',
                      })
                    }
                    sx={{
                      height: 26,
                      px: '13px',
                      borderRadius: '6.5px',
                      fontSize: '11px',
                      fontWeight: 600,
                      textTransform: 'none',
                      whiteSpace: 'nowrap',
                      justifyContent: 'center',
                      color: 'var(--sakay-orange)',
                      borderColor: 'var(--sakay-orange-border)',
                      backgroundColor: 'var(--sakay-orange-soft)',
                      '&:hover': {
                        backgroundColor: 'rgba(255, 102, 0, 0.16)',
                        borderColor: 'var(--sakay-orange)',
                      },
                    }}
                  >
                    View
                  </Button>
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={<UploadFileIcon fontSize="small" />}
                    onClick={() => {
                      setDocCategory('Barangay Clearance');
                      setSelectedFile(null);
                      setUploadDocModalOpen(true);
                    }}
                    sx={{
                      height: 26,
                      px: '13px',
                      borderRadius: '6.5px',
                      fontSize: '11px',
                      fontWeight: 600,
                      textTransform: 'none',
                      whiteSpace: 'nowrap',
                      justifyContent: 'center',
                      color: '#1565C0',
                      borderColor: '#BBDEFB',
                      backgroundColor: '#F0F7FF',
                      '&:hover': {
                        backgroundColor: '#E3F2FD',
                        borderColor: '#1565C0',
                      },
                    }}
                  >
                    Re-upload
                  </Button>
                </Box>
              </Box>

              {/* Document 2: Driver Roster */}
              <Box
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  e.dataTransfer.dropEffect = 'copy';
                }}
                onDragEnter={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setActiveDropCategory('roster');
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setActiveDropCategory(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setActiveDropCategory(null);
                  if (e.dataTransfer.files?.[0]) {
                    handleDroppedFileForCategory(e.dataTransfer.files[0], 'Driver Roster');
                  }
                }}
                sx={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  p: '14px',
                  borderRadius: '10px',
                  backgroundColor: activeDropCategory === 'roster' ? '#FFF7ED' : '#FAFAFC',
                  border: activeDropCategory === 'roster' ? '2px dashed var(--sakay-orange)' : '1px solid var(--mac-border-color)',
                  transition: 'all 0.2s ease',
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: '10px', flex: 1, minWidth: 0, mr: '19px', pointerEvents: 'none' }}>
                  <DescriptionIcon sx={{ color: '#1565C0', fontSize: 19, flexShrink: 0, mt: '2.5px' }} />
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography sx={{ fontSize: '12px', fontWeight: 700, color: 'var(--mac-text-primary)', mb: '6px' }}>
                      Driver Roster
                    </Typography>

                    <Box sx={{ mb: '6px' }}>
                      <Chip
                        label={documentChip(profile.accreditationStatus, Boolean(profile.renewalSubmittedAt)).label}
                        size="small"
                        sx={{
                          height: 18,
                          fontSize: '11px',
                          fontWeight: 600,
                          backgroundColor: documentChip(profile.accreditationStatus, Boolean(profile.renewalSubmittedAt)).bg,
                          color: documentChip(profile.accreditationStatus, Boolean(profile.renewalSubmittedAt)).color,
                          borderRadius: '5px',
                        }}
                      />
                    </Box>

                    <Typography sx={{ fontSize: '11px', fontWeight: 600, color: '#334155', wordBreak: 'break-all' }}>
                      {profile.rosterFile.name}
                    </Typography>
                    <Typography sx={{ fontSize: '11px', color: '#64748B', mt: '3px' }}>
                      {profile.rosterFile.count} Accredited Members
                    </Typography>
                  </Box>
                </Box>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: '6px', flexShrink: 0, minWidth: '88px' }}>
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={<VisibilityIcon fontSize="small" />}
                    onClick={() =>
                      setReviewModalState({
                        open: true,
                        title: 'Driver Roster',
                        fileName: profile.rosterFile.name,
                        fileUrl: profile.rosterFile.url || '',
                      })
                    }
                    sx={{
                      height: 26,
                      px: '13px',
                      borderRadius: '6.5px',
                      fontSize: '11px',
                      fontWeight: 600,
                      textTransform: 'none',
                      whiteSpace: 'nowrap',
                      justifyContent: 'center',
                      color: 'var(--sakay-orange)',
                      borderColor: 'var(--sakay-orange-border)',
                      backgroundColor: 'var(--sakay-orange-soft)',
                      '&:hover': {
                        backgroundColor: 'rgba(255, 102, 0, 0.16)',
                        borderColor: 'var(--sakay-orange)',
                      },
                    }}
                  >
                    View
                  </Button>
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={<UploadFileIcon fontSize="small" />}
                    onClick={() => {
                      setDocCategory('Driver Roster');
                      setSelectedFile(null);
                      setUploadDocModalOpen(true);
                    }}
                    sx={{
                      height: 26,
                      px: '13px',
                      borderRadius: '6.5px',
                      fontSize: '11px',
                      fontWeight: 600,
                      textTransform: 'none',
                      whiteSpace: 'nowrap',
                      justifyContent: 'center',
                      color: '#1565C0',
                      borderColor: '#BBDEFB',
                      backgroundColor: '#F0F7FF',
                      '&:hover': {
                        backgroundColor: '#E3F2FD',
                        borderColor: '#1565C0',
                      },
                    }}
                  >
                    Re-upload
                  </Button>
                </Box>
              </Box>

              {/* Document 3: Internal TODA Bylaws */}
              <Box
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  e.dataTransfer.dropEffect = 'copy';
                }}
                onDragEnter={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setActiveDropCategory('bylaws');
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setActiveDropCategory(null);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setActiveDropCategory(null);
                  if (e.dataTransfer.files?.[0]) {
                    handleDroppedFileForCategory(e.dataTransfer.files[0], 'Internal Bylaws');
                  }
                }}
                sx={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  p: '14px',
                  borderRadius: '10px',
                  backgroundColor: activeDropCategory === 'bylaws' ? '#FFF7ED' : '#FAFAFC',
                  border: activeDropCategory === 'bylaws' ? '2px dashed var(--sakay-orange)' : '1px solid var(--mac-border-color)',
                  transition: 'all 0.2s ease',
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: '10px', flex: 1, minWidth: 0, mr: '19px', pointerEvents: 'none' }}>
                  <DescriptionIcon sx={{ color: '#059669', fontSize: 19, flexShrink: 0, mt: '2.5px' }} />
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography sx={{ fontSize: '12px', fontWeight: 700, color: 'var(--mac-text-primary)', mb: '6px' }}>
                      Internal TODA Bylaws & Constitution
                    </Typography>

                    <Box sx={{ mb: '6px' }}>
                      <Chip
                        label={documentChip(profile.accreditationStatus, Boolean(profile.renewalSubmittedAt)).label}
                        size="small"
                        sx={{
                          height: 18,
                          fontSize: '11px',
                          fontWeight: 600,
                          backgroundColor: documentChip(profile.accreditationStatus, Boolean(profile.renewalSubmittedAt)).bg,
                          color: documentChip(profile.accreditationStatus, Boolean(profile.renewalSubmittedAt)).color,
                          borderRadius: '5px',
                        }}
                      />
                    </Box>

                    <Typography sx={{ fontSize: '11px', fontWeight: 600, color: '#334155', wordBreak: 'break-all' }}>
                      {profile.bylawsFile?.name || 'TODA_Bylaws.pdf'}
                    </Typography>
                    <Typography sx={{ fontSize: '11px', color: '#64748B', mt: '3px' }}>
                      {profile.bylawsFile?.date ? `Submitted ${profile.bylawsFile.date}` : 'No file submitted yet'}
                    </Typography>
                  </Box>
                </Box>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: '6px', flexShrink: 0, minWidth: '88px' }}>
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={<VisibilityIcon fontSize="small" />}
                    onClick={() =>
                      setReviewModalState({
                        open: true,
                        title: 'Internal TODA Bylaws & Constitution',
                        fileName: profile.bylawsFile?.name || 'TODA_Bylaws.pdf',
                        fileUrl: profile.bylawsFile?.url || '',
                      })
                    }
                    sx={{
                      height: 26,
                      px: '13px',
                      borderRadius: '6.5px',
                      fontSize: '11px',
                      fontWeight: 600,
                      textTransform: 'none',
                      whiteSpace: 'nowrap',
                      justifyContent: 'center',
                      color: 'var(--sakay-orange)',
                      borderColor: 'var(--sakay-orange-border)',
                      backgroundColor: 'var(--sakay-orange-soft)',
                      '&:hover': {
                        backgroundColor: 'rgba(255, 102, 0, 0.16)',
                        borderColor: 'var(--sakay-orange)',
                      },
                    }}
                  >
                    View
                  </Button>
                  <Button
                    variant="outlined"
                    size="small"
                    startIcon={<UploadFileIcon fontSize="small" />}
                    onClick={() => {
                      setDocCategory('Internal Bylaws');
                      setSelectedFile(null);
                      setUploadDocModalOpen(true);
                    }}
                    sx={{
                      height: 26,
                      px: '13px',
                      borderRadius: '6.5px',
                      fontSize: '11px',
                      fontWeight: 600,
                      textTransform: 'none',
                      whiteSpace: 'nowrap',
                      justifyContent: 'center',
                      color: '#1565C0',
                      borderColor: '#BBDEFB',
                      backgroundColor: '#F0F7FF',
                      '&:hover': {
                        backgroundColor: '#E3F2FD',
                        borderColor: '#1565C0',
                      },
                    }}
                  >
                    Re-upload
                  </Button>
                </Box>
              </Box>
            </Box>
          </Card>
        </Box>
      </Box>

      {/* 2b. The administrator's own password */}
      <ChangePasswordCard />

      {/* 3. Edit TODA Organizational Profile Centered Modal (Exact TODA Registration Labels & Layout) */}
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
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '19px', pt: '6px' }}>
          {/* Section 1: Association Information */}
          <Box>
            <Typography sx={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--sakay-orange)', textTransform: 'uppercase', mb: '13px', letterSpacing: '0.5px' }}>
              1. Association Information
            </Typography>

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: '16px', mb: '16px' }}>
              <TextField
                label="Official Association / TODA Name *"
                placeholder="e.g. Calapan Central Tricycle Operators & Drivers Association"
                value={editTodaName}
                onChange={(e) => setEditTodaName(e.target.value)}
                required
                fullWidth
                size="small"
              />
              <TextField
                label="TODA Acronym *"
                placeholder="e.g. CCTODA"
                value={editTodaAcronym}
                onChange={(e) => setEditTodaAcronym(e.target.value.toUpperCase())}
                required
                fullWidth
                size="small"
              />
            </Box>

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: '16px', mb: '16px' }}>
              <FormControl fullWidth size="small">
                <InputLabel id="edit-barangay-label">Operating Barangay *</InputLabel>
                <Select
                  labelId="edit-barangay-label"
                  label="Operating Barangay *"
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
                label="Date Established *"
                type="date"
                value={editDateEst}
                onChange={(e) => setEditDateEst(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
                required
                fullWidth
                size="small"
              />
            </Box>

            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: '16px' }}>
              <TextField
                label="Terminal Location *"
                placeholder="e.g. Calapan Public Market, J.P. Rizal St."
                value={editTerminalLoc}
                onChange={(e) => setEditTerminalLoc(e.target.value)}
                required
                fullWidth
                size="small"
              />
              <TextField
                label="Terminal Coordinates"
                placeholder="Latitude, Longitude"
                value={editTerminalCoordinates}
                onChange={(e) => setEditTerminalCoordinates(e.target.value)}
                fullWidth
                size="small"
              />
            </Box>
          </Box>

          <Divider sx={{ borderColor: 'var(--mac-border-color)' }} />

          {/* Section 2: Authorized Association Officers */}
          <Box>
            <Typography sx={{ fontSize: '11.5px', fontWeight: 700, color: 'var(--sakay-orange)', textTransform: 'uppercase', mb: '13px', letterSpacing: '0.5px' }}>
              2. Executive Officers
            </Typography>

            {/* President */}
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: '16px', mb: '16px' }}>
              <TextField
                label="President Full Name *"
                placeholder="e.g. Roberto Alcantara"
                value={editPresident}
                onChange={(e) => setEditPresident(e.target.value)}
                required
                fullWidth
                size="small"
              />
              <TextField
                label="President Mobile Contact *"
                placeholder="e.g. 0917 555 1001"
                value={editPresidentContact}
                onChange={(e) => setEditPresidentContact(formatPhoneNumber(e.target.value))}
                required
                fullWidth
                size="small"
              />
            </Box>

            {/* Vice President */}
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: '16px', mb: '16px' }}>
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

            {/* Secretary */}
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: '16px', mb: '16px' }}>
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

            {/* Treasurer */}
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: '16px' }}>
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

      {/* 4. Upload Annual Compliance Document Centered Modal */}
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
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <FormControl fullWidth size="small">
            <InputLabel id="doc-select-label" sx={{ fontSize: '12px', color: 'var(--mac-text-secondary)' }}>
              Document
            </InputLabel>
            <Select
              labelId="doc-select-label"
              label="Document"
              value={docCategory}
              onChange={(e) => {
                setDocCategory(e.target.value as any);
                setSelectedFile(null);
              }}
              sx={{
                borderRadius: '8px',
                backgroundColor: '#FFFFFF',
                fontSize: '12px',
                fontWeight: 600,
                '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                  borderColor: 'var(--sakay-orange) !important',
                  borderWidth: '2px',
                },
              }}
            >
              <MenuItem value="Barangay Clearance" sx={{ fontSize: '12px', py: '8px' }}>
                Barangay Clearance
              </MenuItem>
              <MenuItem value="Driver Roster" sx={{ fontSize: '12px', py: '8px' }}>
                Driver Roster
              </MenuItem>
              <MenuItem value="Internal Bylaws" sx={{ fontSize: '12px', py: '8px' }}>
                Internal Bylaws
              </MenuItem>
            </Select>
          </FormControl>

          {/* Real Drag & Drop File Upload Zone */}
          <Box>
            <Typography sx={{ fontSize: '12px', fontWeight: 600, color: 'var(--mac-text-primary)', mb: '6px' }}>
              Attach Compliance Document File
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
                border: isDraggingModalZone
                  ? '2px solid var(--sakay-orange)'
                  : '2px dashed var(--sakay-orange-border)',
                backgroundColor: isDraggingModalZone
                  ? 'rgba(255, 102, 0, 0.16)'
                  : 'var(--sakay-orange-soft)',
                boxShadow: isDraggingModalZone ? '0 0 0 4px rgba(255, 102, 0, 0.2)' : 'none',
                cursor: 'pointer',
                transition: 'all 0.2s ease',
                '&:hover': {
                  backgroundColor: 'rgba(255, 102, 0, 0.12)',
                  borderColor: 'var(--sakay-orange)',
                },
                '& > *': {
                  pointerEvents: 'none',
                },
              }}
            >
              <input
                type="file"
                hidden
                style={{ display: 'none' }}
                accept={getCategoryFileSupport().accept}
                onChange={handleFileSelect}
              />
              <UploadFileIcon sx={{ fontSize: 32, color: 'var(--sakay-orange)', mb: '6px' }} />
              <Typography sx={{ fontSize: '12px', fontWeight: 700, color: 'var(--mac-text-primary)' }}>
                {isDraggingModalZone ? 'Drop file to attach' : selectedFile ? selectedFile.name : 'Click or Drag File to Attach'}
              </Typography>
              <Typography sx={{ fontSize: '11px', color: 'var(--mac-text-muted)', mt: '3px' }}>
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
                  mt: '10px',
                  p: '10px',
                  borderRadius: '8px',
                  backgroundColor: '#F5F5F7',
                  border: '1px solid var(--mac-border-color)',
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <InsertDriveFileIcon sx={{ color: 'var(--sakay-orange)' }} />
                  <Typography sx={{ fontSize: '11.5px', fontWeight: 600, color: 'var(--mac-text-primary)' }}>
                    {selectedFile.name}
                  </Typography>
                </Box>
                <Chip label="Selected File" size="small" color="primary" sx={{ fontSize: '11px', fontWeight: 600 }} />
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

          <Typography sx={{ fontSize: '11px', color: 'var(--mac-text-muted)', lineHeight: 1.4 }}>
            {profile.accreditationStatus === 'Active'
              ? 'A renewed Barangay Clearance goes to the City LGU Franchising Office. Your accreditation stays as it is until the LGU records the renewal.'
              : 'Submitted compliance files go directly to the City LGU Franchising Office for review.'}
          </Typography>
        </Box>
      </MacCenterModal>

      {/* Document Review Modal (Identical to TODA Registration Review Modal) */}
      <DocumentReviewModal
        open={reviewModalState.open}
        onClose={() => setReviewModalState((prev) => ({ ...prev, open: false }))}
        documentTitle={reviewModalState.title}
        fileName={reviewModalState.fileName}
        fileUrl={reviewModalState.fileUrl}
      />

      {/* Alert / Feedback Snackbar */}
      <Snackbar
        open={uploadSnackbar.open}
        autoHideDuration={6000}
        onClose={() => setUploadSnackbar((prev) => ({ ...prev, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert
          onClose={() => setUploadSnackbar((prev) => ({ ...prev, open: false }))}
          severity={uploadSnackbar.severity}
          variant="filled"
          sx={{ width: '100%', fontWeight: 600, borderRadius: '8px' }}
        >
          {uploadSnackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};
