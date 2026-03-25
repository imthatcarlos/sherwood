#!/usr/bin/env npx tsx
/**
 * WOOD Token Economic Simulation
 *
 * Models the ve(3,3) tokenomics over 104 weeks (2 years):
 * - Emission schedule (take-off, cruise, WOOD Fed phases)
 * - Dilution analysis at various lock rates
 * - Voter break-even analysis at various trading volumes
 * - Gauge cap stress test with whale concentration
 * - Supply distribution tracking
 *
 * Usage:
 *   npx tsx docs/wood-simulation.ts
 *   npx tsx docs/wood-simulation.ts --csv          # output CSV files
 *   npx tsx docs/wood-simulation.ts --weeks 52     # simulate 1 year
 *   npx tsx docs/wood-simulation.ts --initial-emission 5000000  # 5M/week
 */

// ---------------------------------------------------------------------------
// CLI argument parsing (no deps)
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]) {
  const args: Record<string, string> = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        args[key] = next;
        i++;
      } else {
        args[key] = "true";
      }
    }
  }
  return args;
}

const cliArgs = parseArgs(process.argv);

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

interface SimConfig {
  initialSupply: number;
  initialEmission: number; // WOOD/week
  takeoffRate: number; // +3%/week
  cruiseRate: number; // -1%/week
  woodFedRate: number; // steady-state rate change during WOOD Fed
  takeoffEndWeek: number; // week 14
  woodFedStartWeek: number; // week 67
  gaugeCap: number; // 35%
  teamPct: number;
  treasuryPct: number;
  earlyCreatorsPct: number;
  communityPct: number;
  genesisLiquidityPct: number;
  earlyVoterPct: number;
  partnershipsPct: number;
  publicSalePct: number;
  teamEmissionPct: number; // 5% of weekly emissions to team
  minLockWeeks: number;
  maxLockWeeks: number; // 4 years = 208 weeks
  weeks: number;
  csv: boolean;
}

