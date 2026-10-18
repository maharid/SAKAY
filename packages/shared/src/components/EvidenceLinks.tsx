import React, { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import Typography from '@mui/material/Typography';

import type { CaseEvidenceFile } from '../utils/caseEvidence';

export interface EvidenceLinksProps {
  /** the storage paths a case holds (or, for an older appeal, a plain link) */
  paths: string[];
  /** turns the paths into short-lived links the signed-in person may open (signCaseEvidence with the app's own client) */
  sign: (paths: string[]) => Promise<CaseEvidenceFile[]>;
  label?: string;
}

/**
 * The photos of a case as links, signed when the reviewer looks at the case (not when a list loads). A photo this person may not read, or that no longer exists, is not
 * shown; the line says how many could not be opened so a missing one is not mistaken for none.
 */
export const EvidenceLinks: React.FC<EvidenceLinksProps> = ({ paths, sign, label = 'Photos' }) => {
  const [files, setFiles] = useState<CaseEvidenceFile[] | null>(null);
  const key = paths.join('|');

  useEffect(() => {
    let alive = true;
    setFiles(null);
    if (paths.length === 0) {
      setFiles([]);
      return undefined;
    }
    sign(paths)
      .then((f) => alive && setFiles(f))
      .catch(() => alive && setFiles([]));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (paths.length === 0) return null;
  return (
    <Box sx={{ mt: 0.5 }}>
      <Typography sx={{ fontSize: '11px', color: '#64748B', fontWeight: 700, textTransform: 'uppercase' }}>{label}</Typography>
      {files === null ? (
        <Typography sx={{ fontSize: '12.5px', color: '#64748B' }}>Loading...</Typography>
      ) : (
        <>
          {files.map((f, i) => (
            <Box key={f.url}>
              <Link href={f.url} target="_blank" rel="noopener noreferrer" sx={{ fontSize: '13px' }}>{`Photo ${i + 1}`}</Link>
            </Box>
          ))}
          {files.length < paths.length && (
            <Typography sx={{ fontSize: '12px', color: '#B45309' }}>{paths.length - files.length} of {paths.length} could not be opened.</Typography>
          )}
        </>
      )}
    </Box>
  );
};
