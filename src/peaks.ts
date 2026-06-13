// Curated set of notable mountain peaks for the "Mountains" explore layer and
// quiz rounds. Country membership is by ISO 3166-1 alpha-3 code (matched against
// each country polygon's ADM0_A3), which is robust to dataset name variants and
// lets us list *all* sovereigns for border peaks (Everest = Nepal + China).
//
// Sources: elevations and locations from Wikipedia / Encyclopaedia Britannica
// (Seven Summits and eight-thousanders are well-established figures; Everest =
// 8,849 m per the 2020 Nepal–China joint survey). Coordinates are approximate —
// precise to within a marker dot on a world map. Pressure-test before relying on
// any single figure.

export interface Peak {
  name: string;
  iso: string[];        // ISO3 of the country/countries the summit sits in ([] = Antarctica)
  region: string;       // continent label (display + grouping)
  elevation: number;    // metres
  lat: number;
  lng: number;
  wiki?: string;        // Wikipedia title override when it differs from name
}

export const PEAKS: Peak[] = [
  // Eight-thousanders (Asia)
  { name: "Mount Everest", iso: ["NPL", "CHN"], region: "Asia", elevation: 8849, lat: 27.988, lng: 86.925 },
  { name: "K2", iso: ["PAK", "CHN"], region: "Asia", elevation: 8611, lat: 35.881, lng: 76.513 },
  { name: "Kangchenjunga", iso: ["NPL", "IND"], region: "Asia", elevation: 8586, lat: 27.703, lng: 88.147 },
  { name: "Lhotse", iso: ["NPL", "CHN"], region: "Asia", elevation: 8516, lat: 27.962, lng: 86.933 },
  { name: "Makalu", iso: ["NPL", "CHN"], region: "Asia", elevation: 8485, lat: 27.889, lng: 87.089 },
  { name: "Cho Oyu", iso: ["NPL", "CHN"], region: "Asia", elevation: 8188, lat: 28.094, lng: 86.661 },
  { name: "Dhaulagiri", iso: ["NPL"], region: "Asia", elevation: 8167, lat: 28.698, lng: 83.487 },
  { name: "Manaslu", iso: ["NPL"], region: "Asia", elevation: 8163, lat: 28.549, lng: 84.560 },
  { name: "Nanga Parbat", iso: ["PAK"], region: "Asia", elevation: 8126, lat: 35.238, lng: 74.589 },
  { name: "Annapurna", iso: ["NPL"], region: "Asia", elevation: 8091, lat: 28.596, lng: 83.820 },

  // Seven Summits (other continents)
  { name: "Aconcagua", iso: ["ARG"], region: "South America", elevation: 6961, lat: -32.653, lng: -70.011 },
  { name: "Denali", iso: ["USA"], region: "North America", elevation: 6190, lat: 63.069, lng: -151.007 },
  { name: "Mount Kilimanjaro", iso: ["TZA"], region: "Africa", elevation: 5895, lat: -3.066, lng: 37.355, wiki: "Mount Kilimanjaro" },
  { name: "Mount Elbrus", iso: ["RUS"], region: "Europe", elevation: 5642, lat: 43.355, lng: 42.439 },
  { name: "Vinson Massif", iso: [], region: "Antarctica", elevation: 4892, lat: -78.525, lng: -85.617, wiki: "Mount Vinson" },
  { name: "Puncak Jaya", iso: ["IDN"], region: "Oceania", elevation: 4884, lat: -4.078, lng: 137.158 },
  { name: "Mount Kosciuszko", iso: ["AUS"], region: "Oceania", elevation: 2228, lat: -36.456, lng: 148.263 },

  // Other iconic peaks
  { name: "Ojos del Salado", iso: ["ARG", "CHL"], region: "South America", elevation: 6893, lat: -27.109, lng: -68.541 },
  { name: "Chimborazo", iso: ["ECU"], region: "South America", elevation: 6263, lat: -1.469, lng: -78.817 },
  { name: "Mount Logan", iso: ["CAN"], region: "North America", elevation: 5959, lat: 60.567, lng: -140.405 },
  { name: "Pico de Orizaba", iso: ["MEX"], region: "North America", elevation: 5636, lat: 19.030, lng: -97.268 },
  { name: "Mount Kenya", iso: ["KEN"], region: "Africa", elevation: 5199, lat: -0.151, lng: 37.308 },
  { name: "Mont Blanc", iso: ["FRA", "ITA"], region: "Europe", elevation: 4806, lat: 45.832, lng: 6.865 },
  { name: "Matterhorn", iso: ["CHE", "ITA"], region: "Europe", elevation: 4478, lat: 45.976, lng: 7.658 },
  { name: "Mauna Kea", iso: ["USA"], region: "North America", elevation: 4207, lat: 19.821, lng: -155.468 },
  { name: "Mount Fuji", iso: ["JPN"], region: "Asia", elevation: 3776, lat: 35.361, lng: 138.727 },
  { name: "Aoraki / Mount Cook", iso: ["NZL"], region: "Oceania", elevation: 3724, lat: -43.595, lng: 170.142, wiki: "Aoraki / Mount Cook" },
  { name: "Mount Olympus", iso: ["GRC"], region: "Europe", elevation: 2918, lat: 40.085, lng: 22.359 },
  { name: "Ben Nevis", iso: ["GBR"], region: "Europe", elevation: 1345, lat: 56.797, lng: -5.003 },
  { name: "Table Mountain", iso: ["ZAF"], region: "Africa", elevation: 1085, lat: -33.957, lng: 18.403 },

  // National & regional high points — Europe (curated; figures from Wikipedia,
  // coordinates approximate to a marker dot). These appear as you zoom in.
  { name: "Galdhøpiggen", iso: ["NOR"], region: "Europe", elevation: 2469, lat: 61.636, lng: 8.313 },
  { name: "Glittertind", iso: ["NOR"], region: "Europe", elevation: 2452, lat: 61.651, lng: 8.557 },
  { name: "Snøhetta", iso: ["NOR"], region: "Europe", elevation: 2286, lat: 62.337, lng: 9.268 },
  { name: "Kebnekaise", iso: ["SWE"], region: "Europe", elevation: 2097, lat: 67.901, lng: 18.627 },
  { name: "Hvannadalshnúkur", iso: ["ISL"], region: "Europe", elevation: 2110, lat: 64.015, lng: -16.677 },
  { name: "Zugspitze", iso: ["DEU", "AUT"], region: "Europe", elevation: 2962, lat: 47.421, lng: 10.985 },
  { name: "Grossglockner", iso: ["AUT"], region: "Europe", elevation: 3798, lat: 47.074, lng: 12.694 },
  { name: "Dufourspitze", iso: ["CHE", "ITA"], region: "Europe", elevation: 4634, lat: 45.937, lng: 7.867 },
  { name: "Triglav", iso: ["SVN"], region: "Europe", elevation: 2864, lat: 46.379, lng: 13.837 },
  { name: "Corno Grande", iso: ["ITA"], region: "Europe", elevation: 2912, lat: 42.469, lng: 13.566 },
  { name: "Aneto", iso: ["ESP"], region: "Europe", elevation: 3404, lat: 42.631, lng: 0.657 },
  { name: "Mulhacén", iso: ["ESP"], region: "Europe", elevation: 3479, lat: 37.053, lng: -3.312 },
  { name: "Teide", iso: ["ESP"], region: "Europe", elevation: 3715, lat: 28.272, lng: -16.642 },
  { name: "Torre", iso: ["PRT"], region: "Europe", elevation: 1993, lat: 40.322, lng: -7.614, wiki: "Torre (Portugal)" },
  { name: "Rysy", iso: ["POL", "SVK"], region: "Europe", elevation: 2501, lat: 49.179, lng: 20.088 },
  { name: "Gerlachovský štít", iso: ["SVK"], region: "Europe", elevation: 2655, lat: 49.164, lng: 20.134 },
  { name: "Moldoveanu", iso: ["ROU"], region: "Europe", elevation: 2544, lat: 45.602, lng: 24.737, wiki: "Moldoveanu Peak" },
  { name: "Musala", iso: ["BGR"], region: "Europe", elevation: 2925, lat: 42.179, lng: 23.585 },
  { name: "Mount Korab", iso: ["ALB", "MKD"], region: "Europe", elevation: 2764, lat: 41.789, lng: 20.546 },
  { name: "Mount Ararat", iso: ["TUR"], region: "Asia", elevation: 5137, lat: 39.702, lng: 44.298 },
];
