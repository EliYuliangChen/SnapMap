# Culvert Risk-Rank ML Project — Process, Outputs, and Operating Model

**Purpose**: Provide a shared, unambiguous description of the **process**, **outputs**, and **operating model** for the ML project that produces a **risk-rank** to help the **Inspection Team** decide which culverts to inspect first.

---

## 1) What the model is ranking (risk meaning)

The model estimates the likelihood that a culvert location has **risk-relevant conditions**, primarily:

- **Erosion**: outlet/riverbed scour that lowers the bed/ground surface.
- **Blockage**: internal culvert obstruction (branches/debris/etc.).

Why it matters:
- During heavy rain / flood seasons, these conditions can increase **washout risk**, **movement disruption (rig access)**, and **fish passage barriers**.

---

## 2) Inputs & data environment (Databricks)

### Data sources
- **Roads & Rivers/Streams**: accessed from **Oracle** via Databricks connectors.
- **Inspection history**: stored as **SHP** in a Databricks **Volume** (contains historical erosion/blockage outcomes).
- **DEM**: Cloud-Optimized GeoTIFF (**COG**) DEM tiles
  - 105 DEM tiles split by a grid + a `grid.shp` index.
  - At runtime, pick the tile(s) based on the culvert location to reduce I/O and speed processing.

### Standardization step
- Convert roads/rivers into **Delta tables** for repeatable joins/network logic.

---

## 3) Labeling & feature engineering (how the training table is built)

**Core idea**: use historical inspection points as training anchors.

For each historical inspection point, the labeling pipeline computes a feature set that includes multiple parameter variants (e.g., 100m/200m neighborhoods, multiple rainfall scenarios).

### Four key factors (features)
1. **Inlet–Outlet elevation difference**
   - Large difference suggests the outlet bed is lower (erosion) and fish passage is harder.
2. **Nearby history within radius R** (e.g., 100m / 200m)
   - If nearby inspected points show erosion/blockage, local conditions are likely similar.
3. **Upstream/Downstream culverts on the same stream network**
   - Similar geomorphology/climate/vegetation along the same drainage corridor.
4. **Flood / watershed accumulation under rainfall scenarios**
   - Modeled flow volume at the culvert point; exceeding thresholds increases washout likelihood.

### Output of this stage
- A **single, versioned** Delta table that contains **labels + engineered features**:
  - `labeled_culvert_training_delta`

---

## 4) Training & validation (what “good” means)

### What the model optimizes for
The project is **precision-first**:

- If the model flags **High Risk**, we want **≥90%** of those flagged sites to truly have risk (erosion/blockage/washout indicators) based on ground truth and validation.
- **Recall may be lower** (some risky culverts might not be flagged), because the inspection program is capacity-limited and false alarms are costly.

This is controlled by:
- Choice of algorithm + features
- Probability thresholds and/or risk buckets (High/Medium/Low)
- Validation strategy (time split, spatial split, or standard CV depending on data availability)

### Outputs of this stage
- A trained model artifact (registered + versioned)
- An evaluation report (precision/recall, PR curve, chosen operating thresholds)

---

## 5) Scoring / inference (how results are produced for users)

### Candidate generation
We assume **every road–river intersection has a culvert**.

1) Create a dataset of **road–river intersection points**.
2) Run the trained model to score each point.

### Two scoring modes
- **Batch scoring (typical)**: run once for *all* intersections.
  - Re-run only if you build/buy new roads or obtain more detailed river/stream data.
- **Ad-hoc scoring (as needed)**: if users have inspection-list points that are not captured by intersections.
  - Expected frequency: **10–20 runs per year**.

### Output of this stage
- `scored_culverts_delta`: candidate points + features + risk score + risk rank + risk bucket

---

## 6) Annual improvement loop (model evolution)

Each year:
1) Collect the year’s new inspection outcomes.
2) Append/refresh the inspection history and rebuild labels.
3) Retrain/refine the model (new version).
4) Re-score candidates as needed.

---

## 7) End-to-end flowchart (Mermaid)

```mermaid
flowchart LR
    A[Data Sources
Oracle: Roads/Rivers
Volume: Inspection SHP
COG DEM tiles + grid index] --> B[Standardize
Convert to Delta tables]
    B --> C[Label & Feature Engineering
F1 elev diff
F2 neighborhood history
F3 upstream/downstream
F4 flood accumulation]
    C --> D[Labeled Training Delta Table
(versioned)]
    D --> E[Train & Validate
precision-first]
    E --> F[Registered Model
(versioned)]
    F --> G[Scoring
Batch intersections + Ad-hoc points]
    G --> H[Risk Rank Output
Delta table + map/list]
    H --> I[Inspection Planning]
    I --> J[New Inspection Results]
    J -. annual feedback .-> C
```

---

## 8) Swimlane view (Who does what)

```mermaid
flowchart TB
  subgraph Data_Platform[Data Platform / Databricks]
    A1[Connect to Oracle
Roads/Rivers] --> A2[roads_delta / rivers_delta]
    A3[Load Inspection SHP
from Volume] --> A4[history_points]
    A5[Select DEM tile(s)
by grid] --> A6[DEM sampling]
  end

  subgraph ML_Pipeline[ML Pipeline]
    B1[Label + Feature build] --> B2[labeled_culvert_training_delta]
    B2 --> B3[Train/Validate + thresholding]
    B3 --> B4[Model Registry
(versioned)]
  end

  subgraph Operations[Operations / Users]
    C1[Batch score intersections] --> C2[scored_culverts_delta]
    C3[Ad-hoc score user points] --> C2
    C2 --> C4[Risk rank list/map
for planning]
    C4 --> C5[Field inspections]
    C5 --> C6[New results] --> B1
  end

  A2 --> B1
  A4 --> B1
  A6 --> B1
  B4 --> C1
  B4 --> C3
```

---

## 9) Common misconceptions to address (talking points)

1. **“The model runs constantly”** → No. The *full batch scoring* is typically a **one-time** run per major data change.
2. **“If the model says low risk, it’s safe”** → Not necessarily. The design prioritizes **high precision for high-risk flags**, not a guarantee of safety when low-risk.
3. **“Labels are the same as features”** → Labels come from inspection outcomes; features are engineered signals (elevation diff, neighborhood context, flood accumulation, etc.).
4. **“DEM loading is heavy”** → The tiled COG approach + grid index allows **tile-level** loading for speed.

---

## 10) What to hand over (checklist)

- ✅ Diagram + narrative (this doc)
- ✅ Delta tables created and their schemas
- ✅ Notebooks/jobs: labeling, training, scoring
- ✅ Model versioning + evaluation report (precision target + chosen threshold)
- ✅ Scored output table for planning (ranked list) + optional map layer

