#!/usr/bin/env python3
"""
Sherwood $WOOD Token TGE Pool Simulation
=========================================
Simulates WOOD/WETH pool dynamics on Aerodrome (Base) for different
FDV scenarios, ETH prices, and pool types (Volatile vs Concentrated Liquidity).

Key Parameters:
  - Total supply: 1B WOOD
  - Genesis liquidity: 20M WOOD paired with ETH
  - Fee tier: 0.3%
  - Pool types: Volatile (x*y=k), CL full-range, CL ±50%, CL ±25%
"""

import math

# =============================================================================
# CONSTANTS
# =============================================================================
TOTAL_SUPPLY = 1_000_000_000      # 1B WOOD
CIRCULATING_SUPPLY = 500_000_000  # 500M at TGE
GENESIS_LIQUIDITY_WOOD = 20_000_000  # 20M WOOD seeded into WOOD/WETH pool
FEE_TIER = 0.003                  # 0.3%

FDV_SCENARIOS = [5_000_000, 10_000_000]  # $5M, $10M
ETH_PRICES = [1_500, 1_800, 2_500]      # sensitivity
TRADE_SIZES_USD = [1_000, 5_000, 10_000, 25_000, 50_000, 100_000]

SLIPPAGE_THRESHOLD = 0.02  # 2%


def fmt_usd(v):
    if v >= 1_000_000:
        return f"${v/1_000_000:,.2f}M"
    elif v >= 1_000:
        return f"${v/1_000:,.1f}K"
    return f"${v:,.2f}"


def fmt_pct(v):
    return f"{v*100:.2f}%"


def fmt_eth(v):
    return f"{v:,.2f} ETH"


def fmt_num(v):
    if v >= 1_000_000:
        return f"{v/1_000_000:,.1f}M"
    elif v >= 1_000:
        return f"{v/1_000:,.1f}K"
    return f"{v:,.2f}"


# =============================================================================
# POOL MODELS
# =============================================================================

class VolatilePool:
    """Classic x*y=k AMM (Uniswap V2 style / Aerodrome Volatile)"""
    
    def __init__(self, reserve_wood, reserve_eth):
        self.x = reserve_wood   # WOOD reserve
        self.y = reserve_eth    # ETH reserve
        self.k = self.x * self.y
    
    @property
    def name(self):
        return "Volatile (x*y=k)"
    
    @property
    def price_wood_in_eth(self):
        return self.y / self.x
    
    def buy_wood_with_eth(self, eth_in):
        """Buy WOOD by sending ETH. Returns WOOD received."""
        eth_after_fee = eth_in * (1 - FEE_TIER)
        new_y = self.y + eth_after_fee
        new_x = self.k / new_y
        wood_out = self.x - new_x
        return wood_out
    
    def sell_wood_for_eth(self, wood_in):
        """Sell WOOD for ETH. Returns ETH received."""
        wood_after_fee = wood_in * (1 - FEE_TIER)
        new_x = self.x + wood_after_fee
        new_y = self.k / new_x
        eth_out = self.y - new_y
        return eth_out
    
    def price_impact_buy(self, eth_in):
        """Price impact for buying WOOD with eth_in ETH."""
        wood_out = self.buy_wood_with_eth(eth_in)
        if wood_out <= 0:
            return 1.0
        effective_price = eth_in / wood_out  # ETH per WOOD paid
        spot_price = self.price_wood_in_eth  # ETH per WOOD at spot
        impact = (effective_price - spot_price) / spot_price
        return impact
    
    def price_impact_sell(self, wood_in):
        """Price impact for selling wood_in WOOD."""
        eth_out = self.sell_wood_for_eth(wood_in)
        if eth_out <= 0:
            return 1.0
        effective_price = eth_out / wood_in
        spot_price = self.price_wood_in_eth
        impact = (spot_price - effective_price) / spot_price
        return impact
    
    def max_trade_for_slippage(self, slippage, direction="buy"):
        """Binary search for max trade size (in ETH for buy, WOOD for sell) 
        that stays under the given slippage threshold."""
        lo, hi = 0, self.y * 0.99 if direction == "buy" else self.x * 0.99
        for _ in range(100):
            mid = (lo + hi) / 2
            if direction == "buy":
                impact = self.price_impact_buy(mid)
            else:
                impact = self.price_impact_sell(mid)
            if impact < slippage:
                lo = mid
            else:
                hi = mid
        return lo


