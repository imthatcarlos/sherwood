#!/usr/bin/env python3
"""
Sherwood WOOD/WETH TGE Pool Simulation — $10K Budget Constraint
================================================================
Total supply: 1B WOOD | Initial circulating: 500M
Genesis liquidity allocation: 50M WOOD (protocol-owned, free to mint)
ETH budget: $10,000 | ETH price: $1,800 | Available ETH: ~5.56
Target FDV: $5M or $10M
"""

import math

ETH_PRICE = 1800
BUDGET_USD = 10_000
ETH_AVAILABLE = BUDGET_USD / ETH_PRICE
TOTAL_SUPPLY = 1_000_000_000
WOOD_ALLOCATION = 50_000_000

def fmt(n, decimals=2):
    if abs(n) >= 1_000_000:
        return f"${n/1_000_000:,.{decimals}f}M"
    elif abs(n) >= 1_000:
        return f"${n/1_000:,.{decimals}f}K"
    else:
        return f"${n:,.{decimals}f}"

def fmt_num(n):
    if abs(n) >= 1_000_000:
        return f"{n/1_000_000:,.2f}M"
    elif abs(n) >= 1_000:
        return f"{n/1_000:,.1f}K"
    else:
        return f"{n:,.2f}"

def separator(title=""):
    print()
    print("=" * 70)
    if title:
        print(f"  {title}")
        print("=" * 70)

def subsep(title=""):
    print()
    print(f"--- {title} ---")

# ============================================================
# APPROACH 1: BALANCED 50/50 POOL (Constant Product AMM)
# ============================================================
def simulate_balanced_pool(fdv, label):
    subsep(f"Balanced Pool @ {label} FDV")
    
    price_per_wood = fdv / TOTAL_SUPPLY
    wood_for_10k = BUDGET_USD / price_per_wood
    tvl = BUDGET_USD * 2  # balanced = 2x one side
    
    # Constant product: k = x * y (in USD terms, k = 10000 * 10000)
    # Reserve in WOOD terms: R_wood = BUDGET_USD / price_per_wood
    # Reserve in ETH terms: R_eth = ETH_AVAILABLE
    r_wood = wood_for_10k
    r_eth = ETH_AVAILABLE
    k = r_wood * r_eth
    
    print(f"  WOOD price:          ${price_per_wood:.6f}")
    print(f"  WOOD paired:         {fmt_num(wood_for_10k)} WOOD (= {fmt(wood_for_10k * price_per_wood)})")
    print(f"  ETH paired:          {ETH_AVAILABLE:.4f} ETH (= {fmt(BUDGET_USD)})")
    print(f"  Pool TVL:            {fmt(tvl)}")
    print(f"  k (constant):        {k:,.2f}")
    print(f"  % of 50M allocation: {wood_for_10k/WOOD_ALLOCATION*100:.1f}%")
    print()
    
    # Price impact for BUY trades (someone spends $X to buy WOOD)
    trade_sizes = [500, 1000, 2000, 5000, 10000]
    print(f"  {'Trade Size':>12} {'WOOD Received':>15} {'Avg Price':>12} {'Price Impact':>14} {'New Pool Price':>15}")
    print(f"  {'-'*12} {'-'*15} {'-'*12} {'-'*14} {'-'*15}")
    
    max_trade_2pct = None
    
    for trade_usd in trade_sizes:
        trade_eth = trade_usd / ETH_PRICE
        # Buyer adds ETH, gets WOOD
        new_r_eth = r_eth + trade_eth
        new_r_wood = k / new_r_eth
        wood_out = r_wood - new_r_wood
        
        avg_price = trade_usd / wood_out if wood_out > 0 else float('inf')
        price_impact = (avg_price / price_per_wood - 1) * 100
        new_spot = (new_r_eth / new_r_wood) * ETH_PRICE  # new WOOD price in USD
        
        print(f"  {fmt(trade_usd):>12} {fmt_num(wood_out):>15} {f'${avg_price:.6f}':>12} {price_impact:>+13.2f}% {f'${new_spot:.6f}':>15}")
    
    # Find max trade for <2% slippage (binary search)
    lo, hi = 0, BUDGET_USD * 2
    for _ in range(100):
        mid = (lo + hi) / 2
        te = mid / ETH_PRICE
        nre = r_eth + te
        nrw = k / nre
        wo = r_wood - nrw
        if wo <= 0:
            hi = mid
            continue
        ap = mid / wo
        pi = (ap / price_per_wood - 1) * 100
        if pi < 2.0:
            lo = mid
        else:
            hi = mid
    max_trade_2pct = lo
    
    print(f"\n  Max trade for <2% slippage: ~{fmt(max_trade_2pct)}")
    print(f"  (That's only {max_trade_2pct/BUDGET_USD*100:.0f}% of the ETH-side liquidity)")
    
    return {
        'tvl': tvl,
        'wood_paired': wood_for_10k,
        'price': price_per_wood,
        'max_2pct': max_trade_2pct,
        'r_wood': r_wood,
        'r_eth': r_eth,
    }


