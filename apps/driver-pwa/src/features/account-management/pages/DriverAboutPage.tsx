import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Box } from '@mui/material';
import { AboutSakayContent } from '@sakay/shared';

import PageHeader from '../../../common/components/PageHeader';
import Logo from '../../../common/components/Logo';
import { useLanguage } from '../../../utils/LanguageContext';

export const DriverAboutPage: React.FC = () => {
  const { language } = useLanguage();
  const navigate = useNavigate();

  return (
    <Box sx={{ width: '100%', height: '100%', backgroundColor: '#FAFAFA', display: 'flex', flexDirection: 'column' }}>
      <PageHeader title={language === 'tl' ? 'Tungkol sa SAKAY' : 'About SAKAY'} onBack={() => navigate('/driver/settings')} />
      <Box className="hide-scrollbar" sx={{ flexGrow: 1, overflowY: 'auto', p: 2.5 }}>
        <AboutSakayContent language={language} audience="driver" logo={<Logo color="orange" width={140} />} />
      </Box>
    </Box>
  );
};

export default DriverAboutPage;
