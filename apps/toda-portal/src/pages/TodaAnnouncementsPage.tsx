import React, { useState, useEffect, useRef } from 'react';
import { Box, ListItemIcon, Typography, TableBody, TableCell, TableRow, Button, TextField, MenuItem, Select, FormControl, InputLabel } from '@mui/material';
import CampaignIcon from '@mui/icons-material/Campaign';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import PriorityHighIcon from '@mui/icons-material/PriorityHigh';
import { AnnouncementEventIcon, ANNOUNCEMENT_EVENT_TYPES, TODA_ANNOUNCEMENT_EVENT_TYPES, shakeElement } from '@sakay/shared';

import { TodaAnnouncement } from '../types/toda';
import { FilterToolbar, FilterOption } from '../components/admin/FilterToolbar';
import { StatusBadge } from '../components/common/StatusBadge';
import { MacCenterModal } from '../components/admin/MacCenterModal';
import { MacConfirmDialog } from '../components/admin/MacConfirmDialog';
import { UnsavedChangesDialog } from '../components/admin/UnsavedChangesDialog';
import { SakayToast } from '../components/common/SakayToast';
import { ToolbarRow, ToolbarSideCard } from '@sakay/shared';
import { SendReminderDialog } from '../components/announcements/SendReminderDialog';
import { OperationsStatStrip } from '../components/operations/OperationsStatStrip';
import type { OperationsStat } from '../components/operations/OperationsStatStrip';
import { DataTableCard, DataTableMessageRow, StatusPill } from '../components/common/DataTable';
import { PageNotice } from '../components/common/PageNotice';
import { primaryButtonSx, rowActionSx, secondaryButtonSx } from '../components/common/pageButtons';
import { OPS_BORDER, OPS_TEXT } from '../components/operations/operationsTheme';
import { FONT, SHELL, SPACE } from '../styles/density';
import {
  fetchTodaAnnouncements,
  postTodaAnnouncement,
  updateTodaAnnouncement,
  setTodaAnnouncementPublished,
  deleteTodaAnnouncement,
} from '../services/todaApiService';

// How the form is being written to the database: a new announcement shown now, a new one kept as a draft, or changes to an existing one
type SaveMode = 'publish' | 'draft' | 'update';

// A short message under each field that is missing
interface FormErrors {
  title?: string;
  message?: string;
}

// The text fields of the form (the same as the LGU portal's). A field that needs attention keeps a red outline and label even while it has the focus (the portal's
// focus colour is orange).
const TEXT_FIELD_SX = {
  '& .MuiOutlinedInput-root': { borderRadius: '10px' },
  '&& .MuiOutlinedInput-root.Mui-error .MuiOutlinedInput-notchedOutline': { borderColor: OPS_TEXT.danger },
  '&& .MuiInputLabel-root.Mui-error': { color: OPS_TEXT.danger },
} as const;

