export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center gap-8 px-6 text-center">
      <span className="font-serif text-2xl italic">m.</span>
      <h1 className="font-serif text-5xl leading-tight">
        Your marketing team,
        <br />
        <span className="text-muted-foreground">as agents.</span>
      </h1>
      <p className="max-w-xl text-sm leading-6 text-muted-foreground">
        A CMO agent that orchestrates specialists for content, analytics,
        prospecting and ads. Runs locally, reachable from your desktop, Slack,
        or wherever you are.
      </p>
      <div className="flex items-center gap-3">
        <a
          href="#"
          className="border bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Download for Mac
        </a>
        <a
          href="#"
          className="border px-5 py-2.5 text-sm font-medium transition-colors hover:bg-accent"
        >
          Star on GitHub
        </a>
      </div>
      <p className="text-[11px] text-muted-foreground/50">
        Local-first. Your data and your inference stay on your machine.
      </p>
    </main>
  );
}
