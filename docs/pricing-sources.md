# Pricing sources — 3xDezine catalog (INR)

**Currency:** INR. **Basis:** MATERIAL SUPPLY ONLY, ex-GST. Excludes labour, installation,
bedding mortar, adhesive, underlay, scaffolding and site overheads. **as_of:** 2026-09.

These prices were **natively curated for the Indian market**. Nothing here is an FX conversion
of the previous USD catalog — the two markets differ structurally in tile pricing, labour
bundling and product availability, so a conversion factor would have been meaningless.

Indian trade quotes per **sq ft**; this catalog stores per **m²**. Conversion used throughout:
`1 m² = 10.7639 sq ft`.

---

## Sources

| # | Source | URL | Role |
|---|--------|-----|------|
| 1 | Maharashtra PWD Schedule of Rates (SSR) 2022-23, sheet `Material Rates for ssr 2022-23` | `https://dsr.emahapwd.com/user/tempex/SSR_2022-23.xlsx` | Primary. Government ex-GST **material supply** rates. Directly usable. |
| 2 | CPWD DSR 2023 (Civil) | `https://quickboq.in/dsr/civil/2023/` | **Upper bound only.** Composite finished rates that *include labour and bedding mortar*. Never used as a material price. |
| 3 | Indian retail / trade supply ranges (researched) | — | Fallback for items absent from the SSR schedule. |
| 4 | Office of the Economic Adviser, WPI monthly series | `https://eaindustry.nic.in/indx_download_2223/wpi_monthly_index_YYYYMM.xlsx` | Escalation only (see *Refreshing* below). |

### Source 1 extraction

The spreadsheet downloaded cleanly (HTTP 200, 1,373,375 bytes). The material sheet is
`worksheets/sheet7.xml` (workbook rel `rId7`). Extraction yielded:

- **1,069 populated rows**, of which **1,003 are priced material rate rows**
  (`Sr No / Description / Per Unit / Rate (Excluding GST)`).
- **237 rows** matched the categories we care about (tile, marble/granite/stone, wood/plywood,
  paint, cement, plaster/gypsum, brick, roofing sheet, glass, door, window).

Sample of extracted rows:

```
Ceramic tiles 30*30cm                                   | Sq.Mt. |  509
Ceramic Tiles for dado 30 x 60 cm                       | Sq.Mt. |  611
Vitrified tiles Glossy 590-605 x 590-605 x 8-10mm       | Sq.Mt. |  608
Vitrified rustic matt stone finish 590-605mm sq         | Sq.Mt. | 1005
Vitrified Tile 600x1200, 8mm thick                      | Sq.Mt. | 1500
Full Body Vitrified Tile 800x2400, 8mm thick            | Sq.Mt. | 3000
Marble (other than white makrana)                       | Sq.Mt. | 1399
Italian marble 18mm thick                               | Sq.Mt. | 4000
Kota stone (machine cut) 25-30mm, one side polished     | Sq.Mt. |  600
Gypsum Board 12.5 mm thick                              | Sq.Mt. |  238
Cement Sheet 8 mm                                       | Sq.mt. |  500
G.I. Pre coated trapezoidal 0.50mm colour roof sheet    | Sq.Mt. |  958
Precoated Galvanised Steel Plain Sheet                  | Smt    | 1143
Mangalore tiles class AA                                | No.    |   24
I'st Class Bricks (Red)                                 | No.    |    9
Cement                                                  | bag    |  300
Acraylic Emulsion Paint                                 | Ltr.   |  223
Plastic emulsion paint                                  | Ltr.   |  345
Royale Luxury Emulsion Paint                            | Ltr.   |  476
Oil enamel paint/flat/glossy (ready mix, ISI)           | Ltr.   |  307
19mm plywood 710 BWP full red core                      | Sq.mt. | 1200
Teak Wood planks above 2.5 m length                     | Cu.Mt. | 105028
Jungle wood (non teak) normal                           | Cu.Mt. | 42758
Plain Glass 6mm                                         | Sq.Mt. | 1200
PVC factory made flush door 30mm with SS fixtures       | Sq.Mt. | 4350
```

> One obvious data error in the source was ignored: `Vitrified Tile 800x1600, 8mm thick | Sq.Mt. | 130`
> — inconsistent with every neighbouring vitrified rate by an order of magnitude.

---

## Materials (24)

