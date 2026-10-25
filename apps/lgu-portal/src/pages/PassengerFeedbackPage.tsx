import React, { useState, useEffect } from 'react';
import { Box, Typography, TableBody, TableCell, TableRow, Rating, Button, Alert, CircularProgress } from '@mui/material';

import { FilterToolbar, FilterOption } from '../components/admin/FilterToolbar';
import { MacConfirmDialog } from '../components/admin/MacConfirmDialog';
import { CellStack, DataTableCard, DataTableMessageRow, FlagTag } from '../components/common/DataTable';
import { StatStrip } from '../components/common/StatStrip';
import { fetchPassengerFeedback, excludeRating, PassengerFeedbackItem } from '../services/adminApiService';
import { FONT } from '../styles/density';
import { PAGE_TEXT, rowActionSx } from '../styles/pageTheme';

/**
 * ============================================================================
 * PASSENGER FEEDBACK & RATINGS PAGE (PassengerFeedbackPage.tsx)
 * ============================================================================
 * Checklist Scope:
 *   ● Review Passenger Feedback
 *     ○ View ratings
 *     ○ View passenger feedback
 *     ○ Review complaints
 * ============================================================================
 */
export const PassengerFeedbackPage: React.FC = () => {
  const [feedbackList, setFeedbackList] = useState<PassengerFeedbackItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [ratingFilter, setRatingFilter] = useState('All');
  const [categoryFilter, setCategoryFilter] = useState('All');
  // Rule 23.5: the LGU Administrator excludes a malicious or retaliatory rating from the Average Rating, with a reason (kept in the audit log)
  const [excludeTarget, setExcludeTarget] = useState<PassengerFeedbackItem | null>(null);
  const [actionNote, setActionNote] = useState<{ severity: 'success' | 'error'; text: string } | null>(null);

  const loadFeedback = async () => {
    setIsLoading(true);
    try {
      const data = await fetchPassengerFeedback();
      setFeedbackList(data);
    } catch (err) {
      console.error('[PassengerFeedbackPage] Error loading feedback:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadFeedback();
  }, []);

  const filteredFeedback = feedbackList.filter((item) => {
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      item.passengerName.toLowerCase().includes(q) ||
      item.driverName.toLowerCase().includes(q) ||
      item.todaName.toLowerCase().includes(q) ||
      item.comment.toLowerCase().includes(q);

    let matchesRating = true;
    if (ratingFilter === '5') matchesRating = item.ratingValue === 5;
    if (ratingFilter === '4') matchesRating = item.ratingValue === 4;
    if (ratingFilter === '3') matchesRating = item.ratingValue === 3;
    if (ratingFilter === 'Complaints') matchesRating = item.ratingValue <= 2 || item.isComplaint;

    const matchesCategory = categoryFilter === 'All' || item.category === categoryFilter;

    return matchesSearch && matchesRating && matchesCategory;
  });

  // Rule 23.1: the mean of the ratings that count (excluded ones leave the sum and the count); no ratings = Not Yet Rated, never a default score
  const counted = feedbackList.filter((f) => !f.isExcluded);
  const totalReviews = counted.length;
  const avgRating = totalReviews > 0 ? (counted.reduce((sum, f) => sum + f.ratingValue, 0) / totalReviews).toFixed(1) : null;
  const complaintsCount = counted.filter((f) => f.ratingValue <= 2 || f.isComplaint).length;
  const fiveStarCount = counted.filter((f) => f.ratingValue === 5).length;

  const confirmExclude = async (reason?: string) => {
    const target = excludeTarget;
    setExcludeTarget(null);
    if (!target) return;
    const problem = await excludeRating(target.ratingId, !target.isExcluded, reason || '');
    setActionNote(problem ? { severity: 'error', text: problem } : { severity: 'success', text: target.isExcluded ? 'The rating counts again.' : 'The rating was excluded from the Average Rating. The reason was recorded in the audit log.' });
    if (!problem) await loadFeedback();
  };

  const ratingOptions: FilterOption[] = [
    { label: 'All Ratings', value: 'All' },
    { label: '5 Stars (Excellent)', value: '5' },
    { label: '4 Stars (Good)', value: '4' },
    { label: '3 Stars (Average)', value: '3' },
    { label: 'Complaints (2 stars or lower)', value: 'Complaints' },
  ];

  const categoryOptions: FilterOption[] = [
    { label: 'All Categories', value: 'All' },
    { label: 'Cleanliness', value: 'Cleanliness' },
    { label: 'Courtesy', value: 'Courtesy' },
    { label: 'Safe Driving', value: 'Safe Driving' },
    { label: 'Fair Pricing', value: 'Fair Pricing' },
    { label: 'General', value: 'General' },
  ];

  const showCount = (n: number) => (isLoading ? <CircularProgress size={24} aria-label="Loading" sx={{ color: 'var(--sakay-orange)' }} /> : n);

  return (
    <Box sx={{ maxWidth: 1600, margin: '0 auto', pb: 4.8 }}>
      {/* 1. The ratings at a glance */}
      <StatStrip
        label="Rating totals"
        stats={[
          {
            key: 'average',
            label: 'Average rating',
            value: isLoading ? <CircularProgress size={24} aria-label="Loading" sx={{ color: 'var(--sakay-orange)' }} /> : avgRating === null ? 'Not yet rated' : `${avgRating} / 5.0`,
            note: `From ${totalReviews} ${totalReviews === 1 ? 'rating' : 'ratings'}`,
          },
          { key: 'fiveStar', label: '5-star ratings', value: showCount(fiveStarCount), tone: 'success', note: 'Excellent driver reviews' },
          { key: 'complaints', label: 'Complaints', value: showCount(complaintsCount), tone: complaintsCount > 0 ? 'danger' : 'neutral', note: 'Rated 2 stars or lower' },
          { key: 'total', label: 'All feedback', value: showCount(totalReviews), note: 'Ratings that count' },
        ]}
      />

      {/* 2. Search and filters */}
      <FilterToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Search comment, passenger, driver, TODA"
        selectFilters={[
          {
            id: 'rating',
            label: 'Star Rating',
            value: ratingFilter,
            options: ratingOptions,
            onChange: setRatingFilter,
          },
          {
            id: 'category',
            label: 'Category',
            value: categoryFilter,
            options: categoryOptions,
            onChange: setCategoryFilter,
          },
        ]}
        onResetFilters={() => {
          setSearchQuery('');
          setRatingFilter('All');
          setCategoryFilter('All');
        }}
      />

      {actionNote && <Alert severity={actionNote.severity} onClose={() => setActionNote(null)} sx={{ mb: 1.6, borderRadius: '10px' }}>{actionNote.text}</Alert>}

      {/* 3. The feedback */}
      <DataTableCard
        label="Passenger feedback"
        minWidth={860}
        columns={[
          { label: 'Passenger' },
          { label: 'Driver and TODA' },
          { label: 'Rating' },
          { label: 'Comment' },
          { label: 'Action', align: 'right' },
        ]}
      >
        <TableBody>
          {isLoading ? (
            <DataTableMessageRow colSpan={5} kind="loading" loadingText="Loading passenger feedback..." />
          ) : filteredFeedback.length > 0 ? (
            filteredFeedback.map((item) => (
              <TableRow key={item.id}>
                <TableCell>
                  <CellStack primary={item.passengerName} secondary={item.createdAt} />
                </TableCell>
                <TableCell>
                  <CellStack primary={item.driverName} secondary={item.todaName} />
                </TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Rating value={item.ratingValue} readOnly size="small" />
                    <Typography sx={{ fontSize: FONT.body, fontWeight: 700, color: PAGE_TEXT.primary }}>{item.ratingValue}.0</Typography>
                  </Box>
                  <Box sx={{ mt: '4px' }}>
                    <FlagTag label={item.category} tone="neutral" />
                  </Box>
                </TableCell>
                <TableCell>
                  <Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.primary, overflowWrap: 'anywhere' }}>"{item.comment}"</Typography>
                  {(item.isComplaint || item.isExcluded) && (
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '4px 6px', mt: '4px' }}>
                      {item.isComplaint && <FlagTag label="Complaint for LGU review" tone="danger" />}
                      {item.isExcluded && <FlagTag label="Excluded from the Average Rating" tone="warning" />}
                    </Box>
                  )}
                </TableCell>
                <TableCell align="right">
                  <Button
                    aria-label={`${item.isExcluded ? 'Count again' : 'Exclude'} the rating of ${item.passengerName}`}
                    onClick={() => setExcludeTarget(item)}
                    sx={rowActionSx('neutral')}
                  >
                    {item.isExcluded ? 'Count again' : 'Exclude'}
                  </Button>
                </TableCell>
              </TableRow>
            ))
          ) : (
            <DataTableMessageRow
              colSpan={5}
              kind={feedbackList.length > 0 ? 'noResults' : 'empty'}
              title={feedbackList.length > 0 ? 'No feedback matches' : 'No passenger feedback yet'}
              hint={
                feedbackList.length > 0
                  ? 'Nothing matches your search or filter. Try clearing them.'
                  : 'Ratings and comments appear here after passengers review their rides.'
              }
              onRefresh={loadFeedback}
            />
          )}
        </TableBody>
      </DataTableCard>

      <MacConfirmDialog
        open={Boolean(excludeTarget)}
        onClose={() => setExcludeTarget(null)}
        title={excludeTarget?.isExcluded ? 'Count this rating again' : 'Exclude this rating'}
        message={excludeTarget?.isExcluded
          ? 'The rating will count in the Average Rating again.'
          : 'Only a rating that was submitted maliciously or in retaliation, found so after an investigation, is excluded. It leaves both the total and the count of the Average Rating.'}
        confirmLabel={excludeTarget?.isExcluded ? 'Count again' : 'Exclude rating'}
        confirmVariant="danger"
        requireReason
        minReasonLength={10}
        reasonPlaceholder="What the investigation found (at least 10 characters)"
        onConfirm={(reason) => void confirmExclude(reason)}
      />
    </Box>
  );
};