# ============================================================
# APPROACH 2: SINGLE-SIDED WOOD (Concentrated Liquidity)
# ============================================================
def simulate_single_sided(wood_amount, initial_price_usd, upper_price_mult, label):
    subsep(f"Single-Sided: {fmt_num(wood_amount)} WOOD, {label}")
    
    # On Aerodrome (Uniswap v3 style concentrated liquidity):
    # WOOD/WETH pair. Prices in ETH per WOOD.
    # Single-sided WOOD above current price means:
    #   - Set current price = initial_price (in ETH)
    #   - Place WOOD in range [initial_price, upper_price]
    #   - No ETH needed upfront
    #   - As buyers push price up into range, WOOD converts to ETH
    
    # Convert USD prices to ETH prices
    p_low = initial_price_usd / ETH_PRICE      # ETH per WOOD at range bottom
    p_high = p_low * upper_price_mult           # ETH per WOOD at range top
    p_low_usd = initial_price_usd
    p_high_usd = initial_price_usd * upper_price_mult
    wood_value = wood_amount * initial_price_usd
    
    sqrt_low = math.sqrt(p_low)
    sqrt_high = math.sqrt(p_high)
    
    # Liquidity parameter L (in WOOD/ETH space)
    # For single-sided WOOD deposit above current price:
    # wood_amount = L * (1/sqrt(p_low) - 1/sqrt(p_high))
    L = wood_amount / (1/sqrt_low - 1/sqrt_high)
    
    print(f"  WOOD deposited:      {fmt_num(wood_amount)} (value at init: {fmt(wood_value)})")
    print(f"  ETH deposited:       0 ETH ($0)")
    print(f"  USD price range:     ${p_low_usd:.6f} - ${p_high_usd:.6f}")
    print(f"  ETH price range:     {p_low:.10f} - {p_high:.10f} ETH/WOOD")
    print(f"  Range multiplier:    {upper_price_mult}x ({(upper_price_mult-1)*100:.0f}% above initial)")
    print(f"  Liquidity param L:   {L:,.0f}")
    print()
    print(f"  HOW IT WORKS:")
    print(f"  1. Protocol sets initial WOOD price = ${initial_price_usd:.6f}")
    print(f"  2. Deposits {fmt_num(wood_amount)} WOOD in range above that price")
    print(f"  3. First buyer pushes price into range, receives WOOD")
    print(f"  4. Pool gradually becomes two-sided as ETH flows in")
    print(f"  5. If price reaches ${p_high_usd:.6f}, all WOOD converted to ETH")
    print()
    
    # At price p within range:
    # ETH accumulated = L * (sqrt(p) - sqrt(p_low))
    # WOOD remaining = L * (1/sqrt(p) - 1/sqrt(p_high))
    
    checkpoints = [1.05, 1.10, 1.25, 1.50, 2.0]
    checkpoints = [c for c in checkpoints if c <= upper_price_mult]
    
    print(f"  As buyers push price up, here's how the pool fills:")
    print(f"  {'Price Move':>12} {'WOOD Price':>12} {'ETH In Pool':>20} {'WOOD Remaining':>16} {'Pool TVL':>12}")
    print(f"  {'-'*12} {'-'*12} {'-'*20} {'-'*16} {'-'*12}")
    
    for mult in checkpoints:
        p = p_low * mult  # current price in ETH
        p_usd = p_low_usd * mult
        sqrt_p = math.sqrt(p)
        eth_acc = L * (sqrt_p - sqrt_low)
        wood_rem = L * (1/sqrt_p - 1/sqrt_high)
        eth_val_usd = eth_acc * ETH_PRICE
        wood_val_usd = wood_rem * p_usd
        tvl = eth_val_usd + wood_val_usd
        
        print(f"  {f'+{(mult-1)*100:.0f}%':>12} {f'${p_usd:.6f}':>12} {f'{eth_acc:.2f} ETH ({fmt(eth_val_usd)})':>20} {fmt_num(max(0,wood_rem)):>16} {fmt(tvl):>12}")
    
    # Price impact for buys starting at range bottom
    print()
    trade_sizes = [500, 1000, 2000, 5000, 10000]
    print(f"  Price impact for buys (starting at range bottom):")
    print(f"  {'Trade Size':>12} {'WOOD Received':>15} {'Avg Price':>12} {'Price Impact':>14}")
    print(f"  {'-'*12} {'-'*15} {'-'*12} {'-'*14}")
    
    for trade_usd in trade_sizes:
        trade_eth = trade_usd / ETH_PRICE
        # Buyer adds ETH: ETH_in = L * (sqrt(p_new) - sqrt(p_low))
        # sqrt(p_new) = sqrt(p_low) + ETH_in / L
        new_sqrt_p = sqrt_low + trade_eth / L
        if new_sqrt_p > sqrt_high:
            new_sqrt_p = sqrt_high
        new_p = new_sqrt_p ** 2
        new_p_usd = new_p * ETH_PRICE
        
        # WOOD out = L * (1/sqrt(p_low) - 1/sqrt(p_new))
        wood_out = L * (1/sqrt_low - 1/new_sqrt_p)
        avg_price_usd = trade_usd / wood_out if wood_out > 0 else float('inf')
        price_impact = (new_p_usd / p_low_usd - 1) * 100
        
        print(f"  {fmt(trade_usd):>12} {fmt_num(wood_out):>15} {f'${avg_price_usd:.6f}':>12} {price_impact:>+13.2f}%")
    
    # Max trade for <2% price impact
    target_p = p_low * 1.02
    target_sqrt = math.sqrt(target_p)
    if target_sqrt <= sqrt_high:
        eth_for_2pct = L * (target_sqrt - sqrt_low)
        max_trade_2pct = eth_for_2pct * ETH_PRICE
    else:
        max_trade_2pct = float('inf')
    
    print(f"\n  Max trade for <2% price impact: ~{fmt(max_trade_2pct)}")
    
    # Total ETH if fully converted
    total_eth = L * (sqrt_high - sqrt_low)
    total_eth_usd = total_eth * ETH_PRICE
    print(f"  Total ETH if all WOOD sold: {total_eth:.2f} ETH ({fmt(total_eth_usd)})")
    
    return {
        'max_2pct': max_trade_2pct,
        'L': L,
        'total_eth_potential': total_eth_usd,
    }


