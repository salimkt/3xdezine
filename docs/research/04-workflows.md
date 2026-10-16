# 04 — How Indian interior projects actually run (workflows, BOQ, GST, modular, approvals)

Research date: 2026-10-16. Scope: residential and small-commercial interiors in Indian metros
(Bengaluru, Mumbai, Delhi NCR, Hyderabad, Chennai, Pune), mid-segment.

**How to read this.** Every number has a source in the Sources section. Most published Indian rate
data comes from vendor and lead-generation blogs, not from schedules of rates. Treat all rates as
**planning ranges**, not quotes. The few primary documents found (an IIM Shillong tender, a BIS
tender that quotes the Council of Architecture fee scale, CBIC/GST notifications, CPWD-style rate
analyses) are flagged as such. Anything I could not confirm is in the *Unverified* list at the end.
Where a sentence is my own synthesis rather than a source's claim, it says "(synthesis)".

Source-quality note: `studiomatrx.org` turns up in nearly every search with very specific numbers.
It is a 2026 content site whose pages sometimes contradict each other (one BOQ sample's group
subtotals add up to ₹19.3 L against a stated ₹21.5 L total). Its *structures* are useful. Its
*numbers* are used here only when another source corroborates them.

---

## 0. TL;DR for product

1. **The quotation/BOQ is the real product, not the 3D.** In India the 3D view sells the job, but
   the BOQ is the contract. It gets signed as an annexure, disputed line by line, and used to pay
   milestones. 3xDezine already measures geometry. It can turn that geometry into BOQ quantities
   (sq ft, rft, points, nos) that nobody has to retype into Excel.
2. **Units must be trade units.** Quantities are sq ft for most items, running ft (rft) for
   skirting, cornice, cove, kitchens and lofts, per point for electrical, and nos for fixtures. Rates
   are composite (material + labour) by default. The catalogue's per-m² supply prices need a
   conversion layer *and* a labour/composite rate layer.
3. **Modular is priced by area or running foot, with a spec matrix.** The spec matrix covers
   carcass, shutter finish, hardware tier and accessories. A credible kitchen/wardrobe pricer needs
   about 10 parameters, not a full cabinet bill of materials (BOM).
4. **GST is 18% on almost everything an interior firm bills** (design 998391, works contract 9954,
   furniture 9403, plywood 4412). Plywood moved from 28% to 18% on 22 Sep 2025 under "GST 2.0" for
   some sub-categories. The important details for software:
   - CGST+SGST vs IGST depends on the property's state (place of supply for immovable-property
     services).
   - GST falls due on *advances for services*, so the booking advance needs a receipt voucher.
   - Unregistered (< ₹20 L) and composition designers must issue documents *without* GST.
5. **Milestone payments are where trust breaks.** Clients and consumer-dispute guides push for
   payments tied to verified progress and for written variation orders. WhatsApp is the de facto
   approval channel, and its evidence is fragile. A portal wins only if it is *at least as low
   friction as WhatsApp*: approval by link with no login, a timestamped audit trail, and WhatsApp
   notifications. At least one Indian SaaS (Verified Studio) already sells exactly this.

---

## 1. Project lifecycle

Synthesis from the IIM Shillong NIQ (a real COA-style stage list), job descriptions, consumer
guides, The Quint/Dex hidden-cost piece, and the dispute guides. "Owner" means who prepares the
artefact and "Approver" means who signs it off.

| # | Stage | Artefact produced | Typical tool today | Owner → Approver | Where time/money is lost |
|---|---|---|---|---|---|
| 1 | **Lead / enquiry** | Enquiry note: BHK, carpet area, budget band, possession date, scope (full home / kitchen + wardrobes only) | WhatsApp Business, Instagram DMs, Justdial/NoBroker/Houzz leads, phone. Excel or a CRM at larger firms | Sales → none | Unqualified leads. Free site visits for people who only want a price. Many studios now charge a refundable "design booking" fee to filter |
| 2 | **Site visit & measurement** | Hand sketch with dimensions, photos, video walk-through, point locations (DB, existing plumbing, windows, beams, columns, shafts) | 5 m tape, laser distance meter (Bosch/Leica entry models), phone camera, paper. LiDAR apps are rare (see §7) | Designer or site supervisor → none | Missed beams, soffits and sill heights. Measuring before plaster/tile (a 12 mm tile changes kitchen runs). Out-of-square walls. **Electrical/civil scope is left vague until after signing** (The Quint) |
| 3 | **Brief & concept / moodboard** | Requirement sheet ("scope note": inclusions, exclusions, specs), moodboard, reference images, material palette | Pinterest, Canva, PowerPoint/Keynote, PDF over WhatsApp | Designer → client (often with spouse or parent) | Endless "inspiration" loops. Scope is not written down, so later disputes about "what was promised" |
| 4 | **2D layout** | Furniture layout per room, revisions | AutoCAD (dominant), sometimes SketchUp 2D, hand drawings at small firms | Designer → client | Client cannot read plans. Revisions are unbounded unless the contract caps them (packages usually allow 2–3 rounds) |
| 5 | **3D views** | 3–10 still renders of key spaces, sometimes a walkthrough video or 360° panorama | SketchUp + V-Ray/Enscape/D5/Lumion; 3ds Max + Corona at higher end; Foyr/Homestyler-type web tools at the low end; outsourced render studios | 3D visualiser → client | Each change costs a re-render. **The renders show lighting and furnishings that the quote does not price** (The Quint), which creates an expectation gap |
| 6 | **Quotation / BOQ** | Room-wise or trade-wise BOQ in Excel/PDF: item, spec/brand, unit, qty, rate, amount, plus GST, payment schedule, T&C, exclusions | Excel (overwhelmingly), Excel templates sold online, PDF via WhatsApp/email. Larger brands (Livspace, HomeLane, DesignCafe) use in-house quoting engines | Estimator/designer → client | Retyping quantities from CAD. Per-sq-ft headline rates that don't define scope. Comparing quotes on different area bases (carpet vs built-up). GST left out of the headline price |
| 7 | **Negotiation** | Revised quote v2, v3…, often a discount line or spec downgrade (BWP → MR ply, acrylic → laminate) | Excel, WhatsApp chat | Principal → client | Silent spec substitution later becomes the #1 dispute ("MR plywood in place of BWP"). Versions get lost in chat |
| 8 | **Booking advance / agreement** | Signed quote or agreement with the BOQ as Annexure A, advance receipt (should be a GST receipt voucher if registered) | PDF printed and signed, or "OK go ahead" on WhatsApp. UPI/NEFT/cheque | Client signs, studio countersigns | No written agreement. "Non-refundable" advances. Advance demanded too high (dispute guides flag a 60% upfront demand as "a flag") |
| 9 | **Detailed / GFC drawings** | Working drawings: furniture elevations, false-ceiling RCP, electrical layout with point schedule, plumbing, flooring pattern, kitchen and wardrobe shop drawings, material/finish schedule | AutoCAD, factory software for modular (e.g. cut-list/nesting tools), PDF | Designer → client (signs the drawings) → contractor/factory | Drawing errors found on site. Factory "shop drawings" differ from the design drawings. No revision control ("GFC drawings issued with revision control" appears in job descriptions as an aspiration) |
| 10 | **Procurement** | Purchase orders to vendors (ply, laminates, hardware, tiles, sanitary, lights), factory production orders for modular, delivery schedule | Excel, phone, WhatsApp to dealers, Tally for accounting | Procurement/PM → principal | Price changes between quote and order. Hidden 20–40% markup on procured items (The Quint). Lead times on acrylic/PU shutters and imported hardware |
| 11 | **Execution** | Daily/weekly site photos, labour attendance, measurement book for civil/painting, variation orders | WhatsApp groups (client + designer + supervisor + sometimes vendors), paper registers | Site supervisor → PM → client (for variations) | Trade sequencing: electrical before ceiling closes, ceiling before paint, countertop after base carcass and before shutters (Truww). Verbal scope changes become a "scope creep" defence. Electrical additions add ₹30–80k over the base quote on a 2BHK (The Quint) |
| 12 | **Handover** | Snag list, handover note, warranty cards, as-built drawings (rarely for residential), final invoice | WhatsApp photos, PDF/Excel snag list | PM → client signs off | Final 5–10% withheld over snags. Disputes over whether snags are "new scope" |
| 13 | **Snags / warranty** | Snag closure log, warranty claims (hardware: Hettich-class brands offer long warranties; modular brands advertise 10-year carcass warranties) | Phone/WhatsApp | Service team → client | No structured log. Warranty proof scattered |

The IIM Shillong NIQ (July 2025) is the cleanest formal version of this lifecycle, as used in
architect/interior-designer engagements:

1. Concept design and a rough area-based estimate.
2. Preliminary design, interior views, a schedule of finishes, and a preliminary estimate.
3. Drawings for client and statutory approval.
4. Working drawings, specification and schedule of quantities (the BOQ), plus tender documents.
5. Appointment of contractors.
6. Construction: shop drawings, sample approval, periodic inspection.
7. Completion report and as-built drawings.

Residential practice compresses stages 3–5. Often the designer *is* the contractor (turnkey).

---

## 2. Quotation / BOQ format

### 2.1 Structure seen in Indian BOQs

**Columns (8).** These are the canonical columns from the BOQ explainer and the template sellers:

`Sl. No. | Item description (with spec) | Brand / IS standard / grade | Unit | Qty | Rate | Amount | Remarks`

Variants add `Room`, `Material rate` and `Labour rate` as separate columns (common in contractor
BOQs and in CPWD-style rate analysis), and `HSN/SAC` + `GST %` for commercial clients claiming ITC.
Excel templates take *L × W × H* inputs and compute sq ft or rmt.

