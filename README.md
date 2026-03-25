# Oil & Gasoline Price Expectations Calculator

A Monte Carlo simulation tool for forecasting WTI crude oil and retail gasoline prices over user-defined horizons. Eight stochastic process models, a nine-factor macroeconomic environment module, twelve calibrated historical oil shock scenarios, live price fetching, model comparison, and risk analytics — all running in the browser with no server required.

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [User Guide](#user-guide)
   - [Live Price Fetch](#live-price-fetch)
   - [Sidebar: Parameters Tab](#sidebar-parameters-tab)
     - [WTI Spot Price](#wti-spot-price)
     - [Forecast Parameters](#forecast-parameters)
     - [Model Selection](#model-selection)
     - [Model-Specific Parameters](#model-specific-parameters)
     - [Economic Environment (Macro Sliders)](#economic-environment-macro-sliders)
     - [Seasonal Adjustment](#seasonal-adjustment)
   - [Sidebar: Scenarios Tab](#sidebar-scenarios-tab)
   - [Sidebar: Compare Tab](#sidebar-compare-tab)
   - [Chart Tabs](#chart-tabs)
   - [Statistics Panel](#statistics-panel)
   - [CSV Export](#csv-export)
3. [Theory](#theory)
   - [Simulation Architecture](#simulation-architecture)
   - [The Eight Models](#the-eight-models)
   - [Macro Factor Module](#macro-factor-module)
   - [VIX Integration (Three Channels)](#vix-integration-three-channels)
   - [Gasoline Conversion](#gasoline-conversion)
4. [Historical Scenarios — Full Parameter Tables](#historical-scenarios--full-parameter-tables)
5. [Model Comparison Mode](#model-comparison-mode)
6. [Risk Analytics](#risk-analytics)
7. [Limitations and Caveats](#limitations-and-caveats)
8. [References](#references)

---

## Quick Start

1. Click **↻ Live Price** to populate WTI spot and VIX from Yahoo Finance.
2. Set your **Horizon** (1–24 months).
3. Choose a **Model** — GBM is the baseline; Jump-Diffusion is best for shock scenarios.
4. Adjust **macro sliders** to reflect your view of the current environment.
5. Results update automatically within ~350 ms.

---

## User Guide

### Live Price Fetch

The **↻ Live Price** button (top of the Parameters tab, above the spot price input) fetches two data points simultaneously from Yahoo Finance via a public CORS proxy:

| Ticker | Data | Populated Field |
|---|---|---|
| `CL=F` | WTI front-month futures (USD/bbl) | WTI Spot Price input |
| `^VIX` | CBOE VIX implied volatility index | VIX macro slider |

**Button states:** amber `↻ Live Price` → spinning `Fetching…` → green `✓ Updated` (with timestamp) or red `✕ Failed` (auto-resets after 4 s).

**Caveat:** Yahoo Finance returns the last traded price. Outside market hours (22:00–09:30 ET weekdays, all weekend), this is the prior session close. For TV or presentation use this is generally the relevant reference price.

---

### Sidebar: Parameters Tab

#### WTI Spot Price

Enter the current WTI front-month price in USD per barrel. The implied retail gasoline price ($/gal) updates immediately below the field using the 3-2-1 crack spread formula. You can type any value in the range $10–$300, or use the Live Price button.

---

#### Forecast Parameters

| Slider | Range | Step | What it controls |
|---|---|---|---|
| **Horizon** | 1–24 months | 1 month | Terminal date for all statistics, fan chart, and histogram |
| **Annual Drift (μ)** | −40% to +40% | 0.5% | Unconditional expected log-return *before* macro adjustments. This is the base growth rate you believe oil has absent any macro headwinds or tailwinds. At μ = 0 with zero macro adjustments, the median path stays near the spot price. |
| **Annual Volatility (σ)** | 8%–100% | 1% | Base annualised return volatility. Historical WTI realised vol is typically 35–45%. This is further scaled up by the Geopolitical Risk and VIX sliders. |

**Practical guidance on drift:** Set μ to your view of the structural supply-demand balance. A balanced market with no major policy changes warrants μ ≈ 0–3%. Strong OPEC discipline with tightening supply might justify +5–8%. Shale overhang or recession risk might justify −5 to −10%.

---

#### Model Selection

Eight models available as toggle buttons. The active model is highlighted in amber. Model-specific parameter sliders appear dynamically below the selector.

| Button | Full Name | Best for |
|---|---|---|
| **GBM** | Geometric Brownian Motion | Baseline; option pricing; model comparison anchor |
| **Mean-Rev** | Schwartz Mean-Reversion | Long-run equilibrium forecasts; structural supply-demand balance |
| **Jump-Diff** | Merton Jump-Diffusion | Shock scenarios; geopolitical disruptions; fat-tail risk |
| **Regime-Sw** | Hamilton Regime-Switching | Cyclical turning points; multi-modal uncertainty |
| **Futures** | Futures-Implied Forward Curve | Derivatives pricing; market-neutral baseline |
| **Heston** | Heston Stochastic Volatility | Post-shock vol normalisation; options surface calibration |
| **SS2-Factor** | Schwartz-Smith Two-Factor | Best empirical fit at 3–24 month horizons |
| **Var-Gamma** | Variance-Gamma | Tail-asymmetric risk; skewness-sensitive applications |

---

#### Model-Specific Parameters

Each model exposes parameters that only appear when that model is selected.

---

**Mean-Reversion (OU) Parameters**

| Slider | Range | Step | Interpretation |
|---|---|---|---|
| **Reversion Speed (κ)** | 0.05–3.0 | 0.05 | Speed at which log-price returns to the long-run mean. Half-life (in months) = ln(2)/κ × 12. κ = 0.45 → half-life ≈ 18 months. κ = 2.0 → half-life ≈ 4 months. Higher κ means prices snap back faster after shocks. |
| **Long-Run Mean (θ)** | $20–$200 | $1 | The equilibrium price level toward which the process reverts. Set this to your estimate of long-run marginal cost of production (currently ~$55–$70 for a supply-weighted global average). Prices far above θ will mean-revert downward; prices far below will revert upward. |

---

**Jump-Diffusion Parameters**

| Slider | Range | Step | Interpretation |
|---|---|---|---|
| **Jump Frequency (λ)** | 0–24/yr | 0.5 | Expected number of price jumps per year. λ = 4 means roughly one jump per quarter on average. Historical WTI has experienced 3–6 economically significant jumps per year. This is further amplified by Geo-Risk and VIX sliders. |
| **Mean Jump Size** | −50% to +50% | 1% | Average log-return of each jump. Negative = supply glut/demand collapse shocks dominate (e.g., COVID, 2008). Positive = supply disruption shocks dominate (e.g., 1973, Gulf War). Most historical periods have a negative mean jump due to demand shock asymmetry. |
| **Jump Volatility** | 1%–60% | 1% | Standard deviation of jump sizes around the mean. Higher values produce more dispersed, unpredictable shocks. A tight distribution (5–10%) models shocks of consistent size; a wide distribution (20–30%) models highly variable shock magnitudes. |

---

**Futures-Implied Forward Curve Parameter**

| Slider | Range | Step | Interpretation |
|---|---|---|---|
| **Backwardation(+)/Contango(−)** | −30% to +30%/yr | 1% | The annualised slope of the WTI futures term structure, which enters as a convenience yield. **Backwardation (positive):** near-month prices exceed far-month (typical when supply is tight; historically +7–12%/yr for WTI). A long futures position rolls up the curve, adding to returns. **Contango (negative):** near-month below far-month (typical during oversupply; e.g., −22% during 2014–16 OPEC glut, −30% during COVID). A long position rolls down, subtracting from returns. |

---

**Heston Stochastic Volatility Parameters**

| Slider | Range | Step | Interpretation |
|---|---|---|---|
| **Initial Variance (V₀)** | 0.01–0.80 | 0.01 | Starting value of the instantaneous variance process. The display shows the equivalent annualised volatility σ = √V₀. Set to the current OVX (CBOE Crude Oil VIX) implied vol squared. OVX ≈ 38% → V₀ ≈ 0.14. |
| **Long-Run Variance (θᵥ)** | 0.01–0.80 | 0.01 | The variance level to which the process mean-reverts. Set to your long-run vol expectation squared. Using the same value as V₀ produces stationary vol. If current vol is elevated, set θᵥ lower to model normalisation. |
| **Vol-of-Vol (σᵥ)** | 0.05–1.50 | 0.05 | The volatility of the variance process itself. Higher values produce more dramatic vol clustering and fatter tails. Calibrated values for oil typically range 0.30–0.60. Very high σᵥ (>1.0) can cause the Feller condition (2κθ > σᵥ²) to fail, increasing the frequency of variance touching zero; the full-truncation scheme handles this numerically. |
| **Price-Vol Correlation (ρ)** | −0.99 to +0.99 | 0.01 | Correlation between the Brownian motions driving price and variance. Negative ρ (leverage effect) means rising prices are accompanied by falling vol, and price drops are amplified by rising vol — the typical oil market pattern. Equity markets have ρ ≈ −0.7; oil is typically milder at −0.4 to −0.6. |

**Note:** The mean-reversion speed κᵥ is fixed internally at 2.0 (monthly vol half-life ≈ 4 months). Modify in source code if needed.

---

**Schwartz-Smith Two-Factor Parameters**

| Slider | Range | Step | Interpretation |
|---|---|---|---|
| **Short-Run Rev. Speed (κ_χ)** | 0.1–8.0 | 0.1 | Reversion speed of the short-run (storage/transient) factor. Half-life = ln(2)/κ_χ × 12 months. Higher values mean transient shocks dissipate quickly. SS&2000 calibrated κ_χ ≈ 1.5–4.0 for crude oil (half-life 2–6 months). |
| **Short-Run Vol (σ_χ)** | 1%–80% | 1% | Volatility of the short-run factor. Captures storage cost and transient supply-demand fluctuations. Historically ~20–35% annualised for WTI short-run moves. |
| **Long-Run Vol (σ_ξ)** | 1%–60% | 1% | Volatility of the long-run equilibrium factor. Captures permanent shifts in production costs, technology, or demand structure. Much smaller than short-run vol; historically ~10–18%. |
| **Factor Correlation (ρ)** | −0.99 to +0.99 | 0.01 | Correlation between short-run and long-run shocks. Positive correlation (ρ > 0) means supply disruptions simultaneously push up both transient and structural prices, amplifying total vol. SS&2000 found ρ ≈ 0.30 for crude. |

---

**Variance-Gamma Parameters**

| Slider | Range | Step | Interpretation |
|---|---|---|---|
| **Variance Rate (ν)** | 0.01–1.00 | 0.01 | Controls excess kurtosis (fat-tailedness). Theoretically, VG excess kurtosis = 3ν. ν = 0 recovers GBM (no extra tails). ν = 0.20 gives excess kurtosis ≈ 0.60. ν = 1.00 gives very fat tails. Typical equity calibrations use ν ≈ 0.10–0.25; oil may warrant slightly higher values due to supply shock risk. |
| **Skewness Param (θ_VG)** | −0.50 to +0.20 | 0.01 | Controls the skewness of the return distribution. Negative θ produces left-skewed returns (more probability mass in the left tail — crash-prone). Zero gives a symmetric distribution. Oil markets exhibit persistent negative skew due to demand destruction episodes; typical calibrated range is −0.05 to −0.20. At θ = −0.10, ν = 0.20: theoretical skewness ≈ −0.45. |

---

#### Economic Environment (Macro Sliders)

All nine sliders adjust the effective drift μ_eff and/or volatility σ_eff applied across all models. The bottom of the Parameters panel always shows the current **Effective Drift** and **Effective Volatility** after all adjustments.

| Slider | Range | Step | β coefficient | What it models |
|---|---|---|---|---|
| **VIX** | 9–80 | 1 | *Three channels — see below* | CBOE VIX implied volatility index. Neutral level = 20. Above 20, all three channels activate simultaneously: vol scaling, jump amplification, and demand-fear drift suppression. |
| **Fed Rate Change** | −300 to +500 bps | 25 bps | −0.35 per 100 bps | Expected or realised Fed Funds rate change. Models the oil-dollar channel: rate hikes strengthen the USD, which reduces oil demand from non-dollar buyers. −300 bps (emergency cuts) → +10.5% drift boost. +500 bps (Volcker-style tightening) → −17.5% drift penalty. |
| **DXY Change** | −20% to +25% | 0.5% | −0.90 per 1% | Percentage change in the US Dollar Index. This is the *direct* dollar-oil link, separate from the Fed channel. A 10% DXY appreciation → −9% oil drift. Use one of Fed Rate or DXY to avoid double-counting; DXY is more direct. |
| **Real Interest Rate** | −4% to +12% | 0.25% | −0.28 per 1% | The ex-ante real interest rate (nominal rate minus inflation expectations). Models the opportunity cost of holding physical commodities vs. financial assets. Negative real rates (as in 2020–21) reduce this cost, supporting oil prices. |
| **Inflation Expectations** | 0%–15% | 0.25% | +0.35 per 1% | Breakeven inflation or survey-based inflation expectations. Models the commodity-as-inflation-hedge demand: investors rotate into oil when they expect purchasing power erosion. 5% inflation expectations → +1.75% drift. |
| **Equity Market Trend** | −50% to +50% | 1% | +0.42 per 1% | Expected or recent SPX return. Captures the risk-on/risk-off transmission: broad equity sell-offs reduce industrial activity expectations and oil demand. A −30% equity bear market → −12.6% drift penalty. |
| **EIA Inventory Deviation** | −150 to +250 Mb | 5 Mb | −0.08 per 100 Mb | Deviation of US commercial crude inventories from the 5-year seasonal average, in million barrels (Mb). The EIA reports this weekly. A surplus of +100 Mb (as in mid-2020) → −8% drift. A deficit of −50 Mb (tight market) → +4% drift. |
| **Geopolitical Risk Index** | 0–10 | 0.5 | Drift: +0.065 per unit; Vol: ×(1 + 0.055×G); λ: ×(1 + 0.18×G) | Composite geopolitical risk score (calibrated loosely to Caldara-Iacoviello GPR index rescaled 0–10). Affects drift, vol, and jump intensity simultaneously. At G = 10: drift +6.5%, vol +55%, jump frequency +180%. |
| **OPEC Supply Tightness** | 0–10 | 0.5 | +0.055 per unit | OPEC+ compliance and supply discipline. 0 = full quota breakdown / price war (e.g., 2020 Saudi-Russia episode). 10 = maximum coordination and deep cuts (e.g., post-COVID 2021). At tightness = 8: +4.4% drift. |

**VIX three-channel breakdown:**

| Channel | Formula | At VIX=50 |
|---|---|---|
| Vol scaling | σ_eff × (1 + (VIX−20)/10 × 0.08) | σ × 1.24 (+24%) |
| Jump intensity | λ × (VIX/20)^1.4 | λ × 3.00 (+200%) |
| Drift suppression | Δμ = −(VIX−20) × 0.018/yr | −0.54/yr (−54%) |

---

#### Seasonal Adjustment

| Control | Type | What it does |
|---|---|---|
| **Toggle** | On/Off switch | Adds a deterministic sinusoidal drift component to all models: A·sin(2π·t/12)·dt per sub-step. When off, drift is constant throughout the horizon. |
| **Amplitude** | 1–20%/yr | The peak-to-trough annual swing of the seasonal component. At ±4%/yr (default), prices rise ~4% above their trend in winter and fall ~4% below in spring. Historical seasonal patterns in WTI are ≈ ±5–8%/yr. |
| **Start Month** | Jan–Dec | The calendar month at which the forecast begins. This sets the phase of the sine wave. Starting in January means the wave peaks around February (heating demand) and troughs around April–May. Starting in July means the trough arrives first (post-summer driving season lull). |

---

### Sidebar: Scenarios Tab

Twelve historical oil shock scenarios, each pre-calibrated with macro parameters drawn from conditions prevailing at that episode. Click any card to load all parameters into the simulator; your current settings are replaced entirely. The model selection from the scenario card is also loaded. An **✓ Active** badge confirms which scenario is running.

**What each scenario loads:** See [Historical Scenarios — Full Parameter Tables](#historical-scenarios--full-parameter-tables) for the exact slider values applied by each scenario.

---

### Sidebar: Compare Tab

**Model Comparison Selection** — Coloured checkboxes toggle which models appear in the Comparison chart tab. Each model is assigned a fixed colour (see [Model Comparison Mode](#model-comparison-mode)). All selected models share the current macro environment parameters. Comparison runs 400 paths per model (vs. 800 for the main simulation) for performance.

**Price Target** — Enter a WTI price (e.g., 90) to compute breach probabilities in the Risk tab. The target applies to the main simulation (800 paths), not the comparison runs.

---

### Chart Tabs

| Tab | What you see | Key interactions |
|---|---|---|
| **Fan Chart** | Percentile fan: outer 5–95% band (faint amber), inner 25–75% band (solid amber), median line, blue dashed spot reference. | Hover anywhere on the chart to see all percentile values for that month. Use ↓ CSV to export. |
| **Distribution** | Histogram of terminal prices (Month T). Red bars = crash zone (below −20%), amber = neutral, green = rally zone (above +20%). | Hover any bar for exact price midpoint and frequency. Median and spot marked with dashed lines. |
| **Gasoline** | Implied retail gasoline price ($/gal) at six percentile points. Full price decomposition table below. | Useful for translating WTI forecasts to consumer pump price implications. |
| **Comparison** | Overlaid median paths for all selected models. Comparison statistics table below (Median, Mean, P5, P95, Crash%, Rally% per model). | Toggle models in the Compare sidebar tab. The table re-runs mini-sims for the table — slight variation from the chart is normal (sampling noise). |
| **Risk** | Three sub-panels: price target breach probabilities, full risk metrics table (CVaR 5%/10%, VaR, P90, skewness, kurtosis), historical stress test. | Enter a target in the Compare tab to update the breach probability panel. |

---

### Statistics Panel

Eight statistics always shown above the chart:

| Statistic | Definition | When to watch it |
|---|---|---|
| **Mean** | Arithmetic mean of all 800 terminal prices | Compare to Median: if Mean >> Median, the distribution is right-skewed (a few very high price paths pulling the average up) |
| **Median** | 50th percentile of terminal prices | The central tendency of the distribution; less sensitive to extreme tails than Mean |
| **90% CI** | 5th–95th percentile interval | The range containing 90% of simulated outcomes |
| **CVaR 5%** | Average of the worst 5% of outcomes (Expected Shortfall) | The expected price *if* you end up in the left tail — relevant for hedging decisions and downside risk quantification |
| **P(Bullish)** | Fraction of paths ending above current spot | >50% means the model assigns more than even odds to a price increase over the horizon |
| **Crash Risk** | P(terminal price < 0.80 × spot) | Probability of a −20%+ decline |
| **Rally** | P(terminal price > 1.20 × spot) | Probability of a +20%+ gain |
| **Skewness** | Third standardised moment of terminal prices | Negative = left-skewed (crash-prone); Positive = right-skewed (spike-prone). Jump-Diffusion and VG models typically produce the most pronounced skewness. |

---

### CSV Export

The **↓ CSV** button appears on the Fan Chart tab. It exports `oil-price-forecast.csv` with 11 columns:

`Month, P5, P10, P25, Median, P75, P90, P95, Gas_P5, Gas_Median, Gas_P95`

All WTI values in USD/bbl; gasoline values in USD/gal. Month 0 = current spot.

---

## Theory

### Simulation Architecture

**800 independent Monte Carlo paths** (400 in comparison mode) discretised at **16 sub-steps per month** via Euler-Maruyama:

$$dt = \frac{1}{12 \times 16} \approx 0.0052 \text{ years}$$

Random number generation: Box-Muller transform (normal), Knuth algorithm (Poisson), Marsaglia-Tsang squeeze method (Gamma). The simulation re-runs automatically with a 300 ms debounce on parameter changes.

---

### The Eight Models

**1. Geometric Brownian Motion** — Black & Scholes (1973)

$$S_{t+dt} = S_t \exp\!\left[\left(\mu - \tfrac{1}{2}\sigma^2\right) dt + \sigma \sqrt{dt} \, Z_t\right]$$

Log-normal terminal distribution. I.i.d. Gaussian returns. The Itô correction −½σ²dt ensures E[S_T] = S_0·e^{μT}.

**2. Schwartz Mean-Reversion (Log-OU)** — Schwartz (1997)

$$\ln S_{t+dt} = \ln S_t + \kappa(\ln\theta - \ln S_t) \, dt + \sigma \sqrt{dt} \, Z_t$$

**3. Merton Jump-Diffusion** — Merton (1976)

$$S_{t+dt} = S_t \exp\!\left[\left(\mu - \tfrac{1}{2}\sigma^2 - \lambda\bar{k}\right) dt + \sigma\sqrt{dt}\, Z_t + \sum_{i=1}^{N_{dt}} Y_i\right]$$

$N_{dt} \sim \text{Poisson}(\lambda \, dt)$; $Y_i \sim \mathcal{N}(\mu_J, \sigma_J^2)$; $\bar{k} = e^{\mu_J + \sigma_J^2/2} - 1$ (Merton martingale correction).

**4. Hamilton Regime-Switching** — Hamilton (1989)

Three-state HMM. Transition matrix rows sum to 1. Regimes: Bull (μ+22%, σ×0.62), Bear (μ−10%, σ×1.28), Crisis (μ−52%, σ×2.90).

$$P = \begin{pmatrix} 0.934 & 0.061 & 0.005 \\ 0.055 & 0.895 & 0.050 \\ 0.048 & 0.168 & 0.784 \end{pmatrix}$$

**5. Futures-Implied Forward Curve** — Brennan & Schwartz (1985)

$$S_{t+dt} = S_t \exp\!\left[\left(\mu + \rho - \tfrac{1}{2}\sigma^2\right) dt + \sigma\sqrt{dt}\, Z_t\right]$$

where ρ is the convenience yield (backwardation = positive; contango = negative).

**6. Heston Stochastic Volatility** — Heston (1993)

$$dS_t = \mu S_t \, dt + \sqrt{v_t} S_t \, dW_t^S, \qquad dv_t = \kappa_v(\theta_v - v_t) \, dt + \sigma_v \sqrt{v_t} \, dW_t^v$$
$$dW_t^S \, dW_t^v = \rho \, dt$$

Full-truncation Euler scheme (Lord et al. 2010). κᵥ = 2.0 fixed.

**7. Schwartz-Smith Two-Factor** — Schwartz & Smith (2000)

$$\ln S_t = \chi_t + \xi_t, \quad d\chi_t = -\kappa_\chi \chi_t \, dt + \sigma_\chi \, dW_t^1, \quad d\xi_t = \left(\mu - \tfrac{1}{2}\sigma_\xi^2\right) dt + \sigma_\xi \, dW_t^2$$
$$dW_t^1 \, dW_t^2 = \rho \, dt, \qquad \chi_0 = 0, \quad \xi_0 = \ln S_0$$

**8. Variance-Gamma** — Madan, Carr & Chang (1998)

$$X_{VG}(dt) = \theta_{VG} \cdot G + \sigma\sqrt{G} \cdot Z, \quad G \sim \Gamma(dt/\nu,\, \nu)$$
$$S_{t+dt} = S_t \exp\!\left[(\mu + \omega) \, dt + X_{VG}(dt)\right], \quad \omega = \tfrac{1}{\nu}\ln\!\left(1 - \theta_{VG}\nu - \tfrac{1}{2}\sigma^2\nu\right)$$

Note: ω is the martingale correction ensuring E[S_T] = S_0·e^{μT}. The sign is positive for typical oil parameters (negative θ, small ν).

---

### Macro Factor Module

$$\mu_{\text{eff}} = \mu_0 + \Delta\mu_{\text{Fed}} + \Delta\mu_{\text{DXY}} + \Delta\mu_{\text{real}} + \Delta\mu_{\pi} + \Delta\mu_{\text{SPX}} + \Delta\mu_{\text{EIA}} + \Delta\mu_{\text{Geo}} + \Delta\mu_{\text{OPEC}} + \Delta\mu_{\text{VIX}}$$

$$\sigma_{\text{eff}} = \sigma_0 \cdot \underbrace{\left(1 + \tfrac{G}{10} \cdot 0.55\right)}_{\text{geo-risk}} \cdot \underbrace{\left(1 + \tfrac{\max(V-20,0)}{10} \cdot 0.08\right)}_{\text{VIX}}$$

| Term | Formula | Source |
|---|---|---|
| Δμ_Fed | −(r/100)×0.35 | Akram (2009) |
| Δμ_DXY | −(d/100)×0.90 | Grisse (2010) |
| Δμ_real | −(r_real/100)×0.28 | Hamilton (2009) |
| Δμ_π | +(π/100)×0.35 | Gorton & Rouwenhorst (2006) |
| Δμ_SPX | +(s/100)×0.42 | Büyüksahin & Robe (2014) |
| Δμ_EIA | −(I/100)×0.08 | Kilian (2009) |
| Δμ_Geo | +(G/10)×0.065 | Caldara & Iacoviello (2022) |
| Δμ_OPEC | +(O/10)×0.055 | Behmiri & Manso (2013) |
| Δμ_VIX | −max(V−20,0)×0.018 | Büyüksahin & Robe (2014) |

---

### VIX Integration (Three Channels)

**Channel 1 — Volatility scaling:** OVX tracks VIX with correlation ≈ 0.72. Above VIX = 20:

$$\sigma_{\text{eff}} \leftarrow \sigma_{\text{eff}} \times \left(1 + \frac{\max(V-20,0)}{10} \times 0.08\right)$$

**Channel 2 — Jump intensity amplification:** Power-law, calibrated to Todorov (2010):

$$\lambda_{\text{eff}} = \lambda_0 \times \left(\frac{V}{20}\right)^{1.4}$$

**Channel 3 — Drift suppression:** Demand-destruction fear above VIX = 20:

$$\Delta\mu_{\text{VIX}} = -\max(V-20,0) \times 0.018 \text{ per year}$$

---

### Gasoline Conversion

$$P_{\text{gas}} = \frac{P_{\text{WTI}} + \$27}{42} + \$0.82 \quad \text{(\$/gallon)}$$

| Component | Amount |
|---|---|
| WTI crude cost | P_WTI / 42 gal |
| 3-2-1 crack spread (refinery margin) | $27/bbl ÷ 42 |
| Federal excise tax | $0.184/gal |
| State & local tax (US average) | $0.343/gal |
| Distribution & retail margin | $0.293/gal |

---

## Historical Scenarios — Full Parameter Tables

Each scenario overwrites all macro sliders and the model selection. The WTI spot price and horizon remain as set by the user. "—" means the slider stays at its default value.

### 1973 — Arab Oil Embargo (+280%)

OAPEC embargo following Yom Kippur War. Production cut ~5 Mb/d; WTI equivalent tripled from ~$3 to ~$12/bbl.

| Parameter | Value | Rationale |
|---|---|---|
| Model | Jump-Diffusion | Discrete supply disruption |
| Drift (μ) | +35% | Severe supply shortage |
| Volatility (σ) | 70% | Extreme price uncertainty |
| Jump Frequency (λ) | 14/yr | Repeated escalations |
| Mean Jump Size | +38% | Large positive shocks |
| Jump Volatility | 22% | Variable shock magnitude |
| Geopolitical Risk | 9.5 | Near-maximum geo disruption |
| OPEC Tightness | 1 | OPEC actively cutting |
| VIX | 46 | Proxy for equity stress |
| SPX Trend | −24% | Stagflation bear market |
| Fed Rate Change | +200 bps | Nixon-era monetary tightening |
| DXY | +5% | Dollar strengthening |
| EIA Inventory | −80 Mb | Severe physical shortage |

---

### 1979 — Iranian Revolution (+130%)

Iranian production collapse (−4.8 Mb/d) followed by Iran-Iraq war. WTI from ~$14 to ~$35/bbl.

| Parameter | Value | Rationale |
|---|---|---|
| Model | Jump-Diffusion | Sudden production collapse |
| Drift (μ) | +22% | Supply shortage dynamic |
| Volatility (σ) | 62% | High uncertainty |
| Jump Frequency (λ) | 12/yr | Frequent escalations |
| Mean Jump Size | +30% | Large positive shocks |
| Jump Volatility | 20% | Variable |
| Geopolitical Risk | 9.0 | Near-maximum |
| OPEC Tightness | 2 | OPEC not compensating |
| VIX | 42 | Elevated equity stress |
| SPX Trend | −12% | Stagflation pressure |
| Fed Rate Change | +1100 bps | Early Volcker tightening |
| EIA Inventory | −65 Mb | Physical shortage |

---

### 1980s — Volcker Tightening / Demand Bust (−68%)

Record real interest rates crushed demand; non-OPEC supply surged; OPEC quota war collapsed. WTI from $35 to $11.

| Parameter | Value | Rationale |
|---|---|---|
| Model | Mean-Reversion | Structural demand rebalancing |
| Drift (μ) | −18% | Secular demand destruction |
| Volatility (σ) | 55% | Extended adjustment period |
| Reversion Speed (κ) | 0.80 | Moderate pull to new equilibrium |
| Long-Run Mean (θ) | $18 | New supply-demand clearing price |
| Geopolitical Risk | 2.0 | Cold War tension but no oil disruption |
| OPEC Tightness | 1 | OPEC quota war, no coordination |
| VIX | 28 | Moderate equity stress |
| Fed Rate Change | +2000 bps | Volcker shock |
| Real Interest Rate | +8% | Record positive real rates |
| Inflation Expectations | +10% | Late-stage inflation psychology |
| DXY | +18% | Dollar surge from rate differentials |
| EIA Inventory | +120 Mb | Massive global oversupply |

---

### 1990 — Gulf War (+115%)

Iraq invasion of Kuwait removed ~4.3 Mb/d. WTI spiked from $17 to $46 in two months.

| Parameter | Value | Rationale |
|---|---|---|
| Model | Jump-Diffusion | Sudden military action |
| Drift (μ) | +10% | Moderate supply disruption |
| Volatility (σ) | 58% | High war uncertainty |
| Jump Frequency (λ) | 10/yr | Repeated escalations |
| Mean Jump Size | +32% | Large positive shocks |
| Jump Volatility | 18% | Moderate variability |
| Geopolitical Risk | 8.5 | Major military conflict |
| OPEC Tightness | 6 | Saudi partial compensation |
| VIX | 38 | Equity market stress |
| SPX Trend | −15% | Recession fears |
| EIA Inventory | −55 Mb | Tightening supply |

---

### 1997–98 — Asian Financial Crisis (−55%)

Demand implosion across Asia; OPEC raised production into the downturn. WTI from $22 to $11.

| Parameter | Value | Rationale |
|---|---|---|
| Model | Regime-Switching | Abrupt demand regime shift |
| Drift (μ) | −22% | Demand destruction |
| Volatility (σ) | 48% | Currency crisis uncertainty |
| Geopolitical Risk | 1.5 | No supply-side disruption |
| OPEC Tightness | 1 | OPEC increased production |
| VIX | 44 | EM financial crisis spillover |
| SPX Trend | −30% | EM contagion to US equities |
| EIA Inventory | +110 Mb | Inventory build |
| DXY | +12% | Flight to dollar safety |

---

### 2001 — Post-9/11 Shock (−38%)

Travel and industrial demand collapsed; geopolitical uncertainty spiked simultaneously. WTI from $30 to $18.

| Parameter | Value | Rationale |
|---|---|---|
| Model | Jump-Diffusion | Discrete shock event |
| Drift (μ) | −14% | Demand collapse |
| Volatility (σ) | 52% | High uncertainty |
| Jump Frequency (λ) | 8/yr | Aftershock episodes |
| Mean Jump Size | −22% | Negative (demand shocks) |
| Jump Volatility | 18% | Variable outcomes |
| Geopolitical Risk | 8.5 | Terror threat premium |
| OPEC Tightness | 4 | Partial OPEC support |
| VIX | 43 | Equity market trauma |
| SPX Trend | −34% | Equity bear market |
| Fed Rate Change | −475 bps | Emergency easing |

---

### 2003 — Iraq War Invasion (+45%)

Pre-war supply disruption premium; WTI hit $40 on eve of invasion then reversed quickly as war ended faster than expected.

| Parameter | Value | Rationale |
|---|---|---|
| Model | Jump-Diffusion | Discrete military event |
| Drift (μ) | +12% | War risk premium |
| Volatility (σ) | 44% | Outcome uncertainty |
| Jump Frequency (λ) | 8/yr | Escalation episodes |
| Mean Jump Size | +22% | Positive shock bias |
| Jump Volatility | 15% | Moderate variability |
| Geopolitical Risk | 7.5 | Major military operation |
| OPEC Tightness | 5 | OPEC cautious compliance |
| VIX | 33 | Elevated but not crisis |
| SPX Trend | +8% | War rally |
| Fed Rate Change | −50 bps | Accommodative Fed |
| EIA Inventory | −40 Mb | Pre-war precautionary draws |

---

### 2008 — Financial Crisis (−78%)

Lehman collapse triggered the largest demand shock in oil history. WTI from $147 to $32 in five months.

| Parameter | Value | Rationale |
|---|---|---|
| Model | Jump-Diffusion | Discrete financial system event |
| Drift (μ) | −38% | Demand destruction |
| Volatility (σ) | 88% | Record commodity vol |
| Jump Frequency (λ) | 15/yr | Repeated financial dislocations |
| Mean Jump Size | −38% | Large negative shocks |
| Jump Volatility | 32% | Extremely variable |
| Geopolitical Risk | 4.0 | Moderate (not supply-side) |
| OPEC Tightness | 1 | OPEC initially slow to cut |
| VIX | 78 | All-time VIX record (80.86) |
| SPX Trend | −45% | Worst equity bear since 1930s |
| Fed Rate Change | +425 bps | Emergency 425 bps cut 2008–09 |
| EIA Inventory | +145 Mb | Enormous inventory build |
| DXY | +15% | Flight to dollar safety |

---

### 2011 — Arab Spring / Libya (+35%)

Libyan output (~1.6 Mb/d) halted; regional contagion fears. WTI hit $114. Brent-WTI spread widened to $20+.

| Parameter | Value | Rationale |
|---|---|---|
| Model | Jump-Diffusion | Supply disruption |
| Drift (μ) | +18% | Supply gap |
| Volatility (σ) | 42% | Political uncertainty |
| Jump Frequency (λ) | 8/yr | Country-by-country escalations |
| Mean Jump Size | +22% | Positive supply shocks |
| Jump Volatility | 14% | Relatively contained |
| Geopolitical Risk | 8.0 | Regional war risk |
| OPEC Tightness | 6 | Saudi compensating partially |
| VIX | 30 | Moderate equity stress |
| SPX Trend | +6% | Risk-on environment overall |
| EIA Inventory | −48 Mb | Moderate physical tightness |

---

### 2014–16 — OPEC Supply Glut (−76%)

Saudi Arabia refused to cut as US shale surged. Record inventory builds; WTI from $107 to $26.

| Parameter | Value | Rationale |
|---|---|---|
| Model | Futures-Implied Curve | Contango dominates the signal |
| Drift (μ) | −28% | Supply glut structural |
| Volatility (σ) | 48% | High uncertainty on floor |
| Backwardation | −22%/yr (contango) | Record WTI contango |
| Geopolitical Risk | 1.5 | No supply disruption |
| OPEC Tightness | 1 | OPEC deliberately flooding market |
| VIX | 26 | Moderate equity stress |
| SPX Trend | −12% | Energy sector drag on equities |
| Fed Rate Change | +25 bps | First rate hike Dec 2015 |
| EIA Inventory | +175 Mb | Record US inventory builds |
| DXY | +20% | Dollar surge on rate differential |

---

### 2020 — COVID-19 Collapse (−130%)

Global lockdowns cut demand by 30 Mb/d. WTI spot briefly went negative (−$37/bbl). Worst supply glut in history.

| Parameter | Value | Rationale |
|---|---|---|
| Model | Jump-Diffusion | Discrete global lockdown event |
| Drift (μ) | −45% | Unprecedented demand collapse |
| Volatility (σ) | 95% | Record commodity vol |
| Jump Frequency (λ) | 16/yr | Sequential lockdown episodes |
| Mean Jump Size | −48% | Extreme negative shocks |
| Jump Volatility | 35% | Unprecedented variance |
| Geopolitical Risk | 2.5 | Some OPEC disruption |
| OPEC Tightness | 1 | Saudi-Russia price war initially |
| VIX | 66 | Near-record VIX |
| SPX Trend | −38% | Sharp equity bear |
| Fed Rate Change | −150 bps | Emergency cuts to zero |
| EIA Inventory | +210 Mb | All-time US inventory record |
| Backwardation | −30%/yr (contango) | Maximum contango |

---

### 2022 — Russia-Ukraine War (+75%)

Russian invasion removed ~3 Mb/d from global supply. Sanctions fragmented the global oil market. WTI from $78 to $130.

| Parameter | Value | Rationale |
|---|---|---|
| Model | Jump-Diffusion | Discrete military invasion |
| Drift (μ) | +22% | Supply gap |
| Volatility (σ) | 56% | Sanctions uncertainty |
| Jump Frequency (λ) | 10/yr | Escalation episodes |
| Mean Jump Size | +32% | Large positive shocks |
| Jump Volatility | 20% | Variable |
| Geopolitical Risk | 9.0 | Major great-power conflict |
| OPEC Tightness | 6 | OPEC cautious, not fully compensating |
| VIX | 37 | Elevated equity stress |
| SPX Trend | −18% | Rate-hike equity bear |
| Fed Rate Change | +450 bps | Fastest hiking cycle since Volcker |
| EIA Inventory | −70 Mb | Supply deficit |
| DXY | +14% | Dollar surge on safe-haven demand |

---

## Model Comparison Mode

The **Comparison** chart tab overlays median price paths for all selected models using the same macro environment. A cross-model statistics table below the chart shows Median, Mean, P5, P95, Crash%, and Rally% side by side.

**Reading the spread:** The range of medians across models is itself informative. A narrow spread (models agreeing) indicates a forecast robust to model choice. A wide spread signals that the choice of model is driving the result — the appropriate response is to report results from multiple models rather than picking one.

**Fixed model colours:**

| Model | Colour |
|---|---|
| GBM | Sky blue |
| Mean-Reversion | Emerald |
| Jump-Diffusion | Rose/Red |
| Regime-Switching | Violet |
| Futures-Implied | Amber |
| Heston | Orange |
| Schwartz-Smith | Green |
| Variance-Gamma | Pink |

---

## Risk Analytics

The **Risk** tab provides three panels:

**1. Price Target Breach Probabilities**

Enter a WTI price threshold in the Compare sidebar tab. The Risk panel shows:
- P(S_T > target): probability the terminal price exceeds the target (e.g., P(S_T > $90) for a hedging decision)
- P(S_T < target): probability of falling below (e.g., for budget forecasting)

Both are computed from the full 800-path main simulation, not the comparison runs.

**2. Risk Metrics**

| Metric | Definition |
|---|---|
| CVaR 5% | Average of the worst 5% of terminal prices. The expected loss *if* you end up in the left tail. Also called Expected Shortfall (ES). |
| CVaR 10% | Average of the worst 10% of terminal prices. Less extreme than CVaR 5%. |
| P10 (VaR) | 10th percentile. There is a 10% probability of ending below this price. |
| P90 | 90th percentile. There is a 10% probability of ending above this price. |
| Skewness | Third standardised central moment. Negative = more probability mass in left tail. |
| Excess Kurtosis | Fourth moment minus 3. Positive = fatter tails than Gaussian. Jump-Diffusion and VG models typically produce kurtosis > 1. |

**3. Historical Stress Test**

Runs mini-simulations (300 paths, 6-month horizon) for the first eight historical scenarios using the current active model and current spot price. Shows Median, P5, P95, and Crash% for each. This answers: *"If macro conditions returned to those of [crisis episode], what would the price distribution look like from today's spot?"*

---

## Limitations and Caveats

1. **Indicative calibration only.** Macro-factor β coefficients are drawn from published econometric studies and are not re-estimated from current data. Treat the output as scenario exploration, not point forecasts.

2. **VIX is static throughout the horizon.** No mean-reverting VIX process is simulated. In practice VIX reverts toward ~20 within 3–6 months of a spike. For longer horizons, set VIX closer to its expected average rather than its current spike value.

3. **Heston κᵥ is fixed at 2.0.** The vol mean-reversion speed is not user-controllable. Modify in source code if needed for calibration.

4. **Schwartz-Smith not forward-curve calibrated.** The long-run factor drift uses the user-supplied μ rather than being bootstrapped to observed futures prices. For a calibrated version, extract μ and σ_ξ from the current futures term structure.

5. **DXY and Fed channels overlap.** Both affect oil through the USD. Using both simultaneously at large magnitudes double-counts the dollar channel. Prefer DXY for a direct view on currency; use Fed only when the rate-cycle effect is the primary driver.

6. **Crack spread is a long-run average.** The $27/bbl margin varies seasonally (±$15/bbl) and by geography and refinery configuration. US Gulf Coast gasoline crack spreads in summer can reach $40–$50/bbl; winter distillate cracks are often higher than summer.

7. **Macro channels are independent.** The nine adjustment channels are additive and treated as uncorrelated. In practice, VIX and SPX, Fed rates and DXY, and geopolitical risk and OPEC tightness are strongly correlated. Avoid simultaneously setting correlated channels to opposing extremes.

8. **Browser-based precision.** JavaScript 64-bit arithmetic with no variance reduction techniques (antithetic variates, quasi-Monte Carlo, control variates). For production risk management applications, a Python/Julia implementation with 10,000+ paths and Sobol sequences is recommended.

---

## References

### Stochastic Process Models

- Black, F., & Scholes, M. (1973). The pricing of options and corporate liabilities. *Journal of Political Economy*, 81(3), 637–654.
- Merton, R. C. (1973). Theory of rational option pricing. *Bell Journal of Economics*, 4(1), 141–183.
- Merton, R. C. (1976). Option pricing when underlying stock returns are discontinuous. *Journal of Financial Economics*, 3(1–2), 125–144.
- Schwartz, E. S. (1997). The stochastic behavior of commodity prices. *Journal of Finance*, 52(3), 923–973.
- Gibson, R., & Schwartz, E. S. (1990). Stochastic convenience yield and the pricing of oil contingent claims. *Journal of Finance*, 45(3), 959–976.
- Schwartz, E. S., & Smith, J. E. (2000). Short-term variations and long-term dynamics in commodity prices. *Management Science*, 46(7), 893–911.
- Hamilton, J. D. (1989). A new approach to the economic analysis of nonstationary time series. *Econometrica*, 57(2), 357–384.
- Hamilton, J. D. (1994). *Time Series Analysis*. Princeton University Press.
- Kou, S. G. (2002). A jump-diffusion model for option pricing. *Management Science*, 48(8), 1086–1101.
- Heston, S. L. (1993). A closed-form solution for options with stochastic volatility. *Review of Financial Studies*, 6(2), 327–343.
- Lord, R., Koekkoek, R., & Van Dijk, D. (2010). A comparison of biased simulation schemes for stochastic volatility models. *Quantitative Finance*, 10(2), 177–194.
- Madan, D. B., Carr, P. P., & Chang, E. C. (1998). The variance gamma process and option pricing. *European Finance Review*, 2(1), 79–105.
- Brennan, M. J., & Schwartz, E. S. (1985). Evaluating natural resource investments. *Journal of Business*, 58(2), 135–157.
- Routledge, B., Seppi, D., & Spatt, C. (2000). Equilibrium forward curves for commodities. *Journal of Finance*, 55(3), 1297–1338.

### VIX and Volatility Transmission

- Whaley, R. E. (2009). Understanding the VIX. *Journal of Portfolio Management*, 35(3), 98–105.
- Todorov, V. (2010). Variance risk-premium dynamics: The role of jumps. *Review of Financial Studies*, 23(1), 345–383.
- Grynkiv, G., & Stentoft, L. (2018). Stationary versus explosive regimes in the VIX. *Journal of Financial Econometrics*, 16(4), 521–550.

### Macro-Financial Transmission

- Akram, Q. F. (2009). Commodity prices, interest rates and the dollar. *Energy Economics*, 31(6), 838–851.
- Grisse, C. (2010). What drives the oil-dollar correlation? *Federal Reserve Bank of New York Staff Reports*, No. 24.
- Büyüksahin, B., & Robe, M. A. (2014). Speculators, commodities and cross-market linkages. *Journal of International Money and Finance*, 42, 38–70.
- Caldara, D., & Iacoviello, M. (2022). Measuring geopolitical risk. *American Economic Review*, 112(4), 1194–1225.
- Behmiri, N. B., & Manso, J. R. P. (2013). Crude oil price forecasting techniques. *OPEC Energy Review*, 37(2), 112–143.
- Gorton, G., & Rouwenhorst, K. G. (2006). Facts and fantasies about commodity futures. *Financial Analysts Journal*, 62(2), 47–68.
- Kilian, L. (2009). Not all oil price shocks are alike. *American Economic Review*, 99(3), 1053–1069.
- Hamilton, J. D. (2009). Causes and consequences of the oil shock of 2007–08. *Brookings Papers on Economic Activity*, Spring, 215–261.

### Gasoline Pricing

- Borenstein, S., Cameron, A. C., & Gilbert, R. (1997). Do gasoline prices respond asymmetrically to crude oil price changes? *Quarterly Journal of Economics*, 112(1), 305–339.
- U.S. Energy Information Administration (EIA). (2024). *What we pay for in a gallon of gasoline*. https://www.eia.gov/energyexplained/gasoline/prices-and-outlook.php

### Monte Carlo Methods

- Glasserman, P. (2004). *Monte Carlo Methods in Financial Engineering*. Springer.
- Kloeden, P. E., & Platen, E. (1992). *Numerical Solution of Stochastic Differential Equations*. Springer.
- Marsaglia, G., & Tsang, W. W. (2000). A simple method for generating gamma variables. *ACM Transactions on Mathematical Software*, 26(3), 363–372.

---

*This tool is for educational and analytical purposes only. It does not constitute financial advice. All forecasts are probabilistic scenario analyses, not point predictions.*
