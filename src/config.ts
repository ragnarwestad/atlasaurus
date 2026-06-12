import type { PathOptions } from "leaflet";

// --- Data sources (Natural Earth via jsDelivr, with a raw.githubusercontent
//     fallback). Loaded at runtime in the browser. ---

// 10m Ukraine point-of-view: includes all small island nations AND depicts
// Crimea as part of Ukraine (the internationally recognized / UN position,
// per UN GA Resolution 68/262), not Natural Earth's default de-facto map.
export const BORDER_URLS = [
  "https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_10m_admin_0_countries_ukr.geojson",
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_countries_ukr.geojson",
];

export const CAPITAL_URLS = [
  "https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_50m_populated_places_simple.geojson",
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_populated_places_simple.geojson",
];

// Named sub-units (Alaska, Hawaii, French Guiana, Réunion, …) — used only to
// label the satellite connector lines. Coverage is partial.
export const SUBUNIT_URLS = [
  "https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_10m_admin_0_map_subunits.geojson",
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_0_map_subunits.geojson",
];

// Major river centerlines (50m: the big named rivers, light enough for a world
// overview). Loaded lazily the first time "Rivers" is toggled on.
export const RIVER_URLS = [
  "https://cdn.jsdelivr.net/gh/nvkelso/natural-earth-vector@master/geojson/ne_50m_rivers_lake_centerlines.geojson",
  "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_rivers_lake_centerlines.geojson",
];

// --- English Wikipedia title overrides for dataset country names ---
export const WIKI_OVERRIDES: Record<string, string> = {
  "United States of America": "United States",
  "United States": "United States",
  "United Republic of Tanzania": "Tanzania",
  "Republic of Serbia": "Serbia",
  "Republic of the Congo": "Republic of the Congo",
  "Democratic Republic of the Congo": "Democratic Republic of the Congo",
  "Macedonia": "North Macedonia",
  "The former Yugoslav Republic of Macedonia": "North Macedonia",
  "Swaziland": "Eswatini",
  "Guinea Bissau": "Guinea-Bissau",
  "Czech Republic": "Czech Republic",
  "East Timor": "East Timor",
  "Lao PDR": "Laos",
  "Brunei Darussalam": "Brunei",
  "Republic of Korea": "South Korea",
  "Dem. Rep. Korea": "North Korea",
  "Côte d'Ivoire": "Ivory Coast",
  "Cote d'Ivoire": "Ivory Coast",
  "Russian Federation": "Russia",
  "Syrian Arab Republic": "Syria",
  "Iran (Islamic Republic of)": "Iran",
  "Bolivia (Plurinational State of)": "Bolivia",
  "Venezuela (Bolivarian Republic of)": "Venezuela",
  "Republic of Moldova": "Moldova",
  "Viet Nam": "Vietnam",
  "eSwatini": "Eswatini",
  "Cabo Verde": "Cape Verde",
  "Republic of Congo": "Republic of the Congo",
  "Timor-Leste": "East Timor",
  "Czechia": "Czech Republic",
  "Lao People's Democratic Republic": "Laos",
  "The Gambia": "The Gambia",
  "Federated States of Micronesia": "Federated States of Micronesia",
};

// Capital-city names that collide on Wikipedia and need disambiguation.
export const CITY_OVERRIDES: Record<string, string> = {
  "Kingston": "Kingston, Jamaica",
  "Georgetown": "Georgetown, Guyana",
  "Victoria": "Victoria, Seychelles",
  "San José": "San José, Costa Rica",
  "San Jose": "San José, Costa Rica",
  "St. John's": "St. John's, Antigua and Barbuda",
  "Saint John's": "St. John's, Antigua and Barbuda",
  "Hamilton": "Hamilton, Bermuda",
};

// --- Polygon styles ---
// opacity (stroke) is set explicitly on every visible style so that restoring
// from hiddenStyle (opacity 0) always brings the borders back.
// Borders are a neutral slate grey so they don't read as rivers (which are blue).
export const baseStyle: PathOptions     = { color: "#6c7a89", weight: 1,   opacity: 1, fillColor: "#aec4dc", fillOpacity: 0.22 };
export const hoverStyle: PathOptions    = { color: "#e0922b", weight: 1.5, opacity: 1, fillColor: "#ffd9a3", fillOpacity: 0.55 };
export const selectedStyle: PathOptions = { color: "#8a3b00", weight: 2.5, opacity: 1, fillColor: "#e8740c", fillOpacity: 0.65 };
export const relatedStyle: PathOptions  = { color: "#a85a1a", weight: 1.5, opacity: 1, fillColor: "#f3b06a", fillOpacity: 0.5 };
export const continentStyle: PathOptions = { color: "#1f7a6b", weight: 1.2, opacity: 1, fillColor: "#79c9bb", fillOpacity: 0.55 }; // continent members
export const hiddenStyle: PathOptions   = { opacity: 0, fillOpacity: 0 };
export const quizCorrectStyle: PathOptions = { color: "#1b7a3d", weight: 2, opacity: 1, fillColor: "#54c47e", fillOpacity: 0.7 }; // quiz: right answer
export const quizWrongStyle: PathOptions   = { color: "#9c1b12", weight: 2, opacity: 1, fillColor: "#e8675c", fillOpacity: 0.7 }; // quiz: wrong guess

// --- Connector tuning ---
export const CONNECTOR_MIN_AREA = 0.03; // deg^2 — ignore tiny specks
export const CONNECTOR_MAX_LINES = 60;
export const SUBUNIT_MATCH_MAX_D2 = 64; // (8 deg)^2 nearest-subunit cutoff
