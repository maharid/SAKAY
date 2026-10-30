import React from 'react';
import { TerminalMapPicker } from '@sakay/shared';

import { fetchServiceArea } from '../../services/serviceAreaService';

interface TerminalMapPickerModalProps {
  open: boolean;
  onClose: () => void;
  initialLat?: number | null;
  initialLng?: number | null;
  onConfirmLocation: (location: { lat: number; lng: number; locationName?: string }) => void;
}

// The pin picker itself lives in @sakay/shared (the LGU portal's copy of the registration uses it too); this only gives it the portal's way of reading the service area.
export const TerminalMapPickerModal: React.FC<TerminalMapPickerModalProps> = (props) => (
  <TerminalMapPicker loadServiceArea={fetchServiceArea} {...props} />
);
