import React, { useState, useEffect, useRef } from 'react';
import { Box, Typography, TableBody, TableCell, TableRow, Button, TextField, MenuItem, Select, FormControl, InputLabel, Alert } from '@mui/material';
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
import { UnsavedChangesDialog } from '../components/admin/UnsavedChangesDialog';
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
import { shakeElement } from '../utils/shakeElement';
import { SakayToast } from '../components/common/SakayToast';

// How the form is being written to the database: a new announcement shown now, a new one kept as a draft, or changes to an existing one
type SaveMode = 'publish' | 'draft' | 'update';

// A short message under each field that is missing
interface FormErrors {
  title?: string;
  message?: string;
}

// The text fields of the form. A field that needs attention keeps a red outline and label even while it has the focus (the portal's focus colour is orange).
const TEXT_FIELD_SX = {
  '& .MuiOutlinedInput-root': { borderRadius: '10px' },
  '&& .MuiOutlinedInput-root.Mui-error .MuiOutlinedInput-notchedOutline': { borderColor: PAGE_TEXT.danger },
  '&& .MuiInputLabel-root.Mui-error': { color: PAGE_TEXT.danger },
} as const;

// The TODA an announcement is limited to (none = the whole city): only an audience other than "everyone" can be limited to one TODA
const effectiveTodaId = (role: AnnouncementRecord['target_role'], todaId: string): string | null =>
  role !== 'All' && todaId !== 'all-todas' ? todaId : null;

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
  // the announcement being edited (null = composing a new one) and whether it is published (an edit never changes that)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingPublished, setEditingPublished] = useState(false);
  // what is being written to the database right now (null = nothing)
  const [savingMode, setSavingMode] = useState<SaveMode | null>(null);
  const saving = savingMode !== null;
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  // "keep what you typed?" window, shown when the form is closed with content that has not been saved
  const [dismissOpen, setDismissOpen] = useState(false);
  const [dismissError, setDismissError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ severity: 'success' | 'error'; text: string } | null>(null);

  // What the form held when it was opened: closing it is only a question when it now holds something different
  const formBaseline = useRef({ title: '', message: '', role: 'All' as AnnouncementRecord['target_role'], todaId: null as string | null });
  // The fields, so the first missing one can be focused and every missing one can shake
  const titleFieldRef = useRef<HTMLDivElement>(null);
  const messageFieldRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);

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

  // Opens the form with these values, and remembers them as the starting point
  const openForm = (values: { id: string | null; published: boolean; title: string; message: string; role: AnnouncementRecord['target_role']; todaId: string | null }) => {
    setEditingId(values.id);
    setEditingPublished(values.published);
    setFormTitle(values.title);
    setFormMessage(values.message);
    setFormRole(values.role);
    setFormTodaId(values.todaId || 'all-todas');
    setFormErrors({});
    setDismissOpen(false);
    setDismissError(null);
    formBaseline.current = { title: values.title.trim(), message: values.message.trim(), role: values.role, todaId: values.todaId };
    setCreateModalOpen(true);
  };

  const openCreate = () => openForm({ id: null, published: false, title: '', message: '', role: 'All', todaId: null });

  const openEdit = (ann: AnnouncementRecord) => {
    setSelectedAnn(null);
    openForm({ id: ann.id, published: ann.is_published, title: ann.title, message: ann.message, role: ann.target_role, todaId: ann.toda_id ?? null });
  };

  /** True when the form holds something that would be lost by closing it: any text in a new announcement, or any change to an existing one. */
  const hasUnsavedChanges = (): boolean => {
    const base = formBaseline.current;
    if (!editingId) return Boolean(formTitle.trim() || formMessage.trim());
    return (
      formTitle.trim() !== base.title ||
      formMessage.trim() !== base.message ||
      formRole !== base.role ||
      effectiveTodaId(formRole, formTodaId) !== (base.role !== 'All' ? base.todaId : null)
    );
  };

  /** Cancel, the X, Escape or a click outside: closes at once when there is nothing to lose, otherwise asks first. The form is never cleared here. */
  const requestClose = () => {
    if (saving) return;
    if (hasUnsavedChanges()) {
      setDismissError(null);
      setDismissOpen(true);
    } else {
      setCreateModalOpen(false);
    }
  };

  /**
   * Checks that the title and the message are filled in. A missing one gets a short message under it, the first is focused, and each shakes once.
   * Nothing is saved and nothing the person typed is touched. Returns true when both are there.
   */
  const validateForm = (): boolean => {
    const errors: FormErrors = {};
    if (!formTitle.trim()) errors.title = 'Enter a title.';
    if (!formMessage.trim()) errors.message = 'Enter the message.';
    setFormErrors(errors);
    if (!errors.title && !errors.message) return true;
    // after this click has settled (a window that asked may still be closing and handing the focus back)
    window.setTimeout(() => {
      (errors.title ? titleInputRef : messageInputRef).current?.focus();
      if (errors.title) shakeElement(titleFieldRef.current);
      if (errors.message) shakeElement(messageFieldRef.current);
    }, 0);
    return false;
  };

  /**
   * Writes the form to the database as a published announcement, a draft, or changes to the one being edited, then closes it and reads the list again, so what is
   * shown is what was saved. Returns null when it was saved, or the reason it was not (the form then stays open with everything in it).
   */
  const persist = async (mode: SaveMode): Promise<string | null> => {
    setSavingMode(mode);
    const input = {
      title: formTitle.trim(),
      message: formMessage.trim(),
      targetRole: formRole,
      targetTodaId: effectiveTodaId(formRole, formTodaId),
    };
    try {
      if (mode === 'update' && editingId) {
        await updateAnnouncement(editingId, input);
      } else {
        await createAnnouncement({ ...input, publish: mode === 'publish' });
      }
    } catch (err) {
      return err instanceof Error ? err.message : 'The change could not be saved.';
    } finally {
      setSavingMode(null);
    }
    setNotice({
      severity: 'success',
      text:
        mode === 'update'
          ? 'The announcement was updated.'
          : mode === 'publish'
          ? 'The announcement was published.'
          : 'Saved as a draft. Open it and choose Publish when it is ready.',
    });
    setCreateModalOpen(false);
    try {
      await reload();
    } catch (err) {
      failure(err);
    }
    return null;
  };

  /** The form's main button: Publish for a new announcement, Save changes for an existing one. Both need a title and a message. */
  const handleSaveSubmit = async () => {
    if (saving || !validateForm()) return;
    const error = await persist(editingId ? 'update' : 'publish');
    if (error) setNotice({ severity: 'error', text: error });
  };

  /** "Save as Draft" (or "Save Changes") in the window that asks about unsaved content: the form closes only if the save worked. */
  const handleDismissSave = async () => {
    if (saving) return;
    if (!validateForm()) {
      // a draft needs a title and a message too: back to the form, which now points at what is missing
      setDismissOpen(false);
      return;
    }
    setDismissError(null);
    const error = await persist(editingId ? 'update' : 'draft');
    if (error) setDismissError(error);
    else setDismissOpen(false);
  };

  const handleDiscard = () => {
    setDismissOpen(false);
    setCreateModalOpen(false);
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
        onClose={requestClose}
        title={editingId ? 'Edit announcement' : 'New announcement'}
        subtitle={editingId ? 'Changes are saved to the same announcement.' : 'Notices, route advisories and reminders.'}
        maxWidth={544}
        primaryActionLabel={savingMode === 'publish' ? 'Publishing...' : saving ? 'Saving...' : editingId ? 'Save changes' : 'Publish'}
        primaryActionDisabled={saving}
        onPrimaryAction={handleSaveSubmit}
        secondaryActionLabel="Cancel"
        onSecondaryAction={requestClose}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            fullWidth
            required
            label="Title"
            placeholder="e.g. Annual Franchise Renewal Advisory"
            value={formTitle}
            onChange={(e) => {
              setFormTitle(e.target.value);
              if (formErrors.title && e.target.value.trim()) setFormErrors((prev) => ({ ...prev, title: undefined }));
            }}
            ref={titleFieldRef}
            inputRef={titleInputRef}
            error={Boolean(formErrors.title)}
            helperText={formErrors.title}
            slotProps={{ formHelperText: { role: 'alert' } }}
            sx={TEXT_FIELD_SX}
          />

          <TextField
            fullWidth
            required
            multiline
            rows={4}
            label="Message"
            placeholder="Write the advisory, instructions, or details for commuters or operators."
            value={formMessage}
            onChange={(e) => {
              setFormMessage(e.target.value);
              if (formErrors.message && e.target.value.trim()) setFormErrors((prev) => ({ ...prev, message: undefined }));
            }}
            ref={messageFieldRef}
            inputRef={messageInputRef}
            error={Boolean(formErrors.message)}
            helperText={formErrors.message}
            slotProps={{ formHelperText: { role: 'alert' } }}
            sx={TEXT_FIELD_SX}
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

          <Box sx={{ backgroundColor: '#FAFAF8', padding: '10px 14px', borderRadius: '10px', border: `1px solid ${PAGE_BORDER}` }}>
            <Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.secondary }}>
              {editingId
                ? `This announcement stays ${editingPublished ? 'published' : 'unpublished'}. Use Publish / Unpublish in its details window to change that.`
                : 'Publish shows it to the audience now. To keep it for later, close this window and choose Save as Draft.'}
            </Typography>
          </Box>
        </Box>
      </MacCenterModal>

      {/* 4b. Closing the form with content that is not saved yet */}
      <UnsavedChangesDialog
        open={createModalOpen && dismissOpen}
        title={editingId ? 'Save your changes?' : 'Save this as a draft?'}
        message={
          editingId
            ? 'You changed this announcement but have not saved the changes.'
            : 'This announcement has not been published. Save it as a draft to finish it later, or discard what you wrote.'
        }
        saveLabel={editingId ? 'Save Changes' : 'Save as Draft'}
        busy={saving}
        error={dismissError}
        onSave={handleDismissSave}
        onDiscard={handleDiscard}
        onKeepEditing={() => setDismissOpen(false)}
      />

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

      <SakayToast message={notice?.text ?? null} severity={notice?.severity ?? 'info'} autoHideDuration={notice?.severity === 'error' ? 8000 : 4000} onClose={() => setNotice(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} />
    </Box>
  );
};