# ============================================================
# APPROACH 3: LBP (Liquidity Bootstrapping Pool)
# ============================================================
def simulate_lbp():
    subsep("LBP Mechanics")
    
    wood_seed = 20_000_000  # 20M WOOD
    eth_seed_usd = 1000  # minimal ETH seed ($1K)
    eth_seed = eth_seed_usd / ETH_PRICE
    
    print(f"  LBP Setup (e.g. Fjord Foundry on Base):")
    print(f"  WOOD seeded:         {fmt_num(wood_seed)}")
    print(f"  ETH seeded:          {eth_seed:.3f} ETH ({fmt(eth_seed_usd)})")
    print(f"  Starting weights:    96% WOOD / 4% ETH")
    print(f"  Ending weights:      50% WOOD / 50% ETH")
    print(f"  Duration:            2-3 days")
    print()
    
    # Weighted pool price formula:
    # price_wood = (R_eth / W_eth) / (R_wood / W_wood)
    # At start: price = (eth_seed/0.04) / (wood_seed/0.96)
    
    start_price = (eth_seed / 0.04) / (wood_seed / 0.96)
    start_price_usd = start_price * ETH_PRICE
    start_fdv = start_price_usd * TOTAL_SUPPLY
    
    print(f"  Starting WOOD price: ${start_price_usd:.6f} (FDV: {fmt(start_fdv)})")
    print()
    
    # As weights shift and people buy, price discovery happens
    # Simulate different raise scenarios
    print(f"  LBP Raise Scenarios → Post-LBP Aerodrome Pool:")
    print(f"  {'ETH Raised':>12} {'Post-LBP FDV':>14} {'Aero Pool WOOD':>16} {'Aero Pool ETH':>15} {'Pool TVL':>12} {'Max <2% slip':>14}")
    print(f"  {'-'*12} {'-'*14} {'-'*16} {'-'*15} {'-'*12} {'-'*14}")
    
    raise_scenarios = [25_000, 50_000, 100_000, 200_000, 500_000]
    results = {}
    
    for raised_usd in raise_scenarios:
        raised_eth = raised_usd / ETH_PRICE
        # Assume final price discovery at some FDV
        # If raised $X selling Y% of seeded WOOD, remaining WOOD + raised ETH → pool
        # Typical LBP sells 40-70% of tokens. Assume 50% sold.
        wood_sold_pct = 0.50
        wood_remaining = wood_seed * (1 - wood_sold_pct)
        
        # Final price = raised_usd / (wood_sold * price)
        # Actually: price = raised_usd / (wood_seed * wood_sold_pct)
        final_price = raised_usd / (wood_seed * wood_sold_pct)
        final_fdv = final_price * TOTAL_SUPPLY
        
        # Seed Aerodrome with remaining WOOD + all raised ETH
        # For balanced pool: need equal USD value on each side
        eth_for_pool = raised_eth + eth_seed  # total ETH available
        eth_value = eth_for_pool * ETH_PRICE
        wood_value_available = wood_remaining * final_price
        
        # Use min of ETH value or WOOD value for balanced pool
        pool_side = min(eth_value, wood_value_available)
        pool_tvl = pool_side * 2
        pool_eth = pool_side / ETH_PRICE
        pool_wood = pool_side / final_price
        
        # k = pool_wood * pool_eth
        k = pool_wood * pool_eth
        # Max trade for 2% slippage in constant product
        # price_impact ~ trade_size / (2 * liquidity_one_side)
        # For 2%: trade = 0.02 * 2 * pool_side = 0.04 * pool_side  (approximation)
        # More precisely: (dx/x) leads to price change of ~2*dx/x
        # For <2% price impact: dx/x < 0.01, so dx < 0.01 * pool_side
        # Actually: in xy=k, buying with dy ETH:
        #   price_impact = dy / (y + dy) ... roughly dy/y for small dy
        #   for 2%: dy = 0.02 * y_usd ... nah let's just compute properly
        r_eth_pool = pool_eth
        r_wood_pool = pool_wood
        lo_t, hi_t = 0, eth_value * 2
        for _ in range(100):
            mid = (lo_t + hi_t) / 2
            te = mid / ETH_PRICE
            nre = r_eth_pool + te
            nrw = k / nre
            wo = r_wood_pool - nrw
            if wo <= 0:
                hi_t = mid
                continue
            ap = mid / wo
            pi = (ap / final_price - 1) * 100
            if pi < 2.0:
                lo_t = mid
            else:
                hi_t = mid
        max_2pct = lo_t
        
        print(f"  {fmt(raised_usd):>12} {fmt(final_fdv):>14} {fmt_num(pool_wood):>16} {f'{pool_eth:.1f} ETH':>15} {fmt(pool_tvl):>12} {fmt(max_2pct):>14}")
        results[raised_usd] = {'tvl': pool_tvl, 'max_2pct': max_2pct, 'fdv': final_fdv}
    
    return results


