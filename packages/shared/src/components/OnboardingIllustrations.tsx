import React from 'react';

// Onboarding Illustration 1: Mag-book ng Biyahe (Phone & Map Location Pin)
export const BookingIllustration: React.FC<{ width?: string | number; height?: string | number }> = ({
  width = '100%',
  height = '100%',
}) => {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 320 280"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ maxWidth: '100%', maxHeight: '100%' }}
    >
      {/* Background soft glowing circles */}
      <circle cx="160" cy="140" r="100" fill="#FFF2EB" />
      <circle cx="160" cy="140" r="70" fill="#FFE5D6" />

      {/* Map Grid Pattern */}
      <path d="M90 100 H230" stroke="#E2E8F0" strokeWidth="2" strokeDasharray="4 4" />
      <path d="M90 140 H230" stroke="#E2E8F0" strokeWidth="2" />
      <path d="M90 180 H230" stroke="#E2E8F0" strokeWidth="2" strokeDasharray="4 4" />
      <path d="M120 70 V210" stroke="#E2E8F0" strokeWidth="2" />
      <path d="M160 70 V210" stroke="#E2E8F0" strokeWidth="2" strokeDasharray="4 4" />
      <path d="M200 70 V210" stroke="#E2E8F0" strokeWidth="2" />

      {/* Phone Screen Shell */}
      <rect x="95" y="40" width="130" height="200" rx="20" fill="#FFFFFF" stroke="#0F172A" strokeWidth="5" />
      
      {/* Phone Screen Notch / Speaker */}
      <rect x="140" y="46" width="40" height="6" rx="3" fill="#0F172A" />

      {/* Phone Map Route */}
      <path d="M120 180 C130 150, 180 160, 175 110" stroke="#FF6B00" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="120" cy="180" r="5" fill="#FF6B00" />

      {/* Map Pin / Marker */}
      <g transform="translate(160, 80)">
        {/* Shadow */}
        <ellipse cx="0" cy="30" rx="12" ry="4" fill="#000000" fillOpacity="0.15" />
        {/* Pin Shape */}
        <path
          d="M0 0 C-12 0 -15 12 0 30 C15 12 12 0 0 0 Z"
          fill="#FF6B00"
          stroke="#FFFFFF"
          strokeWidth="2"
        />
        {/* Inner Pin Dot */}
        <circle cx="0" cy="10" r="5" fill="#FFFFFF" />
      </g>

      {/* Avatar / Person interacting */}
      <g transform="translate(195, 140)">
        {/* Body */}
        <path d="M15 70 C5 70 0 50 0 45 C0 35 15 35 25 35 C35 35 50 35 50 45 C50 50 45 70 35 70 H15 Z" fill="#0F172A" />
        {/* Arms */}
        <path d="M0 45 C-10 40 -12 25 -25 25" stroke="#0F172A" strokeWidth="6" strokeLinecap="round" />
        <circle cx="-25" cy="25" r="4" fill="#FFE0C2" />
        {/* Neck */}
        <rect x="21" y="28" width="8" height="10" fill="#FFE0C2" />
        {/* Head */}
        <circle cx="25" cy="20" r="12" fill="#FFE0C2" />
        {/* Hair */}
        <path d="M13 20 C13 10 37 10 37 20 C37 15 30 11 25 13 C20 11 13 15 13 20 Z" fill="#0F172A" />
        {/* Orange Shirt Detail */}
        <path d="M16 35 L25 48 L34 35 Z" fill="#FF6B00" />
      </g>
    </svg>
  );
};