// toda announcements broadcast management and driver mobile PWA push notifications
export const TodaAnnouncementsPage: React.FC = () => {
  const [announcements, setAnnouncements] = useState<TodaAnnouncement[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');

  const loadAnnouncements = () => {
    setIsLoading(true);
    fetchTodaAnnouncements()
      .then((data) => setAnnouncements(data || []))
      .catch((err) => {
        console.error('[TodaAnnouncements] Error fetching from database:', err);
        setAnnouncements([]);
      })
      .finally(() => setIsLoading(false));
  };

  useEffect(() => {
    loadAnnouncements();
  }, []);

  // Selected announcement for detail/edit modal
  const [selectedAnn, setSelectedAnn] = useState<TodaAnnouncement | null>(null);

  // Modals & Dialogs
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // Form State
  const [formTitle, setFormTitle] = useState('');
  const [formMessage, setFormMessage] = useState('');
  const [formCategory, setFormCategory] = useState<TodaAnnouncement['category']>('Terminal Rules');
  const [formUrgency, setFormUrgency] = useState<'Standard' | 'High Priority'>('Standard');
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
  const formBaseline = useRef({ title: '', message: '', category: 'Terminal Rules' as TodaAnnouncement['category'], urgency: 'Standard' as TodaAnnouncement['urgency'] });
  // The fields, so the first missing one can be focused and every missing one can shake
  const titleFieldRef = useRef<HTMLDivElement>(null);
  const messageFieldRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const messageInputRef = useRef<HTMLTextAreaElement>(null);

  // Filter Logic
  const filteredAnnouncements = announcements.filter((ann) => {
    const matchesSearch =
      ann.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      ann.message.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesCategory = categoryFilter === 'All' || ann.category === categoryFilter;
    const matchesStatus =
      statusFilter === 'All' ||
      (statusFilter === 'Published' && ann.isPublished) ||
      (statusFilter === 'Draft' && !ann.isPublished);

    return matchesSearch && matchesCategory && matchesStatus;
  });

  const totalCount = announcements.length;
  const publishedCount = announcements.filter((a) => a.isPublished).length;
  const draftCount = announcements.filter((a) => !a.isPublished).length;

  const categoryOptions: FilterOption[] = [
    { label: 'All Categories', value: 'All' },
    ...ANNOUNCEMENT_EVENT_TYPES.map((type) => ({ label: type, value: type })),
  ];

  const statusOptions: FilterOption[] = [
    { label: 'All Statuses', value: 'All' },
    { label: 'Published', value: 'Published' },
    { label: 'Draft', value: 'Draft' },
  ];

  /** Reads the list again from the database (what the Driver App and the audit log will see) and keeps the open details window in step. */
  const reload = async () => {
    const fresh = (await fetchTodaAnnouncements()) || [];
    setAnnouncements(fresh);
    setSelectedAnn((prev) => (prev ? fresh.find((a) => a.id === prev.id) ?? null : null));
  };

  const failure = (err: unknown) => setNotice({ severity: 'error', text: err instanceof Error ? err.message : 'The change could not be saved.' });

  // Opens the form with these values, and remembers them as the starting point
  const openForm = (values: { id: string | null; published: boolean; title: string; message: string; category: TodaAnnouncement['category']; urgency: TodaAnnouncement['urgency'] }) => {
    setEditingId(values.id);
    setEditingPublished(values.published);
    setFormTitle(values.title);
    setFormMessage(values.message);
    setFormCategory(values.category);
    setFormUrgency(values.urgency);
    setFormErrors({});
    setDismissOpen(false);
    setDismissError(null);
    formBaseline.current = { title: values.title.trim(), message: values.message.trim(), category: values.category, urgency: values.urgency };
    setCreateModalOpen(true);
  };

  // Open Create Modal
  const handleOpenCreate = () => openForm({ id: null, published: false, title: '', message: '', category: 'Terminal Rules', urgency: 'Standard' });

  // Open Edit Modal
  const handleOpenEdit = (ann: TodaAnnouncement) => {
    setSelectedAnn(null);
    openForm({ id: ann.id, published: ann.isPublished, title: ann.title, message: ann.message, category: ann.category, urgency: ann.urgency });
  };

  /** True when the form holds something that would be lost by closing it: any text in a new announcement, or any change to an existing one. */
  const hasUnsavedChanges = (): boolean => {
    const base = formBaseline.current;
    if (!editingId) return Boolean(formTitle.trim() || formMessage.trim());
    return formTitle.trim() !== base.title || formMessage.trim() !== base.message || formCategory !== base.category || formUrgency !== base.urgency;
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
    const title = formTitle.trim();
    const message = formMessage.trim();
    try {
      if (mode === 'update' && editingId) {
        await updateTodaAnnouncement(editingId, { title, message, urgency: formUrgency, eventType: formCategory });
      } else {
        await postTodaAnnouncement(title, message, formUrgency, undefined, mode === 'publish', formCategory);
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

  // Action: Publish Existing Draft from Detail Modal (saved to the database; the database stamps the time)
  const handlePublishDraft = async (ann: TodaAnnouncement) => {
    try {
      await setTodaAnnouncementPublished(ann.id, true, ann.title);
      await reload();
      setNotice({ severity: 'success', text: 'The announcement is published.' });
    } catch (err) {
      failure(err);
    }
    setSelectedAnn(null);
  };

  // Action: Delete Announcement
  const handleDeleteConfirm = async () => {
    if (!selectedAnn) return;

    try {
      await deleteTodaAnnouncement(selectedAnn.id);
      loadAnnouncements();
    } catch (err) {
      console.error('[TodaAnnouncements] Delete error:', err);
      setAnnouncements((prev) => prev.filter((a) => a.id !== selectedAnn.id));
    }

    setDeleteDialogOpen(false);
    setSelectedAnn(null);
  };

  // Send a reminder to the TODA's drivers
  const [reminderOpen, setReminderOpen] = useState(false);
  const [reminderNotice, setReminderNotice] = useState<string | null>(null);

  // The three numbers at the top
  const stats: OperationsStat[] = [
    { key: 'total', label: 'All announcements', value: totalCount },
    { key: 'published', label: 'Published', value: publishedCount, note: 'Seen by your drivers', tone: publishedCount > 0 ? 'brand' : 'neutral' },
    { key: 'drafts', label: 'Drafts', value: draftCount, note: 'Not published yet' },
  ];

  // Why the list is empty, in words: nothing exists, or nothing matches the search and filters
  const hasActiveFilter = searchQuery.trim() !== '' || categoryFilter !== 'All' || statusFilter !== 'All';

  // Send Reminder and New Announcement: a card of their own beside the search and filter card
  const actions = (
    <ToolbarSideCard label="Announcement actions">
      <Button onClick={() => setReminderOpen(true)} startIcon={<NotificationsActiveIcon sx={{ fontSize: 16 }} />} variant="outlined" sx={secondaryButtonSx}>
        Send Reminder
      </Button>
      <Button onClick={handleOpenCreate} startIcon={<CampaignIcon sx={{ fontSize: 16 }} />} variant="contained" disableElevation sx={primaryButtonSx}>
        New Announcement
      </Button>
    </ToolbarSideCard>
  );

  return (
    <Box sx={{ maxWidth: SHELL.contentMaxWidth, margin: '0 auto', pb: '38px' }}>
      {/* 1. The numbers */}
      <OperationsStatStrip stats={stats} />

      {/* 2. After a reminder was sent */}
      {reminderNotice && (
        <PageNotice tone="success">{reminderNotice}</PageNotice>
      )}

      <SendReminderDialog
        open={reminderOpen}
        onClose={() => setReminderOpen(false)}
        onSent={(count) => setReminderNotice(`Reminder sent to ${count} driver${count === 1 ? '' : 's'}. They will see it under Alerts in the Driver App.`)}
      />

      {/* 3. Search, filters and the two things a president does here */}
      <ToolbarRow side={actions}>
      <FilterToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Search title or message"
        selectFilters={[
          {
            id: 'category',
            label: 'Category',
            value: categoryFilter,
            options: categoryOptions,
            onChange: setCategoryFilter,
            width: 176,
          },
          {
            id: 'status',
            label: 'Publication Status',
            value: statusFilter,
            options: statusOptions,
            onChange: setStatusFilter,
            width: 164,
          },
        ]}
        onResetFilters={() => {
          setSearchQuery('');
          setCategoryFilter('All');
          setStatusFilter('All');
        }}
        disableMarginBottom
      />
      </ToolbarRow>

      {/* 4. The announcements, one per row */}
      <DataTableCard
        label="Announcements"
        minWidth={820}
        columns={[{ label: 'Announcement' }, { label: 'Category' }, { label: 'Posted by' }, { label: 'Status' }, { label: 'Action', align: 'right' }]}
      >
        <TableBody>
          {isLoading ? (
            <DataTableMessageRow colSpan={5} kind="loading" loadingText="Loading announcements..." />
          ) : filteredAnnouncements.length > 0 ? (
            filteredAnnouncements.map((ann) => (
              <TableRow key={ann.id}>
                <TableCell sx={{ maxWidth: 420 }}>
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 8px' }}>
                    <AnnouncementEventIcon type={ann.category} sx={{ color: OPS_TEXT.brand }} />
                    <Typography sx={{ fontSize: FONT.body, fontWeight: 700, color: OPS_TEXT.primary, overflowWrap: 'anywhere' }}>{ann.title}</Typography>
                    {ann.urgency === 'High Priority' && <StatusPill label="High priority" tone="danger" icon={<PriorityHighIcon aria-hidden sx={{ fontSize: 13 }} />} />}
                  </Box>
                  <Typography
                    sx={{
                      fontSize: FONT.small,
                      color: OPS_TEXT.secondary,
                      mt: '2px',
                      overflowWrap: 'anywhere',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}
                  >
                    {ann.message}
                  </Typography>
                </TableCell>

                <TableCell sx={{ whiteSpace: 'nowrap' }}>{ann.category}</TableCell>

                <TableCell>
                  <Typography sx={{ fontSize: FONT.body, color: OPS_TEXT.primary }}>{ann.createdBy}</Typography>
                  <Typography sx={{ fontSize: FONT.small, color: OPS_TEXT.secondary }}>{ann.createdAt}</Typography>
                </TableCell>

                <TableCell>
                  <StatusBadge status={ann.isPublished ? 'Published' : 'Draft'} highContrast />
                </TableCell>

                <TableCell align="right">
                  <Box sx={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                    <Button variant="outlined" onClick={() => setSelectedAnn(ann)} sx={rowActionSx('neutral')}>
                      View
                    </Button>
                    <Button
                      variant="outlined"
                      onClick={() => {
                        setSelectedAnn(ann);
                        setDeleteDialogOpen(true);
                      }}
                      sx={rowActionSx('danger')}
                    >
                      Delete
                    </Button>
                  </Box>
                </TableCell>
              </TableRow>
            ))
          ) : totalCount === 0 ? (
            <DataTableMessageRow colSpan={5} kind="empty" title="No announcements yet" hint="Press New Announcement to write your first notice for your drivers." />
          ) : (
            <DataTableMessageRow
              colSpan={5}
              kind="noResults"
              title="No announcements match"
              hint={hasActiveFilter ? 'Try other words or another filter, or press Reset to see them all.' : 'Press Reset to see every announcement.'}
            />
          )}
        </TableBody>
      </DataTableCard>

      {/* 5. Write or edit an announcement */}
      <MacCenterModal
        open={createModalOpen}
        onClose={requestClose}
        title={editingId ? 'Edit announcement' : 'New announcement'}
        subtitle={editingId ? 'Changes are saved to the same announcement.' : 'Your drivers read it in their Driver App.'}
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
            placeholder="e.g. Mandatory General Assembly Meeting on May 20"
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
            placeholder="Write the advisory, instructions, or details for your member drivers."
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
              <InputLabel id="announcement-category-label">Category</InputLabel>
              <Select
                labelId="announcement-category-label"
                value={formCategory}
                label="Category"
                onChange={(e) => setFormCategory(e.target.value as TodaAnnouncement['category'])}
                renderValue={(value) => (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <AnnouncementEventIcon type={value} sx={{ color: OPS_TEXT.brand }} />
                    {value}
                  </Box>
                )}
                sx={{ borderRadius: '10px' }}
              >
                {/* An announcement the LGU wrote keeps its own type when a TODA edits nothing but its text; a new one is one of the TODA's types */}
                {(TODA_ANNOUNCEMENT_EVENT_TYPES.includes(formCategory) ? TODA_ANNOUNCEMENT_EVENT_TYPES : [...TODA_ANNOUNCEMENT_EVENT_TYPES, formCategory]).map((type) => (
                  <MenuItem key={type} value={type}>
                    <ListItemIcon sx={{ minWidth: 34, color: OPS_TEXT.brand }}>
                      <AnnouncementEventIcon type={type} />
                    </ListItemIcon>
                    {type}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl fullWidth>
              <InputLabel id="announcement-urgency-label">Urgency Priority</InputLabel>
              <Select
                labelId="announcement-urgency-label"
                value={formUrgency}
                label="Urgency Priority"
                onChange={(e) => setFormUrgency(e.target.value as TodaAnnouncement['urgency'])}
                sx={{ borderRadius: '10px' }}
              >
                <MenuItem value="Standard">Standard Priority</MenuItem>
                <MenuItem value="High Priority">High Priority (Urgent Advisory)</MenuItem>
              </Select>
            </FormControl>
          </Box>

          <Box sx={{ backgroundColor: '#FAFAF8', padding: '10px 14px', borderRadius: '10px', border: `1px solid ${OPS_BORDER}` }}>
            <Typography sx={{ fontSize: FONT.body, color: OPS_TEXT.secondary }}>
              {editingId
                ? `This announcement stays ${editingPublished ? 'published' : 'unpublished'}. ${editingPublished ? 'Your member drivers see the changes in their Driver App.' : 'Use Publish in its details window to change that.'}`
                : 'Publish shows it to your member drivers now. To keep it for later, close this window and choose Save as Draft.'}
            </Typography>
          </Box>
        </Box>
      </MacCenterModal>

      {/* 5b. Closing the form with content that is not saved yet */}
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

      {/* 6. Read an announcement (publish or edit from here) */}
      {selectedAnn && !deleteDialogOpen && (
        <MacCenterModal
          open={Boolean(selectedAnn)}
          onClose={() => setSelectedAnn(null)}
          title={selectedAnn.title}
          subtitle={`Created: ${selectedAnn.createdAt} • ${selectedAnn.createdBy}`}
          badge={<StatusBadge status={selectedAnn.isPublished ? 'Published' : 'Draft'} highContrast />}
          maxWidth={528}
          primaryActionLabel={selectedAnn.isPublished ? "Edit Announcement" : "Publish Announcement"}
          onPrimaryAction={() => {
            if (selectedAnn.isPublished) {
              handleOpenEdit(selectedAnn);
            } else {
              handlePublishDraft(selectedAnn);
            }
          }}
          secondaryActionLabel={selectedAnn.isPublished ? undefined : "Edit Draft"}
          onSecondaryAction={() => {
            if (selectedAnn.isPublished) {
              setSelectedAnn(null);
            } else {
              handleOpenEdit(selectedAnn);
            }
          }}
        >
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: SPACE.gap }}>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
              <Typography sx={{ fontSize: FONT.small, fontWeight: 600, color: OPS_TEXT.secondary }}>Category and priority</Typography>
              <StatusPill label={selectedAnn.category} tone="neutral" icon={<AnnouncementEventIcon type={selectedAnn.category} fontSize={13} />} />
              {selectedAnn.urgency === 'High Priority' ? (
                <StatusPill label="High priority" tone="danger" icon={<PriorityHighIcon aria-hidden sx={{ fontSize: 13 }} />} />
              ) : (
                <StatusPill label="Standard" tone="neutral" />
              )}
            </Box>

            <Box>
              <Typography sx={{ fontSize: FONT.small, fontWeight: 600, color: OPS_TEXT.secondary, mb: '6px' }}>Message</Typography>
              <Typography sx={{ fontSize: FONT.body, color: OPS_TEXT.primary, lineHeight: 1.6, overflowWrap: 'anywhere', backgroundColor: '#FAFAF8', border: '1px solid rgba(15, 23, 42, 0.12)', p: '13px 16px', borderRadius: '8px' }}>
                {selectedAnn.message}
              </Typography>
            </Box>
          </Box>
        </MacCenterModal>
      )}

      {/* Delete confirmation */}
      <MacConfirmDialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        title="Delete Announcement?"
        message={`Are you sure you want to delete announcement "${selectedAnn?.title}"? This action cannot be undone.`}
        confirmLabel="Delete Announcement"
        confirmVariant="danger"
        onConfirm={handleDeleteConfirm}
      />

      <SakayToast message={notice?.text ?? null} severity={notice?.severity ?? 'info'} autoHideDuration={notice?.severity === 'error' ? 8000 : 4000} onClose={() => setNotice(null)} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} />
    </Box>
  );
};
