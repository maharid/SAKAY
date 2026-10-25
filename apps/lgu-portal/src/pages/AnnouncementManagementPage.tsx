import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  TableBody,
  TableCell,
  TableRow,
  Button,
  TextField,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
  RadioGroup,
  FormControlLabel,
  Radio,
  Snackbar,
  Alert,
} from '@mui/material';
import AddAlertIcon from '@mui/icons-material/AddAlert';
import PublishIcon from '@mui/icons-material/Publish';
import UnpublishedIcon from '@mui/icons-material/Unpublished';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';

import { AnnouncementRecord, AccreditedTodaRecord } from '../mockData/adminData';
import { FilterToolbar, FilterOption } from '../components/admin/FilterToolbar';
import { StatusBadge } from '../components/common/StatusBadge';
import { MacCenterModal } from '../components/admin/MacCenterModal';
import { MacConfirmDialog } from '../components/admin/MacConfirmDialog';
import { CalamityPanel } from '../components/admin/CalamityPanel';
import { CellStack, DataTableCard, DataTableMessageRow, FlagTag } from '../components/common/DataTable';
import { DetailField, DetailGrid, DetailSection } from '../components/common/DetailSection';
import { StatStrip } from '../components/common/StatStrip';
import {
  fetchAnnouncements,
  fetchAccreditedTodas,
  createAnnouncement,
  updateAnnouncement,
  setAnnouncementPublished,
  deleteAnnouncement,
} from '../services/adminApiService';
import { FONT } from '../styles/density';
import { PAGE_BORDER, PAGE_TEXT, dangerOutlineButtonSx, primaryButtonSx, secondaryButtonSx, rowActionSx } from '../styles/pageTheme';

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
    { label: 'Passengers', value: 'Passenger' },
    { label: 'Drivers', value: 'Driver' },
    { label: 'TODA Administrators', value: 'TODA Administrator' },
  ];

  const statusOptions: FilterOption[] = [
    { label: 'All Statuses', value: 'All' },
    { label: 'Published', value: 'Published' },
    { label: 'Draft / Unpublished', value: 'Draft / Unpublished' },
  ];

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

  const filtering = Boolean(searchQuery) || roleFilter !== 'All' || statusFilter !== 'All';
  const audienceLabel = (role: AnnouncementRecord['target_role']) => (role === 'All' ? 'Everyone' : `${role}s`);

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

      {/* 1. How many announcements there are */}
      <StatStrip
        label="Announcement totals"
        stats={[
          { key: 'total', label: 'All announcements', value: totalCount },
          { key: 'active', label: 'Published', value: publishedCount, tone: 'success', note: 'Shown to users now' },
          { key: 'toda', label: 'For one TODA', value: todaScopedCount, note: 'Limited to a TODA' },
          { key: 'draft', label: 'Drafts', value: draftCount, tone: draftCount > 0 ? 'brand' : 'neutral', note: 'Not shown to anyone yet' },
        ]}
      />

      {/* 2. Search, filters and the "New announcement" button */}
      <FilterToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Search title, text, or TODA"
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
        actionButton={
          <Button onClick={openCreate} variant="contained" startIcon={<AddAlertIcon sx={{ fontSize: 16 }} />} sx={primaryButtonSx}>
            New announcement
          </Button>
        }
      />

      {/* 3. The announcements */}
      <DataTableCard
        label="Announcements"
        minWidth={860}
        columns={[{ label: 'Announcement' }, { label: 'Audience' }, { label: 'TODA' }, { label: 'Status' }, { label: 'Created by' }, { label: 'Action', align: 'right' }]}
      >
        <TableBody>
          {isLoading ? (
            <DataTableMessageRow colSpan={6} kind="loading" loadingText="Loading announcements..." />
          ) : filteredAnnouncements.length > 0 ? (
            filteredAnnouncements.map((ann) => (
              <TableRow key={ann.id}>
                <TableCell sx={{ maxWidth: 360 }}>
                  <Typography component="div" sx={{ fontSize: FONT.body, fontWeight: 600, color: PAGE_TEXT.primary, overflowWrap: 'anywhere' }}>{ann.title}</Typography>
                  <Typography
                    component="div"
                    sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary, mt: '1px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  >
                    {ann.message}
                  </Typography>
                </TableCell>
                <TableCell>
                  <FlagTag label={audienceLabel(ann.target_role)} tone={ann.target_role === 'All' ? 'brand' : 'neutral'} />
                </TableCell>
                <TableCell sx={{ color: PAGE_TEXT.secondary }}>{ann.toda_name || 'Whole city'}</TableCell>
                <TableCell>
                  <StatusBadge status={ann.is_published ? 'Published' : 'Draft'} />
                </TableCell>
                <TableCell>
                  <CellStack primary={ann.created_by_lgu_admin.split('(')[0]} secondary={ann.created_at} />
                </TableCell>
                <TableCell align="right">
                  <Button aria-label={`Manage the announcement ${ann.title}`} onClick={() => setSelectedAnn(ann)} sx={rowActionSx('neutral')}>
                    Manage
                  </Button>
                </TableCell>
              </TableRow>
            ))
          ) : (
            <DataTableMessageRow
              colSpan={6}
              kind={filtering ? 'noResults' : 'empty'}
              title={filtering ? 'No announcements match' : 'No announcements yet'}
              hint={
                filtering
                  ? 'Nothing matches your search or filter. Try clearing them.'
                  : 'Announcements appear here once you publish them.'
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
            />
          )}
        </TableBody>
      </DataTableCard>

      {/* 4. New / edit announcement window */}
      <MacCenterModal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        title={editingId ? 'Edit announcement' : 'New announcement'}
        subtitle={editingId ? 'Changes are saved to the same announcement.' : 'Notices, route advisories and reminders.'}
        maxWidth={544}
        primaryActionLabel={saving ? 'Saving...' : editingId ? 'Save changes' : formPublish ? 'Publish now' : 'Save as draft'}
        onPrimaryAction={handleSaveSubmit}
        secondaryActionLabel="Cancel"
        onSecondaryAction={() => setCreateModalOpen(false)}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            fullWidth
            label="Title"
            placeholder="e.g. Annual Franchise Renewal Advisory"
            value={formTitle}
            onChange={(e) => setFormTitle(e.target.value)}
            sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }}
          />

          <TextField
            fullWidth
            multiline
            rows={4}
            label="Message"
            placeholder="Write the advisory, instructions, or details for commuters or operators."
            value={formMessage}
            onChange={(e) => setFormMessage(e.target.value)}
            sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }}
          />

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 1.6 }}>
            <FormControl fullWidth>
              <InputLabel id="target-audience-label">Audience</InputLabel>
              <Select
                labelId="target-audience-label"
                value={formRole}
                label="Audience"
                onChange={(e) => setFormRole(e.target.value as AnnouncementRecord['target_role'])}
                sx={{ borderRadius: '10px' }}
              >
                <MenuItem value="All">Everyone</MenuItem>
                <MenuItem value="Passenger">Passengers only</MenuItem>
                <MenuItem value="Driver">Tricycle drivers only</MenuItem>
                <MenuItem value="TODA Administrator">TODA administrators only</MenuItem>
              </Select>
            </FormControl>

            {formRole !== 'All' ? (
              <FormControl fullWidth>
                <InputLabel id="toda-scope-label">TODA</InputLabel>
                <Select
                  labelId="toda-scope-label"
                  value={formTodaId}
                  label="TODA"
                  onChange={(e) => setFormTodaId(e.target.value)}
                  sx={{ borderRadius: '10px' }}
                >
                  <MenuItem value="all-todas">All TODAs (whole city)</MenuItem>
                  {todasList.map((toda) => (
                    <MenuItem key={toda.id} value={toda.id}>
                      {toda.name} ({toda.barangay})
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            ) : (
              <Box sx={{ display: 'flex', alignItems: 'center', backgroundColor: '#FAFAF8', padding: '0 13px', minHeight: 40, borderRadius: '10px', border: `1px solid ${PAGE_BORDER}` }}>
                <Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.secondary }}>
                  Area: <strong>whole city</strong>
                </Typography>
              </Box>
            )}
          </Box>

          {editingId ? (
            <Box sx={{ backgroundColor: '#FAFAF8', padding: '10px 14px', borderRadius: '10px', border: `1px solid ${PAGE_BORDER}` }}>
              <Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.secondary }}>
                This announcement stays {formPublish ? 'published' : 'unpublished'}. Use Publish / Unpublish in its details window to change that.
              </Typography>
            </Box>
          ) : (
            <Box sx={{ backgroundColor: '#FAFAF8', padding: '12px 14px', borderRadius: '10px', border: `1px solid ${PAGE_BORDER}` }}>
              <Typography sx={{ fontSize: FONT.body, fontWeight: 600, color: PAGE_TEXT.primary, mb: 0.8 }}>
                When to show it
              </Typography>
              <RadioGroup
                value={formPublish ? 'now' : 'draft'}
                onChange={(e) => setFormPublish(e.target.value === 'now')}
              >
                <FormControlLabel value="now" control={<Radio size="small" sx={{ '&.Mui-checked': { color: '#C75000' } }} />} label={<Typography sx={{ fontSize: FONT.body }}>Publish now</Typography>} />
                <FormControlLabel value="draft" control={<Radio size="small" sx={{ '&.Mui-checked': { color: '#C75000' } }} />} label={<Typography sx={{ fontSize: FONT.body }}>Save as a draft (nobody sees it yet)</Typography>} />
              </RadioGroup>
            </Box>
          )}
        </Box>
      </MacCenterModal>

      {/* 5. Manage window */}
      {selectedAnn && (
        <MacCenterModal
          open={Boolean(selectedAnn)}
          onClose={() => setSelectedAnn(null)}
          title={selectedAnn.title}
          subtitle={`Announcement ID: ${selectedAnn.announcement_id} · For: ${audienceLabel(selectedAnn.target_role)}`}
          badge={<StatusBadge status={selectedAnn.is_published ? 'Published' : 'Draft'} />}
          maxWidth={560}
        >
          <DetailSection title="Message">
            <Box sx={{ backgroundColor: '#FAFAF8', padding: '12px 14px', borderRadius: '12px', border: `1px solid ${PAGE_BORDER}` }}>
              <Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.primary, lineHeight: 1.6, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                "{selectedAnn.message}"
              </Typography>
            </Box>
          </DetailSection>

          <DetailSection title="Details">
            <DetailGrid>
              <DetailField label="Audience">{selectedAnn.target_role}</DetailField>
              <DetailField label="TODA">{selectedAnn.toda_name || 'Whole city'}</DetailField>
              <DetailField label="Written by">{selectedAnn.created_by_lgu_admin}</DetailField>
              <DetailField label="Created">{selectedAnn.created_at}</DetailField>
              <DetailField label="Published">{selectedAnn.published_at ?? 'Not published yet'}</DetailField>
              <DetailField label="Unpublished">{selectedAnn.unpublished_at ?? '\u2014'}</DetailField>
              <DetailField label="Last changed">{selectedAnn.updated_at ?? '\u2014'}</DetailField>
            </DetailGrid>
          </DetailSection>

          <DetailSection title="Publishing">
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: '10px', mb: '12px' }}>
              {selectedAnn.is_published ? <PublishIcon aria-hidden sx={{ color: PAGE_TEXT.success, fontSize: 20 }} /> : <UnpublishedIcon aria-hidden sx={{ color: PAGE_TEXT.warning, fontSize: 20 }} />}
              <Box>
                <Typography sx={{ fontSize: FONT.body, fontWeight: 600, color: PAGE_TEXT.primary }}>
                  {selectedAnn.is_published ? 'Showing in the mobile apps' : 'Not showing (hidden from users)'}
                </Typography>
                <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary }}>
                  {selectedAnn.is_published ? 'Commuters and drivers can read this announcement.' : 'Publish it to make it visible.'}
                </Typography>
              </Box>
            </Box>

            <Box sx={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <Button onClick={() => openEdit(selectedAnn)} startIcon={<EditIcon sx={{ fontSize: 16 }} />} sx={secondaryButtonSx}>
                Edit
              </Button>

              <Button
                onClick={() => handleTogglePublish(selectedAnn)}
                variant={selectedAnn.is_published ? 'outlined' : 'contained'}
                sx={selectedAnn.is_published ? secondaryButtonSx : primaryButtonSx}
              >
                {selectedAnn.is_published ? 'Unpublish' : 'Publish'}
              </Button>

              <Button onClick={() => setDeleteDialogOpen(true)} startIcon={<DeleteIcon sx={{ fontSize: 16 }} />} sx={dangerOutlineButtonSx}>
                Delete
              </Button>
            </Box>
          </DetailSection>
        </MacCenterModal>
      )}

      {/* 6. Delete confirmation */}
      {selectedAnn && (
        <MacConfirmDialog
          open={deleteDialogOpen}
          onClose={() => setDeleteDialogOpen(false)}
          title="Delete this announcement?"
          message={`Are you sure you want to permanently delete "${selectedAnn.title}"? This cannot be undone.`}
          confirmLabel="Delete announcement"
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
