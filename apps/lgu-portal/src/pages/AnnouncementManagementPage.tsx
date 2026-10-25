import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Button,
  TextField,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
  Chip,
  RadioGroup,
  FormControlLabel,
  Radio,
  Snackbar,
  Alert,
} from '@mui/material';
import CampaignIcon from '@mui/icons-material/Campaign';
import AddAlertIcon from '@mui/icons-material/AddAlert';
import PublishIcon from '@mui/icons-material/Publish';
import UnpublishedIcon from '@mui/icons-material/Unpublished';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';

import { AnnouncementRecord, AccreditedTodaRecord } from '../mockData/adminData';
import { FilterToolbar, FilterOption } from '../components/admin/FilterToolbar';
import { StatusBadge } from '../components/common/StatusBadge';
import { ActionButton } from '../components/admin/ActionButton';
import { MacCenterModal } from '../components/admin/MacCenterModal';
import { MacConfirmDialog } from '../components/admin/MacConfirmDialog';
import { CalamityPanel } from '../components/admin/CalamityPanel';
import { TableEmptyState } from '../components/common/TableEmptyState';
import {
  fetchAnnouncements,
  fetchAccreditedTodas,
  createAnnouncement,
  updateAnnouncement,
  setAnnouncementPublished,
  deleteAnnouncement,
} from '../services/adminApiService';
import { CONTROL, FONT } from '../styles/density';

/**
 * ============================================================================
 * ANNOUNCEMENT MANAGEMENT PAGE COMPONENT
 * ============================================================================
 * Purpose:
 *   Enables LGU Transport Administrators to draft, publish, edit, unpublish
 *   and delete city-wide municipal notices targeted to commuters, tricycle
 *   drivers, or TODA administrators. Every change is saved to the database
 *   (which stamps the publication times); a failed save is shown, never hidden.
 * ============================================================================
 */
