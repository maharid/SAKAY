import React, { useState, useEffect } from 'react';
import { Box, Typography, TableBody, TableCell, TableRow, Button, TextField, MenuItem } from '@mui/material';
import CampaignIcon from '@mui/icons-material/Campaign';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import PriorityHighIcon from '@mui/icons-material/PriorityHigh';

import { TodaAnnouncement } from '../types/toda';
import { FilterToolbar, FilterOption } from '../components/admin/FilterToolbar';
import { StatusBadge } from '../components/common/StatusBadge';
import { MacCenterModal } from '../components/admin/MacCenterModal';
import { MacConfirmDialog } from '../components/admin/MacConfirmDialog';
import { SendReminderDialog } from '../components/announcements/SendReminderDialog';
import { OperationsStatStrip } from '../components/operations/OperationsStatStrip';
import type { OperationsStat } from '../components/operations/OperationsStatStrip';
import { DataTableCard, DataTableMessageRow, StatusPill } from '../components/common/DataTable';
import { PageNotice } from '../components/common/PageNotice';
import { primaryButtonSx, rowActionSx, secondaryButtonSx } from '../components/common/pageButtons';
import { OPS_TEXT } from '../components/operations/operationsTheme';
import { FONT, SHELL, SPACE } from '../styles/density';
import {
  fetchTodaAnnouncements,
  postTodaAnnouncement,
  deleteTodaAnnouncement,
  recordTodaAuditAction,
} from '../services/todaApiService';

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
  const [editingAnn, setEditingAnn] = useState<TodaAnnouncement | null>(null);

  // Modals & Dialogs
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  // Form State
  const [formTitle, setFormTitle] = useState('');
  const [formMessage, setFormMessage] = useState('');
  const [formCategory, setFormCategory] = useState<TodaAnnouncement['category']>('Terminal Rules');
  const [formUrgency, setFormUrgency] = useState<'Standard' | 'High Priority'>('Standard');

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
    { label: 'Terminal Rules', value: 'Terminal Rules' },
    { label: 'Document Renewal', value: 'Document Renewal' },
    { label: 'Meeting Notice', value: 'Meeting Notice' },
    { label: 'Safety Advisory', value: 'Safety Advisory' },
  ];

  const statusOptions: FilterOption[] = [
    { label: 'All Statuses', value: 'All' },
    { label: 'Published', value: 'Published' },
    { label: 'Draft', value: 'Draft' },
  ];

  // Open Create Modal
  const handleOpenCreate = () => {
    setEditingAnn(null);
    setFormTitle('');
    setFormMessage('');
    setFormCategory('Terminal Rules');
    setFormUrgency('Standard');
    setCreateModalOpen(true);
  };

  // Open Edit Modal
  const handleOpenEdit = (ann: TodaAnnouncement) => {
    setSelectedAnn(null);
    setEditingAnn(ann);
    setFormTitle(ann.title);
    setFormMessage(ann.message);
    setFormCategory(ann.category);
    setFormUrgency(ann.urgency);
    setCreateModalOpen(true);
  };

  // Action: Create or Edit Announcement
  const handleSaveAnnouncement = async (isPublishingImmediately: boolean) => {
    if (!formTitle.trim() || !formMessage.trim()) return;

    try {
      await postTodaAnnouncement(formTitle.trim(), formMessage.trim(), formUrgency);
      loadAnnouncements();
    } catch (err) {
      console.error('[TodaAnnouncements] Save error:', err);
    }

    setFormTitle('');
    setFormMessage('');
    setCreateModalOpen(false);
    setEditingAnn(null);
  };

  // Action: Publish Existing Draft from Detail Modal
  const handlePublishDraft = (ann: TodaAnnouncement) => {
    setAnnouncements((prev) =>
      prev.map((a) => (a.id === ann.id ? { ...a, isPublished: true } : a))
    );
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

  const isFormValid = formTitle.trim() && formMessage.trim();

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

  const actions = (
    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '10px' }}>
      <Button onClick={() => setReminderOpen(true)} startIcon={<NotificationsActiveIcon sx={{ fontSize: 16 }} />} variant="outlined" sx={secondaryButtonSx}>
        Send Reminder
      </Button>
      <Button onClick={handleOpenCreate} startIcon={<CampaignIcon sx={{ fontSize: 16 }} />} variant="contained" disableElevation sx={primaryButtonSx}>
        New Announcement
      </Button>
    </Box>
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
        actionButton={actions}
      />

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
        onClose={() => setCreateModalOpen(false)}
        title={editingAnn ? "Edit TODA Announcement" : "Create New TODA Announcement"}
        subtitle="Your drivers read it in their Driver App"
        maxWidth={560}
        primaryActionLabel={isFormValid ? (editingAnn ? "Save Announcement" : "Publish Announcement") : undefined}
        onPrimaryAction={isFormValid ? () => handleSaveAnnouncement(true) : undefined}
        secondaryActionLabel={isFormValid && !editingAnn ? "Save as Draft" : "Cancel"}
        onSecondaryAction={() => {
          if (isFormValid && !editingAnn) {
            handleSaveAnnouncement(false);
          } else {
            setCreateModalOpen(false);
          }
        }}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: SPACE.gap }}>
          <TextField
            fullWidth
            label="Announcement Title"
            placeholder="e.g. Mandatory General Assembly Meeting on May 20..."
            value={formTitle}
            onChange={(e) => setFormTitle(e.target.value)}
          />

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' }, gap: '13px' }}>
            <TextField
              select
              fullWidth
              label="Category"
              value={formCategory}
              onChange={(e) => setFormCategory(e.target.value as any)}
            >
              {categoryOptions.filter((c) => c.value !== 'All').map((opt) => (
                <MenuItem key={opt.value} value={opt.value}>{opt.label}</MenuItem>
              ))}
            </TextField>

            <TextField
              select
              fullWidth
              label="Urgency Priority"
              value={formUrgency}
              onChange={(e) => setFormUrgency(e.target.value as any)}
            >
              <MenuItem value="Standard">Standard Priority</MenuItem>
              <MenuItem value="High Priority">High Priority (Urgent Advisory)</MenuItem>
            </TextField>
          </Box>

          <TextField
            fullWidth
            multiline
            rows={4}
            label="Announcement Content / Message"
            placeholder="Provide clear details and instructions for TODA member drivers..."
            value={formMessage}
            onChange={(e) => setFormMessage(e.target.value)}
          />

          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
            <NotificationsActiveIcon aria-hidden sx={{ color: OPS_TEXT.brand, fontSize: 17, mt: '1px', flexShrink: 0 }} />
            <Typography sx={{ fontSize: FONT.small, color: OPS_TEXT.secondary, lineHeight: 1.5 }}>
              All member drivers are notified in their Driver App when an announcement is published or updated.
            </Typography>
          </Box>
        </Box>
      </MacCenterModal>

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
          secondaryActionLabel={selectedAnn.isPublished ? "Close" : "Edit Draft"}
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
              <StatusPill label={selectedAnn.category} tone="neutral" />
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
    </Box>
  );
};
