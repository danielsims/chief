export function PlaceholderPage({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="pt-10">
      <h1 className="font-serif text-3xl">{title}</h1>
      <p className="mt-2 max-w-lg text-sm text-muted-foreground">{description}</p>
      <div className="mt-8 flex h-64 items-center justify-center border border-dashed text-xs text-muted-foreground">
        Coming soon.
      </div>
    </div>
  );
}