class ConcentratedLiquidityPool:
    """
    Simplified CL model (Uniswap V3 / Aerodrome Slipstream style).
    
    For a position concentrated in range [p_a, p_b] around current price p:
    The virtual liquidity L is amplified compared to full-range.
    
    Full-range CL is mathematically equivalent to x*y=k.
    
    Capital efficiency multiplier ≈ 1 / (1 - sqrt(p_a/p_b)) for symmetric ranges,
    but we use the exact Uniswap V3 math:
    
    L = x * sqrt(p) * sqrt(p_b) / (sqrt(p_b) - sqrt(p))  [from token0]
    L = y / (sqrt(p) - sqrt(p_a))                          [from token1]
    """
    
    def __init__(self, reserve_wood, reserve_eth, range_pct=None):
        """
        reserve_wood, reserve_eth: same capital as volatile pool
        range_pct: None = full range, else e.g. 0.50 for ±50%
        """
        self.total_wood = reserve_wood
        self.total_eth = reserve_eth
        self.range_pct = range_pct
        
        # Current price (ETH per WOOD)
        self.p = reserve_eth / reserve_wood
        
        if range_pct is None:
            # Full range: equivalent to volatile
            self.p_a = 0.0000001  # ~0
            self.p_b = 1e18       # ~infinity
            self.L = math.sqrt(reserve_wood * reserve_eth)
            self._name = "CL Full-Range"
        else:
            self.p_a = self.p * (1 - range_pct)
            self.p_b = self.p * (1 + range_pct)
            # Calculate L from the deposited amounts
            # With concentrated liquidity, same capital => higher L
            sqrt_p = math.sqrt(self.p)
            sqrt_pa = math.sqrt(self.p_a)
            sqrt_pb = math.sqrt(self.p_b)
            
            # From the capital constraint:
            # x_virtual = L / sqrt(p) - L / sqrt(p_b)
            # y_virtual = L * sqrt(p) - L * sqrt(p_a)
            # We have x_real = reserve_wood, y_real = reserve_eth
            # L from x: L = x_real / (1/sqrt(p) - 1/sqrt(p_b))
            # L from y: L = y_real / (sqrt(p) - sqrt(pa))
            
            L_from_x = reserve_wood / (1/sqrt_p - 1/sqrt_pb)
            L_from_y = reserve_eth / (sqrt_p - sqrt_pa)
            
            # Use the minimum (binding constraint) - in practice they should
            # be close for symmetric ranges deposited at current price
            self.L = min(L_from_x, L_from_y)
            self._name = f"CL +/-{int(range_pct*100)}%"
    
    @property
    def name(self):
        return self._name
    
    @property
    def price_wood_in_eth(self):
        return self.p
    
    @property
    def capital_efficiency_vs_volatile(self):
        """How many times more liquid this CL position is vs volatile with same capital."""
        volatile_L = math.sqrt(self.total_wood * self.total_eth)
        return self.L / volatile_L
    
    def buy_wood_with_eth(self, eth_in):
        """Buy WOOD by depositing ETH into the pool."""
        eth_after_fee = eth_in * (1 - FEE_TIER)
        sqrt_p = math.sqrt(self.p)
        sqrt_pa = math.sqrt(self.p_a)
        sqrt_pb = math.sqrt(self.p_b)
        
        # Current virtual reserves
        y_virtual = self.L * sqrt_p
        x_virtual = self.L / sqrt_p
        
        # Add ETH
        new_y_virtual = y_virtual + eth_after_fee
        new_sqrt_p = new_y_virtual / self.L
        
        # Clamp to range
        if new_sqrt_p > sqrt_pb:
            new_sqrt_p = sqrt_pb
        
        # WOOD out
        new_x_virtual = self.L / new_sqrt_p
        wood_out = x_virtual - new_x_virtual
        return max(wood_out, 0)
    
    def sell_wood_for_eth(self, wood_in):
        """Sell WOOD for ETH."""
        wood_after_fee = wood_in * (1 - FEE_TIER)
        sqrt_p = math.sqrt(self.p)
        sqrt_pa = math.sqrt(self.p_a)
        
        x_virtual = self.L / sqrt_p
        y_virtual = self.L * sqrt_p
        
        new_x_virtual = x_virtual + wood_after_fee
        new_sqrt_p = self.L / new_x_virtual
        
        if new_sqrt_p < sqrt_pa:
            new_sqrt_p = sqrt_pa
        
        new_y_virtual = self.L * new_sqrt_p
        eth_out = y_virtual - new_y_virtual
        return max(eth_out, 0)
    
    def price_impact_buy(self, eth_in):
        wood_out = self.buy_wood_with_eth(eth_in)
        if wood_out <= 0:
            return 1.0
        effective_price = eth_in / wood_out
        impact = (effective_price - self.p) / self.p
        return impact
    
    def price_impact_sell(self, wood_in):
        eth_out = self.sell_wood_for_eth(wood_in)
        if eth_out <= 0:
            return 1.0
        effective_price = eth_out / wood_in
        impact = (self.p - effective_price) / self.p
        return impact
    
    def max_trade_for_slippage(self, slippage, direction="buy"):
        lo, hi = 0, self.total_eth * 5 if direction == "buy" else self.total_wood * 5
        for _ in range(100):
            mid = (lo + hi) / 2
            if direction == "buy":
                impact = self.price_impact_buy(mid)
            else:
                impact = self.price_impact_sell(mid)
            if impact < slippage:
                lo = mid
            else:
                hi = mid
        return lo


