import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import { Alert, Box, Breadcrumbs, Button, Link, TableBody, TableCell, TableRow, Typography } from '@mui/material';
import NavigateNextIcon from '@mui/icons-material/NavigateNext';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';

import type { AccreditedTodaRecord, DriverRecord } from '../mockData/adminData';
import { FilterToolbar, FilterOption } from '../components/admin/FilterToolbar';
import { DriverDetailModal } from '../components/admin/DriverDetailModal';
import { DocumentReviewModal } from '../components/modals/DocumentReviewModal';
import { StatusBadge } from '../components/common/StatusBadge';
import { StatStrip, StatItem } from '../components/common/StatStrip';
import { PageNotice } from '../components/common/PageNotice';
import { DetailSection } from '../components/common/DetailSection';
import { CellStack, DataTableCard, DataTableMessageRow, FlagTag, PersonCell } from '../components/common/DataTable';
import {
  fetchAccreditedTodas,
  fetchTodaDrivers,
  fetchTodaMasterRoster,
  type MasterRosterEntryRow,
  type RosterFileVersionRow,
} from '../services/adminApiService';
import { buildRosterRows, type RosterMatch, type RosterRow } from '../utils/masterRoster';
import { FONT } from '../styles/density';
import { PAGE_BORDER, PAGE_TEXT, pageCardSx, rowActionSx, secondaryButtonSx } from '../styles/pageTheme';

type Match = RosterMatch;
type Row = RosterRow;

const MATCH_LABEL: Record<Match, string> = {
  matched: 'On the roster and registered',
  rosterOnly: 'On the roster, not registered',
  driverOnly: 'Registered, not on the roster',
  left: 'Left the roster',
};
const MATCH_TONE: Record<Match, 'success' | 'neutral' | 'warning' | 'danger'> = { matched: 'success', rosterOnly: 'neutral', driverOnly: 'warning', left: 'neutral' };