export const AnnouncementManagementPage: React.FC = () => {
  // State: Broadcast bulletins list and filter options
  const [announcements, setAnnouncements] = useState<AnnouncementRecord[]>([]);
  const [todasList, setTodasList] = useState<AccreditedTodaRecord[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');

  // Selected announcement for detail/management
  const [selectedAnn, setSelectedAnn] = useState<AnnouncementRecord | null>(null);

  // Modals & Dialogs
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // Form State: Creating a new announcement
  const [formTitle, setFormTitle] = useState('');
  const [formMessage, setFormMessage] = useState('');
  const [formRole, setFormRole] = useState<AnnouncementRecord['target_role']>('All');
  const [formTodaId, setFormTodaId] = useState<string>('all-todas');
  const [formPublish, setFormPublish] = useState<boolean>(true);
  // the announcement being edited (null = composing a new one)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ severity: 'success' | 'error'; text: string } | null>(null);

  /**
   * Effect: Fetch live municipal announcements and accredited TODAs on initial mount.
   */
  useEffect(() => {
    let isMounted = true;
    Promise.all([fetchAnnouncements(), fetchAccreditedTodas()])
      .then(([annData, todaData]) => {
        if (isMounted) {
          setAnnouncements(annData || []);
          setTodasList(todaData || []);
        }
      })
      .catch((err) => {
        console.warn('[AnnouncementManagement] Failed to fetch data:', err);
        if (isMounted) setNotice({ severity: 'error', text: `The announcements could not be loaded: ${err?.message ?? 'unknown error'}` });
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  // Filter logic: Search by title, message, or TODA name
  const filteredAnnouncements = announcements.filter((ann) => {
    const matchesSearch =
      ann.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ann.message.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (ann.toda_name && ann.toda_name.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesRole = roleFilter === 'All' || ann.target_role === roleFilter;
    const matchesStatus =
      statusFilter === 'All' ||
      (statusFilter === 'Published' && ann.is_published) ||
      (statusFilter === 'Draft / Unpublished' && !ann.is_published);

    return matchesSearch && matchesRole && matchesStatus;
  });

  // KPI stat counts
  const totalCount = announcements.length;
  const publishedCount = announcements.filter((a) => a.is_published).length;
  const todaScopedCount = announcements.filter((a) => a.toda_id !== null).length;
  const draftCount = announcements.filter((a) => !a.is_published).length;

  const roleOptions: FilterOption[] = [
    { label: 'All Audiences', value: 'All' },
    { label: 'All Users', value: 'All' },
    { label: 'Passengers', value: 'Passenger' },
    { label: 'Drivers', value: 'Driver' },
    { label: 'TODA Administrators', value: 'TODA Administrator' },
  ];

  const statusOptions: FilterOption[] = [
    { label: 'All Statuses', value: 'All' },
    { label: 'Published', value: 'Published' },
    { label: 'Draft / Unpublished', value: 'Draft / Unpublished' },
  ];

  const getRoleBadgeStyle = (role: AnnouncementRecord['target_role']) => {
    switch (role) {
      case 'All':
        return { bg: 'rgba(255, 102, 0, 0.12)', color: 'var(--sakay-orange)' };
      case 'Passenger':
        return { bg: 'rgba(26, 115, 232, 0.12)', color: '#1A73E8' };
      case 'Driver':
        return { bg: 'rgba(46, 125, 50, 0.12)', color: '#2E7D32' };
      case 'TODA Administrator':
        return { bg: 'rgba(106, 27, 154, 0.12)', color: '#6A1B9A' };
      default:
        return { bg: '#F1F3F4', color: '#5F6368' };
    }
  };

  /** Reads the list again from the database (what the apps and the audit log will see) and keeps the open details window in step. */
  const reload = async () => {
    const fresh = (await fetchAnnouncements()) || [];
    setAnnouncements(fresh);
    setSelectedAnn((prev) => (prev ? fresh.find((a) => a.id === prev.id) ?? null : null));
  };

  const failure = (err: unknown) => setNotice({ severity: 'error', text: err instanceof Error ? err.message : 'The change could not be saved.' });

  const resetForm = () => {
    setEditingId(null);
    setFormTitle('');
    setFormMessage('');
    setFormRole('All');
    setFormTodaId('all-todas');
    setFormPublish(true);
  };

  const openCreate = () => {
    resetForm();
    setCreateModalOpen(true);
  };

  const openEdit = (ann: AnnouncementRecord) => {
    setEditingId(ann.id);
    setFormTitle(ann.title);
    setFormMessage(ann.message);
    setFormRole(ann.target_role);
    setFormTodaId(ann.toda_id || 'all-todas');
    setFormPublish(ann.is_published);
    setSelectedAnn(null);
    setCreateModalOpen(true);
  };

  /**
   * Action Handler: saves a new announcement, or the changes to the one being edited, in the database.
   * The list is reloaded afterwards, so what is shown is what was saved.
   */
  const handleSaveSubmit = async () => {
    if (!formTitle.trim() || !formMessage.trim() || saving) return;
    setSaving(true);
    const input = {
      title: formTitle.trim(),
      message: formMessage.trim(),
      targetRole: formRole,
      targetTodaId: formRole !== 'All' && formTodaId !== 'all-todas' ? formTodaId : null,
    };
    try {
      if (editingId) {
        await updateAnnouncement(editingId, input);
        setNotice({ severity: 'success', text: 'The announcement was updated.' });
      } else {
        await createAnnouncement({ ...input, publish: formPublish });
        setNotice({ severity: 'success', text: formPublish ? 'The announcement was published.' : 'Saved as a draft. Open it and choose Publish when it is ready.' });
      }
      setCreateModalOpen(false);
      resetForm();
      await reload();
    } catch (err) {
      failure(err);
    } finally {
      setSaving(false);
    }
  };

  /**
   * Action Handler: publishes or unpublishes an announcement (saved; the database stamps the time).
   */
  const handleTogglePublish = async (ann: AnnouncementRecord) => {
    const next = !ann.is_published;
    try {
      await setAnnouncementPublished(ann.id, next, ann.title);
      await reload();
      setNotice({ severity: 'success', text: next ? 'The announcement is published.' : 'The announcement is unpublished: the apps no longer show it.' });
    } catch (err) {
      failure(err);
    }
  };

  /**
   * Action Handler: deletes an announcement record.
   */
  const handleDeleteConfirm = async () => {
    if (!selectedAnn) return;
    try {
      await deleteAnnouncement(selectedAnn.id, selectedAnn.title);
      setSelectedAnn(null);
      await reload();
      setNotice({ severity: 'success', text: 'The announcement was deleted.' });
    } catch (err) {
      failure(err);
    } finally {
      setDeleteDialogOpen(false);
    }
  };

  return (
    <Box sx={{ maxWidth: 1600, margin: '0 auto', pb: 4.8 }}>
      {/* 0. Rules 15.4 / 29.6: declaring a calamity (the announcement and the strike pause, one audited action) */}
      <CalamityPanel
        onChanged={async () => {
          try {
            await reload();
          } catch (err) {
            failure(err);
          }
        }}
      />

      {/* 1. Summary Cards */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' },
          gap: 2,
          mb: 2.8,
        }}
      >
        <Box sx={{ backgroundColor: '#FFFFFF', borderRadius: 'var(--mac-radius-lg)', border: '1px solid var(--mac-border-color)', padding: '13px 16px', boxShadow: 'var(--mac-shadow-card)' }}>
          <Typography sx={{ fontSize: FONT.caption, fontWeight: 500, color: 'var(--mac-text-muted)', mb: 0.8 }}>Total Announcements</Typography>
          <Typography sx={{ fontSize: '22px', fontWeight: 700, color: 'var(--mac-text-primary)' }}>{totalCount}</Typography>
        </Box>
        <Box sx={{ backgroundColor: '#FFFFFF', borderRadius: 'var(--mac-radius-lg)', border: '1px solid var(--mac-border-color)', padding: '13px 16px', boxShadow: 'var(--mac-shadow-card)' }}>
          <Typography sx={{ fontSize: FONT.caption, fontWeight: 500, color: 'var(--mac-text-muted)', mb: 0.8 }}>Active Broadcasts</Typography>
          <Typography sx={{ fontSize: '22px', fontWeight: 700, color: '#2E7D32' }}>{publishedCount}</Typography>
        </Box>
        <Box sx={{ backgroundColor: '#FFFFFF', borderRadius: 'var(--mac-radius-lg)', border: '1px solid var(--mac-border-color)', padding: '13px 16px', boxShadow: 'var(--mac-shadow-card)' }}>
          <Typography sx={{ fontSize: FONT.caption, fontWeight: 500, color: 'var(--mac-text-muted)', mb: 0.8 }}>TODA Scoped Notices</Typography>
          <Typography sx={{ fontSize: '22px', fontWeight: 700, color: '#1565C0' }}>{todaScopedCount}</Typography>
        </Box>
        <Box sx={{ backgroundColor: '#FFFFFF', borderRadius: 'var(--mac-radius-lg)', border: '1px solid var(--mac-border-color)', padding: '13px 16px', boxShadow: 'var(--mac-shadow-card)' }}>
          <Typography sx={{ fontSize: FONT.caption, fontWeight: 500, color: 'var(--mac-text-muted)', mb: 0.8 }}>Drafts</Typography>
          <Typography sx={{ fontSize: '22px', fontWeight: 700, color: 'var(--sakay-orange)' }}>{draftCount}</Typography>
        </Box>
      </Box>

      {/* 2. Filter Toolbar with "+ New Announcement" */}
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, alignItems: { md: 'stretch' }, justifyContent: 'space-between', gap: 1.6, mb: 2.4 }}>
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <FilterToolbar
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            searchPlaceholder="Search announcement title, text, or TODA scope..."
            selectFilters={[
              {
                id: 'role',
                label: 'Audience',
                value: roleFilter,
                options: roleOptions,
                onChange: setRoleFilter,
              },
              {
                id: 'status',
                label: 'Status',
                value: statusFilter,
                options: statusOptions,
                onChange: setStatusFilter,
              },
            ]}
            onResetFilters={() => {
              setSearchQuery('');
              setRoleFilter('All');
              setStatusFilter('All');
            }}
            disableMarginBottom
          />
        </Box>

        <Button
          onClick={openCreate}
          startIcon={<AddAlertIcon fontSize="small" />}
          variant="contained"
          sx={{
            height: 'auto',
            alignSelf: 'stretch',
            padding: '0 19px',
            borderRadius: 'var(--mac-radius-lg)',
            textTransform: 'none',
            fontSize: FONT.body,
            fontWeight: 600,
            backgroundColor: 'var(--sakay-orange)',
            color: '#FFFFFF',
            whiteSpace: 'nowrap',
            boxShadow: 'var(--mac-shadow-subtle)',
            flexShrink: 0,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'var(--mac-transition-fast)',
            '&:hover': {
              backgroundColor: 'var(--sakay-orange-hover)',
            },
          }}
        >
          New Announcement
        </Button>
      </Box>

      {/* 3. Announcements Table */}
      <TableContainer
        component={Paper}
        elevation={0}
        sx={{
          borderRadius: 'var(--mac-radius-lg)',
          border: '1px solid var(--mac-border-color)',
          boxShadow: 'var(--mac-shadow-card)',
          overflow: 'hidden',
        }}
      >
        <Table>
          <TableHead sx={{ backgroundColor: '#FAFAFC' }}>
            <TableRow>
              <TableCell sx={{ fontWeight: 600, fontSize: FONT.small, color: 'var(--mac-text-muted)', py: 1.6, px: 2.4 }}>Announcement Title & Message</TableCell>
              <TableCell sx={{ fontWeight: 600, fontSize: FONT.small, color: 'var(--mac-text-muted)', py: 1.6, px: 2.4 }}>Target Audience</TableCell>
              <TableCell sx={{ fontWeight: 600, fontSize: FONT.small, color: 'var(--mac-text-muted)', py: 1.6, px: 2.4 }}>TODA / Jurisdiction</TableCell>
              <TableCell sx={{ fontWeight: 600, fontSize: FONT.small, color: 'var(--mac-text-muted)', py: 1.6, px: 2.4 }}>Status</TableCell>
              <TableCell sx={{ fontWeight: 600, fontSize: FONT.small, color: 'var(--mac-text-muted)', py: 1.6, px: 2.4 }}>Created By & Date</TableCell>
              <TableCell align="right" sx={{ fontWeight: 600, fontSize: FONT.small, color: 'var(--mac-text-muted)', py: 1.6, px: 2.4 }}>Actions</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filteredAnnouncements.length > 0 ? (
              filteredAnnouncements.map((ann) => {
                const roleBadge = getRoleBadgeStyle(ann.target_role);
                return (
                  <TableRow
                    key={ann.id}
                    sx={{
                      transition: 'var(--mac-transition-fast)',
                      '&:hover': { backgroundColor: 'var(--mac-canvas-bg)' },
                    }}
                  >
                    <TableCell sx={{ py: 2.2, px: 2.4, maxWidth: 360 }}>
                      <Typography sx={{ fontWeight: 600, fontSize: FONT.body, color: 'var(--mac-text-primary)' }}>
                        {ann.title}
                      </Typography>
                      <Typography
                        sx={{
                          fontSize: FONT.caption,
                          color: 'var(--mac-text-muted)',
                          mt: '3px',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {ann.message}
                      </Typography>
                    </TableCell>
                    <TableCell sx={{ py: 2.2, px: 2.4 }}>
                      <Chip
                        label={ann.target_role === 'All' ? 'All Platform Users' : `${ann.target_role}s`}
                        size="small"
                        sx={{
                          fontSize: FONT.caption,
                          fontWeight: 600,
                          backgroundColor: roleBadge.bg,
                          color: roleBadge.color,
                          height: 26,
                        }}
                      />
                    </TableCell>
                    <TableCell sx={{ fontSize: FONT.body, color: 'var(--mac-text-secondary)', py: 2.2, px: 2.4 }}>
                      {ann.toda_name || 'City-Wide'}
                    </TableCell>
                    <TableCell sx={{ py: 2.2, px: 2.4 }}>
                      <StatusBadge status={ann.is_published ? 'Published' : 'Draft'} />
                    </TableCell>
                    <TableCell sx={{ py: 2.2, px: 2.4 }}>
                      <Typography sx={{ fontSize: FONT.caption, color: 'var(--mac-text-primary)', fontWeight: 500 }}>
                        {ann.created_by_lgu_admin.split('(')[0]}
                      </Typography>
                      <Typography sx={{ fontSize: FONT.caption, color: 'var(--mac-text-muted)', mt: '2px' }}>
                        {ann.created_at}
                      </Typography>
                    </TableCell>
                    <TableCell align="right" sx={{ py: 2.2, px: 2.4 }}>
                      <ActionButton
                        label="Manage"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedAnn(ann);
                        }}
                      />
                    </TableCell>
                  </TableRow>
                );
              })
            ) : (
              <TableEmptyState
                colSpan={6}
                icon={<CampaignIcon />}
                title="No announcements yet."
                description={
                  searchQuery || roleFilter !== 'All' || statusFilter !== 'All'
                    ? 'No announcements match your search or filter parameters.'
                    : 'Municipal announcements and broadcast messages will appear here once you publish them.'
                }
                onRefresh={async () => {
                  setIsLoading(true);
                  try {
                    await reload();
                  } catch (err) {
                    failure(err);
                  } finally {
                    setIsLoading(false);
                  }
                }}
                isRefreshing={isLoading}
              />
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* 4. New Announcement Modal */}
      <MacCenterModal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        title={editingId ? 'Edit Municipal Announcement' : 'Compose Municipal Announcement'}
        subtitle={editingId ? 'Changes are saved to the same announcement.' : 'Broadcast notices, route advisories, or compliance reminders.'}
        maxWidth={544}
        primaryActionLabel={saving ? 'Saving...' : editingId ? 'Save Changes' : formPublish ? 'Publish Now' : 'Save as Draft'}
        onPrimaryAction={handleSaveSubmit}
        secondaryActionLabel="Cancel"
        onSecondaryAction={() => setCreateModalOpen(false)}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            fullWidth
            label="Announcement Headline / Title"
            placeholder="e.g. Annual Franchise Renewal Advisory"
            value={formTitle}
            onChange={(e) => setFormTitle(e.target.value)}
            sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }}
          />

          <TextField
            fullWidth
            multiline
            rows={4}
            label="Official Message Body"
            placeholder="Enter official advisory, instructions, or regulatory details for commuters or operators..."
            value={formMessage}
            onChange={(e) => setFormMessage(e.target.value)}
            sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }}
          />

          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 1.6 }}>
            <FormControl fullWidth>
              <InputLabel id="target-audience-label">Target Audience</InputLabel>
              <Select
                labelId="target-audience-label"
                value={formRole}
                label="Target Audience"
                onChange={(e) => setFormRole(e.target.value as AnnouncementRecord['target_role'])}
                sx={{ borderRadius: '10px' }}
              >
                <MenuItem value="All">All Users (Passengers, Drivers, TODAs)</MenuItem>
                <MenuItem value="Passenger">Passengers Only</MenuItem>
                <MenuItem value="Driver">Tricycle Drivers Only</MenuItem>
                <MenuItem value="TODA Administrator">TODA Administrators Only</MenuItem>
              </Select>
            </FormControl>

            {formRole !== 'All' ? (
              <FormControl fullWidth>
                <InputLabel id="toda-scope-label">TODA Scope</InputLabel>
                <Select
                  labelId="toda-scope-label"
                  value={formTodaId}
                  label="TODA Scope"
                  onChange={(e) => setFormTodaId(e.target.value)}
                  sx={{ borderRadius: '10px' }}
                >
                  <MenuItem value="all-todas">All City TODAs (City-Wide)</MenuItem>
                  {todasList.map((toda) => (
                    <MenuItem key={toda.id} value={toda.id}>
                      {toda.name} ({toda.barangay})
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            ) : (
              <Box sx={{ display: 'flex', alignItems: 'center', backgroundColor: '#F8F9FA', padding: '0 13px', borderRadius: '10px', border: '1px solid var(--mac-border-color)' }}>
                <Typography sx={{ fontSize: FONT.caption, color: 'var(--mac-text-muted)' }}>
                  Jurisdiction: <strong>City-Wide (All Sectors)</strong>
                </Typography>
              </Box>
            )}
          </Box>

          {editingId ? (
            <Box sx={{ backgroundColor: '#FAFAFC', padding: '11px 16px', borderRadius: '10px', border: '1px solid var(--mac-border-color)' }}>
              <Typography sx={{ fontSize: FONT.caption, color: 'var(--mac-text-muted)' }}>
                This announcement stays {formPublish ? 'published' : 'unpublished'}. Use Publish / Unpublish in its details window to change that.
              </Typography>
            </Box>
          ) : (
            <Box sx={{ backgroundColor: '#FAFAFC', padding: '13px 16px', borderRadius: '10px', border: '1px solid var(--mac-border-color)' }}>
              <Typography sx={{ fontSize: FONT.caption, fontWeight: 600, color: 'var(--mac-text-primary)', mb: 0.8 }}>
                Publication
              </Typography>
              <RadioGroup
                row
                value={formPublish ? 'now' : 'draft'}
                onChange={(e) => setFormPublish(e.target.value === 'now')}
              >
                <FormControlLabel value="now" control={<Radio sx={{ color: 'var(--sakay-orange)', '&.Mui-checked': { color: 'var(--sakay-orange)' } }} />} label="Publish now" />
                <FormControlLabel value="draft" control={<Radio sx={{ color: 'var(--sakay-orange)', '&.Mui-checked': { color: 'var(--sakay-orange)' } }} />} label="Save as a draft (nobody sees it yet)" />
              </RadioGroup>
            </Box>
          )}
        </Box>
      </MacCenterModal>

      {/* 5. Manage Announcement Modal */}
      {selectedAnn && (
        <MacCenterModal
          open={Boolean(selectedAnn)}
          onClose={() => setSelectedAnn(null)}
          title={selectedAnn.title}
          subtitle={`Announcement ID: ${selectedAnn.announcement_id} • Target: ${selectedAnn.target_role}`}
          badge={<StatusBadge status={selectedAnn.is_published ? 'Published' : 'Draft'} />}
          maxWidth={560}
        >
          <Box sx={{ mb: 2.4 }}>
            <Box sx={{ backgroundColor: '#FAFAFC', padding: '16px', borderRadius: '12px', border: '1px solid var(--mac-border-color)', mb: 2.4 }}>
              <Typography sx={{ fontSize: FONT.body, color: 'var(--mac-text-primary)', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                "{selectedAnn.message}"
              </Typography>
            </Box>

            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 1.6, backgroundColor: '#F5F5F7', padding: '14px', borderRadius: '12px', mb: 2.4 }}>
              <Box>
                <Typography sx={{ fontSize: FONT.caption, color: 'var(--mac-text-muted)' }}>Target Audience</Typography>
                <Typography sx={{ fontSize: FONT.body, fontWeight: 600, color: 'var(--mac-text-primary)' }}>{selectedAnn.target_role}</Typography>
              </Box>
              <Box>
                <Typography sx={{ fontSize: FONT.caption, color: 'var(--mac-text-muted)' }}>TODA Scope</Typography>
                <Typography sx={{ fontSize: FONT.body, fontWeight: 600, color: 'var(--mac-text-primary)' }}>{selectedAnn.toda_name || 'City-Wide'}</Typography>
              </Box>
              <Box>
                <Typography sx={{ fontSize: FONT.caption, color: 'var(--mac-text-muted)' }}>Author / Officer</Typography>
                <Typography sx={{ fontSize: FONT.small, fontWeight: 500, color: 'var(--mac-text-primary)' }}>{selectedAnn.created_by_lgu_admin}</Typography>
              </Box>
              <Box>
                <Typography sx={{ fontSize: FONT.caption, color: 'var(--mac-text-muted)' }}>Created</Typography>
                <Typography sx={{ fontSize: FONT.small, fontWeight: 500, color: 'var(--mac-text-primary)' }}>{selectedAnn.created_at}</Typography>
              </Box>
              <Box>
                <Typography sx={{ fontSize: FONT.caption, color: 'var(--mac-text-muted)' }}>Published</Typography>
                <Typography sx={{ fontSize: FONT.small, fontWeight: 500, color: 'var(--mac-text-primary)' }}>{selectedAnn.published_at ?? 'Not published yet'}</Typography>
              </Box>
              <Box>
                <Typography sx={{ fontSize: FONT.caption, color: 'var(--mac-text-muted)' }}>Unpublished</Typography>
                <Typography sx={{ fontSize: FONT.small, fontWeight: 500, color: 'var(--mac-text-primary)' }}>{selectedAnn.unpublished_at ?? '\u2014'}</Typography>
              </Box>
              <Box>
                <Typography sx={{ fontSize: FONT.caption, color: 'var(--mac-text-muted)' }}>Last changed</Typography>
                <Typography sx={{ fontSize: FONT.small, fontWeight: 500, color: 'var(--mac-text-primary)' }}>{selectedAnn.updated_at ?? '\u2014'}</Typography>
              </Box>
            </Box>

            {/* Actions Bar */}
            <Typography sx={{ fontSize: FONT.caption, fontWeight: 600, color: 'var(--mac-text-muted)', textTransform: 'uppercase', mb: 1.2 }}>
              Publication Controls
            </Typography>

            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 14px', borderRadius: '10px', border: '1px solid var(--mac-border-color)', backgroundColor: '#FFFFFF' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2 }}>
                {selectedAnn.is_published ? <PublishIcon sx={{ color: '#2E7D32' }} /> : <UnpublishedIcon sx={{ color: '#EA580C' }} />}
                <Box>
                  <Typography sx={{ fontSize: FONT.small, fontWeight: 600, color: 'var(--mac-text-primary)' }}>
                    {selectedAnn.is_published ? 'Currently Active on Mobile PWAs' : 'Unpublished (Hidden from Users)'}
                  </Typography>
                  <Typography sx={{ fontSize: FONT.caption, color: 'var(--mac-text-muted)' }}>
                    {selectedAnn.is_published ? 'Commuters and drivers can view this broadcast.' : 'Save changes or publish to make visible.'}
                  </Typography>
                </Box>
              </Box>

              <Box sx={{ display: 'flex', gap: 0.8 }}>
                <Button
                  onClick={() => openEdit(selectedAnn)}
                  variant="outlined"
                  size="small"
                  startIcon={<EditIcon fontSize="small" />}
                  sx={{
                    height: CONTROL.height,
                    '@media (pointer: coarse)': { height: CONTROL.touchHeight },
                    fontSize: FONT.small,
                    textTransform: 'none',
                    fontWeight: 600,
                    borderRadius: '8px',
                    color: 'var(--sakay-orange)',
                    borderColor: 'var(--sakay-orange-border)',
                    backgroundColor: 'var(--sakay-orange-soft)',
                    '&:hover': { backgroundColor: 'var(--sakay-orange)', color: '#FFFFFF' },
                  }}
                >
                  Edit Announcement
                </Button>

                <Button
                  onClick={() => handleTogglePublish(selectedAnn)}
                  variant="outlined"
                  size="small"
                  sx={{
                    height: CONTROL.height,
                    '@media (pointer: coarse)': { height: CONTROL.touchHeight },
                    fontSize: FONT.small,
                    textTransform: 'none',
                    fontWeight: 600,
                    borderRadius: '8px',
                    color: selectedAnn.is_published ? '#FF6600' : '#2E7D32',
                    borderColor: selectedAnn.is_published ? '#FDBA74' : '#A7F3D0',
                    '&:hover': { backgroundColor: selectedAnn.is_published ? '#FFF7ED' : '#ECFDF5' },
                  }}
                >
                  {selectedAnn.is_published ? 'Unpublish' : 'Publish Broadcast'}
                </Button>

                <Button
                  onClick={() => setDeleteDialogOpen(true)}
                  variant="outlined"
                  color="error"
                  size="small"
                  startIcon={<DeleteIcon fontSize="small" />}
                  sx={{
                    height: CONTROL.height,
                    '@media (pointer: coarse)': { height: CONTROL.touchHeight },
                    fontSize: FONT.small,
                    textTransform: 'none',
                    fontWeight: 600,
                    borderRadius: '8px',
                  }}
                >
                  Delete
                </Button>
              </Box>
            </Box>
          </Box>
        </MacCenterModal>
      )}

      {/* 6. Delete Confirmation Dialog */}
      {selectedAnn && (
        <MacConfirmDialog
          open={deleteDialogOpen}
          onClose={() => setDeleteDialogOpen(false)}
          title="Delete Announcement?"
          message={`Are you sure you want to permanently delete "${selectedAnn.title}"? This cannot be undone.`}
          confirmLabel="Delete Announcement"
          confirmVariant="danger"
          onConfirm={handleDeleteConfirm}
        />
      )}

      <Snackbar
        open={Boolean(notice)}
        autoHideDuration={notice?.severity === 'error' ? 8000 : 4000}
        onClose={() => setNotice(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert onClose={() => setNotice(null)} severity={notice?.severity ?? 'info'} sx={{ width: '100%' }}>
          {notice?.text}
        </Alert>
      </Snackbar>
    </Box>
  );
};

