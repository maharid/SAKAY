import {
  PRIVACY_NOTICE_VERSION,
  RETENTION_CLOSED_RECORDS_YEARS,
  RETENTION_DOC_CLOSED_MONTHS,
  RETENTION_DOC_REJECTED_DAYS,
  RETENTION_DOC_SUPERSEDED_DAYS,
  RETENTION_GPS_LOG_DAYS,
  RETENTION_SESSION_DAYS,
} from './policyConfig';

/**
 * The part of the privacy notice that answers the Data Privacy Act's transparency duties (RA 10173): WHY the data is used, HOW LONG it is kept, WHO receives it and
 * what the person's rights are. The figures are the retention schedule of policyConfig.ts, so the notice can never say a different number than the database enforces.
 * Both PWAs append these items to the list of what they collect.
 */
export interface PrivacyNoticeItem {
  id: string;
  title: string;
  desc: string;
}

export type PrivacyNoticeLanguage = 'en' | 'tl';
export type PrivacyNoticeRole = 'driver' | 'passenger';

/** Who receives a request to see, correct or erase personal data. The data protection officer's name and number are added here when the LGU names them. */
export const PRIVACY_CONTACT: Record<PrivacyNoticeLanguage, string> = {
  en: 'the LGU Transport Office of Calapan City (or your TODA Administrator, who passes it on)',
  tl: 'ang LGU Transport Office ng Lungsod ng Calapan (o ang TODA Administrator mo, na magpapasa nito)',
};

export { PRIVACY_NOTICE_VERSION };