const formatDay = (iso?: string | null): string => (iso ? new Date(iso).toLocaleDateString('en-US', { timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric' }) : '');

/** Where the driver stands with THIS TODA, in the words of the two stages (TODA endorses, then the City LGU decides) */
function driverStage(driver?: DriverRecord): { label: string; status: string } {
  const aff = driver?.affiliations?.[0];
  if (!aff) return { label: 'No application', status: 'Pending' };
  if (aff.lguStage === 'Approved') return { label: 'Verified by the LGU', status: 'Verified' };
  if (aff.lguStage === 'Rejected') return { label: 'Rejected by the LGU', status: 'Rejected' };
  if (aff.todaStage === 'Rejected') return { label: 'Rejected by the TODA', status: 'Rejected' };
  if (aff.todaStage === 'Resubmission Required' || aff.lguStage === 'Resubmission Required') return { label: 'Returned for correction', status: 'Resubmission Required' };
  if (aff.todaStage === 'Endorsed') return { label: 'Waiting for the LGU', status: 'Endorsed to LGU' };
  return { label: 'With the TODA', status: 'Pending' };
}

/**
 * The Master Roster of one accredited TODA, on a page of its own (Accredited TODAs > the TODA > Master Roster). The LGU reads the TODA's roster next to EVERY driver
 * registered with it (verified or not) and sees at a glance who is on both lists, who is only on the roster and who registered without being on it, so what the TODA
 * submitted can be compared with who actually applied. The roster is the TODA's own record; this page changes nothing.
 */
export const TodaMasterRosterPage: React.FC = () => {
  const { todaId = '' } = useParams<{ todaId: string }>();
  const navigate = useNavigate();

  const [toda, setToda] = useState<AccreditedTodaRecord | null>(null);
  const [entries, setEntries] = useState<MasterRosterEntryRow[]>([]);
  const [versions, setVersions] = useState<RosterFileVersionRow[]>([]);
  const [drivers, setDrivers] = useState<DriverRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [view, setView] = useState('All');
  const [selectedDriver, setSelectedDriver] = useState<DriverRecord | null>(null);
  const [fileOpen, setFileOpen] = useState<{ title: string; name: string; url: string } | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [todas, roster, drvs] = await Promise.all([fetchAccreditedTodas(), fetchTodaMasterRoster(todaId), fetchTodaDrivers(todaId)]);
      setToda(todas.find((t) => t.id === todaId) ?? null);
      setEntries(roster.entries);
      setVersions(roster.versions);
      setDrivers(drvs);
    } catch (err) {
      console.error('[TodaMasterRosterPage] load failed:', err);
      setLoadError('The roster could not be loaded. Check the connection and try again.');
    } finally {
      setIsLoading(false);
    }
  }, [todaId]);

  useEffect(() => {
    void load();
  }, [load]);

  // One row per roster member and per registered driver (a member and a driver with the same franchise number are one row)
  const rows = useMemo<Row[]>(() => buildRosterRows(entries, drivers), [entries, drivers]);

  const counts = useMemo(() => {
    const c = { matched: 0, rosterOnly: 0, driverOnly: 0, left: 0 };
    rows.forEach((r) => { c[r.match] += 1; });
    return c;
  }, [rows]);

  const activeMembers = entries.filter((e) => e.status === 'Active').length;
  const registrationFile = versions.find((v) => v.kind === 'registration') ?? null;
  const rosterDoc = toda?.documents?.find((d) => /roster|driver/i.test(d.type) || /roster/i.test(d.name));
  const newerFiles = versions.filter((v) => v.kind === 'update');

  const stats: StatItem[] = [
    { key: 'members', label: 'On the Master Roster', value: activeMembers, note: `${entries.filter((e) => e.source === 'registration_file').length} from the registration file`, onSelect: () => setView('All'), selected: view === 'All' },
    { key: 'drivers', label: 'Registered drivers', value: drivers.length, note: `${drivers.filter((d) => d.affiliations?.[0]?.lguStage === 'Approved').length} verified by the LGU` },
    { key: 'matched', label: 'On both lists', value: counts.matched, tone: 'success', onSelect: () => setView('matched'), selected: view === 'matched' },
    { key: 'rosterOnly', label: 'On the roster only', value: counts.rosterOnly, note: 'No driver account yet', onSelect: () => setView('rosterOnly'), selected: view === 'rosterOnly' },
    { key: 'driverOnly', label: 'Registered, not on the roster', value: counts.driverOnly, tone: counts.driverOnly > 0 ? 'brand' : 'neutral', note: 'The LGU may ask the TODA why', onSelect: () => setView('driverOnly'), selected: view === 'driverOnly' },
  ];

  const viewOptions: FilterOption[] = [
    { label: 'Everyone', value: 'All' },
    { label: MATCH_LABEL.matched, value: 'matched' },
    { label: MATCH_LABEL.rosterOnly, value: 'rosterOnly' },
    { label: MATCH_LABEL.driverOnly, value: 'driverOnly' },
    { label: `${MATCH_LABEL.left} (${counts.left})`, value: 'left' },
  ];

  const shown = rows.filter((r) => {
    if (view === 'All' ? r.match === 'left' : r.match !== view) return false;
    const q = search.trim().toLowerCase();
    return !q || [r.name, r.franchise, r.plate, r.membershipNo].some((v) => String(v || '').toLowerCase().includes(q));
  });

  const todaName = toda?.name ?? 'This TODA';

  return (
    <Box sx={{ maxWidth: 1600, margin: '0 auto', pb: 4.8 }}>
      {/* Where this page is, and the way back */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px 16px', mb: '14px' }}>
        <Breadcrumbs aria-label="You are here" separator={<NavigateNextIcon sx={{ fontSize: 16, color: PAGE_TEXT.secondary }} />} sx={{ '& .MuiBreadcrumbs-li': { fontSize: FONT.body } }}>
          <Link component={RouterLink} to="/accredited-todas" underline="hover" sx={{ color: PAGE_TEXT.brand, fontWeight: 600 }}>
            Accredited TODAs
          </Link>
          <Link component={RouterLink} to={`/accredited-todas?toda=${encodeURIComponent(todaId)}`} underline="hover" sx={{ color: PAGE_TEXT.brand, fontWeight: 600, overflowWrap: 'anywhere' }}>
            {todaName}
          </Link>
          <Typography component="span" aria-current="page" sx={{ fontSize: FONT.body, fontWeight: 700, color: PAGE_TEXT.primary }}>
            Master Roster
          </Typography>
        </Breadcrumbs>
        <Button startIcon={<ArrowBackIcon sx={{ fontSize: 16 }} />} onClick={() => navigate('/accredited-todas')} sx={secondaryButtonSx}>
          Back to Accredited TODAs
        </Button>
      </Box>

      {loadError && (
        <Alert severity="error" sx={{ mb: '14px', borderRadius: '10px' }} action={<Button color="inherit" size="small" onClick={() => void load()}>Try again</Button>}>
          {loadError}
        </Alert>
      )}

      {!isLoading && !toda && !loadError && (
        <Alert severity="warning" sx={{ mb: '14px', borderRadius: '10px' }}>
          This TODA was not found among the accredited TODAs. It may not be accredited (yet), or the link is old.
        </Alert>
      )}

      <PageNotice title={`${todaName}: roster and registered drivers`}>
        The Master Roster is the TODA's own list of members; it is what an application is checked against. Below it is set next to <b>every</b> driver who registered with this TODA,
        whether the driver is verified or not, so you can compare who the TODA says belongs to it with who actually applied. This page only reads: the TODA keeps its roster, and a driver is
        verified from <b>Drivers</b> or the driver's own review window.
      </PageNotice>

      <StatStrip stats={stats} label="Master roster numbers" />

      {/* The files the TODA submitted */}
      <Box sx={{ ...pageCardSx, p: '16px 18px', mt: '14px' }}>
        <DetailSection
          title="Roster files"
          note={versions.length > 0 ? `${versions.length} ${versions.length === 1 ? 'file' : 'files'} on record` : undefined}
        >
          {versions.length === 0 && !rosterDoc ? (
            <Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.secondary }}>No roster file is on record for this TODA.</Typography>
          ) : (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {(versions.length > 0 ? versions : [{ versionId: 'registration', kind: 'registration' as const, filePath: rosterDoc?.url || '', fileName: rosterDoc?.name || 'Driver roster', uploadedAt: '' }]).map((v) => {
                const url = v.kind === 'registration' && rosterDoc?.url ? rosterDoc.url : v.filePath;
                return (
                  <Box key={v.versionId} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px 12px', p: '10px 12px', border: `1px solid ${PAGE_BORDER}`, borderRadius: '10px', backgroundColor: '#FFFFFF' }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                      <DescriptionOutlinedIcon aria-hidden sx={{ color: PAGE_TEXT.brand, fontSize: 20 }} />
                      <Box sx={{ minWidth: 0 }}>
                        <Typography sx={{ fontSize: FONT.body, fontWeight: 600, color: PAGE_TEXT.primary, overflowWrap: 'anywhere' }}>{v.fileName.replace(/^\d{13}_/, '')}</Typography>
                        <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary }}>
                          {v.kind === 'registration' ? 'Registration roster file (what the LGU accredited, kept as submitted)' : 'Newer roster file'}
                          {v.uploadedAt ? ` · ${formatDay(v.uploadedAt)}` : ''}
                        </Typography>
                      </Box>
                    </Box>
                    <Button aria-label={`View ${v.fileName}`} disabled={!url} onClick={() => setFileOpen({ title: 'Driver Roster', name: v.fileName.replace(/^\d{13}_/, ''), url })} sx={rowActionSx('brand')}>
                      View
                    </Button>
                  </Box>
                );
              })}
            </Box>
          )}
          {registrationFile && newerFiles.length > 0 && (
            <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary, mt: '8px' }}>
              The TODA submitted {newerFiles.length} newer roster file{newerFiles.length === 1 ? '' : 's'} since it was accredited. A newer file changes the Master Roster only when the TODA confirms each member.
            </Typography>
          )}
        </DetailSection>
      </Box>

      {/* The comparison */}
      <Box sx={{ mt: '14px' }}>
        <FilterToolbar
          searchQuery={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search name, franchise, plate or membership number"
          selectFilters={[{ id: 'view', label: 'Show', value: view, options: viewOptions, onChange: setView, width: 280 }]}
          onResetFilters={() => { setSearch(''); setView('All'); }}
        />

        <DataTableCard
          label="Master roster and registered drivers"
          minWidth={980}
          stackBelow={640}
          columns={[
            { label: 'Member / driver' },
            { label: 'Franchise and plate' },
            { label: 'Roster' },
            { label: 'Driver account with this TODA' },
            { label: 'Action', align: 'right' },
          ]}
        >
          <TableBody>
            {isLoading ? (
              <DataTableMessageRow colSpan={5} kind="loading" loadingText="Loading the roster and the drivers..." />
            ) : shown.length === 0 ? (
              <DataTableMessageRow
                colSpan={5}
                kind={rows.length > 0 ? 'noResults' : 'empty'}
                title={rows.length > 0 ? 'Nothing matches' : 'No roster members or drivers yet'}
                hint={rows.length > 0 ? 'Nothing matches your search or filter. Try clearing them.' : 'This TODA has no roster entries and no driver has applied to it.'}
                onRefresh={() => void load()}
              />
            ) : (
              shown.map((r) => {
                const stage = driverStage(r.driver);
                return (
                  <TableRow key={r.key}>
                    <TableCell>
                      <PersonCell name={r.name || 'Unnamed member'} detail={r.membershipNo ? `Membership no. ${r.membershipNo}` : undefined} tags={<FlagTag label={MATCH_LABEL[r.match]} tone={MATCH_TONE[r.match]} />} />
                    </TableCell>
                    <TableCell>
                      <CellStack primary={r.franchise || 'No franchise number'} secondary={r.plate || 'No plate on file'} />
                    </TableCell>
                    <TableCell>
                      {r.entry ? (
                        <CellStack
                          primary={r.entry.status === 'Active' ? 'Active member' : 'Left the roster'}
                          secondary={
                            r.entry.status === 'Left'
                              ? `${formatDay(r.entry.leftAt)}${r.entry.leftReason ? `: ${r.entry.leftReason}` : ''}`
                              : `${r.entry.source === 'registration_file' ? 'From the registration file' : r.entry.source === 'file_update' ? 'From a newer file' : 'Added by the TODA'} · ${formatDay(r.entry.addedAt)}`
                          }
                        />
                      ) : (
                        <Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.secondary }}>Not on the roster</Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      {r.driver ? (
                        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
                          <StatusBadge status={stage.status} />
                          <Typography sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary }}>{stage.label}</Typography>
                        </Box>
                      ) : (
                        <Typography sx={{ fontSize: FONT.body, color: PAGE_TEXT.secondary }}>No driver account</Typography>
                      )}
                    </TableCell>
                    <TableCell align="right">
                      {r.driver ? (
                        <Button aria-label={`Review driver ${r.name}`} onClick={() => setSelectedDriver(r.driver!)} sx={rowActionSx('neutral')}>
                          Review driver
                        </Button>
                      ) : (
                        <Typography component="span" sx={{ fontSize: FONT.small, color: PAGE_TEXT.secondary }}>-</Typography>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </DataTableCard>
      </Box>

      {selectedDriver && <DriverDetailModal open onClose={() => { setSelectedDriver(null); void load(); }} driver={selectedDriver} />}
      {fileOpen && <DocumentReviewModal open onClose={() => setFileOpen(null)} documentTitle={fileOpen.title} fileName={fileOpen.name} fileUrl={fileOpen.url} />}
    </Box>
  );
};