**Two organising axes:**
- **Room-wise** (residential, client-facing): Foyer, Living, Dining, Kitchen, Master Bedroom,
  Bedroom 2, Kids, Toilets, Balcony, Utility, Pooja. Clients think in rooms and cut scope by room.
- **Trade-wise** (contractor, commercial, government): the template-seller sections are
  1. Demolition & Civil
  2. False Ceiling
  3. Woodwork & Furniture
  4. Flooring & Tiling
  5. Electrical & Lighting
  6. Painting & Wall Finishes
  7. Plumbing
  8. Glass & Metal Work

  Add Modular Kitchen, Wardrobes, Loose Furniture, Soft Furnishings, Appliances, CP & Sanitary,
  Design/PM fees.
- **Practice (synthesis):** client quotes are room-wise for joinery and furniture and trade-wise
  for "wet" trades (civil, electrical, plumbing, painting, ceiling, flooring). The 20-line sample
  BOQ for a 3BHK (Bangalore, mid-spec) groups lines as Kitchen / Wardrobes & joinery / Living &
  dining joinery / False ceiling / Lighting / Painting & accents / CP & sanitary / Electrical.
  **A tool must let the same lines be viewed both ways (room × trade pivot).**

**Supporting sheets** seen in templates:
- Summary/Dashboard.
- Rate Analysis, which justifies a rate as material + labour + overhead + margin.
- **Make list:** the approved brands per category, for example "Plywood: Century/Greenply BWP 710;
  Laminate: Merino/Greenlam 1 mm; Hardware: Hettich/Hafele; Wires: Havells/Finolex FRLS; Paint:
  Asian Paints Royale".
- Exclusions list.
- Payment schedule.
- Terms (validity, variation, warranty).

**Contractual use:**
- Get three quotes in the same format and compare them line by line.
- Sign the agreed BOQ as **Annexure A**.
- Route every change through a **numbered variation order** with cost and time impact.
- The explainer suggests a variation cap: review at 10%, stop at 15%.

### 2.2 Units

