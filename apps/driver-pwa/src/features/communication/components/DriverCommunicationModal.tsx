import React from 'react';
import { QuickMessageDialog } from '@sakay/shared';
import { useLanguage } from '../../../utils/LanguageContext';

export interface DriverCommunicationModalProps {
  open: boolean;
  onClose: () => void;
  passengerName: string;
  passengerPhone: string;
  currentStage?: string;
}

/** Short ready-made messages for what the driver is doing right now, in the driver's language */
export const driverMessageTemplates = (stage: string, tl: boolean): string[] => {
  if (stage === 'Accepted' || stage === 'In Transit' || stage === 'Driver Assigned') {
    return tl
      ? ['Papunta na po ako sa pickup.', 'Darating po ako sa loob ng 3 minuto.', 'Pakihintay po sa pickup spot.']
      : ["I'm on my way to the pickup.", "I'll arrive in about 3 minutes.", 'Please wait at the pickup spot.'];
  }
  if (stage === 'Arrived at Pickup' || stage === 'Driver Arrived') {
    // Rules 11.1 - 11.3: the first name is checked before boarding, and a booking of another account is not accepted unless its passenger is there
    return tl
      ? ['Nandito na po ako sa pickup.', 'Naghihintay po ako sa labas.', 'Maaari na po kayong lumabas.',
         'Maaari po bang sabihin ang inyong unang pangalan? Kailangan ko po itong itugma sa booking.',
         'Ibang account po ang may-ari ng booking na ito. Ang nakarehistrong pasahero lamang po ang maisasakay ko.']
      : ["I'm at the pickup.", "I'm waiting outside.", 'You can come out now.',
         'May I have your first name, please? I need to check it against the booking.',
         'This booking belongs to another account. I can only take the registered passenger, please.'];
  }
  if (stage === 'Trip Ongoing') {
    // Rule 11.4: a wrong passenger found after the trip started: stop safely and confirm with them through the app
    return tl
      ? ['Papunta na po tayo sa destinasyon.', 'Paki-ingatan po ang inyong mga gamit.', 'May trapiko po, dahan-dahan tayo.',
         'Ikaw po ba ang nakarehistrong pasahero sa booking na ito? Titigil po ako sa ligtas na lugar para makumpirma.']
      : ["We're on our way to your destination.", 'Please keep your belongings with you.', "There's some traffic, we'll go carefully.",
         'Are you the passenger registered for this booking? I will stop somewhere safe so we can confirm.'];
  }
  return tl
    ? ['Malapit na po tayo sa destinasyon.', 'Pakihanda po ang pamasahe. Salamat!', 'Pababa na po tayo.']
    : ["We're almost at your destination.", 'Please prepare your fare. Thank you!', "I'll drop you off here."];
};

/** The driver's quick-message sheet (the shared one, with the messages for the current stage and a Call button) */
export const DriverCommunicationModal: React.FC<DriverCommunicationModalProps> = ({
  open,
  onClose,
  passengerName,
  passengerPhone,
  currentStage = 'In Transit',
}) => {
  const { language } = useLanguage();
  const tl = language === 'tl';
  return (
    <QuickMessageDialog
      open={open}
      onClose={onClose}
      language={language}
      recipient={`${tl ? 'Pasahero' : 'Passenger'}: ${passengerName}`}
      phone={passengerPhone}
      templates={driverMessageTemplates(currentStage || 'In Transit', tl)}
      allowCall
    />
  );
};

export default DriverCommunicationModal;