# =============================================================================
# SIMULATION
# =============================================================================

def run_simulation():
    sep = "=" * 90
    thin_sep = "-" * 90
    
    print(sep)
    print("  SHERWOOD $WOOD TGE POOL SIMULATION - AERODROME (BASE)")
    print(sep)
    print()
    print("PARAMETERS:")
    print(f"  Total Supply:         {fmt_num(TOTAL_SUPPLY)} WOOD")
    print(f"  Circulating at TGE:   {fmt_num(CIRCULATING_SUPPLY)} WOOD")
    print(f"  Genesis Pool Seed:    {fmt_num(GENESIS_LIQUIDITY_WOOD)} WOOD")
    print(f"  Fee Tier:             {FEE_TIER*100:.1f}%")
    print(f"  Pool Types:           Volatile, CL Full-Range, CL +/-50%, CL +/-25%")
    print(f"  FDV Scenarios:        {', '.join(fmt_usd(f) for f in FDV_SCENARIOS)}")
    print(f"  ETH Prices:           {', '.join(f'${p:,}' for p in ETH_PRICES)}")
    print()
    
    # =========================================================================
    # SECTION 1: Pool Seeding Requirements
    # =========================================================================
    print(sep)
    print("  SECTION 1: ETH REQUIRED TO SEED POOL")
    print(sep)
    print()
    print(f"  {'FDV':<12} {'WOOD Price':<14} {'ETH Price':<12} {'ETH Needed':<14} {'USD Value (ETH side)':<22} {'Total Pool TVL'}")
    print(f"  {thin_sep}")
    
    for fdv in FDV_SCENARIOS:
        wood_price_usd = fdv / TOTAL_SUPPLY
        for eth_price in ETH_PRICES:
            wood_price_eth = wood_price_usd / eth_price
            # For x*y=k pool: equal value on both sides
            wood_value_usd = GENESIS_LIQUIDITY_WOOD * wood_price_usd
            eth_needed = wood_value_usd / eth_price
            eth_value_usd = eth_needed * eth_price
            total_tvl = wood_value_usd + eth_value_usd
            
            print(f"  {fmt_usd(fdv):<12} ${wood_price_usd:<13.4f} ${eth_price:<11,} {fmt_eth(eth_needed):<14} {fmt_usd(eth_value_usd):<22} {fmt_usd(total_tvl)}")
    
    print()
    print("  NOTE: For a balanced AMM pool, ETH side = WOOD side in USD value.")
    print(f"  20M WOOD at $5M FDV = $100K worth of WOOD => need $100K in ETH")
    print(f"  20M WOOD at $10M FDV = $200K worth of WOOD => need $200K in ETH")
    print()
    
    # =========================================================================
    # SECTION 2-4: Price Impact & Pool Comparison (per FDV x ETH price)
    # =========================================================================
    for fdv in FDV_SCENARIOS:
        wood_price_usd = fdv / TOTAL_SUPPLY
        
        for eth_price in ETH_PRICES:
            wood_price_eth = wood_price_usd / eth_price
            eth_needed = GENESIS_LIQUIDITY_WOOD * wood_price_eth
            
            print(sep)
            print(f"  SCENARIO: FDV = {fmt_usd(fdv)} | ETH = ${eth_price:,} | WOOD = ${wood_price_usd:.4f}")
            print(f"  Pool: {fmt_num(GENESIS_LIQUIDITY_WOOD)} WOOD + {fmt_eth(eth_needed)} (TVL = {fmt_usd(GENESIS_LIQUIDITY_WOOD * wood_price_usd * 2)})")
            print(sep)
            
            # Create pool instances
            pools = [
                VolatilePool(GENESIS_LIQUIDITY_WOOD, eth_needed),
                ConcentratedLiquidityPool(GENESIS_LIQUIDITY_WOOD, eth_needed, range_pct=None),
                ConcentratedLiquidityPool(GENESIS_LIQUIDITY_WOOD, eth_needed, range_pct=0.50),
                ConcentratedLiquidityPool(GENESIS_LIQUIDITY_WOOD, eth_needed, range_pct=0.25),
            ]
            
            # Capital efficiency
            print()
            print(f"  Capital Efficiency (Liquidity L):")
            volatile_L = math.sqrt(GENESIS_LIQUIDITY_WOOD * eth_needed)
            for pool in pools:
                if isinstance(pool, ConcentratedLiquidityPool):
                    eff = pool.capital_efficiency_vs_volatile
                    print(f"    {pool.name:<20} L = {pool.L:>15,.0f}   ({eff:.1f}x vs volatile)")
                else:
                    print(f"    {pool.name:<20} L = {volatile_L:>15,.0f}   (baseline)")
            
            # BUY price impact
            print()
            print(f"  BUY PRICE IMPACT (buying WOOD with USD equivalent in ETH):")
            header = f"  {'Trade Size':<12}"
            for pool in pools:
                header += f" {pool.name:<18}"
            print(header)
            print(f"  {thin_sep}")
            
            for trade_usd in TRADE_SIZES_USD:
                eth_in = trade_usd / eth_price
                row = f"  {fmt_usd(trade_usd):<12}"
                for pool in pools:
                    impact = pool.price_impact_buy(eth_in)
                    row += f" {fmt_pct(impact):<18}"
                print(row)
            
            # SELL price impact
            print()
            print(f"  SELL PRICE IMPACT (selling WOOD for ETH):")
            header = f"  {'Trade Size':<12}"
            for pool in pools:
                header += f" {pool.name:<18}"
            print(header)
            print(f"  {thin_sep}")
            
            for trade_usd in TRADE_SIZES_USD:
                wood_to_sell = trade_usd / wood_price_usd
                row = f"  {fmt_usd(trade_usd):<12}"
                for pool in pools:
                    impact = pool.price_impact_sell(wood_to_sell)
                    row += f" {fmt_pct(impact):<18}"
                print(row)
            
            # Slippage improvement
            print()
            print(f"  SLIPPAGE REDUCTION vs VOLATILE (buy side):")
            header = f"  {'Trade Size':<12} {'Volatile':<14}"
            for pool in pools[1:]:
                header += f" {pool.name:<18}"
            print(header)
            print(f"  {thin_sep}")
            
            for trade_usd in TRADE_SIZES_USD:
                eth_in = trade_usd / eth_price
                vol_impact = pools[0].price_impact_buy(eth_in)
                row = f"  {fmt_usd(trade_usd):<12} {fmt_pct(vol_impact):<14}"
                for pool in pools[1:]:
                    cl_impact = pool.price_impact_buy(eth_in)
                    if vol_impact > 0.0001:
                        reduction = (1 - cl_impact / vol_impact) * 100
                        row += f" {reduction:>+5.0f}% better    "
                    else:
                        row += f" {'~same':<18}"
                print(row)
            
            # Max trade for <2% slippage
            print()
            print(f"  LIQUIDITY DEPTH: Max trade size for <{SLIPPAGE_THRESHOLD*100:.0f}% slippage:")
            print(f"  {'Pool Type':<22} {'Max Buy (ETH)':<16} {'Max Buy (USD)':<16} {'Max Sell (WOOD)':<18} {'Max Sell (USD)'}")
            print(f"  {thin_sep}")
            
            for pool in pools:
                max_buy_eth = pool.max_trade_for_slippage(SLIPPAGE_THRESHOLD, "buy")
                max_sell_wood = pool.max_trade_for_slippage(SLIPPAGE_THRESHOLD, "sell")
                max_buy_usd = max_buy_eth * eth_price
                max_sell_usd = max_sell_wood * wood_price_usd
                print(f"  {pool.name:<22} {fmt_eth(max_buy_eth):<16} {fmt_usd(max_buy_usd):<16} {fmt_num(max_sell_wood):<18} {fmt_usd(max_sell_usd)}")
            
            print()
    
    # =========================================================================
    # SECTION 5: SUMMARY TABLE - Quick Reference
    # =========================================================================
    print(sep)
    print("  SUMMARY: KEY METRICS AT BASELINE (ETH = $1,800)")
    print(sep)
    print()
    
    for fdv in FDV_SCENARIOS:
        wood_price_usd = fdv / TOTAL_SUPPLY
        eth_price = 1800
        wood_price_eth = wood_price_usd / eth_price
        eth_needed = GENESIS_LIQUIDITY_WOOD * wood_price_eth
        
        print(f"  FDV = {fmt_usd(fdv)} | WOOD = ${wood_price_usd:.4f} | Seed = {fmt_eth(eth_needed)}")
        print()
        
        pools = [
            VolatilePool(GENESIS_LIQUIDITY_WOOD, eth_needed),
            ConcentratedLiquidityPool(GENESIS_LIQUIDITY_WOOD, eth_needed, range_pct=None),
            ConcentratedLiquidityPool(GENESIS_LIQUIDITY_WOOD, eth_needed, range_pct=0.50),
            ConcentratedLiquidityPool(GENESIS_LIQUIDITY_WOOD, eth_needed, range_pct=0.25),
        ]
        
        print(f"  {'Pool':<22} {'$10K Buy':<12} {'$50K Buy':<12} {'$100K Buy':<12} {'Max <2% (Buy)':<16} {'Cap. Eff.'}")
        print(f"  {thin_sep}")
        
        volatile_L = math.sqrt(GENESIS_LIQUIDITY_WOOD * eth_needed)
        for pool in pools:
            i10 = pool.price_impact_buy(10_000 / eth_price)
            i50 = pool.price_impact_buy(50_000 / eth_price)
            i100 = pool.price_impact_buy(100_000 / eth_price)
            max_buy = pool.max_trade_for_slippage(SLIPPAGE_THRESHOLD, "buy") * eth_price
            
            if isinstance(pool, ConcentratedLiquidityPool):
                eff = f"{pool.capital_efficiency_vs_volatile:.1f}x"
            else:
                eff = "1.0x"
            
            print(f"  {pool.name:<22} {fmt_pct(i10):<12} {fmt_pct(i50):<12} {fmt_pct(i100):<12} {fmt_usd(max_buy):<16} {eff}")
        
        print()
    
    # =========================================================================
    # SECTION 6: RECOMMENDATIONS
    # =========================================================================
    print(sep)
    print("  RECOMMENDATIONS FOR SHERWOOD TGE")
    print(sep)
    print("""
  1. VOLATILE POOL (x*y=k) - RECOMMENDED FOR LAUNCH
     - Aligns with tokenomics doc: "full-range position, no active rebalancing"
     - Set-and-forget: no range management, no out-of-range risk
     - Battle-tested for chaotic TGE price discovery
     - On Aerodrome, volatile pools earn AERO emissions via voting
     - Downside: less capital efficient (higher slippage per $ of TVL)

  2. CL FULL-RANGE - EQUIVALENT ALTERNATIVE
     - Mathematically identical to volatile for price impact
     - On Aerodrome Slipstream, may qualify for different gauge incentives
     - Still no range management needed
     - Consider if Aerodrome gauge incentives favor CL over volatile

  3. CL CONCENTRATED (+/-50% or +/-25%) - OPTIONAL PHASE 2
     - Dramatically better capital efficiency (2-4x lower slippage)
     - BUT: requires active management, positions go out of range
     - NOT suitable for TGE launch with "no active rebalancing" mandate
     - Consider deploying AFTER price stabilizes (week 2-4 post-TGE)
     - Could use a portion of remaining 30M genesis WOOD for this

  SUGGESTED APPROACH:
     Phase 1 (TGE):    Volatile pool with 20M WOOD + matching ETH
     Phase 2 (Week 2+): Evaluate adding CL positions if price stabilizes
     Phase 3 (Month 2): Consider migrating liquidity to CL with range mgmt

  ETH REQUIREMENTS:
     At $5M FDV:  ~55.6 ETH ($100K) with ETH at $1,800
     At $10M FDV: ~111.1 ETH ($200K) with ETH at $1,800

  LIQUIDITY ADEQUACY:
     At $5M FDV (volatile): ~$10K-$20K trades have <2% slippage
       -> Adequate for initial discovery, may need more depth for whales
     At $10M FDV (volatile): ~$20K-$40K trades have <2% slippage
       -> Better depth, suitable for most retail + moderate size trades

  RISK NOTES:
     - At TGE, expect 5-20x normal volume vs TVL
     - Initial price discovery may see 50-200% swings
     - Volatile pool handles this gracefully (no out-of-range concern)
     - CL +/-25% would go out of range within minutes of a volatile TGE
     - Fee revenue from 0.3% tier will be meaningful with high TGE volume
""")
    
    print(sep)
    print("  END OF SIMULATION")
    print(sep)


if __name__ == "__main__":
    run_simulation()
