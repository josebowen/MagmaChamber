// Science model for the demo. Simplified and illustrative, not a research model.
export const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// log10 viscosity (Pa s). Fitted so basalt (50% SiO2, 1200 C, 0.5 wt% H2O) ~ 10^2,
// andesite (60%, 1000 C, 3%) ~ 10^4, hydrous rhyolite (73%, 800 C, 4%) ~ 10^7.
export function logEta(S, T, W) {
  return clamp(2 + 0.183 * (S - 50) - 0.0046 * (T - 1200) - 0.3 * (W - 0.5), 0.5, 11);
}

// 0..1: how much gas pressure the melt can hold back
export function overpressure(L, W) {
  return clamp((L - 1.5) / 4.5, 0, 1) * clamp(W / 5, 0, 1);
}

export function compClass(S) {
  if (S < 53) return 'Mafic';
  if (S < 66) return 'Intermediate';
  return 'Felsic';
}

export function classify(S, T, W) {
  const L = logEta(S, T, W);
  if (L < 3) return W >= 2.5 ? 'strombolian' : 'hawaiian';
  if (L < 5) {
    if (W < 1.5) return 'dome';
    if (L >= 4 && W >= 3.5) return 'plinian';
    return 'vulcanian';
  }
  if (W < 1) return 'dome';
  if (W < 2.5) return 'vulcanian';
  return 'plinian';
}

// Combinations that are rare in nature
export function natureCheck(S, T, W) {
  if (S >= 66 && T > 1000) return 'Rare in nature: felsic magma usually erupts at roughly 700 to 900 °C. Very hot felsic melts are uncommon.';
  if (S < 53 && T < 950) return 'Rare in nature: mafic magma this cool would be mostly crystals, not liquid.';
  if (S < 53 && W > 4) return 'Unusually wet for mafic magma. Earle gives about 1 to 3% volatiles for mafic magma.';
  if (S >= 66 && W < 1.5) return 'Dry for felsic magma. Earle gives about 4 to 7% volatiles, but felsic magma can lose gas before it erupts.';
  return '';
}

export const PRED = [
  { cls: 0, label: 'Quiet', sub: 'Lava flows out, or a lava dome builds up' },
  { cls: 1, label: 'Moderate', sub: 'Bursts of cinders or short explosions' },
  { cls: 2, label: 'Catastrophic', sub: 'A towering eruption column and pyroclastic flows' },
];

export const OUTCOMES = {
  hawaiian: {
    cls: 0, shape: 'shield', name: 'Effusive lava flows',
    analog: 'Kīlauea, Hawaiʻi',
    why: 'Low-silica magma has few linked silica tetrahedra, and at high temperature it flows easily. As it rose and the pressure dropped, gas came out of solution as bubbles that escaped through the runny melt. With little gas trapped, the magma poured out as lava flows. Repeated flows like this build a broad, gently sloping shield volcano.',
    src: '§4.2, §4.3',
  },
  strombolian: {
    cls: 1, shape: 'cinder', name: 'Fire fountains and cinder bursts',
    analog: 'Parícutin, Mexico: a cinder cone that grew out of a cornfield, 1943 to 1952',
    why: 'The magma was runny but carried a lot of gas. Bubbles rose fast, merged and burst at the vent, throwing clots of glowing lava into the air. They fell as cinders of vesicular rock (scoria) and piled up into a small, steep cinder cone.',
    src: '§4.2, §4.3',
  },
  dome: {
    cls: 0, shape: 'composite', dome: true, name: 'A lava dome',
    analog: 'Mount St. Helens, USA: dome growth, 2004 to 2008',
    why: 'The magma was very viscous but held little gas. With no trapped gas to drive an explosion, the stiff lava squeezed out of the vent and piled up as a dome. Viscosity alone does not make an eruption explosive. Trapped gas does.',
    src: '§4.2 (lava domes go beyond Earle §4.3)',
  },
  vulcanian: {
    cls: 1, shape: 'composite', name: 'Short, cannon-like explosions',
    analog: 'Sakurajima, Japan',
    why: 'Thick magma trapped a moderate amount of gas. Pressure built under a plug of cooled lava in the vent until it blew out in a short blast of ash and blocks, then built up and blew again.',
    src: '§4.2 (Vulcanian eruptions go beyond Earle §4.3)',
  },
  plinian: {
    cls: 2, shape: 'composite', name: 'A Plinian column and pyroclastic flows',
    analog: 'Mount St. Helens, USA, 1980; Pinatubo, Philippines, 1991',
    why: 'High-silica magma is full of linked silica chains, so it is very viscous. As it rose, gas came out of solution but could not escape. Bubble pressure built until the magma shattered into ash and blasted out in a towering column. When parts of the column collapsed, pyroclastic flows raced down the slopes. Layers of ash and lava from eruptions like this build a steep composite volcano.',
    src: '§4.2, §4.3',
  },
};

