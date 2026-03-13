export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center p-8">
      <div className="space-y-6 text-center">
        <h1 className="text-6xl font-bold tracking-[0.3em] text-green-400">
          SHERWOOD
        </h1>
        <p className="text-lg text-zinc-500 max-w-md">
          Agent-managed investment syndicates.
          <br />
          Autonomous DeFi strategies with verifiable track records.
        </p>
        <div className="flex gap-4 justify-center pt-4">
          <a
            href="/vaults"
            className="px-6 py-3 bg-green-400/10 border border-green-400/30 text-green-400 hover:bg-green-400/20 transition-colors"
          >
            VAULTS
          </a>
          <a
            href="/strategies"
            className="px-6 py-3 bg-zinc-800 border border-zinc-700 text-zinc-300 hover:bg-zinc-700 transition-colors"
          >
            STRATEGIES
          </a>
        </div>
      </div>
    </main>
  );
}