| Trade | Unit used in trade | Notes |
|---|---|---|
| False ceiling (gypsum/POP/PVC/grid) | **sq ft** of ceiling area | Cove/profile light channels are usually extra, per **rft**. Concealed-light wiring adds about ₹5–40/sq ft (sources differ). Light fixtures are separate (nos) |
| Cornice, cove, moulding, beading | **rft** | |
| Painting | **sq ft** of wall/ceiling area (deductions for openings vary by contractor) | Rate depends on system: putty + primer + 2 coats; texture is separate |
| Flooring / tiling | **sq ft** laid. Skirting is **rft** | Labour is often quoted separately from tile supply. Tile is bought in boxes (pack rounding already exists in 3xDezine) |
| Wall cladding / panelling / wallpaper | **sq ft** (wallpaper sometimes per **roll**) | |
| Electrical | **per point** (light point, fan point, 6A/16A power point, AC point, TV/data point), plus **nos** for DB, MCBs and fixtures, plus **rmt** for extra runs | Point = wiring from the switchboard to the outlet, including conduit and switch. Definitions vary, so the quote must state the wire gauge and brand |
| Plumbing | per **point** (inlet/outlet), **nos** for CP fittings and sanitaryware | |
| Modular kitchen | **rft** (running ft of base + wall units) *or* **sq ft** (front elevation or exposed surface area). Countertop is **sq ft** or **rft** | See §5 |
| Wardrobes | **sq ft** of front elevation (W × H). Loft is a separate sq ft rate | |
| Loose furniture, appliances, fixtures, CP | **nos** / **set** | |
| Soft furnishings | Curtains: per **panel**, or per **rft** of track + per **metre** of fabric. Blinds: per **sq ft** | |
| Civil (demolition, brickwork, plaster, waterproofing) | **sq ft**/**sq m**, **cu m**, or **LS** (lump sum) | Usually quoted after the site is opened |
| Design / PM | % of project, per **sq ft** of carpet area, or **LS** | §2.4 |

Conversions: 1 m² = 10.7639 sq ft; 1 m = 3.28084 ft. Government schedules (CPWD DSR, state SSRs)
are metric (sqm, rmt). Residential trade quotes are imperial (sq ft, rft) while drawings are in mm.
**Store metric internally and present trade units.**

### 2.3 Indicative mid-segment metro rates (INR, 2026, composite material + labour unless stated)

| Item | Unit | Range | Source / confidence |
|---|---|---|---|
| Gypsum false ceiling, plain | sq ft | ₹75–125 (Bengaluru); ₹85–160 (Mumbai) | DesignCafe Feb 2026, AECORD, Comaron. Medium |
| POP false ceiling | sq ft | ₹75–120; CPWD-style analysis ₹822–1,088/sqm ≈ ₹76–100/sq ft | DesignCafe, Infralens. Medium |
| PVC / grid / metal ceiling | sq ft | ₹70–160 / ₹85–150 / ₹150–300 | DesignCafe. Low–medium |
| Ceiling labour/material split | — | material 40–50%, labour 30–40%, fixtures 10–20% | AECORD. Low |
| Interior painting, putty + primer + 2 coats premium emulsion | sq ft | ≈ ₹19–32 all-in (from ₹206–352/sqm). Labour alone ≈ ₹8–12 | Infralens rate analysis (Delhi/Bengaluru/Mumbai), housegyan. Medium |
| Texture paint | sq ft | ₹15–25 labour only. Around ₹150/sq ft all-in for designer textures | aapkapainter (Chennai), constructionestimatorindia. Low |
| Electrical light/fan point, concealed | per point | ₹520–760 (consultant guide) **or** ₹930–1,568 (CPWD-style, 18 m of 1.5 mm² FR wire + 6A switch + 15% margin) | constructionestimatorindia; Infralens. **Wide disagreement**, which depends on the point definition |
| 16A power point | per point | ₹1,656–2,555 (Delhi, CPWD-style) | Infralens. Low–medium |
| Vitrified tile laying (labour only) | sq ft | ₹25–45 national. ₹35–55 Bengaluru. ₹40–60 Mumbai. Large-format ₹45–80 | studiomatrx only. Low |
| Skirting (labour) | rft | ₹25–45 (Bengaluru) | studiomatrx only. Low |
| Modular kitchen | rft | Laminate ₹9,000–14,000 (basic) / ₹12,000–18,000 (premium). Acrylic ₹15,000–22,000. PU ₹18,000–28,000 | livehomes (Chennai 2026). Low–medium |
| Modular kitchen | sq ft (cabinet area) | Laminate ₹1,000–1,500. Acrylic ₹1,500–2,500. PU ₹2,000–3,500 (GST incl.). Truww (2021): BWP base ₹1,500–1,800, MR wall ₹1,100–1,500, loft ₹600–900 | Multiple vendors. Medium on order of magnitude |
| Whole kitchen, 2BHK apartment | LS | ₹1.3–4.5 L (Truww 2021); ₹1.9–4.8 L (HomeLane Hyderabad 2026); L-shape ₹2.5–4.5 L (NoBroker 2026) | Medium |
| Countertop | sq ft | Material ₹150–2,000 (granite → quartz/Corian), fitting ₹300–600 | Truww. Low (2021) |
| Wardrobe, carpenter/modular, laminate | sq ft front | ₹1,100–1,700 (MR ply + laminate, includes hardware and labour); ₹1,200–1,600 typical | truww woodwork guide, studiomatrx. Medium |
| Wardrobe shutter only, MDF + laminate | sq ft | ₹139–196 (₹1,495–2,110/sqm), of which carpenter labour ≈ ₹43–61 | Infralens. Medium |
| Shutter finishes (shutter only) | sq ft | Membrane ₹650–1,000. Laminate ₹400–1,400. Acrylic ₹1,200–2,200. PU ≈ 2× laminate. Cost ratio laminate : membrane : acrylic : PU ≈ 1 : 1.3 : 2 : 2.7 | Asian Paints Beautiful Homes, studiomatrx, Infralens. Low–medium |
| Carpenter day rate | day | ₹780–1,093 (Delhi). About ₹890–903 in tier-2 cities | Infralens. Medium |
| Full home "per sq ft" turnkey | sq ft carpet | ₹800–1,400 basic, ₹1,400–2,500 mid, ₹2,500–4,500 premium | interiorcompany/houseyog. Low. **This headline number is the main source of disputes** |
| Design fee add-ons | each | Extra 3D view ₹2,500. Extra revision ₹5,000. Extra site visit ₹4,000. Supervision ₹35,000/month | studiomatrx quotation generator. Low (illustrative) |

**Labour vs material split (synthesis):**

| Trade | Labour share | Basis |
|---|---|---|
| Painting | ≈ 35–45% | Infralens |
| False ceiling | ≈ 30–40% | AECORD |
| Joinery (shutter fabrication) | ≈ 30% | Infralens |
| Kitchen overall | 30–40% | homelane/houseyog |
| Tiling | 30–50% | Depends on tile price |

Residential quotes almost always show **composite** rates. Contractor and commercial BOQs, and
"labour-only" arrangements (the client buys material), split them. Labour-only contracts carry a
different SAC (9987 per BUSY; verify).

Hidden markup: The Quint/Dex reports **20–40% markup on procured items embedded in the price**,
not shown as a line.

### 2.4 How design fees are charged

| Model | Typical | Source |
|---|---|---|
| **% of project (execution) cost** | 6–15% (general). 5–10% (Indore). The COA scale extract puts interior architecture at **7.5% of estimated or actual cost, whichever is lower**, halved for repetitive work at the same site. CPWD (2015 OM) notes that the COA scale is *not* government-approved | houseyog, BIS EOI quoting COA, CPWD OM |
| **Per sq ft (carpet)** | Design only ₹30–50 (3D-only) to ₹75–200 (full design packages). Design + PM ₹250–350 | constructionestimatorindia, studiomatrx |
| **Flat / package** | ₹25–30k consultation. ₹75k / ₹1.5 L / ₹3 L package tiers in one generator | houseyog, studiomatrx |
| **Free design, recovered in execution margin** | Turnkey brands and most small contractors. Design is "free" and margin sits in the BOQ markup | The Quint (markup), synthesis |
| **Stage-wise % (formal)** | COA-style: retainer 5% → concept 10% → preliminary 20% → approvals 35% → working drawings & BOQ 45% → tender 55% → GFC 65% → then 70/75/80/85/90% at 20/40/60/80%/virtual completion → 100% at completion (all **cumulative**) | IIM Shillong NIQ 2025 (primary) |

---

## 3. GST on interior work

### 3.1 Rates and codes (post-22 Sep 2025 "GST 2.0")

| Supply | Code | Rate | Notes |
|---|---|---|---|
| Interior design consultancy (no material) | **SAC 998391**: specialty design services, including interior design | **18%** | Unchanged before and after 22 Sep 2025 (BUSY). Some blogs cite the group heading 9983 |
| Interior works with labour + material (turnkey fit-out fixed to the building) | **SAC 9954** (construction services). Sub-codes in group **99547 "building completion and finishing"**: **995476** joinery & carpentry, **995473** painting, plus others for glazing, plastering, tiling (see unverified list) | **18%** with ITC | A *works contract* under s.2(119) CGST Act (work on immovable property involving transfer of property in goods) is a *service* (Schedule II para 6(a)). TaxTMI forum opinion puts execution with material under 9954 |
| Pure labour contract (client supplies material) | SAC 9987 per BUSY (repair/maintenance/installation). Practitioners also use 9954 | 18% | Verify per contract |
| Modular furniture / wardrobes / kitchens supplied as goods | **HSN 9403** | **18%** (wooden furniture unchanged). Metal, glass and stone furniture moved from 28% to 18%. Bamboo/cane 5% | Bajaj Finserv, Axis, Razorpay |
| Plywood / MDF / particle board | HSN **4412 / 4411 / 4410** | **18%** | Some plywood and laminated-wood sub-categories moved from **28% to 18%** on 22 Sep 2025 (Tally) |
| Tiles, sanitaryware, paints, lights, appliances | Respective HSN | Mostly 18%. Some lines carried 28% pre-2025. **Look up per HSN** | |

**Composite vs mixed supply (CGST s.2(30), s.2(74), s.8):**
- A *composite* supply (naturally bundled, with a principal supply) is taxed at the principal
  supply's rate. A turnkey interior contract is a composite supply. Where it is a works contract on
  immovable property, it is a service at 18%.
- A *mixed* supply (independent items sold for one price) is taxed at the **highest** rate among
  the items.
- Since almost everything is 18% after 2025, the rate risk is small. The **classification**
  (goods vs service) still matters for:
  1. time of supply on **advances**;
  2. place of supply;
  3. HSN vs SAC on the invoice;
  4. the client's ITC eligibility. ITC on works contracts for construction of immovable property is
     blocked for the recipient under s.17(5)(c)/(d), except for a works contractor's onward supply.
     A homeowner gets no ITC anyway. A business client may be blocked if the work is capitalised
     to the building (verify).

**Place of supply (IGST Act s.12(3)):** for services directly related to immovable property
(design, interior works), the place of supply is **where the property is located**.
- A Bengaluru studio doing a Mumbai flat makes an inter-state supply and charges **IGST 18%**.
- A local job is charged CGST 9% + SGST 9%.
- One TaxTMI thread (2023) discusses a supplier who billed IGST for a Mumbai project without
  registering in Maharashtra. Treat this as fact-specific (unverified).

**Advances:**
- Under the time-of-supply rules, **GST is payable on advances received for services**. A booking
  advance for design or a works contract should get a **receipt voucher** (Rule 50), with GST paid
  in that month's return.
- Advances for *goods* were relieved by Notification 66/2017-CT (from memory; verify).
- If the job is cancelled, a **refund voucher** (Rule 51) is issued.
- Software that records the "10% booking" must therefore produce a receipt voucher, not just a
  payment entry.

### 3.2 What a tax invoice must show (CGST Rule 46)

1. Supplier name, address, **GSTIN**.
2. Consecutive serial number, at most 16 characters, unique for the financial year
   (alphanumeric, "-" and "/" allowed).
3. Date of issue.
4. Recipient name, address and **GSTIN** if registered.
5. For an *unregistered* recipient with taxable value ≥ ₹50,000: name, address, and the delivery
   address with **state name and code**.
6. **HSN / SAC**:
   - Aggregate turnover ≤ ₹5 crore in the preceding financial year: 4 digits on B2B invoices, and
     optional on B2C invoices.
   - Turnover > ₹5 crore: 6 digits.
   - These are the Notification 78/2020-CT rules, effective 1 Apr 2021. Some specified goods need 8
     digits.
7. Description.
8. Quantity and unit (UQC). For goods.
9. Total value.
10. Taxable value after discounts.
11. **Rate and amount** of CGST/SGST/UTGST or IGST, shown separately.
12. **Place of supply** with state name, for inter-state supplies.
13. Delivery address if different from the place of supply.
14. Whether tax is payable on **reverse charge**.
15. Signature or digital signature.

Other requirements:
- **E-invoicing (IRN + QR)** is mandatory above ₹5 crore AATO (from Aug 2023; verify current
  threshold).
- Many studios also print PAN, bank details/UPI QR, and a "subject to <city> jurisdiction" line.

**A quotation is not a tax invoice.** Studios send:
1. a **quotation/estimate**: no GST obligation, but it should show GST separately;
2. a **proforma invoice** to collect milestone payments;
3. a **receipt voucher** for each advance;
4. **tax invoices** as stages complete;
5. **credit/debit notes** for variations.

Template sellers note that residential quotes often "club" GST into the total. Commercial clients
need the CGST/SGST/IGST breakup for ITC. The Quint/Dex lists GST left out of the headline price as
the first hidden cost.

### 3.3 Small designers

| Situation | Rule | What to issue |
|---|---|---|
| Turnover ≤ **₹20 L** for services (≤ **₹10 L** in special-category states) | Registration not required. Cannot charge GST | Plain invoice/bill with no GST line. Many freelancers stay here. But an inter-state *goods* supply forces registration, so check |
| Registered, turnover ≤ **₹50 L**, opts for **composition for services** (s.10(2A)) | Pays 6% (3% + 3%) of turnover. **Cannot collect GST from the client, cannot claim ITC, no inter-state supply** | **Bill of Supply** reading "composition taxable person, not eligible to collect tax on supplies". GSTR-4 annually, CMP-08 quarterly |
| Regular registration | 18% charged, ITC on ply, hardware and subcontractor invoices | Tax invoice. Monthly GSTR-1/3B (or quarterly QRMP if ≤ ₹5 cr) |

Practice (synthesis from the BUSY and TaxBuddy blogs): small turnkey contractors who buy material
with GST often register *voluntarily*. Otherwise the ITC on 18% ply and hardware is lost and they
are uncompetitive against registered firms with commercial clients. Pure-design freelancers often
stay unregistered.

**TDS (client side):**
- A homeowner (individual/HUF not liable to audit) must deduct **5% TDS under s.194M** only when
  payments to one contractor or professional exceed **₹50 L in a financial year**. Interior
  decoration is listed under the "professional" category.
- Business clients deduct under **194C** (contract) or **194J** (professional).
- The new Income-tax Act 2025 (effective 1 Apr 2026) renumbers these sections. Verify the new
  numbers.

**Product implications:**
- Studio profile needs a `gstRegistration: REGULAR | COMPOSITION | UNREGISTERED`, GSTIN, state code
  and turnover band. These drive document type, tax lines and HSN digit count.
- Every line needs `hsnSac` + `gstRate`.
- Tax is computed per rate bucket and per CGST/SGST vs IGST based on site state vs studio state.

---

## 4. Payment milestones

### 4.1 Observed schedules

| Who | Schedule | Source / reliability |
|---|---|---|
| Livspace (India, as listed on a deals page) | **5% booking** (or ₹25,000, whichever is higher). Then **50% at execution start** (cumulative?). Then balance to **100% before or at final installation** | dwello.in deals page. Third-party, medium |
| Livspace (Singapore, press) | 10% to start → 40% on design finalisation/order → 45% before delivery to site → **5% at handover** | EdgeProp. Medium (different market, same company playbook) |
| HomeLane (consumer complaint) | Booking % at sign-up, a second % within a week "to start design". The no-refund policy is the complainant's grievance | voxya complaint. Low |
| Consumer-dispute guide ("norm") | **20–30% booking → 30% at material delivery → 30% at installation → 10% on snag-list closure**. 40–60% upfront is reported often and is called "a flag" | righttoinformation.wiki 2026. Medium |
| Design-fee-only package | 30% agreement → 30% concept approval → 30% working drawings → 10% handover | studiomatrx generator. Low |
| Formal architect/ID engagement | COA-style cumulative stages: 5% retainer, 10/20/35/45/55/65%, then progress-linked to 100% | IIM Shillong NIQ. **Primary** |
| Modular (factory) pattern | **10% booking → 50% at design sign-off/production start → 35–40% before dispatch → 0–5% at handover** | Commonly cited and matches the caller's hypothesis. **Not verified for any named firm**; the closest verified pattern is Livspace SG 10/40/45/5 |

**Why it front-loads (synthesis):** modular factories cut sheets only after most of the money is in,
because made-to-measure carcasses have no resale value. So the "production" milestone is large.
Wet trades (civil, painting) are paid more by measurement and progress.

### 4.2 How disputes arise

These come from consumer forums, dispute guides and The Quint.
1. **The scope of the headline per-sq-ft price is undefined.** Carpet vs built-up area,
   rooms included, grades. Civil and electrical are "as required" until after signing. Lighting
   and decor appear in the renders but not in the quote.
2. **Spec substitution.** MR instead of BWP plywood, a cheaper laminate brand, unbranded hardware.
   A BOQ without brand/grade invites it.
3. **Verbal variations.** These lead to a "scope creep" defence for delays and surprise final bills.
4. **Advance with stalled work.** Advances of ₹80k–₹11 L in the case examples. The firm stops
   responding or removes the client from the WhatsApp group. "Non-refundable" clauses.
5. **Payments tied to dates, not verified work.** Advice: tie each milestone to verified
   completion, and hold the final payment until about 10 days of live use.
6. **Evidence is weak.** WhatsApp screenshots are lost (auto-delete). The guides recommend
   exporting chats as .txt and keeping UPI UTRs, dated site photos and measurement sheets. A
   WhatsApp "OK" to a written quote can be treated as acceptance under the Contract Act.

Remedies: legal notice, then an e-Daakhil consumer complaint, then (rarely) an FIR under BNS s.318.

**Product implication:** milestones should be *gates on artefacts*. For example, "Production
start" is unlocked by an approved GFC kitchen drawing plus a paid invoice, and "Handover" by a
closed snag list. Every approval and payment then carries a timestamp, the approver, and the
exact document version. That is the evidence trail clients and designers both lack today.

---

## 5. Modular kitchens and wardrobes

### 5.1 How they are specified

**Carcass (box) material**, in rough order of cost and moisture resistance:
- Particle board / pre-laminated particle board (budget, flat-pack).
- MDF.
- **HDHMR** (high-density high-moisture-resistant board, Action Tesa-type). Increasingly default
  for shutters and sometimes carcasses.
- **MR / BWR plywood** (IS 303 commercial / moisture-resistant).
- **BWP plywood** (IS 710 marine-grade, boiling-water-proof). The recommended choice for sink and
  base units.
- WPC/PVC board for sink units at some vendors.

Common practice is **BWP for base units, MR for wall units and lofts** (Truww). BWP costs about
₹400–700 more per sheet than MR (studiomatrx).

Thickness:
- Carcass is 18 mm (sometimes 16/17 mm for board).
- Back panel is 6–8 mm, or 18 mm on sink units at premium vendors.
- Shelves are 18 mm.
- Edges are PVC edge-banded, 0.8–2 mm (synthesis/trade convention).

**Shutter finishes** (cost ratio laminate : membrane : acrylic : PU ≈ 1 : 1.3 : 2 : 2.7):

| Finish | Construction | Notes |
|---|---|---|
| Laminate | 1 mm HPL on ply or MDF/HDHMR, matte, suede or gloss | Cheapest and widest range |
| Membrane | Vacuum-formed PVC foil on routed MDF | Shaker/profiled looks. Weak near heat |
| Acrylic | 1–2 mm acrylic sheet on MDF/HDHMR | High gloss, hard to repair |
| PU / lacquer | Spray-painted on MDF/HDHMR | Seamless finish, scratch-prone, long lead time |
| Others | Glass/aluminium-profile shutters, veneer, "anti-scratch / anti-fingerprint" laminates | |

**Hardware:**
- Premium brands: Hettich, Häfele, Blum. Mid/value brands: Ebco, plus house brands (Godrej,
  Hettich's "Onsys", etc.).
- Items: soft-close hinges (Hettich Sensys ≈ ₹728/pair listed), soft-close telescopic channels
  (≈ ₹790–820/set for 300–350 mm), **tandem boxes** (Hettich InnoTech/ArciTech ≈ ₹3,900–5,600 per
  drawer), lift-up mechanisms for wall units, corner solutions (magic corner, LeMans), tall-unit
  pull-outs, cutlery/thali/bottle/plain baskets (SS wire), wicker baskets, and dustbin pull-outs.
- The usual advice: premium hardware for daily-use drawers, cheaper for the loft.
- Accessories add ₹10k–1 L per kitchen.

**Handles:** G-profile/J-profile (handle-less), aluminium Gola profile, knobs, or surface handles.

**Countertop:** granite (most common), quartz, Corian/solid surface, SS. Sometimes nano-white.
Priced per sq ft or rft. Installed after the base carcass and before shutters.

**Indian-specific items:**
- A tall unit for appliances (microwave/oven/fridge housing).
- **Chimney + hob** (must be chosen before design freeze).
- A sink with drainboard.
- Water purifier space.
- **Loft** above the wall units to ceiling height.
- Utility/dry-kitchen counters.
- A pooja unit is sometimes part of the kitchen package.

**Standard dimensions (Indian guides):**

| Element | Size |
|---|---|
| Base unit carcass depth | 560–580 mm, with countertop overhang of 20–40 mm |
| Counter height (finished) | 850–900 mm |
| Wall unit height | 600–720 mm |
| Wall unit depth | 300–350 mm |
| Gap between counter and wall unit | ≥ 450 mm (600 mm for a tall backsplash) |
| Plinth | 100–150 mm, recessed 50–75 mm |
| Module widths (trade convention) | 300/400/450/500/600/800/900 mm, plus fillers |

**Configurations:** Straight (single wall), L-shaped, U-shaped, Parallel (galley), Island,
Peninsula/G. Unit types: base, wall, tall, loft, corner base, corner wall, sink base, hob base,
drawer stack, open shelf, appliance housing.

**Wardrobes:**
- Hinged or sliding (sliding needs a profile system and adds cost). Mirrored shutters. Walk-in.
- **Loft** above, to the ceiling.
- Typical depth 560–600 mm, height 7–8 ft plus loft.
- Internals: hanging rods (long/short), shelves, drawers with locks, trouser pull-outs,
  jewellery trays, a safe locker cavity.

### 5.2 How they are priced

Three conventions coexist. **A tool must support all three and convert between them**, because
clients compare quotes priced in different ways.

1. **Running ft (rft):** length along the wall of the base run (with the wall run included or
   priced separately). Common in kitchen marketing (₹9k–28k/rft by finish).
2. **Sq ft of front elevation (W × H):** the wardrobe default (₹1,100–1,700/sq ft) and also used
   for kitchens. The rate covers the *whole box behind the front*: sides, back, top, bottom,
   shelves, shutters, standard hardware and labour.
3. **Sq ft of exposed surface area / cabinet area (Truww):** woodwork area measured on two adjacent
   faces. Truww's example: an L-kitchen 7 × 4 ft → (7 + 4 − 2) × 2.9 ft = 26.1 sq ft of base.

Accessories (baskets, tandem boxes, corner units), countertop, sink, chimney/hob and appliances are
**always separate lines** (nos or sq ft). Loft gets its own lower rate.

Factory vendors internally price from a **BOM / cut-list** (sheets × rate + edge band + hardware +
machining + install + margin), then publish rft or sq ft rates to sales.

### 5.3 Minimum credible parametric model (synthesis)

To produce a number within about ±15% of a real Indian quote, a tool needs:
1. layout type and **run lengths per wall** (from 3xDezine's existing wall geometry);
2. per run: base / wall / tall / loft heights and depths (defaults from §5.1);
3. a list of modules with widths, or auto-fill from a standard module set;
4. **carcass material** per zone (base vs wall vs loft);
5. **shutter finish** per zone;
6. **hardware tier** (Value/Ebco, Mid, Premium/Hettich-Häfele-Blum) plus counts of drawers and
   hinges (derivable from modules);
7. an **accessories list** (nos);
8. **countertop** material and area (derived from the base run × depth);
9. a pricing convention (rft, sq ft front, or sq ft surface) with a **rate card keyed on
   (zone, carcass, finish, tier)**;
10. **appliance and fixture lines** (sink, chimney, hob, built-ins) as nos.

Optional later: a BOM/cut-list for factory export, a sheet-nesting yield, and edge-band rmt.

---

## 6. Client communication and approvals

**How it works today:**
- **WhatsApp is the operating system** of Indian interior projects. Vendor material from
  WhatsApp-API sellers describes moodboards, 3D renders, swatches and itemised quotes "living in
  the thread". Clients discuss with spouse or parents before paying, approve swatches with a reply,
  and get Friday photo updates. Site WhatsApp *groups* (client + designer + supervisor) are
  ubiquitous in practice. This is anecdotal, since no survey was found.
- Formal documents are PDFs (quotation, drawings) exported from Excel/AutoCAD and sent over
  WhatsApp/email. They are signed on paper (scan back) or accepted by a WhatsApp "OK". E-sign
  (Aadhaar eSign, DocuSign, Leegality) appears at larger firms (synthesis; not verified as common).
- Render studios gate approval in stages (camera angles and grey model → lit draft → final) to
  limit costly re-renders. Freelance render packages include 1–3 revisions.

**What clients want to see:**
- Photoreal 3D of key spaces (living, kitchen, master bedroom).
- Walkthrough video or 360° panoramas for higher budgets.
- Material samples, often physical.
- A **clear price with GST**, an exclusions list, and the brand of each line.
- During execution: progress photos and **before/after** comparisons.
- For modular: the kitchen elevation with shutter colours.

**What a portal must offer to replace WhatsApp** (synthesis from the above and from Verified
Studio's feature list, which is a direct Indian competitor):
1. **Approve by link with no login**, opened from a WhatsApp message: one tap to approve or
   request changes, with an optional OTP for binding approvals. A forced app install or account
   kills adoption.
2. **WhatsApp notifications** (Business API) for every pending approval, invoice and photo update,
   with deep links back.
3. **Versioned, locked documents.** Each approval pins quote vN / drawing vN with a timestamp,
   approver name/phone and IP. After approval, changes go only through **variation orders** that
   the client also approves. (3xDezine already has proposals and version history; extend them to
   documents.)
4. **One page per project**: renders and 3D viewer, the current BOQ with a room/trade toggle,
   payment schedule with status, invoices/receipts, site photo feed (geo/time-stamped), snag list.
5. **Pay from the milestone** (UPI/Razorpay links). Receipts auto-issued as GST receipt vouchers.
6. **Comment pinned to the thing**: a render region, a BOQ line, a drawing sheet. This is better
   than chat because feedback stays attached.
7. **Exportable evidence pack** (PDF + JSON of approvals, payments, chat-like timeline). This is
   exactly what the dispute guides tell clients to assemble by hand.
8. **Family sharing**: a second approver (spouse or parent) with view or comment rights.
9. Hindi and regional-language labels later. Mobile-first throughout.

Benchmark: Verified Studio advertises CRM, BOQ with material/labour split and markup, GST/HSN,
a client dashboard, no-login approval links, signed change orders, Razorpay milestone payments, POs
from the BOQ, and WhatsApp automation. Pricing is ₹1,499 / ₹2,999 / ₹4,999 per seat per month.
This sets the bar for "studio OS" features. 3xDezine's differentiator would be **geometry-driven
quantities plus the 3D view in the same artefact**.

---

## 7. Site measurement

**Practice:**
- Tools: 5 m steel tape (standard), a laser distance meter for room spans (common with designers
  and modular vendors), a spirit level and square for kitchens.
- The measurer records each wall separately, plus:
  - door and window positions, sill and lintel heights;
  - beams, columns, soffits, shafts;
  - ceiling height;
  - existing electrical points and DB, plumbing inlet/outlet and drain positions;
  - floor level differences;
  - photos of every wall as an as-built record.
- Modular vendors do **two measurements**: a pre-design survey, and a **final "re-measure" after
  civil, plaster and tiling** (tile + adhesive ≈ 12 mm changes runs) before releasing production.
  This re-measure is the step that protects the factory.

**Common errors:**
- Out-of-square corners. One source reports a run 30 mm shorter than recorded.
- Missed diagonals.
- Beams and soffits omitted.
- Unit confusion. Drawings are in mm, carpenters work in feet and inches, and clients think in
  feet.
- Measuring before finishes.
- Relying on builder brochure dimensions or design-tool dimensions without a site check.
- Small errors compound into "dead" space with standard module widths.
- Carpenter-built work absorbs errors on site. Factory modular cannot.

**Phone/LiDAR capture:**
- RoomScan/Polycam/Magicplan reach about 1–3 cm accuracy in normal rooms. That is good for layout,
  not for cabinet fabrication.
- They require LiDAR iPhone Pro/iPad Pro, which few Indian site staff carry. The Indian market is
  overwhelmingly Android and non-Pro iPhones.
- **Not common practice in Indian residential interiors.** No source shows mainstream adoption.
- Photo-plus-tape sketches over WhatsApp dominate.

**Product implication:** a **guided measurement mode** would fit real workflows better than LiDAR:
1. tap a wall in the 2D plan;
2. enter its tape/laser reading, or receive it from a Bluetooth laser meter (Bosch/Leica have
   SDKs);
3. mark beams, sills and points;
4. attach photos per wall;
5. flag the stage as "pre-finish" or "final re-measure";
6. diff the two surveys and warn which modular runs changed.

---

## 8. Proposed data model

TypeScript-like interfaces. These extend the existing `shared/types.ts` (`Unit = 'SQM' | 'LITER' |
'LINEAR_M' | 'EACH'`, `Material`, `CostLineItem`, `Project`, `Room`, `Wall`). Principle: **store SI
units, display trade units**, and keep every derived quantity traceable to geometry.

### 8.1 (a) Labour / trade line items

```ts
/** Trade units as quoted in India. Stored quantity is always in the SI base noted. */
export type TradeUnit =
  | 'SQFT'   // stored as m²,  displayed ×10.7639
  | 'SQM'
  | 'RFT'    // running foot; stored as m, displayed ×3.28084
  | 'RMT'    // running metre
  | 'POINT'  // electrical/plumbing point — count
  | 'NOS'    // numbers/each — count
  | 'SET'    // e.g. hardware set, CP set
  | 'CUM'    // cubic metre (civil)
  | 'KG'     // MS/steel work
  | 'ROLL'   // wallpaper
  | 'DAY'    // labour day-work
  | 'LS';    // lump sum — qty fixed at 1