// Onboarding Illustration 2: Tamang Pamasahe (Wallet & Cash split)
export const FareIllustration: React.FC<{ width?: string | number; height?: string | number }> = ({
  width = '100%',
  height = '100%',
}) => {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 320 280"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ maxWidth: '100%', maxHeight: '100%' }}
    >
      {/* Background Soft Glow */}
      <circle cx="160" cy="140" r="100" fill="#E6F4EA" />
      <circle cx="160" cy="140" r="70" fill="#CEEAD6" />

      {/* Floating Coins */}
      <g transform="translate(70, 70)">
        <circle cx="0" cy="0" r="12" fill="#FFB000" stroke="#FFFFFF" strokeWidth="2" />
        <path d="M0 -6 V6 M-4 -3 H4 M-4 3 H4" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round" />
      </g>
      <g transform="translate(240, 60)">
        <circle cx="0" cy="0" r="10" fill="#FFB000" stroke="#FFFFFF" strokeWidth="2" />
        <path d="M0 -5 V5" stroke="#FFFFFF" strokeWidth="1.5" />
      </g>
      <g transform="translate(250, 180)">
        <circle cx="0" cy="0" r="8" fill="#FFB000" stroke="#FFFFFF" strokeWidth="1.5" />
      </g>

      {/* Green Cash / Bills Peeking out */}
      <g transform="translate(110, 80) rotate(-15)">
        <rect x="0" y="0" width="80" height="50" rx="4" fill="#34A853" stroke="#FFFFFF" strokeWidth="2" />
        <circle cx="40" cy="25" r="10" fill="#1B5E20" fillOpacity="0.2" />
        <rect x="10" y="10" width="60" height="30" fill="none" stroke="#A3E635" strokeWidth="1" strokeDasharray="3 3" />
      </g>
      <g transform="translate(130, 75) rotate(10)">
        <rect x="0" y="0" width="85" height="50" rx="4" fill="#1E88E5" stroke="#FFFFFF" strokeWidth="2" />
        <circle cx="42" cy="25" r="10" fill="#0D47A1" fillOpacity="0.2" />
      </g>

      {/* Wallet Base Shadow */}
      <ellipse cx="160" cy="210" rx="65" ry="12" fill="#000000" fillOpacity="0.1" />

      {/* Leather Wallet (Orange) */}
      <g transform="translate(90, 110)">
        {/* Wallet Back */}
        <rect x="0" y="0" width="140" height="90" rx="12" fill="#E05300" />
        {/* Wallet Front Fold */}
        <path d="M0 15 C0 6 6 0 15 0 H125 C134 0 140 6 140 15 V75 C140 84 134 90 125 90 H15 C6 90 0 84 0 75 Z" fill="#FF6B00" />
        
        {/* Wallet Stitching effect */}
        <path d="M5 10 H135 V80 H5 Z" fill="none" stroke="#FFA366" strokeWidth="1.5" strokeDasharray="4 3" />

        {/* Wallet Clasp/Flap */}
        <path d="M120 30 H148 C152 30 155 33 155 37 V53 C155 57 152 60 148 60 H120 Z" fill="#0F172A" />
        <circle cx="140" cy="45" r="5" fill="#FFB000" />
      </g>
    </svg>
  );
};

// Onboarding Illustration 3: Ligtas at Maaasahan (Tricycle & Safety Badge Shield)
export const SafetyIllustration: React.FC<{ width?: string | number; height?: string | number }> = ({
  width = '100%',
  height = '100%',
}) => {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 320 280"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ maxWidth: '100%', maxHeight: '100%' }}
    >
      {/* Background Soft Glow */}
      <circle cx="160" cy="140" r="100" fill="#FFF2EB" />
      <circle cx="160" cy="140" r="70" fill="#FFE5D6" />

      {/* Safety Shield Background */}
      <g transform="translate(210, 60)">
        <path
          d="M0 0 C15 0 25 -5 30 -15 C30 15 25 35 0 50 C-25 35 -30 15 -30 -15 C-25 -5 -15 0 0 0 Z"
          fill="#1E293B"
          stroke="#FFFFFF"
          strokeWidth="3"
        />
        {/* Checkmark inside Shield */}
        <path
          d="M-12 15 L-3 24 L12 6"
          stroke="#4ADE80"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>

      {/* Tricycle Base Shadow */}
      <ellipse cx="150" cy="205" rx="75" ry="12" fill="#000000" fillOpacity="0.1" />

      {/* Stylized Tricycle Body */}
      <g transform="translate(75, 100)">
        {/* Cab Back Frame */}
        <rect x="5" y="15" width="85" height="65" rx="10" fill="#FF6B00" />
        <rect x="15" y="23" width="65" height="35" rx="5" fill="#E2E8F0" /> {/* Window */}
        <path d="M5 45 H90" stroke="#0F172A" strokeWidth="2" />

        {/* Cab Roof Curve */}
        <path d="M5 25 C5 5 90 5 90 25" fill="#FFFFFF" stroke="#0F172A" strokeWidth="3" />

        {/* Motorcycle Body */}
        <rect x="90" y="45" width="55" height="35" rx="5" fill="#0F172A" />
        <circle cx="118" cy="53" r="8" fill="#FFB000" /> {/* Motorcycle Fuel Tank */}

        {/* Wheels */}
        {/* Sidecar Wheel */}
        <circle cx="30" cy="85" r="20" fill="#0F172A" stroke="#FFFFFF" strokeWidth="3" />
        <circle cx="30" cy="85" r="8" fill="#94A3B8" />

        {/* Motorcycle Rear Wheel */}
        <circle cx="98" cy="85" r="20" fill="#0F172A" stroke="#FFFFFF" strokeWidth="3" />
        <circle cx="98" cy="85" r="8" fill="#94A3B8" />

        {/* Motorcycle Front Wheel */}
        <circle cx="138" cy="85" r="20" fill="#0F172A" stroke="#FFFFFF" strokeWidth="3" />
        <circle cx="138" cy="85" r="8" fill="#94A3B8" />

        {/* Front Fork & Handlebar */}
        <path d="M138 85 L130 35 M130 35 H118" stroke="#0F172A" strokeWidth="4" strokeLinecap="round" />
        
        {/* Headlight */}
        <circle cx="140" cy="42" r="6" fill="#FFD700" stroke="#0F172A" strokeWidth="2" />
      </g>
    </svg>
  );
};
