import React from 'react';
import { useNavigate } from 'react-router-dom';
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
} from '@mui/material';

import PageHeader from '../../../../common/components/PageHeader';
import { useLanguage } from '../../../../utils/LanguageContext';

export const PassengerTermsOfService: React.FC = () => {
  const navigate = useNavigate();
  const { language } = useLanguage();

  const isTagalog = language === 'tl';

  return (
    <Box
      sx={{
        width: '100%',
        height: '100%',
        backgroundColor: '#FFFFFF',
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <PageHeader
        title={isTagalog ? 'Kasunduan sa Serbisyo' : 'Terms of Service'}
        onBack={() => navigate(-1)}
      />

      {/* 2. Scrollable Content */}
      <Box
        sx={{
          flex: 1,
          overflowY: 'auto',
          padding: '16px 24px calc(var(--safe-area-bottom) + 24px) 24px',
          display: 'flex',
          flexDirection: 'column',
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
          '&::-webkit-scrollbar': {
            display: 'none',
          },
        }}
      >
        {/* Title & Last Updated */}
        <Typography
          sx={{
            fontSize: '24px',
            fontWeight: 800,
            color: '#0F172A',
            lineHeight: 1.2,
            letterSpacing: '-0.5px',
            mb: 0.5,
          }}
        >
          {isTagalog ? 'Mga Tuntunin ng Serbisyo' : 'Terms of Service'}
        </Typography>
        <Typography
          sx={{
            fontSize: '13px',
            color: '#94A3B8',
            fontWeight: 500,
            mb: 2.5,
          }}
        >
          {isTagalog ? 'Huling binago: Hulyo 2026' : 'Last updated: July 2026'}
        </Typography>

        {isTagalog ? (
          /* TAGALOG CONTENT */
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
            {/* Section 1 */}
            <Box>
              <Typography sx={{ fontSize: '15px', fontWeight: 800, color: '#0F172A', mb: 0.75 }}>
                1. Pagiging Karapat-dapat
              </Typography>
              <Typography sx={{ fontSize: '13.5px', color: '#475569', lineHeight: 1.6, mb: 1 }}>
                Maaaring gumamit ng SAKAY Passenger ang sinumang:
              </Typography>
              <Box component="ul" sx={{ m: 0, pl: 2.5, color: '#475569', fontSize: '13px', lineHeight: 1.6 }}>
                <li>Nasa hustong gulang (18 taong gulang pataas), o menor de edad na may gabay o pahintulot ng magulang o tagapag-alaga.</li>
                <li>May aktibong numero ng mobile phone sa Pilipinas para sa pagtanggap ng beripikasyong SMS OTP.</li>
                <li>Sumasang-ayon na sundin ang mga lokal na ordinansa sa transportasyon ng Lungsod ng Calapan.</li>
              </Box>
            </Box>

            {/* Section 2 */}
            <Box>
              <Typography sx={{ fontSize: '15px', fontWeight: 800, color: '#0F172A', mb: 0.75 }}>
                2. Katumpakan ng Impormasyon
              </Typography>
              <Typography sx={{ fontSize: '13.5px', color: '#475569', lineHeight: 1.6, mb: 1 }}>
                Responsibilidad mong tiyaking totoo at tama ang iyong buong pangalan at numero ng mobile phone na inilalagay sa pagpaparehistro.
              </Typography>
              <Typography sx={{ fontSize: '13px', color: '#64748B', lineHeight: 1.6 }}>
                Ang paggamit ng pekeng impormasyon, pagpapanggap, o paggawa ng maraming gawa-gawang account ay mahigpit na ipinagbabawal at maaaring magresulta sa agarang pag-block ng iyong numero o device.
              </Typography>
            </Box>

            {/* Section 3 */}
            <Box>
              <Typography sx={{ fontSize: '15px', fontWeight: 800, color: '#0F172A', mb: 0.75 }}>
                3. Mga Istruktura ng Pamasahe at Diskwento
              </Typography>
              <Typography sx={{ fontSize: '13px', color: '#475569', lineHeight: 1.6, mb: 1.5 }}>
                Ang pamasahe sa SAKAY ay awtomatikong kinakalkula ayon sa opisyal na taripa ng Pamahalaang Lungsod ng Calapan at kasunduan ng mga TODA:
              </Typography>
              <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid #E2E8F0', borderRadius: '12px', mb: 1.5 }}>
                <Table size="small">
                  <TableHead sx={{ backgroundColor: '#F8FAFC' }}>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 700, fontSize: '12px', color: '#334155' }}>Kategorya</TableCell>
                      <TableCell sx={{ fontWeight: 700, fontSize: '12px', color: '#334155' }}>Alituntunin sa Pamasahe</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    <TableRow>
                      <TableCell sx={{ fontSize: '12px', color: '#475569' }}>Regular</TableCell>
                      <TableCell sx={{ fontSize: '12px', color: '#475569' }}>Standard LGU Matrix (Base fare + distansya bawat kilometro)</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell sx={{ fontSize: '12px', color: '#475569' }}>Estudyante / Senior / PWD</TableCell>
                      <TableCell sx={{ fontSize: '12px', color: '#475569' }}>20% Diskwento sang-ayon sa batas (ipakita ang balidong ID)</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell sx={{ fontSize: '12px', color: '#475569' }}>Paraan ng Pagbabayad</TableCell>
                      <TableCell sx={{ fontSize: '12px', color: '#475569' }}>Direktang Cash sa drayber pagbaba o mga suportadong e-wallet</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </TableContainer>
              <Typography sx={{ fontSize: '12.5px', color: '#64748B', lineHeight: 1.6 }}>
                Mahigpit na ipinagbabawal ang pagtangging magbayad ng tamang pamasahe o pamimilit na magbayad nang mas mababa kaysa sa itinakdang taripa ng lungsod.
              </Typography>
            </Box>

            {/* Section 4 */}
            <Box>
              <Typography sx={{ fontSize: '15px', fontWeight: 800, color: '#0F172A', mb: 0.75 }}>
                4. Pagsakay at Pag-uugali ng Pasahero
              </Typography>
              <Typography sx={{ fontSize: '13.5px', color: '#475569', lineHeight: 1.6, mb: 1 }}>
                Bilang pasahero, sumasang-ayon ka sa mga sumusunod na alituntunin:
              </Typography>
              <Box component="ul" sx={{ m: 0, pl: 2.5, color: '#475569', fontSize: '13px', lineHeight: 1.6 }}>
                <li>Sundin ang legal na kapasidad ng pasahero ng traysikel alinsunod sa batas ng lungsod; huwag ipilit ang labis na pasahero.</li>
                <li>Iwasan ang pagdadala ng mga mapanganib, nasusunog, ilegal, o mababahong kargamento.</li>
                <li>Maging magalang sa drayber sa lahat ng oras; ang anumang porma ng panliligalig, pananakot, o pananakit ay parurusahan.</li>
                <li>Pumunta agad sa itinakdang pickup location kapag dumating na ang drayber upang maiwasan ang sagabal sa trapiko.</li>
              </Box>
            </Box>

            {/* Section 5 */}
            <Box>
              <Typography sx={{ fontSize: '15px', fontWeight: 800, color: '#0F172A', mb: 0.75 }}>
                5. Mga Alituntunin sa Pagkansela
              </Typography>
              <Typography sx={{ fontSize: '13.5px', color: '#475569', lineHeight: 1.6, mb: 1 }}>
                Nauunawaan ng SAKAY na may mga pagkakataong kailangang kanselahin ang biyahe, subalit:
              </Typography>
              <Box component="ul" sx={{ m: 0, pl: 2.5, color: '#475569', fontSize: '13px', lineHeight: 1.6 }}>
                <li>Hinihikayat na magkansela sa loob ng 2 minuto matapos tanggapin ng drayber o bago pa magsimulang bumiyahe ang drayber.</li>
                <li>Ang paulit-ulit o hindi makatarungang pagkansela matapos makarating ang drayber sa pickup location (no-show) ay magdudulot ng booking cooldown o suspensyon sa iyong account.</li>
              </Box>
            </Box>

            {/* Section 6 */}
            <Box>
              <Typography sx={{ fontSize: '15px', fontWeight: 800, color: '#0F172A', mb: 0.75 }}>
                6. Kaligtasan, Tulong SOS, at Pag-uulat ng Insidente
              </Typography>
              <Typography sx={{ fontSize: '13.5px', color: '#475569', lineHeight: 1.6, mb: 1 }}>
                May karapatan ang bawat pasahero sa ligtas at maayos na biyahe:
              </Typography>
              <Box component="ul" sx={{ m: 0, pl: 2.5, color: '#475569', fontSize: '13px', lineHeight: 1.6 }}>
                <li>Maaari mong gamitin ang "Tulong" SOS button habang may aktibong biyahe kung may panganib o emergency.</li>
                <li>Maaari kang mag-file ng pormal na ulat ng insidente ukol sa paniningil ng labis, mapanganib na pagmamaneho, naiwang gamit, o bastos na pag-uugali direkta sa TODA at Calapan LGU CPSD.</li>
              </Box>
            </Box>

            {/* Section 7 */}
            <Box>
              <Typography sx={{ fontSize: '15px', fontWeight: 800, color: '#0F172A', mb: 0.75 }}>
                7. Pagsuspinde ng Account at Fair Use
              </Typography>
              <Typography sx={{ fontSize: '13px', color: '#475569', lineHeight: 1.6 }}>
                Ang paglabag sa mga tuntunin tulad ng paggawa ng mga pekeng booking (prank bookings), panloloko, o pagiging marahas sa mga drayber ay magreresulta sa agarang imbestigasyon, suspensyon, o permanenteng pag-deactivate ng iyong account sa ilalim ng regulasyon ng LGU.
              </Typography>
            </Box>
          </Box>
        ) : (
          /* ENGLISH CONTENT */
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
            {/* Section 1 */}
            <Box>
              <Typography sx={{ fontSize: '15px', fontWeight: 800, color: '#0F172A', mb: 0.75 }}>
                1. Eligibility
              </Typography>
              <Typography sx={{ fontSize: '13.5px', color: '#475569', lineHeight: 1.6, mb: 1 }}>
                To use SAKAY as a passenger, you must:
              </Typography>
              <Box component="ul" sx={{ m: 0, pl: 2.5, color: '#475569', fontSize: '13px', lineHeight: 1.6 }}>
                <li>Be at least 18 years of age, or have the guidance and consent of a parent or guardian if minor.</li>
                <li>Possess an active Philippine mobile number capable of receiving SMS OTP authentication.</li>
                <li>Agree to adhere to local transportation ordinances of the City of Calapan.</li>
              </Box>
            </Box>

            {/* Section 2 */}
            <Box>
              <Typography sx={{ fontSize: '15px', fontWeight: 800, color: '#0F172A', mb: 0.75 }}>
                2. Information Accuracy
              </Typography>
              <Typography sx={{ fontSize: '13.5px', color: '#475569', lineHeight: 1.6, mb: 1 }}>
                You are responsible for ensuring that your registered name and contact number are true, accurate, and current.
              </Typography>
              <Typography sx={{ fontSize: '13px', color: '#64748B', lineHeight: 1.6 }}>
                Creating fictitious accounts, impersonating others, or maintaining multiple duplicate profiles for fraudulent bookings is strictly prohibited and subject to account banning.
              </Typography>
            </Box>

            {/* Section 3 */}
            <Box>
              <Typography sx={{ fontSize: '15px', fontWeight: 800, color: '#0F172A', mb: 0.75 }}>
                3. Fare Structures & Statutory Discounts
              </Typography>
              <Typography sx={{ fontSize: '13px', color: '#475569', lineHeight: 1.6, mb: 1.5 }}>
                Fares displayed on the SAKAY platform are computed based on the official Calapan City LGU tricycle fare matrix and TODA agreements:
              </Typography>
              <TableContainer component={Paper} elevation={0} sx={{ border: '1px solid #E2E8F0', borderRadius: '12px', mb: 1.5 }}>
                <Table size="small">
                  <TableHead sx={{ backgroundColor: '#F8FAFC' }}>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 700, fontSize: '12px', color: '#334155' }}>Category</TableCell>
                      <TableCell sx={{ fontWeight: 700, fontSize: '12px', color: '#334155' }}>Fare Guidelines</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    <TableRow>
                      <TableCell sx={{ fontSize: '12px', color: '#475569' }}>Regular Passenger</TableCell>
                      <TableCell sx={{ fontSize: '12px', color: '#475569' }}>Standard LGU Matrix (Base distance + per km increment)</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell sx={{ fontSize: '12px', color: '#475569' }}>Student / Senior / PWD</TableCell>
                      <TableCell sx={{ fontSize: '12px', color: '#475569' }}>Mandatory 20% discount upon presentation of valid ID</TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell sx={{ fontSize: '12px', color: '#475569' }}>Payment Method</TableCell>
                      <TableCell sx={{ fontSize: '12px', color: '#475569' }}>Cash directly to driver upon arrival or supported e-wallets</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </TableContainer>
              <Typography sx={{ fontSize: '12.5px', color: '#64748B', lineHeight: 1.6 }}>
                Refusal to pay the computed legal fare or demanding unauthorized underpayments is strictly prohibited.
              </Typography>
            </Box>

            {/* Section 4 */}
            <Box>
              <Typography sx={{ fontSize: '15px', fontWeight: 800, color: '#0F172A', mb: 0.75 }}>
                4. Passenger Conduct & Safety
              </Typography>
              <Typography sx={{ fontSize: '13.5px', color: '#475569', lineHeight: 1.6, mb: 1 }}>
                As a passenger, you agree to:
              </Typography>
              <Box component="ul" sx={{ m: 0, pl: 2.5, color: '#475569', fontSize: '13px', lineHeight: 1.6 }}>
                <li>Respect the legal passenger capacity of the tricycle; do not insist on overloading.</li>
                <li>Refrain from transporting hazardous substances, flammable liquids, weapons, or illegal items.</li>
                <li>Treat drivers with civility and respect. Harassment, threats, or physical abuse will not be tolerated.</li>
                <li>Be present at the designated pickup point promptly upon the driver's arrival to prevent traffic obstruction.</li>
              </Box>
            </Box>

            {/* Section 5 */}
            <Box>
              <Typography sx={{ fontSize: '15px', fontWeight: 800, color: '#0F172A', mb: 0.75 }}>
                5. Cancellation Policy
              </Typography>
              <Typography sx={{ fontSize: '13.5px', color: '#475569', lineHeight: 1.6, mb: 1 }}>
                Cancellations should be avoided whenever possible:
              </Typography>
              <Box component="ul" sx={{ m: 0, pl: 2.5, color: '#475569', fontSize: '13px', lineHeight: 1.6 }}>
                <li>Please cancel within 2 minutes of booking acceptance or before the driver has initiated transit.</li>
                <li>Repeated cancellations without justifiable cause after driver arrival (no-shows) will result in temporary booking cooldowns or account review.</li>
              </Box>
            </Box>

            {/* Section 6 */}
            <Box>
              <Typography sx={{ fontSize: '15px', fontWeight: 800, color: '#0F172A', mb: 0.75 }}>
                6. Safety, Emergency SOS, and Incident Reporting
              </Typography>
              <Typography sx={{ fontSize: '13.5px', color: '#475569', lineHeight: 1.6, mb: 1 }}>
                You have the right to a secure, fair, and professional ride:
              </Typography>
              <Box component="ul" sx={{ m: 0, pl: 2.5, color: '#475569', fontSize: '13px', lineHeight: 1.6 }}>
                <li>Use the built-in "Tulong" Emergency SOS feature during active transit if you encounter distress or emergency.</li>
                <li>You can lodge formal complaints regarding overcharging, reckless driving, lost items, or discourtesy directly to the TODA and Calapan LGU CPSD.</li>
              </Box>
            </Box>

            {/* Section 7 */}
            <Box>
              <Typography sx={{ fontSize: '15px', fontWeight: 800, color: '#0F172A', mb: 0.75 }}>
                7. Account Suspension & Fair Use
              </Typography>
              <Typography sx={{ fontSize: '13px', color: '#475569', lineHeight: 1.6 }}>
                Conduct violating platform policies (e.g., booking pranks, non-payment of fares, or hostile behavior towards drivers) will trigger immediate review, temporary suspension, or permanent account deactivation under Calapan City LGU transport guidelines.
              </Typography>
            </Box>
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default PassengerTermsOfService;