export type Trade =
  | 'DEMOLITION_CIVIL' | 'WATERPROOFING' | 'FALSE_CEILING' | 'ELECTRICAL' | 'PLUMBING'
  | 'FLOORING_TILING' | 'PAINTING_WALL_FINISH' | 'CARPENTRY_CUSTOM' | 'MODULAR_KITCHEN'
  | 'WARDROBE_STORAGE' | 'GLASS_METAL' | 'LOOSE_FURNITURE' | 'SOFT_FURNISHING'
  | 'LIGHTING_FIXTURES' | 'APPLIANCES' | 'CP_SANITARY' | 'DECOR' | 'DESIGN_FEE'
  | 'PROJECT_MANAGEMENT' | 'MISC';

/** Nature of supply drives HSN vs SAC, time of supply on advances, and ITC notes. */
export type SupplyNature = 'GOODS' | 'SERVICE' | 'WORKS_CONTRACT' | 'LABOUR_ONLY';

export interface RateCardEntry {
  id: string;                    // 'FC-GYP-PLAIN'
  trade: Trade;
  description: string;           // 'Gypsum board false ceiling, plain, 12.5 mm, GI framing'
  unit: TradeUnit;
  materialRate: number;          // ₹ per unit, ex-GST
  labourRate: number;            // ₹ per unit, ex-GST
  // compositeRate is derived (material + labour) unless overridden by firm
  compositeOverride?: number;
  hsnSac: string;                // '995478' / '9954' / '9403' ...
  gstRatePct: number;            // 18 default; per HSN
  supplyNature: SupplyNature;
  makeList?: string[];           // approved brands: ['Saint-Gobain Gyproc', 'USG Boral']
  isStandard?: string;           // 'IS 2095' etc., optional
  city?: string;                 // rate card can be city-scoped
  tier?: 'BUDGET' | 'STANDARD' | 'PREMIUM' | 'LUXURY';
  wastagePct?: number;           // reuse existing wastage logic
  source?: { name: string; url?: string; asOf: string; confidence: 'LOW'|'MEDIUM'|'HIGH' };
}