Confidence key: **high** = direct SSR line item; **medium** = SSR-derived or SSR-adjacent with a
documented adjustment; **low** = mid-point of a researched Indian retail range (educated estimate).

| id | Unit | INR / unit | ≈ INR/sqft | Source & derivation | Confidence |
|----|------|-----------:|-----------:|---------------------|------------|
| `ceramic-tile-grey` | SQM | 1,005 | 93 | **SSR**: "Vitrified rustic matt stone finish 590-605mm sq" = ₹1,005/m². Exact product match (large-format matte). DSR composite for 600×600 is ₹1,553/m² incl. labour — consistent. | **high** |
| `paint-navy` | LITER | 476 | — | **SSR**: "Royale Luxury Emulsion Paint" ₹476/L. Deep-tint eggshell base sits at the luxury emulsion rate. | **high** |
| `paint-white-matte` | LITER | 225 | — | **SSR**: "Acraylic Emulsion Paint" ₹223/L, rounded. Standard-grade white matte. | **high** |
| `paint-sage` | LITER | 380 | — | **SSR**: between "Plastic emulsion" ₹345/L and "Royale Luxury" ₹476/L; premium tinted interior emulsion. | medium |
| `paint-warm-grey` | LITER | 280 | — | **SSR**: between acrylic ₹223/L and plastic emulsion ₹345/L; standard-grade tinted. | medium |
| `subway-tile-white` | SQM | 750 | 70 | **SSR**: "Ceramic Tiles for dado 30×60 cm" ₹611/m², uplifted for the bevelled 75×150 gloss format. | medium |
| `gypsum-ceiling` | SQM | 450 | 42 | **SSR**: Gypsum Board 12.5mm ₹238/m² + GI framing sections + white putty ₹31/kg + emulsion. Board rate is hard; the build-up is estimated. | medium |
| `fiber-cement-siding` | SQM | 850 | 79 | **SSR**: "Cement Sheet 8mm" ₹500/m², "12mm" ₹700/m²; uplifted for through-coloured architectural board. | medium |
| `brick-veneer-red` | SQM | 1,120 | 104 | **SSR**: 1st-class red brick ₹9/no. ≈ 55/m² = ₹495, plus wirecut *facing* brick premium (₹16-20/no.) and mortar materials. | medium |
| `clay-tile-roof` | SQM | 1,150 | 107 | **SSR**: Mangalore tiles class AA ₹24/no. (≈ ₹360/m²); barrel/terracotta profile carries a large premium over Mangalore. Uplift is estimated. | medium |
| `metal-standing-seam` | SQM | 1,500 | 139 | **SSR**: "Precoated Galvanised Steel Plain Sheet" ₹1,143/m², "GI pre-coated trapezoidal 0.5mm" ₹958/m². Uplifted for aluminium + concealed-fix seam profile. | medium |
| `stucco-white` | SQM | 550 | 51 | **SSR**: cement ₹300/bag, white cement ₹36/kg, screened sand ₹1,781/m³, cement paint ₹70/kg. Silicone/acrylic through-coloured render material build-up. | medium |
| `exposed-brick` | SQM | 1,250 | 116 | SSR brick rate as a floor; reclaimed brick-slip cladding retail ₹60-120/sqft. Mid-upper of range (reclaimed carries a premium). | low |
| `wood-plank-ceiling` | SQM | 1,700 | 158 | **SSR** jungle/non-teak timber ₹42,758/m³ → ₹513/m² of raw 12mm board; retail T&G pine boards ₹120-220/sqft. | low |
| `wood-panel-walnut` | SQM | 3,550 | 330 | Retail walnut slat acoustic panel ₹250-450/sqft. SSR sanity: 4mm gurjan veneer ply ₹2,500/m², 19mm BWP ply ₹1,200/m². | low |
| `venetian-plaster` | SQM | 1,100 | 102 | Retail. Applied rates run ₹150-300/sqft; the **material-only** share is roughly ₹90-120/sqft (this finish is labour-dominated). | low |
| `marble-carrara` | SQM | 5,600 | 520 | **SSR** "Italian marble 18mm" ₹4,000/m² is the generic grade; branded Carrara retails ₹350-700/sqft. Set near the middle. Kept as the most expensive floor by design. | low |
| `oak-hardwood` | SQM | 4,500 | 418 | Retail solid/engineered hardwood ₹380-820/sqft; imported European oak set at the lower-middle. SSR teak planks ₹105,028/m³ (≈ ₹1,890/m² of 18mm raw stock) is the raw-timber floor. | low |
| `cedar-cladding` | SQM | 3,200 | 297 | Retail imported WRC ₹350-600/sqft, moderated to sit at the top of the researched cladding band (HPL ₹180-350/sqft) rather than above all of it. | low |
| `bamboo-floor` | SQM | 2,800 | 260 | Retail strand-woven bamboo ₹180-350/sqft, mid-point. | low |
| `carpet-loop-beige` | SQM | 1,950 | 181 | Retail wool loop broadloom ₹120-250/sqft, mid-point. | low |
| `polished-concrete` | SQM | 1,150 | 107 | Material-only build-up: densifier, hardener and sealer (largely imported chemicals). Labour/machinery, which dominate this finish, are excluded. | low |
| `asphalt-shingle` | SQM | 1,000 | 93 | Retail imported architectural shingle ₹90-160/sqft. Not an SSR item — asphalt shingles are a niche import in India. | low |
| `laminate-oak` | SQM | 950 | 88 | Budget AC4 8mm click-lock. **See caveat below.** | low |