export function privacyNoticeExtraItems(role: PrivacyNoticeRole, language: PrivacyNoticeLanguage): PrivacyNoticeItem[] {
  const tl = language === 'tl';
  const driver = role === 'driver';
  const contact = PRIVACY_CONTACT[language];

  const purposes: PrivacyNoticeItem = tl
    ? {
        id: 'F',
        title: 'F. Bakit namin ito ginagamit',
        desc: driver
          ? 'Para beripikahin ang pagkakakilanlan at mga dokumento mo sa TODA at sa LGU, itugma ka sa mga pasahero, kalkulahin ang pamasahe, panatilihing ligtas ang mga pasahero at drayber, asikasuhin ang mga reklamo, strike at hindi pagkakaunawaan, at maiwasan ang pandaraya. Wala nang ibang gamit.'
          : 'Para itugma ka sa isang drayber, kalkulahin ang pamasahe, panatilihing ligtas ang mga biyahe, asikasuhin ang mga reklamo at hindi pagkakaunawaan, at maiwasan ang pandaraya. Wala nang ibang gamit.',
      }
    : {
        id: 'F',
        title: 'F. Why we use it',
        desc: driver
          ? 'To verify your identity and documents with your TODA and the LGU, match you with passengers, compute fares, keep passengers and drivers safe, handle complaints, strikes and disputes, and prevent fraud. Nothing else.'
          : 'To match you with a driver, compute fares, keep trips safe, handle complaints and disputes, and prevent fraud. Nothing else.',
      };

  const retention: PrivacyNoticeItem = tl
    ? {
        id: 'G',
        title: 'G. Gaano katagal namin ito iniingatan',
        desc:
          `Mga GPS location ng biyahe: ${RETENTION_GPS_LOG_DAYS} araw pagkatapos maitala; mas matagal lamang kung ang biyahe ay bahagi ng bukas na reklamo, hindi pagkakaunawaan o imbestigasyon, hanggang maisara ang kaso. ` +
          `Mga tala ng session at koneksyon: ${RETENTION_SESSION_DAYS} araw. Ang mga OTP code ay hindi kailanman iniimbak. ` +
          (driver
            ? `Mga larawan ng dokumento: buburahin ${RETENTION_DOC_SUPERSEDED_DAYS} araw pagkatapos mapalitan, ${RETENTION_DOC_REJECTED_DAYS} araw pagkatapos tanggihan ang aplikasyon, at ${RETENTION_DOC_CLOSED_MONTHS} buwan pagkatapos isara ang account (mas matagal lamang habang bukas ang kaso). `
            : '') +
          `Mga tala ng strike, suspensyon, deactivation at exemption: habang aktibo ang account at ${RETENTION_CLOSED_RECORDS_YEARS} taon pagkatapos itong isara; pagkatapos nito ay aalisin ang iyong pangalan at iba pang pagkakakilanlan. Ang mga tala ng aksyon ng mga administrator ay iniingatan ayon sa itatakda ng Data Protection Officer.`,
      }
    : {
        id: 'G',
        title: 'G. How long we keep it',
        desc:
          `GPS locations of trips: ${RETENTION_GPS_LOG_DAYS} days after they are recorded; longer only if the trip is part of an open complaint, dispute or investigation, until the case is closed. ` +
          `Session and connection records: ${RETENTION_SESSION_DAYS} days. One-time codes (OTP) are never stored. ` +
          (driver
            ? `Document photos: deleted ${RETENTION_DOC_SUPERSEDED_DAYS} days after they are replaced, ${RETENTION_DOC_REJECTED_DAYS} days after an application is rejected, and ${RETENTION_DOC_CLOSED_MONTHS} months after an account is closed (longer only while a case is open). `
            : '') +
          `Strike, suspension, deactivation and exemption records: while the account is active and for ${RETENTION_CLOSED_RECORDS_YEARS} years after it is closed, after which your name and other identifiers are removed. The records of administrators' actions are kept as the Data Protection Officer decides.`,
      };

  const recipients: PrivacyNoticeItem = tl
    ? {
        id: 'H',
        title: 'H. Sino ang tumatanggap nito',
        desc: driver
          ? 'Ang TODA Administrator ng TODA na inaplayan mo at ang mga LGU Administrator (para sa beripikasyon, reklamo at strike); ang pasahero ng biyahe mo ay nakakakita ng pangalan, larawan at plaka mo. Ang larawan ng iyong lisensya at MTOP ay binabasa ng serbisyong OCR (Google Gemini API) para mapunan ang form; ang mga kinakailangang detalye lamang (numero ng lisensya, buong pangalan, petsa ng pagkapaso, DL codes, petsa ng kapanganakan; prangkisa, pangalan ng operator, plaka, petsa ng pagkapaso) ang iniimbak. Ang SMS provider ay nagpapadala ng mga mensahe.'
          : 'Ang drayber ng biyahe mo (pangalan at pickup point), ang TODA at LGU Administrator na humahawak ng biyahe o reklamo mo, at ang SMS provider na nagpapadala ng mga code at mensahe.',
      }
    : {
        id: 'H',
        title: 'H. Who receives it',
        desc: driver
          ? 'The TODA Administrator of the TODA you applied to and the LGU Administrators (for verification, complaints and strikes); the passenger of your trip sees your name, photo and plate. The photos of your license and MTOP are read by an OCR service (Google Gemini API) to fill in the form; only the details needed (license number, full name, expiry, DL codes, birth date; franchise number, operator name, plate, expiry) are kept. The SMS provider sends messages.'
          : 'The driver of your trip (your name and pickup point), the TODA and LGU Administrators who handle your trip or complaint, and the SMS provider that sends codes and messages.',
      };

  const rights: PrivacyNoticeItem = tl
    ? {
        id: 'I',
        title: 'I. Ang iyong mga karapatan',
        desc: `May karapatan kang malaman, makita at itama ang iyong personal na datos, tumutol sa paggamit nito, at hilingin na burahin o harangin ito kapag hindi na kailangan o labag sa batas ang pag-iimbak. Sumulat sa ${contact}. Maaari ka ring magsampa ng reklamo sa National Privacy Commission.`,
      }
    : {
        id: 'I',
        title: 'I. Your rights',
        desc: `You have the right to be informed, to see and correct your personal data, to object to its use, and to ask for it to be erased or blocked when keeping it is no longer necessary or is unlawful. Write to ${contact}. You may also complain to the National Privacy Commission.`,
      };

  return [purposes, retention, recipients, rights];
}

/** Where a PWA remembers that the person accepted the notice before their account row exists (a driver's row is created when the first document is saved) */
export const PRIVACY_ACCEPTED_STORAGE_KEY = 'sakay_privacy_notice_accepted_version';

type RpcLike = (fn: string, args: Record<string, unknown>) => PromiseLike<{ error: { message: string } | null }>;

function storageOf(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** "I Agree": remember it on the device and record it on the account (the database stores the version and the server's time). Never throws: acceptance must not block the flow. */
export async function acceptPrivacyNotice(rpc: RpcLike): Promise<void> {
  try {
    storageOf()?.setItem(PRIVACY_ACCEPTED_STORAGE_KEY, PRIVACY_NOTICE_VERSION);
  } catch {
    /* private mode: the server record below still works */
  }
  try {
    await rpc('record_privacy_acceptance', { p_version: PRIVACY_NOTICE_VERSION });
  } catch {
    /* recorded later by syncPrivacyAcceptance */
  }
}

/** Once the account row exists (a driver's is created later): record an acceptance the device remembers. Safe to call as often as wanted. */
export async function syncPrivacyAcceptance(rpc: RpcLike): Promise<void> {
  const remembered = storageOf()?.getItem(PRIVACY_ACCEPTED_STORAGE_KEY);
  if (!remembered) return;
  try {
    await rpc('record_privacy_acceptance', { p_version: remembered });
  } catch {
    /* try again next time */
  }
}