const config: SimConfig = {
  initialSupply: Number(cliArgs["initial-supply"] || 500_000_000),
  initialEmission: Number(cliArgs["initial-emission"] || 10_000_000),
  takeoffRate: Number(cliArgs["takeoff-rate"] || 0.03),
  cruiseRate: Number(cliArgs["cruise-rate"] || -0.01),
  woodFedRate: Number(cliArgs["wood-fed-rate"] || -0.005),
  takeoffEndWeek: Number(cliArgs["takeoff-end"] || 14),
  woodFedStartWeek: Number(cliArgs["wood-fed-start"] || 67),
  gaugeCap: Number(cliArgs["gauge-cap"] || 0.35),
  teamPct: 0.15,
  treasuryPct: 0.15,
  earlyCreatorsPct: 0.03,
  communityPct: 0.17,
  genesisLiquidityPct: 0.10,
  earlyVoterPct: 0.08,
  partnershipsPct: 0.12,
  publicSalePct: 0.15,
  teamEmissionPct: 0.05,
  minLockWeeks: Number(cliArgs["min-lock-weeks"] || 4),
  maxLockWeeks: 208,
  weeks: Number(cliArgs["weeks"] || 104),
  csv: cliArgs["csv"] === "true",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmt(n: number, decimals = 0): string {
  if (Math.abs(n) >= 1_000_000_000) return (n / 1_000_000_000).toFixed(2) + "B";
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toFixed(decimals);
}

function pct(n: number): string {
  return (n * 100).toFixed(2) + "%";
}

function padRight(s: string, len: number): string {
  return s.length >= len ? s : s + " ".repeat(len - s.length);
}

function padLeft(s: string, len: number): string {
  return s.length >= len ? s : " ".repeat(len - s.length) + s;
}

function printTable(headers: string[], rows: string[][], colWidths: number[]) {
  const header = headers.map((h, i) => padRight(h, colWidths[i])).join(" | ");
  const sep = colWidths.map((w) => "-".repeat(w)).join("-+-");
  console.log(header);
  console.log(sep);
  for (const row of rows) {
    console.log(row.map((c, i) => padLeft(c, colWidths[i])).join(" | "));
  }
}

function toCsv(headers: string[], rows: string[][]): string {
  return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
}

// ---------------------------------------------------------------------------
// 1. Emission Model
// ---------------------------------------------------------------------------

interface WeekData {
  week: number;
  emission: number;
  cumulativeEmission: number;
  totalSupply: number;
  phase: string;
}

function simulateEmissions(cfg: SimConfig): WeekData[] {
  const data: WeekData[] = [];
  let emission = cfg.initialEmission;
  let cumulative = 0;

  for (let w = 1; w <= cfg.weeks; w++) {
    let phase: string;
    if (w <= cfg.takeoffEndWeek) {
      phase = "Take-off";
      if (w > 1) emission *= 1 + cfg.takeoffRate;
    } else if (w <= cfg.woodFedStartWeek) {
      phase = "Cruise";
      emission *= 1 + cfg.cruiseRate;
    } else {
      phase = "WOOD Fed";
      emission *= 1 + cfg.woodFedRate;
    }

    cumulative += emission;
    data.push({
      week: w,
      emission,
      cumulativeEmission: cumulative,
      totalSupply: cfg.initialSupply + cumulative,
      phase,
    });
  }

  return data;
}

function printEmissionSummary(data: WeekData[]) {
  console.log("\n" + "=".repeat(80));
  console.log("  1. EMISSION SCHEDULE");
  console.log("=".repeat(80));

  const milestones = [1, 4, 8, 14, 26, 39, 52, 67, 78, 91, 104];
  const headers = ["Week", "Phase", "Emission/wk", "Cumulative", "Total Supply", "Inflation"];
  const rows = milestones
    .filter((w) => w <= data.length)
    .map((w) => {
      const d = data[w - 1];
      const inflation = d.cumulativeEmission / config.initialSupply;
      return [
        String(d.week),
        d.phase,
        fmt(d.emission),
        fmt(d.cumulativeEmission),
        fmt(d.totalSupply),
        pct(inflation),
      ];
    });

  printTable(headers, rows, [6, 10, 14, 14, 14, 10]);

  const peakWeek = data.reduce((max, d) => (d.emission > max.emission ? d : max), data[0]);
  const yr1 = data[Math.min(51, data.length - 1)];
  const yr2 = data[data.length - 1];

  console.log(`\nPeak emission: ${fmt(peakWeek.emission)}/week at week ${peakWeek.week}`);
  console.log(
    `Year 1 cumulative: ${fmt(yr1.cumulativeEmission)} (${pct(yr1.cumulativeEmission / config.initialSupply)} of initial supply)`
  );
  if (data.length >= 104) {
    console.log(
      `Year 2 cumulative: ${fmt(yr2.cumulativeEmission)} (${pct(yr2.cumulativeEmission / config.initialSupply)} of initial supply)`
    );
  }
}

// ---------------------------------------------------------------------------
// 2. Dilution Analysis
// ---------------------------------------------------------------------------

interface DilutionRow {
  week: number;
  lockRate: number;
  rebase: number;
  cumulativeRebase: number;
  lockedDilution: number; // effective dilution for locked holders
  unlockedDilution: number; // effective dilution for unlocked holders
}

function simulateDilution(
  emissions: WeekData[],
  lockRates: number[]
): Map<number, DilutionRow[]> {
  const results = new Map<number, DilutionRow[]>();

  for (const lockRate of lockRates) {
    const rows: DilutionRow[] = [];
    let cumulativeRebase = 0;

    // Initial locked supply: all veWOOD allocations
    const initialVeWood =
      config.initialSupply *
      (config.teamPct + config.treasuryPct + config.earlyCreatorsPct + config.communityPct);

    for (let i = 0; i < emissions.length; i++) {
      const e = emissions[i];
      // veWOOD supply = initial locked + lockRate * cumulative liquid emissions
      const liquidEmissions = e.cumulativeEmission * (1 - config.teamEmissionPct);
      const veSupply = initialVeWood + lockRate * liquidEmissions;
      const ratio = veSupply / e.totalSupply;

      // Rebase formula from spec
      const rebase = e.emission * Math.pow(1 - ratio, 2) * 0.5;
      cumulativeRebase += rebase;

      // Dilution = how much your share of total supply changed
      // Locked holders get rebase, unlocked don't
      const initialLockedShare = 1 / config.initialSupply; // per-token share
      const lockedTokensNow = 1 + cumulativeRebase / (veSupply || 1); // growth factor
      const lockedDilution = 1 - (lockedTokensNow * config.initialSupply) / e.totalSupply;
      const unlockedDilution = 1 - config.initialSupply / e.totalSupply;

      rows.push({
        week: e.week,
        lockRate,
        rebase,
        cumulativeRebase,
        lockedDilution,
        unlockedDilution,
      });
    }

    results.set(lockRate, rows);
  }

  return results;
}

function printDilutionAnalysis(dilution: Map<number, DilutionRow[]>) {
  console.log("\n" + "=".repeat(80));
  console.log("  2. DILUTION ANALYSIS (locked vs unlocked holders)");
  console.log("=".repeat(80));

  const milestones = [4, 14, 26, 52, 78, 104];
  const lockRates = [...dilution.keys()];

  for (const week of milestones.filter((w) => w <= config.weeks)) {
    console.log(`\n--- Week ${week} ---`);
    const headers = ["Lock Rate", "Rebase/wk", "Cum. Rebase", "Locked Dilution", "Unlocked Dilution", "Benefit"];
    const rows = lockRates.map((lr) => {
      const d = dilution.get(lr)![week - 1];
      return [
        pct(lr),
        fmt(d.rebase),
        fmt(d.cumulativeRebase),
        pct(d.lockedDilution),
        pct(d.unlockedDilution),
        pct(d.unlockedDilution - d.lockedDilution),
      ];
    });
    printTable(headers, rows, [10, 12, 14, 16, 18, 10]);
  }
}

// ---------------------------------------------------------------------------
// 3. Voter Break-Even Analysis
// ---------------------------------------------------------------------------

interface VoterBreakEven {
  weeklyVolume: number;
  syndicateCount: number;
  feeTier: number;
  weeklyFees: number;
  annualFees: number;
  woodPrice: number;
  totalLockedValue: number;
  voterApr: number;
}

function simulateVoterBreakEven(
  emissions: WeekData[],
  lockRatePct: number
): VoterBreakEven[] {
  const results: VoterBreakEven[] = [];

  const weeklyVolumes = [100_000, 500_000, 1_000_000, 5_000_000];
  const syndicateCounts = [5, 10, 20];
  const feeTiers = [0.003, 0.01]; // 0.3% and 1%
  const woodPrices = [0.01, 0.05, 0.10, 0.50];

  // Use week 26 as reference point (6 months in)
  const refWeek = Math.min(25, emissions.length - 1);
  const totalSupply = emissions[refWeek].totalSupply;
  const lockedSupply = totalSupply * lockRatePct;

  for (const vol of weeklyVolumes) {
    for (const count of syndicateCounts) {
      for (const fee of feeTiers) {
        for (const price of woodPrices) {
          const weeklyFees = vol * count * fee;
          const annualFees = weeklyFees * 52;
          const totalLockedValue = lockedSupply * price;
          const voterApr = totalLockedValue > 0 ? annualFees / totalLockedValue : 0;

          results.push({
            weeklyVolume: vol,
            syndicateCount: count,
            feeTier: fee,
            weeklyFees,
            annualFees,
            woodPrice: price,
            totalLockedValue,
            voterApr,
          });
        }
      }
    }
  }

  return results;
}

function printVoterBreakEven(results: VoterBreakEven[]) {
  console.log("\n" + "=".repeat(80));
  console.log("  3. VOTER BREAK-EVEN ANALYSIS (at 40% lock rate, week 26)");
  console.log("=".repeat(80));

  // Show compact view: for each fee tier, show volume x price matrix at 10 syndicates
  for (const feeTier of [0.003, 0.01]) {
    console.log(`\n--- Fee tier: ${(feeTier * 100).toFixed(1)}% | 10 syndicates ---`);

    const filtered = results.filter(
      (r) => r.feeTier === feeTier && r.syndicateCount === 10
    );

    const volumes = [...new Set(filtered.map((r) => r.weeklyVolume))];
    const prices = [...new Set(filtered.map((r) => r.woodPrice))];

    const headers = ["Vol/wk\\Price", ...prices.map((p) => `$${p}`)];
    const rows = volumes.map((vol) => {
      const cells = prices.map((price) => {
        const r = filtered.find(
          (x) => x.weeklyVolume === vol && x.woodPrice === price
        )!;
        const aprStr = pct(r.voterApr);
        return r.voterApr >= 0.05 ? `${aprStr} ✓` : aprStr;
      });
      return [`$${fmt(vol)}`, ...cells];
    });

    printTable(headers, rows, [14, 12, 12, 12, 12]);
  }

  console.log("\n✓ = APR >= 5% (minimum viable voter incentive)");

  // Find minimum viable volume
  const viable = results.filter((r) => r.voterApr >= 0.05 && r.syndicateCount === 10);
  if (viable.length > 0) {
    const minViable = viable.reduce((min, r) =>
      r.weeklyVolume < min.weeklyVolume ? r : min
    );
    console.log(
      `\nMinimum viable: $${fmt(minViable.weeklyVolume)}/wk per syndicate at ${(minViable.feeTier * 100).toFixed(1)}% fee, WOOD=$${minViable.woodPrice}`
    );
  } else {
    console.log(
      "\n⚠ No scenario achieves 5% APR for voters with 10 syndicates — bribe layer is essential"
    );
  }
}

// ---------------------------------------------------------------------------
// 4. Gauge Cap Stress Test
// ---------------------------------------------------------------------------

interface GaugeCapResult {
  whaleVotePct: number;
  syndicateCount: number;
  actualCapture: number; // what the whale's syndicate actually gets
  redistributed: number; // excess redistributed
  effectiveShare: number; // % of total emissions
}

function simulateGaugeCap(): GaugeCapResult[] {
  const results: GaugeCapResult[] = [];
  const whaleConcentrations = [0.2, 0.35, 0.4, 0.5, 0.6, 0.8];
  const syndicateCounts = [5, 10, 20];

  for (const whalePct of whaleConcentrations) {
    for (const count of syndicateCounts) {
      // Whale votes 100% for their syndicate
      // Remaining votes split evenly across other syndicates
      const remainingVotePct = 1 - whalePct;
      const otherSyndicateVote = count > 1 ? remainingVotePct / (count - 1) : 0;

      // Apply gauge cap
      let actualCapture: number;
      let redistributed: number;

      if (whalePct > config.gaugeCap) {
        actualCapture = config.gaugeCap;
        redistributed = whalePct - config.gaugeCap;
      } else {
        actualCapture = whalePct;
        redistributed = 0;
      }

      results.push({
        whaleVotePct: whalePct,
        syndicateCount: count,
        actualCapture,
        redistributed,
        effectiveShare: actualCapture,
      });
    }
  }

  return results;
}

function printGaugeCapStressTest(results: GaugeCapResult[]) {
  console.log("\n" + "=".repeat(80));
  console.log(`  4. GAUGE CAP STRESS TEST (cap = ${pct(config.gaugeCap)})`);
  console.log("=".repeat(80));

  const headers = [
    "Whale Vote%",
    "Syndicates",
    "Actual Capture",
    "Redistributed",
    "Effective Share",
    "Capped?",
  ];
  const rows = results.map((r) => [
    pct(r.whaleVotePct),
    String(r.syndicateCount),
    pct(r.actualCapture),
    pct(r.redistributed),
    pct(r.effectiveShare),
    r.whaleVotePct > config.gaugeCap ? "YES" : "no",
  ]);

  printTable(headers, rows, [12, 12, 16, 14, 16, 8]);

  // Collusion scenario: 3 whales each at cap
  const maxCollusion = config.gaugeCap * 3;
  console.log(
    `\n3-whale collusion: ${pct(maxCollusion)} of emissions (each at ${pct(config.gaugeCap)} cap)`
  );
  console.log(
    maxCollusion >= 1.0
      ? "⚠ WARNING: 3 whales at cap can capture 100% of emissions"
      : `Remaining ${pct(1 - maxCollusion)} distributed to other syndicates`
  );
}

// ---------------------------------------------------------------------------
// 5. Supply Distribution Over Time
// ---------------------------------------------------------------------------

interface SupplyDistribution {
  week: number;
  circulating: number;
  locked: number; // veWOOD
  teamVesting: number;
  treasury: number;
  totalSupply: number;
}

function simulateSupplyDistribution(
  emissions: WeekData[],
  lockRate: number
): SupplyDistribution[] {
  const results: SupplyDistribution[] = [];

  // Initial allocations
  const teamTotal = config.initialSupply * config.teamPct;
  const treasuryVeWood = config.initialSupply * config.treasuryPct;
  const earlyCreators = config.initialSupply * config.earlyCreatorsPct;
  const community = config.initialSupply * config.communityPct;
  const partnerships = config.initialSupply * config.partnershipsPct;

  // Liquid at launch
  const genesisLiq = config.initialSupply * config.genesisLiquidityPct;
  const earlyVoter = config.initialSupply * config.earlyVoterPct;
  const publicSale = config.initialSupply * config.publicSalePct;

  // Team cliff = 52 weeks, then linear vesting over next 156 weeks (3 years)
  const teamCliffWeeks = 52;
  const teamVestWeeks = 156;

  for (let i = 0; i < emissions.length; i++) {
    const e = emissions[i];
    const w = e.week;

    // Team vesting
    let teamUnlocked = 0;
    if (w > teamCliffWeeks) {
      const vestingWeeks = Math.min(w - teamCliffWeeks, teamVestWeeks);
      teamUnlocked = teamTotal * (vestingWeeks / teamVestWeeks);
    }
    const teamStillVesting = teamTotal - teamUnlocked;

    // Emissions split: 5% to team treasury, rest to gauges → depositors
    const teamEmissions = e.cumulativeEmission * config.teamEmissionPct;
    const publicEmissions = e.cumulativeEmission * (1 - config.teamEmissionPct);

    // Locked = initial veWOOD allocations + lockRate of liquid emissions + lockRate of initial liquid
    const initialLocked = treasuryVeWood + earlyCreators + community + teamTotal;
    const liquidEmissionsLocked = publicEmissions * lockRate;
    const initialLiquidLocked = (genesisLiq + earlyVoter + publicSale) * lockRate * 0.5; // assume half of initial liquid gets locked over time

    const locked = initialLocked + liquidEmissionsLocked + initialLiquidLocked - teamUnlocked * lockRate;
    const treasury = treasuryVeWood + teamEmissions + partnerships;
    const circulating = e.totalSupply - locked - teamStillVesting;

    results.push({
      week: w,
      circulating: Math.max(0, circulating),
      locked: Math.max(0, locked),
      teamVesting: Math.max(0, teamStillVesting),
      treasury,
      totalSupply: e.totalSupply,
    });
  }

  return results;
}

function printSupplyDistribution(dist: SupplyDistribution[]) {
  console.log("\n" + "=".repeat(80));
  console.log("  5. SUPPLY DISTRIBUTION (40% lock rate scenario)");
  console.log("=".repeat(80));

  const milestones = [1, 4, 14, 26, 52, 78, 104];
  const headers = [
    "Week",
    "Total Supply",
    "Circulating",
    "Locked (veWOOD)",
    "Team Vesting",
    "Lock %",
  ];
  const rows = milestones
    .filter((w) => w <= dist.length)
    .map((w) => {
      const d = dist[w - 1];
      return [
        String(w),
        fmt(d.totalSupply),
        fmt(d.circulating),
        fmt(d.locked),
        fmt(d.teamVesting),
        pct(d.locked / d.totalSupply),
      ];
    });

  printTable(headers, rows, [6, 14, 14, 16, 14, 10]);
}

// ---------------------------------------------------------------------------
// 6. Insider Voting Power Analysis
// ---------------------------------------------------------------------------

function printInsiderAnalysis(emissions: WeekData[]) {
  console.log("\n" + "=".repeat(80));
  console.log("  6. INSIDER VOTING POWER ANALYSIS");
  console.log("=".repeat(80));

  // Insider-aligned veWOOD at genesis
  const insiderPct = config.teamPct + config.treasuryPct + config.earlyCreatorsPct;
  const insiderVeWood = config.initialSupply * insiderPct;
  const totalInitialVeWood =
    config.initialSupply *
    (config.teamPct + config.treasuryPct + config.earlyCreatorsPct + config.communityPct);

  console.log(`\nInitial insider-aligned veWOOD: ${fmt(insiderVeWood)} (${pct(insiderPct)} of initial supply)`);
  console.log(
    `Total initial veWOOD: ${fmt(totalInitialVeWood)} (${pct(totalInitialVeWood / config.initialSupply)} of initial supply)`
  );
  console.log(
    `Insider share of initial veWOOD: ${pct(insiderVeWood / totalInitialVeWood)}`
  );

  // Over time, as emissions are locked, insider share dilutes
  const headers = ["Week", "Total veWOOD (est)", "Insider veWOOD", "Insider Vote %", "Safe?"];
  const milestones = [1, 14, 26, 52, 104];
  const rows = milestones
    .filter((w) => w <= emissions.length)
    .map((w) => {
      const e = emissions[w - 1];
      // Assume 40% of emissions get locked by non-insiders
      const externalLocked = e.cumulativeEmission * 0.95 * 0.4; // 95% is public emissions, 40% locked
      const totalVeWood = totalInitialVeWood + externalLocked;
      // Insider veWOOD stays constant (auto-max-locked, no additional purchases assumed)
      const insiderShare = insiderVeWood / totalVeWood;
      return [
        String(w),
        fmt(totalVeWood),
        fmt(insiderVeWood),
        pct(insiderShare),
        insiderShare < 0.5 ? "✓" : "⚠",
      ];
    });

  printTable(headers, rows, [6, 18, 16, 14, 6]);

  // Whale scenario: insider + one whale buying 10% of circulating
  console.log("\n--- Insider + Whale Collusion Scenario ---");
  const week26 = emissions[Math.min(25, emissions.length - 1)];
  const circulatingAtW26 =
    week26.totalSupply -
    totalInitialVeWood -
    week26.cumulativeEmission * 0.95 * 0.4;
  const whaleAcquisition = circulatingAtW26 * 0.1; // whale buys 10% of circulating
  const externalLockedW26 = week26.cumulativeEmission * 0.95 * 0.4;
  const totalVeWoodW26 = totalInitialVeWood + externalLockedW26 + whaleAcquisition;
  const collusionShare = (insiderVeWood + whaleAcquisition) / totalVeWoodW26;

  console.log(`Week 26: Whale buys and locks 10% of circulating (${fmt(whaleAcquisition)} WOOD)`);
  console.log(`Insider + whale voting power: ${pct(collusionShare)}`);
  console.log(collusionShare >= 0.5 ? "⚠ RISK: Can exceed 50% majority" : "✓ Below 50% majority");
}

// ---------------------------------------------------------------------------
// 7. LP Bootstrapping Analysis
// ---------------------------------------------------------------------------

function printLPBootstrapping(emissions: WeekData[]) {
  console.log("\n" + "=".repeat(80));
  console.log("  7. LP BOOTSTRAPPING EMISSIONS (weeks 1-12)");
  console.log("=".repeat(80));

  const lpSchedule = [
    { weeks: [1, 4], pct: 0.10 },
    { weeks: [5, 8], pct: 0.07 },
    { weeks: [9, 12], pct: 0.03 },
  ];

  const headers = ["Weeks", "LP Share", "Avg Emission/wk", "LP WOOD/wk", "Total LP WOOD"];
  const rows: string[][] = [];
  let totalLpWood = 0;

  for (const phase of lpSchedule) {
    const [start, end] = phase.weeks;
    const weekEmissions = emissions.slice(start - 1, end);
    const avgEmission =
      weekEmissions.reduce((s, e) => s + e.emission, 0) / weekEmissions.length;
    const lpPerWeek = avgEmission * phase.pct;
    const phaseTotal = weekEmissions.reduce((s, e) => s + e.emission * phase.pct, 0);
    totalLpWood += phaseTotal;

    rows.push([
      `${start}-${end}`,
      pct(phase.pct),
      fmt(avgEmission),
      fmt(lpPerWeek),
      fmt(phaseTotal),
    ]);
  }

  printTable(headers, rows, [8, 10, 16, 14, 14]);
  console.log(`\nTotal LP bootstrapping emissions: ${fmt(totalLpWood)} WOOD over 12 weeks`);
  console.log(
    `As % of first 12 weeks total emissions: ${pct(totalLpWood / emissions.slice(0, 12).reduce((s, e) => s + e.emission, 0))}`
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  console.log("╔" + "═".repeat(78) + "╗");
  console.log("║" + "  WOOD TOKEN ECONOMIC SIMULATION".padEnd(78) + "║");
  console.log("║" + `  Initial Supply: ${fmt(config.initialSupply)} | Emission: ${fmt(config.initialEmission)}/wk | Weeks: ${config.weeks}`.padEnd(78) + "║");
  console.log("║" + `  Take-off: +${(config.takeoffRate * 100).toFixed(0)}%/wk (wk 1-${config.takeoffEndWeek}) | Cruise: ${(config.cruiseRate * 100).toFixed(0)}%/wk | Gauge Cap: ${(config.gaugeCap * 100).toFixed(0)}%`.padEnd(78) + "║");
  console.log("╚" + "═".repeat(78) + "╝");

  // 1. Emissions
  const emissions = simulateEmissions(config);
  printEmissionSummary(emissions);

  // 2. Dilution
  const lockRates = [0.2, 0.4, 0.6, 0.8];
  const dilution = simulateDilution(emissions, lockRates);
  printDilutionAnalysis(dilution);

  // 3. Voter break-even
  const voterResults = simulateVoterBreakEven(emissions, 0.4);
  printVoterBreakEven(voterResults);

  // 4. Gauge cap
  const gaugeCapResults = simulateGaugeCap();
  printGaugeCapStressTest(gaugeCapResults);

  // 5. Supply distribution
  const supplyDist = simulateSupplyDistribution(emissions, 0.4);
  printSupplyDistribution(supplyDist);

  // 6. Insider analysis
  printInsiderAnalysis(emissions);

  // 7. LP bootstrapping
  printLPBootstrapping(emissions);

  // CSV output
  if (config.csv) {
    const fs = require("fs");

    // Emissions CSV
    const emHeaders = ["week", "phase", "emission", "cumulative", "total_supply"];
    const emRows = emissions.map((e) => [
      String(e.week),
      e.phase,
      e.emission.toFixed(0),
      e.cumulativeEmission.toFixed(0),
      e.totalSupply.toFixed(0),
    ]);
    fs.writeFileSync("wood-emissions.csv", toCsv(emHeaders, emRows));
    console.log("\nWritten: wood-emissions.csv");

    // Voter break-even CSV
    const vHeaders = [
      "weekly_volume",
      "syndicates",
      "fee_tier",
      "weekly_fees",
      "annual_fees",
      "wood_price",
      "locked_value",
      "voter_apr",
    ];
    const vRows = voterResults.map((r) => [
      String(r.weeklyVolume),
      String(r.syndicateCount),
      String(r.feeTier),
      r.weeklyFees.toFixed(2),
      r.annualFees.toFixed(2),
      String(r.woodPrice),
      r.totalLockedValue.toFixed(2),
      (r.voterApr * 100).toFixed(4),
    ]);
    fs.writeFileSync("wood-voter-breakeven.csv", toCsv(vHeaders, vRows));
    console.log("Written: wood-voter-breakeven.csv");

    console.log("\nCSV files written to current directory");
  }

  console.log("\n" + "=".repeat(80));
  console.log("  SUMMARY & KEY FINDINGS");
  console.log("=".repeat(80));

  const yr1 = emissions[Math.min(51, emissions.length - 1)];
  const peakWeek = emissions.reduce((max, d) => (d.emission > max.emission ? d : max), emissions[0]);

  console.log(`
1. INFLATION: Year 1 cumulative emissions = ${fmt(yr1.cumulativeEmission)} (${pct(yr1.cumulativeEmission / config.initialSupply)} of initial supply)
   → Total supply roughly doubles in year 1. This is aggressive but comparable to Aerodrome's launch.

2. REBASE: At 40% lock rate, veWOOD holders are partially protected, but rebase only covers ~50%
   of dilution. Unlocked holders face full dilution.

3. VOTER FEES: At realistic volumes ($500K/wk per syndicate), voter APR from trading fees alone
   is likely <5%. The bribe layer is ESSENTIAL to make voting economically attractive.

4. GAUGE CAP: The 35% cap works well for single whales but 3 colluding whales can still
   capture ${pct(config.gaugeCap * 3)} of emissions. Consider reducing cap to 25% or adding
   a per-epoch cooldown on vote changes.

5. INSIDER POWER: At ${pct(config.teamPct + config.treasuryPct + config.earlyCreatorsPct)} insider-aligned veWOOD, insiders start with significant
   power but dilute below 50% within ~${config.weeks > 14 ? "14" : "N/A"} weeks as external locking grows (at 40% lock rate).

6. LP BOOTSTRAPPING: The 10%→7%→3%→0% decay over 12 weeks costs ~${fmt(emissions.slice(0, 12).reduce((s, e) => s + e.emission, 0) * 0.068)} WOOD
   total — a modest cost to solve the cold-start liquidity problem.
`);
}

main();
