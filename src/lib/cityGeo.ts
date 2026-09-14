// Universities grouped by city, ported verbatim from SPRINT 13's CITY_UNIS /
// CITY_COUNTRY / CITY_FAN. A multi-university city collapses to one node at
// rest and bursts into its members on hover (see GeoView's CityNode).
export const CITY_UNIS: Record<string, string[]> = {
  Stockholm: ["KTH", "Stockholm University", "Karolinska Institutet", "Nordita"],
  Gothenburg: ["Chalmers", "Gothenburg"],
  "Linköping": ["Linköping University"],
  Lund: ["Lund"],
  "Umeå": ["Umeå University"],
  Uppsala: ["Uppsala University"],

  Aalborg: ["Aalborg University"],
  Aarhus: ["Aarhus University"],
  Odense: ["University of Southern Denmark"],
  Roskilde: ["Roskilde University"],
  Copenhagen: [
    "University of Copenhagen",
    "Technical University of Denmark (DTU)",
    "Copenhagen Business School (CBS)",
    "IT University of Copenhagen",
  ],

  Reykjavik: ["University of Iceland", "Reykjavík University"],
  Akureyri: ["University of Akureyri"],
  Hvanneyri: ["Agricultural University of Iceland"],
  "Hólar": ["Hólar University"],

  Oslo: ["University of Oslo (UiO)", "OsloMet – Oslo Metropolitan University"],
  Bergen: ["University of Bergen (UiB)"],
  Trondheim: ["Norwegian University of Science and Technology (NTNU)"],
  "Tromsø": ["UiT The Arctic University of Norway"],
  "Ås": ["Norwegian University of Life Sciences (NMBU)"],
  Stavanger: ["University of Stavanger (UiS)"],
  Kristiansand: ["University of Agder (UiA)"],
  "Bodø": ["Nord University"],
  Drammen: ["University of South-Eastern Norway (USN)"],
  Hamar: ["University of Inland Norway"],

  Helsinki: ["University of Helsinki", "Aalto University", "Hanken School of Economics", "University of the Arts Helsinki"],
  Turku: ["University of Turku", "Åbo Akademi University"],
  Tampere: ["Tampere University"],
  "Jyväskylä": ["University of Jyväskylä"],
  Vaasa: ["University of Vaasa"],
  Lappeenranta: ["LUT University"],
  Rovaniemi: ["University of Lapland"],
  Kuopio: ["University of Eastern Finland"],

  Tartu: ["University of Tartu"],
  Tallinn: ["Tallinn University of Technology"],
  Riga: ["University of Latvia", "Riga Technical University"],
  Vilnius: ["Vilnius University", "Center for Physical Sciences and Technology"],
  Kaunas: ["Kaunas University of Technology"],
};

export const CITY_COUNTRY: Record<string, string> = {
  Stockholm: "SE", Gothenburg: "SE", "Linköping": "SE", Lund: "SE", "Umeå": "SE", Uppsala: "SE",
  Aalborg: "DK", Aarhus: "DK", Odense: "DK", Roskilde: "DK", Copenhagen: "DK",
  Reykjavik: "IS", Akureyri: "IS", Hvanneyri: "IS", "Hólar": "IS",
  Oslo: "NO", Bergen: "NO", Trondheim: "NO", "Tromsø": "NO", "Ås": "NO",
  Stavanger: "NO", Kristiansand: "NO", "Bodø": "NO", Drammen: "NO", Hamar: "NO",
  Helsinki: "FI", Turku: "FI", Tampere: "FI", "Jyväskylä": "FI", Vaasa: "FI",
  Lappeenranta: "FI", Rovaniemi: "FI", Kuopio: "FI",
  Tartu: "EE", Tallinn: "EE",
  Riga: "LV",
  Vilnius: "LT", Kaunas: "LT",
};

// Which way a multi-university city fans its members out on hover (SVG angle,
// 0 = right, PI/2 = down). Only multi-member cities need an entry — a solo
// city has nothing to fan out to.
export const CITY_FAN: Record<string, { center: number; spread: number }> = {
  Stockholm: { center: 0, spread: 2.4 },
  Gothenburg: { center: Math.PI, spread: 1.3 },
  Copenhagen: { center: 0, spread: 2.6 },
  Oslo: { center: -Math.PI / 2, spread: 1.0 },
  Helsinki: { center: Math.PI / 2, spread: 2.4 },
  Turku: { center: Math.PI / 2, spread: 1.0 },
  Riga: { center: 0, spread: 1.0 },
};
