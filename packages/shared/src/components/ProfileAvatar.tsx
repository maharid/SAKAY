import React from 'react';
import Avatar from '@mui/material/Avatar';

interface ProfileAvatarProps {
  /** The person's name: its first letter is shown when there is no picture (or the picture cannot be loaded) */
  name: string;
  /** The profile picture, when the account has one */
  src?: string | null;
  /** Width and height in px (the avatar is always a circle) */
  size?: number;
}

/**
 * The round profile picture of the header and of the account menu, the same in the LGU and the TODA portal: a picture cropped to fill the circle (never stretched), or
 * the first letter of the name in white on SAKAY orange when there is no picture. It is decoration (the name is always written beside it), so a screen reader skips it.
 */
export const ProfileAvatar: React.FC<ProfileAvatarProps> = ({ name, src, size = 26 }) => (
  <Avatar
    src={src || undefined}
    alt=""
    aria-hidden
    slotProps={{ img: { draggable: false, style: { objectFit: 'cover', width: '100%', height: '100%' } } }}
    sx={{
      width: size,
      height: size,
      flexShrink: 0,
      fontSize: Math.round(size * 0.45),
      fontWeight: 700,
      lineHeight: 1,
      color: '#FFFFFF',
      background: 'linear-gradient(135deg, var(--sakay-orange, #FF6600) 0%, #ff8a47 100%)',
      userSelect: 'none',
    }}
  >
    {(name.trim().charAt(0) || '?').toUpperCase()}
  </Avatar>
);

export default ProfileAvatar;