/** How a quantity was obtained — the audit trail clients and contractors fight over. */
export type QuantitySource =
  | { kind: 'GEOMETRY'; ref: { roomId?: string; wallIds?: string[]; surface?: 'FLOOR'|'WALL'|'CEILING' };
      formula: string;           // 'ceilingArea(room) - cutouts' — human-readable
      deductOpenings: boolean }  // painting: deduct doors/windows? contractors differ
  | { kind: 'COUNT'; ref: { componentIds: string[] } }       // e.g. light points from placed lights
  | { kind: 'MEASURED'; surveyId: string; readingIds: string[] } // from site measurement
  | { kind: 'MANUAL'; note?: string };

export interface TradeLineItem {
  id: string;
  lineNo: string;                // '3.04' — section.sequence, stable across versions
  roomId?: string;               // null => whole-house line (e.g. DB, design fee)
  trade: Trade;
  rateCardId?: string;           // provenance; line may be overridden
  description: string;           // as printed
  spec: {
    brand?: string; model?: string; grade?: string; // 'Century Club Prime BWP 710'
    finish?: string; thicknessMm?: number; colourCode?: string;
  };
  unit: TradeUnit;
  quantityBase: number;          // in SI base (m², m, count)
  quantityDisplay: number;       // rounded in trade unit (2 dp; counts integer)
  quantitySource: QuantitySource;
  materialRate: number;          // ₹/unit ex-GST (0 for labour-only)
  labourRate: number;            // ₹/unit ex-GST
  markupPct?: number;            // internal only — never printed (The Quint 20–40% problem)
  discountPct?: number;          // printed if non-zero
  amount: number;                // derived: qtyDisplay × (material+labour) × (1+markup) × (1-disc)
  hsnSac: string;
  gstRatePct: number;
  supplyNature: SupplyNature;
  clientSupplied?: boolean;      // client buys material → only labour billed
  optional?: boolean;            // shown, excluded from total unless accepted
  inclusions?: string[];         // 'putty 2 coats, primer 1 coat, 2 finish coats'
  exclusions?: string[];         // 'light fixtures', 'cove wiring'
  variationOrderId?: string;     // set if added/changed by a VO after approval
  status?: 'QUOTED' | 'APPROVED' | 'ORDERED' | 'IN_PROGRESS' | 'DONE' | 'SNAG';
}
```

Field notes:
- `unit`/`quantityBase`/`quantityDisplay`: keep SI for the engine (3xDezine geometry is metric)
  and display trade units. Round **after** conversion: sq ft to 2 dp, POINT/NOS/SET up to an
  integer, LS = 1.
- `materialRate` + `labourRate`: always split internally, even when the document prints only the
  composite rate. This enables labour-only quotes, ITC analysis and a rate-analysis sheet.
- `quantitySource`: the differentiator. Every number links back to a wall, room or survey reading.
  `deductOpenings` captures the painting convention, which differs between contractors.
- `markupPct`: internal. The printed rate already includes it. Kept so the firm sees margin per
  line (a "profitability" view, as in Verified Studio).
- `hsnSac`/`gstRatePct`/`supplyNature`: per line because one quote mixes goods (loose furniture,
  9403), services (design, 998391) and works contracts (9954).
- `lineNo`: stable numbering so the BOQ can be cited in an agreement and in VOs.
- Electrical points can be **derived from placed light/switch components** (`COUNT`). Point types
  need sub-codes (light / fan / 6A / 16A / AC / TV / data) in `rateCardId`.

### 8.2 (b) Parametric modular kitchen / wardrobe

```ts
export type BoardMaterial =
  | 'BWP_PLY_IS710' | 'BWR_MR_PLY_IS303' | 'HDHMR' | 'MDF' | 'HDF'
  | 'PARTICLE_BOARD' | 'PRELAM_PARTICLE_BOARD' | 'WPC_PVC_BOARD' | 'SOLID_WOOD';