export function misconception(predCls, outKey, S, T, W) {
  const o = OUTCOMES[outKey];
  if (predCls === o.cls) return '';
  if (predCls === 2 && outKey === 'dome')
    return 'Common mistake: assuming thick magma always explodes. Explosions need trapped gas. This magma was stiff but nearly gas-free.';
  if (predCls > o.cls && T > 1050)
    return 'Common mistake: assuming hotter magma is more explosive. Hot magma is usually runnier, so gas escapes more easily.';
  if (predCls < o.cls && W >= 2.5)
    return 'Gas content matters as much as silica. This melt held enough dissolved gas to drive an explosive eruption.';
  if (predCls < o.cls)
    return 'Viscosity sets how easily gas escapes. Here the melt was thick enough to trap the gas it had.';
  return 'This melt let its gas escape more easily than you expected.';
}

export const MISSIONS = [
  {
    id: 'hawaii', n: 'Mission 1', name: 'Hotspot', place: 'Hawaiʻi', setting: 'plume', ocean: 'all',
    preset: { S: 49, T: 1170, W: 1.0 },
    card: 'A volcano rising from the Pacific seafloor, far from any plate boundary.',
    brief: 'A mantle plume, a column of hot rock (not magma), rises under the Pacific plate. Near the base of the plate the pressure drops, and the rock partly melts. This is decompression melting. The melt is mafic.',
    src: 'Earle §4.1',
  },
  {
    id: 'cascades', n: 'Mission 2', name: 'Subduction zone', place: 'Cascade Range, USA', setting: 'subduction', ocean: 'right',
    preset: { S: 66, T: 870, W: 5.0 },
    card: 'An ocean plate sinks beneath North America.',
    brief: 'The sinking ocean plate is not hot enough to melt, but heating drives water out of its minerals. That water rises into the mantle above and lowers its melting point. This is flux melting. On the way up, the magma melts some continental crust and becomes richer in silica.',
    src: 'Earle §4.1',
  },
  {
    id: 'mexico', n: 'Mission 3', name: 'Volcanic field', place: 'Michoacán, Mexico', setting: 'subduction', ocean: 'right',
    preset: { S: 55, T: 1100, W: 2.8 },
    card: 'A field of small volcanoes above the same kind of plate boundary.',
    brief: 'Another subduction zone, but this batch of magma has changed less on its way up: lower in silica, still hot, and carrying plenty of dissolved gas.',
    src: 'Earle §4.1, §4.2',
  },
  {
    id: 'lab', n: 'Free lab', name: 'Your volcano', place: 'Any mix you like', setting: 'subduction', ocean: 'right',
    preset: { S: 61, T: 1000, W: 3.0 },
    card: 'Set any combination. The lab flags mixes that are rare in nature.',
    brief: 'Choose any combination of silica, temperature and dissolved gas, predict the eruption, and test it.',
    src: 'Earle §4.2',
  },
];

export const OBJECTIVES = [
  { id: 1, text: 'Connect the plate tectonic setting to how magma forms: decompression melting at plumes and ridges, flux melting at subduction zones.', ref: 'Earle Ch. 4, objective 1; §4.1' },
  { id: 2, text: 'Relate magma composition (silica and dissolved gas) to eruption style.', ref: 'Earle Ch. 4, objective 2; §4.2' },
  { id: 3, text: 'Distinguish shield volcanoes, composite volcanoes and cinder cones by their eruptions and shape.', ref: 'Earle Ch. 4, objective 3; §4.3' },
];