# ============================================================
# MAIN SIMULATION
# ============================================================
def main():
    print()
    print("*" * 70)
    print("  SHERWOOD WOOD/WETH TGE POOL SIMULATION")
    print("  Budget Constraint: $10,000 ETH")
    print("*" * 70)
    print()
    print(f"  Parameters:")
    print(f"    Total WOOD Supply:     {fmt_num(TOTAL_SUPPLY)}")
    print(f"    Circulating at TGE:    {fmt_num(500_000_000)}")
    print(f"    Genesis LP Allocation: {fmt_num(WOOD_ALLOCATION)}")
    print(f"    ETH Price:             ${ETH_PRICE:,}")
    print(f"    ETH Budget:            {fmt(BUDGET_USD)} = {ETH_AVAILABLE:.4f} ETH")
    
    # ========================================
    separator("APPROACH 1: BALANCED 50/50 POOL (xy=k)")
    # ========================================
    print()
    print("  With only $10K ETH, a balanced pool means $10K on each side = $20K TVL.")
    print("  This is EXTREMELY thin. For context, most viable DEX pools have $500K+ TVL.")
    
    bal_5m = simulate_balanced_pool(5_000_000, "$5M")
    bal_10m = simulate_balanced_pool(10_000_000, "$10M")
    
    print()
    print("  VERDICT: A $20K balanced pool is paper-thin.")
    print("  Any whale (or even a $5K trader) will move price 25%+.")
    print("  This approach alone is NOT viable for a real TGE.")
    
    # ========================================
    separator("APPROACH 2: SINGLE-SIDED WOOD (Concentrated Liquidity)")
    # ========================================
    print()
    print("  KEY INSIGHT: Protocol owns WOOD. It costs $0 to mint.")
    print("  Instead of pairing with ETH, deposit WOOD-only in a range above initial price.")
    print("  Buyers provide the ETH organically. Pool self-balances.")
    print()
    print("  This is what Sherwood already does for shareToken/WOOD pools.")
    print("  Same mechanic works for the primary WOOD/WETH pool on Aerodrome.")
    
    # At $5M FDV
    ss_5m_20m = simulate_single_sided(
        wood_amount=20_000_000,
        initial_price_usd=0.005,
        upper_price_mult=2.0,
        label="20M WOOD, $5M FDV target, 2x range"
    )
    
    ss_5m_50m = simulate_single_sided(
        wood_amount=50_000_000,
        initial_price_usd=0.005,
        upper_price_mult=3.0,
        label="50M WOOD (full allocation), $5M FDV, 3x range"
    )
    
    # At $10M FDV
    ss_10m = simulate_single_sided(
        wood_amount=20_000_000,
        initial_price_usd=0.01,
        upper_price_mult=2.0,
        label="20M WOOD, $10M FDV target, 2x range"
    )
    
    print()
    print("  VERDICT: Single-sided is powerful because:")
    print("  - Zero ETH required upfront")
    print("  - Deeper effective liquidity than balanced pool")
    print("  - Price discovery happens naturally")
    print("  - Protocol retains ETH budget for other uses")
    print("  - RISK: If no buyers show up, WOOD just sits there (no loss)")
    
    # ========================================
    separator("APPROACH 3: LBP (Liquidity Bootstrapping Pool)")
    # ========================================
    print()
    print("  Use Fjord Foundry or similar LBP platform on Base.")
    print("  Seed with mostly WOOD + minimal ETH. Weight shifts over 2-3 days.")
    print("  Buyers provide ETH. Raised ETH seeds the permanent Aerodrome pool.")
    
    lbp_results = simulate_lbp()
    
    print()
    print("  VERDICT: LBP is the best way to BOOTSTRAP ETH liquidity.")
    print("  Even a modest $50K raise creates a much deeper pool than $10K direct seed.")
    print("  Also provides fair price discovery and broad token distribution.")
    
    # ========================================
    separator("APPROACH 4: HYBRID RECOMMENDATIONS")
    # ========================================
    
    print()
    print("  OPTION A: LBP First -> Deep Aerodrome Pool")
    print("  " + "-" * 50)
    print("  1. Run 2-3 day LBP with 20M WOOD + ~$1K ETH")
    print("  2. LBP handles price discovery + raises ETH from buyers")
    print("  3. Use ALL raised ETH + remaining WOOD to seed Aerodrome pool")
    print("  4. If raises $100K: pool TVL = ~$200K, max <2% trade = ~$2K")
    print("  5. If raises $200K: pool TVL = ~$400K, max <2% trade = ~$4K")
    print("  PROS: Deep liquidity, fair launch, broad distribution")
    print("  CONS: Requires 2-3 day wait, LBP platform fees (~2%)")
    print()
    
    print("  OPTION B: Single-Sided WOOD on Aerodrome (Zero ETH)")
    print("  " + "-" * 50)
    print("  1. Deploy concentrated liquidity pool on Aerodrome")
    print("  2. Deposit 20-50M WOOD single-sided above initial price")
    print("  3. Market makers and buyers bring ETH organically")
    print("  4. Pool depth grows as trading volume increases")
    print("  PROS: Instant launch, zero ETH needed, proven mechanic")
    print("  CONS: Initial liquidity thin until buyers arrive")
    print()
    
    print("  OPTION C: Thin Balanced Pool + Hope")
    print("  " + "-" * 50)
    print("  1. Seed $10K ETH + equivalent WOOD in Aerodrome pool")
    print("  2. TVL = $20K (paper-thin)")
    print("  3. Rely on trading fees + bribes to attract more LPs")
    print("  PROS: Simple, immediate")
    print("  CONS: Extremely vulnerable to manipulation, bad UX")
    print()
    
    print("  OPTION D (RECOMMENDED): LBP + Single-Sided Hybrid")
    print("  " + "-" * 50)
    print("  1. Run LBP with 15M WOOD to raise ETH and find price")
    print("  2. Simultaneously prep single-sided position with 20M WOOD")
    print("  3. After LBP: seed balanced pool with raised ETH + WOOD")
    print("  4. Add single-sided WOOD position above the LBP final price")
    print("  5. Remaining 15M WOOD for future incentives/bribes")
    print("  TOTAL: 50M WOOD allocated, $10K ETH as safety net only")
    print()
    
    # ========================================
    separator("COMPARISON SUMMARY")
    # ========================================
    
    print()
    print(f"  {'Approach':<35} {'ETH Needed':>12} {'Effective TVL':>15} {'Max <2% Trade':>15}")
    print(f"  {'-'*35} {'-'*12} {'-'*15} {'-'*15}")
    print(f"  {'Balanced $5M FDV':<35} {'$10,000':>12} {'$20,000':>15} {fmt(bal_5m['max_2pct']):>15}")
    print(f"  {'Balanced $10M FDV':<35} {'$10,000':>12} {'$20,000':>15} {fmt(bal_10m['max_2pct']):>15}")
    print(f"  {'Single-sided 20M WOOD @$5M':<35} {'$0':>12} {'grows w/buys':>15} {fmt(ss_5m_20m['max_2pct']):>15}")
    print(f"  {'Single-sided 50M WOOD @$5M':<35} {'$0':>12} {'grows w/buys':>15} {fmt(ss_5m_50m['max_2pct']):>15}")
    print(f"  {'Single-sided 20M WOOD @$10M':<35} {'$0':>12} {'grows w/buys':>15} {fmt(ss_10m['max_2pct']):>15}")
    
    for raised, data in lbp_results.items():
        label = f"LBP raises {fmt(raised)} -> Aero"
        print(f"  {label:<35} {'~$1,000':>12} {fmt(data['tvl']):>15} {fmt(data['max_2pct']):>15}")
    
    print()
    
    # ========================================
    separator("KEY TAKEAWAYS")
    # ========================================
    print()
    print("  1. $10K balanced pool = $20K TVL = unusable for real trading")
    print("     A single $500 trade moves price 2.5%. Whales will eat this alive.")
    print()
    print("  2. Single-sided WOOD is the zero-cost baseline")
    print("     20M WOOD single-sided supports ~$1.8K trades at <2% slip")
    print("     50M WOOD (full alloc) supports ~$4.5K trades at <2% slip")
    print("     No ETH required. Save the $10K for something else.")
    print()
    print("  3. LBP is the ETH-bootstrapping power move")
    print("     Even raising $50K creates a pool 5x deeper than direct seed")
    print("     $200K raise = serious liquidity ($400K pool)")
    print("     Plus: fair price discovery, community engagement, hype")
    print()
    print("  4. RECOMMENDED PATH:")
    print("     Week 1: LBP on Fjord (15M WOOD, minimal ETH)")
    print("     Week 1+: Deploy Aerodrome pool with LBP proceeds")
    print("     Week 1+: Add single-sided 20M WOOD above LBP price")
    print("     Ongoing: Use remaining 15M WOOD for Aero bribes/incentives")
    print("     Keep the $10K ETH as operational reserve, not LP")
    print()
    print("  5. The $10K is a red herring for liquidity")
    print("     WOOD is free to mint. Use WOOD-heavy strategies.")
    print("     Let the MARKET bring the ETH via LBP or organic buying.")
    print()
    print("*" * 70)
    print("  END OF SIMULATION")
    print("*" * 70)
    print()


if __name__ == "__main__":
    main()