export type ShutterFinish =
  | 'LAMINATE_MATTE' | 'LAMINATE_GLOSS' | 'LAMINATE_ANTI_FINGERPRINT' | 'MEMBRANE'
  | 'ACRYLIC' | 'PU_MATTE' | 'PU_GLOSS' | 'VENEER' | 'GLASS_ALU_PROFILE' | 'DUCO';

export type HardwareTier = 'VALUE' | 'MID' | 'PREMIUM';   // e.g. Ebco/house | Hettich std | Blum/Hettich ArciTech/Häfele

export type ModuleKind =
  | 'BASE' | 'BASE_SINK' | 'BASE_HOB' | 'BASE_DRAWER_STACK' | 'BASE_CORNER'
  | 'WALL' | 'WALL_CORNER' | 'WALL_LIFT_UP' | 'TALL' | 'TALL_APPLIANCE' | 'LOFT'
  | 'OPEN_SHELF' | 'FILLER'
  // wardrobe
  | 'WARDROBE_HINGED' | 'WARDROBE_SLIDING' | 'WARDROBE_LOFT';

export interface ZoneSpec {             // one per zone: base / wall / tall / loft
  carcass: BoardMaterial;
  carcassThicknessMm: 16 | 17 | 18 | 19;
  backPanel: { material: BoardMaterial; thicknessMm: 6 | 8 | 9 | 12 | 18 };
  shutter: { substrate: BoardMaterial; finish: ShutterFinish; finishBrand?: string; colourCode?: string };
  edgeBandMm?: 0.8 | 1 | 2;
  handle: 'G_PROFILE' | 'J_PROFILE' | 'GOLA' | 'KNOB' | 'BAR' | 'PUSH_OPEN';
}

export interface ModuleInstance {
  id: string;
  kind: ModuleKind;
  widthMm: number;                 // 300..1200, snaps to standard set
  heightMm?: number;               // defaults by zone
  depthMm?: number;                // defaults by zone
  shutters: number;                // drives hinge count (≈2 per shutter ≤ 900 mm tall, 3–4 for tall)
  drawers: number;                 // drives channel/tandem count
  accessories: Array<{ sku: string; name: string; brand?: string; qty: number; rate: number; hsn: string }>;
  // e.g. tandem box, cutlery tray, magic corner, bottle pull-out, dustbin, thali basket
}

export interface CabinetRun {
  id: string;
  wallId: string;                  // from 3xDezine plan
  offsetStartMm: number;           // from wall start (finished-surface)
  lengthMm: number;                // run length — becomes rft
  zones: Array<'BASE' | 'WALL' | 'TALL' | 'LOFT'>;
  modules: ModuleInstance[];       // left→right; fillers absorb remainder
}

export interface ModularItem {
  id: string;
  roomId: string;
  type: 'KITCHEN' | 'WARDROBE' | 'TV_UNIT' | 'VANITY' | 'STUDY' | 'CROCKERY' | 'SHOE_RACK';
  layout?: 'STRAIGHT' | 'L' | 'U' | 'PARALLEL' | 'ISLAND' | 'PENINSULA' | 'G'; // kitchens
  runs: CabinetRun[];
  zoneSpecs: Partial<Record<'BASE' | 'WALL' | 'TALL' | 'LOFT', ZoneSpec>>;
  dims: {                          // defaults from Indian guides
    counterHeightMm: number;       // 850–900
    baseDepthMm: number;           // 560–580 carcass
    wallHeightMm: number;          // 600–720
    wallDepthMm: number;           // 300–350
    counterToWallGapMm: number;    // ≥450
    plinthMm: number;              // 100–150
    loftToCeiling: boolean;
  };
  hardwareTier: HardwareTier;
  hardwareBrand?: 'HETTICH' | 'HAFELE' | 'BLUM' | 'EBCO' | 'GODREJ' | 'OTHER';
  countertop?: { material: 'GRANITE' | 'QUARTZ' | 'SOLID_SURFACE' | 'SS' | 'NANO_WHITE';
                 thicknessMm: number; areaSqm?: number /* derived from base runs × depth */;
                 backsplash?: { heightMm: number; material: string } };
  appliances?: Array<{ kind: 'CHIMNEY' | 'HOB' | 'SINK' | 'OVEN' | 'MICROWAVE' | 'DISHWASHER' | 'RO';
                       model?: string; qty: number; rate: number; hsn: string; clientSupplied?: boolean }>;
  pricing: {
    convention: 'RFT' | 'SQFT_FRONT' | 'SQFT_SURFACE' | 'BOM';
    // rate card lookup key: (zone, carcass, finish, tier, city) → ₹/unit (composite, ex-GST)
    rateOverrides?: Partial<Record<'BASE' | 'WALL' | 'TALL' | 'LOFT', number>>;
    installationIncluded: boolean;
  };
  warrantyYears?: { carcass?: number; hardware?: number };
  surveyStage?: 'PRE_FINISH' | 'FINAL_REMEASURE';  // production gated on FINAL_REMEASURE
}
```

Field notes:
- `runs[].wallId` + `offsetStartMm` + `lengthMm`: ties the cabinetry to plan geometry. rft =
  Σ run length per zone. Front sq ft = Σ (module width × zone height). Surface sq ft follows
  Truww's two-face convention. All three conventions are derivable, so the tool can **show a
  client's competing quote basis side by side**.
- `zoneSpecs`: per zone because the dominant real spec is mixed (BWP base, MR wall, cheaper loft).
- `shutters`/`drawers`: hardware is the hidden cost driver. Counting hinges, channels and tandem
  boxes from modules makes the tier choice visible in rupees.
- `accessories`/`appliances`: always separate lines (nos) in Indian quotes. `clientSupplied`
  handles the common case where the client buys the chimney and hob.
- `surveyStage`: enforces the re-measure-before-production practice.
- `pricing.convention = 'BOM'` is the future path for factory export (cut-list). It is not needed
  for credible pricing in v1.
- Wardrobes use the same model: a single run on one wall, zones `TALL` (+ `LOFT`), and
  `WARDROBE_SLIDING` modules carrying the sliding profile cost as an accessory.

### 8.3 (c) GST-compliant quotation / invoice document

```ts
export type GstRegistration = 'REGULAR' | 'COMPOSITION' | 'UNREGISTERED';

export interface Party {
  legalName: string;
  tradeName?: string;
  address: { line1: string; line2?: string; city: string; pin: string;
             stateName: string; stateCode: string /* GST 2-digit, e.g. '29' KA, '27' MH */ };
  gstin?: string;                  // 15 chars; validated (state code prefix + PAN + checksum)
  pan?: string;
  phone?: string; email?: string;
}

export interface StudioProfile extends Party {
  gstRegistration: GstRegistration;
  aatoBand: 'UPTO_5CR' | 'ABOVE_5CR';   // HSN digits: 4 vs 6; e-invoice if > ₹5 cr
  coaRegNo?: string;               // architects; IIID membership optional
  bank?: { accountName: string; accountNo: string; ifsc: string; upiId?: string };
  defaultTerms: string[];
}

export type DocType =
  | 'QUOTATION'        // estimate; no tax liability
  | 'PROFORMA'         // payment request against milestone
  | 'RECEIPT_VOUCHER'  // Rule 50 — advance received (GST on service advances)
  | 'TAX_INVOICE'      // Rule 46
  | 'BILL_OF_SUPPLY'   // composition / exempt — no GST charged
  | 'PLAIN_INVOICE'    // unregistered supplier
  | 'CREDIT_NOTE' | 'DEBIT_NOTE' | 'REFUND_VOUCHER'
  | 'VARIATION_ORDER';

export interface TaxLine {           // one per (rate, hsnSac) bucket
  hsnSac: string;                    // truncated to 4/6 digits per aatoBand
  taxableValue: number;
  ratePct: number;                   // 18
  cgst?: number; sgst?: number;      // intra-state (rate/2 each)
  igst?: number;                     // inter-state (place of supply ≠ supplier state)
}