### Caveat on `laminate-oak`

The researched retail range supplied for laminate wood flooring was **₹160-300/sqft**, which would
put it at ₹1,722-3,229/m². I priced it at **₹950/m² (₹88/sqft)** instead, deliberately below that
range, for two reasons:

1. Indian laminate quotes at ₹160+/sqft are almost always **supplied and fitted**, bundling underlay,
   beading and installation. This catalog is material-supply-only.
2. Budget AC3/AC4 8mm laminate (Action Tesa, Greenlam and equivalents) genuinely sells at
   ₹65-120/sqft as bare material.

Leaving it inside the supplied range would have made a BUDGET-tier laminate more expensive than
STANDARD-tier porcelain, inverting the price spread the recommendation engine's value scoring
depends on. **This is the single largest deliberate departure from a supplied source. Treat it as an
educated estimate, not a sourced figure.**

### Ordering checks

- Floors, most to least expensive: Carrara 5,600 > oak 4,500 > bamboo 2,800 > carpet 1,950 >
  polished concrete 1,150 > porcelain tile 1,005 > laminate 950. **Carrara is top, laminate is bottom.** ✅
- Exterior: cedar 3,200 > brick veneer 1,120 > fibre cement 850 > render 550 — same order as the USD catalog. ✅
- Roofing: standing seam 1,500 > clay 1,150 > asphalt 1,000 — same order as the USD catalog. ✅
- Wall finishes: walnut slat 3,550 > exposed brick 1,250 > venetian plaster 1,100 — same order. ✅
- Paints: navy 476 > sage 380 > greige 280 > white 225 — same order. ✅
- **One genuine inversion vs. the USD catalog:** wool carpet (1,950) now sits *above* polished
  concrete (1,150), where in USD it sat below. This reflects the real Indian market — wool broadloom
  is largely imported, while concrete is the cheapest hard finish available. Not an error.

---

## Pack sizes

Indian paint is sold in 1 L / 4 L / 10 L / 20 L packs. `packSize` was changed from the European
5 L convention to **4 L** for `paint-warm-grey`, `paint-sage` and `paint-navy`.
`paint-white-matte` was already 10 L, which is a valid Indian size, and was left alone.
All other `packSize` values (tile boxes, flooring packs, cladding packs) were left unchanged —
they are dimensional coverage figures, not currency-dependent.

---

## Components (8)

None of these are SSR line items in an directly usable form; all are **low confidence educated
estimates** from Indian retail, with SSR sanity anchors where one exists.

