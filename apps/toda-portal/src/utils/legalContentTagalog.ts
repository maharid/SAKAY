// The Tagalog Privacy Policy and Terms of Service of the SAKAY Driver App, word for word and in the same order (see legalContent.ts for the sources and the rules).
// The Driver App's Tagalog is kept as it is, including the headings of its Privacy Policy, which do not all say what the English headings say.

import type { LegalDocument } from './legalContent';

export const PRIVACY_POLICY_TL: LegalDocument = {
  title: 'Patakaran sa Privacy',
  lastUpdated: 'Huling binago: Hulyo 2026',
  intro: 'Mahalaga sa amin ang iyong privacy. Ipinapaliwanag ng patakarang ito kung paano kinokolekta, ginagamit, iniimbak, at pinoprotektahan ng SAKAY ang iyong impormasyon.',
  sections: [
    {
      title: '1. Pagtanggap sa mga Tuntunin',
      intro: 'Upang gumana ang SAKAY, kinokolekta at ginagamit namin ang mga sumusunod:',
      items: [
        { id: 'A', title: 'A. Personal na Impormasyon', desc: 'Pangalan, petsa ng kapanganakan, numero ng mobile, password, at profile photo.' },
        {
          id: 'B',
          title: 'B. Mga Dokumento para sa Beripikasyon',
          desc: "Larawan ng Driver's License, Franchise/MTOP permit, at traysikel kasama ang Body No. Sinusuri gamit ang OCR para sa agarang beripikasyon.",
        },
        {
          id: 'C',
          title: 'C. Lokasyon (GPS Data)',
          desc: 'Real-time na lokasyon habang naka-Online o may aktibong biyahe upang masubaybayan ang ruta at kaligtasan.',
        },
        {
          id: 'D',
          title: 'D. Impormasyon sa Biyahe',
          desc: 'Pickup at drop-off coordinates, distansya, taripa ng pamasahe, timestamps, at completion status.',
        },
        {
          id: 'E',
          title: 'E. Device at System Data',
          desc: 'Mga tala ng pag-login at ng oras na naka-Online/Offline ka, at kung pinapayagan mo ang location, para sa proteksyon laban sa pandaraya at maling paggamit ng account. Hindi kinokolekta ang model ng device o operating system.',
        },
      ],
    },
    {
      title: '2. Paano Namin Ginagamit ang Iyong Impormasyon',
      intro: 'Ginagamit namin ang iyong impormasyon upang:',
      bullets: [
        'I-verify ang iyong account',
        'Tanggapin at pamahalaan ang booking',
        'Magbigay ng real-time na lokasyon sa pasahero at FEDOTRIP',
        'Kalkulahin ang pamasahe',
        'Mag-record ng biyahe at kita',
        'Imbestigahan ang mga reklamo',
        'Pigilan ang panloloko at maling paggamit ng sistema',
        'Sumunod sa mga regulasyon ng FEDOTRIP',
      ],
    },
    {
      title: '3. Paggamit ng Lokasyon',
      intro: 'Ginagamit ang iyong lokasyon para sa:',
      bullets: ['Pagpapadala ng booking', 'Pag-track ng biyahe', 'Pag-monitor ng CPSD', 'Kaligtasan ng pasahero at drayber'],
      note: 'Ang GPS route data ay iniimbak nang hanggang **90 araw**, maliban kung kailangan para sa imbestigasyon.',
    },
    {
      title: '4. Pagbabahagi ng Impormasyon',
      intro:
        'Maaaring makita ng iyong TODA Administrator, LGU Administrator, at ng pasahero (limitado lamang sa iyong pangalan, larawan, at franchise number habang aktibo ang biyahe). Hindi namin ibinebenta ang iyong impormasyon sa mga third party.',
    },
    {
      title: '5. Pag-iimbak at Pagtanggal ng Data',
      intro: 'Ang mga larawan ng dokumento ay iniimbak nang naka-encrypt at awtomatikong buburahin kapag natapos na ang kinakailangang panahon ng verification o appeal.',
    },
    {
      title: '6. Ang Iyong mga Karapatan',
      bullets: [
        'Malaman kung anong impormasyon ang hawak namin tungkol sa iyo',
        'Humiling ng kopya ng iyong personal na data',
        'Hilingin na itama ang mali o lumang detalye',
        'Humiling ng pagbura alinsunod sa Data Privacy Act ng 2012 (RA 10173)',
      ],
    },
    {
      title: '7. Seguridad ng Data',
      intro: 'Nagpapatupad kami ng makabagong encryption at mahigpit na role-based security access controls upang mapanatiling ligtas ang iyong account.',
    },
    {
      title: '8. Pakikipag-ugnayan',
      intro: 'Para sa mga katanungan tungkol sa iyong data, makipag-ugnayan sa iyong TODA Administrator o sa Calapan City LGU Transport Board.',
    },
  ],
};