export interface PaymentMilestone {
  id: string;
  label: string;                     // 'Booking', 'Design sign-off / production start', 'Before dispatch', 'Handover'
  pct?: number;                      // of contract value (or)
  amount?: number;
  trigger:                           // gate on artefacts, not dates
    | { kind: 'ON_SIGNING' }
    | { kind: 'ON_APPROVAL'; documentId: string }          // e.g. GFC kitchen drawing v3
    | { kind: 'ON_STAGE'; stage: 'MATERIAL_DELIVERY' | 'PRODUCTION_START' | 'DISPATCH' | 'INSTALLATION' | 'HANDOVER' }
    | { kind: 'ON_SNAGS_CLOSED' }
    | { kind: 'ON_PROGRESS_PCT'; pct: number };            // COA-style
  dueDays?: number;                  // payable within N days of trigger
  status: 'PENDING' | 'DUE' | 'INVOICED' | 'PAID' | 'DISPUTED';
  linkedDocIds?: string[];           // proforma, receipt voucher, tax invoice
}

export interface Approval {
  by: { name: string; phone?: string; email?: string; role: 'CLIENT' | 'CO_CLIENT' | 'STUDIO' };
  method: 'PORTAL_LINK' | 'OTP' | 'AADHAAR_ESIGN' | 'WET_SIGN_SCAN' | 'WHATSAPP_CONFIRM';
  at: string;                        // ISO timestamp
  ip?: string; userAgent?: string;
  documentHash: string;              // SHA-256 of the rendered PDF/JSON — pins exact version
  comment?: string;
}