| id | INR | Derivation | Confidence |
|----|----:|------------|------------|
| `door-flush-oak` | 11,000 | Veneered flush shutter 0.9×2.1 m (1.89 m²) + frame. SSR anchor: PVC factory flush door shutter ₹4,350/m² → ₹8,221 shutter-equivalent; wooden veneered shutter + frame retails ₹9,000-14,000. | low |
| `door-panel-white` | 7,500 | Moulded/panel primed-and-painted door with frame, Indian retail ₹6,000-10,000. | low |
| `door-entry-walnut` | 95,000 | Oversized insulated pivot 1.1×2.4 m. Indian bespoke range ₹80,000-250,000; set near the bottom, as this is a catalog seed not a bespoke quote. | low |
| `window-casement` | 14,000 | Slim-frame aluminium DGU casement 1.2×1.4 m (18.1 sqft) at ≈ ₹775/sqft (retail band ₹700-1,100/sqft). | low |
| `window-double-hung` | 8,500 | uPVC sash 1.0×1.4 m (15.1 sqft) at ≈ ₹565/sqft. | low |
| `window-picture-large` | 37,000 | Fixed DGU 2.4×2.2 m (56.8 sqft) at ≈ ₹650/sqft — fixed glazing is cheaper per sqft than openable. SSR sanity: toughened 6mm glass ₹2,500/m² is the bare-glass floor. | low |
| `sofa-3seat` | 45,000 | Indian mid-market fabric three-seater, ₹35,000-60,000. | low |
| `pendant-light` | 4,500 | Mid-market metal dome pendant. | low |

---

## Result for the sample project

80 m² (861 sqft) five-room apartment, including exterior envelope and roof:

| Surface | INR |
|---------|----:|
| FLOOR | 299,138 |
| EXTERIOR_WALL | 288,000 |
| COMPONENT | 280,000 |
| ROOF | 189,810 |
| WALL | 100,882 |
| CEILING | 38,880 |
| **Materials subtotal** | **1,196,710** |
| Contingency (8%) | 95,737 |
| **Total** | **1,292,447** |

- All surfaces: **≈ ₹1,501/sqft material-only**.
- **Interior only** (floor + wall + ceiling + components): ₹718,900 ≈ **₹835/sqft material-only**.

The ₹1,200-2,500/sqft benchmark for an Indian mid-market fit-out is **all-in, including labour**,
and covers interior work only. The comparable figure here is the ₹835/sqft interior material-only
number, which sits comfortably below it — labour and margin would take it into the lower half of
the benchmark band. The all-surfaces figure is higher only because it also carries exterior cladding
and a roof, which the fit-out benchmark does not cover at all.

Note that the sample project specifies a premium scheme throughout (solid oak floors, imported
cedar cladding, standing-seam aluminium roof, walnut pivot entry door). A budget scheme drawn from
the same catalog would land substantially lower.

---

## Refreshing these prices

### 1. Re-baseline from the SSR (preferred, for the `high`/`medium` rows)

Download the current Maharashtra PWD schedule and re-read the material sheet:

```bash
curl -L -o SSR.xlsx https://dsr.emahapwd.com/user/tempex/SSR_2022-23.xlsx
unzip -o SSR.xlsx -d ssrx
# sheet named "Material Rates for ssr 2022-23"; resolve its r:id in
# ssrx/xl/workbook.xml against ssrx/xl/_rels/workbook.xml.rels
# (for the 2022-23 edition this is rId7 -> worksheets/sheet7.xml)
```

Columns are `A: Sr No | B: Description | C: Per Unit | D: Rate (Excluding GST)`.
Check the **CPWD DAR** (Delhi Analysis of Rates) and the current CPWD DSR for a cross-region
sanity check — remembering that DSR composite rates include labour and mortar.

### 2. Escalate forward with WPI (for years where no new SSR is published)

The Office of the Economic Adviser publishes a free monthly Wholesale Price Index:

```
https://eaindustry.nic.in/indx_download_2223/wpi_monthly_index_YYYYMM.xlsx
```

Scale a price by `WPI_target_month / WPI_base_month` using the relevant commodity code:

| Commodity | WPI code | Applies to |
|-----------|----------|------------|
| OPC cement | `1313050003` | polished concrete, render/stucco, gypsum ceiling, brick veneer mortar |
| Ceramic tiles | `1313020001` | porcelain, subway, vitrified tiles |
| Paint | `1310050001` | all four emulsions |
| Plywood | `1307020002` | walnut slat panelling, timber ceiling |
| Mild steel bars | `1314010014` | standing-seam roofing, aluminium/steel window and door frames |

WPI escalation is a blunt instrument: it tracks commodity movement, not product mix or
retail margin. Use it for at most one or two years past the SSR base before re-baselining.

### 3. Re-quote the `low` confidence rows

Everything marked **low** above — the whole imported/finish-goods tail, all eight components, and
`laminate-oak` in particular — is an educated estimate, not a sourced rate. These should be replaced
with real supplier quotes before any commercial use. They currently account for the majority of the
sample project's total, so the headline figure is **indicative only**.
