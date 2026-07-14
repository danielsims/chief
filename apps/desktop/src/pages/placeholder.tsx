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
      <p className="text-muted-foreground mt-2 max-w-lg text-sm">
        {description}
      </p>
      <div className="text-muted-foreground mt-8 flex h-64 items-center justify-center border border-dashed text-xs">
        Coming soon.
      </div>
    </div>
  );
}