export interface QuotationDocument {
  id: string;
  projectId: string;
  docType: DocType;
  number: string;                    // ≤16 chars, unique per FY, consecutive: 'Q/26-27/0042'
  version: number;                   // v1, v2… (negotiation rounds)
  supersedes?: string;               // previous version id
  issueDate: string;
  validUntil?: string;               // quotes: typically 15–30 days (materials volatile)
  financialYear: string;             // '2026-27'
  supplier: StudioProfile;           // snapshot at issue time (immutable)
  recipient: Party;                  // GSTIN optional (B2C)
  siteAddress: Party['address'];     // property — determines place of supply for services
  placeOfSupply: { stateName: string; stateCode: string }; // derived = site state for 998391/9954
  isInterState: boolean;             // derived: supplier.stateCode !== placeOfSupply.stateCode
  reverseCharge: boolean;            // normally false
  areaBasis?: { kind: 'CARPET' | 'BUILT_UP' | 'SUPER_BUILT_UP'; sqft: number }; // state it — The Quint dispute #1
  view: 'ROOM_WISE' | 'TRADE_WISE'; // print layout; data is the same
  sections: Array<{
    id: string; title: string;       // 'Kitchen' or 'False Ceiling'
    lines: Array<TradeLineItem | { kind: 'MODULAR'; item: ModularItem; amount: number; hsnSac: string; gstRatePct: number }>;
    subtotal: number;
  }>;
  designFee?: { basis: 'PCT_OF_PROJECT' | 'PER_SQFT' | 'LUMP_SUM'; value: number; amount: number; sac: '998391' };
  contingencyPct?: number;           // shown as separate line if used
  discount?: { label: string; amount: number }; // pre-tax, reduces taxable value
  taxableValue: number;
  taxLines: TaxLine[];               // empty for BILL_OF_SUPPLY / PLAIN_INVOICE
  roundOff: number;                  // ±0.99 to whole rupee
  grandTotal: number;
  amountInWords: string;             // 'Rupees Twelve Lakh … Only' (Indian numbering)
  paymentSchedule: PaymentMilestone[];
  makeList: Array<{ category: string; brands: string[] }>; // 'Plywood: Century / Greenply BWP 710'
  inclusions: string[];
  exclusions: string[];              // mandatory section — see §4.2
  terms: string[];                   // validity, variation (VO) process & cap, warranty, cancellation/refund, jurisdiction
  compositionDeclaration?: string;   // required text on BILL_OF_SUPPLY for composition dealers
  irn?: string; qrCode?: string;     // e-invoice when aatoBand ABOVE_5CR and B2B
  attachments: Array<{ kind: 'RENDER' | 'DRAWING' | 'MOODBOARD' | 'SURVEY'; fileId: string; version: number }>;
  approvals: Approval[];
  lockedAt?: string;                 // after client approval — further change only via VARIATION_ORDER
  tdsNote?: string;                  // e.g. client deducts under 194J/194C/194M where applicable
}
```

Field notes:
- `docType`: one model, many legal documents. The studio's `gstRegistration` restricts the
  allowed types: UNREGISTERED → `PLAIN_INVOICE`; COMPOSITION → `BILL_OF_SUPPLY` with
  `compositionDeclaration`; REGULAR → `TAX_INVOICE` plus `RECEIPT_VOUCHER` for advances.
- `number`: Rule 46 requires consecutive numbering, at most 16 characters, unique per financial
  year. Use a separate series per doc type. Never reuse a number after cancellation.
- `supplier` **snapshot**: invoices must show the details as at issue, so a later change of GSTIN
  or address must not rewrite history.
- `placeOfSupply` / `isInterState`: derived from `siteAddress` for design and works services
  (IGST s.12(3)). This decides CGST + SGST vs IGST.
- `taxLines`: grouped by HSN/SAC and rate, as GSTR-1's HSN summary requires. HSN is truncated to
  4 or 6 digits by `aatoBand`.
- `areaBasis`: printing carpet vs built-up area defuses the most common per-sq-ft dispute.
- `exclusions` / `makeList`: in Indian disputes the missing exclusions list and brand-less lines
  are the root causes, so make them required fields in the UI.
- `paymentSchedule.trigger`: links money to artefacts (approved drawing, closed snags), which
  makes the milestone verifiable. Advances on service supplies auto-generate a `RECEIPT_VOUCHER`.
- `approvals[].documentHash` + `lockedAt`: the evidence trail that replaces WhatsApp screenshots.
  Post-lock edits only produce `VARIATION_ORDER` docs, which need their own approval.
- Amounts are in paise internally (integer) to avoid float drift. Print in the Indian digit
  grouping (₹12,34,567.00).

---

## 9. Feature gaps mapped to evidence (synthesis)

| Gap in 3xDezine | Evidence it matters | Suggested first cut |
|---|---|---|
| Labour/composite costing in trade units | Every Indian quote is composite sq ft / rft / point / nos | `RateCardEntry` + `TradeLineItem` with geometry-derived quantities |
| BOQ / quotation document | BOQ is the contract (Annexure A). Excel is the incumbent | Room/trade-pivot BOQ → PDF + share link. Include make list and exclusions |
| GST | 18% across the board, but doc-type, place-of-supply and advance rules are fiddly | Studio GST profile, tax lines by HSN, receipt vouchers |
| Payment milestones | The main dispute surface | Artefact-gated milestones + UPI links |
| Client approval portal | WhatsApp is incumbent. A competitor already sells no-login approvals | No-login link + WhatsApp notify + hash-pinned approvals + VOs |
| Modular kitchen/wardrobe | Largest single line in a 2BHK/3BHK budget (kitchen + wardrobes ≈ 45–50% of the execution budget in the room-wise allocations seen) | `ModularItem` on plan walls, 3 pricing conventions |
| Site measurement | Measurement errors scrap factory modules | Guided per-wall survey + re-measure diff |
| Procurement | Markup and lead-time losses | Later: PO from BOQ lines grouped by vendor |

---

## Sources

Primary / official or near-official
- IIM Shillong, NIQ for Interior Designer (stage schedule, COA-style fee stages), 30 Jul 2025 — https://www.iimshillong.ac.in/wp-content/uploads/2025/07/NIQ-for-Interior-Designing-Works.pdf
- BIS EOI quoting COA Scale of Charges (interior architecture 7.5%) — https://www.bis.gov.in/wp-content/themes/bisnew/page-templates/uploads/pdf/Tender/EOI_8.pdf
- CPWD OM on COA scale not being government-approved (2015), mirror — https://architexturez.net/node/176738
- Notification 78/2020-Central Tax (HSN digits on invoices) — https://www.gstcouncil.gov.in/sites/default/files/2024-05/notfctn-78-central-tax-english-2020.pdf
- HSN digits summary (Rule 46 proviso) — https://www.gstzen.in/?p=2202 ; https://www.taxheal.com/notification-no-78-2020-central-tax-hsn-code-in-tax-invoice-from-01-04-2021.html
- Asian Paints Royale Basecoat product sheet — https://static.asianpaints.com/content/dam/ap-np-revamp/products/pis/royale-basecoat-pis-final.pdf

GST / tax commentary
- BUSY, GST on interior work (998391 / 9954 / 9987 / 9403, 18%) — https://busy.in/gst-rates/interior-work
- BUSY, SAC 998391 — https://busy.in/sac-code-998391/ ; SAC 995476 carpentry — https://busy.in/sac-code-995476/ ; SAC 995473 painting — https://busy.in/sac-code-995473
- TaxTMI forum (9954 for execution with material; IGST Mumbai case) — https://www.taxtmi.com/forum/issue?id=118909
- TaxBuddy, GST for architects & interior designers — https://www.taxbuddy.com/blog/gst-filing-architects-interior-designers-taxbuddy
- Tally, plywood HSN 4412 and 28%→18% — https://tallysolutions.com/gst/plywood-hsn-code-gst-rate-classification-invoicing-guide-for-businesses/
- Bajaj Finserv, GST on furniture — https://www.bajajfinserv.in/gst-on-furniture ; Razorpay — https://razorpay.com/learn/gst-rate-on-furniture/ ; Axis Bank — https://www.axis.bank.in/blogs/taxation/gst-on-furniture
- Composition scheme for services — https://busy.in/gst/gst-composition-scheme-for-service-providers ; https://www.mastersindia.co/gst/gst-composition-scheme-for-service-providers/
- Registration thresholds — https://www.kanakkupillai.com/learn/new-gst-registration-threshold-limit-for-services/
- Section 194M — https://www.taxheal.com/?p=81550 ; https://groww.in/blog/what-is-section-194m-of-income-tax-act

BOQ / rates
- BOQ explained (8-column structure, Annexure A, VO cap) — https://www.studiomatrx.org/guides/boq-explained-india
- BOQ templates (8 trade sections, units, GST formulas) — https://constructionestimatorindia.com/?p=10630 ; https://constructionestimatorindia.com/?p=8470
- The Quint / Interiors by Dex, hidden costs (sponsored), 3 Jul 2026 — https://www.thequint.com/brandstudio/partner-hidden-costs-home-interior-quotes
- DesignCafe false ceiling cost 2026 — https://www.designcafe.com/blog/home-interiors/false-ceiling-cost/ ; Bengaluru — https://www.designcafe.com/blog/home-interiors/false-ceiling-cost-bangalore/
- AECORD gypsum ceiling — https://aecord.com/blog/gypsum-false-ceiling-cost-per-sq-ft-india-2026-2
- Comaron false ceiling city table — https://www.comaron.com/blog/false-ceiling-cost-per-sq-ft-india-2026-pop-gypsum-pvc-rate-guide
- Infralens rate analyses: POP ceiling — https://infralens.in/rate-analysis/pop-false-ceiling ; premium emulsion — https://infralens.in/rate-analysis/premium-emulsion-interior ; point wiring — https://infralens.in/rate-analysis/point-wiring ; 16A point — https://infralens.in/rate-analysis/power-point-16a ; wardrobe shutter — https://infralens.in/rate-analysis/wardrobe-shutter-laminate ; labour — https://infralens.in/prices/labour
- Painting: housegyan — https://www.housegyan.com/blog/what-is-the-cost-of-painting-your-home-per-sq-ft-in-2026 ; aapkapainter Chennai — https://aapkapainter.com/blog/painting-cost-per-sq-ft-in-chennai-labour-material-rates-explained-2026/
- Electrical per point — https://constructionestimatorindia.com/?p=9009
- Flooring labour — https://www.studiomatrx.org/guides/flooring-labour-cost-india ; https://www.studiomatrx.org/guides/flooring-cost-bangalore
- Design fees — https://www.houseyog.com/blog/how-much-does-an-interior-designer-charge-in-india/ ; https://constructionestimatorindia.com/?p=17098 ; https://www.interiorcompany.com/in/trends/interior-design-cost-in-delhi
- Design quotation generator (fee models, add-ons, 30/30/30/10) — https://www.studiomatrx.org/for-designers/quotation-generator

Modular
- Truww, cost of modular kitchen in Bangalore (2021) — https://truww.com/Guides/Cost_of_Modular_Kitchen_in_Bangalore ; woodwork costing — https://truww.com/Guides/A%20brief%20guide%20to%20woodwork%20costing%20in%20bangalore
- LiveHomes Chennai 2026 (rft rates) — https://www.livehomes.in/blog-details/Modular-Kitchen-Cost-in-Chennai-2026:-Complete-Price-Guide-&-Designs
- HomeLane kitchen size / costs — https://www.homelane.com/design-ideas/modular-kitchen-design/standard-kitchen-size/
- NoBroker forum, quartz kitchen cost — https://www.nobroker.in/forum/how-much-does-a-modular-kitchen-with-quartz-countertop-cost/ ; acrylic vs laminate — https://www.nobroker.in/interiors/design-guides/acrylic-vs-laminate-for-kitchen/
- Asian Paints Beautiful Homes, shutter finishes — https://www.beautifulhomes.asianpaints.com/blogs/kitchen-shutter-finishes-compared ; dimensions — https://www.beautifulhomes.asianpaints.com/interior-design-services/blogs/standard-modular-kitchen-design-dimensions-and-measurements.html
- Studio Matrx modular guide (dimensions) — https://www.studiomatrx.org/guides/modular-kitchen-guide ; budget kitchen — https://www.studiomatrx.org/guides/budget-modular-kitchen-planning-india ; wardrobe cost — https://www.studiomatrx.org/guides/wardrobe-cost-guide-india
- Hettich India blog — https://web.hettich.com/en-in/inspiration/blogs/creating-the-heart-of-your-home-essential-factors-to-consider-when-setting-up-a-modular-kitchen-in-india
- Hardware listings: https://m.indiamart.com/decomart/tandem-box.html ; https://m.indiamart.com/decomart/soft-closing-telescopic-drawer-channels.html ; https://m.indiamart.com/hardware-town/door-hinges.html ; brand tiers — https://www.housegyan.com/blog/top-best-kitchen-hardware-brands-in-india-2026

Payments, disputes, communication, tools
- Livspace SG schedule — https://www.edgeprop.sg/property-news/livspace-offers-one-stop-platform-home-renovations
- Livspace India booking terms (third party) — https://dwello.in/home-interior-deals
- Livspace × Razorpay — https://razorpay.com/blog/livspace-and-razorpay/
- HomeLane complaint — https://voxya.com/consumer-complaints/payment-issue-/262050
- Advance-recovery guide (payment norms, WhatsApp evidence), Sep 2026 — https://righttoinformation.wiki/interior-designer-contractor-advance-refund-india
- Consumer cases — https://www.consumercomplaints.in/livspace-complaint-against-livspace-non-execution-of-interior-project-and-non-refund-of-advance-payment-c3542860 ; https://www.lawyersclubindia.com/experts/interior-company-got-advance-but-service-not-provided-730696.asp
- Mumbai unfinished-interiors report — https://propnewstime.com/latestnewsstories/MzIxMDI=/mumbai-luxury-homeowners-say-they-paid-crores-for-interiors-but-projects-were-left-unfinished
- WhatsApp for interior designers (vendor) — https://richautomate.in/use-cases/whatsapp-for-interior-designers-in-bangalore-india-2026 ; https://doubletick.io/blog/how-interior-designers-can-use-whatsapp-business-api-for-project-visualization-and-client-feedback
- Staged render approvals (Blue Ribbon 3D) — https://www.cadcrowd.com/profile/277441-blueribbon3ds
- Fragmented tooling in Indian studios — https://www.nemetschek.in/blogs/why-interior-design-architects-india-are-turning-vectorworks
- Verified Studio (competitor features & pricing) — https://interiors-vre.centralindia.cloudapp.azure.com/verified-studio
- Other Indian tools — https://www.goodfirms.co/software/zygn ; https://www.capterra.in/software/1108244/InterioHUB
- Job descriptions (site measurement, scope note, GFC revision control) — https://www.talentmate.com/jobs/india/india/interior-designer/2609-7465-601 ; https://jobs.weekday.works/metro-buildtech-interior-designer

Measurement
- Studio Matrx room measurement worksheet — https://www.studiomatrx.org/utilities/room-measurement
- Diotti kitchen survey guide (tools, final survey after plaster) — https://www.diotti.com/en/kitchens/design-your-modular-kitchen/measurements-survey/complete-guide
- Measuring tape buying guide (India) — https://knowledge.digirake.com/buying-guide/best-measuring-tape-india
- RoomScan Pro review (1–3 cm) — https://illustrarch.com/articles/design-softwares/110334-roomscan-pro-review.html
- Polycam accuracy / floorplan mode — https://learn.poly.cam/hc/en-us/articles/27488763119892 ; https://learn.poly.cam/hc/en-us/articles/30299187161620-How-to-Create-Floorplan-Captures

---

## Unverified / needs confirmation

1. **SAC sub-codes 995471/995472/995474/995475/995478** (glazing, plastering, tiling, other floor
   and wall finishing, other completion works). Only 995473 (painting) and 995476 (carpentry) were
   confirmed. Check the CBIC SAC list before hard-coding. **"995472" from the brief could not be
   confirmed as interior works**; it is likely plastering. Use 9954 or a confirmed 99547x code.
2. The notification entry for works contracts at 18% (Notification 11/2017-CTR, entry 3(xii)) and
   the ITC block under s.17(5)(c)/(d) for business clients' fit-outs. Cited from memory.
3. Notification 66/2017-CT exempting GST on *goods* advances. From memory.
4. The e-invoicing threshold of ₹5 crore AATO (from 1 Aug 2023), and any 2025–26 change.
5. The Rule 46 ₹50,000 threshold for printing an unregistered recipient's address. From memory.
6. Whether the services composition rate is still 6% and the cap still ₹50 L in FY 2026-27.
7. Section renumbering of 194C/194J/194M under the Income-tax Act 2025 (effective 1 Apr 2026).
8. The **10 / 50 / 35 / 5** modular payment split. Not found for any named firm (HomeLane and
   Livspace India terms could not be confirmed from official pages).
9. The prevalence of WhatsApp groups, e-sign and laser meters among Indian designers. Strongly
   suggested by vendor material and practice, but no survey found. **Primary user interviews are
   recommended** (5–10 studios across 2 cities).
10. All per-unit rates in §2.3. These are vendor and blog figures with wide disagreement (electrical
    per point varies about 2×). Studio Matrx figures are uncorroborated where marked. Truww kitchen
    figures date from 2021.
11. Carcass thicknesses, back-panel norms and edge-band thickness (§5.1) are trade convention, not
    confirmed by a cited source. Module width set likewise.
12. IIID fee guidance. None found online.
13. The share of kitchen + wardrobes in the budget (≈ 45–50%) is derived from one generator's
    room-wise weights (25% kitchen + 23% wardrobes) and one BOQ sample. Indicative only.
