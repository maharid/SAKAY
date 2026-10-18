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
  Card,
  CardContent,
  Rating,
  Chip,
  CircularProgress,
  Button,
  Alert,
} from '@mui/material';
import StarIcon from '@mui/icons-material/Star';
import FeedbackIcon from '@mui/icons-material/Feedback';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import RefreshIcon from '@mui/icons-material/Refresh';

import { FilterToolbar, FilterOption } from '../components/admin/FilterToolbar';
import { TableEmptyState } from '../components/common/TableEmptyState';
import { MacConfirmDialog } from '../components/admin/MacConfirmDialog';
import { fetchPassengerFeedback, excludeRating, PassengerFeedbackItem } from '../services/adminApiService';

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
    { label: 'Complaints (<= 2 Stars)', value: 'Complaints' },
  ];

  const categoryOptions: FilterOption[] = [
    { label: 'All Categories', value: 'All' },
    { label: 'Cleanliness', value: 'Cleanliness' },
    { label: 'Courtesy', value: 'Courtesy' },
    { label: 'Safe Driving', value: 'Safe Driving' },
    { label: 'Fair Pricing', value: 'Fair Pricing' },
    { label: 'General', value: 'General' },
  ];

  return (
    <Box sx={{ maxWidth: 1600, margin: '0 auto', pb: 6 }}>
      {/* 1. Summary Cards */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' },
          gap: 2.5,
          mb: 4,
        }}
      >
        <Card sx={{ borderRadius: 'var(--mac-radius-lg)', border: '1px solid var(--mac-border-color)', boxShadow: 'var(--mac-shadow-card)', backgroundColor: '#FFFFFF' }}>
          <CardContent sx={{ p: '20px 22px !important' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
              <Typography sx={{ fontSize: '10px', fontWeight: 600, color: 'var(--mac-text-muted)', textTransform: 'uppercase' }}>
                Overall Commuter Rating
              </Typography>
              <StarIcon sx={{ color: '#FBBC04', fontSize: '17.6' }} />
            </Box>
            <Typography sx={{ fontSize: '22.4px', fontWeight: 700, color: 'var(--mac-text-primary)', mb: 0.5 }}>
              {avgRating === null ? 'Not Yet Rated' : `⭐ ${avgRating} / 5.0`}
            </Typography>
            <Typography sx={{ fontSize: '9.6px', color: 'var(--mac-text-muted)' }}>
              From {totalReviews} passenger evaluations
            </Typography>
          </CardContent>
        </Card>

        <Card sx={{ borderRadius: 'var(--mac-radius-lg)', border: '1px solid var(--mac-border-color)', boxShadow: 'var(--mac-shadow-card)', backgroundColor: '#FFFFFF' }}>
          <CardContent sx={{ p: '20px 22px !important' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
              <Typography sx={{ fontSize: '10px', fontWeight: 600, color: 'var(--mac-text-muted)', textTransform: 'uppercase' }}>
                5-Star Commendations
              </Typography>
              <StarIcon sx={{ color: '#2E7D32', fontSize: '17.6' }} />
            </Box>
            <Typography sx={{ fontSize: '22.4px', fontWeight: 700, color: '#2E7D32', mb: 0.5 }}>
              {fiveStarCount}
            </Typography>
            <Typography sx={{ fontSize: '9.6px', color: 'var(--mac-text-muted)' }}>
              Excellent driver reviews
            </Typography>
          </CardContent>
        </Card>

        <Card sx={{ borderRadius: 'var(--mac-radius-lg)', border: '1px solid var(--mac-border-color)', boxShadow: 'var(--mac-shadow-card)', backgroundColor: '#FFFFFF' }}>
          <CardContent sx={{ p: '20px 22px !important' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
              <Typography sx={{ fontSize: '10px', fontWeight: 600, color: 'var(--mac-text-muted)', textTransform: 'uppercase' }}>
                Critical Complaints
              </Typography>
              <WarningAmberIcon sx={{ color: '#DC2626', fontSize: '17.6' }} />
            </Box>
            <Typography sx={{ fontSize: '22.4px', fontWeight: 700, color: '#DC2626', mb: 0.5 }}>
              {complaintsCount}
            </Typography>
            <Typography sx={{ fontSize: '9.6px', color: 'var(--mac-text-muted)' }}>
              Low ratings (&le;2 stars) for review
            </Typography>
          </CardContent>
        </Card>

        <Card sx={{ borderRadius: 'var(--mac-radius-lg)', border: '1px solid var(--mac-border-color)', boxShadow: 'var(--mac-shadow-card)', backgroundColor: '#FFFFFF' }}>
          <CardContent sx={{ p: '20px 22px !important' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
              <Typography sx={{ fontSize: '10px', fontWeight: 600, color: 'var(--mac-text-muted)', textTransform: 'uppercase' }}>
                Total Feedback Records
              </Typography>
              <FeedbackIcon sx={{ color: 'var(--sakay-orange)', fontSize: '17.6' }} />
            </Box>
            <Typography sx={{ fontSize: '22.4px', fontWeight: 700, color: 'var(--sakay-orange)', mb: 0.5 }}>
              {totalReviews}
            </Typography>
            <Typography sx={{ fontSize: '9.6px', color: 'var(--mac-text-muted)' }}>
              Total passenger reviews
            </Typography>
          </CardContent>
        </Card>
      </Box>

      {/* 2. Filter Toolbar */}
      <FilterToolbar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        searchPlaceholder="Search feedback comments, passenger, driver, or TODA..."
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

      {actionNote && <Alert severity={actionNote.severity} onClose={() => setActionNote(null)} sx={{ mb: 2 }}>{actionNote.text}</Alert>}

      {/* 3. Feedback Data Table */}
      <TableContainer
        component={Paper}
        elevation={0}
        sx={{
          borderRadius: 'var(--mac-radius-lg)',
          border: '1px solid var(--mac-border-color)',
          boxShadow: 'var(--mac-shadow-card)',
          overflow: 'hidden',
          backgroundColor: '#FFFFFF',
        }}
      >
        <Table>
          <TableHead sx={{ backgroundColor: '#FAFAFC' }}>
            <TableRow>
              <TableCell sx={{ fontWeight: 600, fontSize: '10.4px', color: 'var(--mac-text-muted)', py: 2, px: 3 }}>
                PASSENGER & DATE
              </TableCell>
              <TableCell sx={{ fontWeight: 600, fontSize: '10.4px', color: 'var(--mac-text-muted)', py: 2, px: 3 }}>
                EVALUATED DRIVER & TODA
              </TableCell>
              <TableCell sx={{ fontWeight: 600, fontSize: '10.4px', color: 'var(--mac-text-muted)', py: 2, px: 3 }}>
                RATING & CATEGORY
              </TableCell>
              <TableCell sx={{ fontWeight: 600, fontSize: '10.4px', color: 'var(--mac-text-muted)', py: 2, px: 3 }}>
                PASSENGER FEEDBACK COMMENT
              </TableCell>
              <TableCell align="right" sx={{ fontWeight: 600, fontSize: '10.4px', color: 'var(--mac-text-muted)', py: 2, px: 3 }}>
                RULE 23.5
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} align="center" sx={{ py: 8 }}>
                  <CircularProgress size={32} sx={{ color: 'var(--sakay-orange)', mb: 1.5 }} />
                  <Typography sx={{ fontSize: '11.3px', color: 'var(--mac-text-muted)' }}>
                    Loading passenger feedback...
                  </Typography>
                </TableCell>
              </TableRow>
            ) : filteredFeedback.length > 0 ? (
              filteredFeedback.map((item) => (
                <TableRow
                  key={item.id}
                  sx={{
                    transition: 'var(--mac-transition-fast)',
                    '&:hover': { backgroundColor: 'var(--mac-canvas-bg)' },
                  }}
                >
                  <TableCell sx={{ py: 2.2, px: 3 }}>
                    <Typography sx={{ fontWeight: 600, fontSize: '11.6px', color: 'var(--mac-text-primary)' }}>
                      {item.passengerName}
                    </Typography>
                    <Typography sx={{ fontSize: '9.6px', color: 'var(--mac-text-muted)', mt: '2px' }}>
                      {item.createdAt}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ py: 2.2, px: 3 }}>
                    <Typography sx={{ fontWeight: 600, fontSize: '11.3px', color: 'var(--mac-text-primary)' }}>
                      {item.driverName}
                    </Typography>
                    <Typography sx={{ fontSize: '9.6px', color: 'var(--mac-text-muted)' }}>
                      {item.todaName}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ py: 2.2, px: 3 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Rating value={item.ratingValue} readOnly size="small" />
                      <Typography sx={{ fontSize: '10.4px', fontWeight: 700 }}>
                        {item.ratingValue}.0
                      </Typography>
                    </Box>
                    <Box sx={{ mt: '4px' }}>
                      <Chip
                        label={item.category}
                        size="small"
                        sx={{ fontSize: '8.8px', fontWeight: 600, height: 22 }}
                      />
                    </Box>
                  </TableCell>
                  <TableCell sx={{ py: 2.2, px: 3 }}>
                    <Typography sx={{ fontSize: '10.8px', color: 'var(--mac-text-primary)', fontStyle: 'italic' }}>
                      "{item.comment}"
                    </Typography>
                    {item.isComplaint && (
                      <Typography sx={{ fontSize: '9.3px', color: '#DC2626', fontWeight: 700, mt: '4px' }}>
                        ⚠️ Flagged for Triage Officer Attention
                      </Typography>
                    )}
                    {item.isExcluded && (
                      <Typography sx={{ fontSize: '9.3px', color: '#92400E', fontWeight: 700, mt: '4px' }}>
                        Excluded from the Average Rating (Rule 23.5)
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="right" sx={{ py: 2.2, px: 3 }}>
                    <Button size="small" variant="outlined" onClick={() => setExcludeTarget(item)} sx={{ textTransform: 'none', fontWeight: 600, fontSize: '10px' }}>
                      {item.isExcluded ? 'Count again' : 'Exclude'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableEmptyState
                colSpan={5}
                icon={<FeedbackIcon />}
                title="No passenger feedback records found"
                description={
                  searchQuery || ratingFilter !== 'All'
                    ? 'No feedback entries match your search criteria.'
                    : 'Passenger ratings and feedback will appear here once commuters begin submitting reviews after their rides.'
                }
                onRefresh={loadFeedback}
                isRefreshing={isLoading}
              />
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <MacConfirmDialog
        open={Boolean(excludeTarget)}
        onClose={() => setExcludeTarget(null)}
        title={excludeTarget?.isExcluded ? 'Count this rating again' : 'Exclude this rating'}
        message={excludeTarget?.isExcluded
          ? 'The rating will count in the Average Rating again.'
          : 'Only a rating that was submitted maliciously or in retaliation, found so after an investigation, is excluded (Rule 23.5). It leaves both the total and the count of the Average Rating.'}
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

