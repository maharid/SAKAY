import React, { useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import AddPhotoAlternateIcon from '@mui/icons-material/AddPhotoAlternate';
import CloseIcon from '@mui/icons-material/Close';

import { CASE_EVIDENCE_MAX_FILES, caseEvidenceProblem } from '../utils/caseEvidence';
import { INCIDENT_EVIDENCE_MAX_BYTES } from '../utils/incidentReports';

export interface EvidencePickerProps {
  language: 'tl' | 'en';
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
}

/**
 * Up to three photos (JPEG, PNG or WebP, 5 MB each) to go with an appeal (Rule 25.2) or a statement in a fare dispute (Rule 18.4). Nothing is uploaded here: the screen that
 * owns the picker uploads them when the person sends (uploadCaseEvidenceFiles). A photo that could not be accepted is refused at once, with the reason.
 */
export const EvidencePicker: React.FC<EvidencePickerProps> = ({ language, files, onChange, disabled = false }) => {
  const tl = language === 'tl';
  const input = useRef<HTMLInputElement | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const add = (picked: FileList | null) => {
    const next = [...files, ...Array.from(picked ?? [])];
    const why = caseEvidenceProblem(next);
    if (why) {
      setProblem(why);
    } else {
      setProblem(null);
      onChange(next);
    }
    if (input.current) input.current.value = '';
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        hidden
        onChange={(e) => add(e.target.files)}
        aria-label={tl ? 'Mga larawan' : 'Photos'}
      />
      <Button
        variant="outlined"
        size="small"
        startIcon={<AddPhotoAlternateIcon />}
        disabled={disabled || files.length >= CASE_EVIDENCE_MAX_FILES}
        onClick={() => input.current?.click()}
        sx={{ textTransform: 'none', fontWeight: 600, alignSelf: 'flex-start' }}
      >
        {files.length === 0
          ? tl ? 'Magdagdag ng larawan (opsyonal)' : 'Add photos (optional)'
          : tl ? `${files.length} sa ${CASE_EVIDENCE_MAX_FILES} larawan` : `${files.length} of ${CASE_EVIDENCE_MAX_FILES} photos`}
      </Button>
      <Typography sx={{ fontSize: '11.5px', color: '#64748B' }}>
        {tl
          ? `Hanggang ${CASE_EVIDENCE_MAX_FILES} larawan (JPEG, PNG o WebP), ${INCIDENT_EVIDENCE_MAX_BYTES / (1024 * 1024)} MB bawat isa. Makikita ito ng nagsusuri ng kaso.`
          : `Up to ${CASE_EVIDENCE_MAX_FILES} photos (JPEG, PNG or WebP), ${INCIDENT_EVIDENCE_MAX_BYTES / (1024 * 1024)} MB each. The person who reviews the case can see them.`}
      </Typography>
      {files.map((f, i) => (
        <Box key={`${f.name}-${i}`} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Typography sx={{ fontSize: '12.5px', color: '#0F172A', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.name}</Typography>
          <IconButton size="small" disabled={disabled} aria-label={tl ? 'Alisin ang larawan' : 'Remove photo'} onClick={() => onChange(files.filter((_, j) => j !== i))}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
      ))}
      {problem && <Typography sx={{ fontSize: '12px', color: '#B45309' }}>{problem}</Typography>}
    </Box>
  );
};
