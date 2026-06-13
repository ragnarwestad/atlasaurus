// Leaflet singletons: the map instance, the base tile layer and every layer
// group the app draws into. Pure setup — no app logic lives here.
import L from "leaflet";

export const map = L.map("map", { worldCopyJump: true, minZoom: 2, maxZoom: 12 }).setView([25, 10], 2);

L.tileLayer("https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png", {
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, ' +
    '&copy; <a href="https://carto.com/attributions">CARTO</a> · Borders &amp; capitals: Natural Earth',
  subdomains: "abcd",
  maxZoom: 12,
}).addTo(map);

export const capitalLayer = L.layerGroup().addTo(map);    // capital dots + name labels
export const connectorLayer = L.layerGroup().addTo(map);  // satellite/sovereignty lines
export const flagLayer = L.layerGroup().addTo(map);       // flag images
export const peakLayer = L.layerGroup().addTo(map);       // mountain-peak markers
export const riverLayer = L.layerGroup().addTo(map);      // major river centerlines
export const lakeLayer = L.layerGroup().addTo(map);       // major lakes
export const cityLayer = L.layerGroup().addTo(map);       // city dots (canvas, in-view only)
export const cityLabelLayer = L.layerGroup().addTo(map);  // city name labels (top few, DOM)
export const cityCanvas = L.canvas({ padding: 0.5 });     // fast renderer for the city dots
export const featureCanvas = L.canvas({ padding: 0.5 });  // canvas for rivers/lakes (clips to view; avoids the SVG-pane offset bug)
export const quizLayer = L.layerGroup().addTo(map);       // quiz: guess→answer line + dots
export const quizContLayer = L.layerGroup().addTo(map);   // quiz: continent name labels
export const regionLabelLayer = L.layerGroup().addTo(map); // explore: region name labels (Regions tab)
