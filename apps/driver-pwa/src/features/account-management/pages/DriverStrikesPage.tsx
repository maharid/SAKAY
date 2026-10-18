import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Box } from '@mui/material';
import { StrikesAppealsView } from '@sakay/shared';

import PageHeader from '../../../common/components/PageHeader';
import SakayToast from '../../../common/components/SakayToast';
import {
  fetchMyAppeals,
  fetchMyStrikes,
  submitStrikeAppeal,
  type DriverAppeal,
  type StrikeHistory,
} from '../../../services/strikeAppealService';
import { useLanguage } from '../../../utils/LanguageContext';

/**
 * Rules 8.6, 9.4 and 25: the driver's strikes, and the way to appeal one. A strike for a stall or a lost connection can be appealed (a road
 * obstruction, a breakdown, a GPS or phone failure). The request goes to his TODA Administrator; the database refuses what the policy refuses.
 * The list and the appeal form are the shared view (the Passenger app shows the same one).
 */
const DriverStrikesPage: React.FC = () => {
  const navigate = useNavigate();
  const { language } = useLanguage();
  const tl = language === 'tl';

  const [history, setHistory] = useState<StrikeHistory | null>(null);
  const [appeals, setAppeals] = useState<DriverAppeal[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [h, a] = await Promise.all([fetchMyStrikes(), fetchMyAppeals()]);
    setHistory(h);
    setFailed(h === null);
    setAppeals(a);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <Box sx={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', backgroundColor: '#F8FAFC' }}>
      <SakayToast message={toast} severity="success" onClose={() => setToast(null)} />
      <PageHeader title={tl ? 'Mga Strike at Apela' : 'Strikes & Appeals'} onBack={() => navigate(-1)} />
      <StrikesAppealsView
        language={tl ? 'tl' : 'en'}
        audience="driver"
        history={history}
        appeals={appeals}
        loading={loading}
        failed={failed}
        onAppeal={submitStrikeAppeal}
        onAppealSent={async (message) => {
          setToast(message);
          await load();
        }}
      />
    </Box>
  );
};

export default DriverStrikesPage;