export const TERMS_OF_SERVICE_TL: LegalDocument = {
  title: 'Mga Tuntunin ng Serbisyo',
  lastUpdated: 'Huling binago: Hulyo 2026',
  sections: [
    {
      title: '1. Pagiging Karapat-dapat',
      intro: 'Maaari lamang gumamit ng SAKAY Driver ang:',
      bullets: ['Rehistradong miyembro ng TODA', "May wastong Driver's License", 'May balidong Franchise', 'Naaprubahan ng CPSD'],
      note: 'Ang account na hindi pa naaprubahan ng LGU ay hindi puwedeng mag-Online o tumanggap ng booking, kahit naipasa mo na ang lahat ng dokumento sa iyong TODA.',
    },
    {
      title: '2. Katumpakan ng Impormasyon',
      intro: 'Responsibilidad mong tiyaking tama at napapanahon ang lahat ng impormasyong isinusumite.',
      note: 'Ang pagsusumite ng maling o pekeng dokumento ay maaaring maging dahilan ng pagtanggi, pagsuspinde, o permanenteng pag-deactivate ng account.',
    },
    {
      title: '3. Mga Istruktura ng Pamasahe',
      intro:
        'Dapat mong mahigpit na sumunod sa mga taripa ng pamasahe na ipinag-uutos ng mga kasunduan ng Calapan LGU at TODA. Ang labis na paniningil sa mga pasahero o paghingi ng karagdagang bayad ay mahigpit na ipinagbabawal at ipapadala sa FEDOTRIP para sa parusa.',
    },
    {
      title: '4. Pagtanggap ng Booking',
      intro: 'Kapag tinanggap mo ang isang booking:',
      bullets: [
        'Inaasahang pupuntahan mo agad ang pasahero.',
        'Dapat mong sundin ang itinakdang pickup at drop-off location.',
        'Hindi maaaring humingi ng dagdag na bayad na hindi ipinapakita ng sistema.',
      ],
    },
    {
      title: '5. Pagkansela ng Booking',
      intro: 'Ang madalas o hindi makatarungang pagkansela ng booking ay maaaring magresulta sa:',
      bullets: ['Strike laban sa iyong account'],
    },
    {
      title: '6. Sistema ng Strike at Parusa',
      intro: 'Ang mga Strike ay naiipon sa loob ng rolling 90-day window:',
      table: {
        head: ['Kabuuang Strike', 'Parusa'],
        rows: [
          ['1', 'Warning Notification'],
          ['3', 'Administrative Review'],
          ['5', '7-Day Suspension'],
          ['8', '30-Day Suspension'],
          ['10', 'Permanenteng Pag-deactivate (LGU Review)'],
        ],
      },
      note: 'Ang mga malubhang paglabag (tulad ng away, harassment, o pagmamaneho nang lasing) ay direktang hahantong sa agarang suspensyon habang iniimbestigahan.',
    },
    {
      title: '7. Pag-uugali bilang Driver',
      bullets: [
        'Tratuhin ang bawat pasahero nang magalang at patas',
        'Sundin ang mga alituntunin sa trapiko at kaligtasan',
        'Panatilihing naka-on ang GPS habang naka-Online o may aktibong biyahe',
      ],
    },
    {
      title: '8. Pagsuspinde at Pag-deactivate',
      intro: 'Ang Suspension ay pansamantalang pag-block sa pagtanggap ng booking. Ang Deactivation ay nangangailangan ng manual review mula sa TODA at LGU Administrator bago maibalik ang access.',
    },
    {
      title: '9. Pagbabago sa mga Tuntunin',
      intro: 'Maaaring i-update ng SAKAY, ng iyong TODA, o ng LGU ang mga tuntuning ito. Ipapaalam sa iyo ang mga makabuluhang pagbabago sa loob ng app.',
    },
    {
      title: '10. Pakikipag-ugnayan',
      intro: 'Para sa mga katanungan tungkol sa mga tuntuning ito, makipag-ugnayan sa iyong TODA Administrator o sa Calapan City LGU Transport Board.',
    },
  ],
};
